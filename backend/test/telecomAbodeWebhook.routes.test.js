const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const http = require("node:http");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const LedgerEntry = require("../models/ledgerEntry.model");
const { postDebit } = require("../services/ledger.service");
const {
  settleTelecomAbodeDataOutcome,
} = require("../services/telecomAbodeDataSettlement.service");
const {
  verifyTelecomAbodeSource,
} = require("../services/telecomAbodeWebhookSource.service");
const webhookRouter = require("../routes/telecomAbodeWebhook.routes");

let replicaSet;
let sequence = 0;

const makeNotification = (transaction, fields = {}) => ({
  status: "failed",
  api_response: "DATA purchase failed",
  "request-id": transaction.reference,
  amount: "80",
  old_balance: 400,
  new_balance: 300,
  ...fields,
});

const createServer = ({
  verifySource = async (_req, options) => {
    assert.deepEqual(options, { trustedProxyCidrs: [] });
    return true;
  },
  settleOutcome = settleTelecomAbodeDataOutcome,
  trustedProxyCidrs = [],
} = {}) => {
  const app = express();
  app.use("/api/webhooks/telecom-abode", webhookRouter.createTelecomAbodeWebhookRouter({
    verifySource,
    settleOutcome,
    trustedProxyCidrs,
  }));
  return http.createServer(app);
};

const listen = (server) => new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

const close = (server) => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
});

const postJson = (server, payload, { headers = {} } = {}) => new Promise((resolve, reject) => {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const address = server.address();
  const request = http.request({
    host: "127.0.0.1",
    port: address.port,
    path: "/api/webhooks/telecom-abode",
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
  }, (response) => {
    let responseBody = "";
    response.setEncoding("utf8");
    response.on("data", (chunk) => { responseBody += chunk; });
    response.on("end", () => resolve({
      status: response.statusCode,
      body: responseBody ? JSON.parse(responseBody) : null,
    }));
  });
  request.on("error", reject);
  request.end(body);
});

const seedPendingTransaction = async ({
  dispatchStatus = "SENDING",
  missingDebit = false,
} = {}) => {
  const id = ++sequence;
  const reference = `TA-WEBHOOK-${id}`;
  const customer = await User.create({
    fullName: `Telecom Webhook Customer ${id}`,
    phone: `080${String(id).padStart(8, "0")}`,
    email: `telecom-webhook-${id}@test.invalid`,
    password: "test-password-only",
    role: "CUSTOMER",
    status: "ACTIVE",
    walletBalance: 400,
  });
  const transaction = await Transaction.create({
    reference,
    providerRequestId: reference,
    customerId: customer._id,
    serviceType: "DATA",
    provider: "TELECOM_ABODE",
    phone: "08012345678",
    amount: 100,
    status: "PENDING",
    dispatchStatus,
    dispatchClaimedAt: new Date(),
    ...(missingDebit ? { debitLedgerEntryId: new mongoose.Types.ObjectId() } : {}),
    providerResponse: {
      providerPrice: 80,
      quotedPrice: 100,
      network: "01",
      planCode: "77",
    },
  });
  if (!missingDebit) {
    const debit = await postDebit({
      userId: customer._id,
      amount: 100,
      openingBalance: 500,
      closingBalance: 400,
      service: "DATA",
      reference,
      idempotencyKey: `DATA:${reference}:DEBIT`,
      transactionId: transaction._id,
    });
    await Transaction.updateOne(
      { _id: transaction._id },
      { $set: { debitLedgerEntryId: debit.entry._id } },
    );
    transaction.debitLedgerEntryId = debit.entry._id;
  }
  return { customer, transaction };
};

test.before(async () => {
  // Always use this private replica set; ambient MONGODB_URI is intentionally ignored.
  replicaSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ args: ["--nounixsocket"] }],
  });
  await mongoose.connect(replicaSet.getUri(), { dbName: "telecom-abode-webhook-tests" });
  await Promise.all([User, Transaction, LedgerEntry].map((model) => model.init()));
});

test.after(async () => {
  await mongoose.disconnect();
  await replicaSet?.stop();
});

