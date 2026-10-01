const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildDataPurchasePayload,
  createTelecomAbodeService,
} = require("../services/telecomAbode.service");
const {
  createTelecomAbodeDataSettlementService,
} = require("../services/telecomAbodeDataSettlement.service");

const REQUEST = "DATA-RECOVERY-CONTRACT-1";
const input = {
  network: 1, phone: "08012345678", plan: 187, request_id: REQUEST,
  planMetadata: { plan_id: 187, network: 1 },
};

test("normal DATA payload meets the live required boolean contract without changing IDs", () => {
  const payload = buildDataPurchasePayload(input);
  assert.deepEqual(payload, {
    network: 1, phone: "08012345678", plan: 187,
    "request-id": REQUEST, bypass: false,
  });
  assert.deepEqual(Object.keys(payload).sort(), ["bypass", "network", "phone", "plan", "request-id"]);
  assert.equal(JSON.parse(JSON.stringify(payload)).bypass, false);
  assert.equal(Object.hasOwn(payload, "plan_id"), false);
  assert.equal(Object.hasOwn(payload, "ported_number"), false);
});

test("untrusted porting flags and string booleans cannot override normal carrier validation", () => {
  for (const bypass of ["true", "false", true, 1, null]) {
    const payload = buildDataPurchasePayload({ ...input, bypass, ported_number: true });
    assert.equal(payload.bypass, false);
    assert.equal(typeof payload.bypass, "boolean");
    assert.equal(Object.hasOwn(payload, "ported_number"), false);
  }
});

function fixture(http, providerStatus) {
  const calls = [];
  let claims = 0;
  const service = createTelecomAbodeService({
    apiKey: "recovery-test-only-key",
    transactionModel: {
      findOneAndUpdate: async (filter, update) => {
        claims++;
        assert.equal(filter.providerRequestId, REQUEST);
        assert.equal(filter.dispatchStatus, "CLAIMED");
        assert.equal(update.$set.dispatchStatus, "SENDING");
        return { _id: "persisted-transaction" };
      },
    },
    transport: async config => {
      calls.push(config);
      if (config.method === "GET" && config.url.endsWith("/get-networks?service=data")) {
        return { status: 200, data: [
          { id: 1, network: "MTN" }, { id: 2, network: "Airtel" },
          { id: 3, network: "Glo" }, { id: 4, network: "9mobile" },
        ] };
      }
      if (config.method === "GET" && config.url.endsWith("/data_plans")) {
        return { status: 200, data: { status: "success", data_plans: [{
          plan_id: 187, network: "MTN", datasize: "200MB",
          price: 90, day: "4 days", type: "HOT",
        }] } };
      }
      assert.equal(config.url, "https://telecomabode.com.ng/api/data");
      assert.equal(config.method, "POST");
      assert.deepEqual(config.data, {
        network: 1, phone: "08012345678", plan: 187,
        "request-id": REQUEST, bypass: false,
      });
      assert.equal(config.headers["Content-Type"], "application/json");
      assert.equal(config.headers.Accept, "application/json");
      return { status: http, data: {
        service: "data", status: providerStatus, "request-id": REQUEST, amount: "90",
      } };
    },
  });
  return { service, calls, claims: () => claims };
}

for (const reported of ["success", "failed", "pending"]) {
  test(`HTTP 202 with correlated ${reported} body stays pending and never repeats dispatch`, async () => {
    const f = fixture(202, reported);
    await f.service.getDataPlans();
    const result = await f.service.purchaseData({ ...input, transactionId: "persisted-transaction" });
    assert.equal(result.httpStatus, 202);
    assert.equal(result.status, "PENDING");
    assert.equal(result.documentedDataStatus, false);
    assert.equal(result.requestId, REQUEST);
    assert.equal(result.reason, "PROVIDER_HTTP_ACCEPTED_NOT_TERMINAL");
    assert.equal(f.calls.filter(c => c.method === "POST").length, 1);
    await assert.rejects(f.service.purchaseData({
      ...input, transactionId: "persisted-transaction",
    }), { code: "DUPLICATE_REQUEST_ID" });
    assert.equal(f.calls.filter(c => c.method === "POST").length, 1);
  });
}

test("HTTP 200 documented correlated SUCCESS remains terminal", async () => {
  const f = fixture(200, "success");
  await f.service.getDataPlans();
  const result = await f.service.purchaseData({ ...input, transactionId: "persisted-transaction" });
  assert.equal(result.status, "SUCCESS");
  assert.equal(result.documentedDataStatus, true);
  assert.equal(result.httpStatus, 200);
  assert.equal(f.claims(), 1);
});

for (const reported of ["success", "failed"]) {
  test(`status lookup HTTP 202 cannot terminalize a ${reported} body`, async () => {
    let calls = 0;
    const service = createTelecomAbodeService({
      apiKey: "recovery-test-only-key",
      transport: async config => {
        calls++;
        assert.equal(config.method, "GET");
        assert.equal(config.url, "https://telecomabode.com.ng/api/transaction/" + REQUEST);
        return { status: 202, data: { service: "data", status: reported, "request-id": REQUEST } };
      },
    });
    await assert.rejects(service.getTransactionByRequestId(REQUEST), error =>
      error.code === "TRANSACTION_HTTP_PENDING" && error.statusCode === 202);
    assert.equal(calls, 1);
  });
}

for (const source of ["REQUEST", "STATUS_QUERY"]) {
  for (const outcome of ["SUCCESS", "FAILED"]) {
    test(`${source} settlement refuses HTTP 202 ${outcome} before querying or changing money`, async () => {
      let touched = false;
      const service = createTelecomAbodeDataSettlementService({
        transactionModel: { find() { touched = true; throw new Error("must not query"); } },
        startSession: () => { touched = true; throw new Error("must not start a session"); },
      });
      assert.deepEqual(await service.settleTelecomAbodeDataOutcome({
        requestId: REQUEST, outcome, source,
        evidence: { requestId: REQUEST, service: "data", documentedDataStatus: true, httpStatus: 202 },
      }), { status: "NOT_ELIGIBLE" });
      assert.equal(touched, false);
    });
  }
}