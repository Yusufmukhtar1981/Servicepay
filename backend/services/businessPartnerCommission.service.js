const mongoose = require("mongoose");
const Commission = require("../models/businessPartnerCommission.model");
const Rule = require("../models/businessPartnerCommissionRule.model");
const Wallet = require("../models/businessPartnerCommissionWallet.model");
const Recovery = require("../models/businessPartnerCommissionRecovery.model");
const Reservation = require("../models/businessPartnerCommissionReservation.model");
const BonusRule = require("../models/businessPartnerBonusRule.model");
const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");

const round = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const commissionStatuses = ["PENDING", "AVAILABLE", "EARNED", "PAID", "CANCELLED"];
const supportedSourceTypes = new Set(["SOLAR", "PHONE", "PHONE_FINANCING"]);
const successfulTransactionStatuses = ["SUCCESS", "SUCCESSFUL", "PAID", "COMPLETED"];
const sourceServices = {
  SOLAR: ["SOLAR_DEPOSIT", "SOLAR_INSTALLMENT"],
  PHONE: ["PHONE_FINANCING_DEPOSIT", "PHONE_FINANCING_INSTALLMENT"],
  PHONE_FINANCING: ["PHONE_FINANCING_DEPOSIT", "PHONE_FINANCING_INSTALLMENT"],
};
const reversalLocks = new Map();
const recoveryLocks = new Map();

const duplicateFilter = ({ eventKey, transactionId, commissionType = "DIRECT_CUSTOMER_COMMISSION" }) => {
  const clauses = [{ eventKey }];
  if (transactionId) clauses.push({ transactionId, commissionType, reversalOf: null });
  return { $or: clauses };
};
const isDuplicate = error => error?.code === 11000 || error?.codeName === "DuplicateKey";
const isAbortedTransaction = error =>
  error?.code === 251 || error?.codeName === "NoSuchTransaction" ||
  /NoSuchTransaction|transaction.*abort/i.test(String(error?.message || ""));