test.beforeEach(async () => {
  await Promise.all([
    User.collection.deleteMany({}),
    Transaction.collection.deleteMany({}),
    LedgerEntry.collection.deleteMany({}),
  ]);
});

test("source denial precedes settlement and has a generic 403 response", async (t) => {
  const { transaction } = await seedPendingTransaction();
  let settlementCalls = 0;
  const server = createServer({
    verifySource: async () => false,
    settleOutcome: async () => { settlementCalls += 1; },
  });
  await listen(server);
  t.after(() => close(server));

  const response = await postJson(server, makeNotification(transaction));
  assert.equal(response.status, 403);
  assert.deepEqual(response.body, { error: "FORBIDDEN" });
  assert.equal(settlementCalls, 0);
  assert.equal((await Transaction.findById(transaction._id)).status, "PENDING");
});

test("actual source helper rejects a forged provider forwarding header from an untrusted socket peer", async (t) => {
  const { transaction } = await seedPendingTransaction();
  let settlementCalls = 0;
  const server = createServer({
    verifySource: verifyTelecomAbodeSource,
    trustedProxyCidrs: [],
    settleOutcome: async () => { settlementCalls += 1; },
  });
  await listen(server);
  t.after(() => close(server));

  const response = await postJson(
    server,
    makeNotification(transaction),
    { headers: { "x-forwarded-for": "49.12.92.4" } },
  );
  assert.equal(response.status, 403);
  assert.deepEqual(response.body, { error: "FORBIDDEN" });
  assert.equal(settlementCalls, 0);
  assert.equal((await Transaction.findById(transaction._id)).status, "PENDING");
});

test("actual source helper fails closed for invalid trusted-proxy CIDR configuration", async (t) => {
  let settlementCalls = 0;
  const server = createServer({
    verifySource: verifyTelecomAbodeSource,
    trustedProxyCidrs: ["not-a-cidr"],
    settleOutcome: async () => { settlementCalls += 1; },
  });
  await listen(server);
  t.after(() => close(server));

  const response = await postJson(
    server,
    {
      status: "success",
      api_response: "Data completed",
      "request-id": "UNKNOWN-EXACT-REQUEST",
      old_balance: 400,
      new_balance: 320,
    },
    { headers: { "x-forwarded-for": "49.12.92.4" } },
  );
  assert.equal(response.status, 403);
  assert.equal(settlementCalls, 0);
});

test("malformed status pairs and conflicting request aliases return 400", async (t) => {
  const { transaction } = await seedPendingTransaction();
  const server = createServer();
  await listen(server);
  t.after(() => close(server));

  const contradictoryStatus = await postJson(server, makeNotification(transaction, {
    status: "success",
    Status: "failed",
    api_response: "Request received",
  }));
  const contradictoryId = await postJson(server, makeNotification(transaction, {
    "request-id": transaction.reference,
    request_id: "another-request",
  }));
  const missingDocumentedBalances = await postJson(server, makeNotification(transaction, {
    old_balance: undefined,
    new_balance: undefined,
  }));
  const nullAmount = await postJson(server, makeNotification(transaction, { amount: null }));
  assert.equal(contradictoryStatus.status, 400);
  assert.deepEqual(contradictoryStatus.body, { error: "INVALID_WEBHOOK_PAYLOAD" });
  assert.equal(contradictoryId.status, 400);
  assert.equal(missingDocumentedBalances.status, 400);
  assert.equal(nullAmount.status, 400);
  assert.equal((await Transaction.findById(transaction._id)).status, "PENDING");
});

test("valid processing receipt is audited without wallet mutation", async (t) => {
  const { customer, transaction } = await seedPendingTransaction();
  const server = createServer();
  await listen(server);
  t.after(() => close(server));

  const response = await postJson(server, makeNotification(transaction, {
    status: "processing",
    request_id: transaction.reference,
    amount: undefined,
    api_response: "Request is processing",
    old_balance: 400,
    new_balance: 400,
  }));
  const current = await Transaction.findById(transaction._id).lean();
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { received: true });
  assert.equal(current.status, "PENDING");
  assert.equal(current.dispatchStatus, "SENDING");
  assert.equal(current.providerResponse.telecomAbodeSettlement.outcome, "PENDING");
  assert.equal(await User.findById(customer._id).then((user) => user.walletBalance), 400);
  assert.equal(await LedgerEntry.countDocuments({ transactionId: transaction._id, direction: "CREDIT" }), 0);
});

