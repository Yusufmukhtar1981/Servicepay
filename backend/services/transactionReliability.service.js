const Transaction = require("../models/transaction.model");
const LedgerEntry = require("../models/ledgerEntry.model");
const { paymentLifecycleState, MAX_AUTOMATIC_VERIFICATION_ATTEMPTS } =
  require("./billVerificationPolicy.service");
const SERVICES = ["DATA", "AIRTIME", "ELECTRICITY"];
const fields = "_id reference customerId serviceType provider status amount dispatchStatus createdAt dispatchClaimedAt debitLedgerEntryId reversalLedgerEntryId reversalTransactionId providerResponse.statusReconciliation providerResponse.telecomAbodeSettlement.receivedAt providerResponse.telecomAbodeSettlement.httpStatus providerResponse.httpStatus providerResponse.responseEvidence.httpStatus providerResponse.airtimeLifecycle.httpStatus providerResponse.airtimeLifecycle.recordedAt providerResponse.airtimeLifecycle.reasonCode";
const unresolved = { serviceType: { $in: SERVICES }, $or: [
  { status: { $in: ["PENDING", "UNDER_REVIEW", "MANUAL_REVIEW"] } },
  { status: "FAILED", debitLedgerEntryId: { $ne: null },
    reversalLedgerEntryId: null, dispatchStatus: { $ne: "REFUNDED" } },
] };
const code = v => /^[A-Z0-9_ -]{1,80}$/.test(String(v || "")) ? String(v) : "UNRECORDED";
const cents = n => Number.isFinite(Number(n)) ? Math.round(Number(n) * 100) : NaN;
const percentage = (n, total) => total ? Math.round(n * 10000 / total) / 100 : null;

function ledgerMismatch(tx, entry, direction) {
  if (!entry) return true;
  // Canonical manual refunds have their own REFUND transaction. Their credit
  // points to that transaction and reverses the original debit; automatic
  // reversals may point directly to the original transaction.
  const manualRefundLink = direction === "CREDIT" && tx.reversalTransactionId &&
    String(entry.transactionId) === String(tx.reversalTransactionId) &&
    String(entry.reversalOf) === String(tx.debitLedgerEntryId);
  return String(entry.user) !== String(tx.customerId) ||
    entry.direction !== direction || cents(entry.amount) !== cents(tx.amount) ||
    (entry.transactionId && String(entry.transactionId) !== String(tx._id) && !manualRefundLink) ||
    !Number.isFinite(cents(entry.openingBalance)) ||
    !Number.isFinite(cents(entry.closingBalance)) ||
    cents(entry.closingBalance) < 0 ||
    cents(entry.closingBalance) !== cents(entry.openingBalance) +
      (direction === "DEBIT" ? -cents(entry.amount) : cents(entry.amount));
}
function projectQueue(tx) {
  const meta = tx.providerResponse?.statusReconciliation || {};
  return {
    id: String(tx._id), reference: tx.reference, type: tx.serviceType,
    provider: code(tx.provider || "LEGACY"), financialStatus: tx.status,
    lifecycleState: paymentLifecycleState(tx), createdAt: tx.createdAt,
    lastCheckedAt: meta.checkedAt || null, nextCheckAt: meta.nextCheckAt || null,
    verificationAttempts: Number(meta.attemptCount || 0),
    reasonCode: code(meta.reason || tx.providerResponse?.airtimeLifecycle?.reasonCode),
    walletStatus: tx.reversalLedgerEntryId ? "REVERSAL_LINK_RECORDED" :
      tx.debitLedgerEntryId ? "DEBIT_LINK_RECORDED" : "LEGACY_UNLINKED",
  };
}
function summarize(rows) {
  const result = { total: rows.length, successCount: 0, failedCount: 0,
    refundedCount: 0, pendingCount: 0, settlementSamples: 0, httpSamples: 0 };
  const providers = new Map();
  let duration = 0, httpErrors = 0;
  for (const tx of rows) {
    const state = paymentLifecycleState(tx);
    const name = code(tx.provider || "LEGACY");
    const provider = providers.get(name) || { provider: name, total: 0, successCount: 0, failedCount: 0 };
    provider.total++;
    if (state === "SUCCESS") { result.successCount++; provider.successCount++; }
    else if (state === "REFUNDED") result.refundedCount++;
    else if (state === "FAILED") { result.failedCount++; provider.failedCount++; }
    else result.pendingCount++;
    providers.set(name, provider);
    const evidenceAt = tx.providerResponse?.telecomAbodeSettlement?.receivedAt ||
      tx.providerResponse?.airtimeLifecycle?.recordedAt;
    const ms = evidenceAt ? new Date(evidenceAt) - new Date(tx.createdAt) : NaN;
    if (["SUCCESS", "FAILED", "REFUNDED"].includes(state) && Number.isFinite(ms) && ms >= 0) {
      duration += ms; result.settlementSamples++;
    }
    const http = tx.providerResponse?.httpStatus ??
      tx.providerResponse?.responseEvidence?.httpStatus ??
      tx.providerResponse?.airtimeLifecycle?.httpStatus ??
      tx.providerResponse?.telecomAbodeSettlement?.httpStatus;
    if (Number.isInteger(http) && http >= 100 && http <= 599) {
      result.httpSamples++; if (http >= 400) httpErrors++;
    }
  }
  return { summary: { ...result,
    successRate: percentage(result.successCount, result.total),
    failureRate: percentage(result.failedCount + result.refundedCount, result.total),
    averageRecordedSettlementMs: result.settlementSamples ? Math.round(duration / result.settlementSamples) : null,
    httpErrorRate: percentage(httpErrors, result.httpSamples),
  }, providers: [...providers.values()] };
}

