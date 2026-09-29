const test = require("node:test");
const assert = require("node:assert/strict");

process.env.JWT_SECRET = "mock-data-catalog-quote-secret";

const telecomAbode = require("../services/telecomAbode.service");
const DataPriceOverride = require("../models/dataPriceOverride.model");
const dataPricingController = require("../controllers/dataPricing.controller");
const partnerApiController = require("../controllers/partnerApi.controller");
const {
  getPricedCatalog,
  mapCatalog,
  servicepayPlanCode,
} = require("../services/telecomAbodeDataCatalog.service");
const {
  issueDataPlanQuote,
  verifyDataPlanQuote,
} = require("../services/dataPlanQuote.service");
const {
  buildDataPurchasePayload,
  normalizeDataPurchaseResponse,
} = telecomAbode;

const providerPlan = (overrides = {}) => ({
  id: "77",
  network: "MTN",
  networkId: 1,
  name: "1GB SME - 30 days",
  price: 150,
  ...overrides,
});

test("Telecom Abode plan identity is stable and independent of provider price", () => {
  const first = mapCatalog([providerPlan()])[0];
  const repriced = mapCatalog([providerPlan({ price: 185 })])[0];
  assert.equal(first.code, repriced.code);
  assert.equal(first.code, servicepayPlanCode("01", "1GB SME - 30 days"));
  assert.match(first.code, /^DATA-MTN-[A-Fa-f0-9]{20}$/);
  assert.equal(first.providerPlanId, 77);
  assert.equal(first.price, 150);
  assert.equal(repriced.price, 185);
});

test("ambiguous provider descriptions require explicit reviewed variants", () => {
  const duplicates = [
    providerPlan({ id: 1, networkId: 1, name: "1GB WEEKLY - 7" }),
    providerPlan({ id: 121, networkId: 1, name: "1GB WEEKLY - 7" }),
  ];
  const mapped = mapCatalog(duplicates);
  assert.equal(mapped[0].ambiguousIdentity, true);
  assert.equal(mapped[1].ambiguousIdentity, true);
  assert.notEqual(mapped[0].code, mapped[1].code);
  assert.throws(
    () => mapCatalog([...duplicates, providerPlan({ id: 999, name: "1GB WEEKLY - 7" })]),
    /explicit ServicePay variant mapping/,
  );
});

test("customer catalog includes only exact active ServicePay prices", async () => {
  const originalGetPlans = telecomAbode.getDataPlans;
  const originalFind = DataPriceOverride.find;
  telecomAbode.getDataPlans = async () => [providerPlan(), providerPlan({
    id: 78, name: "2GB SME - 30 days",
  })];
  const code = servicepayPlanCode("01", "1GB SME - 30 days");
  let query;
  DataPriceOverride.find = (filter) => {
    query = filter;
    return {
      lean: async () => [{
        networkCode: "01",
        planCode: code,
        sellingPrice: 193,
        active: true,
      }],
    };
  };
  try {
    const plans = await getPricedCatalog("MTN");
    assert.deepEqual(query, {
      networkCode: "01",
      planCode: { $in: [code, servicepayPlanCode("01", "2GB SME - 30 days")] },
      active: true,
    });
    assert.equal(plans.length, 1);
    assert.equal(plans[0].sellingPrice, 193);
    assert.notEqual(plans[0].sellingPrice, plans[0].price);
  } finally {
    telecomAbode.getDataPlans = originalGetPlans;
    DataPriceOverride.find = originalFind;
  }
});

test("signed Telecom Abode quote binds provider plan id and canonical selling price", () => {
  const plan = {
    code: servicepayPlanCode("01", "1GB SME - 30 days"),
    name: "1GB SME - 30 days",
    networkId: 1,
    providerPlanId: 77,
  };
  const quote = issueDataPlanQuote({
    customerId: "customer-1",
    provider: "TELECOM_ABODE",
    network: "01",
    plan,
    price: 193,
  });
  assert.equal(verifyDataPlanQuote(quote, {
    customerId: "customer-1",
    provider: "TELECOM_ABODE",
    network: "01",
    plan,
    price: 193,
  }), true);
  assert.equal(verifyDataPlanQuote(quote, {
    customerId: "customer-1",
    provider: "TELECOM_ABODE",
    network: "01",
    plan: { ...plan, providerPlanId: 78 },
    price: 193,
  }), false);
  assert.equal(verifyDataPlanQuote(quote, {
    customerId: "customer-1",
    provider: "TELECOM_ABODE",
    network: "01",
    plan,
    price: 194,
  }), false);
});