test("unknown exact request ID receives a generic acknowledgement with no mutation", async (t) => {
  const { customer, transaction } = await seedPendingTransaction();
  await Transaction.updateOne(
    { _id: transaction._id },
    { $set: { serviceType: "AIRTIME" } },
  );
  const server = createServer();
  await listen(server);
  t.after(() => close(server));

  const response = await postJson(server, makeNotification(transaction));
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { received: true });
  assert.equal((await Transaction.findById(transaction._id)).status, "PENDING");
  assert.equal(await User.findById(customer._id).then((user) => user.walletBalance), 400);
  assert.equal(await LedgerEntry.countDocuments({ transactionId: transaction._id, direction: "CREDIT" }), 0);

  const unknown = await postJson(server, {
    status: "success",
    api_response: "Data completed",
    request_id: "UNKNOWN-EXACT-REQUEST",
    amount: 80,
    old_balance: 400,
    new_balance: 320,
  });
  assert.equal(unknown.status, 200);
  assert.deepEqual(unknown.body, { received: true });
});

test("success webhook only settles an exact Telecom Abode DATA transaction", async (t) => {
  const { customer, transaction } = await seedPendingTransaction();
  const server = createServer();
  await listen(server);
  t.after(() => close(server));

  const notification = makeNotification(transaction, {
    status: "success",
    Status: "successful",
    api_response: "DATA purchase successful",
    amount: 80,
    old_balance: 400,
    new_balance: 320,
  });
  const response = await postJson(server, notification);
  const duplicate = await postJson(server, notification);
  const current = await Transaction.findById(transaction._id).lean();
  assert.equal(response.status, 200);
  assert.equal(duplicate.status, 200);
  assert.equal(current.status, "SUCCESSFUL");
  assert.equal(current.dispatchStatus, "SUCCEEDED");
  assert.equal(current.providerResponse.telecomAbodeSettlement.source, "TELECOM_ABODE_WEBHOOK");
  assert.equal(await User.findById(customer._id).then((user) => user.walletBalance), 400);
  assert.equal(await LedgerEntry.countDocuments({ transactionId: transaction._id, direction: "DEBIT" }), 1);
  assert.equal(await LedgerEntry.countDocuments({ transactionId: transaction._id, direction: "CREDIT" }), 0);
});

test("failure webhook atomically refunds once and duplicate delivery is acknowledged", async (t) => {
  const { customer, transaction } = await seedPendingTransaction({ dispatchStatus: "UNKNOWN" });
  const server = createServer();
  await listen(server);
  t.after(() => close(server));

  const notification = makeNotification(transaction);
  const [first, duplicate] = await Promise.all([
    postJson(server, notification),
    postJson(server, notification),
  ]);
  const current = await Transaction.findById(transaction._id).lean();
  const reversal = await LedgerEntry.findOne({
    transactionId: transaction._id,
    direction: "CREDIT",
  }).lean();
  assert.equal(first.status, 200);
  assert.equal(duplicate.status, 200);
  assert.equal(current.status, "FAILED");
  assert.equal(current.dispatchStatus, "REFUNDED");
  assert.equal(current.reversalLedgerEntryId.toString(), reversal._id.toString());
  assert.doesNotMatch(
    JSON.stringify(current.providerResponse.telecomAbodeSettlement),
    /api_response|old_balance|new_balance|08012345678/,
  );
  assert.equal(reversal.idempotencyKey, `DATA:${transaction.reference}:REVERSAL:CREDIT`);
  assert.equal(await LedgerEntry.countDocuments({ transactionId: transaction._id, direction: "DEBIT" }), 1);
  assert.equal(await LedgerEntry.countDocuments({ transactionId: transaction._id, direction: "CREDIT" }), 1);
  assert.equal(await User.findById(customer._id).then((user) => user.walletBalance), 500);
});

