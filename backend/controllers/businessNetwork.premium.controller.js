"use strict";
const S = require("../services/businessNetwork.service");
const B = require("../services/businessNetwork.premium");
const C = require("../services/businessNetwork.catalogue");
const V = require("../services/businessNetwork.vouchers");
const { M, P, User } = S;
const { wrap } = require("./businessNetwork.controller");
const out = (res, data, status = 200) => res.status(status).json({ success: true, data });
async function owner(req, session) {
  const result = await S.profileFor(req.user, P.kind(req.params.kind), { profileId: req.query.profileId, session });
  if (String(result.profile.owner) !== String(req.user._id)) P.fail("Only the business owner can manage private business tools.", "NETWORK_FORBIDDEN", 403);
  return result.profile;
}
exports.catalogue = wrap(async (_req, res) => out(res, { serviceCatalogue: await C.catalogue(await M.Settings.findById("network")),
  features: P.features, capabilityReasons: B.capabilityReasons, voucherContract: V.contract }));
exports.settings = wrap(async (_req, res) => {
  const row = await M.Settings.findById("network");
  out(res, { ...B.settings(row), revision: row?.revision || 0, features: P.features, capabilityReasons: B.capabilityReasons,
    serviceCatalogue: await C.catalogue(row), voucherContract: V.contract });
});
exports.configure = wrap(async (req, res) => {
  if (Object.keys(req.body).some(k => !["configuration", "revision", "reason"].includes(k))) P.fail("Unsupported settings field.");
  const reason = P.text(req.body.reason, "configuration reason", 500, true);
  const revision = P.integer(req.body.revision, "settings revision");
  const result = await S.atomic(async session => {
    let doc = await M.Settings.findById("network").session(session);
    if ((doc?.revision || 0) !== revision) P.fail("Settings changed. Refresh before saving.", "NETWORK_CONFLICT", 409);
    const premium = B.configure(req.body.configuration, B.settings(doc));
    if (!doc) doc = new M.Settings({ _id: "network" });
    doc.premium = premium; doc.revision = revision + 1;
    await doc.save({ session });
    await S.audit(req.user, "PREMIUM_CONFIGURATION_CHANGED", null, reason, { revision: doc.revision, changed: Object.keys(req.body.configuration) }, session);
    return { ...B.settings(doc), revision: doc.revision };
  });
  out(res, result);
});
exports.tools = wrap(async (req, res) => {
  const profile = await owner(req);
  const config = B.settings(await M.Settings.findById("network"));
  const period = req.query.period || "month";
  const stats = (await B.performance([profile._id], period))[0] || { transactions: 0, volumeKobo: 0 };
  const lifetime = (await B.performance([profile._id]))[0] || { transactions: 0, volumeKobo: 0 };
  const peers = await M.Profile.find({ kind: profile.kind, status: "APPROVED" }).select("_id").lean();
  const ranking = (await B.performance(peers.map(row => row._id), period)).sort((a, b) =>
    b.transactions - a.transactions || b.volumeKobo - a.volumeKobo || a.profileId.localeCompare(b.profileId));
  const rank = ranking.findIndex(row => row.profileId === String(profile._id));
  const [expenses] = await M.Audit.aggregate([{ $match: { profile: profile._id, action: "BUSINESS_EXPENSE_RECORDED", createdAt: { $gte: B.start(period) } } },
    { $group: { _id: null, amountKobo: { $sum: "$metadata.amountKobo" }, count: { $sum: 1 } } }]);
  const [commission] = await M.Ledger.aggregate([{ $match: { profile: profile._id, event: { $in: ["ACCRUAL", "REVERSAL"] }, createdAt: { $gte: B.start(period) } } },
    { $group: { _id: null, incomeKobo: { $sum: "$amountKobo" } } }]);
  const bestSellingServices = await M.Activity.aggregate([
    { $match: { profile: profile._id } },
    { $lookup: { from: S.Transaction.collection.name, localField: "transaction", foreignField: "_id", as: "source" } },
    { $unwind: "$source" }, { $match: { ...B.sourceMatch(), "source.createdAt": { $gte: B.start(period) } } },
    { $group: { _id: "$source.serviceType", count: { $sum: 1 }, amount: { $sum: "$source.amount" } } },
    { $sort: { count: -1, _id: 1 } },
  ]);
  const transactionSummary = await S.summary({ profile: profile._id }, { from: B.start(period) });
  const goals = await Promise.all(config.goals.filter(g => g.kind === profile.kind).map(async g => {
    const current = (await B.performance([profile._id], g.period))[0] || { transactions: 0, volumeKobo: 0 };
    return { ...g, current, completed: current.transactions >= g.targetTransactions && current.volumeKobo >= g.targetVolumeKobo };
  }));
  const user = await User.findById(req.user._id).select("referralCode").lean();
  out(res, { profileId: profile._id, networkId: profile.networkId, kind: profile.kind, period, stats, lifetime,
    expenses: expenses || { amountKobo: 0, count: 0 }, transactionSummary,
    ranking: { rank: rank === -1 ? null : rank + 1, participants: ranking.length, metric: "Verified successful business purchases", period },
    commissionIncomeKobo: commission?.incomeKobo || 0,
    netCommissionAfterExpensesKobo: (commission?.incomeKobo || 0) - (expenses?.amountKobo || 0),
    bestSellingServices: bestSellingServices.map(row => ({ service: row._id, count: row.count, volumeKobo: P.kobo(row.amount) })),
    salesRevenueKobo: null, revenueDescription: "Verified purchase volume is not customer resale revenue. Commission income and manual expenses are reported separately.",
    loyalty: await B.loyaltyStatement(profile._id), goals,
    levels: config.levels.map(level => ({ ...level, qualified: level.enabled && lifetime.transactions >= level.minTransactions && lifetime.volumeKobo >= level.minVolumeKobo,
      assigned: profile.level === level.code })),
    campaigns: config.campaigns.filter(row => row.kind === profile.kind && row.enabled && new Date(row.startsAt) <= new Date() && new Date(row.endsAt) > new Date()),
    referralCode: user?.referralCode || null, referralRewardAuthority: "Existing ServicePay referral programme; no duplicate rewards created.",
    publicProfile: profile.publicProfile === true,
    publicProfilePath: profile.publicProfile ? `/api/business-network/public/${encodeURIComponent(profile.networkId)}` : null,
    features: P.features, capabilityReasons: B.capabilityReasons,
    voucherContract: V.contract,
    pricingDescription: "Purchase prices come from existing secure service quotes. Verified commission is separate from the price charged.",
  });
});
exports.directory = wrap(async (req, res) => out(res, { items: (await owner(req)).directory || [] }));
exports.saveCustomer = wrap(async (req, res) => {
  if (Object.keys(req.body).some(k => !["name", "phone", "email", "consentAcknowledged"].includes(k))) P.fail("Unsupported directory field.");
  if (req.body.consentAcknowledged !== true) P.fail("Customer consent is required before saving contact details.");
  const contact = { name: P.text(req.body.name, "customer name", 120, true),
    phone: P.text(req.body.phone, "phone", 20, true).replace(/[\s()-]/g, ""),
    email: P.text(req.body.email, "email", 160), consentAt: new Date() };
  if (!/^\+?\d{10,15}$/.test(contact.phone)) P.fail("Enter a valid customer phone.");
  if (contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) P.fail("Enter a valid contact email.");
  const profile = await S.atomic(async session => {
    const profile = await owner(req, session);
    if (profile.directory.some(row => row.phone === contact.phone)) P.fail("This phone is already in your directory.", "NETWORK_CONFLICT", 409);
    if (profile.directory.length >= 200) P.fail("The directory is limited to 200 consented contacts.");
    profile.directory.push(contact); profile.revision += 1; await profile.save({ session });
    await S.audit(req.user, "BUSINESS_CONTACT_SAVED", profile, "Customer consent confirmed", { record: profile.directory[profile.directory.length - 1]._id }, session);
    return profile;
  });
  out(res, { items: profile.directory }, 201);
});
exports.deleteCustomer = wrap(async (req, res) => {
  const id = S.id(req.params.contactId);
  await S.atomic(async session => {
    const profile = await owner(req, session);
    if (!profile.directory.id(id)) P.fail("Contact not found.", "NETWORK_NOT_FOUND", 404);
    profile.directory.pull({ _id: id }); profile.revision += 1; await profile.save({ session });
    await S.audit(req.user, "BUSINESS_CONTACT_REMOVED", profile, "Owner removed consented directory contact", { record: id }, session);
  });
  out(res, { removed: true });
});
exports.expenses = wrap(async (req, res) => {
  const profile = await owner(req);
  out(res, { items: await M.Audit.find({ profile: profile._id, action: "BUSINESS_EXPENSE_RECORDED" }).sort({ createdAt: -1 }).limit(200)
    .select("metadata.amountKobo metadata.description metadata.reference createdAt").lean(), walletDebit: false });
});
exports.recordExpense = wrap(async (req, res) => {
  if (Object.keys(req.body).some(k => !["amountKobo", "description", "reference", "idempotencyKey"].includes(k))) P.fail("Unsupported expense field.");
  const metadata = { amountKobo: P.integer(req.body.amountKobo, "expense amount", 1),
    description: P.text(req.body.description, "description", 300, true), reference: P.text(req.body.reference, "receipt reference", 100),
    key: P.text(req.body.idempotencyKey, "request key", 100, true), walletDebit: false };
  const result = await S.atomic(async session => {
    const profile = await owner(req, session);
    await M.Profile.updateOne({ _id: profile._id }, { $inc: { revision: 1 } }, { session });
    const existing = await M.Audit.findOne({ profile: profile._id, action: "BUSINESS_EXPENSE_RECORDED", "metadata.key": metadata.key }).session(session);
    if (existing) {
      if (["amountKobo", "description", "reference"].some(key => existing.metadata[key] !== metadata[key]))
        P.fail("This request key belongs to different expense details.", "NETWORK_CONFLICT", 409);
      return { expense: existing, idempotent: true, walletDebit: false };
    }
    const [expense] = await M.Audit.create([{ actor: req.user._id, profile: profile._id, action: "BUSINESS_EXPENSE_RECORDED",
      reason: "Manual bookkeeping only; no money moved", metadata }], { session });
    return { expense, walletDebit: false };
  });
  out(res, result);
});
exports.publish = wrap(async (req, res) => {
  if (typeof req.body.enabled !== "boolean" || req.body.consentAcknowledged !== true) P.fail("Explicit owner consent is required to change public profile visibility.");
  await S.atomic(async session => {
    const profile = await owner(req, session);
    profile.publicProfile = req.body.enabled; profile.revision += 1; await profile.save({ session });
    await S.audit(req.user, req.body.enabled ? "BUSINESS_PROFILE_PUBLISHED" : "BUSINESS_PROFILE_UNPUBLISHED", profile,
      "Owner consent; only business name, category and general location are public", {}, session);
  });
  out(res, { enabled: req.body.enabled });
});
exports.publicProfile = wrap(async (req, res) => {
  if (!/^SPN-[A-F0-9]{16}$/.test(req.params.networkId || "")) P.fail("Business profile not found.", "NETWORK_NOT_FOUND", 404);
  const profile = await M.Profile.findOne({ networkId: req.params.networkId, publicProfile: true, status: "APPROVED" })
    .select("networkId kind owner details.businessName details.businessCategory details.state details.lga").lean();
  if (!profile || !await User.exists({ _id: profile.owner, role: "CUSTOMER", status: "ACTIVE", kycVerified: true }))
    P.fail("Business profile not found.", "NETWORK_NOT_FOUND", 404);
  const escape = value => String(value || "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  res.set({ "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff" }).type("html").send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>ServicePay Business Profile</title><style>body{background:#f4f8f5;color:#18372a;font:18px system-ui;max-width:42rem;margin:3rem auto;padding:1rem}article{background:white;border-radius:1rem;padding:2rem}h1{color:#086344}</style><article><p>ServicePay verified business profile</p><h1>${escape(profile.details.businessName)}</h1><p>${escape(profile.kind)} · ${escape(profile.networkId)}</p><p>${escape(profile.details.businessCategory)}</p><p>${escape(profile.details.lga)}, ${escape(profile.details.state)}</p><p>This profile is informational. It is not a payment request, guarantee of a sale or authorization to transfer funds.</p></article></html>`);
});
exports.performance = wrap(async (req, res) => {
  const filter = await S.adminScope(req.user);
  const profiles = await M.Profile.find({ ...filter, status: "APPROVED", ...(req.query.kind ? { kind: P.kind(req.query.kind) } : {}) })
    .select("_id networkId kind details.businessName level").lean();
  const rows = await B.performance(profiles.map(p => p._id), req.query.period || "month");
  const byId = new Map(profiles.map(p => [String(p._id), p]));
  out(res, { items: rows.sort((a, b) => b.transactions - a.transactions || b.volumeKobo - a.volumeKobo)
    .map((r, i) => ({ ...r, rank: i + 1, profile: byId.get(r.profileId) })), period: req.query.period || "month" });
});
exports.level = wrap(async (req, res) => {
  const reason = P.text(req.body.reason, "level assignment reason", 500, true);
  const result = await S.atomic(async session => {
    const profile = await M.Profile.findOne({ _id: S.id(req.params.id), kind: "AGENT", status: "APPROVED" }).session(session);
    if (!profile || profile.revision !== P.integer(req.body.revision, "profile revision")) P.fail("Refresh the active Agent profile.", "NETWORK_CONFLICT", 409);
    await M.Profile.updateOne({ _id: profile._id }, { $inc: { revision: 1 } }, { session });
    const row = B.settings(await M.Settings.findById("network").session(session)).levels.find(l => l.code === req.body.level && l.enabled);
    const stats = (await B.performance([profile._id], "all", session))[0] || { transactions: 0, volumeKobo: 0 };
    if (!row || stats.transactions < row.minTransactions || stats.volumeKobo < row.minVolumeKobo)
      P.fail("This Agent has not met the configured level requirements.", "NETWORK_LEVEL_NOT_QUALIFIED", 409);
    if (!await User.exists({ _id: profile.owner, role: "CUSTOMER", status: "ACTIVE", kycVerified: true }).session(session))
      P.fail("Active verified Customer ownership is required.", "NETWORK_KYC_REQUIRED", 403);
    const now = new Date(), window = profile.approvalWindows[profile.approvalWindows.length - 1];
    if (window && !window.end) window.end = now;
    profile.approvalWindows.push({ start: now, services: profile.services, group: row.commissionGroup });
    profile.group = row.commissionGroup; profile.level = row.code; profile.revision += 1;
    await profile.save({ session });
    await S.audit(req.user, "AGENT_LEVEL_ASSIGNED", profile, reason, { level: row.code, qualification: stats }, session);
    return profile;
  });
  out(res, { profile: result });
});
exports.unavailable = wrap(async (req, _res) => {
  const reason = B.capabilityReasons[req.params.capability];
  P.fail(reason || "This provider capability has not been verified.", "NETWORK_CAPABILITY_DISABLED", 409);
});
exports.vouchers = wrap(async (req, res) => {
  await owner(req);
  out(res, { enabled: false, inventoryVerified: false, items: [], contract: V.contract,
    capabilityReasons: B.capabilityReasons, message: "No live voucher purchase or stock has been verified. No PINs are issued or exposed." });
});
exports.adminVouchers = wrap(async (_req, res) => out(res, { enabled: false, inventoryVerified: false, items: [],
  contract: V.contract, capabilityReasons: B.capabilityReasons }));
exports.loyaltyReport = wrap(async (req, res) => {
  const filter = await S.adminScope(req.user);
  if (req.query.kind) filter.kind = P.kind(req.query.kind);
  const rawPage = req.query.page || "1";
  if (!/^[1-9]\d{0,4}$/.test(rawPage)) P.fail("Invalid page.");
  const page = Number(rawPage);
  const profiles = await M.Profile.find(filter).sort({ _id: 1 }).skip((page - 1) * 25).limit(25)
    .select("_id networkId kind details.businessName").lean();
  out(res, { items: await Promise.all(profiles.map(async profile => ({ profile, ...(await B.loyaltyStatement(profile._id)) }))),
    page, total: await M.Profile.countDocuments(filter), cashValueKobo: 0, redemptionEnabled: false });
});
