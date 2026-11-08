const { test, before, after, mock } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const T = require("../models/transaction.model"), U = require("../models/user.model");
const L = require("../models/ledgerEntry.model"), A = require("../models/adminAuditLog.model");
const N = require("../models/notification.model"), C = require("../models/commission.model");
const Role = require("../models/role.model");
const s = require("../services/pendingResolution.service");
const monitor = require("../services/pendingResolutionMonitor.service");
const refunds = require("../services/manualRefund.service").createRefundService();
let mongo, n = 0, server;
const actor = { _id: new mongoose.Types.ObjectId(), role: "HEAD_OFFICE", fullName: "Test Administrator" };
const req = { user: actor, staffAccess: { isHeadOffice: true, scope: { type: "GLOBAL" } },
  staffRole: { permissions: ["transactions.refund", "transaction_intelligence.reconcile", "transactions.requery"] } };
const successBody = { reason: "Delivery verified against independently checked service receipt.", evidenceReference: "controlled-test-delivery-record",
  confirmation: true, deliveryConfirmed: true, idempotencyKey: "pending-success-request-123456" };
const refundBody = { reason: "Single authorized manual refund after investigation.", confirmation: true,
  providerRiskAcknowledged: true, idempotencyKey: "pending-refund-request-123456" };
async function fixture(changes = {}) {
  const id = new mongoose.Types.ObjectId(), uid = new mongoose.Types.ObjectId(), debitId = new mongoose.Types.ObjectId();
  const reference = `TEST-PENDING-${++n}`;
  await U.collection.insertOne({ _id: uid, fullName: `Pending Customer ${n}`, phone: `080${String(n).padStart(8, "0")}`,
    email: `pending-${n}@example.invalid`, walletBalance: 850, role: "CUSTOMER", status: "ACTIVE" });
  await T.collection.insertOne({ _id: id, reference, customerId: uid, serviceType: "DATA",
    provider: "TELECOM_ABODE", amount: 150, status: "PENDING", providerRequestId: reference,
    providerStatus: "UNKNOWN", dispatchStatus: "UNKNOWN", dispatchClaimedAt: new Date(),
    debitLedgerEntryId: debitId, createdAt: new Date(), providerResponse: { providerPrice: 120 }, ...changes });
  await L.create({ _id: debitId, user: uid, direction: "DEBIT", amount: 150, openingBalance: 1000,
    closingBalance: 850, reference, service: changes.serviceType || "DATA", idempotencyKey: reference,
    transactionId: id, status: "POSTED" });
  return { id, uid, debitId, reference };
}
before(async () => {
  for (const k of ["MONGODB_URI", "MONGO_URI", "DATABASE_URL"]) assert.equal(process.env[k], undefined);
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  const uri = mongo.getUri(); assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:/);
  await mongoose.connect(uri, { dbName: "pending-resolution-disposable" });
  await Promise.all([T, U, L, A, N, C, Role,
    require("../models/referralRewardReconciliation.model")].map(m => m.init()));
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await mongoose.disconnect(); await mongo?.stop();
});
test("pending age categories have exact five/thirty/sixty-minute boundaries", () => {
  const now = Date.now();
  for (const [seconds, expected] of [[0, "RECENT"], [299, "RECENT"], [300, "DELAYED"], [1799, "DELAYED"],
    [1800, "LONG_STANDING"], [3599, "LONG_STANDING"], [3600, "ATTENTION"]]) {
    assert.equal(s.category({ createdAt: new Date(now - seconds * 1000) }, now).category, expected);
  }
  assert.equal(s.category({ createdAt: "not-a-date" }).pendingSeconds, null);
});
test("summary uses real pending totals, overlapping age thresholds and immutable manual totals", async () => {
  const now = new Date();
  for (const seconds of [60, 300, 1800, 3600]) await fixture({ createdAt: new Date(+now - seconds * 1000) });
  const result = await s.summary(now);
  assert.equal(result.totalPending, 4); assert.equal(result.pendingAmount, 600);
  assert.equal(result.below5Minutes, 1); assert.equal(result.above5Minutes, 3);
  assert.equal(result.above30Minutes, 2); assert.equal(result.above1Hour, 1);
  assert.equal(result.refundedAmount, 0);
});
test("search/customer contacts/IDs/type/dates/amount/duration and pagination use authoritative records", async () => {
  const f = await fixture({ createdAt: new Date(Date.now() - 7200000) });
  const customer = await U.findById(f.uid).lean();
  for (const search of [customer.fullName, customer.phone, customer.email, f.reference, String(f.id)]) {
    const result = await s.list({ search, type: "DATA", minAmount: 150, maxAmount: 150, duration: "ATTENTION" });
    assert.equal(result.total, 1); assert.equal(result.items[0].customer.email, customer.email);
    assert.equal(result.items[0].id, String(f.id));
    assert.ok(!JSON.stringify(result).includes("providerResponse"));
  }
  assert.equal((await s.list({ limit: 1, page: 2 })).items.length, 1);
  assert.equal((await s.list({ search: ".*" })).total, 0, "search regex must be literal");
});
for (const q of [{ page: -1 }, { limit: 51 }, { from: "2026-02-30" }, { from: "2026-11-08", to: "2026-11-01" },
  { minAmount: 200, maxAmount: 100 }, { duration: "random" }, { type: "bad$regex" }, { status: "unknown" }]) {
  test("invalid list inputs fail explicitly " + JSON.stringify(q), async () => {
    await assert.rejects(s.list(q), e => e.statusCode === 400);
  });
}
test("Head Office wildcard is not explicit financial write authority; other roles cannot write", () => {
  assert.deepEqual(s.permissions({ ...req, staffRole: { permissions: ["*"] } }),
    { view: true, refund: false, success: false, retry: false });
  for (const role of ["CUSTOMER", "CUSTOMER_SUPPORT", "STATE_MANAGER", "ZONAL_MANAGER"]) {
    assert.equal(s.permissions({ ...req, user: { ...actor, role } }).view, false);
  }
  const ops = { user: { ...actor, role: "STAFF", isStaff: true }, staffAccess: { roleName: "OPERATIONS_MANAGER",
    scope: { type: "GLOBAL" }, permissions: ["operations.workspace.view"] }, staffRole: { permissions: ["operations.refund"] } };
  assert.deepEqual(s.permissions(ops), { view: true, refund: true, success: false, retry: false });
});
test("manual delivered resolution is atomic, audited, not provider-confirmed, and never changes the wallet", async () => {
  const f = await fixture();
  const first = await s.markSuccessful(f.id, successBody, req);
  assert.equal(first.data.status, "SUCCESSFUL");
  const t = await T.findById(f.id).lean();
  assert.equal(t.providerStatus, "UNKNOWN", "manual attestation must not forge provider evidence");
  assert.equal(t.dispatchStatus, "SUCCEEDED");
  assert.equal((await U.findById(f.uid)).walletBalance, 850);
  assert.equal(await L.countDocuments({ user: f.uid }), 1);
  assert.equal((await s.markSuccessful(f.id, successBody, req)).data.replayed, true);
  assert.equal(await A.countDocuments({ action: "TRANSACTION_MANUAL_SUCCEEDED", "metadata.originalTransactionId": f.id }), 1);
  const d = await s.detail(f.id, req);
  assert.equal(d.history[0].evidenceReference, successBody.evidenceReference);
  assert.equal(d.history[0].previousStatus, "PENDING"); assert.equal(d.history[0].newStatus, "SUCCESSFUL");
  assert.equal(d.refund.eligible, false);
  await assert.rejects(refunds.refund(f.id, refundBody, actor), e => e.statusCode === 422);
});
test("manual successful resolution requires delivery evidence, confirmation and exact permission", async () => {
  const f = await fixture();
  for (const change of [{ confirmation: false }, { deliveryConfirmed: false }, { evidenceReference: "" },
    { idempotencyKey: "short" }, { reason: "short" }]) {
    await assert.rejects(s.markSuccessful(f.id, { ...successBody, ...change }, req), e => e.statusCode === 400);
  }
  await assert.rejects(s.markSuccessful(f.id, successBody, { ...req, staffRole: { permissions: [] } }), e => e.statusCode === 403);
});
test("six competing success commands settle once, different bodies cannot replay another action", async () => {
  const f = await fixture();
  const result = await Promise.allSettled(Array.from({ length: 6 }, (_, i) =>
    s.markSuccessful(f.id, { ...successBody, idempotencyKey: "competing-manual-success-" + i }, req)));
  assert.equal(result.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(await L.countDocuments({ user: f.uid }), 1);
  assert.equal((await U.findById(f.uid)).walletBalance, 850);
});
test("a simultaneous manual refund and delivered resolution have exactly one terminal winner", async () => {
  const f = await fixture();
  const results = await Promise.allSettled([s.markSuccessful(f.id, successBody, req), refunds.refund(f.id, refundBody, actor)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  const t = await T.findById(f.id).lean();
  assert.ok(["SUCCESSFUL", "REFUNDED"].includes(t.status));
  assert.equal((await U.findById(f.uid)).walletBalance, t.status === "REFUNDED" ? 1000 : 850);
  assert.equal(await L.countDocuments({ user: f.uid, direction: "CREDIT" }), t.status === "REFUNDED" ? 1 : 0);
});
test("failed audit insertion rolls back successful state and notification together", async () => {
  const f = await fixture();
  const spy = mock.method(A, "create", async () => { throw Error("controlled audit failure"); });
  try { await assert.rejects(s.markSuccessful(f.id, successBody, req)); } finally { spy.mock.restore(); }
  assert.equal((await T.findById(f.id)).status, "PENDING");
  assert.equal(await N.countDocuments({ userId: f.uid }), 0);
});
for (const changes of [{ reversalLedgerEntryId: new mongoose.Types.ObjectId() },
  { providerResponse: { refundStatus: "REFUNDED" } }, { dispatchStatus: "SENDING" },
  { serviceType: "ELECTRICITY" }, { providerResponse: { adminRecheck: { leaseUntil: new Date(Date.now() + 60000) } } }]) {
  test("unsafe custody/dispatch/unsupported lifecycle blocks manual success " + JSON.stringify(changes), async () => {
    const f = await fixture(changes);
    await assert.rejects(s.markSuccessful(f.id, successBody, req), e => e.statusCode === 422);
    assert.equal((await U.findById(f.uid)).walletBalance, 850);
  });
}
test("safe status recheck is invoked once, replayed durably, audited and never dispatched as a purchase", async () => {
  const f = await fixture(); let count = 0;
  const recheck = s.createRechecker({ verify: async () => { count++; } });
  const body = { reason: "Check existing request status only.", idempotencyKey: "safe-read-only-recheck-123" };
  const a = await recheck(f.id, body, req);
  assert.equal(a.data.state, "COMPLETED");
  assert.equal((await recheck(f.id, body, req)).data.replayed, true);
  assert.equal(count, 1); assert.equal((await T.findById(f.id)).status, "PENDING");
  assert.equal((await U.findById(f.uid)).walletBalance, 850);
  await assert.rejects(recheck(f.id, { ...body, reason: "Changed intent must not replay." }, req), e => e.statusCode === 409);
  const d = await s.detail(f.id, req);
  assert.equal(d.history.filter(a => a.action.startsWith("TRANSACTION_RESOLUTION_RECHECK")).length, 2);
});
test("concurrent recheck keys allow only one provider read and block refund during that read", async () => {
  const f = await fixture(); let release, started, calls = 0;
  const entered = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const recheck = s.createRechecker({ verify: async () => { calls++; started(); await gate; } });
  const body = { reason: "Concurrent provider status-only investigation.", idempotencyKey: "one-safe-recheck-request" };
  const first = recheck(f.id, body, req); await entered;
  try {
    const replay = await recheck(f.id, body, req); assert.equal(replay.data.state, "PROCESSING");
    await assert.rejects(recheck(f.id, { ...body, idempotencyKey: "second-safe-recheck-request" }, req), e => e.code === "RECHECK_IN_FLIGHT");
    await assert.rejects(refunds.refund(f.id, refundBody, actor), e => e.statusCode === 422);
  } finally { release(); await first; }
  assert.equal(calls, 1);
});
test("historical incident purchases are never automatically rechecked, refunded or rewritten", async () => {
  const f = await fixture({ createdAt: new Date("2026-10-20T00:00:00Z") });
  const snapshot = JSON.stringify(await T.collection.findOne({ _id: f.id }));
  let calls = 0;
  await assert.rejects(s.createRechecker({ verify: async () => { calls++; } })(f.id,
    { reason: "No automatic incident replay permitted.", idempotencyKey: "historical-no-provider-query" }, req), e => e.code === "RETRY_UNSUPPORTED");
  await monitor.check();
  assert.equal(calls, 0);
  assert.equal(JSON.stringify(await T.collection.findOne({ _id: f.id })), snapshot);
  assert.equal(monitor.status().healthy, true);
});
test("real HTTP authentication and assigned-role permissions protect every read/write entry", async () => {
  const express = require("express"), jwt = require("jsonwebtoken");
  const app = express(); app.use(express.json());
  app.use("/api/admin/pending-resolution", require("../routes/pendingResolution.routes"));
  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/admin/pending-resolution`;
  const [hoRole, opsRole] = await Role.create([
    { name: "PENDING_RESOLUTION_TEST", displayName: "Disposable finance role", department: "FINANCE",
      scopeType: "GLOBAL", permissions: req.staffRole.permissions },
    { name: "OPERATIONS_MANAGER", displayName: "Disposable operations role", department: "OPERATIONS",
      scopeType: "GLOBAL", permissions: ["operations.workspace.view"] },
  ]);
  const people = {};
  for (const [name, fields] of Object.entries({
    head: { role: "HEAD_OFFICE", staffRoleId: hoRole._id },
    viewer: { role: "HEAD_OFFICE" },
    customer: { role: "CUSTOMER" },
    operations: { role: "STAFF", isStaff: true, staffRoleId: opsRole._id },
    support: { role: "STAFF", isStaff: true },
  })) {
    const uid = new mongoose.Types.ObjectId();
    await U.collection.insertOne({ _id: uid, fullName: "Disposable " + name,
      email: `${name}-http@example.invalid`, phone: `081${String(++n).padStart(8, "0")}`,
      status: "ACTIVE", tokenVersion: 0, walletBalance: 0, ...fields });
    people[name] = jwt.sign({ id: String(uid), tokenVersion: 0 }, process.env.JWT_SECRET, { expiresIn: "5m" });
  }
  const call = async (route, person, body) => {
    const response = await fetch(base + route, { method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", ...(person ? { Authorization: "Bearer " + people[person] } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await call("/summary")).status, 401);
  for (const person of ["customer", "support"]) assert.equal((await call("/summary", person)).status, 403);
  for (const person of ["head", "viewer", "operations"]) assert.equal((await call("/summary", person)).status, 200);
  const f = await fixture();
  for (const person of ["viewer", "operations", "customer", "support"]) {
    assert.equal((await call(`/transactions/${f.id}/resolve`, person, { ...successBody, action: "MARK_SUCCESSFUL" })).status, 403);
  }
  const detail = await call(`/transactions/${f.id}`, "head");
  assert.equal(detail.status, 200); assert.equal(detail.body.data.permissions.success, true);
  const resolved = await call(`/transactions/${f.id}/resolve`, "head", { ...successBody, action: "MARK_SUCCESSFUL" });
  assert.equal(resolved.status, 200);
  assert.equal((await U.findById(f.uid)).walletBalance, 850);
  assert.equal((await call(`/transactions/${f.id}/resolve`, "head", { ...refundBody, action: "REFUND" })).status, 422);
  const r = await fixture();
  assert.equal((await call(`/transactions/${r.id}/resolve`, "operations", { ...refundBody, action: "REFUND" })).status, 403);
  const refund = await call(`/transactions/${r.id}/resolve`, "head", { ...refundBody, action: "REFUND" });
  assert.equal(refund.status, 200); assert.equal((await U.findById(r.uid)).walletBalance, 1000);
  assert.equal((await call(`/transactions/${r.id}/resolve`, "head", { ...refundBody, action: "REFUND" })).status, 200);
  assert.equal(await L.countDocuments({ reversalOf: r.debitId }), 1);
});
