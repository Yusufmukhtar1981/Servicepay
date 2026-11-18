"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Evidence = require("../services/profitSharing.providerDebitEvidence");
const { createTelecomAbodeService } = require("../services/telecomAbode.service");
const M = require("../models/profitSharing.models");
const reference = "synthetic-provider-request";
const tx = { _id: "aaaaaaaaaaaaaaaaaaaaaaaa", provider: "TELECOM_ABODE",
  serviceType: "DATA", providerRequestId: reference };
function result(extra = {}, bodyExtra = {}, httpStatus = 200) {
  const normalized = { status: "SUCCESS", documentedDataStatus: true,
    service: "data", requestId: reference, ...extra };
  return Evidence.attachAuthenticatedPurchase(normalized, {
    httpStatus, requestId: reference,
    body: { "request-id": reference, amount: "250", old_balance: "1000.004603467313",
      new_balance: "750.004603467313", ...bodyExtra },
  });
}
function memoryStore() {
  const rows = new Map();
  const model = {
    async create(row) {
      if (rows.has(row._id)) throw Object.assign(Error("duplicate"), { code: 11000 });
      rows.set(row._id, structuredClone(row));
    },
    findById(id) { return { lean: async () => rows.get(id) }; },
  };
  return { rows, store: Evidence.createStore({ eventModel: model }) };
}
test("captures the exact supplier debit without rounding genuine sub-kobo provider balances", () => {
  const receipt = Evidence.evidenceFor(result());
  assert.equal(receipt.supplierDebitKobo, 25000);
  assert.equal(receipt.reportedAmountKobo, 25000);
  assert.equal(receipt.otherDirectCostsKobo, null);
  assert.equal(receipt.expensesVerified, false);
  assert.ok(Object.isFrozen(receipt));
  assert.equal(Object.hasOwn(receipt, "old_balance"), false);
  assert.equal(Object.hasOwn(receipt, "new_balance"), false);
});
test("the observed debit includes actual additional supplier charges rather than assuming zero fees", () => {
  assert.equal(Evidence.evidenceFor(result({}, { old_balance: "1000", new_balance: "740" }))
    .supplierDebitKobo, 26000);
  assert.equal(Evidence.evidenceFor(result({}, { old_balance: "1000", new_balance: "760" }))
    .supplierDebitKobo, 24000);
});
test("pending, failed, contradictory, mismatched, incomplete and fractional-kobo receipts fail closed", () => {
  const invalid = [
    result({ status: "PENDING" }), result({ status: "FAILED" }),
    result({ documentedDataStatus: false }), result({ contradictory: true }),
    result({ service: "airtime" }), result({ requestId: "different" }),
    result({}, { "request-id": "different" }), result({}, {}, 202),
    result({}, { old_balance: undefined }), result({}, { new_balance: "1000.004603467313" }),
    result({}, { new_balance: "750.004603467312" }),
    result({}, { old_balance: "-1000" }), result({}, { old_balance: "Infinity" }),
    result({}, { old_balance: "1000000000000000000", new_balance: "0" }),
    result({}, { old_balance: 10000000000000001, new_balance: 750 }),
    result({}, { old_balance: 1000.004603467313, new_balance: 750.004603467313 }),
  ];
  for (const value of invalid) assert.equal(Evidence.evidenceFor(value), null);
});
test("supplier costs cannot leak through customer JSON/spreading or be forged by an unsigned callback", async () => {
  const value = result();
  assert.equal(Evidence.evidenceFor(JSON.parse(JSON.stringify(value))), null);
  assert.equal(Evidence.evidenceFor({ ...value }), null);
  assert.equal(JSON.stringify(value).includes("supplierDebitKobo"), false);
  const { rows, store } = memoryStore();
  assert.equal((await store.record(tx, { ...value, supplierDebitKobo: 1 })).status,
    "NO_AUTHENTICATED_DEBIT_EVIDENCE");
  assert.equal(rows.size, 0);
});
test("receipt storage is append-only, exactly-once and bound to the original transaction", async () => {
  const { rows, store } = memoryStore();
  const walletBefore = JSON.stringify(tx), value = result();
  const simultaneous = await Promise.all([store.record(tx, value), store.record(tx, value)]);
  assert.deepEqual(simultaneous.map(row => row.status).sort(), ["ALREADY_RECORDED", "RECORDED"]);
  assert.equal((await store.record(tx, value)).status, "ALREADY_RECORDED");
  assert.equal(rows.size, 1);
  const row = rows.values().next().value;
  assert.equal(row.kind, "PROVIDER_DEBIT_EVIDENCE");
  assert.equal(row.data.supplierDebitKobo, 25000);
  assert.equal(row.data.expensesVerified, false);
  assert.equal(new M.Event(row).validateSync(), undefined);
  assert.equal(JSON.stringify(tx), walletBefore);
  await assert.rejects(store.record(tx, result({}, { new_balance: "740.004603467313" })),
    { code: "PROVIDER_DEBIT_EVIDENCE_CONFLICT" });
  assert.equal(rows.values().next().value.data.supplierDebitKobo, 25000);
});
test("receipt storage rejects another provider, service or original request reference", async () => {
  const { store, rows } = memoryStore();
  for (const changed of [{ provider: "OTHER" }, { serviceType: "AIRTIME" },
    { providerRequestId: "another-request" }]) {
    await assert.rejects(store.record({ ...tx, ...changed }, result()),
      { code: "PROVIDER_DEBIT_REFERENCE_MISMATCH" });
  }
  assert.equal(rows.size, 0);
});
test("storage failure remains explicit and never changes any financial object", async () => {
  const before = JSON.stringify(tx);
  const store = Evidence.createStore({ eventModel: { create: async () => {
    throw Object.assign(Error("synthetic unavailable store"), { code: "UNAVAILABLE" });
  } } });
  await assert.rejects(store.record(tx, result()), { code: "UNAVAILABLE" });
  assert.equal(JSON.stringify(tx), before);
});
test("the existing authenticated DATA transport passes real receipt evidence privately", async () => {
  const service = createTelecomAbodeService({
    apiKey: "synthetic-test-key", audit() {},
    transactionModel: { findOneAndUpdate: async () => ({ _id: tx._id }) },
    transport: async config => {
      if (config.method === "GET") return { status: 200, data: config.url.includes("get-networks")
        ? ["MTN", "Airtel", "Glo", "9mobile"].map((network, index) => ({ id: index + 1, network }))
        : [{ plan_id: 1, network: "MTN", datasize: "1GB", type: "SME", day: "30", price: 250 }] };
      assert.equal(config.method, "POST");
      assert.equal(config.headers.Authorization, "Token synthetic-test-key");
      return { status: 200, data: { status: "success", Status: "successful",
        "request-id": config.data["request-id"], service: "data", amount: "250",
        old_balance: 1000, new_balance: 750 } };
    },
  });
  await service.getDataPlans();
  const value = await service.purchaseData({ network: 1, phone: "08000000000",
    plan: 1, request_id: reference, transactionId: tx._id });
  assert.equal(value.status, "SUCCESS");
  assert.equal(Evidence.evidenceFor(value).supplierDebitKobo, 25000);
  assert.equal(JSON.stringify(value).includes("750"), false);
});