test("DATA adapter retains isolated plan field and settles only documented correlated pairs", () => {
  const payload = buildDataPurchasePayload({
    network: 1,
    phone: "08012345678",
    plan: 77,
    request_id: "DATA-TEST-1",
    planMetadata: { plan_id: 77, network: 1 },
  });
  assert.deepEqual(payload, {
    network: 1,
    phone: "08012345678",
    plan: 77,
    "request-id": "DATA-TEST-1",
  });

  const success = normalizeDataPurchaseResponse({
    status: "success",
    Status: "successful",
    service: "data",
    "request-id": "DATA-TEST-1",
  }, { requestId: "DATA-TEST-1" });
  assert.equal(success.status, "SUCCESS");
  assert.equal(success.documentedDataStatus, true);

  for (const reply of [
    { status: "success", "request-id": "DATA-TEST-1" },
    { status: "success", Status: "failed", "request-id": "DATA-TEST-1" },
    { status: "fail", Status: "failed" },
    { status: "fail", Status: "failed", "request-id": "OTHER" },
  ]) {
    const normalized = normalizeDataPurchaseResponse(reply, {
      requestId: "DATA-TEST-1",
    });
    assert.equal(normalized.status, "PENDING");
    assert.equal(normalized.documentedDataStatus, false);
  }

  const failure = normalizeDataPurchaseResponse({
    status: "fail",
    Status: "failed",
    "request-id": "DATA-TEST-1",
  }, { requestId: "DATA-TEST-1" });
  assert.equal(failure.status, "FAILED");
  assert.equal(failure.documentedDataStatus, true);
});

test("Admin Telecom Abode pricing is editable by canonical code without migrating old prices", async () => {
  const originalGetPlans = telecomAbode.getDataPlans;
  const originalFind = DataPriceOverride.find;
  const originalFindOneAndUpdate = DataPriceOverride.findOneAndUpdate;
  telecomAbode.getDataPlans = async () => [providerPlan()];
  DataPriceOverride.find = () => ({ lean: async () => [] });
  const invoke = async (handler, req) => {
    const result = {};
    await handler(req, {
      status(code) {
        result.status = code;
        return this;
      },
      json(body) {
        result.body = body;
        return this;
      },
    });
    return result;
  };
  try {
    const read = await invoke(dataPricingController.getAdminDataPricing, {
      params: { network: "MTN" },
    });
    assert.equal(read.status, 200);
    assert.equal(read.body.plans[0].code, servicepayPlanCode("01", "1GB SME - 30 days"));
    assert.equal(read.body.plans[0].sellingPrice, null);
    assert.equal(read.body.plans[0].priced, false);

    DataPriceOverride.findOneAndUpdate = async (filter, update) => {
      assert.deepEqual(filter, {
        networkCode: "01",
        planCode: servicepayPlanCode("01", "1GB SME - 30 days"),
      });
      assert.equal(update.$set.sellingPrice, 193);
      return { ...update.$set, pricingVersion: 1 };
    };
    const saved = await invoke(dataPricingController.saveDataSellingPrice, {
      params: {
        network: "MTN",
        planCode: servicepayPlanCode("01", "1GB SME - 30 days"),
      },
      body: { sellingPrice: 193 },
      user: { _id: "admin-1" },
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.pricing.sellingPrice, 193);
  } finally {
    telecomAbode.getDataPlans = originalGetPlans;
    DataPriceOverride.find = originalFind;
    DataPriceOverride.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test("Partner DATA remains unavailable instead of falling back to ClubKonnect", async () => {
  const result = {};
  await partnerApiController.buyData(
    { body: {}, headers: {}, partner: { _id: "partner-1" } },
    {
      status(code) {
        result.status = code;
        return this;
      },
      json(body) {
        result.body = body;
        return this;
      },
    },
  );
  assert.equal(result.status, 503);
  assert.match(result.body.message, /Partner DATA purchases are temporarily unavailable/);
});