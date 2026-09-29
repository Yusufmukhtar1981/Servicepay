const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const axios = require("axios");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

process.env.JWT_SECRET = "focused-telecom-data-test-signing-key";

const customerController = require("../controllers/clubkonnect.controller");
const dataPricingController = require("../controllers/dataPricing.controller");
const telecomAbode = require("../services/telecomAbode.service");
const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const LedgerEntry = require("../models/ledgerEntry.model");
const DataPriceOverride = require("../models/dataPriceOverride.model");
const ProviderManagementConfig = require("../models/providerManagementConfig.model");
const {
  servicepayPlanCode,
} = require("../services/telecomAbodeDataCatalog.service");

const PROVIDER_PLAN_ID = 77;
const PROVIDER_NETWORK_ID = 1;
const PROVIDER_COST = 150;
const SERVICEPAY_PRICE = 200;
const PLAN_NAME = "1GB SME - 30 days";
const PLAN_CODE = servicepayPlanCode("01", PLAN_NAME);
const CUSTOMER_PHONE = "08012345678";

let replicaSet;
let originalGetDataPlans;
let originalPurchaseData;
let originalAxiosGet;
let sequence = 0;
let dispatchCalls = 0;
let clubKonnectCalls = 0;
let nextProviderOutcome = "SUCCESS";

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

const makeUser = () => User.create({
  fullName: `Focused DATA Buyer ${++sequence}`,
  phone: `080${String(sequence).padStart(8, "0")}`,
  email: `focused-data-${sequence}@test.invalid`,
  password: "FocusedDataTest123!",
  role: "CUSTOMER",
  status: "ACTIVE",
  walletBalance: 1000,
});

const purchase = (user, {
  key,
  planCode = PLAN_CODE,
  amount = SERVICEPAY_PRICE,
  productQuote,
  includeQuote = false,
  extraFields = {},
} = {}) => {
  const headers = { "x-idempotency-key": key };
  const body = {
    network: "MTN",
    phone: CUSTOMER_PHONE,
    planCode,
    amount,
  };
  if (includeQuote) body.productQuote = productQuote;
  Object.assign(body, extraFields);
  return invoke(customerController.buyData, {
    user: { _id: user._id },
    body,
    headers,
    get(name) { return headers[String(name).toLowerCase()]; },
  });
};

const addCanonicalPrice = async (sellingPrice = SERVICEPAY_PRICE, active = true) =>
  DataPriceOverride.create({
    networkCode: "01",
    planCode: PLAN_CODE,
    planName: PLAN_NAME,
    providerPrice: PROVIDER_COST,
    sellingPrice,
    active,
  });

const readAdminPrice = () => invoke(dataPricingController.getAdminDataPricing, {
  params: { network: "MTN" },
});

const readCustomerCatalog = (user) => invoke(customerController.getDataPlans, {
  user: { _id: user._id },
  params: { network: "MTN" },
  query: {},
});

const setOutcome = (outcome) => {
  nextProviderOutcome = outcome;
};

test.before(async () => {
  replicaSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ args: ["--nounixsocket"] }],
  });
  await mongoose.connect(replicaSet.getUri(), {
    dbName: "telecom-abode-data-focused-no-pay",
  });
  await Promise.all([
    User,
    Transaction,
    LedgerEntry,
    DataPriceOverride,
    ProviderManagementConfig,
  ].map((model) => model.init()));

  originalGetDataPlans = telecomAbode.getDataPlans;
  originalPurchaseData = telecomAbode.purchaseData;
  originalAxiosGet = axios.get;
});

test.after(async () => {
  telecomAbode.getDataPlans = originalGetDataPlans;
  telecomAbode.purchaseData = originalPurchaseData;
  axios.get = originalAxiosGet;
  await mongoose.disconnect();
  await replicaSet?.stop();
});

