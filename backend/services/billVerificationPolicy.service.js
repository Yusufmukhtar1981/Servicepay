const { isHistoricalBillManualReview } = require("./historicalBillManualReview.service");

// Scheduling/presentation only. Never authorize a refund, debit or repeat send.
const MAX_AUTOMATIC_VERIFICATION_ATTEMPTS = 12;
function automaticVerificationBlocked(tx) {
  if (tx?.status !== "PENDING" || tx.provider !== "TELECOM_ABODE" ||
      !["DATA", "AIRTIME"].includes(tx.serviceType)) return false;
  return isHistoricalBillManualReview(tx) ||
    Number(tx.providerResponse?.statusReconciliation?.attemptCount || 0) >=
      MAX_AUTOMATIC_VERIFICATION_ATTEMPTS;
}
function paymentLifecycleState(tx, now = Date.now()) {
  const status = String(tx?.status || "").toUpperCase();
  if (["SUCCESSFUL", "SUCCESS"].includes(status)) return "SUCCESS";
  if (status === "REFUNDED" || status === "FAILED" &&
      tx.dispatchStatus === "REFUNDED" && tx.reversalLedgerEntryId) return "REFUNDED";
  if (status === "FAILED") return tx.debitLedgerEntryId && !tx.reversalLedgerEntryId
    ? "MANUAL_REVIEW" : "FAILED";
  if (["UNDER_REVIEW", "MANUAL_REVIEW"].includes(status) ||
      automaticVerificationBlocked(tx)) return "MANUAL_REVIEW";
  if (tx?.dispatchStatus === "READY") return "CREATED";
  if (["CLAIMED", "SENDING"].includes(tx?.dispatchStatus)) {
    const claimedAt = new Date(tx.dispatchClaimedAt || tx.createdAt).getTime();
    if (Number.isFinite(claimedAt) && now - claimedAt > 120000) {
      return tx.dispatchStatus === "CLAIMED" ? "MANUAL_REVIEW" : "PENDING_VERIFICATION";
    }
    return "PROCESSING";
  }
  if (status === "PENDING" && !tx?.dispatchStatus && !tx?.debitLedgerEntryId &&
      Number.isFinite(new Date(tx?.createdAt).getTime()) &&
      now - new Date(tx.createdAt).getTime() > 120000) return "MANUAL_REVIEW";
  return "PENDING_VERIFICATION";
}
module.exports = { MAX_AUTOMATIC_VERIFICATION_ATTEMPTS,
  automaticVerificationBlocked, paymentLifecycleState };
