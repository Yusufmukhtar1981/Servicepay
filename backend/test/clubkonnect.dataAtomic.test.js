const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const axios = require("axios");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

process.env.CLUBKONNECT_USER_ID = "mock-user";
process.env.CLUBKONNECT_API_KEY = "mock-key";
process.env.JWT_SECRET = "mock-data-plan-quote-signing-secret";

const controller = require("../controllers/clubkonnect.controller");
const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const LedgerEntry = require("../models/ledgerEntry.model");
const DataPriceOverride = require("../models/dataPriceOverride.model");
const ProviderManagementConfig = require("../models/providerManagementConfig.model");
const Commission = require("../models/commission.model");
const ReferralRewardReconciliation = require("../models/referralRewardReconciliation.model");
const clubkonnectRoutes = require("../routes/clubkonnect.routes");
const { STAFF_PERMISSIONS: P } = require("../config/staffPermissions");
const {
  refundFailedDataPurchase,
} = require("../services/clubkonnectDataFailure.service");
const telecomAbode = require("../services/telecomAbode.service");
const { createTelecomAbodeService } = telecomAbode;
const { issueDataPlanQuote } = require("../services/dataPlanQuote.service");

let replicaSet;
let axiosGet;
let providerDataResponse;
let dataRequestCount;
let airtimeRequestCount;
let plansRequestCount;
let plansUnavailable;
let telecomAbodeCatalog;
let telecomAbodePurchase;
let telecomCatalogCount;
let telecomPurchaseCount;
let telecomPurchaseResponse;
let originalTelecomGetDataPlans;
let originalTelecomPurchaseData;
let originalTelecomApiKey;
let sequence = 0;

const invoke = async (user, body, { idempotencyKey, headers = {} } = {}) => {
  const result = {};
  const requestHeaders = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  if (idempotencyKey) requestHeaders["x-idempotency-key"] = idempotencyKey;
  await controller.buyData(
    {
      user: { _id: user._id },
      body,
      headers: requestHeaders,
      get(name) { return requestHeaders[String(name).toLowerCase()]; },
    },
    {
      status(code) {
        result.status = code;
        return this;
      },
      json(payload) {
        result.body = payload;
        return this;
      },
    },
  );
  return result;
};

const invokeHandler = async (handler, request) => {
  const result = {};
  await handler(request, {
    status(code) {
      result.status = code;
      return this;
    },
    json(payload) {
      result.body = payload;
      return this;
    },
  });
  return result;
};

const makeUser = () => User.create({
  fullName: `Data Buyer ${++sequence}`,
  phone: `080${String(sequence).padStart(8, "0")}`,
  email: `data-buyer-${sequence}@test.invalid`,
  password: "Password123!",
  role: "CUSTOMER",
  status: "ACTIVE",
  walletBalance: 500,
});

const seedPendingTransaction = async (user, dispatchStatus) => Transaction.create({
    reference: `DATA-QUEUE-${++sequence}`,
    customerId: user._id,
    serviceType: "DATA",
    provider: "CLUBKONNECT",
    phone: "08012345678",
    amount: 100,
    status: "PENDING",
    idempotencyKey: `manual-${sequence}`,
    dispatchStatus,
    dispatchClaimedAt: dispatchStatus === "READY" ? null : new Date(),
    providerResponse: { network: "01", planCode: "plan-1" },
  });

const purchaseBody = () => ({
  network: "MTN",
  phone: "08012345678",
  planCode: "plan-1",
});

const configureTelecomAbode = async () => {
  process.env.TELECOM_ABODE_API_KEY = "mock-telecom-abode-key";
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
  const service = createTelecomAbodeService({
    apiKey: "mock-telecom-abode-key",
    transactionModel: Transaction,
    transport: async (config) => {
      if (config.url.endsWith("/get-networks?service=data")) {
        return { status: 200, data: [
          { id: 1, network: "MTN" }, { id: 2, network: "Airtel" },
          { id: 3, network: "Glo" }, { id: 4, network: "9mobile" },
        ] };
      }
      if (config.url.endsWith("/data_plans")) {
        return { status: 200, data: { status: "success", data_plans: [{
          plan_id: 77, network: "MTN", datasize: "1GB",
          type: "SME", day: "30 days", price: 150,
        }] } };
      }
      assert.equal(config.url, "https://telecomabode.com.ng/api/data");
      assert.equal(config.method, "POST");
      assert.equal(config.headers.Authorization, "Token mock-telecom-abode-key");
      assert.deepEqual(Object.keys(config.data).sort(), ["network", "phone", "plan", "request-id"].sort());
      assert.equal(config.data.network, 1);
      assert.equal(config.data.plan, 77);
      assert.equal(config.data.phone, "08012345678");
      assert.match(config.data["request-id"], /^DATA-/);
      telecomPurchaseCount += 1;
      if (telecomPurchaseResponse instanceof Error) throw telecomPurchaseResponse;
      const data = typeof telecomPurchaseResponse === "function"
        ? telecomPurchaseResponse(config.data["request-id"])
        : telecomPurchaseResponse || { status: "success", "request-id": config.data["request-id"] };
      return { status: 200, data };
    },
  });
  telecomAbode.getDataPlans = async () => {
    telecomCatalogCount += 1;
    return service.getDataPlans();
  };
  telecomAbode.purchaseData = async (request) => {
    const transaction = await Transaction.findById(request.transactionId);
    assert.equal(transaction?.provider, "TELECOM_ABODE");
    assert.equal(transaction?.status, "PENDING");
    assert.equal(transaction?.dispatchStatus, "CLAIMED");
    assert.ok(transaction?.dispatchClaimedAt);
    assert.equal(transaction?.providerRequestId, request.request_id);
    assert.equal(String(transaction?.reference), request.request_id);
    return service.purchaseData(request);
  };
};

