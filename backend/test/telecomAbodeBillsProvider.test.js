const test = require("node:test");
const assert = require("node:assert/strict");
const { createTelecomAbodeBillsProvider, buildAirtimePayload, buildElectricityPayload,
  classify, financialReadiness } = require("../services/telecomAbodeBillsProvider.service");
const reference = "AIRTIME-20261002-TEST-0001";
const phone = "08000000000";
const networks = [1, 2, 3, 4].map((id, i) => ({ id, network: ["MTN", "Airtel", "Glo", "9mobile"][i] }));
const discos = [{ id: 1, name: "Ikeja Electric", abb: "IE", apidiscount: "0.90" }];
const success = (service = "airtime", extra = {}) => ({ status: "success", Status: "successful",
  "request-id": reference, service, amount: "100", ...extra });
const providerWith = ({ response = success(), http = 200, throws = false, claim = true, validDebit = true } = {}) => {
  const sends = [], claims = [];
  let claimed = false;
  let boundClaim;
  const provider = createTelecomAbodeBillsProvider({
    credentials: () => "unit-test-only-key",
    transactionModel: { findOneAndUpdate: async (filter, update) => {
      claims.push({ filter, update });
      if (!claim || claimed) return null;
      claimed = true;
      boundClaim = { _id: "fixture", customerId: "customer-fixture", reference,
        amount: filter.amount.$gte, serviceType: filter.serviceType, debitLedgerEntryId: "debit-fixture" };
      return boundClaim;
    } },
    ledgerModel: { findById: async () => validDebit ? {
      direction: "DEBIT", status: "POSTED", transactionId: boundClaim._id,
      user: boundClaim.customerId, reference, amount: boundClaim.amount, service: boundClaim.serviceType,
      idempotencyKey: `${boundClaim.serviceType}:${reference}:DEBIT`,
    } : null },
    transport: async options => {
      sends.push(options);
      if (options.method === "GET" && options.url.includes("get-networks")) return { status: 200, data: networks };
      if (options.method === "GET" && options.url.endsWith("get-bill")) return { status: 200, data: discos };
      if (throws) throw new Error("Never expose credential-bearing transport errors.");
      return { status: http, data: response };
    },
  });
  return { provider, sends, claims };
};
for (const network of [1, 2, 3, 4]) test(`Airtime network ${network} uses only verified Airtime fields`, () => {
  assert.deepEqual(buildAirtimePayload({ network: String(network).padStart(2, "0"), phone, amount: 100, requestId: reference }),
    { network, phone, amount: 100, type: "VTU", bypass: false, "request-id": reference });
});
test("Electricity uses live-proven disco and required phone, never provider_id", () => {
  const payload = buildElectricityPayload({ disco: 1, meterNumber: "12345067890", meterType: "PREPAID",
    phone, amount: 1000, requestId: reference });
  assert.equal(payload.disco, 1);
  assert.equal(payload.phone, phone);
  assert.equal(payload.meter_type, "prepaid");
  assert.equal("provider_id" in payload, false);
});
test("zero, negative, malformed price and oversized provider references are rejected", () => {
  for (const amount of [0, -1, NaN, Infinity, "", "1.234"]) assert.throws(() =>
    buildAirtimePayload({ network: 1, phone, amount, requestId: reference }));
  assert.throws(() => buildAirtimePayload({ network: 1, phone, amount: 100, requestId: "x".repeat(37) }));
});
test("authenticated live-shape catalogue parses network names and dynamic DISCOs", async () => {
  const { provider } = providerWith();
  assert.equal((await provider.getAirtimeNetworks())[3].displayName, "9mobile");
  const disco = (await provider.getElectricityProviders())[0];
  assert.equal(disco.providerId, 1);
  assert.equal(disco.advertisedDiscount, "0.90");
});
test("meter validation succeeds without debit or purchase", async () => {
  const { provider, sends, claims } = providerWith({ response: { status: "success", name: "Fixture",
    customer_address: "Fixture address" } });
  const result = await provider.validateMeter({ disco: 1, meterNumber: "12345067890", meterType: "prepaid" });
  assert.equal(result.verified, true);
  assert.equal(claims.length, 0);
  const call = sends.find(s => s.method === "POST");
  assert.ok(call.url.endsWith("/bill/bill-validation"));
  assert.deepEqual(call.data, { disco: 1, meter_number: "12345067890", meter_type: "prepaid" });
});
test("invalid meter does not claim a debit or send a purchase", async () => {
  const { provider, sends, claims } = providerWith({ http: 400, response: { status: "error" } });
  assert.equal((await provider.validateMeter({ disco: 1, meterNumber: "12345067890", meterType: "postpaid" })).verified, false);
  assert.equal(claims.length, 0);
  assert.equal(sends.some(s => s.url.endsWith("/bill")), false);
});
test("timeout remains unknown without leaking credentials or manufacturing cost", async () => {
  const { provider } = providerWith({ throws: true });
  const result = await provider.purchaseAirtime({ network: 1, phone, amount: 100, requestId: reference });
  assert.equal(result.outcome, "UNKNOWN");
  assert.equal(result.providerCost, null);
  assert.equal(JSON.stringify(result).includes("unit-test-only-key"), false);
});
test("duplicate concurrent adapter submission sends at most one provider POST", async () => {
  const { provider, sends } = providerWith();
  const input = { network: 1, phone, amount: 100, requestId: reference };
  const results = await Promise.allSettled([provider.purchaseAirtime(input), provider.purchaseAirtime(input)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(sends.filter(s => s.method === "POST" && s.url.endsWith("/airtime")).length, 1);
});
test("missing persisted debit/intent prevents dispatch", async () => {
  const { provider, sends } = providerWith({ claim: false });
  await assert.rejects(provider.purchaseAirtime({ network: 1, phone, amount: 100, requestId: reference }),
    { code: "BILLS_DISPATCH_CUSTODY_REQUIRED" });
  assert.equal(sends.filter(s => s.method === "POST").length, 0);
});
for (const httpStatus of [201, 202, 400, 401, 403, 422, 429, 500]) test(`HTTP ${httpStatus} never fabricates success/refund`, () => {
  const result = classify({ httpStatus, data: success(), service: "AIRTIME", reference });
  assert.notEqual(result.outcome, "SUCCESS");
  assert.equal(result.authoritative, false);
});
test("contradictory statuses and wrong references stay unknown", () => {
  for (const data of [success("airtime", { Status: "failed" }),
    success("airtime", { "request-id": "wrong-reference" }), success("electricity")]) {
    assert.equal(classify({ httpStatus: 200, data, service: "AIRTIME", reference }).outcome, "UNKNOWN");
  }
});
test("prepaid token is preserved only from bound terminal success", async () => {
  const token = "1234 5678 9012 3456 7890";
  const { provider, claims } = providerWith({ response: success("electricity", { token }) });
  const result = await provider.purchaseElectricity({ disco: 1, meterNumber: "12345067890", meterType: "prepaid",
    phone, amount: 1000, requestId: reference });
  assert.equal(result.outcome, "SUCCESS");
  assert.equal(result.receipt.token, token);
  assert.equal(result.providerCost, null);
  assert.equal(claims[0].filter["providerResponse.electricityValidation.verified"], true);
});
test("missing prepaid token stays unknown; postpaid preserves authoritative reference", () => {
  assert.equal(classify({ httpStatus: 200, data: success("electricity"), service: "ELECTRICITY",
    reference, meterType: "prepaid" }).outcome, "UNKNOWN");
  const postpaid = classify({ httpStatus: 200, data: success("electricity"), service: "ELECTRICITY",
    reference, meterType: "postpaid" });
  assert.equal(postpaid.outcome, "SUCCESS");
  assert.equal(postpaid.receipt.reference, reference);
});
test("query is read-only and raw/duplicate callbacks are never trusted evidence", async () => {
  const { provider, claims, sends } = providerWith();
  const result = await provider.query({ service: "AIRTIME", requestId: reference });
  assert.equal(result.outcome, "SUCCESS");
  assert.equal(provider.isVerifiedEvidence(result), true);
  assert.equal(provider.isVerifiedEvidence(success()), false);
  assert.equal(provider.isVerifiedEvidence({ ...result }), false);
  assert.equal(claims.length, 0);
  assert.equal(sends.every(s => s.method === "GET"), true);
  assert.equal(result.providerCost, null);
});
test("Airtime delivery may settle with accounting pending; Electricity validation still blocks", () => {
  assert.equal(financialReadiness.AIRTIME.ready, true);
  assert.equal(financialReadiness.AIRTIME.accountingPending, true);
  assert.equal(financialReadiness.ELECTRICITY.ready, false);
  assert.equal(Object.isFrozen(financialReadiness), true);
  assert.equal(financialReadiness.AIRTIME.reasons.some(r => r.includes("validation")), false);
});
test("all-zero and repeated-digit meters are rejected locally before any provider call", async () => {
  const { provider, sends, claims } = providerWith();
  for (const meterNumber of ["00000000000", "11111111111"]) {
    await assert.rejects(provider.validateMeter({ disco: 1, meterNumber, meterType: "prepaid" }),
      { code: "BILLS_INVALID_METER" });
  }
  assert.equal(sends.length, 0);
  assert.equal(claims.length, 0);
});
test("all-zero prepaid token cannot manufacture a completed electricity receipt", () => {
  const result = classify({ httpStatus: 200, service: "ELECTRICITY", reference, meterType: "prepaid",
    data: success("electricity", { token: "0000 0000 0000 0000 0000" }) });
  assert.equal(result.outcome, "UNKNOWN");
  assert.equal(result.receipt, null);
});
test("a mere ledger pointer cannot authorize provider dispatch", async () => {
  const { provider, sends } = providerWith({ validDebit: false });
  await assert.rejects(provider.purchaseAirtime({ network: 1, phone, amount: 100, requestId: reference }),
    { code: "BILLS_CANONICAL_DEBIT_REQUIRED" });
  assert.equal(sends.some(s => s.method === "POST"), false);
});