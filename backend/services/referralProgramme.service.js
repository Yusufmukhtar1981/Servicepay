const mongoose = require("mongoose");
const AppSettings = require("../models/appSettings.model");
const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const LedgerEntry = require("../models/ledgerEntry.model");
const { postCredit, postDebit } = require("./ledger.service");

const VERSION = 2;
// Funding, transfers, withdrawals, refunds and incentive credits cannot be enabled.
const SUPPORTED_SERVICES = Object.freeze([
  "AIRTIME", "DATA", "ELECTRICITY", "CABLE", "EXAM_PIN", "DELIVERY",
  "MARKETPLACE", "ID_VERIFICATION", "EDUPAY", "INTERSTATE_LOGISTICS",
]);
const DEFAULTS = Object.freeze({
  version: VERSION, enabled: false, activatedAt: null, registrationBonus: 100,
  transactionCommission: 1, eligibleServices: SUPPORTED_SERVICES,
  verification: "VERIFIED_CONTACT", revision: 0,
});
const read = (query, session) => session ? query.session(session) : query;
const plain = (value) => value?.toObject ? value.toObject() : value;
const same = (a, b) => String(a || "") === String(b || "");
const keyFor = (kind, sourceId) => `referral-v2:${kind}:${sourceId}`;
const money = (value) => Math.round(Number(value) * 100) / 100;
const baseFilter = { service: { $in: ["REFERRAL_BONUS", "REFERRAL_BONUS_REVERSAL"] }, "metadata.referralPolicyVersion": VERSION };

async function policy(session = null) {
  const settings = await read(AppSettings.findOne({ key: "GLOBAL_SETTINGS" })
    .select("referralProgramme").lean(), session);
  return settings?.referralProgramme
    ? { ...plain(settings.referralProgramme), verification: "VERIFIED_CONTACT" }
    : { ...DEFAULTS };
}

async function readiness() {
  const blockers = [];
  for (const [name, model, key] of [
    ["wallet ledger idempotency", LedgerEntry, { idempotencyKey: 1 }],
    ["reward transaction reference", Transaction, { reference: 1 }],
    ["referral outbox idempotency", require("../models/referralRewardReconciliation.model"), { key: 1 }],
    ["global settings identity", AppSettings, { key: 1 }],
  ]) {
    try {
      const indexes = await model.collection.indexes();
      if (!indexes.some((index) => index.unique === true &&
        !index.partialFilterExpression && !index.sparse &&
        JSON.stringify(index.key) === JSON.stringify(key))) blockers.push(`Missing required unique ${name} index`);
    } catch (_) { blockers.push(`Cannot verify ${name} index`); }
  }
  try {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    if (!hello.logicalSessionTimeoutMinutes || (!hello.setName && hello.msg !== "isdbgrid")) {
      blockers.push("MongoDB multi-document transactions are required");
    }
  } catch (_) { blockers.push("Cannot verify MongoDB transaction support"); }
  return { ready: blockers.length === 0, blockers };
}

function validateConfiguration(input) {
  if (typeof input.enabled !== "boolean") throw new Error("enabled must be true or false");
  for (const name of ["registrationBonus", "transactionCommission"]) {
    const value = input[name];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 ||
      value > 1000000 || money(value) !== value) throw new Error(`${name} must be a valid naira amount with at most two decimal places`);
  }
  if (!Array.isArray(input.eligibleServices) || input.eligibleServices.length > SUPPORTED_SERVICES.length ||
    input.eligibleServices.some((name) => !SUPPORTED_SERVICES.includes(name)) ||
    new Set(input.eligibleServices).size !== input.eligibleServices.length) {
    throw new Error("Only supported paid services may earn a commission");
  }
  if (String(input.reason || "").trim().length < 10 || String(input.reason).length > 500) {
    throw new Error("A reason between 10 and 500 characters is required");
  }
}

async function configure(input, actor) {
  validateConfiguration(input);
  const checks = await readiness();
  if (input.enabled && !checks.ready) {
    const error = new Error(checks.blockers.join("; ")); error.status = 409; throw error;
  }
  return atomic(async (session) => {
    const existing = await policy(session);
    const activatedAt = existing.activatedAt || (input.enabled ? new Date() : null);
    const next = {
      version: VERSION, enabled: input.enabled, activatedAt,
      registrationBonus: input.registrationBonus, transactionCommission: input.transactionCommission,
      eligibleServices: input.eligibleServices, revision: existing.revision + 1, updatedBy: actor._id,
    };
    // Existing settings only: configuration must not silently create a partial global document.
    const updated = await AppSettings.findOneAndUpdate(
      { key: "GLOBAL_SETTINGS" }, { $set: { referralProgramme: next } }, { new: true, session, runValidators: true },
    );
    if (!updated) throw new Error("Global settings must exist before referral programme configuration");
    await require("../models/adminAuditLog.model").create([{
      actorId: actor._id, actorRole: actor.role, action: "SYSTEM_SETTING_UPDATED",
      reason: input.reason.trim(),
      metadata: { setting: "referralProgramme", before: existing, after: next, reason: input.reason.trim() },
    }], { session });
    return { ...next, verification: "VERIFIED_CONTACT" };
  });
}

