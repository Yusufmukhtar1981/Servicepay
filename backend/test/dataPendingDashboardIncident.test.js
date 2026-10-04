const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildDataPurchasePayload, normalizeDataPurchaseResponse, createTelecomAbodeService,
} = require("../services/telecomAbode.service");
const { createTelecomAbodeDataReconciliationService } =
  require("../services/telecomAbodeDataReconciliation.service");
const { createTelecomAbodeReconciliationWorker } =
  require("../services/telecomAbodeReconciliationWorker.service");
const reference = "DATA-1791104577413-ED1D45C7";
const purchase = body => normalizeDataPurchaseResponse({ "request-id": reference, ...body },
  { requestId: reference });
const lookup = body => createTelecomAbodeService({
  apiKey: "unit-only-key",
  transport: async config => {
    assert.equal(config.method, "GET");
    return { status: 200, data: { "request-id": reference, amount: "90", ...body } };
  },
}).getTransactionByRequestId(reference);
const tx = {
  reference, providerRequestId: reference, serviceType: "DATA", provider: "TELECOM_ABODE",
  status: "PENDING", dispatchStatus: "UNKNOWN", dispatchClaimedAt: new Date(),
};
test("live fail/failed plus processing is unresolved in purchase and lookup", async () => {
  const body = { status: "fail", Status: "failed",
    api_response: "Sorry! you don't have an active data bundle. processing..." };
  for (const result of [purchase(body), await lookup(body)]) {
    assert.equal(result.status, "PENDING");
    assert.equal(result.documentedDataStatus, false);
    assert.equal(result.contradictory, true);
    assert.equal(result.confirmedFailureReason, undefined);
  }
  let mutations = 0;
  const service = createTelecomAbodeDataReconciliationService({
    transactionModel: { findOne: () => ({ lean: async () => tx }) },
    getTransactionByRequestId: () => lookup(body),
    settleOutcome: async () => { mutations++; },
  });
  const result = await service.reconcileByReference(reference);
  assert.equal(result.body.outcome, "UNKNOWN");
  assert.equal(result.body.providerLookup, "CONTRADICTORY");
  assert.equal(result.evidence.rawOutcome, "FAILED");
  assert.equal(mutations, 0);
});
test("reference-bound live network-recipient rejection can use the atomic refund path", async () => {
  const result = await lookup({ status: "fail", Status: "failed",
    api_response: "Invalid mtn phone number" });
  assert.equal(result.confirmedFailureReason, "INVALID_NETWORK_RECIPIENT");
  let attempts = 0;
  const service = createTelecomAbodeDataReconciliationService({
    transactionModel: { findOne: () => ({ lean: async () => tx }) },
    getTransactionByRequestId: async () => result,
    settleOutcome: async input => {
      attempts++;
      assert.equal(input.requestId, reference);
      assert.equal(input.evidence.service, "data");
      assert.equal(input.evidence.amount, "90");
      assert.equal(input.source, "STATUS_QUERY");
      return { status: "REFUNDED", transaction: tx };
    },
  });
  assert.equal((await service.reconcileByReference(reference)).body.status, "FAILED");
  assert.equal(attempts, 1);
});
test("blank, generic, gifted and processing failure lookups cannot authorize refunds", async () => {
  for (const message of ["", "Invalid MSISDN", "processing...",
    "Invalid mtn phone number, processing...", "You have gifted 200MB."]) {
    const result = await lookup({ status: "fail", Status: "failed", api_response: message });
    assert.equal(result.confirmedFailureReason, undefined);
    let mutations = 0;
    const service = createTelecomAbodeDataReconciliationService({
      transactionModel: { findOne: () => ({ lean: async () => tx }) },
      getTransactionByRequestId: async () => result,
      settleOutcome: async () => { mutations++; },
    });
    assert.equal((await service.reconcileByReference(reference)).body.outcome, "UNKNOWN");
    assert.equal(mutations, 0);
  }
});
test("success/completed/delivered and failed/rejected/declined normalize explicitly", async () => {
  for (const status of ["success", "successful", "completed", "delivered"]) {
    assert.equal(purchase({ status }).status, "SUCCESS");
    assert.equal((await lookup({ status })).status, "SUCCESS");
  }
  for (const status of ["fail", "failed", "failure", "rejected", "declined"]) {
    assert.equal(purchase({ status }).status, "FAILED");
    assert.equal((await lookup({ status })).status, "FAILED");
  }
  assert.equal(purchase({ status: true }).status, "PENDING");
  assert.equal(purchase({ status: "rejected", Status: "delivered" }).status, "PENDING");
});
test("adapter rejects absent, invalid, literal undefined and nonnormalized recipients", () => {
  for (const phone of [null, undefined, "", "undefined", "null", "0801", "+2348031234567"]) {
    assert.throws(() => buildDataPurchasePayload({
      network: 1, plan: 187, phone, request_id: reference,
      planMetadata: { plan_id: 187, network: 1 },
    }));
  }
  const payload = buildDataPurchasePayload({
    network: 1, plan: 187, phone: "08031234567", request_id: reference,
    planMetadata: { plan_id: 187, network: 1 },
  });
  assert.equal(payload.phone, "08031234567");
  assert.equal(payload.bypass, false);
  assert.equal(typeof payload.bypass, "boolean");
  assert.equal(Object.hasOwn(payload, "ported_number"), false);
});
test("worker persists actual uncertainty rather than mislabeled normalized PENDING", async () => {
  let row = tx, update;
  const worker = createTelecomAbodeReconciliationWorker({
    model: {
      findOneAndUpdate: () => ({ lean: async () => { const value = row; row = null; return value; } }),
      updateOne: async (_filter, value) => { update = value; },
    },
    data: { reconcileByReference: async () => ({
      body: { outcome: "UNKNOWN", providerStatus: "PENDING", providerLookup: "CONTRADICTORY" },
      evidence: { observedStatus: "PENDING", rawOutcome: "FAILED", requestIdMatches: true },
    }) },
  });
  await worker.run();
  assert.equal(update.$set["providerResponse.statusReconciliation.outcome"], "UNKNOWN");
  assert.equal(update.$set["providerResponse.statusReconciliation.reason"], "CONTRADICTORY");
  assert.equal(update.$set["providerResponse.statusReconciliation.evidence"].rawOutcome, "FAILED");
});