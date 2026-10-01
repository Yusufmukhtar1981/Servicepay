const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildDataPurchasePayload,
  createTelecomAbodeService,
  normalizeDataPurchaseResponse,
} = require("../services/telecomAbode.service");

const REQUEST_ID = "DATA-CONTRACT-REQUEST-1";
const response = (fields = {}, overrides = {}) => ({
  service: "data",
  "request-id": REQUEST_ID,
  ...fields,
  ...overrides,
});
const normalize = (body, requestId = REQUEST_ID) =>
  normalizeDataPurchaseResponse(body, {
    requestId,
    servicepayReference: `SP-${requestId}`,
  });

test("DATA purchase payload uses the documented plan wire key and preserves correlation and network", () => {
  const requests = ["DATA-CONTRACT-REQUEST-1", "DATA-CONTRACT-REQUEST-2"].map((requestId) =>
    buildDataPurchasePayload({
      network: 2,
      phone: "  08012345678 ",
      plan: 77,
      request_id: requestId,
      planMetadata: { plan_id: "77", network: 2 },
    }),
  );

  assert.deepEqual(requests, [
    {
      network: 2,
      phone: "08012345678",
      plan: 77,
      "request-id": "DATA-CONTRACT-REQUEST-1",
      bypass: false,
    },
    {
      network: 2,
      phone: "08012345678",
      plan: 77,
      "request-id": "DATA-CONTRACT-REQUEST-2",
      bypass: false,
    },
  ]);
  for (const payload of requests) {
    assert.equal(Number.isSafeInteger(payload.network), true);
    assert.equal(typeof payload.phone, "string");
    assert.equal(Number.isSafeInteger(payload.plan), true);
    assert.equal(typeof payload["request-id"], "string");
    assert.equal(Object.hasOwn(payload, "plan_id"), false);
    assert.equal(payload.bypass, false);
    assert.equal(typeof payload.bypass, "boolean");
  }
});

test("documented DATA success labels settle singly or paired, with case and whitespace normalized", () => {
  for (const fields of [
    { status: "success" },
    { Status: "successful" },
    { status: "success", Status: "successful" },
    { status: "  SuCcEsS  ", Status: " \tSUCCESSFUL " },
  ]) {
    const result = normalize(response(fields));
    assert.equal(result.status, "SUCCESS");
    assert.equal(result.documentedDataStatus, true);
    assert.equal(result.providerReference, REQUEST_ID);
  }
});

test("documented DATA failure labels settle singly or paired, with case and whitespace normalized", () => {
  for (const fields of [
    { status: "fail" },
    { Status: "failed" },
    { status: "fail", Status: "failed" },
    { status: "  FAIL  ", Status: " \tFAILED " },
  ]) {
    const result = normalize(response(fields));
    assert.equal(result.status, "FAILED");
    assert.equal(result.documentedDataStatus, true);
    assert.equal(result.providerReference, REQUEST_ID);
  }
});

test("DATA purchase normalizer preserves only a valid optional provider amount for exact-cost settlement", () => {
  const valid = normalize(response(
    { status: "success", amount: "50.00" },
  ));
  assert.equal(valid.status, "SUCCESS");
  assert.equal(valid.amount, "50.00");

  const invalid = normalize(response(
    { status: "success", amount: "not-a-provider-price" },
  ));
  assert.equal(invalid.status, "PENDING");
  assert.equal(invalid.documentedDataStatus, false);
  assert.equal(invalid.reason, "INVALID_PROVIDER_AMOUNT");
});

test("conflicting, unknown, and malformed status labels remain unresolved", () => {
  const malformed = [
    { status: "success", Status: "failed" },
    { status: "success", Status: "success-ish" },
    { status: 1 },
    { Status: null },
    { status: "success", Status: false },
    { status: "   " },
  ];
  for (const fields of malformed) {
    const result = normalize(response(fields));
    assert.equal(result.status, "PENDING", JSON.stringify(fields));
    assert.equal(result.documentedDataStatus, false, JSON.stringify(fields));
  }
});