test.before(async () => {
  replicaSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ args: ["--nounixsocket"] }],
  });
  await mongoose.connect(replicaSet.getUri(), { dbName: "clubkonnect-data-atomic" });
  await Promise.all([
    User,
    Transaction,
    LedgerEntry,
    DataPriceOverride,
    ProviderManagementConfig,
    Commission,
    ReferralRewardReconciliation,
  ].map((model) => model.init()));
  axiosGet = axios.get;
  originalTelecomGetDataPlans = telecomAbode.getDataPlans;
  originalTelecomPurchaseData = telecomAbode.purchaseData;
  originalTelecomApiKey = process.env.TELECOM_ABODE_API_KEY;
});

test.after(async () => {
  axios.get = axiosGet;
  telecomAbode.getDataPlans = originalTelecomGetDataPlans;
  telecomAbode.purchaseData = originalTelecomPurchaseData;
  if (originalTelecomApiKey === undefined) delete process.env.TELECOM_ABODE_API_KEY;
  else process.env.TELECOM_ABODE_API_KEY = originalTelecomApiKey;
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
    Commission.collection.deleteMany({}),
    ReferralRewardReconciliation.collection.deleteMany({}),
  ]);
  providerDataResponse = {
    status: 200,
    data: { status: "SUCCESSFUL", message: "Order completed" },
  };
  dataRequestCount = 0;
  airtimeRequestCount = 0;
  plansRequestCount = 0;
  plansUnavailable = false;
  telecomCatalogCount = 0;
  telecomPurchaseCount = 0;
  telecomPurchaseResponse = null;
  telecomAbode.getDataPlans = originalTelecomGetDataPlans;
  telecomAbode.purchaseData = originalTelecomPurchaseData;
  axios.get = async (url, config) => {
    if (url.includes("DatabundlePlansV2")) {
      plansRequestCount += 1;
      if (plansUnavailable) throw new Error("mock plan catalog outage");
      return {
        status: 200,
        data: {
          "01": {
            PRODUCT: [{
              PRODUCT_ID: "plan-1",
              PRODUCT_NAME: "Mock 1GB",
              PRODUCT_AMOUNT: "100",
            }],
          },
        },
      };
    }
    if (url.includes("APIDatabundleV1")) {
      dataRequestCount += 1;
      if (providerDataResponse instanceof Error) throw providerDataResponse;
      if (typeof providerDataResponse === "function") return providerDataResponse(url, config);
      return providerDataResponse;
    }
    if (url.includes("APIAirtimeV1")) {
      airtimeRequestCount += 1;
      return {
        status: 200,
        data: { status: "SUCCESSFUL", message: "Airtime sent" },
      };
    }
    throw new Error(`Unexpected provider URL in test: ${url}`);
  };
});

test("DATA admission atomically debits wallet, writes ledger and transaction, then preserves success response", async () => {
  const user = await makeUser();
  const result = await invoke(user, purchaseBody(), { idempotencyKey: "atomic-success-1" });

  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(result.body.status, "SUCCESSFUL");
  assert.equal(result.body.walletBalance, 400);
  assert.equal(await User.findById(user._id).then((record) => record.walletBalance), 400);
  const transaction = await Transaction.findOne({ customerId: user._id, serviceType: "DATA" });
  assert.equal(transaction.status, "SUCCESSFUL");
  assert.equal(transaction.dispatchStatus, "SUCCEEDED");
  assert.equal(transaction.idempotencyKey, "atomic-success-1");
  const debit = await LedgerEntry.findOne({ transactionId: transaction._id, direction: "DEBIT" });
  assert.ok(debit);
  assert.equal(debit.closingBalance, 400);
  assert.equal(transaction.debitLedgerEntryId.toString(), debit._id.toString());
  assert.equal(await LedgerEntry.countDocuments({ transactionId: transaction._id, direction: "CREDIT" }), 0);
  assert.equal(dataRequestCount, 1);
});

