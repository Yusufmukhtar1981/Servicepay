const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const { createModels, initializeModels } = require("../models");
const { app } = require("../app");
const { hash } = require("../middleware/auth");
const { deliveryWorker, signature, assertSafeCallback } = require("../services/webhookDelivery");
const { SandboxMockProvider } = require("../services/mockProvider");
const { executeIdempotent } = require("../services/idempotentOperation");

let mongo, connection, productionConnection, models, server, port, cfg, credentials, productionSnapshot;
function request(method, path, body, extra = {}, credential = credentials.a) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? "" : JSON.stringify(body);
    const req = http.request({ port, path, method, headers: { ...extra, ...(credential ? { "X-VULL-API-Key": credential.key, "X-VULL-API-Secret": credential.secret } : {}), ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}) } }, res => {
      let raw = ""; res.on("data", chunk => { raw += chunk; }); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: raw ? JSON.parse(raw) : {} }));
    }); req.on("error", reject); req.end(data);
  });
}
async function credential(name) {
  const key = `vull_sb_${name}`, secret = `${name}-secret`;
  const record = await models.Credential.create({ environment: "SANDBOX", apiKey: key, secretHash: hash(secret, cfg.authPepper), scopes: ["checkout:write","checkout:read","refund:write","subscription:write","reconciliation:read"] });
  await models.Wallet.create({ environment: "SANDBOX", credentialId: record._id, balanceMinor: 0 });
  return { key, secret, record };
}
test.before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  connection = mongoose.createConnection(mongo.getUri("vull_sandbox"));
  await connection.asPromise();
  models = await initializeModels(createModels(connection));
  productionConnection = mongoose.createConnection(mongo.getUri("production"));
  await productionConnection.asPromise();
  for (const name of ["users", "partners", "wallets", "transactions"]) await productionConnection.collection(name).insertOne({ sentinel: name, nested: { unchanged: true } });
  productionSnapshot = await Promise.all(["users", "partners", "wallets", "transactions"].map(name => productionConnection.collection(name).find({}).toArray()));
  cfg = { authPepper: "test-pepper", webhookSecret: "test-webhook", nodeEnv: "test" };
  credentials = { a: await credential("clienta"), b: await credential("clientb") };
  server = http.createServer(app(models, cfg)); await new Promise(resolve => server.listen(0, resolve)); port = server.address().port;
});
test.after(async () => { await new Promise(resolve => server.close(resolve)); await connection.close(); await productionConnection.close(); await mongo.stop(); });

test("production database/default mongoose are isolated from every sandbox flow", async () => {
  const now = await Promise.all(["users", "partners", "wallets", "transactions"].map(name => productionConnection.collection(name).find({}).toArray()));
  assert.deepEqual(now, productionSnapshot);
  assert.equal((await productionConnection.db.listCollections({ name: "vullsandboxcredentials" }).toArray()).length, 0);
  assert.equal(mongoose.connection.readyState, 0);
  assert.equal(mongoose.modelNames().length, 0);
});

test("checkout scenarios, reads, idempotency, and isolated credentials", async () => {
  let response = await request("POST", "/v1/checkouts", { amountMinor: 250, scenario: "success" }, { "Idempotency-Key": "success-1" });
  assert.equal(response.status, 201); const reference = response.body.checkout.reference;
  assert.equal((await models.Wallet.findOne({ credentialId: credentials.a.record._id })).balanceMinor, 250);
  assert.equal(await models.Ledger.countDocuments({ transactionId: response.body.checkout._id }), 1);
  assert.equal((await request("GET", `/v1/checkouts/${reference}`)).status, 200);
  assert.equal((await request("POST", `/v1/checkouts/${reference}/verify`, {}, { "Idempotency-Key": "verify-1" })).body.checkout.status, "SUCCEEDED");
  assert.equal((await request("GET", `/v1/checkouts/${reference}`, undefined, {}, credentials.b)).status, 404);
  const replay = await request("POST", "/v1/checkouts", { amountMinor: 250, scenario: "success" }, { "Idempotency-Key": "success-1" });
  assert.equal(replay.headers["idempotent-replay"], "true");
  assert.equal((await request("POST", "/v1/checkouts", { amountMinor: 251, scenario: "success" }, { "Idempotency-Key": "success-1" })).status, 409);
  for (const [scenario, status] of [["declined","DECLINED"],["pending","PENDING"]]) {
    response = await request("POST", "/v1/checkouts", { amountMinor: 10, scenario }, { "Idempotency-Key": scenario });
    assert.equal(response.body.checkout.status, status);
  }
  response = await request("POST", "/v1/checkouts", { amountMinor: 10, scenario: "provider_error" }, { "Idempotency-Key": "provider-error" });
  assert.equal(response.status, 502);
  assert.equal((await request("POST", "/v1/checkouts", { amountMinor: 1, scenario: "wat" }, { "Idempotency-Key": "unknown" })).status, 400);
});