test("terminal DATA outcomes require an echoed matching request-id", () => {
  for (const fields of [{ status: "success" }, { Status: "failed" }]) {
    const missing = normalize(response(fields, { "request-id": undefined }));
    assert.equal(missing.status, "PENDING");
    assert.equal(missing.documentedDataStatus, false);
    assert.equal(missing.reason, "MISSING_PROVIDER_CORRELATION");
  }

  const mismatched = normalize(response(
    { status: "success" },
    { "request-id": "DATA-ANOTHER-REQUEST" },
  ));
  assert.equal(mismatched.status, "PENDING");
  assert.equal(mismatched.documentedDataStatus, false);
  assert.equal(mismatched.reason, "PROVIDER_REFERENCE_MISMATCH");
});

test("wrong service and nested status labels cannot qualify a DATA settlement", () => {
  const wrongService = normalize(response(
    { status: "success" },
    { service: "airtime" },
  ));
  assert.equal(wrongService.status, "PENDING");
  assert.equal(wrongService.documentedDataStatus, false);
  assert.equal(wrongService.reason, "PROVIDER_SERVICE_MISMATCH");

  const nested = normalize(response({
    data: { status: "success", Status: "successful" },
  }));
  assert.equal(nested.status, "PENDING");
  assert.equal(nested.documentedDataStatus, false);
});

test("a provider message that contradicts the DATA status cannot qualify a terminal outcome", () => {
  const result = normalize(response({
    status: "success",
    message: "Data purchase failed.",
  }));
  assert.equal(result.status, "PENDING");
  assert.equal(result.documentedDataStatus, false);
  assert.equal(result.contradictory, true);
  assert.equal(result.providerMessageSignals.failure, true);
});

test("transaction GET requires its exact echo and downgrades success contradicted by a failure message", async () => {
  const cases = [
    {
      body: {
        service: "data",
        "request-id": REQUEST_ID,
        status: "success",
      },
      status: "SUCCESS",
      documentedDataStatus: true,
    },
    {
      body: {
        service: "data",
        "request-id": REQUEST_ID,
        status: "success",
        message: "Data purchase failed.",
      },
      status: "PENDING",
      documentedDataStatus: false,
      contradictory: true,
    },
    {
      body: {
        service: "data",
        "request-id": REQUEST_ID,
        message: "Request accepted for processing.",
      },
      status: "PENDING",
      documentedDataStatus: false,
    },
  ];

  for (const fixture of cases) {
    let calls = 0;
    const service = createTelecomAbodeService({
      apiKey: "unit-test-only",
      transport: async (config) => {
        calls += 1;
        assert.equal(config.method, "GET");
        assert.equal(config.url, `https://telecomabode.com.ng/api/transaction/${REQUEST_ID}`);
        assert.equal(config.data, undefined);
        return { status: 200, data: fixture.body };
      },
    });

    const result = await service.getTransactionByRequestId(REQUEST_ID);
    assert.equal(calls, 1);
    assert.equal(result.requestId, REQUEST_ID);
    assert.equal(result.providerReference, REQUEST_ID);
    assert.equal(result.status, fixture.status);
    assert.equal(result.documentedDataStatus, fixture.documentedDataStatus);
    if (fixture.contradictory) assert.equal(result.contradictory, true);
  }
});

test("transaction GET with a malformed supplied amount remains unresolved", async () => {
  const service = createTelecomAbodeService({
    apiKey: "unit-test-only",
    transport: async () => ({
      status: 200,
      data: {
        service: "data",
        "request-id": REQUEST_ID,
        status: "success",
        amount: "not-a-number",
      },
    }),
  });
  const result = await service.getTransactionByRequestId(REQUEST_ID);
  assert.equal(result.status, "PENDING");
  assert.equal(result.documentedDataStatus, false);
  assert.equal(result.invalidProviderAmount, true);
  assert.equal(result.amount, undefined);
});