async function atomic(work) {
  // withTransaction handles transient writes and ambiguous commit results without
  // opening an unsafe non-transactional fallback.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const session = await mongoose.startSession();
    try {
      let result;
      await session.withTransaction(async () => { result = await work(session); });
      return result;
    } catch (error) {
      if (error.code !== 11000 || attempt === 2) throw error;
    } finally { await session.endSession(); }
  }
}

function verified(customer) {
  return customer?.role === "CUSTOMER" && customer.status === "ACTIVE" &&
    (customer.phoneVerified === true || customer.emailVerified === true);
}
function eligibleTransaction(row, programme) {
  return row && programme.activatedAt && row.createdAt >= new Date(programme.activatedAt) &&
    SUPPORTED_SERVICES.includes(row.serviceType) && programme.eligibleServices.includes(row.serviceType) &&
    Number(row.amount) > 0 && row.status === "SUCCESSFUL" &&
    !row.reversalReference && !row.reversalTransactionId && !row.reversedTransactionId &&
    !row.reversalLedgerEntryId && !["FAILED", "REFUNDED"].includes(row.dispatchStatus);
}

async function evidence({ sourceType, sourceId }, programme, session) {
  if (sourceType === "REGISTRATION") {
    const customer = await read(User.findById(sourceId)
      .select("_id role status referredBy createdAt referralCapturedAt phoneVerified emailVerified").lean(), session);
    const afterActivation = customer?.createdAt >= new Date(programme.activatedAt) &&
      customer?.referralCapturedAt >= new Date(programme.activatedAt);
    return { customer, valid: !!programme.activatedAt && afterActivation && verified(customer),
      kind: "REGISTRATION", reference: "", sourceId, amount: programme.registrationBonus };
  }
  let row;
  if (sourceType === "DELIVERY") {
    const order = await read(require("../models/delivery.model").findById(sourceId).lean(), session);
    // Delivery controllers already emit the canonical order identity. It is
    // rewarded only after fulfilment, not merely after an admission debit.
    const customer = order && await read(User.findById(order.customerId).lean(), session);
    return { customer, kind: "TRANSACTION", sourceId, sourceType,
      reference: order?.trackingNumber || "", amount: programme.transactionCommission,
      valid: !!programme.activatedAt && programme.eligibleServices.includes("DELIVERY") &&
        order?.createdAt >= new Date(programme.activatedAt) && Number(order?.deliveryFee) > 0 &&
        order?.status === "DELIVERED" && order.paymentStatus === "PAID" && !order.refundedAt };
  }
  if (sourceType === "MARKETPLACE") {
    const order = await read(require("../models/marketplaceOrder.model").findById(sourceId).lean(), session);
    const customer = order && await read(User.findById(order.buyer).lean(), session);
    // Use the transaction ID when available, so an order and its debit cannot
    // become separate commissions. Marketplace transaction events are skipped.
    return { customer, kind: "TRANSACTION", sourceId: order?.transaction || sourceId, sourceType,
      reference: order?.orderReference || "", amount: programme.transactionCommission,
      valid: !!programme.activatedAt && programme.eligibleServices.includes("MARKETPLACE") &&
        order?.createdAt >= new Date(programme.activatedAt) && Number(order?.totalAmount) > 0 &&
        order?.orderStatus === "DELIVERED" && order.paymentStatus === "PAID" &&
        order.fundsStatus !== "REFUNDED" && !order.refundedAt };
  }
  row = await read(Transaction.findById(sourceId).lean(), session);
  const customer = row && await read(User.findById(row.customerId).lean(), session);
  return { customer, kind: "TRANSACTION", sourceId, sourceType: "TRANSACTION",
    reference: row?.reference || "", amount: programme.transactionCommission,
    valid: eligibleTransaction(row, programme) && !["DELIVERY", "MARKETPLACE"].includes(row?.serviceType) };
}