test("concurrent same-key checkout commits exactly one mutation and outbox", async () => {
  const before = (await models.Wallet.findOne({ credentialId: credentials.a.record._id })).balanceMinor;
  const calls = await Promise.all([
    request("POST", "/v1/checkouts", { amountMinor: 77, scenario: "success" }, { "Idempotency-Key": "concurrent-checkout" }),
    request("POST", "/v1/checkouts", { amountMinor: 77, scenario: "success" }, { "Idempotency-Key": "concurrent-checkout" }),
  ]);
  assert.deepEqual(calls.map(item => item.status), [201, 201]);
  assert.equal(calls.filter(item => item.headers["idempotent-replay"] === "true").length, 1);
  const checkoutReference = calls[0].body.checkout.reference;
  const transaction = await models.Transaction.findOne({ reference: checkoutReference });
  assert.equal(await models.Transaction.countDocuments({ reference: checkoutReference }), 1);
  assert.equal(await models.Ledger.countDocuments({ transactionId: transaction._id }), 1);
  const idempotency = await models.Idempotency.findOne({ key: "concurrent-checkout" });
  assert.equal(idempotency.outboxEventIds.length, 1);
  assert.equal(await models.Webhook.countDocuments({ eventId: idempotency.outboxEventIds[0] }), 1);
  assert.equal((await models.Wallet.findOne({ credentialId: credentials.a.record._id })).balanceMinor, before + 77);
});

test("failpoint before commit rolls back operation, idempotency and outbox", async () => {
  const wallet = await models.Wallet.findOne({ credentialId: credentials.a.record._id });
  const before = wallet.balanceMinor;
  await assert.rejects(() => executeIdempotent({
    models,
    credentialId: credentials.a.record._id,
    key: "forced-rollback",
    requestHash: "forced-rollback-hash",
    failpoints: { beforeCommit: async () => { throw new Error("forced"); } },
    operation: async session => {
      await models.Wallet.updateOne({ _id: wallet._id }, { $inc: { balanceMinor: 99 } }, { session });
      const [transaction] = await models.Transaction.create([{ environment: "SANDBOX", credentialId: credentials.a.record._id, reference: "forced-transaction", amountMinor: 99, currency: "NGN", scenario: "success", status: "SUCCEEDED" }], { session });
      await models.Ledger.create([{ environment: "SANDBOX", walletId: wallet._id, transactionId: transaction._id, direction: "CREDIT", amountMinor: 99, openingBalanceMinor: before, closingBalanceMinor: before + 99, reference: "forced-ledger", idempotencyKey: "forced-ledger" }], { session });
      await models.Refund.create([{ environment: "SANDBOX", credentialId: credentials.a.record._id, transactionId: transaction._id, reference: "forced-refund", amountMinor: 99 }], { session });
      await models.Subscription.create([{ environment: "SANDBOX", credentialId: credentials.a.record._id, reference: "forced-subscription", amountMinor: 99 }], { session });
      await models.Reconciliation.create([{ environment: "SANDBOX", credentialId: credentials.a.record._id, reference: "forced-reconciliation", report: {} }], { session });
      await models.Webhook.create([{ environment: "SANDBOX", eventId: "forced-event", credentialId: credentials.a.record._id, type: "forced", rawBody: Buffer.from("{}") }], { session });
      return { statusCode: 201, response: { ok: true }, outboxEventIds: ["forced-event"] };
    },
  }), /forced/);
  assert.equal((await models.Wallet.findById(wallet._id)).balanceMinor, before);
  assert.equal(await models.Webhook.countDocuments({ eventId: "forced-event" }), 0);
  assert.equal(await models.Transaction.countDocuments({ reference: "forced-transaction" }), 0);
  assert.equal(await models.Ledger.countDocuments({ reference: "forced-ledger" }), 0);
  assert.equal(await models.Refund.countDocuments({ reference: "forced-refund" }), 0);
  assert.equal(await models.Subscription.countDocuments({ reference: "forced-subscription" }), 0);
  assert.equal(await models.Reconciliation.countDocuments({ reference: "forced-reconciliation" }), 0);
  assert.equal(await models.Idempotency.countDocuments({ key: "forced-rollback" }), 0);
});

