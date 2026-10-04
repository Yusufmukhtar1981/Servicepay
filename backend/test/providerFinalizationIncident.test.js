const test = require("node:test");
const assert = require("node:assert/strict");
const { classify } = require("../services/telecomAbodeBillsProvider.service");
const { createTelecomAbodeService } = require("../services/telecomAbode.service");
const { createTelecomAbodeDataReconciliationService } = require("../services/telecomAbodeDataReconciliation.service");
const { createTelecomAbodeReconciliationWorker } = require("../services/telecomAbodeReconciliationWorker.service");
const ref = "ELC-INCIDENT-TEST-000001";
const token = "1234-5678-9012-3456-7890";
const electricity = (extra = {}) => classify({ httpStatus: 200, service: "ELECTRICITY",
  meterType: "prepaid", reference: ref,
  data: { status: "success", Status: "successful", "request-id": ref,
    token: token + " (Unit 11.5)", amount: "5000", ...extra } });
test("provider token plus Unit suffix produces separate exact token and units", () => {
  const e = electricity();
  assert.equal(e.outcome, "SUCCESS");
  assert.equal(e.receipt.token, token);
  assert.equal(e.receipt.units, "11.5");
  assert.equal(e.providerCost, null);
});
test("contradictory, malformed, multiple and absent tokens cannot manufacture prepaid success", () => {
  for (const extra of [
    { token: undefined }, { token: token + " 1234" },
    { token: token + " (Unit 11.5)", units: "50" },
    { token: "0000-0000-0000-0000-0000 (Unit 11.5)" },
    { "request-id": "another-request" }, { Status: "failed" },
    { api_response: "Failed transaction" }, { status: true, Status: 200 },
  ]) assert.equal(electricity(extra).authoritative, false);
});
test("semantic success variants work only with bound reference and fulfillment", () => {
  for (const status of ["SUCCESS", "Successful", "COMPLETED", "delivered"]) {
    assert.equal(electricity({ status, Status: status }).outcome, "SUCCESS");
  }
});
for (const status of ["successful", "pending"]) test(`DATA lookup without service handles ${status} without redispatch`, async () => {
  const requestId = "DATA-INCIDENT-TEST-000001";
  let settlements = 0;
  const calls = [];
  const provider = createTelecomAbodeService({ apiKey: "unit-test-only-key",
    transport: async input => { calls.push(input); return { status: 200,
      data: { status: status === "pending" ? "pending" : "success",
        Status: status === "pending" ? "processing" : status, "request-id": requestId, amount: "90" } }; } });
  const reconciliation = createTelecomAbodeDataReconciliationService({
    transactionModel: { findOne: () => ({ lean: async () => ({ reference: requestId,
      providerRequestId: requestId, provider: "TELECOM_ABODE", serviceType: "DATA",
      status: "PENDING", dispatchStatus: "UNKNOWN", dispatchClaimedAt: new Date() }) }) },
    getTransactionByRequestId: provider.getTransactionByRequestId,
    settleOutcome: async input => { settlements++; assert.equal(input.evidence.service, "data");
      return { status: "SETTLED", transaction: { reference: requestId } }; },
  });
  const result = await reconciliation.reconcileByReference(requestId);
  assert.equal(result.body.outcome, status === "pending" ? "PENDING" : "SUCCESS");
  assert.equal(settlements, status === "pending" ? 0 : 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "GET");
});
test("bounded recovery uses only original identities and prevents overlapping local passes", async () => {
  const rows = ["DATA", "AIRTIME", "ELECTRICITY"].map((serviceType, i) =>
    ({ _id: i, reference: "original-" + i, customerId: "owner", serviceType }));
  const seen = [], updates = [], filters = [];
  const worker = createTelecomAbodeReconciliationWorker({
    model: { findOneAndUpdate: filter => { filters.push(filter); return { lean: async () => rows.shift() }; },
      updateOne: async (...args) => updates.push(args) },
    data: { reconcileByReference: async ref => { seen.push(ref); return { body: { outcome: "PENDING" } }; } },
    airtime: { reconcilePendingPurchase: async ({ transactionId }) => { seen.push(transactionId); return {}; } },
    electricity: { requery: async (customer, id) => { assert.equal(customer, "owner"); seen.push(id); return {}; } },
  });
  await Promise.all([worker.run(), worker.run()]);
  assert.deepEqual(seen, ["original-0", 1, 2]);
  assert.equal(updates.length, 3);
  assert.equal(filters[0].status, "PENDING");
  assert.deepEqual(filters[0].dispatchStatus, { $in: ["SENDING", "UNKNOWN"] });
  assert.equal(updates[0][1].$set["providerResponse.statusReconciliation.outcome"], "PENDING");
});
test("generic failed lookup without DATA service cannot authorize refund", async () => {
  let refunds = 0;
  const requestId = "DATA-INCIDENT-FAIL-00001";
  const service = createTelecomAbodeDataReconciliationService({
    transactionModel: { findOne: () => ({ lean: async () => ({
      reference: requestId, providerRequestId: requestId, serviceType: "DATA",
      provider: "TELECOM_ABODE", status: "PENDING", dispatchStatus: "UNKNOWN",
      dispatchClaimedAt: new Date(),
    }) }) },
    getTransactionByRequestId: async () => ({ requestId, providerReference: requestId,
      status: "FAILED", rawProviderStatus: "failed", documentedDataStatus: true }),
    settleOutcome: async () => { refunds++; },
  });
  const result = await service.reconcileByReference(requestId);
  assert.equal(result.body.providerLookup, "FAILURE_UNCONFIRMED");
  assert.equal(refunds, 0);
});