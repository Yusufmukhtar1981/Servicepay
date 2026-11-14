"use strict";
const S = require("../services/businessNetwork.service");
const { M, P, User, Transaction } = S;
const catalogue = require("../services/businessNetwork.catalogue");
const detailsFields = ["businessName", "businessCategory", "ownerName", "phone", "email", "state", "lga", "address", "description", "registrationNumber"];
const output = (res, data, status = 200) => res.status(status).json({ success: true, data });
const wrap = callback => async (req, res, next) => { try { await callback(req, res); } catch (error) { next(error); } };
const page = req => {
  const raw = req.query.page ?? "1"; if (typeof raw !== "string" || !/^[1-9]\d{0,5}$/.test(raw)) P.fail("Invalid page.");
  return Number(raw);
};
const revision = value => P.integer(value, "application revision");
const userIsCustomer = (req, _res, next) => {
  try { if (req.user.role !== "CUSTOMER") P.fail("Retail business applications require an existing Customer account.", "NETWORK_FORBIDDEN", 403); next(); } catch (error) { next(error); }
};
const kindFrom = req => P.kind(req.params.kind);
const why = req => P.text(req.body.reason, "reason", 500, true);
const profileIds = async req => {
  const filter = await S.adminScope(req.user);
  if (req.query.kind) filter.kind = P.kind(req.query.kind);
  if (req.query.profileId) filter._id = S.id(req.query.profileId);
  return (await M.Profile.find(filter).select("_id").lean()).map(row => row._id);
};
const adminProfile = async (req, session) => {
  const filter = { ...(await S.adminScope(req.user)), _id: S.id(req.params.id) };
  const profile = await M.Profile.findOne(filter).session(session || null);
  if (!profile) P.fail("Business not found within your access.", "NETWORK_NOT_FOUND", 404);
  return profile;
};
exports.wrap = wrap;
exports.userIsCustomer = userIsCustomer;
exports.support = wrap(async (req, res) => {
  const kind = P.kind(req.body.kind);
  const subject = P.text(req.body.subject, "support subject", 160, true);
  const message = P.text(req.body.message, "support message", 3000, true);
  const key = P.text(req.body.idempotencyKey, "support request key", 90, true);
  const reference = P.text(req.body.transactionReference, "transaction reference", 150);
  let transactionLookupId;
  if (reference) {
    const own = await Transaction.findOne({ customerId: req.user._id, reference }).select("_id").lean();
    if (!own) P.fail("The selected transaction was not found in your history.", "NETWORK_NOT_FOUND", 404);
    transactionLookupId = `transaction:${own._id}`;
  }
  req.body = { subject: `${kind} business support: ${subject}`, description: message,
    category: "OTHER", priority: "NORMAL", idempotencyKey: `network:${key}`,
    ...(transactionLookupId ? { transactionLookupId } : {}) };
  return require("./support.controller").createTicket(req, res);
});
exports.me = wrap(async (req, res) => {
  const user = await User.findById(req.user._id).select("fullName phone email kycVerified").lean();
  const applications = await M.Profile.find({ owner: req.user._id }).lean();
  const memberships = await M.Staff.find({ user: req.user._id, status: { $in: ["INVITED", "ACTIVE"] } }).populate("profile", "networkId kind services details.businessName status").lean();
  const settings = await M.Settings.findById("network");
  output(res, { customer: user, applications, memberships, features: P.features,
    categories: settings?.categories || new M.Settings().categories,
    supportedServices: P.billServices, serviceCatalogue: await catalogue.catalogue(settings) });
});
exports.save = wrap(async (req, res) => {
  const kind = kindFrom(req), allowed = new Set([...detailsFields, "preferredServices", "revision", "kind"]);
  if (Object.keys(req.body).some(k => !allowed.has(k))) P.fail("An unsupported application field was supplied.");
  if (req.body.kind !== undefined && P.kind(req.body.kind) !== kind)
    P.fail("The selected application type does not match this application.");
  const details = {};
  for (const key of detailsFields) details[key] = P.text(req.body[key], key, key === "description" ? 2000 : 300);
  details.preferredServices = catalogue.preferences(req.body.preferredServices || []);
  const result = await S.atomic(async session => {
    const prior = await M.Profile.findOne({ owner: req.user._id, kind }).session(session);
    if (prior && !["DRAFT", "REJECTED"].includes(prior.status)) P.fail("Only draft or rejected applications can be edited.", "NETWORK_CONFLICT", 409);
    if (prior && revision(req.body.revision) !== prior.revision) P.fail("Application changed. Refresh before editing.", "NETWORK_CONFLICT", 409);
    let profile;
    if (prior) {
      prior.details = details; prior.status = "DRAFT"; prior.revision += 1; profile = await prior.save({ session });
    } else [profile] = await M.Profile.create([{ owner: req.user._id, kind, details }], { session });
    await S.audit(req.user, "APPLICATION_DRAFT_SAVED", profile, "", {}, session); return profile;
  });
  output(res, { profile: result });
});
exports.submit = wrap(async (req, res) => {
  const { profile: found } = await S.profileFor(req.user, kindFrom(req), { approved: false });
  if (revision(req.body.revision) !== found.revision || found.status !== "DRAFT") P.fail("Refresh the draft before submitting.", "NETWORK_CONFLICT", 409);
  for (const key of ["businessName", "ownerName", "phone", "email", "state", "lga", "address"]) P.text(found.details[key], key, 300, true);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(found.details.email)) P.fail("Provide a valid business contact email.");
  if (!/^\+?\d{10,15}$/.test(found.details.phone.replace(/[\s()-]/g, ""))) P.fail("Provide a valid contact phone.");
  if (!found.details.preferredServices.length) P.fail("Select at least one supported service.");
  await catalogue.validate(found.details.preferredServices, found.kind, await M.Settings.findById("network"));
  if (found.kind === "MERCHANT") {
    P.text(found.details.businessCategory, "business category", 100, true);
    const categories = (await M.Settings.findById("network"))?.categories || new M.Settings().categories;
    if (!categories.includes(found.details.businessCategory)) P.fail("Select a currently configured business category.");
  }
  const profile = await S.atomic(async session => {
    const updated = await M.Profile.findOneAndUpdate({ _id: found._id, status: "DRAFT", revision: found.revision },
      { $set: { status: "SUBMITTED" }, $inc: { revision: 1 } }, { new: true, session });
    if (!updated) P.fail("Application changed. Refresh before submitting.", "NETWORK_CONFLICT", 409);
    await S.audit(req.user, "APPLICATION_SUBMITTED", updated, "", {}, session); return updated;
  });
  output(res, { profile });
});
exports.dashboard = wrap(async (req, res) => {
  const { profile, membership } = await S.profileFor(req.user, kindFrom(req), { profileId: req.query.profileId });
  const period = req.query.period || "month";
  if (!["day", "week", "month"].includes(period)) P.fail("Invalid report period.");
  // Lagos has no daylight-saving transitions. Period boundaries are Lagos calendar days.
  const lagos = new Date(Date.now() + 3600000);
  let start = new Date(Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth(), lagos.getUTCDate()));
  if (period === "week") start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  if (period === "month") start.setUTCDate(1);
  start = new Date(start.getTime() - 3600000);
  const summary = await S.summary({ profile: profile._id, ...(membership ? { branch: membership.branch } : {}) }, { from: start });
  const commissions = membership ? P.totals([]) : (await S.commissionRows({ profile: profile._id })).totals;
  const safeProfile = profile.toObject();
  if (membership) delete safeProfile.directory;
  output(res, { profile: safeProfile, summary, commissions, features: P.features });
});
exports.transactions = wrap(async (req, res) => {
  const { profile, membership } = await S.profileFor(req.user, kindFrom(req), { profileId: req.query.profileId, approved: false });
  output(res, await S.transactions({ profile: profile._id }, { ...req.query, page: page(req), branch: membership?.branch }));
});
exports.eligible = wrap(async (req, res) => {
  const { profile } = await S.profileFor(req.user, kindFrom(req), { profileId: req.query.profileId, permission: "payments" });
  const linked = await M.Activity.find({ profile: profile._id }).select("transaction").lean();
  const historicalServices = [...new Set(profile.approvalWindows.flatMap(w => [...(w.services || [])]))];
  const rows = await Transaction.find({ customerId: req.user._id, _id: { $nin: linked.map(x => x.transaction) },
    serviceType: { $in: historicalServices }, createdAt: { $gte: profile.approvedAt } }).sort({ createdAt: -1 }).limit(50)
    .select("_id reference serviceType status amount createdAt").lean();
  output(res, { items: rows.filter(row => P.approvalCovers(profile, row.createdAt, row.serviceType))
    .map(row => ({ ...row, amount: undefined, amountKobo: P.kobo(row.amount) })) });
});
exports.link = wrap(async (req, res) => {
  if (req.body.consentAcknowledged !== true) P.fail("Record the customer's consent before attributing a purchase.");
  const { profile, membership } = await S.profileFor(req.user, kindFrom(req), { profileId: req.query.profileId, permission: "payments" });
  const transactionId = S.id(req.body.transactionId);
  const existing = await M.Activity.findOne({ transaction: transactionId });
  if (existing) {
    if (String(existing.profile) !== String(profile._id) || String(existing.actor) !== String(req.user._id)) P.fail("Transaction is already attributed to a business.", "NETWORK_CONFLICT", 409);
    return output(res, { activity: existing, idempotent: true });
  }
  const tx = await Transaction.findOne({ _id: transactionId, customerId: req.user._id }).lean();
  if (!tx || !P.billServices.includes(tx.serviceType) || !P.approvalCovers(profile, tx.createdAt, tx.serviceType))
    P.fail("Only your own authorized business-period bill payments can be attributed.", "NETWORK_FORBIDDEN", 403);
  let branch;
  if (membership) branch = membership.branch;
  else if (req.body.branch) {
    branch = S.id(req.body.branch);
    if (!await M.Branch.exists({ _id: branch, profile: profile._id, status: "ACTIVE" })) P.fail("Invalid business branch.");
  }
  const activity = await S.atomic(async session => {
    // A concurrent suspension wins before attribution; no financial record is written.
    const active = await M.Profile.findOneAndUpdate({ _id: profile._id, status: "APPROVED" }, { $inc: { revision: 1 } }, { new: true, session });
    if (!active) P.fail("Business approval is no longer active.", "NETWORK_APPROVAL_REQUIRED", 403);
    const window = profile.approvalWindows.find(w => P.approvalCovers({ approvalWindows: [w] }, tx.createdAt, tx.serviceType));
    const [row] = await M.Activity.create([{ profile: profile._id, transaction: tx._id, actor: req.user._id, commissionGroup: window.group || "STANDARD",
      ...(branch ? { branch } : {}), consent: { acknowledged: true, acknowledgedAt: new Date() } }], { session });
    await S.audit(req.user, "OWN_WALLET_PURCHASE_ATTRIBUTED", profile, "", { transaction: tx._id }, session); return row;
  });
  await S.reconcileActivity(activity._id);
  output(res, { activity }, 201);
});
exports.commissions = wrap(async (req, res) => {
  const { profile, membership } = await S.profileFor(req.user, kindFrom(req), { profileId: req.query.profileId, approved: false });
  if (membership) P.fail("Only the business owner can view commission statements.", "NETWORK_FORBIDDEN", 403);
  output(res, await S.commissionRows({ profile: profile._id }, req.query));
});
exports.report = wrap(async (req, res) => {
  const { profile, membership } = await S.profileFor(req.user, kindFrom(req), { profileId: req.query.profileId, approved: false });
  const rows = await S.transactions({ profile: profile._id }, { ...req.query, page: 1, limit: 2000, branch: membership?.branch });
  if (rows.total > 2000) P.fail("Choose a smaller report date range; exports are limited to 2,000 records.");
  res.type("text/csv").attachment("ServicePay-business-transactions.csv").send(P.csv(rows.items));
});
exports.adminProfiles = wrap(async (req, res) => {
  const filter = await S.adminScope(req.user);
  if (req.query.kind) filter.kind = P.kind(req.query.kind);
  if (req.query.status) {
    const values = M.Profile.schema.path("status").enumValues;
    if (!values.includes(req.query.status)) P.fail("Invalid application status."); filter.status = req.query.status;
  }
  for (const key of ["state", "lga"]) if (req.query[key]) filter[`details.${key}`] = P.text(req.query[key], key, 100);
  if (req.query.search) {
    const search = P.text(req.query.search, "search", 80).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = ["networkId", "details.businessName", "details.ownerName", "details.phone"].map(key => ({ [key]: new RegExp(search, "i") }));
  }
  output(res, { items: await M.Profile.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page(req) - 1) * 50).limit(50).lean(),
    total: await M.Profile.countDocuments(filter), page: page(req) });
});
exports.adminDetail = wrap(async (req, res) => output(res, { profile: await adminProfile(req) }));
exports.review = wrap(async (req, res) => {
  const reason = why(req);
  const result = await S.atomic(async session => {
    const profile = await adminProfile(req, session);
    if (revision(req.body.revision) !== profile.revision) P.fail("Application changed. Refresh before review.", "NETWORK_CONFLICT", 409);
    P.transition(profile, req.body.status);
    if (req.body.status === "APPROVED") {
      const owner = await User.findOne({ _id: profile.owner, role: "CUSTOMER", status: "ACTIVE", kycVerified: true }).session(session);
      if (!owner) P.fail("The Customer must be active with existing verified KYC before approval.", "NETWORK_KYC_REQUIRED", 409);
      profile.services = P.services(req.body.services || profile.services);
      await catalogue.validate(profile.services, profile.kind, await M.Settings.findById("network").session(session), { processing: true, session });
      if (profile.services.some(v => !profile.details.preferredServices.includes(v))) P.fail("Approve only services requested by the applicant.");
      // An approved product/logistics business need not receive bill-payment
      // authority. Empty services grants NO purchase attribution or commission.
      profile.group = P.text(req.body.group || profile.group, "commission group", 80, true);
      const now = new Date(); profile.approvedAt ||= now; profile.approvalWindows.push({ start: now, services: profile.services, group: profile.group });
    }
    if (req.body.status === "SUSPENDED") {
      const window = profile.approvalWindows[profile.approvalWindows.length - 1]; if (window && !window.end) window.end = new Date();
      await M.Staff.updateMany({ profile: profile._id, status: "ACTIVE" }, { $set: { status: "SUSPENDED" } }, { session });
    }
    profile.status = req.body.status; profile.feedback = reason; profile.revision += 1;
    await profile.save({ session }); await S.audit(req.user, "APPLICATION_" + profile.status, profile, reason, {}, session); return profile;
  });
  output(res, { profile: result });
});
exports.adminTransactions = wrap(async (req, res) => output(res, await S.transactions({ profile: { $in: await profileIds(req) } }, { ...req.query, page: page(req) })));
exports.overview = wrap(async (req, res) => {
  const profiles = await M.Profile.find(await S.adminScope(req.user)).lean();
  const counter = kind => {
    const rows = profiles.filter(p => p.kind === kind);
    return { registered: rows.length, approved: rows.filter(p => p.approvedAt).length, active: rows.filter(p => p.status === "APPROVED").length,
      pending: rows.filter(p => ["SUBMITTED", "UNDER_REVIEW"].includes(p.status)).length, suspended: rows.filter(p => p.status === "SUSPENDED").length };
  };
  const filter = { profile: { $in: profiles.map(p => p._id) } };
  const locations = new Map();
  for (const p of profiles) {
    const key = `${p.details.state}|${p.details.lga}`;
    const current = locations.get(key) || { state: p.details.state, lga: p.details.lga, agents: 0, merchants: 0 };
    current[p.kind === "AGENT" ? "agents" : "merchants"] += 1; locations.set(key, current);
  }
  output(res, { agents: counter("AGENT"), merchants: counter("MERCHANT"),
    transactions: await S.summary(filter), commissions: (await S.commissionRows(filter)).totals, locations: [...locations.values()] });
});
exports.rules = wrap(async (_req, res) => output(res, { items: await M.Rule.find().sort({ createdAt: -1 }).limit(500).lean() }));
exports.createRule = wrap(async (req, res) => {
  const b = req.body;
  if (!P.billServices.includes(b.service) || !["FIXED", "PERCENT"].includes(b.mode)) P.fail("Invalid commission service or mode.");
  const data = { service: b.service, mode: b.mode, value: P.integer(b.value, "commission value", 0, b.mode === "PERCENT" ? 10000 : Number.MAX_SAFE_INTEGER),
    group: P.text(b.group || "STANDARD", "group", 80, true), state: P.text(b.state, "state", 100), lga: P.text(b.lga, "LGA", 100),
    minAmountKobo: P.integer(b.minAmountKobo ?? 0, "minimum amount"),
    maxAmountKobo: b.maxAmountKobo == null ? null : P.integer(b.maxAmountKobo, "maximum amount"),
    enabled: b.enabled !== false, createdBy: req.user._id };
  if (data.lga && !data.state) P.fail("An LGA-specific rule requires its State.");
  if (data.maxAmountKobo != null && data.maxAmountKobo < data.minAmountKobo) P.fail("Maximum amount is below minimum.");
  if (!data.enabled) data.disabledAt = new Date();
  const rule = await S.atomic(async session => {
    const [row] = await M.Rule.create([data], { session });
    await S.audit(req.user, "COMMISSION_RULE_CREATED", null, "", { rule: row._id }, session); return row;
  });
  output(res, { rule }, 201);
});
exports.disableRule = wrap(async (req, res) => {
  if (req.body.enabled !== false) P.fail("Rules are immutable. Disable this rule and create a replacement.");
  const rule = await S.atomic(async session => {
    const row = await M.Rule.findById(S.id(req.params.id)).session(session);
    if (!row) P.fail("Rule not found.", "NETWORK_NOT_FOUND", 404);
    row.enabled = false; row.disabledAt ||= new Date(); await row.save({ session });
    await S.audit(req.user, "COMMISSION_RULE_DISABLED", null, "", { rule: row._id }, session); return row;
  });
  output(res, { rule });
});
exports.adminCommissions = wrap(async (req, res) => output(res, await S.commissionRows({ profile: { $in: await profileIds(req) } }, req.query)));
exports.settle = wrap(async (req, res) => {
  const b = req.body, reason = why(req);
  if (b.confirmation !== true) P.fail("Confirm the completed manual company-bank transfer. This endpoint sends no money.");
  const reference = P.text(b.reference, "bank transfer reference", 160, true);
  const paidAt = new Date(b.paidAt);
  if (!b.paidAt || Number.isNaN(paidAt.getTime()) || paidAt > new Date()) P.fail("Provide a valid completed payment date.");
  if (!Array.isArray(b.commissionIds) || !b.commissionIds.length || b.commissionIds.length > 100 || new Set(b.commissionIds).size !== b.commissionIds.length) P.fail("Select between 1 and 100 distinct commission entries.");
  const profileId = S.id(b.profileId), ids = b.commissionIds.map(S.id);
  await S.reconcile([profileId]);
  const result = await S.atomic(async session => {
    const priorSettlement = await M.Settlement.findOne({ reference }).session(session);
    if (priorSettlement) {
      const same = String(priorSettlement.profile) === String(profileId) &&
        priorSettlement.commissionIds.map(String).sort().join(",") === ids.map(String).sort().join(",") &&
        priorSettlement.paidAt.getTime() === paidAt.getTime();
      if (!same) P.fail("Bank reference is already bound to a different settlement.", "NETWORK_CONFLICT", 409);
      return { recordedKobo: 0, idempotent: true, providerVerified: false, moneySent: false };
    }
    const profile = await M.Profile.findOneAndUpdate({ _id: profileId, kind: "AGENT", status: "APPROVED" }, { $inc: { revision: 1 } }, { new: true, session });
    if (!profile) P.fail("An active Agent is required.");
    if (!await User.exists({ _id: profile.owner, role: "CUSTOMER", status: "ACTIVE", kycVerified: true }).session(session))
      P.fail("The Agent's Customer account is restricted.", "NETWORK_FORBIDDEN", 403);
    const entries = await M.Ledger.find({ _id: { $in: ids }, profile: profileId, event: "ACCRUAL" }).session(session);
    if (entries.length !== ids.length) P.fail("Every selected commission must belong to this Agent.");
    let recordedKobo = 0;
    for (const entry of entries) {
      const prior = await M.Ledger.findOne({ eventKey: `settle:${entry.transaction}` }).session(session);
      if (prior) {
        P.fail("Commission is already settled. Refresh its statement.", "NETWORK_CONFLICT", 409);
      }
      const source = await Transaction.findById(entry.transaction).session(session).lean();
      if (!source || !P.confirmed(source) || await M.Ledger.exists({ eventKey: `reverse:${entry.transaction}` }).session(session)) P.fail("A selected commission is reversed or its source is no longer verified successful.", "NETWORK_CONFLICT", 409);
      await M.Ledger.create([{ eventKey: `settle:${entry.transaction}`, profile: profileId, transaction: entry.transaction,
        event: "SETTLEMENT", amountKobo: -entry.amountKobo, evidence: { actor: req.user._id, reference, paidAt, reason, confirmation: true, providerVerified: false } }], { session });
      recordedKobo += entry.amountKobo;
    }
    await M.Settlement.create([{ reference, profile: profileId, commissionIds: ids, amountKobo: recordedKobo,
      paidAt, actor: req.user._id, reason, providerVerified: false }], { session });
    await S.audit(req.user, "MANUAL_COMMISSION_SETTLEMENT_RECORDED", profile, reason, { recordedKobo, reference }, session);
    return { recordedKobo, providerVerified: false, moneySent: false };
  });
  output(res, result);
});
exports.adminReport = wrap(async (req, res) => {
  const rows = await S.transactions({ profile: { $in: await profileIds(req) } }, { ...req.query, page: 1, limit: 2000 });
  if (rows.total > 2000) P.fail("Choose a smaller report date range; exports are limited to 2,000 records.");
  res.type("text/csv").attachment("ServicePay-business-network.csv").send(P.csv(rows.items));
});
exports.audit = wrap(async (req, res) => {
  const filter = S.isHO(req.user) ? {} : { profile: { $in: await profileIds(req) } };
  output(res, { items: await M.Audit.find(filter).sort({ createdAt: -1 }).skip((page(req) - 1) * 50).limit(50).lean(),
    total: await M.Audit.countDocuments(filter), page: page(req) });
});
exports.settings = wrap(async (_req, res) => output(res, { categories: (await M.Settings.findById("network"))?.categories || new M.Settings().categories, features: P.features }));
exports.saveSettings = wrap(async (req, res) => {
  if (Object.keys(req.body).some(k => k !== "categories")) P.fail("Payment capabilities cannot be enabled through network settings.");
  if (!Array.isArray(req.body.categories) || req.body.categories.length < 1 || req.body.categories.length > 50) P.fail("Provide 1–50 business categories.");
  const categories = [...new Set(req.body.categories.map(x => P.text(x, "category", 100, true)))];
  await S.atomic(async session => {
    await M.Settings.updateOne({ _id: "network" }, { $set: { categories } }, { upsert: true, session });
    await S.audit(req.user, "NETWORK_SETTINGS_UPDATED", null, "", { categories }, session);
  });
  output(res, { categories, features: P.features });
});
exports.branches = wrap(async (req, res) => {
  const profile = await S.ownerProfile(req.user, req.params.id);
  output(res, { items: await M.Branch.find({ profile: profile._id }).sort({ name: 1 }).lean() });
});
exports.createBranch = wrap(async (req, res) => {
  const profile = await S.ownerProfile(req.user, req.params.id);
  const name = P.text(req.body.name, "branch name", 100, true), address = P.text(req.body.address, "branch address", 300, true);
  const branch = await S.atomic(async session => {
    const [row] = await M.Branch.create([{ profile: profile._id, name, address }], { session });
    await S.audit(req.user, "MERCHANT_BRANCH_CREATED", profile, "", { branch: row._id }, session); return row;
  });
  output(res, { branch }, 201);
});
exports.updateBranch = wrap(async (req, res) => {
  const profile = await S.ownerProfile(req.user, req.params.id);
  const fields = {};
  if (req.body.name !== undefined) fields.name = P.text(req.body.name, "branch name", 100, true);
  if (req.body.address !== undefined) fields.address = P.text(req.body.address, "branch address", 300, true);
  if (req.body.status !== undefined) {
    if (!["ACTIVE", "SUSPENDED"].includes(req.body.status)) P.fail("Invalid branch status.");
    fields.status = req.body.status;
  }
  if (!Object.keys(fields).length) P.fail("Provide a branch change.");
  const branch = await S.atomic(async session => {
    const row = await M.Branch.findOneAndUpdate({ _id: S.id(req.params.branchId), profile: profile._id },
      { $set: fields, $inc: { accessVersion: 1 } }, { returnDocument: "after", session });
    if (!row) P.fail("Branch not found.", "NETWORK_NOT_FOUND", 404);
    if (fields.status === "SUSPENDED") await M.Staff.updateMany({ profile: profile._id, branch: row._id, status: "ACTIVE" },
      { $set: { status: "SUSPENDED" } }, { session });
    await S.audit(req.user, "MERCHANT_BRANCH_UPDATED", profile, "", { branch: row._id, fields: Object.keys(fields) }, session); return row;
  });
  output(res, { branch });
});
exports.staff = wrap(async (req, res) => {
  const profile = await S.ownerProfile(req.user, req.params.id);
  output(res, { items: await M.Staff.find({ profile: profile._id }).lean() });
});
exports.inviteStaff = wrap(async (req, res) => {
  const profile = await S.ownerProfile(req.user, req.params.id);
  const user = S.id(req.body.userId), branch = S.id(req.body.branchId), permissions = req.body.permissions;
  if (String(user) === String(profile.owner)) P.fail("The business owner already has access.");
  if (!Array.isArray(permissions) || !permissions.length || permissions.some(v => !["reports", "payments"].includes(v))) P.fail("Select only branch reporting and/or own-wallet payment permissions.");
  if (!await User.exists({ _id: user, role: "CUSTOMER", status: "ACTIVE" }) || !await M.Branch.exists({ _id: branch, profile: profile._id, status: "ACTIVE" })) P.fail("An active Customer and an active branch in this business are required.");
  const staff = await S.atomic(async session => {
    const [row] = await M.Staff.create([{ profile: profile._id, user, branch, permissions: [...new Set(permissions)] }], { session });
    await S.audit(req.user, "MERCHANT_STAFF_INVITED", profile, "", { membership: row._id }, session); return row;
  });
  output(res, { staff }, 201);
});
exports.staffStatus = wrap(async (req, res) => {
  if (!["SUSPENDED", "INVITED"].includes(req.body.status)) P.fail("Access changes must suspend staff or request fresh invitation consent.");
  const row = await M.Staff.findById(S.id(req.params.id));
  if (!row) P.fail("Membership not found.", "NETWORK_NOT_FOUND", 404);
  const profile = await S.ownerProfile(req.user, String(row.profile));
  const fields = { status: req.body.status };
  if (fields.status === "INVITED") {
    const permissions = req.body.permissions;
    if (!Array.isArray(permissions) || !permissions.length || permissions.some(v => !["reports", "payments"].includes(v))) P.fail("Select only restricted branch permissions.");
    const branch = S.id(req.body.branchId);
    if (!await M.Branch.exists({ _id: branch, profile: profile._id, status: "ACTIVE" }) ||
      !await User.exists({ _id: row.user, role: "CUSTOMER", status: "ACTIVE" })) P.fail("An active Customer and branch are required.");
    fields.branch = branch; fields.permissions = [...new Set(permissions)];
  }
  await S.atomic(async session => {
    await M.Staff.updateOne({ _id: row._id }, { $set: fields }, { session });
    await S.audit(req.user, "MERCHANT_STAFF_" + fields.status, profile, "", { membership: row._id }, session);
  });
  output(res, { status: fields.status });
});
exports.acceptStaff = wrap(async (req, res) => {
  const staff = await S.atomic(async session => {
    const row = await M.Staff.findOne({ _id: S.id(req.params.id), user: req.user._id, status: "INVITED" }).session(session);
    if (!row || !await M.Profile.findOneAndUpdate({ _id: row.profile, status: "APPROVED" }, { $inc: { revision: 1 } }, { session }) ||
      !await M.Branch.findOneAndUpdate({ _id: row.branch, profile: row.profile, status: "ACTIVE" }, { $inc: { accessVersion: 1 } }, { session }))
      P.fail("No active invitation is available.", "NETWORK_NOT_FOUND", 404);
    row.status = "ACTIVE"; await row.save({ session });
    await S.audit(req.user, "MERCHANT_STAFF_ACCEPTED", { _id: row.profile }, "", { membership: row._id }, session); return row;
  });
  output(res, { staff });
});
exports.errors = (error, _req, res, _next) => {
  const duplicate = error.code === 11000;
  const status = error.status || (duplicate ? 409 : 500);
  if (status === 500) console.error(JSON.stringify({ event: "business_network.request.failed", code: typeof error.code === "number" ? error.code : "INTERNAL" }));
  res.status(status).json({ success: false, code: duplicate ? "NETWORK_CONFLICT" : error.code || "NETWORK_INTERNAL",
    message: duplicate ? "This record already exists. Refresh before retrying." : status === 500 ? "Business Network is temporarily unavailable." : error.message });
};