test("two concurrent refund keys produce one refund and reversal", async () => {
  const checkout = await request("POST", "/v1/checkouts", { amountMinor: 64, scenario: "success" }, { "Idempotency-Key": "parallel-refund-source" });
  const body = { checkoutReference: checkout.body.checkout.reference };
  const responses = await Promise.all([
    request("POST", "/v1/refunds", body, { "Idempotency-Key": "parallel-refund-a" }),
    request("POST", "/v1/refunds", body, { "Idempotency-Key": "parallel-refund-b" }),
  ]);
  assert.deepEqual(responses.map(item => item.status).sort(), [201, 409]);
  const transaction = await models.Transaction.findOne({ reference: body.checkoutReference });
  assert.equal(await models.Refund.countDocuments({ transactionId: transaction._id }), 1);
  assert.equal(await models.Ledger.countDocuments({ transactionId: transaction._id, direction: "DEBIT" }), 1);
  const completed = await models.Idempotency.findOne({ key: { $in: ["parallel-refund-a", "parallel-refund-b"] }, statusCode: 201 });
  assert.equal(completed.outboxEventIds.length, 1);
  assert.equal(await models.Webhook.countDocuments({ eventId: completed.outboxEventIds[0] }), 1);
});

test("refund, subscription billing, reconciliation, and append-only ledger", async () => {
  const checkout = await request("POST", "/v1/payments", { amountMinor: 100, scenario: "success" }, { "Idempotency-Key": "refund-source" });
  const refund = await request("POST", "/v1/refunds", { checkoutReference: checkout.body.checkout.reference }, { "Idempotency-Key": "refund-1" });
  assert.equal(refund.status, 201);
  assert.equal((await request("POST", "/v1/refunds", { checkoutReference: checkout.body.checkout.reference }, { "Idempotency-Key": "refund-2" })).status, 409);
  assert.equal((await request("POST", "/v1/refunds", { checkoutReference: "missing" }, { "Idempotency-Key": "refund-missing" })).status, 409);
  const subscription = await request("POST", "/v1/subscriptions", { amountMinor: 33 }, { "Idempotency-Key": "sub-1" });
  const reference = subscription.body.subscription.reference;
  assert.equal((await request("POST", `/v1/subscriptions/${reference}/renew`, {}, { "Idempotency-Key": "renew-1" })).body.transaction.kind, "SUBSCRIPTION_RENEWAL");
  assert.equal((await request("POST", `/v1/subscriptions/${reference}/cancel`, {}, { "Idempotency-Key": "cancel-1" })).body.subscription.status, "CANCELED");
  assert.equal((await request("POST", `/v1/subscriptions/${reference}/renew`, {}, { "Idempotency-Key": "renew-2" })).status, 409);
  const reconciliation = await request("POST", "/v1/reconciliations", {}, { "Idempotency-Key": "rec-1" });
  assert.ok(reconciliation.body.reconciliation.report.renewals >= 1);
  const ledger = await models.Ledger.findOne();
  await assert.rejects(() => models.Ledger.updateOne({ _id: ledger._id }, { $set: { amountMinor: 1 } }), /append-only/);
});