async function reconcile(args) {
  return atomic(async (session) => {
    const programme = await policy(session);
    if (!programme.activatedAt) return { skipped: true, reason: "NOT_ACTIVATED" };
    const source = await evidence(args, programme, session);
    const customer = source.customer;
    const key = keyFor(source.kind, source.sourceId);
    const awarded = await LedgerEntry.findOne({ idempotencyKey: key }).session(session).lean();
    if (awarded) {
      // A later contact edit is not evidence that a completed verified
      // registration was fraudulent. Only transaction outcomes are reversible.
      if (source.kind === "REGISTRATION") return { awarded: true, duplicate: true };
      // Disabling a programme or a service never confiscates earned rewards.
      // Only a changed canonical source outcome authorizes a compensating debit.
      const originalPolicy = { ...programme, eligibleServices: SUPPORTED_SERVICES };
      const current = await evidence(args, originalPolicy, session);
      if (current.valid) return { awarded: true, duplicate: true };
      return reverse(awarded, session);
    }
    if (!programme.enabled || !source.valid || !customer?.referredBy ||
      same(customer._id, customer.referredBy) || Number(source.amount) <= 0) {
      return { skipped: true, reason: "NOT_ELIGIBLE" };
    }
    const referrer = await User.findOneAndUpdate(
      { _id: customer.referredBy, role: "CUSTOMER", status: "ACTIVE" },
      { $inc: { walletBalance: source.amount } }, { new: true, session },
    ).select("_id walletBalance");
    if (!referrer) return { skipped: true, reason: "REFERRER_UNAVAILABLE" };
    const reference = `REFERRAL-V2-${source.kind}-${source.sourceId}`;
    const reward = (await Transaction.create([{
      reference, customerId: referrer._id, amount: source.amount, serviceType: "REFERRAL_BONUS",
      status: "SUCCESSFUL", provider: "SERVICEPAY_REFERRAL",
      providerResponse: { policy: "REFERRAL_REWARD_V2", rewardType: source.kind },
    }], { session }))[0];
    const ledger = await postCredit({
      userId: referrer._id, amount: source.amount,
      openingBalance: money(referrer.walletBalance - source.amount), closingBalance: money(referrer.walletBalance),
      service: "REFERRAL_BONUS", reference, idempotencyKey: key, transactionId: reward._id,
      relatedUser: customer._id, narration: source.kind === "REGISTRATION" ? "Verified referral registration bonus" : "Successful transaction referral commission",
      metadata: { referralPolicyVersion: VERSION, rewardType: source.kind,
        sourceType: args.sourceType, sourceId: String(args.sourceId), sourceReference: source.reference,
        canonicalSourceId: String(source.sourceId), revision: programme.revision, activatedAt: programme.activatedAt },
      session,
    });
    return { awarded: true, duplicate: false, reference, amount: source.amount, ledgerId: ledger.entry._id };
  });
}

async function reverse(award, session) {
  const key = `${award.idempotencyKey}:reversal`;
  if (await LedgerEntry.exists({ idempotencyKey: key }).session(session)) return { reversed: true, duplicate: true };
  const amount = award.amount;
  const user = await User.findOneAndUpdate(
    { _id: award.user, walletBalance: { $gte: amount } },
    { $inc: { walletBalance: -amount } }, { new: true, session },
  ).select("_id walletBalance");
  if (!user) {
    // Throwing keeps the durable source job pending. Never debit below zero or
    // free the original idempotency key for another award.
    throw new Error("Referral reversal pending: insufficient available balance");
  }
  const reference = `${award.reference}-REVERSAL`;
  const transaction = (await Transaction.create([{
    reference, customerId: award.user, amount, serviceType: "REFERRAL_BONUS_REVERSAL",
    status: "SUCCESSFUL", provider: "SERVICEPAY_REFERRAL", providerResponse: { originalReward: String(award.transactionId) },
  }], { session }))[0];
  await postDebit({
    userId: award.user, amount, openingBalance: money(user.walletBalance + amount), closingBalance: money(user.walletBalance),
    service: "REFERRAL_BONUS_REVERSAL", reference, idempotencyKey: key, transactionId: transaction._id,
    relatedUser: award.relatedUser, reversalOf: award._id,
    narration: "Referral reward reversed after source became ineligible",
    metadata: { ...award.metadata, originalReward: String(award._id) }, session,
  });
  return { reversed: true, duplicate: false, reference };
}

