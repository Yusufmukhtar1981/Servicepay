const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const axios = require("axios");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

process.env.CLUBKONNECT_USER_ID = "mock-user";
process.env.CLUBKONNECT_API_KEY = "mock-key";
const controller = require("../controllers/clubkonnectAirtime.controller");
const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const Ledger = require("../models/ledgerEntry.model");
const Commission = require("../models/commission.model");
const ProductCommission = require("../models/productCommission.model");
const receiptService = require("../services/airtimeReceipt.service");
const receiptController = require("../controllers/airtimeReceipt.controller");
const ProviderConfig = require("../models/providerManagementConfig.model");
const models = [User, Transaction, Ledger, Commission, ProductCommission, ProviderConfig];
let replica, oldGet, purchases, queries, sequence = 0;
let purchaseResult, queryResult;
let receiptServer, receiptBase;
const key = "airtime-controller-stable-request";
const invoke = async (handler, user, { body = {}, params = {} } = {}) => {
  const result = {};
  const response = {
    status(code) { result.http = code; return this; },
    json(payload) { result.body = payload; result.http ||= 200; return this; },
  };
  await handler({ user: { _id: user._id }, body, params, headers: {} }, response);
  return result;
};
const makeUser = () => User.create({
  fullName: "Airtime Fixture", phone: `080${String(++sequence).padStart(8, "0")}`,
  password: "FixturePassword", role: "CUSTOMER", status: "ACTIVE", walletBalance: 500,
});
const purchase = user => invoke(controller.buyAirtime, user, {
  body: { network: "MTN", phone: "08012345678", amount: 100, idempotencyKey: key },
});
test.before(async () => {
  assert.ok(!["MONGODB_URI", "MONGO_URI", "DATABASE_URL", "MONGO_URL"].some(k => process.env[k]));
  replica = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ args: ["--nounixsocket"] }],
  });
  await mongoose.connect(replica.getUri(), { dbName: "airtime-controller-isolated" });
  await Promise.all(models.map(model => model.init()));
  const express = require("express"), app = express();
  const { protect } = require("../middleware/auth.middleware");
  app.get("/:reference/details", protect, receiptController.details);
  app.get("/:reference/receipt", protect, receiptController.download);
  receiptServer = app.listen(0, "127.0.0.1");
  await new Promise(resolve => receiptServer.once("listening", resolve));
  receiptBase = "http://127.0.0.1:" + receiptServer.address().port;
  oldGet = axios.get;
  axios.get = async url => {
    if (url.includes("APIAirtimeV1.asp")) { purchases++; return purchaseResult; }
    if (url.includes("APIQueryV1.asp")) { queries++; return queryResult; }
    throw new Error("Unexpected fixture request");
  };
});
test.after(async () => {
  if (receiptServer) await new Promise(resolve => receiptServer.close(resolve));
  axios.get = oldGet;
  await mongoose.disconnect();
  await replica?.stop();
});

