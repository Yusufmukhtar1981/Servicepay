"use strict";
// Business-only metadata and non-cash loyalty journal. No payment controller,
// provider request, wallet update, new namespace or startup migration.
const { randomUUID } = require("node:crypto");
const S = require("./businessNetwork.service");
const { M, P } = S;
const C = require("./businessNetwork.catalogue");
const levelCodes = ["STARTER", "SILVER", "GOLD", "PLATINUM"];
function defaults() {
  return { businessServices: { AGENT: [...C.codes], MERCHANT: [...C.codes] },
    levels: levelCodes.map(code => ({ code, label: `${code[0]}${code.slice(1).toLowerCase()} Agent`,
      enabled: false, minTransactions: 0, minVolumeKobo: 0, commissionGroup: code })),
    loyalty: { enabled: false, pointsPerTransaction: 0, maxPointsPerCustomer: 0,
      expiryDays: 30, eligibleServices: [], effectiveFrom: null },
    goals: [], campaigns: [] };
}
function settings(doc) {
  const saved = doc?.premium || {};
  const initial = defaults();
  return { ...initial, ...saved, loyalty: { ...initial.loyalty, ...saved.loyalty } };
}
function object(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some(key => !fields.includes(key))) P.fail("Unsupported business configuration field.");
  return value;
}
function date(value, name) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value)))
    P.fail(`Invalid ${name}.`);
  return new Date(value);
}
function bool(value) { if (typeof value !== "boolean") P.fail("A true or false setting is required."); return value; }
function configure(input, previous) {
  object(input, ["businessServices", "levels", "loyalty", "goals", "campaigns"]);
  const result = structuredClone(previous);
  if (input.businessServices) {
    object(input.businessServices, P.kinds);
    for (const kind of P.kinds) if (input.businessServices[kind]) result.businessServices[kind] = C.preferences(input.businessServices[kind]);
  }
  if (input.levels) {
    if (!Array.isArray(input.levels) || input.levels.length !== 4 ||
        new Set(input.levels.map(x => x.code)).size !== 4) P.fail("Configure each of the four Agent levels exactly once.");
    result.levels = input.levels.map(row => {
      object(row, ["code", "label", "enabled", "minTransactions", "minVolumeKobo", "commissionGroup"]);
      if (!levelCodes.includes(row.code)) P.fail("Invalid Agent level.");
      const rule = { code: row.code, label: P.text(row.label, "level label", 80, true), enabled: bool(row.enabled),
        minTransactions: P.integer(row.minTransactions, "minimum transactions", 0, 100000000),
        minVolumeKobo: P.integer(row.minVolumeKobo, "minimum purchase volume"),
        commissionGroup: P.text(row.commissionGroup, "commission group", 80, true) };
      if (rule.enabled && !rule.minTransactions && !rule.minVolumeKobo) P.fail("An enabled level requires a nonzero qualification threshold.");
      return rule;
    });
  }
  if (input.loyalty) {
    object(input.loyalty, ["enabled", "pointsPerTransaction", "maxPointsPerCustomer", "expiryDays", "eligibleServices"]);
    const row = input.loyalty;
    const next = { enabled: bool(row.enabled),
      pointsPerTransaction: P.integer(row.pointsPerTransaction, "points per transaction", 0, 10000),
      maxPointsPerCustomer: P.integer(row.maxPointsPerCustomer, "maximum customer points", 0, 10000000),
      expiryDays: P.integer(row.expiryDays, "expiry days", 1, 3650), eligibleServices: P.services(row.eligibleServices) };
    if (next.enabled && (!next.pointsPerTransaction || next.maxPointsPerCustomer < next.pointsPerTransaction || !next.eligibleServices.length))
      P.fail("Loyalty requires approved positive points, an adequate cap and eligible bill services.");
    const old = { ...previous.loyalty }; delete old.effectiveFrom;
    next.effectiveFrom = JSON.stringify(old) === JSON.stringify(next) ? previous.loyalty.effectiveFrom : new Date();
    result.loyalty = next;
  }
  for (const type of ["goals", "campaigns"]) if (input[type]) {
    if (!Array.isArray(input[type]) || input[type].length > 30) P.fail("At most 30 goals or campaigns may be configured.");
    result[type] = input[type].map(row => {
      object(row, type === "goals" ? ["id", "title", "kind", "period", "targetTransactions", "targetVolumeKobo"] :
        ["id", "title", "kind", "description", "startsAt", "endsAt", "enabled"]);
      const common = { id: P.text(row.id || randomUUID(), "configuration ID", 80, true),
        title: P.text(row.title, "title", 150, true), kind: P.kind(row.kind) };
      if (type === "goals") {
        if (!["day", "week", "month"].includes(row.period)) P.fail("Invalid goal period.");
        const goal = { ...common, period: row.period, targetTransactions: P.integer(row.targetTransactions, "target transactions", 0, 1000000),
          targetVolumeKobo: P.integer(row.targetVolumeKobo, "target purchase volume") };
        if (!goal.targetTransactions && !goal.targetVolumeKobo) P.fail("A business goal requires a positive target.");
        return goal;
      }
      const start = date(row.startsAt, "campaign opening"), end = date(row.endsAt, "campaign closing");
      if (end <= start) P.fail("A campaign must close after it opens.");
      return { ...common, description: P.text(row.description, "campaign description", 2000, true),
        startsAt: start, endsAt: end, enabled: bool(row.enabled) };
    });
    if (new Set(result[type].map(row => row.id)).size !== result[type].length) P.fail("Configuration references must be unique.");
  }
  return result;
}
function sourceMatch() {
  return { "source.status": "SUCCESSFUL", "source.dispatchStatus": "SUCCEEDED",
    "source.debitLedgerEntryId": { $exists: true, $ne: null },
    ...Object.fromEntries(["reversalLedgerEntryId", "reversalTransactionId", "reversedTransactionId"].map(key => [`source.${key}`, null])),
    "source.reversalReference": { $in: [null, ""] },
    $expr: { $in: [{ $toUpper: { $ifNull: ["$source.providerStatus", ""] } }, ["SUCCESS", "SUCCESSFUL", "COMPLETED"]] } };
}
function start(period, now = Date.now()) {
  if (!["day", "week", "month", "all"].includes(period)) P.fail("Invalid business report period.");
  if (period === "all") return new Date(0);
  const d = new Date(now + 3600000);
  let boundary = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), period === "month" ? 1 : d.getUTCDate()));
  if (period === "week") boundary.setUTCDate(boundary.getUTCDate() - (boundary.getUTCDay() + 6) % 7);
  return new Date(boundary.getTime() - 3600000);
}
async function performance(profileIds, period = "all", session) {
  let q = M.Activity.aggregate([
    { $match: { profile: { $in: profileIds } } },
    { $lookup: { from: S.Transaction.collection.name, localField: "transaction", foreignField: "_id", as: "source" } },
    { $unwind: "$source" }, { $match: { ...sourceMatch(), "source.createdAt": { $gte: start(period) } } },
    { $group: { _id: "$profile", transactions: { $sum: 1 }, amount: { $sum: "$source.amount" } } },
  ]);
  if (session) q = q.session(session);
  return (await q).map(row => ({ profileId: String(row._id), transactions: row.transactions, volumeKobo: P.kobo(row.amount) }));
}
async function loyalty(activity, profile, tx, session) {
  const key = `loyalty:${tx._id}`;
  const previous = await M.Audit.findOne({ profile: profile._id, action: "LOYALTY_EARNED", "metadata.key": key }).session(session);
  if (previous) {
    if (P.refunded(tx) && !await M.Audit.exists({ profile: profile._id, action: "LOYALTY_REVERSED", "metadata.key": key }).session(session))
      await S.audit(null, "LOYALTY_REVERSED", profile, "Verified source reversal", { key, transaction: tx._id,
        customer: previous.metadata.customer, points: -previous.metadata.points, expiresAt: previous.metadata.expiresAt }, session);
    return;
  }
  const config = settings(await M.Settings.findById("network").session(session)).loyalty;
  if (!config.enabled || !P.confirmed(tx) || !P.approvalCovers(profile, tx.createdAt, tx.serviceType) ||
      !config.eligibleServices.includes(tx.serviceType) || !config.effectiveFrom ||
      new Date(tx.createdAt) < new Date(config.effectiveFrom)) return;
  // Serialize the GLOBAL customer cap across the same customer's Agent and
  // Merchant profiles (and staff purchases). This fence is network metadata,
  // not the editable policy revision or a lock/write on the customer wallet.
  await M.Settings.updateOne({ _id: "network" }, { $inc: { loyaltyFence: 1 } }, { session });
  const [sum] = await M.Audit.aggregate([{ $match: {
    action: "LOYALTY_EARNED", "metadata.customer": tx.customerId } },
    { $group: { _id: null, total: { $sum: "$metadata.points" } } }]).session(session);
  const points = Math.min(config.pointsPerTransaction, Math.max(0, config.maxPointsPerCustomer - (sum?.total || 0)));
  if (!points) return;
  await S.audit(null, "LOYALTY_EARNED", profile, "Non-cash business loyalty; no wallet credit", {
    key, transaction: tx._id, customer: tx.customerId, points,
    expiresAt: new Date(Date.now() + config.expiryDays * 86400000),
  }, session);
}
async function loyaltyStatement(profileId, now = Date.now()) {
  const events = await M.Audit.find({ profile: profileId, action: { $in: ["LOYALTY_EARNED", "LOYALTY_REVERSED"] } })
    .sort({ createdAt: -1 }).limit(200).select("action metadata.points metadata.transaction metadata.expiresAt createdAt").lean();
  const [result] = await M.Audit.aggregate([
    { $match: { profile: profileId, action: { $in: ["LOYALTY_EARNED", "LOYALTY_REVERSED"] } } },
    { $group: { _id: "$metadata.transaction", net: { $sum: "$metadata.points" },
      expiresAt: { $max: "$metadata.expiresAt" },
      earned: { $sum: { $cond: [{ $eq: ["$action", "LOYALTY_EARNED"] }, "$metadata.points", 0] } } } },
    { $lookup: { from: S.Transaction.collection.name, localField: "_id", foreignField: "_id", as: "source" } },
    { $unwind: "$source" }, { $set: { verified: { $and: [
      { $eq: ["$source.status", "SUCCESSFUL"] }, { $eq: ["$source.dispatchStatus", "SUCCEEDED"] },
      { $in: [{ $toUpper: { $ifNull: ["$source.providerStatus", ""] } }, ["SUCCESS", "SUCCESSFUL", "COMPLETED"]] },
      { $ne: [{ $ifNull: ["$source.debitLedgerEntryId", null] }, null] },
      ...["reversalLedgerEntryId", "reversalTransactionId", "reversedTransactionId", "reversalReference"].map(key =>
        ({ $in: [{ $ifNull: [`$source.${key}`, ""] }, ["", null]] })),
    ] } } },
    { $group: { _id: null, earned: { $sum: "$earned" }, reversed: { $sum: { $subtract: ["$earned", "$net"] } },
      available: { $sum: { $cond: [{ $and: ["$verified", { $gt: ["$expiresAt", new Date(now)] }] }, { $max: [0, "$net"] }, 0] } },
      expired: { $sum: { $cond: [{ $lte: ["$expiresAt", new Date(now)] }, { $max: [0, "$net"] }, 0] } } } },
  ]);
  return { ...(result || { earned: 0, reversed: 0, available: 0, expired: 0 }), items: events,
    cashValueKobo: 0, redemptionEnabled: false, description: "Non-cash points for the authenticated purchaser; no wallet or payout authority." };
}
const capabilityReasons = Object.freeze({
  rechargeVouchers: "Telecom Abode documents POST /recharge_card, but pre-purchase pricing, duplicate-request recovery and real unique serial/transaction mappings are not verified. Voucher sales and printing remain disabled.",
  dataVouchers: "Telecom Abode documents POST /data_card, but its catalogue and request examples disagree about plan versus denomination. Confirm the plan mapping, price and idempotent recovery before activation.",
  specialPurchasePricing: "Existing server-authorized purchase quotes remain authoritative. Discounted purchase-price admission is not enabled; commission is accounted separately after verified success.",
  bulkPurchases: "No verified idempotent batch purchase contract is configured. Use individually authorized purchases with existing PIN protection.",
  merchantQr: "A business profile QR is informational, not a payment-collection QR.",
  payByLink: "Verified payment collection is not configured for business payment links.",
  automaticPayouts: "Only authorized manual commission settlement evidence is supported.",
});
module.exports = { defaults, settings, configure, sourceMatch, performance, loyalty, loyaltyStatement, start, capabilityReasons };
