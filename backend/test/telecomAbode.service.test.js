const test = require("node:test");
const assert = require("node:assert/strict");
const {
  TelecomAbodeError,
  createTelecomAbodeService,
  normalizePurchase,
} = require("../services/telecomAbode.service");

const response = (data, status = 200) => ({ status, data });

const setup = (handler, options = {}) => {
  const calls = [];
  const service = createTelecomAbodeService({
    apiKey: "test-only-telecom-key",
    transport: async (config) => {
      calls.push(config);
      return handler(config, calls.length);
    },
    ...options,
  });
  return { service, calls };
};

test("fails closed without an API key before invoking the injected transport", async () => {
  let called = false;
  const service = createTelecomAbodeService({
    apiKey: "",
    transport: async () => {
      called = true;
      return response([]);
    },
  });

  await assert.rejects(service.getElectricityProviders, (error) =>
    error instanceof TelecomAbodeError &&
    error.code === "MISSING_API_KEY" &&
    !error.message.includes("test-only-telecom-key")
  );
  assert.equal(called, false);
});

test("constructs server-side authentication headers and dynamically retrieves electricity providers", async () => {
  const { service, calls } = setup(() => response({
    status: "success",
    data: [{ id: 1, name: "Ikeja Electric" }, { id: "8", name: "Abuja Electric" }],
  }));

  assert.deepEqual(await service.getElectricityProviders(), [
    { id: 1, name: "Ikeja Electric" },
    { id: 8, name: "Abuja Electric" },
  ]);
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].url, "https://telecomabode.com.ng/api/get-bill");
  assert.deepEqual(calls[0].headers, {
    Authorization: "Token test-only-telecom-key",
    "Content-Type": "application/json",
    Accept: "application/json",
  });
  assert.doesNotMatch(JSON.stringify(await service.getElectricityProviders().catch(() => null)), /test-only-telecom-key/);
});

test("rejects ambiguous or malformed provider responses instead of inventing a list", async () => {
  const { service } = setup(() => response({ status: "success", data: [{ id: 1, name: "A" }, { id: 1, name: "B" }] }));
  await assert.rejects(service.getElectricityProviders, { code: "INVALID_PROVIDER_RESPONSE" });
  const missingCollection = createTelecomAbodeService({
    apiKey: "mock",
    transport: async () => response({ status: "success", message: "ok" }),
  });
  await assert.rejects(missingCollection.getElectricityProviders, { code: "INVALID_PROVIDER_RESPONSE" });
});

test("validates meter numbers with the exact documented payload and normalized customer details", async () => {
  const { service, calls } = setup(() => response({
    status: "success",
    name: " IBRAHIM MUSA ",
    customer_address: "  1 Sample Road ",
    message: " verified ",
    internal_field: "must not escape",
  }));

  assert.deepEqual(await service.validateMeter({
    disco: "1", meter_number: "1234567890", meter_type: "PREPAID",
  }), {
    status: "SUCCESSFUL",
    name: "IBRAHIM MUSA",
    customerAddress: "1 Sample Road",
    message: "verified",
  });
  assert.equal(calls[0].url, "https://telecomabode.com.ng/api/bill/bill-validation");
  assert.deepEqual(calls[0].data, {
    disco: 1,
    meter_number: "1234567890",
    meter_type: "prepaid",
  });
});

test("validation rejects missing and unrecognized provider statuses", async () => {
  const { service } = setup(() => response({ name: "CUSTOMER" }));
  await assert.rejects(
    service.validateMeter({ disco: 1, meter_number: "123", meter_type: "prepaid" }),
    { code: "INVALID_PROVIDER_RESPONSE" }
  );
  await assert.rejects(
    service.validateMeter({ disco: 0, meter_number: "123", meter_type: "prepaid" }),
    /positive integer/
  );
  const unrecognized = setup(() => response({ status: "maybe", name: "CUSTOMER" })).service;
  await assert.rejects(
    unrecognized.validateMeter({ disco: 1, meter_number: "123", meter_type: "prepaid" }),
    { code: "INVALID_PROVIDER_RESPONSE" }
  );
});