async function receiptRequest(reference, user, kind = "details") {
  const token = user ? require("jsonwebtoken").sign({ id: String(user._id),
    authTokenVersion: user.authTokenVersion || 0 }, process.env.JWT_SECRET, { expiresIn: "10m" }) : null;
  return fetch(receiptBase + "/" + encodeURIComponent(reference) + "/" + kind,
    { headers: token ? { Authorization: "Bearer " + token } : {} });
}
test("Airtime details are owner-bound, reject anonymous access and support the original durable request key", async () => {
  const user = await makeUser(), other = await makeUser();
  const result = await purchase(user);
  assert.equal((await receiptRequest(result.body.reference)).status, 401);
  assert.equal((await receiptRequest(result.body.reference, other)).status, 404);
  const response = await receiptRequest(key, user);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/);
  const data = (await response.json()).data.transaction;
  assert.equal(data.status, "PENDING"); assert.equal(data.charged, true);
  assert.equal(data.network, "MTN"); assert.equal(data.refundRecorded, false);
  assert.equal(data.customerName, user.fullName);
  assert.equal(data.customerId, String(user._id));
  assert.equal(data.reference, result.body.reference);
  for (const secret of ["mock-key", "mock-user", "providerResponse", "requestFingerprint"]) {
    assert(!JSON.stringify(data).includes(secret));
  }
  assert.equal(queries, 0); assert.equal(purchases, 1);
});
test("pending, failed and refunded Airtime purchases cannot produce successful receipts", async () => {
  const user = await makeUser(), result = await purchase(user);
  for (const status of ["PENDING", "FAILED", "REFUNDED"]) {
    await Transaction.updateOne({ reference: result.body.reference }, { $set: { status } });
    const r = await receiptRequest(result.body.reference, user, "receipt");
    assert.equal(r.status, 409, status);
    assert.match(r.headers.get("content-type"), /json/);
  }
  assert.equal((await User.findById(user._id)).walletBalance, 400);
  assert.equal(await Ledger.countDocuments({ direction: "CREDIT" }), 0);
});
test("verified successful Airtime purchase produces an original branded PDF without provider calls or new debits", async () => {
  const user = await makeUser(), result = await purchase(user);
  const final = await invoke(controller.requeryAirtime, user, { body: { idempotencyKey: key } });
  assert.equal(final.body.status, "SUCCESSFUL");
  const before = { purchases, queries, wallet: (await User.findById(user._id)).walletBalance,
    transactions: await Transaction.countDocuments({}), ledger: await Ledger.countDocuments({}) };
  const r = await receiptRequest(result.body.reference, user, "receipt");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /application\/pdf/);
  assert.match(r.headers.get("content-disposition"), /attachment;.*\.pdf/);
  assert.match(r.headers.get("cache-control"), /no-store/);
  const bytes = Buffer.from(await r.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  assert(bytes.length > 1000);
  assert.deepEqual({ purchases, queries, wallet: (await User.findById(user._id)).walletBalance,
    transactions: await Transaction.countDocuments({}), ledger: await Ledger.countDocuments({}) }, before);
});
test("receipt generation validates reversals again and never fabricates missing refund evidence", async () => {
  const user = await makeUser(), result = await purchase(user);
  await Transaction.updateOne({ reference: result.body.reference }, { $set: {
    status: "SUCCESSFUL", reversalReference: "existing-recorded-reversal",
  } });
  assert.equal((await receiptRequest(result.body.reference, user, "receipt")).status, 409);
  await Transaction.updateOne({ reference: result.body.reference }, { $set: {
    status: "FAILED", reversalLedgerEntryId: new mongoose.Types.ObjectId(),
  } });
  const detail = await receiptService.load(user._id, result.body.reference);
  assert.equal(detail.view.refundRecorded, false);
  assert.match(detail.view.message, /not yet confirmed/);
  assert.equal((await User.findById(user._id)).walletBalance, 400);
});
test("missing Airtime identity and cross-service references do not infer failure or dispatch", async () => {
  const user = await makeUser();
  assert.equal((await receiptRequest("not-a-recorded-request", user)).status, 404);
  await Transaction.create({ reference: "DATA-NOT-AIRTIME-RECEIPT", customerId: user._id,
    serviceType: "DATA", amount: 100, status: "SUCCESSFUL" });
  assert.equal((await receiptRequest("DATA-NOT-AIRTIME-RECEIPT", user, "receipt")).status, 404);
  assert.equal(purchases, 0); assert.equal(queries, 0);
  assert.equal((await User.findById(user._id)).walletBalance, 500);
});
test("literal Airtime reference cannot be shadowed by another request key", async () => {
  const user = await makeUser(), identity = "AIRTIME-REFERENCE-PRIORITY";
  await Transaction.create({ reference: "DIFFERENT-AIRTIME-REFERENCE", customerId: user._id,
    serviceType: "AIRTIME", amount: 50, status: "PENDING",
    idempotencyKey: crypto.createHash("sha256").update(identity).digest("hex") });
  await Transaction.create({ reference: identity, customerId: user._id,
    serviceType: "AIRTIME", amount: 100, status: "SUCCESSFUL" });
  const detail = await receiptService.load(user._id, identity);
  assert.equal(detail.view.reference, identity);
  assert.equal(detail.view.amount, 100);
  assert.equal(purchases, 0); assert.equal(queries, 0);
});
test.beforeEach(async () => {
  await Promise.all(models.map(model => model.collection.deleteMany({})));
  purchases = queries = 0;
  purchaseResult = { status: 200, data: {
    orderid: "fixture-order", statuscode: "100", status: "ORDER_RECEIVED",
  } };
  queryResult = { status: 200, data: {
    orderid: "fixture-order", requestid: "", statuscode: "200",
    orderstatus: "ORDER_COMPLETED", amountcharged: "98.00",
  } };
  await ProductCommission.create({
    serviceType: "AIRTIME", productCode: "AIRTIME", productName: "Airtime",
    agentCommission: 0.9, stateCommission: 0.54, zonalCommission: 0.36, isActive: true,
  });
});

test("missing client key is rejected before wallet debit or provider dispatch", async () => {
  const user = await makeUser();
  const result = await invoke(controller.buyAirtime, user, {
    body: { network: "MTN", phone: "08012345678", amount: 100 },
  });
  assert.equal(result.http, 400);
  assert.equal(result.body.code, "AIRTIME_IDEMPOTENCY_KEY_REQUIRED");
  assert.equal((await User.findById(user._id)).walletBalance, 500);
  assert.equal(await Transaction.countDocuments({}), 0);
  assert.equal(purchases, 0);
});