async function reserveCommissionEvent({ eventKey, transactionId, commissionType = "DIRECT_CUSTOMER_COMMISSION" }) {
  const existing = await Commission.findOne(duplicateFilter({ eventKey, transactionId, commissionType }));
  if (existing) return { commission: existing, idempotent: true };
  const filter = { eventKey, transactionId: transactionId || null, commissionType };
  const prior = await Reservation.findOne(duplicateFilter({ eventKey, transactionId, commissionType }));
  if (prior) {
    if (!prior.commission && prior.leaseExpiresAt && prior.leaseExpiresAt <= new Date()) {
      await Reservation.deleteOne({ _id: prior._id, commission: null, leaseExpiresAt: { $lte: new Date() } });
      return reserveCommissionEvent({ eventKey, transactionId, commissionType });
    }
    return { reservation: prior, conflict: true, idempotent: true };
  }
  try {
    // A standalone insert gives us an unambiguous winner. A concurrent
    // upsert can return the other caller's existing document as if we won.
    const reservation = await Reservation.create({
      ...filter,
      token: new mongoose.Types.ObjectId().toString(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      leaseExpiresAt: new Date(Date.now() + 1000),
    });
    return { reservation, reserved: true, idempotent: false };
  } catch (error) {
    if (isDuplicate(error)) return { conflict: true, idempotent: true };
    throw error;
  }
}

async function withReversalLock(key, operation) {
  const previous = reversalLocks.get(String(key)) || Promise.resolve();
  let release;
  const current = new Promise(resolve => { release = resolve; });
  reversalLocks.set(String(key), current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (reversalLocks.get(String(key)) === current) reversalLocks.delete(String(key));
  }
}
async function withRecoveryLock(key, operation) {
  const previous = recoveryLocks.get(String(key)) || Promise.resolve();
  let release;
  const current = new Promise(resolve => { release = resolve; });
  recoveryLocks.set(String(key), current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (recoveryLocks.get(String(key)) === current) recoveryLocks.delete(String(key));
  }
}

async function projectWallet({ businessPartner, session }) {
  if (!businessPartner) return null;
  const rows = await Commission.find({ businessPartner }).select("amount status reversalOf createdAt").session(session || null).lean();
  const recoveries = await Recovery.find({ businessPartner }).select("reversal amount createdAt").session(session || null).lean();
  const recoveredByReversal = new Map();
  for (const recovery of recoveries) {
    const key = String(recovery.reversal);
    recoveredByReversal.set(key, round((recoveredByReversal.get(key) || 0) + Number(recovery.amount || 0)));
  }
  const originals = new Map(rows.filter(row => !row.reversalOf).map(row => [String(row._id), row]));
  const projection = { available: 0, pending: 0, paid: 0, lifetime: 0, recoveryLiability: 0 };
  for (const row of originals.values()) {
    const value = round(Math.max(0, Number(row.amount) || 0));
    if (row.status === "PENDING") projection.pending += value;
    else if (row.status === "AVAILABLE" || row.status === "EARNED") projection.available += value;
    else if (row.status === "PAID") projection.paid += value;
    if (["AVAILABLE", "EARNED", "PAID"].includes(row.status)) projection.lifetime += value;
  }
  for (const row of rows.filter(item => item.reversalOf)) {
    const original = originals.get(String(row.reversalOf));
    if (!original) continue;
    const value = round(Math.abs(Number(row.amount) || 0));
    if (original.status === "PAID") {
      // Paid history is immutable. A reversal is recoverable liability, not a
      // retroactive reduction of the paid balance or lifetime earnings.
      projection.recoveryLiability += Math.max(0, value - Number(recoveredByReversal.get(String(row._id)) || 0));
    } else if (original.status === "PENDING") projection.pending = Math.max(0, projection.pending - value);
    else projection.available = Math.max(0, projection.available - value);
  }
  projection.available = round(projection.available);
  projection.pending = round(projection.pending);
  projection.paid = round(projection.paid);
  projection.lifetime = round(projection.lifetime);
  projection.recoveryLiability = round(projection.recoveryLiability);
  const existing = await Wallet.findOne({ businessPartner }).session(session || null).lean();
  const lastLedgerEntryAt = rows.reduce((latest, row) => !latest || row.createdAt > latest ? row.createdAt : latest, null);
  return Wallet.findOneAndUpdate(
    { businessPartner },
    {
      $set: {
        available: projection.available,
        pending: projection.pending,
        paid: projection.paid,
        // Never decrease an already reconciled lifetime projection.
        lifetime: Math.max(Number(existing?.lifetime || 0), projection.lifetime),
        recoveryLiability: projection.recoveryLiability,
        lastLedgerEntryAt,
      },
      $setOnInsert: { businessPartner },
    },
    { new: true, upsert: true, session }
  );
}

async function createCommissionInSession(payload, session) {
  const {
    businessPartner, application = null, transactionId = null,
    transactionReference = "", customerId = null, officerId = null,
    sourceType, amount, eventKey, createdBy, status = "PENDING",
    commissionType = "DIRECT_CUSTOMER_COMMISSION", commissionRate = 0,
    transactionAmount = 0, commissionRule = null, bonusRule = null,
    bonusMetric = null, bonusSourceType = null, bonusPeriodStart = null, bonusPeriodEnd = null,
  } = payload;
  if (!businessPartner || (!application && !transactionId && !["PERFORMANCE_BONUS", "CAMPAIGN_BONUS"].includes(commissionType)) ||
      !String(sourceType || "").trim() || !eventKey ||
      round(amount) <= 0 || !commissionStatuses.includes(status)) {
    throw new Error("Valid partner, application or transaction, source, amount, and event key are required.");
  }
  // This preflight is intentionally before the insert. Replaying an event
  // inside a caller-owned transaction must be a read-only idempotent success;
  // a duplicate-key exception would poison that external session.
  const existing = await Commission.findOne(duplicateFilter({ eventKey, transactionId, commissionType })).session(session || null);
  if (existing) return { commission: existing, idempotent: true };
  try {
    const commission = (await Commission.create([{
      businessPartner, application, transactionId, transactionReference,
      customerId, officerId, sourceType, amount: round(amount), eventKey,
      createdBy, status, commissionType, commissionRate: round(commissionRate),
      transactionAmount: round(transactionAmount), commissionRule, bonusRule,
      bonusMetric, bonusSourceType, bonusPeriodStart, bonusPeriodEnd,
      earnedAt: status === "EARNED" || status === "AVAILABLE" ? new Date() : null,
    }], { session }))[0];
     await projectWallet({ businessPartner, session });
    return { commission, idempotent: false };
  } catch (error) {
    // A duplicate-key write aborts the active Mongo transaction. Do not issue
    // another read on that session; the caller resolves the winner after abort.
    throw error;
  }
}

async function createCommission(payload) {
  if (payload.session) return createCommissionInSession(payload, payload.session);
  const existing = await Commission.findOne(duplicateFilter(payload));
  if (existing) return { commission: existing, idempotent: true };
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await createCommissionInSession(payload, session);
    });
    return result;
  } catch (error) {
    // A concurrent duplicate may abort the transaction before its winning row
    // is visible to the aborted session. Resolve it outside the transaction.
    if ((isDuplicate(error) || isAbortedTransaction(error)) && payload.eventKey) {
      const commission = await Commission.findOne(duplicateFilter(payload));
      if (commission) return { commission, idempotent: true };
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

async function reverseCommission({ commissionId, eventKey, createdBy, reason, session }) {
  const original = await Commission.findById(commissionId).session(session || null);
  if (!original) throw Object.assign(new Error("Commission not found."), { statusCode: 404 });
  if (original.reversalOf || original.status === "REVERSED" || Number(original.amount) < 0) {
    throw Object.assign(new Error("A reversal entry cannot itself be reversed."), { statusCode: 409 });
  }
  if (!["PENDING", "AVAILABLE", "EARNED", "PAID"].includes(original.status)) {
    throw Object.assign(new Error(`Commission status ${original.status} is not reversible.`), { statusCode: 409 });
  }
  const existing = await Commission.findOne({ reversalOf: original._id }).session(session || null);
  if (existing) return { commission: existing, idempotent: true };
  const write = async activeSession => {
    try {
      const alreadyReversed = await Commission.findOne({ reversalOf: original._id }).session(activeSession || null);
      if (alreadyReversed) return { commission: alreadyReversed, idempotent: true };
      const commission = (await Commission.create([{
        businessPartner: original.businessPartner,
        application: original.application,
        transactionId: original.transactionId,
        transactionReference: original.transactionReference,
        customerId: original.customerId,
        officerId: original.officerId,
        sourceType: original.sourceType,
        amount: -Math.abs(original.amount),
        eventKey, createdBy, status: "REVERSED",
        commissionType: original.commissionType,
        commissionRate: original.commissionRate,
        transactionAmount: original.transactionAmount,
        bonusRule: original.bonusRule,
        bonusMetric: original.bonusMetric,
        bonusSourceType: original.bonusSourceType,
        bonusPeriodStart: original.bonusPeriodStart,
        bonusPeriodEnd: original.bonusPeriodEnd,
        reversalOf: original._id,
        reversalReason: String(reason || "").slice(0, 500),
      }], { session: activeSession }))[0];
      // A paid reversal has escaped the commission wallet. Its rule margin
      // remains allocated until recordCommissionRecovery records the funds.
      if (original.commissionRule && original.status !== "PAID") {
        const restored = await Rule.updateOne(
          { _id: original.commissionRule, allocatedMargin: { $gte: Math.abs(Number(original.amount)) } },
          { $inc: { availableMargin: Math.abs(Number(original.amount)), allocatedMargin: -Math.abs(Number(original.amount)) } },
          { session: activeSession }
        );
        if (!restored.modifiedCount) throw Object.assign(new Error("Commission margin reservation could not be restored."), { statusCode: 409 });
      }
      if (original.bonusRule && original.status !== "PAID") {
        const restored = await BonusRule.updateOne(
          { _id: original.bonusRule, allocatedMargin: { $gte: Math.abs(Number(original.amount)) } },
          { $inc: { availableMargin: Math.abs(Number(original.amount)), allocatedMargin: -Math.abs(Number(original.amount)) } },
          { session: activeSession }
        );
        if (!restored.modifiedCount) throw Object.assign(new Error("Bonus margin reservation could not be restored."), { statusCode: 409 });
      }
      await projectWallet({ businessPartner: original.businessPartner, session: activeSession });
      return { commission, idempotent: false };
    } catch (error) {
      // Do not query with a transaction after a duplicate-key error: Mongo
      // marks that transaction aborted. The owner resolves it after abort.
      throw error;
    }
  };
  if (session) return write(session);
  return withReversalLock(commissionId, async () => {
    // Re-read after waiting for another reversal of the same original. This
    // makes concurrent requests deterministic while the unique index remains
    // the cross-process idempotency guarantee.
    const latest = await Commission.findById(commissionId);
    const existingReversal = await Commission.findOne({ reversalOf: commissionId });
    if (existingReversal) return { commission: existingReversal, idempotent: true };
    if (!latest) throw Object.assign(new Error("Commission not found."), { statusCode: 404 });
    const ownSession = await mongoose.startSession();
    try {
      let result;
      await ownSession.withTransaction(async () => { result = await write(ownSession); });
      return result;
    } catch (error) {
      if ((isDuplicate(error) || isAbortedTransaction(error))) {
        const reversal = await Commission.findOne({ reversalOf: commissionId });
        if (reversal) return { commission: reversal, idempotent: true };
      }
      throw error;
    } finally {
      await ownSession.endSession();
    }
  });
}

async function recordCommissionRecovery({ reversalId, eventKey, amount, createdBy, session }) {
  if (!session) {
    const activeSession = await mongoose.startSession();
    try {
      let result;
      await activeSession.withTransaction(async () => {
        result = await recordCommissionRecovery({ reversalId, eventKey, amount, createdBy, session: activeSession });
      });
      return result;
    } catch (error) {
      if (isDuplicate(error) || isAbortedTransaction(error)) {
        const existing = await Recovery.findOne({ eventKey });
        if (existing) return { recovery: existing, idempotent: true };
      }
      throw error;
    } finally {
      await activeSession.endSession();
    }
  }
  return withRecoveryLock(eventKey, () => recordCommissionRecoveryInSession({ reversalId, eventKey, amount, createdBy, session }));
}

async function recordCommissionRecoveryInSession({ reversalId, eventKey, amount, createdBy, session }) {
  if (!reversalId || !eventKey || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    throw Object.assign(new Error("Valid reversal, recovery event key, and amount are required."), { statusCode: 400 });
  }
  const reversal = await Commission.findById(reversalId).session(session || null);
  if (!reversal || !reversal.reversalOf || Number(reversal.amount) >= 0) {
    throw Object.assign(new Error("A negative paid-commission reversal is required."), { statusCode: 409 });
  }
  const original = await Commission.findById(reversal.reversalOf).session(session || null);
  if (!original || original.status !== "PAID") {
    throw Object.assign(new Error("Recovery is only valid for a paid commission reversal."), { statusCode: 409 });
  }
  const existing = await Recovery.findOne({ eventKey }).session(session || null);
  if (existing) return { recovery: existing, idempotent: true };
  const recovered = await Recovery.aggregate([
    { $match: { reversal: reversal._id } },
    { $group: { _id: null, amount: { $sum: "$amount" } } },
  ]).session(session || null);
  const outstanding = Math.max(0, Math.abs(Number(reversal.amount)) - Number(recovered[0]?.amount || 0));
  const recoveryAmount = round(amount);
  if (recoveryAmount > outstanding) {
    throw Object.assign(new Error("Recovery exceeds the outstanding paid-commission liability."), { statusCode: 409 });
  }
  const recovery = (await Recovery.create([{
    businessPartner: reversal.businessPartner,
    reversal: reversal._id,
    amount: recoveryAmount,
    eventKey,
    createdBy,
  }], { session }))[0];
  if (original.commissionRule) {
    const restored = await Rule.updateOne(
      { _id: original.commissionRule, allocatedMargin: { $gte: recoveryAmount } },
      { $inc: { availableMargin: recoveryAmount, allocatedMargin: -recoveryAmount } },
      { session }
    );
    if (!restored.modifiedCount) throw Object.assign(new Error("Commission margin recovery could not be recorded."), { statusCode: 409 });
  }
  if (original.bonusRule) {
    const restored = await BonusRule.updateOne(
      { _id: original.bonusRule, allocatedMargin: { $gte: recoveryAmount } },
      { $inc: { availableMargin: recoveryAmount, allocatedMargin: -recoveryAmount } },
      { session }
    );
    if (!restored.modifiedCount) throw Object.assign(new Error("Bonus margin recovery could not be recorded."), { statusCode: 409 });
  }
  await projectWallet({ businessPartner: reversal.businessPartner, session });
  return { recovery, idempotent: false };
}

async function reverseCommissionsForApplication({ applicationId, eventKey, createdBy, reason, session }) {
  if (!applicationId) return [];
  const originals = await Commission.find({
    application: applicationId,
    amount: { $gt: 0 },
    status: { $in: ["PENDING", "AVAILABLE", "EARNED", "PAID"] },
  }).select("_id").session(session || null);
  const results = [];
  for (const original of originals) {
    results.push(await reverseCommission({
      commissionId: original._id,
      eventKey: `${eventKey}:${original._id}`,
      createdBy,
      reason,
      session,
    }));
  }
  return results;
}

async function createCommissionForEventInSession({ businessPartner, application, transactionId, transactionReference, customerId, officerId, sourceType, sourceAmount, eventKey, createdBy, transactionStatus, commissionType = "DIRECT_CUSTOMER_COMMISSION" }, session) {
  if (!businessPartner) return null;
  if (["FAILED", "REVERSED", "REFUNDED", "CANCELLED"].includes(String(transactionStatus || "").toUpperCase())) return null;
  if (!Number.isFinite(Number(sourceAmount)) || Number(sourceAmount) <= 0 || !eventKey) return null;
  const normalizedSourceType = String(sourceType || "").toUpperCase();
  if (!supportedSourceTypes.has(normalizedSourceType)) return null;
  const existing = await Commission.findOne(duplicateFilter({ eventKey, transactionId, commissionType })).session(session || null);
  if (existing) return { commission: existing, idempotent: true };
  const ruleType = normalizedSourceType === "PHONE" ? "PHONE_FINANCING" : normalizedSourceType;
  const rule = await Rule.findOne({
    sourceType: ruleType, status: "ACTIVE", effectiveFrom: { $lte: new Date() },
  }).sort({ version: -1 }).session(session || null);
  // Legacy rules without a configured aggregate margin fail closed.
  if (!rule || !Number.isFinite(Number(rule.availableMargin)) || Number(sourceAmount) < Number(rule.minimumTransactionAmount || 0)) return null;
  const rateField = commissionType === "OFFICER_COMMISSION"
    ? "officerRate"
    : commissionType === "PARTNER_OVERRIDE_COMMISSION" ? "partnerOverrideRate" : "partnerRate";
  const configuredValue = rule[rateField] === null || rule[rateField] === undefined
    ? rule.value : rule[rateField];
  if (!Number.isFinite(Number(configuredValue)) || Number(configuredValue) < 0) return null;
  if (rule.calculation === "PERCENT" && Number(configuredValue) > 100) return null;
  let amount = rule.calculation === "PERCENT"
    ? round(Number(sourceAmount) * Number(configuredValue) / 100)
    : round(configuredValue);
  if (rule.maximumCommission !== null && rule.maximumCommission !== undefined) {
    amount = Math.min(amount, Number(rule.maximumCommission));
  }
  if (!Number.isFinite(amount) || amount <= 0) return null;
  // Reserve aggregate margin atomically in the same transaction as the
  // append-only ledger row. A stale/oversized rule therefore leaves no payout.
  const reserved = await Rule.findOneAndUpdate(
    { _id: rule._id, status: "ACTIVE", availableMargin: { $gte: amount } },
    { $inc: { availableMargin: -amount, allocatedMargin: amount } },
    { new: true, session }
  );
  if (!reserved) return null;
  return createCommissionInSession({
    businessPartner, application, transactionId, transactionReference,
    customerId, officerId, sourceType: normalizedSourceType === "PHONE_FINANCING" ? "PHONE" : normalizedSourceType,
    amount, eventKey, createdBy, status: "AVAILABLE",
    commissionRate: Number(configuredValue), transactionAmount: sourceAmount,
    commissionType, commissionRule: rule._id,
  }, session);
}

async function createCommissionForEvent(payload) {
  if (payload.session) {
    // A unique-index loser must never write in the caller's transaction:
    // reserve the deterministic event outside it, then let the loser return
    // an explicit conflict result without poisoning its parent session.
    const reservation = await reserveCommissionEvent(payload);
    if (reservation.conflict) {
      const committed = await Commission.findOne(duplicateFilter(payload));
      if (committed) return { commission: committed, idempotent: true };
      throw Object.assign(new Error("Commission reservation is held by another lifecycle attempt; retry after that attempt resolves."), {
        statusCode: 409, code: "COMMISSION_RESERVATION_CONFLICT", retriable: true,
      });
    }
    try {
      const result = await createCommissionForEventInSession(payload, payload.session);
      if (result?.commission && !result.idempotent) {
        await Reservation.updateOne(
          { _id: reservation.reservation._id },
          { $set: { commission: result.commission._id } },
          { session: payload.session }
        );
      }
      if (!result) await Reservation.deleteOne({ _id: reservation.reservation._id });
      return result;
    } catch (error) {
      await Reservation.deleteOne({ _id: reservation.reservation._id });
      throw error;
    }
  }
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await createCommissionForEventInSession(payload, session);
    });
    return result;
  } catch (error) {
    if (isDuplicate(error) || isAbortedTransaction(error)) {
      const existing = await Commission.findOne(duplicateFilter(payload));
      if (existing) return { commission: existing, idempotent: true };
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

async function evaluateBonusRule({ ruleId, businessPartner, periodStart, periodEnd, evaluationAnchor, createdBy, session }) {
  if (!session) {
    const activeSession = await mongoose.startSession();
    try {
      let result;
      await activeSession.withTransaction(async () => {
        result = await evaluateBonusRule({ ruleId, businessPartner, periodStart, periodEnd, evaluationAnchor, createdBy, session: activeSession });
      });
      return result;
    } finally {
      await activeSession.endSession();
    }
  }
  const rule = await BonusRule.findById(ruleId).session(session || null);
  if (!rule || rule.status !== "ACTIVE" || rule.effectiveFrom > new Date() ||
      (rule.effectiveTo && rule.effectiveTo <= new Date()) ||
      (businessPartner && rule.businessPartner && String(rule.businessPartner) !== String(businessPartner))) return { qualified: false, reason: "RULE_INACTIVE" };
  const partnerId = businessPartner || rule.businessPartner;
  if (!partnerId) return { qualified: false, reason: "PARTNER_SCOPE_REQUIRED" };
  if (periodStart || periodEnd) throw Object.assign(new Error("Bonus evaluation accepts only a server-derived evaluation anchor."), { statusCode: 400 });
  const bounds = canonicalBonusPeriod(rule.period, evaluationAnchor || new Date());
  const start = bounds.start;
  const end = bounds.end;
  const customerIds = await User.find({ role: "CUSTOMER", businessPartnerId: partnerId }).select("_id").session(session || null).lean();
  const ids = customerIds.map(row => row._id);
  let actual = 0;
  if (rule.metric === "ACTIVE_CUSTOMERS") {
    actual = await User.countDocuments({ _id: { $in: ids }, status: "ACTIVE" }).session(session || null);
  } else {
    const sourceMatch = rule.sourceType ? { serviceType: { $in: sourceServices[rule.sourceType] || [] } } : {};
    const aggregate = await Transaction.aggregate([
      { $match: { customerId: { $in: ids }, ...sourceMatch, status: { $in: successfulTransactionStatuses }, createdAt: { $gte: start, $lt: end } } },
      { $group: { _id: null, count: { $sum: 1 }, value: { $sum: "$amount" } } },
    ]).session(session || null);
    actual = rule.metric === "TRANSACTION_VALUE" ? Number(aggregate[0]?.value || 0) : Number(aggregate[0]?.count || 0);
  }
  if (actual < rule.threshold) return { qualified: false, actual, threshold: rule.threshold };
  const eventKey = `bonus:${rule._id}:${partnerId}:${start.toISOString()}:${end.toISOString()}`;
  const existing = await Commission.findOne({ eventKey }).session(session || null);
  if (existing) return { qualified: true, actual, threshold: rule.threshold, commission: existing, idempotent: true };
  const amount = round(rule.bonusAmount);
  const reserved = await BonusRule.findOneAndUpdate(
    { _id: rule._id, status: "ACTIVE", availableMargin: { $gte: amount } },
    { $inc: { availableMargin: -amount, allocatedMargin: amount } },
    { new: true, session }
  );
  if (!reserved) return { qualified: true, actual, threshold: rule.threshold, marginExhausted: true };
  const result = await createCommissionInSession({
    businessPartner: partnerId, sourceType: "BONUS", amount, eventKey, createdBy,
    status: "AVAILABLE", commissionType: rule.commissionType, transactionAmount: actual,
    bonusRule: rule._id, bonusMetric: rule.metric, bonusSourceType: rule.sourceType,
    bonusPeriodStart: start, bonusPeriodEnd: end,
  }, session);
  return { qualified: true, actual, threshold: rule.threshold, periodStart: start, periodEnd: end, ...result };
}

function canonicalBonusPeriod(period, anchorValue) {
  const anchor = new Date(anchorValue);
  if (Number.isNaN(anchor.getTime())) throw Object.assign(new Error("Valid evaluation anchor is required."), { statusCode: 400 });
  // Africa/Lagos is UTC+01:00 and has no DST. Build calendar boundaries in
  // that civil timezone, then convert them back to UTC for MongoDB.
  const local = new Date(anchor.getTime() + 60 * 60 * 1000);
  let startLocal = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
  if (period === "WEEKLY") {
    const day = startLocal.getUTCDay() || 7;
    startLocal = new Date(startLocal.getTime() - (day - 1) * 86400000);
  } else if (period === "MONTHLY") {
    startLocal = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1));
  }
  const days = period === "DAILY" ? 1 : period === "WEEKLY" ? 7 : null;
  const endLocal = days ? new Date(startLocal.getTime() + days * 86400000) : new Date(Date.UTC(startLocal.getUTCFullYear(), startLocal.getUTCMonth() + 1, 1));
  return { start: new Date(startLocal.getTime() - 60 * 60 * 1000), end: new Date(endLocal.getTime() - 60 * 60 * 1000) };
}

module.exports = {
  createCommission,
  createCommissionForEvent,
  evaluateBonusRule,
  reverseCommission,
  reverseCommissionsForApplication,
  recordCommissionRecovery,
  projectWallet,
  reconcileCommissionWallet: ({ businessPartner, session } = {}) => projectWallet({ businessPartner, session }),
  round,
};