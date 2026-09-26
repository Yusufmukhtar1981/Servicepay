const test = require("node:test");
const assert = require("node:assert/strict");
const {
  TelecomAbodeError,
  createTelecomAbodeService,
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

test("purchase is disabled by default and requires a successful matching validation when explicitly enabled", async () => {
  const { service: disabled } = setup(() => response({ status: "success" }));
  await assert.rejects(
    disabled.purchaseElectricity({
      disco: 1, meter_number: "123", meter_type: "prepaid", amount: "2000", request_id: "SP-1",
    }),
    { code: "PURCHASES_DISABLED" }
  );

  const { service } = setup((config) => config.url.endsWith("bill-validation")
    ? response({ status: "success", name: "Customer" })
    : response({
      status: "success",
      Status: "successful",
      message: "Electricity Payment Successful",
      "request-id": "API_1",
      service: "electricity",
      amount: "2000",
      token: "1234 5678",
    }), { enablePurchases: true });
  await assert.rejects(
    service.purchaseElectricity({
      disco: 1, meter_number: "123", meter_type: "prepaid", amount: "2000", request_id: "SP-1",
    }),
    { code: "VALIDATION_REQUIRED" }
  );
  assert.deepEqual(await service.validateMeter({
    disco: 1, meter_number: "123", meter_type: "prepaid",
  }).then(() => service.purchaseElectricity({
    disco: 1, meter_number: "123", meter_type: "prepaid", amount: 2000, request_id: "SP-2",
  })), {
    status: "SUCCESSFUL",
    service: "electricity",
    message: "Electricity Payment Successful",
    requestId: "API_1",
    amount: "2000",
    token: "1234 5678",
    transactionData: { token: "1234 5678" },
  });
});

test("sends exact electricity purchase fields and does not return tokens for postpaid purchases", async () => {
  const { service, calls } = setup((config) => config.url.endsWith("/bill/bill-validation")
    ? response({ status: "success", name: "Customer" })
    : response({
      status: "success",
      Status: "successful",
      "request-id": "API_E_2",
      token: "should-not-be-retained",
    }),
  { enablePurchases: true });
  await service.validateMeter({ disco: 2, meter_number: "9988", meter_type: "postpaid" });
  const result = await service.purchaseElectricity({
    disco: 2, meter_number: "9988", meter_type: "postpaid", amount: "2500", request_id: "SP-E-2",
  });
  assert.deepEqual(calls[1].data, {
    disco: 2,
    meter_number: "9988",
    meter_type: "postpaid",
    amount: "2500",
    "request-id": "SP-E-2",
  });
  assert.equal(result.status, "SUCCESSFUL");
  assert.equal("token" in result, false);
  assert.equal("transactionData" in result, false);
});

test("does not report success or retain token when a success response lacks provider correlation", async () => {
  const { service } = setup((config) => config.url.endsWith("bill-validation")
    ? response({ status: "success", name: "Customer" })
    : response({
      status: "success",
      Status: "successful",
      message: "Payment Successful",
      token: "must-not-be-persisted-without-correlation",
    }), { enablePurchases: true });
  await service.validateMeter({ disco: 1, meter_number: "123", meter_type: "prepaid" });
  assert.deepEqual(await service.purchaseElectricity({
    disco: 1, meter_number: "123", meter_type: "prepaid", amount: "100", request_id: "SP-UNCORRELATED",
  }), {
    status: "PENDING",
    service: "electricity",
    reason: "MISSING_PROVIDER_CORRELATION",
  });
});

test("blocks a repeated request-id locally and leaves an uncertain purchase un-retried", async () => {
  let callCount = 0;
  const service = createTelecomAbodeService({
    apiKey: "mock",
    enablePurchases: true,
    transport: async (config) => {
      callCount += 1;
      if (config.url.endsWith("bill-validation")) {
        return response({ status: "success", name: "Customer" });
      }
      throw new Error("transport details must not escape");
    },
  });
  await service.validateMeter({ disco: 1, meter_number: "123", meter_type: "prepaid" });
  await assert.rejects(service.purchaseElectricity({
    disco: 1, meter_number: "123", meter_type: "prepaid", amount: "100", request_id: "SP-ONCE",
  }), { code: "PROVIDER_REQUEST_UNCERTAIN" });
  await assert.rejects(service.purchaseElectricity({
    disco: 1, meter_number: "123", meter_type: "prepaid", amount: "100", request_id: "SP-ONCE",
  }), { code: "DUPLICATE_REQUEST_ID" });
  assert.equal(callCount, 2);
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

test("sends exact cable purchase fields after successful smartcard validation", async () => {
  const { service, calls } = setup((config) => config.url.endsWith("cable-validation")
    ? response({ status: "success", name: "Customer" })
    : response({
      status: "success",
      Status: "successful",
      message: "Cable Subscription Successful",
      "request-id": "API_C1",
      amount: "2950",
    }), { enablePurchases: true });
  await service.validateCable({ cable: 1, iuc: "1234567890" });
  assert.deepEqual(await service.purchaseCable({
    cable: 1, iuc: "1234567890", cable_plan: "dstv-padi", request_id: "SP-C1",
  }), {
    status: "SUCCESSFUL",
    service: "cable",
    message: "Cable Subscription Successful",
    requestId: "API_C1",
    amount: "2950",
  });
  assert.equal(calls[1].url, "https://telecomabode.com.ng/api/cable");
  assert.deepEqual(calls[1].data, {
    cable: 1,
    iuc: "1234567890",
    cable_plan: "dstv-padi",
    "request-id": "SP-C1",
  });
});

test("normalizes explicit pending/failed statuses but rejects missing or conflicting purchase statuses", async () => {
  for (const [providerStatus, expected] of [["pending", "PENDING"], ["failed", "FAILED"]]) {
    const { service } = setup((config) => config.url.endsWith("bill-validation")
      ? response({ status: "success", name: "Customer" })
      : response({ status: providerStatus }), { enablePurchases: true });
    await service.validateMeter({ disco: 1, meter_number: "1", meter_type: "postpaid" });
    assert.equal((await service.purchaseElectricity({
      disco: 1, meter_number: "1", meter_type: "postpaid", amount: "10", request_id: `SP-${expected}`,
    })).status, expected);
  }
  const { service } = setup((config) => config.url.endsWith("bill-validation")
    ? response({ status: "success", name: "Customer" })
    : response({ status: "success", Status: "failed" }), { enablePurchases: true });
  await service.validateMeter({ disco: 1, meter_number: "1", meter_type: "postpaid" });
  await assert.rejects(service.purchaseElectricity({
    disco: 1, meter_number: "1", meter_type: "postpaid", amount: "10", request_id: "SP-CONFLICT",
  }), { code: "INVALID_PROVIDER_RESPONSE" });
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
    status: "SUCCESSFUL",
    requestId: "REQ-1",
    amount: "2000",
    token: "1234",
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