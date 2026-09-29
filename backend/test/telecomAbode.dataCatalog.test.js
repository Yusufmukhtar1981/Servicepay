const test = require("node:test");
const assert = require("node:assert/strict");
const {
  TelecomAbodeError,
  createTelecomAbodeService,
  buildDataPurchasePayload,
  normalizeDataPurchaseResponse,
} = require("../services/telecomAbode.service");

const response = (data, status = 200) => ({ status, data });
const networks = [
  { id: 1, network: "MTN" },
  { id: 2, network: "Airtel" },
  { id: 3, network: "Glo" },
  { id: 4, network: "9mobile" },
];

const mockService = (handler, options = {}) => {
  const calls = [];
  const service = createTelecomAbodeService({
    apiKey: "test-only-data-catalog-key",
    transport: async (config) => {
      calls.push(config);
      return handler(config);
    },
    ...options,
  });
  return { service, calls };
};
const transactionModelWithClaim = (claimed) => ({
  async findOneAndUpdate(filter) {
    return claimed ? { _id: filter._id, dispatchStatus: "SENDING" } : null;
  },
});

test("loads the provider-owned data networks and complete live plan catalog", async () => {
  const providerPlans = Array.from({ length: 113 }, (_, index) => ({
    plan_id: index + 501,
    day: index % 2 ? "7 days" : 30,
    type: index % 2 ? "Gifting" : "SME",
    network: networks[index % networks.length].network,
    datasize: `${index + 1}GB`,
    price: String((index + 1) * 100),
    provider_private_metadata: "must not escape",
  }));
  const { service, calls } = mockService((config) => config.url.endsWith("/data_plans")
    ? response({ status: "success", data_plans: providerPlans })
    : response(networks));

  assert.deepEqual(await service.getDataNetworks(), networks);
  const plans = await service.getDataPlans();
  assert.equal(plans.length, 113);
  assert.deepEqual(plans[0], {
    id: "501",
    code: "501",
    name: "1GB SME - 30",
    price: 100,
    providerPrice: 100,
    networkId: 1,
    network: "MTN",
    type: "SME",
    datasize: "1GB",
    day: "30",
  });
  assert.equal(plans[112].networkId, networks[112 % 4].id);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].url, "https://telecomabode.com.ng/api/get-networks?service=data");
  assert.equal(calls[1].url, "https://telecomabode.com.ng/api/get-networks?service=data");
  assert.equal(calls[2].url, "https://telecomabode.com.ng/api/data_plans");
  assert.equal("data" in calls[0], false);
  assert.doesNotMatch(JSON.stringify(plans), /provider_private_metadata|test-only-data-catalog-key/);
});

test("fails closed on incomplete data network mappings and ambiguous plans", async () => {
  const invalidNetworks = mockService(() => response(networks.slice(0, 3)));
  await assert.rejects(invalidNetworks.service.getDataNetworks, {
    code: "INVALID_PROVIDER_RESPONSE",
  });
  assert.equal(invalidNetworks.calls.length, 1);

  const invalidPlans = mockService((config) => config.url.endsWith("/data_plans")
    ? response({
      status: "success",
      data_plans: [{
        plan_id: 1,
        day: "30 days",
        type: "SME",
        network: "unknown",
        datasize: "5GB",
        price: 1500,
      }],
    })
    : response(networks));
  await assert.rejects(invalidPlans.service.getDataPlans, {
    code: "INVALID_PROVIDER_RESPONSE",
  });
});

