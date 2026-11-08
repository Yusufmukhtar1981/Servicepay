// Deliberately fail closed: a pending status is not proof of refundable custody.
// Only lifecycles whose terminal transition competes atomically with this
// refund are supported. Escrow/payout services require separate cancellation.
const SUPPORTED = new Set(["AIRTIME:CLUBKONNECT", "AIRTIME:TELECOM_ABODE", "DATA:CLUBKONNECT", "DATA:TELECOM_ABODE"]);
const OVERRIDE_WARNING = "Provider outcome has not been confirmed. This manual refund may result in a financial loss if the service was delivered.";
const clean = value => String(value ?? "").trim();
const money = value => {
  const n = Number(value);
  const cents = Math.round(n * 100);
  return Number.isFinite(n) && n > 0 && Number.isSafeInteger(cents) &&
    Math.abs(n * 100 - cents) < 0.000001 ? cents : null;
};
const hasPriorRefund = (value, depth = 0) => {
  if (!value || typeof value !== "object" || depth > 12) return false;
  for (const [key, item] of Object.entries(value)) {
    if (/refund|reversal|reversed/i.test(key) && item != null &&
        ![false, "", 0, "NONE", "NOT_REFUNDED", "NOT_PROCESSED", "PENDING"].includes(item)) return true;
    if (item && typeof item === "object" && hasPriorRefund(item, depth + 1)) return true;
  }
  return false;
};
const hasSuccessEvidence = (value, depth = 0) => {
  if (!value || typeof value !== "object" || depth > 12) return false;
  for (const [key, item] of Object.entries(value)) {
    if (/^(?:status|providerStatus|orderStatus|outcome|transactionStatus)$/i.test(key) &&
        ["SUCCESS", "SUCCESSFUL", "SUCCEEDED", "COMPLETED", "DELIVERED", "ORDER_COMPLETED"].includes(
          clean(item).toUpperCase())) return true;
    if (item && typeof item === "object" && hasSuccessEvidence(item, depth + 1)) return true;
  }
  return false;
};
const blockersFor = ({ transaction: t, debit, debitCount, priorCredit, priorRefund }) => {
  const reasons = [];
  const failedWithCanonicalEvidence = t.status === "FAILED" && t.dispatchStatus === "FAILED" &&
    t.providerStatus === "FAILED";
  if (t.status !== "PENDING" && !failedWithCanonicalEvidence)
    reasons.push("Only an eligible PENDING or canonically FAILED transaction can be manually refunded.");
  if (!SUPPORTED.has(`${t.serviceType}:${t.provider}`)) {
    reasons.push("This service requires its own verified settlement/reconciliation workflow; a generic wallet credit is not safe.");
  }
  if (["DISPATCHING", "ADMITTED"].includes(t.dispatchState) && !t.dispatchClaimedAt &&
      !t.providerRequestedAt) reasons.push("Provider dispatch is not proven complete.");
  if (t.dispatchState === "DISPATCHING" || t.dispatchStatus === "DISPATCHING" ||
      ["READY", "CLAIMED", "SENDING"].includes(t.dispatchStatus) ||
      new Date(t.dispatchLeaseUntil || 0).getTime() > Date.now() ||
      new Date(t.reconciliationLeaseUntil || 0).getTime() > Date.now()) {
    reasons.push("A provider dispatch or reconciliation operation is still in flight.");
  }
  if (new Date(t.providerResponse?.adminRecheck?.leaseUntil || 0).getTime() > Date.now() ||
      new Date(t.providerResponse?.statusReconciliation?.leaseUntil || 0).getTime() > Date.now()) {
    reasons.push("An administrator status query is still in flight.");
  }
  if (t.provider === "TELECOM_ABODE" &&
      ((!failedWithCanonicalEvidence && t.dispatchStatus !== "UNKNOWN") || !t.dispatchClaimedAt || !t.debitLedgerEntryId)) {
    reasons.push("The Telecom Abode purchase has not reached its canonical inactive uncertain-outcome state.");
  }
  if (priorRefund || priorCredit || t.reversalLedgerEntryId || t.reversalTransactionId ||
      hasPriorRefund(t.providerResponse) || hasPriorRefund(t.metadata)) {
    reasons.push("Existing or ambiguous prior refund evidence requires review; no further credit is allowed.");
  }
  const amount = money(debit?.amount);
  if (debitCount !== 1 || !debit || !amount || debit.status !== "POSTED" ||
      String(debit.user) !== String(t.customerId) ||
      String(debit.transactionId) !== String(t._id) || debit.reference !== t.reference ||
      debit.service !== t.serviceType || debit.direction !== "DEBIT" ||
      debit.currency !== "NGN" || debit.reversalOf ||
      !Number.isFinite(debit.openingBalance) || !Number.isFinite(debit.closingBalance) ||
      debit.openingBalance < 0 || debit.closingBalance < 0 ||
      Math.abs((debit.openingBalance - debit.closingBalance) * 100 - amount) > 0.000001 ||
      (t.debitLedgerEntryId && String(t.debitLedgerEntryId) !== String(debit._id))) {
    reasons.push("A single, posted, exactly correlated original wallet debit has not been verified.");
  }
  // Avoid refunding an unexplained debit that differs from the purchase amount.
  if (amount !== money(t.amount)) reasons.push("The debit and original transaction amounts do not match.");
  if (Number(t.agentCommission || 0) || Number(t.stateManagerCommission || 0) ||
      Number(t.zonalManagerCommission || 0) || Number(t.servicepayProfit || 0)) {
    reasons.push("Recorded earnings require service-specific accounting reconciliation before refund.");
  }
  if (["SUCCESS", "SUCCESSFUL", "SUCCEEDED", "COMPLETED", "DELIVERED", "ORDER_COMPLETED"].includes(clean(t.providerStatus).toUpperCase()) ||
      t.dispatchStatus === "SUCCEEDED" ||
      t.providerResponse?.telecomAbodeSettlement?.outcome === "SUCCESS" ||
      t.providerEvidenceOutcome === "SUCCESS" || hasSuccessEvidence(t.providerResponse)) {
    reasons.push("Provider success evidence blocks a refund.");
  }
  return reasons;
};
module.exports = { SUPPORTED, OVERRIDE_WARNING, clean, money, hasPriorRefund, blockersFor };