test.beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Transaction.deleteMany({}),
    LedgerEntry.collection.deleteMany({}),
    DataPriceOverride.deleteMany({}),
    ProviderManagementConfig.deleteMany({}),
  ]);
  process.env.TELECOM_ABODE_API_KEY = "mock-only-telecom-key";
  await ProviderManagementConfig.create({
    _id: "DATA",
    service: "DATA",
    primaryProvider: "TELECOM_ABODE",
    fallbackProvider: null,
    providerStates: [
      { provider: "CLUBKONNECT", enabled: true },
      { provider: "TELECOM_ABODE", enabled: true },
    ],
  });
  dispatchCalls = 0;
  clubKonnectCalls = 0;
  nextProviderOutcome = "SUCCESS";
  axios.get = async () => {
    clubKonnectCalls += 1;
    throw new Error("ClubKonnect DATA must not be called by this test.");
  };

  telecomAbode.getDataPlans = async () => [{
    id: String(PROVIDER_PLAN_ID),
    code: String(PROVIDER_PLAN_ID),
    network: "MTN",
    networkId: PROVIDER_NETWORK_ID,
    name: PLAN_NAME,
    price: PROVIDER_COST,
    providerPrice: PROVIDER_COST,
  }];
  telecomAbode.purchaseData = async (request) => {
    assert.equal(request.network, PROVIDER_NETWORK_ID);
    assert.equal(request.phone, CUSTOMER_PHONE);
    assert.equal(request.plan, PROVIDER_PLAN_ID);
    assert.match(request.request_id, /^DATA-/);
    const claimed = await Transaction.findOneAndUpdate({
      _id: request.transactionId,
      reference: request.request_id,
      providerRequestId: request.request_id,
      provider: "TELECOM_ABODE",
      status: "PENDING",
      dispatchStatus: "CLAIMED",
      dispatchClaimedAt: { $ne: null },
      "providerResponse.providerNetworkId": PROVIDER_NETWORK_ID,
      "providerResponse.providerPlanId": PROVIDER_PLAN_ID,
    }, {
      $set: { dispatchStatus: "SENDING", dispatchStartedAt: new Date() },
    }, { new: true });
    assert.ok(claimed, "mock dispatch must consume the durable one-shot claim");
    dispatchCalls += 1;

    if (nextProviderOutcome instanceof Error) throw nextProviderOutcome;
    if (nextProviderOutcome === "FAILED") {
      return {
        provider: "TELECOM_ABODE",
        service: "data",
        status: "FAILED",
        documentedDataStatus: true,
        requestId: request.request_id,
        providerReference: request.request_id,
        httpStatus: 422,
      };
    }
    if (nextProviderOutcome === "UNKNOWN") {
      return {
        provider: "TELECOM_ABODE",
        service: "data",
        status: "PENDING",
        documentedDataStatus: false,
        requestId: request.request_id,
        providerReference: request.request_id,
        httpStatus: 200,
      };
    }
    if (nextProviderOutcome === "CONTRADICTORY") {
      return {
        ...telecomAbode.normalizeDataPurchaseResponse({
          status: "success",
          Status: "successful",
          "request-id": request.request_id,
          message: "Request accepted for processing.",
          api_response: "Transaction REJECTED by provider.",
        }, {
          requestId: request.request_id,
          configuredKey: "mock-only-telecom-key",
        }),
        httpStatus: 200,
      };
    }
    return {
      provider: "TELECOM_ABODE",
      service: "data",
      status: "SUCCESS",
      documentedDataStatus: true,
      requestId: request.request_id,
      providerReference: request.request_id,
      httpStatus: 200,
    };
  };
});

