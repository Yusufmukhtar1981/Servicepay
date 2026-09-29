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

test("transaction lookup uses the documented encoded GET and exact reference correlation", async () => {
  const target = "REQ /one";
  const { service, calls } = setup(() => response({
    status: "success",
    Status: "successful",
    service: "data",
    "request-id": target,
    amount: 2000,
    token: "must-never-escape-a-status-lookup",
  }));
  assert.deepEqual(await service.getTransactionByRequestId(target), {
    provider: "TELECOM_ABODE",
    status: "SUCCESS",
    rawProviderStatus: "success",
    documentedDataStatus: true,
    service: "data",
    requestId: target,
    providerReference: target,
    amount: "2000",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "GET");
  assert.equal(
    calls[0].url,
    `https://telecomabode.com.ng/api/transaction/${encodeURIComponent(target)}`,
  );
  assert.equal(calls[0].data, undefined);
});

test("transaction lookup rejects missing or mismatched references", async () => {
  const mismatch = setup(() => response({
    status: "success",
    "request-id": "OTHER-REQUEST",
  }));
  await assert.rejects(mismatch.service.getTransactionByRequestId("REQ-1"), {
    code: "TRANSACTION_REFERENCE_MISMATCH",
    statusCode: 502,
  });
  assert.equal(mismatch.calls.length, 1);
  assert.equal(mismatch.calls[0].method, "GET");

  const missing = setup(() => response({ status: "success" }));
  await assert.rejects(missing.service.getTransactionByRequestId("REQ-1"), {
    code: "MISSING_TRANSACTION_REFERENCE",
    statusCode: 502,
  });
  assert.equal(missing.calls.length, 1);
  assert.equal(missing.calls[0].method, "GET");
});

test("documented transaction lookup 404 is not-found, never a purchase failure", async () => {
  const { service, calls } = setup(() => response(
    { message: "Transaction not found", token: "never-retain-this" },
    404,
  ));
  await assert.rejects(service.getTransactionByRequestId("REQ-404"), {
    code: "TRANSACTION_NOT_FOUND",
    statusCode: 404,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "GET");
  assert.match(calls[0].url, /\/transaction\/REQ-404$/);
});

test("transaction lookup normalizes explicit statuses and leaves unknown statuses unresolved", async () => {
  for (const [rawStatus, pairedStatus, normalizedStatus] of [
    ["success", "successful", "SUCCESS"],
    ["pending", "processing", "PENDING"],
    ["fail", "failed", "FAILED"],
  ]) {
    const { service } = setup(() => response({
      "request-id": "REQ-STATUS",
      status: rawStatus,
      Status: pairedStatus,
      service: "data",
      api_response: "provider status text",
    }));
    const transaction = await service.getTransactionByRequestId("REQ-STATUS");
    assert.equal(transaction.status, normalizedStatus);
    assert.equal(transaction.rawProviderStatus, rawStatus);
    assert.equal(transaction.documentedDataStatus, normalizedStatus !== "PENDING");
    assert.equal(transaction.service, "data");
    assert.equal(transaction.providerMessage, "provider status text");
    assert.equal(transaction.providerReference, "REQ-STATUS");
  }

  const unknown = setup(() => response({
    "request-id": "REQ-UNKNOWN",
    status: "pending",
    Status: "processing",
    service: "data",
  })).service;
  const unresolved = await unknown.getTransactionByRequestId("REQ-UNKNOWN");
  assert.equal(unresolved.status, "PENDING");
  assert.equal(unresolved.documentedDataStatus, false);
  assert.equal(unresolved.service, "data");
  assert.equal(unresolved.providerReference, "REQ-UNKNOWN");
});

test("provider errors do not expose raw responses or credentials", async () => {
  const secret = "never-expose-this-api-key";
  const service = createTelecomAbodeService({
    apiKey: secret,
    transport: async () => response({
      status: "failed",
      code: "INVALID_PLAN",
      message: "Plan rejection for 08012345678 and customer@example.com Bearer very-secret-value",
      token: "very-secret-value",
      headers: { Authorization: secret },
    }, 500),
  });
  await assert.rejects(service.getElectricityProviders, (error) => {
    assert.equal(error.code, "PROVIDER_HTTP_ERROR");
    assert.doesNotMatch(error.message, new RegExp(secret));
    assert.equal("providerResponse" in error, false);
    const evidence = JSON.stringify(error.providerEvidence);
    assert.doesNotMatch(evidence, new RegExp(secret));
    assert.doesNotMatch(evidence, /very-secret-value|08012345678|customer@example.com/);
    assert.match(evidence, /Plan rejection/);
    return true;
  });
});

test("non-2xx errors preserve bounded JSON, text, empty, and malformed body evidence", async () => {
  const cases = [
    {
      body: {
        status: "failed",
        code: "INVALID_PLAN",
        "request-id": "REQ-400",
        message: "Plan rejected for 08012345678 and customer@example.com",
        token: "do-not-retain",
        headers: { Authorization: "Bearer do-not-retain" },
      },
      expectedStatus: 400,
      expectedBodyType: "json",
    },
    {
      body: "Plan rejected for 08012345678. token=do-not-retain",
      expectedStatus: 400,
      expectedBodyType: "text",
    },
    { body: "", expectedStatus: 400, expectedBodyType: "empty" },
    { body: null, expectedStatus: 500, expectedBodyType: "empty" },
    {
      body: "{ malformed JSON for 08012345678",
      expectedStatus: 500,
      expectedBodyType: "text",
    },
  ];
  for (const { body, expectedStatus, expectedBodyType } of cases) {
    const service = createTelecomAbodeService({
      apiKey: "mock-key",
      transport: async () => response(body, expectedStatus),
    });
    await assert.rejects(service.getElectricityProviders, (error) => {
      assert.equal(error.statusCode, expectedStatus);
      assert.equal(error.code, "PROVIDER_HTTP_ERROR");
      assert.equal(error.providerEvidence.bodyType, expectedBodyType);
      const evidence = JSON.stringify(error.providerEvidence);
      assert.ok(evidence.length <= 1200);
      assert.doesNotMatch(evidence, /do-not-retain|08012345678|customer@example\.com|Authorization/);
      assert.match(error.message, new RegExp(`HTTP ${expectedStatus}`));
      if (expectedBodyType === "empty") assert.equal(error.providerEvidence.message, undefined);
      if (body && typeof body === "object" && body.status === "failed") {
        assert.equal(error.providerEvidence.status, "failed");
        assert.equal(error.providerEvidence.code, "INVALID_PLAN");
        assert.equal(error.providerEvidence.reference, "REQ-400");
        assert.equal(error.providerEvidence.requestIdMatches, false);
        assert.match(error.providerEvidence.message, /Plan rejected/);
      }
      return true;
    });
  }
});

test("common non-2xx status codes retain the exact provider HTTP status", async () => {
  for (const status of [401, 403, 404, 409, 422, 429, 500]) {
    const service = createTelecomAbodeService({
      apiKey: "mock-key",
      transport: async () => response({ error: "rejected" }, status),
    });
    await assert.rejects(service.getElectricityProviders, (error) => {
      assert.equal(error.statusCode, status);
      assert.equal(error.code, "PROVIDER_HTTP_ERROR");
      assert.equal(error.providerEvidence.message, "rejected");
      return true;
    });
  }
});

test("configured provider key is redacted from error message, code, and reference", async () => {
  const configuredKey = "TA-Configured-Key-Example-101";
  const service = createTelecomAbodeService({
    apiKey: configuredKey,
    transport: async () => response({
      code: `REJECTED-${configuredKey}`,
      reference: `PROVIDER-${configuredKey}`,
      message: `Provider rejected ${configuredKey} because the plan is unavailable`,
    }, 400),
  });

  await assert.rejects(service.getElectricityProviders, (error) => {
    assert.equal(error.statusCode, 400);
    const serializedEvidence = JSON.stringify(error.providerEvidence);
    assert.doesNotMatch(serializedEvidence, new RegExp(configuredKey));
    assert.doesNotMatch(error.message, new RegExp(configuredKey));
    assert.match(error.providerEvidence.message, /REDACTED_PROVIDER_KEY/);
    assert.match(error.providerEvidence.code, /REDACTED_PROVIDER_KEY/);
    assert.match(error.providerEvidence.reference, /REDACTED_PROVIDER_KEY/);
    return true;
  });
});