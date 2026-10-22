// The pre-existing DATA/AIRTIME incident is reserved for separate manual
// reconciliation. New admissions and Electricity/other-provider recovery remain
// automatic. This policy does not edit or migrate historical records.
const HISTORICAL_BILL_REVIEW_BEFORE = new Date("2026-10-22T00:00:00.000Z");
const isHistoricalBillManualReview = transaction =>
  transaction?.provider === "TELECOM_ABODE" &&
  ["DATA", "AIRTIME"].includes(transaction.serviceType) &&
  transaction.status === "PENDING" &&
  Number.isFinite(new Date(transaction.createdAt).getTime()) &&
  new Date(transaction.createdAt).getTime() < HISTORICAL_BILL_REVIEW_BEFORE.getTime();

module.exports = { HISTORICAL_BILL_REVIEW_BEFORE, isHistoricalBillManualReview };
