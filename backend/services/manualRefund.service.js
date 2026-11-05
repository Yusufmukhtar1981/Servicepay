const mongoose = require("mongoose");
const crypto = require("node:crypto");
const Transaction = require("../models/transaction.model");
const Ledger = require("../models/ledgerEntry.model");
const User = require("../models/user.model");
const Audit = require("../models/adminAuditLog.model");
const Notification = require("../models/notification.model");
const Commission = require("../models/commission.model");
const { blockersFor, money, clean } = require("./manualRefund.rules");
const provider = require("./manualRefundProvider.service");

const fail = (statusCode, code, message) => Object.assign(new Error(message), { statusCode, code });
const queryFor = id => mongoose.isValidObjectId(id) ? { _id: id } : { reference: clean(id) };
const auditIdFor = id => new mongoose.Types.ObjectId(crypto.createHash("sha256")
  .update(`manual-refund:${id}`).digest("hex").slice(0, 24));
const refFor = id => `REFUND-${String(id)}`;
const inSession = (query, session) => session ? query.session(session) : query;
const state = async (transaction, session) => {
  const debits = await inSession(Ledger.find({
    user: transaction.customerId, direction: "DEBIT",
    $or: [{ transactionId: transaction._id }, { reference: transaction.reference }],
  }).limit(3).lean(), session);
  const debit = debits.length === 1 ? debits[0] : null;
  const priorCredit = await inSession(Ledger.exists({
    $or: [
      ...(debits.length ? [{ reversalOf: { $in: debits.map(d => d._id) } }] : []),
      { user: transaction.customerId, direction: "CREDIT", reference: transaction.reference },
      { user: transaction.customerId, direction: "CREDIT", transactionId: transaction._id },
    ],
  }), session);
  const priorRefund = await inSession(Transaction.exists({
    reversedTransactionId: transaction._id,
  }), session);
  const commission = await inSession(Commission.exists({
    transactionId: transaction._id, status: { $ne: "REVERSED" },
  }), session);
  const blockers = blockersFor({ transaction, debit, debitCount: debits.length, priorCredit, priorRefund });
  if (commission) blockers.push("Existing earnings require service-specific accounting reconciliation.");
  return {
    debit,
    blockers,
  };
};
const serialize = audit => ({
  id: String(audit._id),
  reference: audit.metadata.refundReference,
  originalReference: audit.metadata.originalReference,
  amount: audit.metadata.amount, reason: audit.reason,
  administrator: audit.actorName || String(audit.actorId),
  customerName: audit.targetUserName, createdAt: audit.createdAt,
  status: "COMPLETED",
});
const detail = async (id, verifyFailure = provider.verifyFailure) => {
  const t = await Transaction.findOne(queryFor(id)).lean();
  if (!t) throw fail(404, "TRANSACTION_NOT_FOUND", "Transaction not found.");
  const [s, customer] = await Promise.all([
    state(t), User.findById(t.customerId).select("fullName name phone").lean(),
  ]);
  let providerStatus = t.providerStatus || "UNKNOWN";
  if (!s.blockers.length) {
    const evidence = await verifyFailure(t);
    const correlated = evidence.requestId === t.providerRequestId;
    if (correlated && evidence.outcome === "FAILED") providerStatus = "FAILED";
    else {
      providerStatus = correlated && evidence.outcome === "SUCCESS" ? "SUCCESSFUL" : "UNKNOWN";
      s.blockers.push(providerStatus === "SUCCESSFUL"
        ? "Provider-confirmed success blocks a refund."
        : "Provider outcome is unknown or processing. Authorized reconciliation and correlated terminal failure evidence are required.");
    }
  }
  return {
    id: String(t._id), reference: t.reference, serviceType: t.serviceType,
    amount: t.amount, status: t.status, createdAt: t.createdAt,
    customer: { name: customer?.fullName || customer?.name || "", phone: customer?.phone || "" },
    walletDebitStatus: s.debit ? "RECORDED — custody checks required" : "NOT_VERIFIED",
    verifiedDebitAmount: s.blockers.some(x => /debit|amount/.test(x)) ? null : s.debit?.amount,
    providerStatus,
    refund: {
      // Button is available for preflight-eligible records; POST performs a fresh
      // read-only provider check and atomically revalidates all custody evidence.
      eligible: s.blockers.length === 0,
      blockers: s.blockers,
      providerCheck: "A fresh, correlated terminal failure is required at confirmation. Unknown outcomes must be reconciled first.",
    },
  };
};
const history = async query => {
  const page = Math.max(1, parseInt(query.page, 10) || 1), limit = 25;
  const filter = { action: "TRANSACTION_MANUAL_REFUNDED" };
  const [rows, total] = await Promise.all([
    Audit.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Audit.countDocuments(filter),
  ]);
  return { items: rows.map(serialize), page, total, pages: Math.max(1, Math.ceil(total / limit)) };
};
const createRefundService = ({ verifyFailure = provider.verifyFailure } = {}) => {
  const refund = async (id, body, actor) => {
    if (actor?.role !== "HEAD_OFFICE" || !mongoose.isValidObjectId(actor._id)) {
      throw fail(403, "HEAD_OFFICE_REQUIRED", "Only an authenticated Head Office administrator may refund.");
    }
    const reason = clean(body.reason), key = clean(body.idempotencyKey);
    if (reason.length < 10 || reason.length > 500 || body.confirmation !== true ||
        !/^[A-Za-z0-9_-]{16,128}$/.test(key)) {
      throw fail(400, "REFUND_CONFIRMATION_REQUIRED", "A 10–500 character reason, confirmation and stable idempotency key are required.");
    }
    const initial = await Transaction.findOne(queryFor(id)).lean();
    if (!initial) throw fail(404, "TRANSACTION_NOT_FOUND", "Transaction not found.");
    const requestHash = crypto.createHash("sha256").update(JSON.stringify({
      transaction: String(initial._id), actor: String(actor._id), reason, key,
    })).digest("hex");
    const claimId = auditIdFor(initial._id);
    const completed = async session => {
      const record = await inSession(Audit.findOne({
        _id: claimId, action: "TRANSACTION_MANUAL_REFUNDED",
      }).lean(), session);
      if (!record) return null;
      if (record.metadata.requestHash !== requestHash) {
        throw fail(409, "ALREADY_REFUNDED", "This transaction already has a completed refund. Refresh its history; no additional credit was made.");
      }
      const user = await inSession(User.findById(initial.customerId).select("walletBalance").lean(), session);
      return { success: true, refund: serialize(record), walletBalance: user?.walletBalance, replayed: true };
    };
    const replay = await completed();
    if (replay) return replay;
    const preflight = await state(initial);
    if (preflight.blockers.length) throw fail(422, "REFUND_NOT_ELIGIBLE", preflight.blockers.join(" "));
    const evidence = await verifyFailure(initial);
    if (evidence.outcome !== "FAILED" || evidence.requestId !== initial.providerRequestId) {
      throw fail(422, evidence.outcome === "SUCCESS" ? "PROVIDER_SUCCESS_BLOCKS_REFUND" : "AUTHORITATIVE_FAILURE_REQUIRED",
        evidence.outcome === "SUCCESS" ? "Provider-confirmed success cannot be refunded." :
          "Provider outcome is unknown or still processing. Authorized reconciliation and correlated failure evidence are required; no wallet credit was made.");
    }
    const observedAt = new Date();
    const session = await mongoose.startSession();
    let result;
    try {
      await session.withTransaction(async () => {
        // Reset callback-local result because the Mongo driver may retry it.
        result = null;
        const saved = await completed(session);
        if (saved) { result = saved; return; }
        if (Date.now() - observedAt.getTime() > 60000) throw fail(409, "EVIDENCE_EXPIRED", "Provider evidence expired. Refresh and retry safely.");
        const t = await Transaction.findById(initial._id).session(session).lean();
        if (!t || t.providerRequestId !== initial.providerRequestId || t.provider !== initial.provider ||
            t.providerOrderId !== initial.providerOrderId || t.reference !== initial.reference) {
          throw fail(409, "TRANSACTION_STATE_CHANGED", "Provider correlation changed; refund stopped.");
        }
        const s = await state(t, session);
        if (s.blockers.length) throw fail(409, "TRANSACTION_STATE_CHANGED", s.blockers.join(" "));
        const customer = await User.findById(t.customerId).select("walletBalance fullName name").session(session).lean();
        const balance = Number(customer?.walletBalance);
        const cents = Math.round(balance * 100), amountCents = money(s.debit.amount);
        if (!customer || !Number.isFinite(balance) || balance < 0 || !Number.isSafeInteger(cents) ||
            Math.abs(balance * 100 - cents) > 0.000001 || !Number.isSafeInteger(cents + amountCents)) {
          throw fail(409, "INVALID_WALLET_CUSTODY", "The customer wallet requires reconciliation before a refund.");
        }
        const amount = amountCents / 100, closing = (cents + amountCents) / 100;
        const refundId = new mongoose.Types.ObjectId(), ledgerId = new mongoose.Types.ObjectId();
        const reference = refFor(t._id);
        // This conditional write conflicts with existing provider settlement
        // workers. Exactly one terminal state wins the transaction.
        const changed = await Transaction.updateOne({
          _id: t._id, status: "PENDING", providerRequestId: initial.providerRequestId,
        }, { $set: {
          status: "REFUNDED", reversalTransactionId: refundId, reversalLedgerEntryId: ledgerId,
          reversalReference: reference,
          ...(t.dispatchStatus ? { dispatchStatus: "REFUNDED" } : {}),
          // Private reason, actor and provider evidence belong in the immutable
          // Head Office audit, not the customer's receipt payload.
          "providerResponse.manualRefund": { reference, amount, observedAt },
        } }, { session });
        if (changed.modifiedCount !== 1) throw fail(409, "TRANSACTION_STATE_CHANGED", "Transaction changed before refund.");
        const credited = await User.updateOne({ _id: customer._id, walletBalance: balance },
          { $set: { walletBalance: closing } }, { session });
        if (credited.modifiedCount !== 1) throw fail(409, "WALLET_CHANGED", "Wallet changed; retry the same request safely.");
        await Transaction.create([{
          _id: refundId, reference, customerId: t.customerId, serviceType: "REFUND",
          provider: "SERVICEPAY_MANUAL_REFUND", amount, status: "SUCCESSFUL",
          reversedTransactionId: t._id,
          providerResponse: { originalReference: t.reference, originalServiceType: t.serviceType,
            manualRefund: true, email: { status: "PENDING", attempts: 0, nextAttemptAt: new Date() } },
        }], { session });
        await Ledger.create([{
          _id: ledgerId, user: t.customerId, direction: "CREDIT", amount, openingBalance: balance,
          closingBalance: closing, currency: "NGN", service: "REFUND", reference,
          idempotencyKey: `manual-refund:${t._id}`, transactionId: refundId, reversalOf: s.debit._id,
          narration: `Refund of ${t.reference}`, metadata: { originalTransactionId: t._id, actorId: actor._id, manualRefund: true },
        }], { session });
        const [audit] = await Audit.create([{
          _id: claimId, actorId: actor._id, actorRole: "HEAD_OFFICE",
          actorName: actor.fullName || actor.name || "", targetUserId: t.customerId,
          targetUserName: customer.fullName || customer.name || "",
          action: "TRANSACTION_MANUAL_REFUNDED", reason, status: "SUCCESSFUL",
          previousData: { status: t.status, debitLedgerId: s.debit._id },
          newData: { status: "REFUNDED", refundTransactionId: refundId, creditLedgerId: ledgerId },
          metadata: { requestHash, originalTransactionId: t._id, originalReference: t.reference,
            refundReference: reference, amount, evidence: { ...evidence, observedAt } },
        }], { session });
        await Notification.create([{
          userId: t.customerId, title: "Transaction refunded",
          message: `NGN ${amount.toFixed(2)} was returned to your wallet for ${t.reference}.`,
          type: "WALLET", category: "TRANSACTION", referenceId: refundId, referenceType: "TRANSACTION",
          reference, relatedStatus: "SUCCESSFUL", action: "TRANSACTION", dedupeKey: `manual-refund:${t._id}`,
        }], { session });
        result = { success: true, refund: serialize(audit.toObject()), walletBalance: closing, replayed: false };
      }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
      return result;
    } catch (error) {
      // Recover an acknowledged commit whose HTTP response was lost, or a
      // uniqueness race. Never turn an unknown commit outcome into another credit.
      const saved = await completed();
      if (saved) return saved;
      throw error;
    } finally {
      await session.endSession();
    }
  };
  return { refund };
};
module.exports = { createRefundService, detail, history, state, auditIdFor };