test("customer receives a product-bound quote and can buy the same ClubKonnect plan once", async () => {
  const user = await makeUser();
  const catalog = await invokeHandler(controller.getDataPlans, {
    user: { _id: user._id },
    params: { network: "MTN" },
    query: {},
  });
  assert.equal(catalog.status, 200);
  const quote = catalog.body.plans[0].productQuote;
  assert.equal(typeof quote, "string");
  const body = { ...purchaseBody(), amount: 100, productQuote: quote };
  const first = await invoke(user, body, { idempotencyKey: "customer-quoted-data" });
  const retry = await invoke(user, body, { idempotencyKey: "customer-quoted-data" });
  assert.equal(first.status, 200);
  assert.equal(retry.status, 200);
  assert.equal(dataRequestCount, 1);
  assert.equal(await LedgerEntry.countDocuments({ user: user._id, service: "DATA", direction: "DEBIT" }), 1);
});

test("tampered, expired, another customer's, and repriced quotes all reject before wallet debit", async () => {
  const user = await makeUser();
  const other = await makeUser();
  const catalog = await invokeHandler(controller.getDataPlans, {
    user: { _id: user._id },
    params: { network: "MTN" },
    query: {},
  });
  const quote = catalog.body.plans[0].productQuote;
  const plan = { code: "plan-1", name: "Mock 1GB", price: 100 };
  const expired = issueDataPlanQuote({
    customerId: user._id,
    provider: "CLUBKONNECT",
    network: "01",
    plan,
    price: 100,
    now: Date.now() - 16 * 60 * 1000,
  });
  const cases = [
    [user, `${quote.slice(0, -1)}${quote.at(-1) === "A" ? "B" : "A"}`],
    [user, expired],
    [other, quote],
  ];
  for (const [buyer, productQuote] of cases) {
    const result = await invoke(buyer, { ...purchaseBody(), productQuote }, {
      idempotencyKey: `invalid-quote-${++sequence}`,
    });
    assert.equal(result.status, 409);
  }
  await DataPriceOverride.create({
    networkCode: "01", planCode: "plan-1",
    providerPrice: 100, sellingPrice: 200, active: true,
  });
  const repriced = await invoke(user, { ...purchaseBody(), productQuote: quote }, {
    idempotencyKey: "repriced-quote",
  });
  assert.equal(repriced.status, 409);
  assert.equal(dataRequestCount, 0);
  assert.equal(await Transaction.countDocuments({}), 0);
  assert.equal(await LedgerEntry.countDocuments({ service: "DATA" }), 0);
});

test("Telecom Abode requires its signed product quote before wallet debit", async () => {
  const user = await makeUser();
  await configureTelecomAbode();
  const catalogResponse = await invokeHandler(controller.getDataPlans, {
    user: { _id: user._id },
    params: { network: "MTN" },
    query: { provider: "TELECOM_ABODE" },
  });
  assert.equal(catalogResponse.status, 200);
  assert.equal(catalogResponse.body.plans[0].planProvider, "TELECOM_ABODE");
  assert.equal(catalogResponse.body.plans[0].sellingPrice, 150);

  const result = await invoke(user, {
    network: "MTN",
    phone: "08012345678",
    planCode: "77",
    planProvider: "TELECOM_ABODE",
    quotedPrice: 150,
    amount: 150,
  }, { idempotencyKey: "ta-data-read-only" });

  assert.equal(result.status, 409);
  assert.equal(telecomCatalogCount, 1);
  assert.equal(telecomPurchaseCount, 0);
  assert.equal(dataRequestCount, 0);
  assert.equal(await Transaction.countDocuments({ customerId: user._id }), 0);
  assert.equal(await LedgerEntry.countDocuments({ user: user._id, service: "DATA" }), 0);
  assert.equal(await User.findById(user._id).then((record) => record.walletBalance), 500);
});

const telecomPurchaseBody = (quote) => ({
  network: "MTN", phone: "08012345678", planCode: "77",
  planProvider: "TELECOM_ABODE", quotedPrice: 150,
  productQuote: quote,
});

const telecomQuoteFor = async (user) => {
  const response = await invokeHandler(controller.getDataPlans, {
    user: { _id: user._id },
    params: { network: "MTN" },
    query: { provider: "TELECOM_ABODE" },
  });
  assert.equal(response.status, 200);
  return response.body.plans[0].productQuote;
};