test("retrieves cable plans dynamically with an encoded query and validates smartcards", async () => {
  const { service, calls } = setup((config) => config.method === "GET"
    ? response([{ id: "1", name: "GOtv Max" }, { id: "2", name: "GOtv Jolli" }])
    : response({ status: "success", name: "IBRAHIM MUSA", customer_address: "Address" }));

  assert.deepEqual(await service.getCableProviders({ cable: "Gotv & More" }), [
    { id: 1, name: "GOtv Max" },
    { id: 2, name: "GOtv Jolli" },
  ]);
  assert.equal(calls[0].url, "https://telecomabode.com.ng/api/get-cable-providers?cable=Gotv%20%26%20More");
  assert.deepEqual(await service.validateCable({ cable: "3", iuc: "1234567890" }), {
    status: "SUCCESSFUL",
    name: "IBRAHIM MUSA",
    customerAddress: "Address",
  });
  assert.equal(calls[1].url, "https://telecomabode.com.ng/api/cable/cable-validation");
  assert.deepEqual(calls[1].data, { cable: 3, iuc: "1234567890" });
});

test("purchase methods remain locked even when caller supplies the former enable option", async () => {
  let callCount = 0;
  const { service } = setup(() => {
    callCount += 1;
    return response({ status: "success" });
  }, { enablePurchases: true });

  await assert.rejects(service.purchaseElectricity({
    disco: 1, meter_number: "123", meter_type: "prepaid", amount: "2000", request_id: "SP-LOCKED-E",
  }), { code: "PURCHASES_DISABLED" });
  await assert.rejects(service.purchaseCable({
    cable: 1, iuc: "1234567890", cable_plan: "plan-1", request_id: "SP-LOCKED-C",
  }), { code: "PURCHASES_DISABLED" });
  assert.equal(callCount, 0);
});

test("pure purchase normalizer handles explicit successful, failed, and pending fixtures", () => {
  const options = {
    service: "electricity",
    meterType: "prepaid",
    servicepayReference: "SP-100",
  };
  assert.deepEqual(normalizePurchase({
    status: "success",
    Status: "successful",
    "request-id": "TA-100",
    amount: "2000",
    message: " Payment successful ",
    token: "1234 5678",
  }, options), {
    provider: "TELECOM_ABODE",
    service: "electricity",
    servicepayReference: "SP-100",
    status: "SUCCESS",
    rawProviderStatus: "success",
    message: "Payment successful",
    providerMessage: "Payment successful",
    requestId: "TA-100",
    providerReference: "TA-100",
    amount: "2000",
    token: "1234 5678",
    transactionData: { token: "1234 5678" },
  });
  assert.equal(normalizePurchase({
    status: "failed",
    "request-id": "TA-101",
  }, options).status, "FAILED");
  assert.equal(normalizePurchase({
    status: "pending",
    "request-id": "TA-102",
  }, options).status, "PENDING");
});

test("pure purchase normalizer preserves unknown status, rejects ambiguity, and fails closed without correlation", () => {
  const options = {
    service: "electricity",
    meterType: "prepaid",
    servicepayReference: "SP-200",
  };
  assert.equal(normalizePurchase({ status: "unknown" }, options).status, "UNKNOWN");
  assert.throws(() => normalizePurchase({
    status: "success",
    Status: "failed",
  }, options), {
    code: "INVALID_PROVIDER_RESPONSE",
  });
  assert.deepEqual(normalizePurchase({
    status: "success",
    token: "must-not-be-retained-without-correlation",
  }, options), {
    provider: "TELECOM_ABODE",
    service: "electricity",
    servicepayReference: "SP-200",
    status: "PENDING",
    reason: "MISSING_PROVIDER_CORRELATION",
  });
  assert.equal("token" in normalizePurchase({ status: "pending", token: "unresolved-token" }, options), false);
});

