const mongoose = require("mongoose");
const crypto = require("node:crypto");
const T = require("../models/transaction.model");
const User = require("../models/user.model");
const Audit = require("../models/adminAuditLog.model");
const Notification = require("../models/notification.model");
const refundService = require("./manualRefund.service");
const { clean, money } = require("./manualRefund.rules");
const { isHistoricalBillManualReview } = require("./historicalBillManualReview.service");
const actions = ["TRANSACTION_MANUAL_SUCCEEDED", "TRANSACTION_MANUAL_REFUNDED",
  "TRANSACTION_RESOLUTION_RECHECK", "TRANSACTION_RESOLUTION_RECHECK_RESULT"];
const successSupported = new Set(["DATA:TELECOM_ABODE", "AIRTIME:CLUBKONNECT", "AIRTIME:TELECOM_ABODE"]);
const fail = (statusCode, code, message) => Object.assign(new Error(message), { statusCode, code });
const idFor = value => new mongoose.Types.ObjectId(crypto.createHash("sha256").update(value).digest("hex").slice(0, 24));
const queryFor = id => mongoose.isValidObjectId(id) ? { _id: id } : { reference: clean(id) };
const find = async id => {
  const t = await T.findOne(queryFor(id)).lean();
  if (!t) throw fail(404, "TRANSACTION_NOT_FOUND", "Transaction not found.");
  return t;
};
function permissions(req) {
  const a = req.staffAccess, p = req.staffRole?.permissions || [];
  const ho = req.user?.role === "HEAD_OFFICE" && a?.isHeadOffice && a?.scope?.type === "GLOBAL";
  const ops = req.user?.role === "STAFF" && req.user?.isStaff && a?.roleName === "OPERATIONS_MANAGER" &&
    a?.scope?.type === "GLOBAL" && a?.permissions?.includes("operations.workspace.view");
  return { view: Boolean(ho || ops), refund: Boolean(ho && p.includes("transactions.refund") ||
    ops && p.includes("operations.refund")),
  success: Boolean(ho && p.includes("transaction_intelligence.reconcile")),
  retry: Boolean(ho && (p.includes("transactions.requery") || p.includes("transaction_intelligence.requery"))) };
}
function category(t, now = Date.now()) {
  const ms = now - new Date(t.createdAt).getTime();
  if (!Number.isFinite(ms)) return { category: "ATTENTION", pendingSeconds: null };
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return { category: seconds < 300 ? "RECENT" : seconds < 1800 ? "DELAYED" :
    seconds < 3600 ? "LONG_STANDING" : "ATTENTION", pendingSeconds: seconds };
}
function row(t, customer, now) {
  const end = t.status === "PENDING" ? now :
    t.providerResponse?.adminResolution?.resolvedAt || t.providerResponse?.manualRefund?.observedAt || t.updatedAt;
  return { id: String(t._id), reference: t.reference, serviceType: t.serviceType, provider: t.provider || "LEGACY",
    amount: t.amount, status: t.status, createdAt: t.createdAt,
    ...(t.status !== "PENDING" && !end ? { category: "ATTENTION", pendingSeconds: null } : category(t, end ? +new Date(end) : now)),
    customer: { id: customer?._id ? String(customer._id) : String(t.customerId || ""),
      name: customer?.fullName || customer?.name || "", phone: customer?.phone || "", email: customer?.email || "" } };
}
async function summary(now = new Date()) {
  const [pending, resolved] = await Promise.all([
    T.aggregate([{ $match: { status: "PENDING" } }, { $set: {
      age: { $subtract: [now, { $convert: { input: "$createdAt", to: "date", onError: null, onNull: null } }] },
    } }, { $group: { _id: null, totalPending: { $sum: 1 }, pendingAmount: { $sum: "$amount" },
      below5Minutes: { $sum: { $cond: [{ $and: [{ $ne: ["$age", null] }, { $lt: ["$age", 300000] }] }, 1, 0] } },
      above5Minutes: { $sum: { $cond: [{ $gte: ["$age", 300000] }, 1, 0] } },
      above30Minutes: { $sum: { $cond: [{ $gte: ["$age", 1800000] }, 1, 0] } },
      above1Hour: { $sum: { $cond: [{ $gte: ["$age", 3600000] }, 1, 0] } },
    } }]).option({ maxTimeMS: 10000 }),
    Audit.aggregate([{ $match: { action: { $in: actions.slice(0, 2) }, status: "SUCCESSFUL" } },
      { $group: { _id: null, resolvedCount: { $sum: 1 }, refundedAmount: {
        $sum: { $cond: [{ $eq: ["$action", "TRANSACTION_MANUAL_REFUNDED"] }, "$metadata.amount", 0] },
      } } }]).option({ maxTimeMS: 10000 }),
  ]);
  return { generatedAt: now, totalPending: 0, pendingAmount: 0, below5Minutes: 0, above5Minutes: 0,
    above30Minutes: 0, above1Hour: 0, resolvedCount: 0, refundedAmount: 0,
    ...(pending[0] || {}), ...(resolved[0] || {}), _id: undefined,
    notice: "Age thresholds overlap. Resolved/refunded totals are recorded manual resolutions across all dates, not all provider settlements. Age never authorizes a refund or purchase retry." };
}
function date(value, end = false) {
  if (!value) return null;
  const raw = clean(value);
  const d = new Date(raw);
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(raw) || !Number.isFinite(+d) ||
    d.toISOString().slice(0, 10) !== raw.slice(0, 10)) throw fail(400, "INVALID_DATE", "Use a valid ISO date.");
  if (end && raw.length === 10) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}
