const { test } = require("node:test");
const assert = require("node:assert/strict");
const { isHistoricalBillManualReview } = require("../services/historicalBillManualReview.service");
const tx = overrides => ({
  provider: "TELECOM_ABODE", serviceType: "DATA", status: "PENDING",
  createdAt: new Date("2026-10-21T08:19:58.891Z"), ...overrides,
});
test("only historical pending Telecom Abode DATA/AIRTIME require manual review", () => {
  assert.equal(isHistoricalBillManualReview(tx()), true);
  assert.equal(isHistoricalBillManualReview(tx({ serviceType: "AIRTIME" })), true);
  for (const serviceType of ["ELECTRICITY", "WALLET", "CABLE"])
    assert.equal(isHistoricalBillManualReview(tx({ serviceType })), false);
  assert.equal(isHistoricalBillManualReview(tx({ provider: "CLUBKONNECT" })), false);
  for (const status of ["SUCCESSFUL", "SUCCESS", "FAILED", "REFUNDED"])
    assert.equal(isHistoricalBillManualReview(tx({ status })), false);
});
test("new admissions remain automatically reconcilable", () => {
  for (const createdAt of ["2026-10-22T00:00:00.000Z", "2026-10-23T00:00:00.000Z"])
    assert.equal(isHistoricalBillManualReview(tx({ createdAt })), false);
  assert.equal(isHistoricalBillManualReview(tx({ createdAt: undefined })), false);
});
test("manual hold never changes the historical record", () => {
  const record = Object.freeze(tx());
  const before = JSON.stringify(record);
  assert.equal(isHistoricalBillManualReview(record), true);
  assert.equal(JSON.stringify(record), before);
});
test("historical DATA lookup performs no provider request or settlement", async () => {
  const { createTelecomAbodeDataReconciliationService } =
    require("../services/telecomAbodeDataReconciliation.service");
  const service = createTelecomAbodeDataReconciliationService({
    transactionModel: { findOne: () => ({ lean: async () => tx() }) },
    getTransactionByRequestId: () => { throw Error("Provider query prohibited"); },
    settleOutcome: () => { throw Error("Settlement prohibited"); },
  });
  const result = await service.reconcileByReference("historical");
  assert.equal(result.httpStatus, 202);
  assert.equal(result.body.manualReviewRequired, true);
});
test("late verified DATA evidence cannot settle or refund the historical batch", async () => {
  const { createTelecomAbodeDataSettlementService } =
    require("../services/telecomAbodeDataSettlement.service");
  const reference = "historical-original";
  const historical = tx({ reference, providerRequestId: reference });
  const service = createTelecomAbodeDataSettlementService({
    transactionModel: { find: () => ({
      limit: () => ({ lean: async () => [historical] }),
    }) },
    startSession: () => { throw Error("Financial session prohibited"); },
  });
  for (const outcome of ["SUCCESS", "FAILED"]) {
    const result = await service.settleTelecomAbodeDataOutcome({
      requestId: reference, outcome, source: "WEBHOOK",
      evidence: { requestId: reference, service: "data", verifiedSource: true },
    });
    assert.equal(result.status, "MANUAL_REVIEW_REQUIRED");
    assert.equal(historical.status, "PENDING");
  }
});
test("worker selection excludes historical billing without excluding Electricity", async () => {
  const { createTelecomAbodeReconciliationWorker } =
    require("../services/telecomAbodeReconciliationWorker.service");
  let filter;
  const worker = createTelecomAbodeReconciliationWorker({
    model: { findOneAndUpdate: value => {
      filter = value;
      return { lean: async () => null };
    } },
    data: {}, airtime: {}, electricity: {},
  });
  await worker.run();
  const boundary = filter.$and.find(clause =>
    clause.$or?.some(branch => branch.serviceType === "ELECTRICITY")).$or;
  assert.deepEqual(boundary[0], { serviceType: "ELECTRICITY" });
  assert.equal(boundary[1].createdAt.$gte.toISOString(), "2026-10-22T00:00:00.000Z");
  assert.equal(filter.status, "PENDING");
});