test("Admin and customer see canonical ServicePay code and exact Admin price, not provider cost", async () => {
  const user = await makeUser();
  await addCanonicalPrice();

  const admin = await readAdminPrice();
  assert.equal(admin.status, 200);
  assert.equal(admin.body.plans.length, 1);
  assert.equal(admin.body.plans[0].code, PLAN_CODE);
  assert.equal(admin.body.plans[0].providerPlanId, PROVIDER_PLAN_ID);
  assert.equal(admin.body.plans[0].providerPrice, PROVIDER_COST);
  assert.equal(admin.body.plans[0].sellingPrice, SERVICEPAY_PRICE);

  const catalog = await readCustomerCatalog(user);
  assert.equal(catalog.status, 200);
  assert.equal(catalog.body.plans.length, 1);
  assert.equal(catalog.body.plans[0].code, PLAN_CODE);
  assert.equal(catalog.body.plans[0].id, PLAN_CODE);
  assert.equal(catalog.body.plans[0].price, SERVICEPAY_PRICE);
  assert.equal(catalog.body.plans[0].sellingPrice, SERVICEPAY_PRICE);
  assert.equal(catalog.body.plans[0].planProvider, "TELECOM_ABODE");

  const result = await purchase(user, { key: "canonical-price-no-quote" });
  assert.equal(result.status, 200);
  assert.equal(result.body.status, "SUCCESSFUL");
  const transaction = await Transaction.findOne({ customerId: user._id, serviceType: "DATA" });
  assert.equal(transaction.provider, "TELECOM_ABODE");
  assert.equal(transaction.amount, SERVICEPAY_PRICE);
  assert.equal(transaction.providerResponse.providerPrice, PROVIDER_COST);
  assert.equal(transaction.providerResponse.quotedPrice, SERVICEPAY_PRICE);
  assert.equal(transaction.providerResponse.planCode, PLAN_CODE);
  assert.equal(transaction.providerResponse.providerPlanId, PROVIDER_PLAN_ID);
  const debit = await LedgerEntry.findOne({ transactionId: transaction._id, direction: "DEBIT" });
  assert.equal(debit.amount, SERVICEPAY_PRICE);
  assert.equal(debit.closingBalance, 1000 - SERVICEPAY_PRICE);
  assert.equal(await User.findById(user._id).then((row) => row.walletBalance), 1000 - SERVICEPAY_PRICE);
  assert.equal(dispatchCalls, 1);
  assert.equal(clubKonnectCalls, 0);
});

test("missing or inactive canonical price and raw provider IDs fail before debit or dispatch", async () => {
  const user = await makeUser();
  await addCanonicalPrice();

  const admin = await readAdminPrice();
  assert.equal(admin.status, 200);
  assert.equal(admin.body.plans[0].sellingPrice, SERVICEPAY_PRICE);
  const catalog = await readCustomerCatalog(user);
  assert.equal(catalog.status, 200);
  assert.equal(catalog.body.plans.length, 1);

  assert.equal((await purchase(user, { key: "raw-provider-id", planCode: "77" })).status, 400);
  for (const [index, field] of [
    "providerPlanId",
    "plan_id",
    "plan",
    "networkId",
    "providerNetworkId",
    "data_plan",
    "dataPlanId",
    "data_plan_id",
  ].entries()) {
    assert.equal((await purchase(user, {
      key: `raw-override-${index}`,
      extraFields: { [field]: field.toLowerCase().includes("network") ? 1 : 77 },
    })).status, 400, `${field} must not override the server-resolved product`);
  }
  assert.equal(await Transaction.countDocuments({ customerId: user._id }), 0);
  assert.equal(dispatchCalls, 0);
  assert.equal(clubKonnectCalls, 0);

  await DataPriceOverride.deleteMany({});
  assert.equal((await purchase(user, { key: "missing-admin-price" })).status, 409);
  assert.equal(await Transaction.countDocuments({ customerId: user._id }), 0);
  assert.equal(await LedgerEntry.countDocuments({ user: user._id, service: "DATA" }), 0);
  assert.equal(await User.findById(user._id).then((row) => row.walletBalance), 1000);
  assert.equal(dispatchCalls, 0);
  assert.equal(clubKonnectCalls, 0);
});