for (const [scenario, providerReply, expectedStatus, expectedBalance] of [
  ["success", null, "SUCCESSFUL", 350],
  ["explicit failure", (id) => ({ status: "failed", "request-id": id }), "FAILED", 500],
  ["timeout", new Error("mock timeout"), "PENDING", 350],
  ["ambiguous response", () => ({ status: "pending" }), "PENDING", 350],
]) {
  test(`enabled Telecom Abode DATA ${scenario} preserves wallet and retry safety`, async () => {
    const user = await makeUser();
    await configureTelecomAbode();
    telecomPurchaseResponse = providerReply;
    const quote = await telecomQuoteFor(user);
    const body = telecomPurchaseBody(quote);
    const key = `telecom-${scenario.replaceAll(" ", "-")}`;
    const first = await invoke(user, body, { idempotencyKey: key });
    const transaction = await Transaction.findOne({ customerId: user._id, serviceType: "DATA" });
    assert.equal(transaction.status, expectedStatus);
    assert.equal(transaction.provider, "TELECOM_ABODE");
    assert.equal(transaction.providerRequestId, transaction.reference);
    assert.equal(await User.findById(user._id).then((row) => row.walletBalance), expectedBalance);
    assert.equal(await LedgerEntry.countDocuments({ user: user._id, service: "DATA", direction: "DEBIT" }), 1);
    assert.equal(telecomPurchaseCount, 1);
    assert.equal(first.status, expectedStatus === "SUCCESSFUL" ? 200 : expectedStatus === "FAILED" ? 400 : 202);
    const retry = await invoke(user, body, { idempotencyKey: key });
    assert.equal(retry.body.reference, first.body.reference);
    assert.equal(telecomPurchaseCount, 1);
    assert.equal(await User.findById(user._id).then((row) => row.walletBalance), expectedBalance);
    assert.equal(await LedgerEntry.countDocuments({ user: user._id, service: "DATA_REVERSAL", direction: "CREDIT" }),
      expectedStatus === "FAILED" ? 1 : 0);
  });
}

test("concurrent enabled Telecom Abode customer submissions dispatch and debit only once", async () => {
  const user = await makeUser();
  await configureTelecomAbode();
  const quote = await telecomQuoteFor(user);
  const body = telecomPurchaseBody(quote);
  const results = await Promise.all([
    invoke(user, body, { idempotencyKey: "ta-concurrent" }),
    invoke(user, body, { idempotencyKey: "ta-concurrent" }),
  ]);
  assert.ok(results.every((result) => [200, 202].includes(result.status)));
  assert.equal(telecomPurchaseCount, 1);
  assert.equal(await Transaction.countDocuments({ customerId: user._id, serviceType: "DATA" }), 1);
  assert.equal(await LedgerEntry.countDocuments({ user: user._id, service: "DATA", direction: "DEBIT" }), 1);
  assert.equal(await User.findById(user._id).then((row) => row.walletBalance), 350);
});

test("separate Telecom Abode adapter instances cannot consume the same dispatch claim", async () => {
  const user = await makeUser();
  const reference = `DATA-MULTI-WORKER-${++sequence}`;
  const transaction = await Transaction.create({
    reference, providerRequestId: reference, customerId: user._id,
    serviceType: "DATA", provider: "TELECOM_ABODE", phone: "08012345678",
    amount: 150, status: "PENDING", dispatchStatus: "CLAIMED",
    dispatchClaimedAt: new Date(),
    providerResponse: { network: "01", planCode: "77", providerNetworkId: 1, providerPlanId: 77 },
  });
  let posts = 0;
  const transport = async (config) => {
    if (config.url.endsWith("/get-networks?service=data")) {
      return { status: 200, data: [
        { id: 1, network: "MTN" }, { id: 2, network: "Airtel" },
        { id: 3, network: "Glo" }, { id: 4, network: "9mobile" },
      ] };
    }
    if (config.url.endsWith("/data_plans")) {
      return { status: 200, data: { status: "success", data_plans: [{
        plan_id: 77, network: "MTN", datasize: "1GB",
        type: "SME", day: "30 days", price: 150,
      }] } };
    }
    posts += 1;
    assert.equal(config.data["request-id"], reference);
    return { status: 200, data: { status: "success", "request-id": reference } };
  };
  const workers = [1, 2].map(() => createTelecomAbodeService({
    apiKey: "mock-telecom-abode-key", transport, transactionModel: Transaction,
  }));
  await Promise.all(workers.map((worker) => worker.getDataPlans()));
  const results = await Promise.allSettled(workers.map((worker) => worker.purchaseData({
    network: 1, phone: "08012345678", plan: 77,
    request_id: reference, transactionId: transaction._id,
  })));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected" &&
    result.reason.code === "DURABLE_DISPATCH_CLAIM_REQUIRED").length, 1);
  assert.equal(posts, 1);
  const stored = await Transaction.findById(transaction._id);
  assert.equal(stored.dispatchStatus, "SENDING");
  assert.ok(stored.dispatchStartedAt);
});