test("authentication, webhook replay and delivery retry controls", async () => {
  assert.equal((await request("GET", "/v1/checkouts/nope", undefined, {}, { key: "sp_live_x", secret: "x" })).status, 401);
  assert.equal((await request("GET", "/v1/checkouts/nope", undefined, {}, { key: credentials.a.key, secret: "wrong" })).status, 401);
  const raw = Buffer.from(JSON.stringify({ control: true })), timestamp = String(Math.floor(Date.now() / 1000)), eventId = "inbound-1";
  const headers = { "X-VULL-Event-ID": eventId, "X-VULL-Timestamp": timestamp, "X-VULL-Environment": "SANDBOX", "X-VULL-Signature": signature(cfg.webhookSecret, timestamp, eventId, raw) };
  assert.equal((await request("POST", "/v1/inbound/events", { control: true }, headers)).status, 202);
  assert.equal((await request("POST", "/v1/inbound/events", { control: true }, headers)).headers["idempotent-replay"], "true");
  assert.equal((await request("POST", "/v1/inbound/events", { control: true }, { ...headers, "X-VULL-Signature": "sha256=x" })).status, 401);
  assert.equal((await request("POST", "/v1/inbound/events", { control: true }, { ...headers, "X-VULL-Event-ID": "nonnumeric", "X-VULL-Timestamp": "not-a-number" })).status, 401);
  assert.equal((await request("POST", "/v1/inbound/events", { control: true }, { ...headers, "X-VULL-Event-ID": "stale", "X-VULL-Timestamp": "1" })).status, 401);
  assert.equal((await request("POST", "/v1/inbound/events", { control: true }, { ...headers, "X-VULL-Event-ID": "wrong-env", "X-VULL-Environment": "LIVE" })).status, 401);
  let sends = 0; const worker = deliveryWorker(models, cfg, async () => { sends += 1; return 500; });
  await models.Credential.updateOne({ _id: credentials.a.record._id }, { $set: { callbackUrl: "https://localhost/callback" } });
  await models.Webhook.updateMany({}, { $set: { status: "DELIVERED" } });
  const event = await models.Webhook.create({ environment:"SANDBOX",eventId:"outbound-retry",credentialId:credentials.a.record._id,type:"test",rawBody:Buffer.from("{}"),nextAttemptAt:new Date(0) });
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const future = new Date(Date.now() + 2 ** (attempt + 10) * 1000);
    await worker.processPending(future);
  }
  const stored = await models.Webhook.findById(event._id);
  assert.equal(stored.status, "FAILED");
  assert.equal(stored.attempts, 5);
  assert.equal(sends, 5);
  await assert.rejects(() => assertSafeCallback("http://127.0.0.1/", "test"), /HTTPS/);
  const provider = new SandboxMockProvider(); assert.throws(() => provider.networkOperation(), /tripwire/); assert.equal(provider.outboundCalls, 0);
});

test("concurrent workers lease an outbox event for one delivery", async () => {
  await models.Credential.updateOne({ _id: credentials.a.record._id }, { $set: { callbackUrl: "https://localhost/callback" } });
  await models.Webhook.updateMany({}, { $set: { status: "DELIVERED" } });
  await models.Webhook.create({ environment: "SANDBOX", eventId: "leased-once", credentialId: credentials.a.record._id, type: "lease.test", rawBody: Buffer.from("{}"), nextAttemptAt: new Date(0) });
  let deliveries = 0;
  const transport = async () => { deliveries += 1; await new Promise(resolve => setTimeout(resolve, 20)); return 204; };
  const one = deliveryWorker(models, cfg, transport);
  const two = deliveryWorker(models, cfg, transport);
  await Promise.all([one.processPending(new Date()), two.processPending(new Date())]);
  assert.equal(deliveries, 1);
  const event = await models.Webhook.findOne({ eventId: "leased-once" });
  assert.equal(event.status, "DELIVERED");
  assert.equal(event.attempts, 1);
});

test("production sentinels remain unchanged after all sandbox money flows", async () => {
  const after = await Promise.all(
    ["users", "partners", "wallets", "transactions"].map(name =>
      productionConnection.collection(name).find({}).toArray()
    )
  );
  assert.deepEqual(after, productionSnapshot);

  const productionCollections = await productionConnection.db.listCollections().toArray();
  assert.deepEqual(
    productionCollections.map(collection => collection.name).sort(),
    ["partners", "transactions", "users", "wallets"]
  );
  assert.equal(mongoose.connection.readyState, 0);
  assert.equal(mongoose.modelNames().length, 0);
});