test("a prior reversal under another idempotency key fails closed without a second credit", async (t) => {
  const { customer, transaction } = await seedPendingTransaction({ dispatchStatus: "UNKNOWN" });
  const debit = await LedgerEntry.findById(transaction.debitLedgerEntryId).lean();
  const existingReversal = await LedgerEntry.create({
    user: customer._id,
    direction: "CREDIT",
    amount: transaction.amount,
    openingBalance: 400,
    closingBalance: 500,
    service: "DATA_REVERSAL",
    reference: transaction.reference,
    idempotencyKey: "LEGACY-DIFFERENT-REVERSAL-KEY",
    transactionId: transaction._id,
    reversalOf: debit._id,
    narration: "Existing legacy reversal",
  });
  await User.updateOne({ _id: customer._id }, { $set: { walletBalance: 500 } });
  const server = createServer();
  await listen(server);
  t.after(() => close(server));

  const response = await postJson(server, makeNotification(transaction));
  const successResponse = await postJson(server, makeNotification(transaction, {
    status: "success",
    api_response: "DATA completed",
  }));
  const current = await Transaction.findById(transaction._id).lean();
  assert.equal(response.status, 503);
  assert.equal(successResponse.status, 503);
  assert.deepEqual(response.body, { error: "WEBHOOK_PROCESSING_UNAVAILABLE" });
  assert.equal(current.status, "PENDING");
  assert.equal(current.dispatchStatus, "UNKNOWN");
  assert.equal(current.reversalLedgerEntryId, null);
  assert.equal(await User.findById(customer._id).then((user) => user.walletBalance), 500);
  assert.equal(await LedgerEntry.countDocuments({ reversalOf: debit._id }), 1);
  assert.equal(await LedgerEntry.countDocuments({ direction: "CREDIT" }), 1);
  assert.equal(existingReversal.idempotencyKey, "LEGACY-DIFFERENT-REVERSAL-KEY");
});

test("amount must match provider cost, not customer markup", async (t) => {
  const { customer, transaction } = await seedPendingTransaction();
  const server = createServer();
  await listen(server);
  t.after(() => close(server));

  const response = await postJson(server, makeNotification(transaction, {
    amount: 100,
    status: "failed",
  }));
  const current = await Transaction.findById(transaction._id).lean();
  assert.equal(response.status, 503);
  assert.equal(current.status, "PENDING");
  assert.equal(current.dispatchStatus, "SENDING");
  assert.equal(await User.findById(customer._id).then((user) => user.walletBalance), 400);
  assert.equal(await LedgerEntry.countDocuments({ transactionId: transaction._id, direction: "CREDIT" }), 0);
});

test("callbacks cannot settle pending READY or CLAIMED records without send evidence", async (t) => {
  const server = createServer();
  await listen(server);
  t.after(() => close(server));

  for (const dispatchStatus of ["READY", "CLAIMED"]) {
    const { customer, transaction } = await seedPendingTransaction({ dispatchStatus });
    const response = await postJson(server, makeNotification(transaction));
    const current = await Transaction.findById(transaction._id).lean();
    assert.equal(response.status, 503);
    assert.equal(current.status, "PENDING");
    assert.equal(current.dispatchStatus, dispatchStatus);
    assert.equal(await User.findById(customer._id).then((user) => user.walletBalance), 400);
    assert.equal(await LedgerEntry.countDocuments({
      transactionId: transaction._id,
      direction: "CREDIT",
    }), 0);
  }
});