function createTransactionReliabilityService({ model = Transaction, ledger = LedgerEntry,
  now = () => new Date() } = {}) {
  return async ({ page = 1, limit = 20 } = {}) => {
    const at = now();
    const [window, queue, total] = await Promise.all([
      model.find({ serviceType: { $in: SERVICES },
        createdAt: { $gte: new Date(at - 86400000) } }).select(fields)
        .sort({ createdAt: -1, _id: -1 }).limit(5001).maxTimeMS(10000).lean(),
      model.find(unresolved).select(fields).sort({ createdAt: 1, _id: 1 })
        .limit(5001).maxTimeMS(10000).lean(),
      model.countDocuments(unresolved).maxTimeMS(10000),
    ]);
    const rows = window.slice(0, 5000), pending = queue.slice(0, 5000);
    const { summary, providers } = summarize(rows);
    const modern = rows.filter(t => t.debitLedgerEntryId).slice(0, 1000);
    const ids = modern.flatMap(t => [t.debitLedgerEntryId, t.reversalLedgerEntryId].filter(Boolean));
    const entries = ids.length ? await ledger.find({ _id: { $in: ids } })
      .select("_id user direction amount openingBalance closingBalance transactionId reversalOf")
      .maxTimeMS(10000).lean() : [];
    const byId = new Map(entries.map(e => [String(e._id), e]));
    const discrepancies = modern.filter(t =>
      ledgerMismatch(t, byId.get(String(t.debitLedgerEntryId)), "DEBIT") ||
      t.reversalLedgerEntryId && ledgerMismatch(t, byId.get(String(t.reversalLedgerEntryId)), "CREDIT")).length;
    const manual = pending.filter(t => paymentLifecycleState(t) === "MANUAL_REVIEW").length;
    const overdue = pending.filter(t => at - new Date(t.createdAt) >= 1800000).length;
    const alerts = [];
    const alert = (code, message, count) => { if (count) alerts.push({ code, severity: "WARNING", message, count }); };
    alert("CONFIRMATION_OVERDUE", "Unresolved payments need provider evidence; do not resend or infer refunds.", overdue);
    alert("LEDGER_LINK_EXCEPTION", "Recorded debit/reversal links require investigation, not automatic adjustment.", discrepancies);
    if (summary.total >= 20 && summary.failureRate >= 20)
      alert("FAILURE_RATE_HIGH", "At least 20% of recorded admissions failed or were refunded in this window.", summary.failedCount + summary.refundedCount);
    if (summary.httpSamples >= 10 && summary.httpErrorRate >= 10)
      alert("PROVIDER_HTTP_ERRORS", "Recorded provider HTTP errors exceed 10%; HTTP errors do not prove non-delivery.", summary.httpSamples);
    return { generatedAt: at, windowHours: 24, windowTruncated: window.length > 5000,
      summary, providers, backlog: {
        pendingCount: pending.filter(t => t.status === "PENDING").length, manualReviewCount: manual,
        walletDiscrepancyCount: discrepancies, ledgerAuditedCount: modern.length,
        legacyUnlinkedCount: pending.filter(t => !t.debitLedgerEntryId).length,
        automaticVerificationLimit: MAX_AUTOMATIC_VERIFICATION_ATTEMPTS,
        queueSummaryTruncated: queue.length > 5000,
      }, alerts, items: pending.slice((page - 1) * limit, page * limit).map(projectQueue),
      page, limit, total };
  };
}
module.exports = { createTransactionReliabilityService, paymentLifecycleState, ledgerMismatch, summarize };