async function list(q = {}, now = new Date()) {
  const page = Number(q.page || 1), limit = Number(q.limit || 25);
  if (!Number.isInteger(page) || page < 1 || page > 100000 || !Number.isInteger(limit) || limit < 1 || limit > 50)
    throw fail(400, "INVALID_PAGINATION", "Use page >=1 and limit 1–50.");
  const match = {}, status = q.status || "PENDING";
  if (!["PENDING", "FAILED", "RESOLVED", "ALL"].includes(status)) throw fail(400, "INVALID_STATUS", "Invalid status filter.");
  if (status === "RESOLVED") match.$or = [
    { "providerResponse.adminResolution.kind": "SUCCESSFUL" },
    { "providerResponse.manualRefund.reference": { $exists: true } },
  ];
  else if (status !== "ALL") match.status = status;
  if (q.type) {
    if (!/^[A-Z_]{2,40}$/.test(q.type)) throw fail(400, "INVALID_TYPE", "Invalid transaction type.");
    match.serviceType = q.type;
  }
  const from = date(q.from), to = date(q.to, true);
  if (from && to && from >= to) throw fail(400, "INVALID_RANGE", "End date must be later than start date.");
  if (from || to) match.createdAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lt: to } : {}) };
  if (q.minAmount !== undefined || q.maxAmount !== undefined) {
    const min = q.minAmount === undefined || q.minAmount === "" ? 0 : Number(q.minAmount);
    const max = q.maxAmount === undefined || q.maxAmount === "" ? Number.MAX_SAFE_INTEGER / 100 : Number(q.maxAmount);
    if (![min, max].every(Number.isFinite) || min < 0 || max < min) throw fail(400, "INVALID_AMOUNT", "Use a valid non-negative amount range.");
    match.amount = { $gte: min, $lte: max };
  }
  const ages = { RECENT: [0, 300], DELAYED: [300, 1800], LONG_STANDING: [1800, 3600], ATTENTION: [3600, null] };
  const pipeline = [{ $match: match }];
  if (q.duration && q.duration !== "ALL") {
    const range = ages[q.duration];
    if (!range) throw fail(400, "INVALID_DURATION", "Invalid pending duration.");
    pipeline.push({ $match: { createdAt: { $lte: new Date(+now - range[0] * 1000),
      ...(range[1] ? { $gt: new Date(+now - range[1] * 1000) } : {}) } } });
  }
  pipeline.push({ $lookup: { from: User.collection.name, localField: "customerId", foreignField: "_id",
    pipeline: [{ $project: { fullName: 1, name: 1, phone: 1, email: 1 } }], as: "customer" } },
  { $unwind: { path: "$customer", preserveNullAndEmptyArrays: true } });
  const search = clean(q.search);
  if (search.length > 100) throw fail(400, "INVALID_SEARCH", "Search must be at most 100 characters.");
  if (search) {
    const regex = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    pipeline.push({ $match: { $or: ["reference", "customer.fullName", "customer.name", "customer.phone", "customer.email"]
      .map(field => ({ [field]: regex })).concat(mongoose.isValidObjectId(search) ? [{ _id: new mongoose.Types.ObjectId(search) }] : []) } });
  }
  pipeline.push({ $facet: { items: [{ $sort: { createdAt: 1, _id: 1 } }, { $skip: (page - 1) * limit }, { $limit: limit },
    { $project: { reference: 1, serviceType: 1, provider: 1, amount: 1, status: 1, createdAt: 1, updatedAt: 1,
      "providerResponse.adminResolution.resolvedAt": 1, "providerResponse.manualRefund.observedAt": 1,
      customerId: 1, customer: 1 } }],
  total: [{ $count: "count" }] } });
  const [data] = await T.aggregate(pipeline).option({ maxTimeMS: 10000 });
  const total = data.total[0]?.count || 0;
  return { items: data.items.map(t => row(t, t.customer, +now)), page, limit, total,
    pages: Math.max(1, Math.ceil(total / limit)), generatedAt: now };
}
function successBlockers(t, state) {
  const blockers = state.blockers.filter(message => message !== "Provider success evidence blocks a refund.");
  if (!successSupported.has(`${t.serviceType}:${t.provider}`))
    blockers.push("This lifecycle requires its own delivery/escrow/accounting workflow; generic successful resolution is not supported.");
  if (t.status !== "PENDING") blockers.push("Only a pending purchase can be marked successful.");
  return [...new Set(blockers)];
}
function retryCapability(t) {
  const supported = t.status === "PENDING" && successSupported.has(`${t.serviceType}:${t.provider}`) &&
    t.dispatchStatus === "UNKNOWN" && t.dispatchClaimedAt && t.debitLedgerEntryId && !isHistoricalBillManualReview(t) &&
    new Date(t.providerResponse?.statusReconciliation?.leaseUntil || 0).getTime() <= Date.now() &&
    new Date(t.providerResponse?.adminRecheck?.leaseUntil || 0).getTime() <= Date.now();
  return { eligible: Boolean(supported), mode: "STATUS_QUERY_ONLY",
    reason: supported ? "Recheck the original request only. No new purchase or debit is sent." :
      "No proven safe provider recheck is available for this state. Do not resend an uncertain purchase." };
}
const auditRow = a => ({ id: String(a._id), action: a.action, administrator: a.actorName,
  administratorId: String(a.actorId), customerName: a.targetUserName,
  customerId: String(a.targetUserId), reference: a.metadata?.originalReference,
  previousStatus: a.previousData?.status, newStatus: a.newData?.status,
  amountRefunded: a.action === "TRANSACTION_MANUAL_REFUNDED" ? a.metadata?.amount : 0,
  reason: a.reason, evidenceReference: a.metadata?.evidenceReference || "", createdAt: a.createdAt });