test("Telecom Abode DATA dispatch consumes a durable claim; other paid services stay locked", async () => {
  assert.deepEqual(buildDataPurchasePayload({
    network: 2,
    phone: " 08012345678 ",
    plan: 17,
    request_id: " SP-DATA-1 ",
    planMetadata: { plan_id: "17", network: 2 },
  }), {
    network: 2,
    phone: "08012345678",
    plan: 17,
    "request-id": "SP-DATA-1",
  });
  assert.throws(() => buildDataPurchasePayload({
    network: 1,
    phone: "08012345678",
    plan: 17,
    request_id: "SP-DATA-1",
    planMetadata: { plan_id: 17, network: 2 },
  }), { code: "INVALID_ARGUMENT" });

  const unpairedSuccess = normalizeDataPurchaseResponse({
    status: "success",
    "request-id": "SP-DATA-2",
  }, { requestId: "SP-DATA-2" });
  assert.equal(unpairedSuccess.status, "PENDING");
  assert.equal(unpairedSuccess.documentedDataStatus, false);
  const pairedSuccess = normalizeDataPurchaseResponse({
    status: "success",
    Status: "successful",
    "request-id": "SP-DATA-2",
  }, { requestId: "SP-DATA-2" });
  assert.equal(pairedSuccess.status, "SUCCESS");
  assert.equal(pairedSuccess.documentedDataStatus, true);
  const contradictorySuccess = normalizeDataPurchaseResponse({
    status: "success",
    Status: "successful",
    "request-id": "SP-DATA-3",
    message: "Request accepted for processing",
    api_response: "Transaction REJECTED test-provider-secret",
  }, {
    requestId: "SP-DATA-3",
    configuredKey: "test-provider-secret",
  });
  assert.equal(contradictorySuccess.status, "SUCCESS");
  assert.equal(contradictorySuccess.documentedDataStatus, true);
  assert.equal(contradictorySuccess.contradictory, true);
  assert.match(contradictorySuccess.providerMessage, /message: Request accepted for processing/);
  assert.match(contradictorySuccess.providerMessage, /api_response: Transaction REJECTED/);
  assert.equal(contradictorySuccess.providerMessageSignals.failure, true);
  assert.doesNotMatch(contradictorySuccess.providerMessage, /test-provider-secret/);
  assert.ok(contradictorySuccess.providerMessage.length <= 320);
  assert.deepEqual(normalizeDataPurchaseResponse({
    status: "success",
    "request-id": "OTHER-ID",
  }, { requestId: "SP-DATA-2" }), {
    provider: "TELECOM_ABODE",
    service: "data",
    servicepayReference: "SP-DATA-2",
    status: "PENDING",
    documentedDataStatus: false,
    reason: "PROVIDER_REFERENCE_MISMATCH",
    requestId: "SP-DATA-2",
    providerReference: "OTHER-ID",
  });

  const { service, calls } = mockService((config) => {
    return response(config.url.endsWith("/data_plans")
      ? { status: "success", data: [{
        plan_id: 17,
        day: "30 days",
        type: "SME",
        network: "MTN",
        datasize: "5GB",
        price: 1500,
      }] }
      : networks);
  }, { transactionModel: transactionModelWithClaim(false) });
  const plans = await service.getDataPlans();
  assert.equal(plans[0].price, 1500);
  await assert.rejects(service.purchaseData({
    network: 1,
    phone: "08012345678",
    plan: 17,
    request_id: "SP-DATA-LOCKED",
    transactionId: "transaction-without-claim",
  }), (error) => error instanceof TelecomAbodeError && error.code === "DURABLE_DISPATCH_CLAIM_REQUIRED");
  assert.equal(calls.length, 2);

  const ready = mockService((config) => {
    if (config.url.endsWith("/data_plans")) {
      return response({ status: "success", data: [{
        plan_id: 17,
        day: "30 days",
        type: "SME",
        network: "MTN",
        datasize: "5GB",
        price: 1500,
      }] });
    }
    if (config.url.endsWith("/data")) {
      return response({ status: "pending", "request-id": config.data["request-id"] });
    }
    return response(networks);
  }, { transactionModel: transactionModelWithClaim(true) });
  await ready.service.getDataPlans();
  const submitted = await ready.service.purchaseData({
    network: 1,
    phone: "08012345678",
    plan: 17,
    request_id: "SP-DATA-READY",
    transactionId: "transaction-with-claim",
  });
  assert.equal(submitted.status, "PENDING");
  assert.equal(ready.calls.length, 3);

  await assert.rejects(ready.service.purchaseElectricity({
    disco: 1,
    meter_number: "12345678",
    meter_type: "prepaid",
    amount: "100",
    request_id: "SP-LOCKED-ELECTRICITY",
  }), (error) => error instanceof TelecomAbodeError && error.code === "PURCHASES_DISABLED");
  await assert.rejects(ready.service.purchaseCable({
    cable: 1,
    iuc: "123456789",
    cable_plan: "basic",
    request_id: "SP-LOCKED-CABLE",
  }), (error) => error instanceof TelecomAbodeError && error.code === "PURCHASES_DISABLED");
});