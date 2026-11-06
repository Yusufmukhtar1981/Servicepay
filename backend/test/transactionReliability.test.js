const test = require("node:test");
const assert = require("node:assert/strict");
const { paymentLifecycleState, automaticVerificationBlocked,
  MAX_AUTOMATIC_VERIFICATION_ATTEMPTS } = require("../services/billVerificationPolicy.service");
const { summarize, ledgerMismatch } = require("../services/transactionReliability.service");
const bill = extra => ({ serviceType: "DATA", provider: "TELECOM_ABODE",
  status: "PENDING", createdAt: new Date("2026-11-05"), ...extra });

test("seven lifecycle states are additive, terminal-first, and never mutate custody", () => {
  const cases = [
    [bill({ dispatchStatus: "READY" }), "CREATED"],
    [bill({ dispatchStatus: "SENDING", dispatchClaimedAt: new Date() }), "PROCESSING"],
    [bill({ dispatchStatus: "CLAIMED", dispatchClaimedAt: new Date("2026-10-23") }), "MANUAL_REVIEW"],
    [bill({ dispatchStatus: "SENDING", dispatchClaimedAt: new Date("2026-10-23") }), "PENDING_VERIFICATION"],
    [bill({ dispatchStatus: "UNKNOWN" }), "PENDING_VERIFICATION"],
    [bill({ status: "SUCCESSFUL", providerResponse: { statusReconciliation: { attemptCount: 1000 } } }), "SUCCESS"],
    [bill({ status: "FAILED" }), "FAILED"],
    [bill({ status: "REFUNDED" }), "REFUNDED"],
    [bill({ status: "FAILED", dispatchStatus: "REFUNDED", reversalLedgerEntryId: "credit" }), "REFUNDED"],
    [bill({ status: "FAILED", debitLedgerEntryId: "held" }), "MANUAL_REVIEW"],
    [bill({ providerResponse: { statusReconciliation: { attemptCount: 12 } } }), "MANUAL_REVIEW"],
    [bill({ createdAt: new Date("2026-10-01") }), "MANUAL_REVIEW"],
  ];
  for (const [tx, state] of cases) {
    const before = JSON.stringify(tx); Object.freeze(tx);
    assert.equal(paymentLifecycleState(tx), state);
    assert.equal(JSON.stringify(tx), before);
  }
});
test("automatic limit applies only to pending Telecom Abode DATA/AIRTIME", () => {
  assert.equal(MAX_AUTOMATIC_VERIFICATION_ATTEMPTS, 12);
  for (const serviceType of ["DATA", "AIRTIME"]) {
    assert.equal(automaticVerificationBlocked(bill({ serviceType,
      providerResponse: { statusReconciliation: { attemptCount: 11 } } })), false);
    assert.equal(automaticVerificationBlocked(bill({ serviceType,
      providerResponse: { statusReconciliation: { attemptCount: 12 } } })), true);
  }
  for (const extra of [{ status: "SUCCESSFUL" }, { serviceType: "ELECTRICITY" }, { provider: "CLUBKONNECT" }]) {
    assert.equal(automaticVerificationBlocked(bill({ ...extra,
      providerResponse: { statusReconciliation: { attemptCount: 1000 } } })), false);
  }
});
test("diagnostic metrics have explicit denominators and no invented timing or HTTP rate", () => {
  const empty = summarize([]);
  assert.equal(empty.summary.successRate, null);
  assert.equal(empty.summary.averageRecordedSettlementMs, null);
  assert.equal(empty.summary.httpErrorRate, null);
  const output = summarize([
    bill({ status: "SUCCESSFUL", providerResponse: {
      telecomAbodeSettlement: { receivedAt: new Date("2026-11-05T00:00:02Z") }, httpStatus: 200 } }),
    bill({ status: "REFUNDED", providerResponse: { httpStatus: 422 } }),
    bill({}),
  ]);
  assert.equal(output.summary.total, 3);
  assert.equal(output.summary.successRate, 33.33);
  assert.equal(output.summary.failureRate, 33.33);
  assert.equal(output.summary.httpErrorRate, 50);
  assert.equal(output.summary.averageRecordedSettlementMs, 2000);
  assert.equal(output.summary.settlementSamples, 1);
});
test("ledger checks detect ownership, amount, missing links and balance inconsistencies without writes", () => {
  const tx = { _id: "tx", customerId: "owner", amount: 30 };
  const entry = { transactionId: "tx", user: "owner", amount: 30,
    direction: "DEBIT", openingBalance: 100, closingBalance: 70 };
  assert.equal(ledgerMismatch(tx, entry, "DEBIT"), false);
  for (const bad of [null, { ...entry, user: "other" }, { ...entry, amount: 60 },
    { ...entry, transactionId: "other" }, { ...entry, closingBalance: -1 },
    { ...entry, closingBalance: 90 }, { ...entry, direction: "CREDIT" }]) {
    assert.equal(ledgerMismatch(tx, bad, "DEBIT"), true);
  }
  assert.equal(ledgerMismatch(tx, { ...entry, direction: "CREDIT", openingBalance: 70,
    closingBalance: 100 }, "CREDIT"), false);
  const manual = { ...tx, debitLedgerEntryId: "original-debit", reversalTransactionId: "refund-tx" };
  const credit = { ...entry, direction: "CREDIT", transactionId: "refund-tx",
    reversalOf: "original-debit", openingBalance: 70, closingBalance: 100 };
  assert.equal(ledgerMismatch(manual, credit, "CREDIT"), false);
  assert.equal(ledgerMismatch(manual, { ...credit, reversalOf: "wrong-debit" }, "CREDIT"), true);
});
