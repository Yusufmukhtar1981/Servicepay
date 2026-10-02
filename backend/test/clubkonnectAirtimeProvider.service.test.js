const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createClubkonnectAirtimeProviderService,
  parseEvidence,
} = require("../services/clubkonnectAirtimeProvider.service");

const credentials = {
  userId: "configured-user",
  apiKey: "test-only-api-key",
};
const requestId = "AIR-PROVIDER-TEST-001";

test("purchase sends one credential-scoped request and never treats purchase cost as accounting cost", async () => {
  const requests = [];
  const provider = createClubkonnectAirtimeProviderService({
    getCredentials: () => credentials,
    httpClient: {
      get: async (url, options) => {
        requests.push({ url, options });
        return {
          status: 200,
          data: {
            requestid: requestId,
            orderid: "CK-10001",
            statuscode: "200",
            orderstatus: "ORDER_COMPLETED",
            amountcharged: "98.25",
            apiKey: "do-not-persist",
          },
        };
      },
    },
  });

  const result = await provider.purchase({
    network: "01",
    phone: "08012345678",
    amount: 100,
    requestId,
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.params.RequestID, requestId);
  assert.equal(requests[0].options.params.MobileNetwork, "01");
  assert.equal(result.outcome, "SUCCESS");
  assert.equal(result.authoritative, true);
  assert.equal(result.providerOrderId, "CK-10001");
  assert.equal(result.requestId, requestId);
  assert.equal(result.providerCost, null);
  assert.equal(result.body.amountCharged, null);
  assert.equal(provider.isVerifiedEvidence(result), true);
  assert.equal(provider.isVerifiedEvidence({ ...result }), false);
  assert.equal(JSON.stringify(result).includes(credentials.apiKey), false);
  assert.equal(JSON.stringify(result).includes("do-not-persist"), false);
});

test("status query prefers persisted OrderID and captures only a correlated terminal amountcharged", async () => {
  const requests = [];
  const provider = createClubkonnectAirtimeProviderService({
    getCredentials: () => credentials,
    httpClient: {
      get: async (url, options) => {
        requests.push({ url, options });
        return {
          status: 200,
          data: {
            orderid: "CK-10002",
            requestid: "",
            statuscode: "200",
            orderstatus: "ORDER_COMPLETED",
            amountcharged: "79.00",
          },
        };
      },
    },
  });

  const result = await provider.query({
    requestId,
    orderId: "CK-10002",
  });

  assert.equal(requests[0].options.params.OrderID, "CK-10002");
  assert.equal("RequestID" in requests[0].options.params, false);
  assert.equal(result.outcome, "SUCCESS");
  assert.equal(result.authoritative, true);
  assert.equal(result.providerCost, 79);
  assert.equal(result.body.amountCharged, 79);
});

test("status query rejects a mismatched OrderID without trusting its success or cost", async () => {
  const provider = createClubkonnectAirtimeProviderService({
    getCredentials: () => credentials,
    httpClient: {
      get: async () => ({
        status: 200,
        data: {
          orderid: "CK-DIFFERENT",
          statuscode: "200",
          orderstatus: "ORDER_COMPLETED",
          amountcharged: "75.00",
        },
      }),
    },
  });
  const result = await provider.query({
    requestId,
    orderId: "CK-EXPECTED",
  });

  assert.equal(result.outcome, "UNKNOWN");
  assert.equal(result.authoritative, false);
  assert.equal(result.providerCost, null);
});

test("HTTP 202 is always unknown, regardless of a terminal-looking response body", async () => {
  const responseBodies = [
    {
      requestid: requestId,
      orderid: "CK-202-SUCCESS",
      statuscode: "200",
      orderstatus: "ORDER_COMPLETED",
      amountcharged: "1.00",
    },
    {
      requestid: requestId,
      orderid: "CK-202-FAILURE",
      statuscode: "501",
      orderstatus: "ORDER_CANCELLED",
    },
  ];
  const provider = createClubkonnectAirtimeProviderService({
    getCredentials: () => credentials,
    httpClient: {
      get: async () => ({
        status: 202,
        data: responseBodies.shift(),
      }),
    },
  });

  const purchase = await provider.purchase({
    network: "01",
    phone: "08012345678",
    amount: 100,
    requestId,
  });
  const query = await provider.query({ requestId });

  for (const result of [purchase, query]) {
    assert.equal(result.httpStatus, 202);
    assert.equal(result.outcome, "UNKNOWN");
    assert.equal(result.authoritative, false);
    assert.equal(result.providerCost, null);
    assert.equal(result.body, null);
  }
});

test("network-unresponsive and unrecognized/404 query results remain unknown", async () => {
  const responses = [
    {
      status: 200,
      data: {
        requestid: requestId,
        orderid: "CK-UNRESPONSIVE",
        statuscode: "201",
        orderstatus: "ORDER_COMPLETED",
        amountcharged: "75.00",
      },
    },
    { status: 404, data: { status: "NOT_FOUND" } },
  ];
  const provider = createClubkonnectAirtimeProviderService({
    getCredentials: () => credentials,
    httpClient: {
      get: async () => responses.shift(),
    },
  });

  const unresponsive = await provider.query({ requestId });
  assert.equal(unresponsive.outcome, "UNKNOWN");
  assert.equal(unresponsive.authoritative, false);
  assert.equal(unresponsive.providerCost, null);

  const missing = await provider.query({ requestId });
  assert.equal(missing.outcome, "UNKNOWN");
  assert.equal(missing.authoritative, false);
  assert.equal(missing.providerCost, null);
});

test("only documented correlated ORDER_CANCELLED codes are terminal failure", async () => {
  for (const statusCode of ["500", "501"]) {
    const provider = createClubkonnectAirtimeProviderService({
      getCredentials: () => credentials,
      httpClient: {
        get: async () => ({
          status: 200,
          data: {
            requestid: requestId,
            orderid: `CK-CANCELLED-${statusCode}`,
            statuscode: statusCode,
            orderstatus: "ORDER_CANCELLED",
          },
        }),
      },
    });

    const result = await provider.query({ requestId });
    assert.equal(result.outcome, "FAILED");
    assert.equal(result.authoritative, true);
    assert.equal(result.providerCost, null);
  }
});

test("non-terminal ORDER_ONHOLD and malformed successful records cannot trigger refund", async () => {
  const responses = [
    {
      statuscode: "603",
      orderstatus: "ORDER_ONHOLD",
      orderid: "CK-ON-HOLD",
      requestid: requestId,
    },
    {
      statuscode: "200",
      orderstatus: "ORDER_COMPLETED",
      orderid: "CK-WRONG-ID",
      requestid: "CK-DIFFERENT-REQUEST",
    },
  ];
  const provider = createClubkonnectAirtimeProviderService({
    getCredentials: () => credentials,
    httpClient: {
      get: async () => ({ status: 200, data: responses.shift() }),
    },
  });

  const onHold = await provider.query({
    requestId,
    orderId: "CK-ON-HOLD",
  });
  assert.equal(onHold.outcome, "UNKNOWN");
  assert.equal(onHold.authoritative, false);
  assert.equal(onHold.providerCost, null);

  const malformed = await provider.query({ requestId });
  assert.equal(malformed.outcome, "UNKNOWN");
  assert.equal(malformed.authoritative, false);
  assert.equal(malformed.providerCost, null);
});

test("credential-bearing transport errors become a sanitized unknown result", async () => {
  const provider = createClubkonnectAirtimeProviderService({
    getCredentials: () => credentials,
    httpClient: {
      get: async () => {
        const error = new Error(
          `request failed https://api.test?APIKey=${credentials.apiKey}`,
        );
        error.config = { params: credentials };
        throw error;
      },
    },
  });
  const result = await provider.purchase({
    network: "01",
    phone: "08012345678",
    amount: 100,
    requestId,
  });

  assert.equal(result.outcome, "UNKNOWN");
  assert.equal(result.reasonCode, "PROVIDER_TRANSPORT_UNCERTAIN");
  assert.equal(JSON.stringify(result).includes(credentials.apiKey), false);
});

test("provider evidence parser accepts JSON text but drops credential and free-text fields", () => {
  const parsed = parseEvidence(JSON.stringify({
    orderid: "CK-JSON",
    requestid: requestId,
    statuscode: "200",
    orderstatus: "ORDER_COMPLETED",
    amountcharged: "67.20",
    remark: "PII or credential-bearing provider text is not persisted",
    apiKey: credentials.apiKey,
  }));
  assert.deepEqual(parsed, {
    statusCode: "200",
    orderStatus: "ORDER_COMPLETED",
    orderId: "CK-JSON",
    requestId,
    amountCharged: 67.2,
  });
});