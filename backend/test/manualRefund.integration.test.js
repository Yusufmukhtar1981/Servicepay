const { test, before, after, mock } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const T = require("../models/transaction.model");
const U = require("../models/user.model");
const L = require("../models/ledgerEntry.model");
const A = require("../models/adminAuditLog.model");
const N = require("../models/notification.model");
const C = require("../models/commission.model");
const { createRefundService, detail, history } = require("../services/manualRefund.service");
const { createEmailWorker } = require("../services/manualRefundEmail.service");
const guards = require("../routes/manualRefund.routes");
const { requireExplicitPermission } = require("../middleware/staffPermission.middleware");
const { createVerifier } = require("../services/manualRefundProvider.service");
const { settleTelecomAbodeDataOutcome } = require("../services/telecomAbodeDataSettlement.service");
const actor = { _id: new mongoose.Types.ObjectId(), role: "HEAD_OFFICE", fullName: "Test Administrator" };
const body = { reason: "Provider confirmed non-delivery for this exact request.", confirmation: true,
  idempotencyKey: "test-refund-1234567890", providerRiskAcknowledged: true };
const verifyFailure = async t => ({ outcome: "FAILED", source: "TEST_READ_ONLY_QUERY",
  requestId: t.providerRequestId, httpStatus: 200 });
const service = createRefundService();
let mongo, count = 0;
before(async () => {
  for (const key of ["MONGODB_URI", "MONGO_URI", "MONGO_URL", "DATABASE_URL"]) {
    assert.equal(process.env[key], undefined, "Tests must never inherit a production database URI.");
  }
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  const uri = mongo.getUri();
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:/);
  await mongoose.connect(uri, { dbName: "manual-refund-disposable" });
  await Promise.all([T, U, L, A, N, C].map(m => m.init()));
});
after(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });
const fixture = async (changes = {}) => {
  const id = new mongoose.Types.ObjectId(), uid = new mongoose.Types.ObjectId();
  const debitId = new mongoose.Types.ObjectId(), reference = `TEST-REFUND-${++count}`;
  await U.collection.insertOne({ _id: uid, fullName: "Disposable Customer",
    phone: `080${String(count).padStart(8, "0")}`, email: `test-${count}@example.invalid`,
    walletBalance: 850, role: "CUSTOMER" });
  await T.collection.insertOne({ _id: id, reference, customerId: uid, serviceType: "DATA",
    provider: "TELECOM_ABODE", amount: 150, status: "PENDING", providerRequestId: reference,
    providerStatus: "UNKNOWN", dispatchStatus: "UNKNOWN", dispatchClaimedAt: new Date(),
    debitLedgerEntryId: debitId, createdAt: new Date(), providerResponse: { providerPrice: 120 }, ...changes });
  await L.create({ _id: debitId, user: uid, direction: "DEBIT", amount: 150,
    openingBalance: 1000, closingBalance: 850, reference, service: "DATA",
    idempotencyKey: reference, transactionId: id, status: "POSTED" });
  return { id, uid, debitId, reference };
};
const reject = async (f, code) =>
  assert.rejects(service.refund(f.id, body, actor), e => e.code === code);