test("ClubKonnect Airtime success behavior remains unchanged", async () => {
  const user = await makeUser();
  const result = await invokeHandler(controller.buyAirtime, {
    user: { _id: user._id },
    body: { network: "MTN", phone: "08012345678", amount: 100 },
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(result.body.status, "SUCCESSFUL");
  assert.equal(result.body.transaction.serviceType, "AIRTIME");
  assert.equal(await User.findById(user._id).then((record) => record.walletBalance), 400);
  assert.equal(await Transaction.countDocuments({ customerId: user._id, serviceType: "AIRTIME", status: "SUCCESSFUL" }), 1);
  assert.equal(await LedgerEntry.countDocuments({ user: user._id, service: "AIRTIME", direction: "DEBIT" }), 1);
  assert.equal(airtimeRequestCount, 1);
  assert.equal(dataRequestCount, 0);
});

test("same customer retry key admits and dispatches only once under concurrent retries", async () => {
  const user = await makeUser();
  const results = await Promise.all([
    invoke(user, purchaseBody(), { idempotencyKey: "concurrent-data-key" }),
    invoke(user, purchaseBody(), { idempotencyKey: "concurrent-data-key" }),
  ]);

  assert.equal(await Transaction.countDocuments({ customerId: user._id, serviceType: "DATA" }), 1);
  assert.equal(await LedgerEntry.countDocuments({ user: user._id, service: "DATA", direction: "DEBIT" }), 1);
  assert.equal(await User.findById(user._id).then((record) => record.walletBalance), 400);
  assert.equal(dataRequestCount, 1);
  assert.ok(results.some((result) => result.status === 200 || result.status === 202));
});

test("timeout stays pending and a retry never resends or refunds", async () => {
  const user = await makeUser();
  const timeout = new Error("socket timed out");
  timeout.code = "ECONNABORTED";
  providerDataResponse = timeout;

  const first = await invoke(user, purchaseBody(), { idempotencyKey: "timeout-data-key" });
  plansUnavailable = true;
  const repeated = await invoke(user, purchaseBody(), { idempotencyKey: "timeout-data-key" });

  assert.equal(first.status, 202);
  assert.equal(repeated.status, 202);
  assert.equal(dataRequestCount, 1);
  assert.equal(await User.findById(user._id).then((record) => record.walletBalance), 400);
  const transaction = await Transaction.findOne({ customerId: user._id });
  assert.equal(transaction.status, "PENDING");
  assert.equal(transaction.dispatchStatus, "UNKNOWN");
  assert.equal(await LedgerEntry.countDocuments({ user: user._id, direction: "CREDIT" }), 0);
});

test("correlated deterministic provider failure atomically refunds once and preserves ledger consistency", async () => {
  const user = await makeUser();
  providerDataResponse = (url, config) => ({
    status: 200,
    data: {
      RequestID: config.params.RequestID,
      status: "FAILED",
      message: "The provider rejected this request.",
    },
  });

  const first = await invoke(user, purchaseBody(), { idempotencyKey: "failed-data-key" });
  const repeated = await invoke(user, purchaseBody(), { idempotencyKey: "failed-data-key" });

  assert.equal(first.status, 400);
  assert.equal(first.body.status, "REFUNDED");
  assert.equal(first.body.walletBalance, 500);
  assert.equal(repeated.status, 400);
  assert.equal(repeated.body.status, "REFUNDED");
  assert.equal(dataRequestCount, 1);
  assert.equal(await User.findById(user._id).then((record) => record.walletBalance), 500);
  assert.equal(await LedgerEntry.countDocuments({ user: user._id, service: "DATA", direction: "DEBIT" }), 1);
  assert.equal(await LedgerEntry.countDocuments({ user: user._id, service: "DATA_REVERSAL", direction: "CREDIT" }), 1);
  const transaction = await Transaction.findOne({ customerId: user._id });
  assert.equal(transaction.status, "FAILED");
  assert.equal(transaction.dispatchStatus, "REFUNDED");
  assert.equal(transaction.providerReference, transaction.reference);
  const debit = await LedgerEntry.findById(transaction.debitLedgerEntryId);
  const reversal = await LedgerEntry.findById(transaction.reversalLedgerEntryId);
  assert.equal(debit.direction, "DEBIT");
  assert.equal(debit.amount, transaction.amount);
  assert.equal(reversal.direction, "CREDIT");
  assert.equal(reversal.amount, transaction.amount);
  assert.equal(reversal.openingBalance, 400);
  assert.equal(reversal.closingBalance, 500);
  assert.equal(reversal.transactionId.toString(), transaction._id.toString());
  assert.equal(reversal.reversalOf.toString(), debit._id.toString());
  assert.equal(reversal.idempotencyKey, `DATA:${transaction.reference}:REVERSAL:CREDIT`);
});

test("an uncorrelated explicit provider failure remains pending without a refund", async () => {
  const user = await makeUser();
  providerDataResponse = {
    status: 200,
    data: { RequestID: "another-order", status: "FAILED" },
  };

  const result = await invoke(user, purchaseBody(), { idempotencyKey: "uncorrelated-failure-key" });
  const transaction = await Transaction.findOne({ customerId: user._id });

  assert.equal(result.status, 202);
  assert.equal(transaction.status, "PENDING");
  assert.equal(transaction.dispatchStatus, "UNKNOWN");
  assert.equal(await User.findById(user._id).then((record) => record.walletBalance), 400);
  assert.equal(await LedgerEntry.countDocuments({ user: user._id, direction: "CREDIT" }), 0);
});

test("a correlated failure message without a terminal failure status is not refundable", async () => {
  const user = await makeUser();
  providerDataResponse = (url, config) => ({
    status: 200,
    data: {
      RequestID: config.params.RequestID,
      message: "The provider rejected this request.",
    },
  });

  const result = await invoke(user, purchaseBody(), { idempotencyKey: "message-only-failure-key" });
  const transaction = await Transaction.findOne({ customerId: user._id });

  assert.equal(result.status, 202);
  assert.equal(transaction.status, "PENDING");
  assert.equal(transaction.dispatchStatus, "UNKNOWN");
  assert.equal(await User.findById(user._id).then((record) => record.walletBalance), 400);
  assert.equal(await LedgerEntry.countDocuments({ user: user._id, direction: "CREDIT" }), 0);
});

test("competing correlated failure reversals credit and post a reversal exactly once", async () => {
  const user = await makeUser();
  await User.updateOne({ _id: user._id }, { $set: { walletBalance: 400 } });
  const reference = `DATA-COMPETING-${++sequence}`;
  const transaction = await Transaction.create({
    reference,
    customerId: user._id,
    serviceType: "DATA",
    provider: "CLUBKONNECT",
    phone: "08012345678",
    amount: 100,
    status: "PENDING",
    dispatchStatus: "CLAIMED",
    dispatchClaimedAt: new Date(),
    providerResponse: { network: "01", planCode: "plan-1" },
  });
  const debit = await LedgerEntry.create({
    user: user._id,
    direction: "DEBIT",
    amount: 100,
    openingBalance: 500,
    closingBalance: 400,
    service: "DATA",
    reference,
    idempotencyKey: `DATA:${reference}:DEBIT`,
    transactionId: transaction._id,
    narration: "Test DATA debit",
  });
  await Transaction.updateOne(
    { _id: transaction._id },
    { $set: { debitLedgerEntryId: debit._id } },
  );

  const providerResponse = { RequestID: reference, status: "FAILED" };
  const results = await Promise.all([
    refundFailedDataPurchase({
      transactionId: transaction._id,
      providerResponse,
      httpStatus: 200,
    }),
    refundFailedDataPurchase({
      transactionId: transaction._id,
      providerResponse,
      httpStatus: 200,
    }),
  ]);

  assert.equal(results.filter((result) => result.status === "REFUNDED").length, 1);
  assert.equal(await User.findById(user._id).then((record) => record.walletBalance), 500);
  assert.equal(await LedgerEntry.countDocuments({
    transactionId: transaction._id,
    service: "DATA_REVERSAL",
    direction: "CREDIT",
  }), 1);
  const persisted = await Transaction.findById(transaction._id);
  assert.equal(persisted.status, "FAILED");
  assert.equal(persisted.dispatchStatus, "REFUNDED");
  assert.ok(persisted.reversalLedgerEntryId);
});

test("uncertain non-success provider response is pending rather than refunded", async () => {
  const user = await makeUser();
  providerDataResponse = {
    status: 200,
    data: { reference: "provider-reference-without-an-outcome" },
  };

  const result = await invoke(user, purchaseBody(), { idempotencyKey: "uncertain-data-key" });

  assert.equal(result.status, 202);
  assert.equal(await User.findById(user._id).then((record) => record.walletBalance), 400);
  assert.equal(await Transaction.countDocuments({ customerId: user._id, status: "PENDING" }), 1);
  assert.equal(await LedgerEntry.countDocuments({ user: user._id, direction: "CREDIT" }), 0);
  assert.equal(dataRequestCount, 1);
});

test("X-Idempotency-Key from the customer API is accepted without a body key", async () => {
  const user = await makeUser();
  const customerApiBody = {
    network: "MTN",
    phone: "08012345678",
    planCode: "plan-1",
    amount: 100,
  };
  const result = await invoke(user, customerApiBody, {
    headers: { "X-Idempotency-Key": "customer-api-header-key" },
  });
  const replay = await invoke(user, customerApiBody, {
    headers: { "X-Idempotency-Key": "customer-api-header-key" },
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.transaction.provider, "CLUBKONNECT");
  assert.equal(replay.status, 200);
  assert.equal(dataRequestCount, 1);
  assert.equal(await Transaction.countDocuments({
    customerId: user._id,
    idempotencyKey: "customer-api-header-key",
  }), 1);
});

test("legacy body and Idempotency-Key contracts remain supported, conflicting keys fail closed", async () => {
  const bodyKeyUser = await makeUser();
  const legacyBody = await invoke(bodyKeyUser, {
    ...purchaseBody(),
    idempotencyKey: "legacy-body-contract",
  });
  assert.equal(legacyBody.status, 200);
  assert.equal(await Transaction.countDocuments({
    customerId: bodyKeyUser._id,
    idempotencyKey: "legacy-body-contract",
  }), 1);

  const headerKeyUser = await makeUser();
  const legacyHeader = await invoke(headerKeyUser, purchaseBody(), {
    headers: { "Idempotency-Key": "legacy-header-contract" },
  });
  assert.equal(legacyHeader.status, 200);
  assert.equal(await Transaction.countDocuments({
    customerId: headerKeyUser._id,
    idempotencyKey: "legacy-header-contract",
  }), 1);

  const conflictUser = await makeUser();
  const conflict = await invoke(conflictUser, {
    ...purchaseBody(),
    idempotencyKey: "body-key",
  }, { idempotencyKey: "header-key" });
  assert.equal(conflict.status, 400);
  assert.equal(await Transaction.countDocuments({ customerId: conflictUser._id }), 0);
});

test("accepted and in-progress ClubKonnect statuses stay pending with no reward or commission", async () => {
  const user = await makeUser();
  for (const status of ["PENDING", "PROCESSING", "ORDER_RECEIVED"]) {
    providerDataResponse = { status: 200, data: { status } };
    const result = await invoke(user, purchaseBody(), {
      idempotencyKey: `provider-${status.toLowerCase()}-key`,
    });
    assert.equal(result.status, 202, `${status} must not finalize delivery`);
    const transaction = await Transaction.findOne({
      customerId: user._id,
      idempotencyKey: `provider-${status.toLowerCase()}-key`,
    });
    assert.equal(transaction.status, "PENDING");
    assert.equal(transaction.dispatchStatus, "UNKNOWN");
    assert.equal(await Commission.countDocuments({ transactionId: transaction._id }), 0);
    assert.equal(await ReferralRewardReconciliation.countDocuments({ sourceId: transaction._id }), 0);
    assert.equal(await LedgerEntry.countDocuments({ transactionId: transaction._id, direction: "CREDIT" }), 0);
  }
});

test("contradictory provider success and failure signals remain UNKNOWN and pending", async () => {
  const user = await makeUser();
  const contradictoryBodies = [
    {
      status: "SUCCESSFUL",
      responseCode: "FAILED",
      message: "The provider rejected this order",
    },
    { status: "FAILED", success: true },
    { status: "SUCCESSFUL", message: "The provider rejected this order." },
  ];

  for (const [index, data] of contradictoryBodies.entries()) {
    providerDataResponse = { status: 200, data };
    const result = await invoke(user, purchaseBody(), {
      idempotencyKey: `contradictory-outcome-key-${index}`,
    });
    const transaction = await Transaction.findOne({
      customerId: user._id,
      idempotencyKey: `contradictory-outcome-key-${index}`,
    });

    assert.equal(result.status, 202);
    assert.equal(transaction.status, "PENDING");
    assert.equal(transaction.dispatchStatus, "UNKNOWN");
    assert.equal(transaction.providerStatus, "CONTRADICTORY");
    assert.equal(await Commission.countDocuments({ transactionId: transaction._id }), 0);
    assert.equal(await ReferralRewardReconciliation.countDocuments({ sourceId: transaction._id }), 0);
  }
  assert.equal(await User.findById(user._id).then((record) => record.walletBalance), 200);
  assert.equal(await LedgerEntry.countDocuments({ user: user._id, direction: "CREDIT" }), 0);
});

test("active provider I/O stays debited until correlated failure is confirmed", async () => {
  const user = await makeUser();
  let finishProviderCall;
  providerDataResponse = (url, config) => new Promise((resolve) => {
    finishProviderCall = () => resolve({
      status: 200,
      data: {
        RequestID: config.params.RequestID,
        status: "FAILED",
        message: "Provider confirms rejection.",
      },
    });
  });

  const purchase = invoke(user, purchaseBody(), { idempotencyKey: "inflight-no-refund-key" });
  while (!finishProviderCall) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const duringProviderIo = await Transaction.findOne({ customerId: user._id });
  assert.equal(duringProviderIo.dispatchStatus, "CLAIMED");
  assert.equal(duringProviderIo.status, "PENDING");
  assert.equal(await User.findById(user._id).then((record) => record.walletBalance), 400);
  assert.equal(await LedgerEntry.countDocuments({ user: user._id, direction: "CREDIT" }), 0);

  finishProviderCall();
  const result = await purchase;
  const afterProviderFailure = await Transaction.findById(duringProviderIo._id);

  assert.equal(result.status, 400);
  assert.equal(afterProviderFailure.status, "FAILED");
  assert.equal(afterProviderFailure.dispatchStatus, "REFUNDED");
  assert.equal(await User.findById(user._id).then((record) => record.walletBalance), 500);
  assert.equal(await LedgerEntry.countDocuments({ user: user._id, service: "DATA_REVERSAL", direction: "CREDIT" }), 1);
});

test("an existing retry outcome is returned before catalog access during outage or repricing", async () => {
  const user = await makeUser();
  const key = "retry-during-catalog-outage";
  const first = await invoke(user, purchaseBody(), { idempotencyKey: key });
  assert.equal(first.status, 200);
  await DataPriceOverride.create({
    networkCode: "01",
    planCode: "plan-1",
    providerPrice: 100,
    sellingPrice: 250,
    active: true,
  });

  plansUnavailable = true;
  const repeated = await invoke(user, purchaseBody(), { idempotencyKey: key });

  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.reference, first.body.reference);
  assert.equal(repeated.body.transaction.amount, 100);
  assert.equal(plansRequestCount, 1);
  assert.equal(dataRequestCount, 1);
  assert.equal(await User.findById(user._id).then((record) => record.walletBalance), 400);
});

test("new admissions fail closed until the unique idempotency index exists", async () => {
  const user = await makeUser();
  await Transaction.collection.dropIndex("uniq_customer_service_idempotency_key");

  const result = await invoke(user, purchaseBody(), { idempotencyKey: "index-not-ready" });

  assert.equal(result.status, 503);
  assert.equal(dataRequestCount, 0);
  assert.equal(await Transaction.countDocuments({ customerId: user._id }), 0);
  assert.equal(await User.findById(user._id).then((record) => record.walletBalance), 500);
  await Transaction.collection.createIndex(
    { customerId: 1, serviceType: 1, idempotencyKey: 1 },
    {
      unique: true,
      name: "uniq_customer_service_idempotency_key",
      partialFilterExpression: { idempotencyKey: { $type: "string" } },
    },
  );
});

test("reconciliation queue is read-only and route requires explicit finance view permission", async () => {
  const customer = await makeUser();
  const entries = await Promise.all(
    ["READY", "CLAIMED", "UNKNOWN", "FAILED"].map((status) =>
      seedPendingTransaction(customer, status),
    ),
  );
  const routeLayer = clubkonnectRoutes.stack.find(
    (layer) => layer.route?.path === "/admin/data-reconciliation",
  );
  assert.ok(routeLayer);
  assert.equal(routeLayer.route.methods.get, true);
  assert.equal(routeLayer.route.methods.post, undefined);
  assert.equal(routeLayer.route.stack.at(-1).handle, controller.getDataReconciliationQueue);
  assert.equal(
    clubkonnectRoutes.stack.some((layer) =>
      layer.route?.path?.includes("/admin/data-reconciliation/") &&
      layer.route.methods.post,
    ),
    false,
  );
  assert.equal(controller.resolveDataReconciliation, undefined);

  const financePermission = routeLayer.route.stack.at(-2).handle;
  const headOfficeWithoutFinance = await invokeHandler(financePermission, {
    staffAccess: { isHeadOffice: true, permissions: ["*"] },
  });
  assert.equal(headOfficeWithoutFinance.status, 403);
  let permissionGranted = false;
  await financePermission(
    { staffAccess: { isHeadOffice: false, permissions: [P.FINANCE_VIEW] } },
    {},
    () => { permissionGranted = true; },
  );
  assert.equal(permissionGranted, true);
  const reconcileOnly = await invokeHandler(financePermission, {
    staffAccess: { isHeadOffice: false, permissions: [P.FINANCE_RECONCILE] },
  });
  assert.equal(reconcileOnly.status, 403);

  const queue = await invokeHandler(controller.getDataReconciliationQueue, {
    query: {},
  });
  assert.equal(queue.status, 200);
  assert.deepEqual(
    new Set(queue.body.data.map((item) => item.dispatchStatus)),
    new Set(["READY", "CLAIMED", "UNKNOWN", "FAILED"]),
  );
  assert.ok(entries.every((entry) => queue.body.data.some((item) => String(item.id) === String(entry._id))));
  const persisted = await Transaction.find({ _id: { $in: entries.map((entry) => entry._id) } })
    .select("dispatchStatus status").lean();
  const persistedById = new Map(persisted.map((row) => [String(row._id), row]));
  assert.ok(entries.every((entry) => {
    const row = persistedById.get(String(entry._id));
    return row?.status === "PENDING" && row.dispatchStatus === entry.dispatchStatus;
  }));
  assert.equal(dataRequestCount, 0);
});