test("terminal success and historical held failure are never rewritten or refunded", async (t) => {
  const successful = await seedPendingTransaction();
  const heldFailure = await seedPendingTransaction();
  await Transaction.updateOne(
    { _id: successful.transaction._id },
    { $set: { status: "SUCCESSFUL", dispatchStatus: "SUCCEEDED" } },
  );
  await Transaction.updateOne(
    { _id: heldFailure.transaction._id },
    { $set: { status: "FAILED", dispatchStatus: "FAILED" } },
  );
  const server = createServer();
  await listen(server);
  t.after(() => close(server));

  await postJson(server, makeNotification(successful.transaction, {
    status: "failed",
    api_response: "DATA purchase failed",
  }));
  await postJson(server, makeNotification(heldFailure.transaction));

  const currentSuccess = await Transaction.findById(successful.transaction._id).lean();
  const currentFailure = await Transaction.findById(heldFailure.transaction._id).lean();
  assert.equal(currentSuccess.status, "SUCCESSFUL");
  assert.equal(currentSuccess.dispatchStatus, "SUCCEEDED");
  assert.equal(currentFailure.status, "FAILED");
  assert.equal(currentFailure.dispatchStatus, "FAILED");
  assert.equal(await User.findById(successful.customer._id).then((user) => user.walletBalance), 400);
  assert.equal(await User.findById(heldFailure.customer._id).then((user) => user.walletBalance), 400);
  assert.equal(await LedgerEntry.countDocuments({ direction: "CREDIT" }), 0);
});

test("missing or inconsistent exact debit causes rollback and webhook receives 503", async (t) => {
  const { customer, transaction } = await seedPendingTransaction({ missingDebit: true });
  const server = createServer();
  await listen(server);
  t.after(() => close(server));

  const response = await postJson(server, makeNotification(transaction));
  const current = await Transaction.findById(transaction._id).lean();
  assert.equal(response.status, 503);
  assert.deepEqual(response.body, { error: "WEBHOOK_PROCESSING_UNAVAILABLE" });
  assert.equal(current.status, "PENDING");
  assert.equal(current.dispatchStatus, "SENDING");
  assert.equal(await User.findById(customer._id).then((user) => user.walletBalance), 400);
  assert.equal(await LedgerEntry.countDocuments({ direction: "CREDIT" }), 0);
});

test("concurrent success and failure results commit only one terminal outcome", async () => {
  const { customer, transaction } = await seedPendingTransaction();
  const evidence = (providerStatus) => ({
    requestId: transaction.reference,
    service: "data",
    verifiedSource: true,
    providerStatus,
    amount: 80,
  });
  const results = await Promise.all([
    settleTelecomAbodeDataOutcome({
      requestId: transaction.reference,
      outcome: "SUCCESS",
      source: "WEBHOOK",
      evidence: evidence("success"),
    }),
    settleTelecomAbodeDataOutcome({
      requestId: transaction.reference,
      outcome: "FAILED",
      source: "WEBHOOK",
      evidence: evidence("failed"),
    }),
  ]);
  const current = await Transaction.findById(transaction._id).lean();
  const credits = await LedgerEntry.countDocuments({
    transactionId: transaction._id,
    direction: "CREDIT",
  });
  assert.ok(["SUCCESSFUL", "FAILED"].includes(current.status));
  assert.equal(current.status === "FAILED" ? current.dispatchStatus : "SUCCEEDED",
    current.status === "FAILED" ? "REFUNDED" : "SUCCEEDED");
  assert.equal(credits, current.status === "FAILED" ? 1 : 0);
  assert.equal(await User.findById(customer._id).then((user) => user.walletBalance),
    current.status === "FAILED" ? 500 : 400);
  assert.ok(results.some((result) => ["SETTLED", "REFUNDED"].includes(result.status)));
  assert.equal(await LedgerEntry.countDocuments({ transactionId: transaction._id, direction: "DEBIT" }), 1);
});

test("settlement exceptions are not acknowledged", async (t) => {
  const { transaction } = await seedPendingTransaction();
  const server = createServer({
    settleOutcome: async () => {
      throw new Error("test-only transaction failure");
    },
  });
  await listen(server);
  t.after(() => close(server));

  const response = await postJson(server, makeNotification(transaction));
  assert.equal(response.status, 503);
  assert.deepEqual(response.body, { error: "WEBHOOK_PROCESSING_UNAVAILABLE" });
  assert.equal((await Transaction.findById(transaction._id)).status, "PENDING");
});