async function detail(id, req) {
  const t = await find(id);
  const [refund, state, customer, history] = await Promise.all([
    refundService.detail(t._id), refundService.state(t),
    User.findById(t.customerId).select("fullName name phone email").lean(),
    Audit.find({ action: { $in: actions }, "metadata.originalTransactionId": t._id })
      .sort({ createdAt: -1, _id: -1 }).limit(200).lean(),
  ]);
  const blockers = successBlockers(t, state);
  return { transaction: row(t, customer), refund: refund.refund,
    success: { eligible: !blockers.length, blockers }, retry: retryCapability(t),
    permissions: permissions(req), history: history.map(auditRow),
    historyNotice: "Most recent 200 immutable administrative events. Uncertain legacy custody requires separate reconciliation." };
}
function validated(body, action) {
  const reason = clean(body.reason), key = clean(body.idempotencyKey);
  if (reason.length < 10 || reason.length > 500 || !/^[A-Za-z0-9_-]{16,128}$/.test(key))
    throw fail(400, "RESOLUTION_CONFIRMATION_REQUIRED", "A 10–500 character reason and stable 16–128 character request key are required.");
  if (action === "MARK_SUCCESSFUL" && (body.confirmation !== true || body.deliveryConfirmed !== true ||
      clean(body.evidenceReference).length < 6 || clean(body.evidenceReference).length > 200))
    throw fail(400, "DELIVERY_EVIDENCE_REQUIRED", "Confirm actual delivery and supply a 6–200 character evidence reference.");
  return { reason, key };
}
const requestHash = (t, req, b, action) => crypto.createHash("sha256").update(JSON.stringify({
  transaction: String(t._id), actor: String(req.user._id), action, reason: b.reason,
  key: b.idempotencyKey, evidenceReference: b.evidenceReference || "",
})).digest("hex");
async function markSuccessful(id, body, req) {
  if (!permissions(req).success) throw fail(403, "RESOLUTION_PERMISSION_REQUIRED", "Explicit Head Office reconciliation permission required.");
  const { reason } = validated(body, "MARK_SUCCESSFUL");
  const initial = await find(id), hash = requestHash(initial, req, body, "MARK_SUCCESSFUL");
  const claimId = idFor(`manual-success:${initial._id}`);
  const completed = async session => {
    const q = Audit.findById(claimId).lean();
    const audit = await (session ? q.session(session) : q);
    if (!audit) return null;
    if (audit.metadata.requestHash !== hash) throw fail(409, "ALREADY_RESOLVED", "Already resolved; no second settlement was made.");
    return { success: true, data: { status: "SUCCESSFUL", audit: auditRow(audit), replayed: true } };
  };
  const saved = await completed();
  if (saved) return saved;
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      result = null;
      const replay = await completed(session);
      if (replay) { result = replay; return; }
      const t = await T.findById(initial._id).session(session).lean();
      if (!t || t.reference !== initial.reference || t.providerRequestId !== initial.providerRequestId)
        throw fail(409, "STATE_CHANGED", "Transaction correlation changed; resolution stopped.");
      const blockers = successBlockers(t, await refundService.state(t, session));
      if (blockers.length) throw fail(422, "SUCCESS_NOT_ELIGIBLE", blockers.join(" "));
      const customer = await User.findById(t.customerId).select("fullName name").session(session).lean();
      if (!customer) throw fail(409, "CUSTOMER_NOT_FOUND", "Customer identity requires reconciliation.");
      const at = new Date();
      const effect = t.serviceType === "DATA" ? {
        "providerResponse.dataSuccessEffects.version": 1,
        "providerResponse.dataSuccessEffects.commission": { key: `DATA:${t.reference}:COMMISSION`,
          status: "PENDING", attempts: 0, createdAt: at, nextAttemptAt: at, leaseId: "", leaseUntil: null, lastErrorCode: "" },
      } : { "providerResponse.airtimeCommissionRecovery": { status: "BLOCKED", attempts: 0,
        nextAttemptAt: at, leaseUntil: null, lastErrorCode: "ADMIN_DELIVERY_COST_REVIEW_REQUIRED" } };
      const changed = await T.updateOne({ _id: t._id, status: "PENDING", providerRequestId: initial.providerRequestId },
        { $set: { status: "SUCCESSFUL", dispatchStatus: "SUCCEEDED",
          "providerResponse.adminResolution": { kind: "SUCCESSFUL", resolvedAt: at, auditId: claimId },
          ...effect } }, { session });
      if (changed.modifiedCount !== 1) throw fail(409, "STATE_CHANGED", "A competing settlement won; no wallet change was made.");
      const [audit] = await Audit.create([{ _id: claimId, actorId: req.user._id, actorRole: "HEAD_OFFICE",
        actorName: req.user.fullName || req.user.name || "", targetUserId: t.customerId,
        targetUserName: customer.fullName || customer.name || "", action: "TRANSACTION_MANUAL_SUCCEEDED",
        reason, previousData: { status: t.status }, newData: { status: "SUCCESSFUL" },
        metadata: { requestHash: hash, originalTransactionId: t._id, originalReference: t.reference,
          amount: t.amount, evidenceReference: clean(body.evidenceReference), evidenceSource: "ADMIN_DELIVERY_ATTESTATION",
          providerConfirmed: false, accountingNotice: "Use existing cost/commission recovery; no provider cost or profit was invented." },
      }], { session });
      await require("./referralReward.service").enqueueReferralRewardEvent({
        referredCustomerId: t.customerId, sourceType: t.serviceType, sourceId: t._id, session,
      });
      await Notification.create([{ userId: t.customerId, title: "Transaction resolved",
        message: `Your ${t.serviceType} transaction ${t.reference} was confirmed as delivered by authorized support.`,
        type: "PAYMENT", category: "TRANSACTION", referenceId: t._id, referenceType: "TRANSACTION",
        reference: t.reference, relatedStatus: "SUCCESSFUL", action: "TRANSACTION", dedupeKey: `manual-success:${t._id}` }], { session });
      result = { success: true, data: { status: "SUCCESSFUL", audit: auditRow(audit.toObject()), replayed: false } };
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
    return result;
  } catch (error) {
    const replay = await completed();
    if (replay) return replay;
    throw error;
  } finally { await session.endSession(); }
}
async function defaultRecheck(t) {
  if (t.serviceType === "DATA") return require("./telecomAbodeDataReconciliation.service")
    .createTelecomAbodeDataReconciliationService().reconcileByReference(t.reference);
  const lifecycle = t.provider === "TELECOM_ABODE" ?
    require("./telecomAbodeAirtimeLifecycle.service").createTelecomAbodeAirtimeLifecycle() :
    require("./clubkonnectAirtimeLifecycle.service").createClubkonnectAirtimeLifecycleService();
  return lifecycle.reconcilePendingPurchase({ transactionId: t._id });
}
function createRechecker({ verify = defaultRecheck } = {}) {
  return async (id, body, req) => {
    if (!permissions(req).retry) throw fail(403, "RESOLUTION_PERMISSION_REQUIRED", "Explicit Head Office requery permission required.");
    const { reason, key } = validated(body, "RETRY");
    const t = await find(id), hash = requestHash(t, req, body, "RETRY");
    const claimId = idFor(`resolution-recheck:${t._id}:${key}`), resultId = idFor(`resolution-recheck-result:${claimId}`);
    const replay = async () => {
      const prior = await Audit.findById(claimId).lean();
      if (!prior) return null;
      if (prior.metadata.requestHash !== hash) throw fail(409, "IDEMPOTENCY_CONFLICT", "Reuse the exact original recheck request.");
      const result = await Audit.findById(resultId).lean();
      return { success: true, data: result ? { state: "COMPLETED", status: result.newData.status,
        providerQueryCompleted: result.metadata.providerQueryCompleted,
        message: result.metadata.providerQueryCompleted ?
          `Status query attempt recorded. Current financial status: ${result.newData.status}. No purchase was resent.` :
          `Provider response was unavailable. Current financial status: ${result.newData.status}; no purchase was resent.`,
        audit: auditRow(result), replayed: true } :
      { state: "PROCESSING", message: "This recheck is processing or its result is uncertain. No purchase retry is permitted.", replayed: true } };
    };
    const old = await replay(); if (old) return old;
    if ([t.providerResponse?.adminRecheck?.leaseUntil, t.providerResponse?.statusReconciliation?.leaseUntil]
      .some(value => new Date(value || 0).getTime() > Date.now())) {
      throw fail(409, "RECHECK_IN_FLIGHT", "Another status query is active. No duplicate provider query was made.");
    }
    if (!retryCapability(t).eligible) throw fail(422, "RETRY_UNSUPPORTED", retryCapability(t).reason);
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const at = new Date();
        const locked = await T.updateOne({ _id: t._id, status: "PENDING", dispatchStatus: "UNKNOWN",
          $and: [
            { $or: [{ "providerResponse.statusReconciliation.leaseUntil": { $exists: false } }, { "providerResponse.statusReconciliation.leaseUntil": { $lte: at } }] },
            { $or: [{ "providerResponse.adminRecheck.leaseUntil": { $exists: false } }, { "providerResponse.adminRecheck.leaseUntil": { $lte: at } }] },
            { $or: [{ "providerResponse.adminRecheck.requestedAt": { $exists: false } }, { "providerResponse.adminRecheck.requestedAt": { $lte: new Date(+at - 15000) } }] },
          ] }, { $set: { "providerResponse.adminRecheck": { claimId, requestedAt: at, leaseUntil: new Date(+at + 60000) } } }, { session });
        if (locked.modifiedCount !== 1) throw fail(409, "RECHECK_IN_FLIGHT", "Another status recheck is active; no duplicate provider query was made.");
        const customer = await User.findById(t.customerId).select("fullName name").session(session).lean();
        await Audit.create([{ _id: claimId, actorId: req.user._id, actorRole: "HEAD_OFFICE",
          actorName: req.user.fullName || req.user.name || "", targetUserId: t.customerId,
          targetUserName: customer?.fullName || customer?.name || "", action: "TRANSACTION_RESOLUTION_RECHECK",
          reason, previousData: { status: t.status }, newData: { status: t.status },
          metadata: { requestHash: hash, originalTransactionId: t._id, originalReference: t.reference, mode: "STATUS_QUERY_ONLY" } }], { session });
      });
    } catch (error) { const saved = await replay(); if (saved) return saved; throw error; }
    finally { await session.endSession(); }
    let queryFailed = false;
    try { await verify(t); } catch (_) { queryFailed = true; }
    // Record the actual persisted state, not an ambiguous provider HTTP body.
    const current = await find(t._id), customer = await User.findById(t.customerId).select("fullName name").lean();
    await Audit.create({ _id: resultId, actorId: req.user._id, actorRole: "HEAD_OFFICE",
      actorName: req.user.fullName || req.user.name || "", targetUserId: t.customerId,
      targetUserName: customer?.fullName || customer?.name || "", action: "TRANSACTION_RESOLUTION_RECHECK_RESULT",
      reason, previousData: { status: t.status }, newData: { status: current.status },
      metadata: { originalTransactionId: t._id, originalReference: t.reference, requestHash: hash,
        mode: "STATUS_QUERY_ONLY", providerQueryCompleted: !queryFailed } });
    await T.updateOne({ _id: t._id, "providerResponse.adminRecheck.claimId": claimId },
      { $set: { "providerResponse.adminRecheck.leaseUntil": new Date() } });
    return replay();
  };
}
module.exports = { permissions, category, summary, list, detail, markSuccessful, createRechecker,
  find, validated, fail, successBlockers, retryCapability };