async function totals(filter = {}) {
  const [v2, legacy] = await Promise.all([
    LedgerEntry.aggregate([
      { $match: { ...baseFilter, ...filter } },
      { $group: { _id: "$metadata.rewardType", amount: {
        $sum: { $cond: [{ $eq: ["$direction", "CREDIT"] }, "$amount", { $multiply: ["$amount", -1] }] },
      } } },
    ]),
    LedgerEntry.aggregate([
      { $match: { service: baseFilter.service, "metadata.referralPolicyVersion": { $ne: VERSION }, ...filter } },
      { $group: { _id: null, amount: { $sum: {
        $cond: [{ $eq: ["$direction", "CREDIT"] }, "$amount", { $multiply: ["$amount", -1] }],
      } } } },
    ]),
  ]);
  const registrationBonusesEarned = v2.find((row) => row._id === "REGISTRATION")?.amount || 0;
  const transactionCommissionsEarned = v2.find((row) => row._id === "TRANSACTION")?.amount || 0;
  return { registrationBonusesEarned, transactionCommissionsEarned,
    totalReferralEarnings: money(registrationBonusesEarned + transactionCommissionsEarned),
    legacyRewards: legacy[0]?.amount || 0 };
}

const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "";
function presentLedger(row, admin = false) {
  const identity = (user) => admin ? {
    id: user?._id, fullName: user?.fullName || "", phone: user?.phone || "", referralCode: user?.referralCode || "",
  } : { firstName: firstName(user?.fullName) };
  return {
    id: row._id, reference: row.reference, date: row.createdAt, amount: row.amount,
    direction: row.direction, rewardType: row.metadata?.rewardType,
    sourceReference: row.metadata?.sourceReference || "",
    referredCustomer: identity(row.relatedUser), ...(admin ? { referrer: identity(row.user) } : {}),
  };
}

async function customerSummary(customerId, options = {}) {
  const user = new mongoose.Types.ObjectId(String(customerId));
  const historyPage = Math.min(Math.max(Math.floor(Number(options.historyPage)) || 1, 1), 100000);
  const historyLimit = Math.min(Math.max(Math.floor(Number(options.historyLimit)) || 50, 1), 100);
  const [programme, summary, rows, customers, historyTotal] = await Promise.all([
    policy(), totals({ user }),
    LedgerEntry.find({ ...baseFilter, user }).sort({ createdAt: -1, _id: -1 })
      .skip((historyPage - 1) * historyLimit).limit(historyLimit)
      .populate("relatedUser", "fullName").lean(),
    User.find({ referredBy: user, role: "CUSTOMER" })
      .select("_id fullName createdAt status emailVerified phoneVerified").sort({ createdAt: -1, _id: -1 }).lean(),
    LedgerEntry.countDocuments({ ...baseFilter, user }),
  ]);
  const grouped = await LedgerEntry.aggregate([
    { $match: { ...baseFilter, user } },
    { $group: { _id: { customer: "$relatedUser", type: "$metadata.rewardType" },
      amount: { $sum: { $cond: [{ $eq: ["$direction", "CREDIT"] }, "$amount", { $multiply: ["$amount", -1] }] } },
      count: { $sum: { $cond: [{ $eq: ["$direction", "CREDIT"] }, 1, -1] } } } },
  ]);
  const referrals = customers.map((row) => {
    const entries = grouped.filter((item) => same(item._id.customer, row._id));
    const registration = entries.find((item) => item._id.type === "REGISTRATION");
    const commission = entries.find((item) => item._id.type === "TRANSACTION");
    return { id: row._id, firstName: firstName(row.fullName), joinedAt: row.createdAt, status: row.status,
      verified: verified(row), successfulTransactions: commission?.count || 0,
      registrationBonusEarned: registration?.amount || 0, transactionCommissionsEarned: commission?.amount || 0,
      rewardStatus: registration?.amount > 0 ? "AWARDED" : "NOT_ISSUED" };
  });
  return { programme, ...summary, history: rows.map((row) => presentLedger(row)),
    historyLimit, historyPage, historyTotal, historyPages: Math.ceil(historyTotal / historyLimit),
    referrals, referredCount: referrals.length, totalReferrals: referrals.length,
    qualifiedReferrals: referrals.filter((row) => row.verified).length,
    pendingReferrals: referrals.filter((row) => !row.verified).length,
    totalReferralRewards: money(summary.totalReferralEarnings + summary.legacyRewards),
    rewardProgramStatus: programme.enabled ? "CONFIGURED" : "DISABLED",
    rewardPolicy: { ...programme, categories: {} } };
}

module.exports = {
  VERSION, DEFAULTS, SUPPORTED_SERVICES, baseFilter, policy, readiness, configure,
  validateConfiguration, verified, eligibleTransaction, reconcile, totals, presentLedger, customerSummary,
};