test("amount mismatches and invalid optional quotes reject; concurrent same-key requests debit and dispatch once", async () => {
  const user = await makeUser();
  await addCanonicalPrice();
  const catalog = await readCustomerCatalog(user);
  const plan = catalog.body.plans[0];

  assert.equal((await purchase(user, {
    key: "wrong-amount",
    amount: PROVIDER_COST,
  })).status, 409);
  assert.equal((await purchase(user, {
    key: "forged-quote",
    includeQuote: true,
    productQuote: `${plan.productQuote}x`,
  })).status, 409);
  assert.equal(await Transaction.countDocuments({ customerId: user._id }), 0);
  assert.equal(dispatchCalls, 0);

  const body = {
    network: "MTN",
    phone: CUSTOMER_PHONE,
    planCode: plan.code,
    amount: SERVICEPAY_PRICE,
  };
  const [first, replay] = await Promise.all([
    purchase(user, { key: "same-idempotency-key", ...body }),
    purchase(user, { key: "same-idempotency-key", ...body }),
  ]);
  assert.equal(first.body.reference, replay.body.reference);
  assert.equal(await Transaction.countDocuments({ customerId: user._id, serviceType: "DATA" }), 1);
  assert.equal(await LedgerEntry.countDocuments({
    user: user._id,
    service: "DATA",
    direction: "DEBIT",
  }), 1);
  assert.equal(await User.findById(user._id).then((row) => row.walletBalance), 1000 - SERVICEPAY_PRICE);
  assert.equal(dispatchCalls, 1);
  assert.equal(clubKonnectCalls, 0);
});

for (const [scenario, outcome, expectedStatus, expectedDispatchStatus, heldDebit] of [
  ["exact correlated success", "SUCCESS", 200, "SUCCEEDED", false],
  ["exact correlated failure", "FAILED", 422, "FAILED", true],
  ["unknown outcome", "UNKNOWN", 202, "UNKNOWN", true],
  ["success paired with explicit rejection message remains unknown", "CONTRADICTORY", 202, "UNKNOWN", true],
]) {
  test(`${scenario} settles only documented Telecom Abode evidence and never auto-refunds`, async () => {
    const user = await makeUser();
    await addCanonicalPrice();
    setOutcome(outcome);
    const result = await purchase(user, { key: `outcome-${scenario.replaceAll(" ", "-")}` });
    assert.equal(result.status, expectedStatus);

    const transaction = await Transaction.findOne({ customerId: user._id, serviceType: "DATA" });
    assert.equal(transaction.status, outcome === "SUCCESS" ? "SUCCESSFUL" : outcome === "FAILED" ? "FAILED" : "PENDING");
    assert.equal(transaction.dispatchStatus, expectedDispatchStatus);
    assert.equal(transaction.providerRequestId, transaction.reference);
    assert.equal(transaction.amount, SERVICEPAY_PRICE);
    assert.equal(transaction.providerResponse.providerPrice, PROVIDER_COST);
    if (outcome === "CONTRADICTORY") {
      assert.equal(transaction.providerResponse.response.contradictory, true);
      assert.match(transaction.providerResponse.response.providerMessage, /message: Request accepted/i);
      assert.match(transaction.providerResponse.response.providerMessage, /api_response: Transaction REJECTED/i);
      assert.equal(transaction.providerResponse.response.providerMessageSignals.failure, true);
    }
    const debitCount = await LedgerEntry.countDocuments({
      transactionId: transaction._id,
      direction: "DEBIT",
      amount: SERVICEPAY_PRICE,
    });
    const creditCount = await LedgerEntry.countDocuments({
      transactionId: transaction._id,
      direction: "CREDIT",
    });
    assert.equal(debitCount, 1);
    assert.equal(creditCount, 0);
    if (outcome === "FAILED") assert.equal(result.body.walletDebitHeld, true);
    if (outcome === "SUCCESS") assert.equal(Boolean(result.body.walletDebitHeld), false);
    assert.equal(heldDebit, outcome !== "SUCCESS");
    assert.equal(await User.findById(user._id).then((row) => row.walletBalance), 1000 - SERVICEPAY_PRICE);
    assert.equal(dispatchCalls, 1);
    assert.equal(clubKonnectCalls, 0);

    const retry = await purchase(user, {
      key: `outcome-${scenario.replaceAll(" ", "-")}`,
    });
    assert.equal(retry.body.reference, transaction.reference);
    assert.equal(dispatchCalls, 1);
    assert.equal(await LedgerEntry.countDocuments({
      transactionId: transaction._id,
      direction: "DEBIT",
    }), 1);
    assert.equal(await LedgerEntry.countDocuments({
      transactionId: transaction._id,
      direction: "CREDIT",
    }), 0);
  });
}