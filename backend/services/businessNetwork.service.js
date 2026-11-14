"use strict";
const mongoose = require("mongoose");
const M = require("../models/businessNetwork.models");
const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const P = require("./businessNetwork.policy");
const { getManagedRecordScope } = require("./aggregatorRecordScope.service");
const { canonicalRoleName } = require("../config/permissionRegistry");
const isHO = user => canonicalRoleName(user.role) === "HEAD_OFFICE";
const id = value => {
  if (typeof value !== "string" || !/^[a-f\d]{24}$/i.test(value)) P.fail("Invalid record ID.");
  return new mongoose.Types.ObjectId(value);
};
async function atomic(callback) {
  const session = await mongoose.startSession();
  try { let result; await session.withTransaction(async () => { result = await callback(session); }); return result; }
  finally { await session.endSession(); }
}
async function audit(actor, action, profile, reason, metadata, session) {
  await M.Audit.create([{ actor: actor?._id, action, profile: profile?._id, reason: reason || "", metadata: metadata || {} }], { session });
}
async function adminScope(user) {
  const scope = await getManagedRecordScope(user);
  if (isHO(user)) return {};
  // Permission alone never implies global or location-string access.
  return { owner: { $in: scope.customerIds || [] } };
}
async function profileFor(user, kind, { approved = true, profileId, permission = "reports", session } = {}) {
  let query = M.Profile.findOne(profileId ? { _id: id(String(profileId)), kind: P.kind(kind) } : { owner: user._id, kind: P.kind(kind) });
  if (session) query = query.session(session);
  const profile = await query;
  if (!profile) P.fail("Business application not found.", "NETWORK_NOT_FOUND", 404);
  let membership = null;
  if (String(profile.owner) !== String(user._id) && !isHO(user)) {
    let staffQuery = M.Staff.findOne({ profile: profile._id, user: user._id, status: "ACTIVE", permissions: permission });
    if (session) staffQuery = staffQuery.session(session);
    membership = await staffQuery;
    if (kind !== "MERCHANT" || !membership) P.fail("This business is outside your access.", "NETWORK_FORBIDDEN", 403);
    const branch = await M.Branch.findOne({ _id: membership.branch, profile: profile._id, status: "ACTIVE" }).session(session || null);
    if (!branch) P.fail("The assigned branch is unavailable.", "NETWORK_FORBIDDEN", 403);
  }
  if (approved && profile.status !== "APPROVED") P.fail("An active, approved business is required.", "NETWORK_APPROVAL_REQUIRED", 403);
  if (approved && !await User.exists({ _id: profile.owner, role: "CUSTOMER", status: "ACTIVE", kycVerified: true }).session(session || null))
    P.fail("The business owner must have active Customer access and verified KYC.", "NETWORK_KYC_REQUIRED", 403);
  return { profile, membership };
}
async function ownerProfile(user, value, session) {
  const profile = await M.Profile.findById(id(value)).session(session || null);
  if (!profile || (String(profile.owner) !== String(user._id) && !isHO(user))) P.fail("Business not found.", "NETWORK_NOT_FOUND", 404);
  if (profile.kind !== "MERCHANT" || profile.status !== "APPROVED") P.fail("An active Merchant business is required.", "NETWORK_APPROVAL_REQUIRED", 403);
  if (!isHO(user) && !await User.exists({ _id: profile.owner, role: "CUSTOMER", status: "ACTIVE", kycVerified: true }).session(session || null))
    P.fail("The business owner requires active access and verified KYC.", "NETWORK_KYC_REQUIRED", 403);
  return profile;
}
async function transactions(filter, { page = 1, limit = 50, status, from, to, branch } = {}) {
  const query = {};
  if (status) {
    if (!["SUCCESSFUL", "PENDING", "FAILED", "REFUNDED"].includes(status)) P.fail("Invalid transaction status.");
    query["source.status"] = status;
  }
  if (from || to) {
    query["source.createdAt"] = {};
    for (const [key, value] of [["$gte", from], ["$lte", to]]) if (value) {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(value) || Number.isNaN(Date.parse(value))) P.fail("Invalid report date.");
      query["source.createdAt"][key] = new Date(value);
    }
  }
  const [result] = await M.Activity.aggregate([
    { $match: { ...filter, ...(branch ? { branch } : {}) } },
    { $lookup: { from: Transaction.collection.name, localField: "transaction", foreignField: "_id", as: "source" } },
    { $unwind: "$source" }, { $match: query },
    { $facet: {
      count: [{ $count: "total" }],
      items: [{ $sort: { "source.createdAt": -1, "source._id": -1 } }, { $skip: (page - 1) * limit }, { $limit: limit },
        { $project: { _id: "$source._id", reference: "$source.reference", serviceType: "$source.serviceType", status: "$source.status",
          amount: "$source.amount", createdAt: "$source.createdAt", branch: { $ifNull: ["$branch", null] } } }],
    } },
  ]);
  return { total: result?.count?.[0]?.total || 0, page, items: (result?.items || []).map(row =>
    ({ ...row, amount: undefined, amountKobo: P.kobo(row.amount) })) };
}
async function summary(filter, options = {}) {
  // Summaries cover the full selected period, not just the current page.
  const rows = await M.Activity.aggregate([
    { $match: filter },
    { $lookup: { from: Transaction.collection.name, localField: "transaction", foreignField: "_id", as: "source" } },
    { $unwind: "$source" },
    ...(options.from ? [{ $match: { "source.createdAt": { $gte: options.from } } }] : []),
    { $group: { _id: "$source.status", count: { $sum: 1 }, amount: { $sum: "$source.amount" } } },
  ]);
  const out = { total: 0, successful: 0, pending: 0, failed: 0, refunded: 0, volumeKobo: 0 };
  const keys = { SUCCESSFUL: "successful", PENDING: "pending", FAILED: "failed", REFUNDED: "refunded" };
  for (const row of rows) { out.total += row.count; if (keys[row._id]) out[keys[row._id]] += row.count; if (row._id === "SUCCESSFUL") out.volumeKobo += P.kobo(row.amount); }
  return out;
}
async function reconcileActivity(activityId) {
  return atomic(async session => {
    const activity = await M.Activity.findById(activityId).session(session);
    if (!activity) return;
    // Serialize every network ledger operation for this profile. Existing
    // payment records and their indexes are read only, never locked by writes.
    await M.Profile.updateOne({ _id: activity.profile }, { $inc: { revision: 1 } }, { session });
    const profile = await M.Profile.findById(activity.profile).session(session);
    const tx = await Transaction.findById(activity.transaction).session(session).lean();
    if (!tx || !profile) return;
    const accrual = await M.Ledger.findOne({ eventKey: `earn:${tx._id}` }).session(session);
    if (accrual && P.refunded(tx)) {
      if (!await M.Ledger.exists({ eventKey: `reverse:${tx._id}` }).session(session)) {
        await M.Ledger.create([{ eventKey: `reverse:${tx._id}`,
          profile: profile._id, transaction: tx._id, event: "REVERSAL", amountKobo: -accrual.amountKobo }], { session });
        await audit(null, "COMMISSION_REVERSED", profile, "", { source: "SYSTEM_RECONCILIATION", transaction: tx._id, amountKobo: accrual.amountKobo }, session);
      }
      return;
    }
    if (accrual || profile.kind !== "AGENT" || !P.confirmed(tx) || !P.approvalCovers(profile, tx.createdAt, tx.serviceType)) return;
    // Never apply a future rule retroactively to earlier sales.
    const rules = await M.Rule.find({ service: tx.serviceType, group: activity.commissionGroup,
      createdAt: { $lte: tx.createdAt }, $and: [
        { $or: [{ disabledAt: { $exists: false } }, { disabledAt: { $gt: tx.createdAt } }] },
        { $or: [{ state: "" }, { state: profile.details.state }] },
        { $or: [{ lga: "" }, { lga: profile.details.lga }] },
      ] }).sort({ createdAt: -1, _id: -1 }).session(session).lean();
    rules.sort((a, b) => (Number(!!b.state) + Number(!!b.lga)) - (Number(!!a.state) + Number(!!a.lga)));
    const rule = rules[0]; if (!rule) return;
    const amount = P.commission(tx, { ...rule, enabled: true }); if (!amount) return;
    await M.Ledger.create([{ eventKey: `earn:${tx._id}`, profile: profile._id, transaction: tx._id,
      rule: rule._id, event: "ACCRUAL", amountKobo: amount }], { session });
    await audit(null, "COMMISSION_ACCRUED", profile, "", { source: "SYSTEM_RECONCILIATION", transaction: tx._id, amountKobo: amount }, session);
  });
}
async function reconcile(profileIds, limit = 1000) {
  const rows = await M.Activity.find(profileIds ? { profile: { $in: profileIds } } : {}).sort({ updatedAt: 1, _id: 1 }).limit(limit).select("_id");
  for (const row of rows) {
    await reconcileActivity(row._id);
    await M.Activity.updateOne({ _id: row._id }, { $currentDate: { updatedAt: true } }, { timestamps: false });
  }
}
async function commissionRows(filter, options = {}) {
  const page = P.integer(Number(options.page || 1), "page", 1, 100000);
  const limit = P.integer(Number(options.limit || 50), "page size", 1, 100);
  const [items, total, grouped] = await Promise.all([
    M.Ledger.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    M.Ledger.countDocuments(filter),
    M.Ledger.aggregate([
      { $match: filter },
      { $group: { _id: "$transaction",
        earned: { $sum: { $cond: [{ $eq: ["$event", "ACCRUAL"] }, "$amountKobo", 0] } },
        reversed: { $sum: { $cond: [{ $eq: ["$event", "REVERSAL"] }, { $multiply: ["$amountKobo", -1] }, 0] } },
        paid: { $sum: { $cond: [{ $eq: ["$event", "SETTLEMENT"] }, { $multiply: ["$amountKobo", -1] }, 0] } } } },
      { $group: { _id: null, earnedKobo: { $sum: "$earned" }, reversedKobo: { $sum: "$reversed" }, paidKobo: { $sum: "$paid" },
        pendingKobo: { $sum: { $max: [0, { $subtract: [{ $subtract: ["$earned", "$reversed"] }, "$paid"] }] } },
        recoveryKobo: { $sum: { $max: [0, { $subtract: ["$paid", { $subtract: ["$earned", "$reversed"] }] }] } } } },
      { $project: { _id: 0 } },
    ]),
  ]);
  const sources = await Transaction.find({ _id: { $in: items.map(row => row.transaction) } })
    .select("_id reference serviceType status").lean();
  const byId = new Map(sources.map(row => [String(row._id), row]));
  return { total, page, limit, items: items.map(row => ({ ...row, reference: byId.get(String(row.transaction))?.reference || "",
    serviceType: byId.get(String(row.transaction))?.serviceType || "", transactionStatus: byId.get(String(row.transaction))?.status || "UNKNOWN" })),
    totals: grouped[0] || P.totals([]) };
}
let readyAt = 0;
async function ensureReady({ fresh = false } = {}) {
  if (!fresh && Date.now() - readyAt < 30000) return;
  readyAt = 0;
  for (const Model of Object.values(M)) {
    if (!await mongoose.connection.db.listCollections({ name: Model.collection.name }, { nameOnly: true }).hasNext())
      P.fail("Business Network requires its additive storage prerequisites before activation.", "NETWORK_NOT_READY", 503);
    const indexes = await Model.collection.indexes();
    for (const [key, spec] of Model.schema.indexes()) if (spec.unique &&
      !indexes.some(i => i.unique === true && JSON.stringify(i.key) === JSON.stringify(key) && !i.partialFilterExpression && !i.sparse))
      P.fail("Business Network uniqueness safeguards have not been verified.", "NETWORK_NOT_READY", 503);
  }
  readyAt = Date.now();
}
let timer, running = false;
function start() {
  if (timer) return;
  timer = setInterval(async () => {
    if (running) return; running = true;
    try {
      // Missing namespaces never trigger automatic collection/index creation.
      if (await mongoose.connection.db.listCollections({ name: M.Activity.collection.name }, { nameOnly: true }).hasNext()) {
        await ensureReady(); await reconcile(null, 100);
      }
    } catch (error) { console.error(JSON.stringify({ event: "business_network.reconciliation.failed", code: error.code || "INTERNAL" })); }
    finally { running = false; }
  }, 60000);
  timer.unref();
}
module.exports = { M, P, User, Transaction, isHO, id, atomic, audit, adminScope, profileFor, ownerProfile, transactions, summary, reconcileActivity, reconcile, commissionRows, ensureReady, start };