test("HTTP 202 success-looking body remains pending and a replay never dispatches twice", async () => {
  const user = await makeUser();
  purchaseResult = { status: 202, data: {
    orderid: "fixture-order", statuscode: "200", status: "ORDER_COMPLETED",
  } };
  const first = await purchase(user);
  const again = await purchase(user);
  assert.equal(first.http, 202);
  assert.equal(again.http, 202);
  assert.equal(first.body.reference, again.body.reference);
  assert.equal((await User.findById(user._id)).walletBalance, 400);
  assert.equal(await Ledger.countDocuments({ direction: "DEBIT" }), 1);
  assert.equal(await Ledger.countDocuments({ direction: "CREDIT" }), 0);
  assert.equal(await Commission.countDocuments({}), 0);
  assert.equal(purchases, 1);
  assert.equal(queries, 0);
});

test("explicit customer-key requery settles once using actual provider cost", async () => {
  const user = await makeUser();
  const admitted = await purchase(user);
  const result = await invoke(controller.requeryAirtime, user, { body: { idempotencyKey: key } });
  assert.equal(result.http, 200);
  assert.equal(result.body.reference, admitted.body.reference);
  assert.equal(result.body.status, "SUCCESSFUL");
  assert.equal(result.body.accountingStatus, "COMPLETE");
  const awards = await Commission.find({});
  assert.equal(awards.length, 1);
  assert.equal(awards[0].providerCost, 98);
  assert.equal(awards[0].netProfit, 2);
  assert.equal((await User.findById(user._id)).walletBalance, 400);
  assert.equal(purchases, 1);
  assert.equal(queries, 1);
  await invoke(controller.requeryAirtime, user, { body: { idempotencyKey: key } });
  assert.equal(queries, 1);
  assert.equal(await Commission.countDocuments({}), 1);
});

test("initial success retains invoice recovery when the OrderID query has no RequestID echo", async () => {
  const user = await makeUser();
  purchaseResult = { status: 200, data: {
    orderid: "fixture-order", statuscode: "200", status: "ORDER_COMPLETED",
  } };
  const first = await purchase(user);
  assert.equal(first.body.status, "SUCCESSFUL");
  assert.notEqual(first.body.accountingStatus, "COMPLETE");
  assert.equal(await Commission.countDocuments({}), 0);
  const result = await invoke(controller.requeryAirtime, user, { body: { idempotencyKey: key } });
  assert.equal(result.http, 200);
  assert.equal(result.body.status, "SUCCESSFUL");
  assert.equal(result.body.accountingStatus, "COMPLETE");
  const awards = await Commission.find({});
  assert.equal(awards.length, 1);
  assert.equal(awards[0].providerCost, 98);
  assert.equal(awards[0].netProfit, 2);
  assert.equal(purchases, 1);
  assert.equal(queries, 1);
});

test("bound terminal failure returns processed HTTP 200 with FAILED and one refund", async () => {
  const user = await makeUser();
  purchaseResult = { status: 200, data: {
    orderid: "fixture-order", statuscode: "500", status: "ORDER_CANCELLED",
  } };
  const result = await purchase(user);
  assert.equal(result.http, 200);
  assert.equal(result.body.success, false);
  assert.equal(result.body.status, "FAILED");
  const details = await receiptService.load(user._id, result.body.reference);
  assert.equal(details.view.refundRecorded, true);
  assert.equal(details.view.refundStatus, "REFUNDED");
  assert.equal(result.body.dispatchStatus, "REFUNDED");
  assert.equal((await User.findById(user._id)).walletBalance, 500);
  assert.equal(await Ledger.countDocuments({ direction: "CREDIT" }), 1);
  assert.equal(await Commission.countDocuments({}), 0);
  await purchase(user);
  assert.equal(purchases, 1);
  assert.equal(await Ledger.countDocuments({ direction: "CREDIT" }), 1);
});

test("another customer's key cannot trigger provider reconciliation", async () => {
  const first = await makeUser();
  await purchase(first);
  const other = await makeUser();
  const result = await invoke(controller.requeryAirtime, other, { body: { idempotencyKey: key } });
  assert.equal(result.http, 404);
  assert.equal(queries, 0);
  assert.equal(purchases, 1);
});

test("historical evidence audit queries the provider without mutating legacy finances", async () => {
  const user = await makeUser();
  const tx = await Transaction.create({
    reference: "AIR-HISTORICAL-FIXTURE", customerId: user._id,
    serviceType: "AIRTIME", provider: "CLUBKONNECT", amount: 100,
    status: "SUCCESSFUL", providerResponse: { orderid: "fixture-order" },
  });
  const digest = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const before = digest(await Transaction.findById(tx._id).lean());
  const result = await invoke(controller.readHistoricalProviderEvidence, user, {
    params: { transactionId: String(tx._id) },
  });
  assert.equal(result.http, 200);
  assert.equal(result.body.readOnly, true);
  assert.equal(result.body.financialMutations, 0);
  assert.equal(result.body.providerCost, 98);
  assert.equal(before, digest(await Transaction.findById(tx._id).lean()));
  assert.equal(await Commission.countDocuments({}), 0);
  assert.equal(await Ledger.countDocuments({}), 0);
  assert.equal(purchases, 0);
  assert.equal(queries, 1);
});