test("acknowledged unknown purchase creates exactly one credit, refund transaction, audit and in-app notice atomically", async () => {
  const f = await fixture();
  const r = await service.refund(f.id, body, actor);
  assert.equal(r.walletBalance, 1000); assert.equal(r.refund.amount, 150);
  assert.equal((await U.findById(f.uid)).walletBalance, 1000);
  const original = await T.findById(f.id).lean();
  assert.equal(original.status, "REFUNDED");
  assert.equal(original.dispatchStatus, "REFUNDED");
  const credit = await L.findOne({ reversalOf: f.debitId });
  assert.equal(credit.amount, 150); assert.equal(credit.direction, "CREDIT");
  const refund = await T.findById(credit.transactionId).lean();
  assert.equal(refund.serviceType, "REFUND"); assert.equal(refund.status, "SUCCESSFUL");
  assert.equal(String(refund.reversedTransactionId), String(f.id));
  assert.equal(await A.countDocuments({ "metadata.originalTransactionId": f.id }), 1);
  assert.equal(await N.countDocuments({ userId: f.uid }), 1);
  assert.equal(refund.providerResponse.email.status, "PENDING");
  const audit = await A.findOne({ "metadata.originalTransactionId": f.id }).lean();
  assert.equal(audit.metadata.providerRiskAcknowledged, true);
  assert.equal(audit.metadata.mode, "HEAD_OFFICE_MANUAL_OVERRIDE");
  assert.equal(audit.metadata.evidence.outcome, "UNCONFIRMED");
  assert.equal((await history({})).items.some(x => x.reference === refund.reference), true);
});
test("lost HTTP response / exact request replay cannot credit twice", async () => {
  const f = await fixture();
  const first = await service.refund(f.id, body, actor);
  const retry = await service.refund(f.id, body, actor);
  assert.equal(retry.replayed, true); assert.equal(first.refund.reference, retry.refund.reference);
  assert.equal(await L.countDocuments({ reversalOf: f.debitId }), 1);
  assert.equal((await U.findById(f.uid)).walletBalance, 1000);
});
test("canonically failed purchase with unreversed original debit can be explicitly refunded once", async () => {
  const f = await fixture({ status: "FAILED", dispatchStatus: "FAILED", providerStatus: "FAILED" });
  const result = await service.refund(f.id, body, actor);
  assert.equal(result.walletBalance, 1000);
  assert.equal((await T.findById(f.id)).status, "REFUNDED");
  await service.refund(f.id, body, actor);
  assert.equal(await L.countDocuments({ reversalOf: f.debitId }), 1);
  assert.equal((await U.findById(f.uid)).walletBalance, 1000);
});
test("six simultaneous administrators with different keys can produce only one refund", async () => {
  const f = await fixture();
  const results = await Promise.allSettled(Array.from({ length: 6 }, (_, n) =>
    service.refund(f.id, { ...body, idempotencyKey: `concurrent-key-${n}-123456` },
      { ...actor, _id: new mongoose.Types.ObjectId() })));
  assert.equal(results.filter(x => x.status === "fulfilled").length, 1);
  assert.equal((await U.findById(f.uid)).walletBalance, 1000);
  assert.equal(await L.countDocuments({ reversalOf: f.debitId }), 1);
  assert.equal(await T.countDocuments({ reversedTransactionId: f.id }), 1);
});
test("concurrent identical request retries all converge on one persisted result", async () => {
  const f = await fixture();
  const results = await Promise.all(Array.from({ length: 5 }, () => service.refund(f.id, body, actor)));
  assert.equal(new Set(results.map(r => r.refund.reference)).size, 1);
  assert.equal((await U.findById(f.uid)).walletBalance, 1000);
});
test("refund without original debit is blocked", async () => {
  const f = await fixture();
  await L.collection.deleteOne({ _id: f.debitId });
  await reject(f, "REFUND_NOT_ELIGIBLE");
});
for (const status of ["SUCCESSFUL", "REFUNDED", "FAILED"]) {
  test(status + " transactions cannot be manually refunded", async () => {
    const f = await fixture({ status }); await reject(f, "REFUND_NOT_ELIGIBLE");
    assert.equal((await U.findById(f.uid)).walletBalance, 850);
  });
}
test("saved provider success blocks refund", async () => {
  for (const change of [{ providerStatus: "SUCCESSFUL" }, { providerStatus: "ORDER_COMPLETED" },
    { providerStatus: "SUCCEEDED" }, { dispatchStatus: "SUCCEEDED" }]) {
    const f = await fixture(change);
    await reject(f, "REFUND_NOT_ELIGIBLE");
    assert.equal((await U.findById(f.uid)).walletBalance, 850);
  }
});
test("unknown/unconfirmed provider outcomes need no provider request for detail or override", async () => {
  const transport = require("../services/manualRefundProvider.service");
  const spy = mock.method(transport, "verifyFailure", async () => { throw Error("Provider MUST NOT be called."); });
  try {
    for (const providerStatus of ["UNKNOWN", "UNCONFIRMED", "PENDING", "PROCESSING", "FAILED"]) {
      const f = await fixture({ providerStatus });
      const d = await detail(f.id);
      assert.equal(d.refund.eligible, true);
      assert.equal(d.refund.overrideAcknowledgementRequired, true);
      assert.match(d.refund.overrideWarning, /financial loss/);
      await service.refund(f.id, body, actor);
      assert.equal((await U.findById(f.uid)).walletBalance, 1000);
    }
    assert.equal(spy.mock.callCount(), 0);
  } finally { spy.mock.restore(); }
});
test("separate risk acknowledgement must be literal true and cannot be inferred from ordinary confirmation", async () => {
  for (const providerRiskAcknowledged of [undefined, false, "true", 1]) {
    const f = await fixture();
    await assert.rejects(service.refund(f.id, { ...body, providerRiskAcknowledged }, actor),
      e => e.code === "PROVIDER_RISK_ACKNOWLEDGEMENT_REQUIRED");
    assert.equal((await U.findById(f.uid)).walletBalance, 850);
    assert.equal(await L.countDocuments({ reversalOf: f.debitId }), 0);
  }
});
test("canonical Airtime supports both existing providers without provider confirmation", async () => {
  for (const provider of ["CLUBKONNECT", "TELECOM_ABODE"]) {
    const f = await fixture({ serviceType: "AIRTIME", provider });
    await L.collection.updateOne({ _id: f.debitId }, { $set: { service: "AIRTIME" } });
    await service.refund(f.id, body, actor);
    assert.equal((await U.findById(f.uid)).walletBalance, 1000);
  }
});
test("real Airtime admission timeout can be overridden once; recovery and retries never reopen it", async () => {
  const { createTelecomAbodeBillsProvider } = require("../services/telecomAbodeBillsProvider.service");
  const { createTelecomAbodeAirtimeLifecycle } = require("../services/telecomAbodeAirtimeLifecycle.service");
  const f = await fixture();
  await U.collection.updateOne({ _id: f.uid }, { $set: { status: "ACTIVE" } });
  let sends = 0;
  const bills = createTelecomAbodeBillsProvider({
    credentials: () => "disposable-test-credential",
    transport: async options => {
      if (options.method === "POST") { sends++; throw Error("Injected timeout"); }
      return { status: 200, data: [{ id: 7, network: "MTN" }] };
    },
  });
  const lifecycle = createTelecomAbodeAirtimeLifecycle({
    bills, readConfig: async () => ({ primaryProvider: "TELECOM_ABODE", airtimeMarkupBps: 0,
      providerStates: [{ provider: "TELECOM_ABODE", enabled: true }] }),
  });
  const input = { customerId: f.uid, network: 7, phone: "08012345678", amount: 50,
    customerSellingPrice: 50, idempotencyKey: `manual-override-airtime-${count}` };
  const purchase = await lifecycle.executePurchase(input);
  assert.equal((await U.findById(f.uid)).walletBalance, 800);
  assert.equal(purchase.transaction.status, "PENDING");
  const id = purchase.transaction._id;
  assert.equal((await detail(id)).refund.eligible, true);
  await service.refund(id, body, actor);
  await assert.rejects(lifecycle.reconcilePendingPurchase({ transactionId: id }),
    { code: "AIRTIME_TRANSACTION_NOT_PENDING" });
  await lifecycle.executePurchase(input);
  assert.equal(sends, 1);
  assert.equal((await T.findById(id)).status, "REFUNDED");
  assert.equal((await U.findById(f.uid)).walletBalance, 850);
  assert.equal(await T.countDocuments({ reversedTransactionId: id }), 1);
});
test("legacy prior refund metadata blocks credit even without a canonical reversal", async () => {
  const f = await fixture({ providerResponse: { legacy: { refundedAt: new Date(), refundAmount: 150 } } });
  await reject(f, "REFUND_NOT_ELIGIBLE");
});
test("existing reversal ledger / transaction blocks credit", async () => {
  const f = await fixture();
  await L.create({ user: f.uid, direction: "CREDIT", amount: 150, openingBalance: 850, closingBalance: 1000,
    service: "DATA_REVERSAL", reference: f.reference + "-OLD", idempotencyKey: f.reference + "-OLD", reversalOf: f.debitId });
  await reject(f, "REFUND_NOT_ELIGIBLE");
});
test("debit amount mismatch or unposted debit fails closed", async () => {
  for (const change of [{ amount: 160 }, { status: "REVERSED" }, { closingBalance: 800 }, { currency: "USD" }]) {
    const f = await fixture();
    await L.collection.updateOne({ _id: f.debitId }, { $set: change });
    await reject(f, "REFUND_NOT_ELIGIBLE");
  }
});
test("conflicting historical provider success evidence cannot be replaced by a refund", async () => {
  const f = await fixture({ providerResponse: { response: { status: "SUCCESS" } } });
  await reject(f, "REFUND_NOT_ELIGIBLE");
});
test("multiple debit candidates fail closed rather than guessing custody", async () => {
  const f = await fixture();
  await L.create({ user: f.uid, direction: "DEBIT", amount: 150, openingBalance: 850, closingBalance: 700,
    service: "DATA", reference: f.reference, idempotencyKey: f.reference + "-SECOND", transactionId: f.id });
  await reject(f, "REFUND_NOT_ELIGIBLE");
});
test("active dispatch and existing earnings block refund", async () => {
  for (const changes of [{ dispatchStatus: "SENDING" }, { dispatchStatus: "CLAIMED" }, { agentCommission: 10 }]) {
    const f = await fixture(changes); await reject(f, "REFUND_NOT_ELIGIBLE");
  }
});
test("unsupported service cannot bypass its settlement obligations", async () => {
  for (const serviceType of ["MARKETPLACE", "DELIVERY", "BANK_TRANSFER", "WALLET_FUNDING", "ELECTRICITY"]) {
    const f = await fixture({ serviceType });
    await L.collection.updateOne({ _id: f.debitId }, { $set: { service: serviceType } });
    await reject(f, "REFUND_NOT_ELIGIBLE");
    assert.equal((await U.findById(f.uid)).walletBalance, 850);
  }
});
test("provider state race to success defeats stale refund preflight", async () => {
  const f = await fixture();
  const start = mongoose.startSession.bind(mongoose);
  const spy = mock.method(mongoose, "startSession", async () => {
    await T.updateOne({ _id: f.id }, { $set: { status: "SUCCESSFUL" } });
    return start();
  });
  try { await assert.rejects(service.refund(f.id, body, actor), e => e.code === "TRANSACTION_STATE_CHANGED"); }
  finally { spy.mock.restore(); }
  assert.equal((await U.findById(f.uid)).walletBalance, 850);
});
test("late automatic provider success/failure cannot overwrite or credit an acknowledged refund", async () => {
  const f = await fixture();
  await service.refund(f.id, body, actor);
  for (const outcome of ["SUCCESS", "FAILED"]) {
    await settleTelecomAbodeDataOutcome({
      requestId: f.reference, outcome, source: "WEBHOOK",
      evidence: { requestId: f.reference, service: "data", documentedDataStatus: true,
        providerStatus: outcome, httpStatus: 200, amount: "120" },
    });
  }
  assert.equal((await T.findById(f.id)).status, "REFUNDED");
  assert.equal((await U.findById(f.uid)).walletBalance, 1000);
  assert.equal(await L.countDocuments({ reversalOf: f.debitId }), 1);
});
test("existing automatic DATA settlement races with manual refund without a second wallet credit", async () => {
  const f = await fixture();
  await Promise.allSettled([
    service.refund(f.id, body, actor),
    settleTelecomAbodeDataOutcome({
      requestId: f.reference, outcome: "FAILED", source: "STATUS_QUERY",
      evidence: { requestId: f.reference, service: "data", documentedDataStatus: true,
        providerStatus: "FAILED", httpStatus: 200, amount: "120" },
    }),
  ]);
  assert.equal((await U.findById(f.uid)).walletBalance, 1000);
  assert.equal(await L.countDocuments({ reversalOf: f.debitId }), 1);
  const original = await T.findById(f.id).lean();
  assert.ok(["FAILED", "REFUNDED"].includes(original.status));
});
test("notification database failure rolls back wallet, original, refund, ledger and audit together", async () => {
  const f = await fixture(), saved = mock.method(N, "create", async () => { throw new Error("Injected DB failure"); });
  try { await assert.rejects(service.refund(f.id, body, actor), /Injected DB failure/); }
  finally { saved.mock.restore(); }
  assert.equal((await U.findById(f.uid)).walletBalance, 850);
  assert.equal((await T.findById(f.id)).status, "PENDING");
  assert.equal(await L.countDocuments({ reversalOf: f.debitId }), 0);
  assert.equal(await T.countDocuments({ reversedTransactionId: f.id }), 0);
  assert.equal(await A.countDocuments({ "metadata.originalTransactionId": f.id }), 0);
});
test("network timeout after a committed refund is recovered with the original request identity", async () => {
  const f = await fixture();
  await service.refund(f.id, body, actor);
  await assert.rejects(service.refund(f.id, { ...body, reason: "A different operation cannot reuse the completed claim." }, actor),
    e => e.code === "ALREADY_REFUNDED");
  assert.equal((await U.findById(f.uid)).walletBalance, 1000);
});
test("administrator reason and explicit confirmation are mandatory", async () => {
  const f = await fixture();
  for (const change of [{ reason: "" }, { confirmation: false }, { idempotencyKey: "bad" }]) {
    await assert.rejects(service.refund(f.id, { ...body, ...change }, actor), e => e.code === "REFUND_CONFIRMATION_REQUIRED");
  }
});
for (const role of ["OPERATIONS_MANAGER", "CUSTOMER_SUPPORT", "BRANCH_MANAGER", "STAFF", "CUSTOMER", "SUPER_ADMIN"]) {
  test(role + " cannot access or execute manual refunds even with wildcard permissions", async () => {
    let status, passed = false;
    guards.headOffice({ user: { role }, staffAccess: { isHeadOffice: true, scope: { type: "GLOBAL" }, permissions: ["*"] } },
      { status(v) { status = v; return this; }, json() {} }, () => { passed = true; });
    assert.equal(status, 403); assert.equal(passed, false);
    const f = await fixture();
    await assert.rejects(service.refund(f.id, body, { ...actor, role }), e => e.code === "HEAD_OFFICE_REQUIRED");
  });
}
test("Head Office wildcard alone cannot satisfy the explicit refund-only permission", () => {
  let passed = false, status;
  requireExplicitPermission("transactions.refund")({ staffAccess: { isHeadOffice: true, permissions: ["*"] } },
    { status(v) { status = v; return this; }, json() {} }, () => { passed = true; });
  assert.equal(status, 403); assert.equal(passed, false);
  requireExplicitPermission("transactions.refund")({ staffRole: { permissions: ["transactions.refund"] } },
    {}, () => { passed = true; });
  assert.equal(passed, true);
});
test("detail reads never mutate historical records", async () => {
  const f = await fixture(), before = await T.findById(f.id).lean();
  const d = await detail(f.id, verifyFailure);
  assert.equal(d.refund.eligible, true);
  assert.deepEqual(await T.findById(f.id).lean(), before);
});
test("email can be disabled without suppressing persisted in-app notifications", async () => {
  const worker = createEmailWorker({ enabled: () => false, sendEmail: () => { throw new Error("must not send"); } });
  assert.equal((await worker.run()).status, "DISABLED");
  assert.ok(await N.countDocuments({ type: "WALLET" }) > 0);
});
test("email outbox sends using an idempotent reference and cannot send the same record concurrently", async () => {
  const f = await fixture(); await service.refund(f.id, body, actor);
  // Limit the worker test to this fixture; existing completed test refunds are
  // deliberately retained, not deleted through protected production models.
  await T.collection.updateMany({ serviceType: "REFUND", customerId: { $ne: f.uid } },
    { $set: { "providerResponse.email.status": "SENT" } });
  let sends = 0;
  const worker = createEmailWorker({ enabled: () => true, sendEmail: async args => {
    sends++; assert.match(args.idempotencyKey, /^manual-refund:/); return { success: true };
  } });
  await Promise.all([worker.run(), worker.run()]);
  assert.equal(sends, 1);
});
test("ClubKonnect verification uses persisted orderId and rejects uncorrelated evidence", async () => {
  let submitted;
  const verifier = createVerifier({ clubProvider: { query: async input => {
    submitted = input; return { requestId: "REQ", providerOrderId: "ORDER", authoritative: true, outcome: "FAILED", httpStatus: 200 };
  } } });
  const tx = { provider: "CLUBKONNECT", providerRequestId: "REQ", providerOrderId: "ORDER" };
  assert.equal((await verifier(tx)).outcome, "FAILED");
  assert.equal(submitted.orderId, "ORDER");
  assert.equal((await verifier({ ...tx, providerRequestId: "DIFFERENT" })).outcome, "UNKNOWN");
});
test("Telecom Abode generic failed is insufficient; exact established failure contract is required", async () => {
  let reply = { provider: "TELECOM_ABODE", service: "data", requestId: "REQ", providerReference: "REQ",
    status: "FAILED", rawProviderStatus: "FAILED", documentedDataStatus: true, amount: "120" };
  const verifier = createVerifier({ telecomProvider: { getTransactionByRequestId: async () => reply } });
  const tx = { provider: "TELECOM_ABODE", serviceType: "DATA", providerRequestId: "REQ", providerResponse: { providerPrice: 120 } };
  assert.equal((await verifier(tx)).outcome, "UNKNOWN");
  reply = { ...reply, confirmedFailureReason: "INVALID_NETWORK_RECIPIENT" };
  assert.equal((await verifier(tx)).outcome, "FAILED");
  // The documented boolean-false response has no rawProviderStatus string.
  reply = { ...reply, rawProviderStatus: undefined };
  assert.equal((await verifier(tx)).outcome, "FAILED");
  reply = { ...reply, amount: "121" };
  assert.equal((await verifier(tx)).outcome, "UNKNOWN");
});