test("pure purchase normalizer only retains prepaid electricity tokens", () => {
  const responseData = {
    status: "success",
    "request-id": "TA-300",
    token: "1234 5678",
  };
  const prepaid = normalizePurchase(responseData, {
    service: "electricity",
    meterType: "prepaid",
    servicepayReference: "SP-300",
  });
  assert.equal(prepaid.token, "1234 5678");
  assert.deepEqual(prepaid.transactionData, { token: "1234 5678" });

  const postpaid = normalizePurchase(responseData, {
    service: "electricity",
    meterType: "postpaid",
    servicepayReference: "SP-301",
  });
  assert.equal("token" in postpaid, false);
  assert.equal("transactionData" in postpaid, false);
});

test("transaction lookup performs a bare GET and selects only one exact request-id match", async () => {
  const { service, calls } = setup(() => response({
    status: "success",
    transactions: [
      { "request-id": "prefix-REQ-1-suffix", status: "success", token: "wrong" },
      { "request-id": "REQ-1", status: "success", amount: 2000, token: "1234" },
    ],
  }));
  assert.deepEqual(await service.getTransactionByRequestId("REQ-1"), {
    provider: "TELECOM_ABODE",
    status: "SUCCESS",
    rawProviderStatus: "success",
    requestId: "REQ-1",
    providerReference: "REQ-1",
    amount: "2000",
    token: "1234",
    meterToken: "1234",
  });
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].url, "https://telecomabode.com.ng/api/transactions");
  assert.equal("params" in calls[0], false);
});

test("transaction status lookup fails closed for absent collections and duplicate exact matches", async () => {
  const single = setup(() => response({ status: "success", "request-id": "REQ-1" })).service;
  await assert.rejects(single.getTransactionByRequestId("REQ-1"), {
    code: "TRANSACTION_QUERY_UNDOCUMENTED",
  });
  const duplicate = setup(() => response([
    { status: "success", "request-id": "REQ-1" },
    { status: "failed", "request-id": "REQ-1" },
  ])).service;
  await assert.rejects(duplicate.getTransactionByRequestId("REQ-1"), {
    code: "AMBIGUOUS_TRANSACTION",
  });
});

test("transaction lookup normalizes explicit statuses and leaves unknown statuses unresolved", async () => {
  for (const [rawStatus, normalizedStatus] of [
    ["success", "SUCCESS"],
    ["pending", "PENDING"],
    ["failed", "FAILED"],
  ]) {
    const { service } = setup(() => response([{
      "request-id": "REQ-STATUS",
      status: rawStatus,
      api_response: "provider status text",
    }]));
    const transaction = await service.getTransactionByRequestId("REQ-STATUS");
    assert.equal(transaction.status, normalizedStatus);
    assert.equal(transaction.rawProviderStatus, rawStatus);
    assert.equal(transaction.providerMessage, "provider status text");
    assert.equal(transaction.providerReference, "REQ-STATUS");
  }

  const unknown = setup(() => response([{
    "request-id": "REQ-UNKNOWN",
    status: "processing_unknown",
  }])).service;
  const unresolved = await unknown.getTransactionByRequestId("REQ-UNKNOWN");
  assert.equal(unresolved.status, "UNKNOWN");
  assert.equal(unresolved.providerReference, "REQ-UNKNOWN");
});

test("provider errors do not expose raw responses or credentials", async () => {
  const secret = "never-expose-this-api-key";
  const privateResponse = "private provider response containing customer details";
  const service = createTelecomAbodeService({
    apiKey: secret,
    transport: async () => response({ status: "success", message: privateResponse }, 500),
  });
  await assert.rejects(service.getElectricityProviders, (error) => {
    assert.equal(error.code, "PROVIDER_HTTP_ERROR");
    assert.doesNotMatch(error.message, new RegExp(secret));
    assert.doesNotMatch(error.message, new RegExp(privateResponse));
    assert.equal("providerResponse" in error, false);
    return true;
  });
});