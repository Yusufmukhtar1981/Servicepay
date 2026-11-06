const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const Audit = require("../models/adminAuditLog.model");
const Ledger = require("../models/ledgerEntry.model");
const Role = require("../models/role.model");
const Commission = require("../models/commission.model");
const Case = require("../models/fintechCase.model");
const r = require("../services/operationsEnterprise.service");
const c = require("../controllers/operationsEnterprise.controller");
const workspace = require("../controllers/staffWorkspace.controller");
const refundService = require("../services/manualRefund.service").createRefundService();
const guards = require("../routes/manualRefund.routes");
const { validateStaffPermissions } = require("../config/permissionRegistry");
let mongo, head, customer, ops, seq = 0;
const headAccess = { isHeadOffice: true, roleName: "HEAD_OFFICE", scope: { type: "GLOBAL" }, permissions: ["*"] };
const opsAccess = { isHeadOffice: false, roleName: "OPERATIONS_MANAGER", scope: { type: "GLOBAL" },
  permissions: ["operations.workspace.view"] };
const request = extra => ({ user: head, staffAccess: headAccess, staffRole: { permissions: [] },
  params: {}, query: {}, body: {}, method: "GET", originalUrl: "/test/operations", ...extra });
const invoke = async (handler, extra) => {
  const result = { status: 200, headers: {} };
  await handler(request(extra), {
    status(v) { result.status = v; return this; }, set(k, v) { result.headers[k] = v; return this; },
    json(v) { result.body = v; return this; }, send(v) { result.bytes = v; return this; },
  });
  return result;
};
const middleware = async (handler, req) => {
  const result = { status: 200, next: false };
  await handler(req, { status(v) { result.status = v; return this; }, json(v) { result.body = v; } },
    () => { result.next = true; });
  return result;
};
before(async () => {
  for (const key of ["MONGODB_URI", "MONGO_URI", "MONGO_URL", "DATABASE_URL"]) assert.equal(process.env[key], undefined);
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  assert.match(mongo.getUri(), /^mongodb:\/\/127\.0\.0\.1:/);
  await mongoose.connect(mongo.getUri(), { dbName: "operations-enterprise-disposable" });
  await Promise.all([User, Transaction, Audit, Ledger, Role, Commission, Case].map(v => v.init()));
  const make = (role, fullName) => User.create({ role, fullName, status: "ACTIVE", password: "LocalFixture91!",
    phone: `080${String(++seq).padStart(8, "0")}`, email: `ops-${seq}@example.invalid` });
  head = await make("HEAD_OFFICE", "Disposable Head Office");
  customer = await make("CUSTOMER", "Disposable Customer");
  ops = await make("STAFF", "Disposable Operations");
  ops.isStaff = true; await ops.save();
  await Transaction.create([
    { customerId: customer._id, reference: "OPS-NEW-SUCCESS", serviceType: "DATA", amount: 100, status: "SUCCESSFUL", servicepayProfit: 9 },
    { customerId: customer._id, reference: "OPS-NEW-PENDING", serviceType: "AIRTIME", amount: 200, status: "PENDING" },
    { customerId: customer._id, reference: "OPS-NEW-FAILED", serviceType: "ELECTRICITY", amount: 300, status: "FAILED" },
    { customerId: customer._id, reference: "OPS-NEW-REFUNDED", serviceType: "DATA", amount: 400, status: "REFUNDED" },
  ]);
});
after(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });

test("period, counters and service taxonomy are explicit and exhaustive", () => {
  assert.throws(() => r.windowFor("all"), /Period/);
  assert.equal(r.windowFor("week").to - r.windowFor("week").from >= 7 * 86400000 - 10, true);
  assert.equal(r.counters({ total: 5, successful: 1, failed: 1, pending: 1, refunded: 1 }).other, 1);
  assert.equal(r.normalizeService("BANK_TRANSFER"), "TRANSFER");
  assert.equal(r.normalizeService("INTERSTATE_LOGISTICS"), "DELIVERY");
  assert.equal(r.SERVICES.length, 9);
});
test("new permissions are assignable explicit registry values, never wildcard defaults", () => {
  const values = ["operations.refund", "operations.customers.manage", "operations.services.control",
    "operations.reports.export", "operations.staff.view"];
  assert.deepEqual(validateStaffPermissions(values).permissions.sort(), values.sort());
  assert.equal(r.permissions(request()).refund, false);
  assert.equal(r.permissions(request({ user: ops, staffAccess: opsAccess })).refund, false);
  assert.equal(r.permissions(request({ user: ops, staffAccess: opsAccess,
    staffRole: { permissions: ["operations.refund"] } })).refund, true);
});
test("Support, scoped staff and unauthenticated callers cannot access enterprise control", async () => {
  for (const access of [
    { roleName: "CUSTOMER_SUPPORT", scope: { type: "GLOBAL" }, permissions: ["support.workspace.view", "operations.refund"] },
    { ...opsAccess, scope: { type: "BRANCH" } }, undefined,
  ]) assert.equal((await invoke(c.summary, { staffAccess: access })).status, 403);
});
test("enterprise summary is real, exhaustive and does not mutate financial records", async () => {
  const before = await User.findById(customer._id).select("+authTokenVersion").lean();
  const data = (await invoke(c.summary)).body.data;
  assert.equal(data.summary.total, 4);
  assert.equal(data.summary.successful, 1);
  assert.equal(data.summary.failed, 1);
  assert.equal(data.summary.pending, 1);
  assert.equal(data.summary.refunded, 1);
  assert.equal(data.summary.other, 0);
  assert.equal(data.summary.volume, 1000);
  assert.equal(data.customers.total, 1);
  assert.ok(data.services.some(v => v.service === "DATA" && v.total === 2));
  assert.equal(data.services.find(v => v.service === "MARKETPLACE").availability, "NO_ACTIVITY");
  assert.equal(data.services.find(v => v.service === "DATA").errorRate, null);
  assert.match(data.financial.notice, /Not gross custody/);
  assert.equal(data.summary.charges, null);
  assert.equal(data.summary.chargeSamples, 0);
  assert.deepEqual(await User.findById(customer._id).select("+authTokenVersion").lean(), before);
});
test("unsupported periods reject instead of silently broadening report scope", async () => {
  assert.equal((await invoke(c.summary, { query: { period: "all" } })).status, 400);
});
test("virtual account monitoring distinguishes active provisioning from payment revenue", async () => {
  await User.updateOne({ _id: customer._id }, { $set: {
    "virtualAccount.status": "ACTIVE", "virtualAccount.accountNumber": "1234567890",
  } });
  const response = await invoke(c.summary);
  const va = response.body.data.services.find(v => v.service === "VIRTUAL_ACCOUNT");
  assert.equal(va.successful, 1);
  assert.equal(va.total, 1);
  assert.equal(va.volume, null);
  assert.equal(va.recordedEarnings, null);
  assert.ok(!response.body.data.alerts.some(v => v.code === "VIRTUAL_ACCOUNT_ISSUES"));
});
test("transaction date and amount filters are applied together with exact identity", async () => {
  const result = await invoke(workspace.transactions, { query: { minAmount: "150", maxAmount: "250",
    from: new Date().toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) } });
  assert.equal(result.body.data.total, 1);
  assert.equal(result.body.data.items[0].reference, "OPS-NEW-PENDING");
  const t = await Transaction.findOne({ reference: "OPS-NEW-PENDING" }).lean();
  assert.equal((await invoke(workspace.transactions, { query: { q: String(t._id) } })).body.data.total, 1);
});
test("invalid calendar, reversed dates and unsafe numeric filters reject", async () => {
  for (const query of [{ from: "2026-02-30" }, { from: "2026-10-02", to: "2026-10-01" },
    { minAmount: "NaN" }, { minAmount: "300", maxAmount: "200" }, { maxAmount: "-1" }])
    assert.equal((await invoke(workspace.transactions, { query })).status, 400);
});
test("transaction details contain safe diagnostics, not provider payload or full contact", async () => {
  const t = await Transaction.findOne({ reference: "OPS-NEW-PENDING" });
  await Transaction.updateOne({ _id: t._id }, { $set: { providerResponse: { code: "IP_NOT_WHITELISTED", privateKey: "DO-NOT-LEAK" } } });
  const result = await invoke(c.detail, { params: { id: String(t._id) } });
  assert.equal(result.status, 200);
  assert.equal(result.body.data.providerDiagnostics.code, "IP_NOT_WHITELISTED");
  assert.equal(result.body.data.canRefund, false);
  assert.equal(result.body.data.processingDurationMs, null);
  assert.doesNotMatch(JSON.stringify(result.body), /DO-NOT-LEAK|privateKey/);
  assert.notEqual(result.body.data.customer.phone, customer.phone);
});
test("customer status writes require permission and never move customer money", async () => {
  const before = await User.findById(customer._id).select("+authTokenVersion").lean();
  assert.equal((await invoke(c.customerStatus, { user: ops, staffAccess: opsAccess,
    params: { id: String(customer._id) }, body: { status: "SUSPENDED", reason: "Approved operational investigation." } })).status, 403);
  const access = { ...opsAccess, permissions: [...opsAccess.permissions, "operations.customers.manage"] };
  const hold = await invoke(c.customerStatus, { user: ops, staffAccess: access, params: { id: String(customer._id) },
    body: { status: "SUSPENDED", reason: "Approved operational investigation." } });
  assert.equal(hold.status, 200, JSON.stringify(hold.body));
  const suspended = await User.findById(customer._id).select("+authTokenVersion").lean();
  assert.equal(suspended.status, "SUSPENDED");
  assert.equal(suspended.authTokenVersion, before.authTokenVersion + 1);
  assert.equal(suspended.walletBalance, before.walletBalance);
  assert.equal((await invoke(c.customerStatus, { user: ops, staffAccess: access,
    params: { id: String(customer._id) }, body: { status: "ACTIVE", reason: "Investigation completed safely." } })).status, 200);
});
test("an unrelated suspension cannot be reactivated by the Operations workflow", async () => {
  await User.updateOne({ _id: customer._id }, { $set: { status: "SUSPENDED" }, $inc: { authTokenVersion: 1 } });
  const result = await invoke(c.customerStatus, { params: { id: String(customer._id) },
    body: { status: "ACTIVE", reason: "May not override a separate security hold." } });
  assert.equal(result.status, 409);
  await User.updateOne({ _id: customer._id }, { $set: { status: "ACTIVE" } });
});
test("service controls reject protected services and permissionless writes", async () => {
  const body = { enabled: false, reason: "Investigating an operational issue." };
  assert.equal((await invoke(c.serviceStatus, { user: ops, staffAccess: opsAccess, params: { key: "data" }, body })).status, 403);
  for (const key of ["wallet", "walletFunding", "bankTransfer", "edupay", "notRegistered"])
    assert.equal((await invoke(c.serviceStatus, { params: { key }, body })).status, 403);
});
test("exports enforce permissions and emit actual CSV, XLSX and PDF binaries with audit evidence", async () => {
  assert.equal((await invoke(c.exportReport, { user: ops, staffAccess: opsAccess })).status, 403);
  for (const format of ["csv", "xlsx", "pdf"]) {
    const result = await invoke(c.exportReport, { query: { format, period: "day" } });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.ok(result.bytes.length > 100);
    if (format === "xlsx") assert.equal(result.bytes.subarray(0, 2).toString(), "PK");
    if (format === "pdf") assert.equal(result.bytes.subarray(0, 5).toString(), "%PDF-");
    if (format === "csv") assert.match(result.bytes.toString(), /DATA/);
    assert.match(result.headers["Content-Disposition"], new RegExp(format));
  }
  assert.equal(await Audit.countDocuments({ action: "FINANCIAL_REPORT_EXPORTED" }), 3);
  assert.equal((await invoke(c.exportReport, { query: { format: "html" } })).status, 400);
  assert.equal(c._test.neutral("=SUM(A1)"), "'=SUM(A1)");
});
test("complaint timing uses immutable event evidence and current staff assignment", async () => {
  const now = Date.now();
  await Case.create({ caseReference: "OPS-TIMING-TEST", idempotencyKey: "ops-timing-disposable", type: "COMPLAINT", createdBy: head._id, customer: customer._id,
    assignedTo: ops._id, subject: "Disposable metric", description: "Fixture only", status: "RESOLVED",
    createdAt: new Date(now - 600000), publicReplies: [{ authorId: ops._id, authorRole: "STAFF", message: "Investigating", createdAt: new Date(now - 540000) }],
    statusEvents: [{ actorId: ops._id, actorRole: "STAFF", status: "RESOLVED", createdAt: new Date(now - 300000) }] });
  const data = (await invoke(c.summary)).body.data;
  assert.equal(data.support.averageResponseMs, 60000);
  assert.equal(data.support.averageResolutionMs, 300000);
  const staff = data.staff.find(v => v.id === String(ops._id));
  assert.equal(staff.resolved, 1);
  assert.equal(staff.resolutionRate, 1);
});
test("refund gates deny Support even when financial permissions are incorrectly assigned", async () => {
  const support = request({ user: { ...ops.toObject(), role: "STAFF", isStaff: true },
    staffAccess: { ...opsAccess, roleName: "CUSTOMER_SUPPORT", permissions: ["operations.workspace.view", "operations.refund"] },
    staffRole: { permissions: ["operations.refund"] } });
  assert.equal((await middleware(guards.refundRead, support)).status, 403);
  assert.equal((await middleware(guards.refundWrite, support)).status, 403);
});
test("Operations refund requires explicit permission, never wildcard or workspace access", async () => {
  const req = request({ user: ops, staffAccess: opsAccess });
  assert.equal((await middleware(guards.refundRead, req)).next, true);
  assert.equal((await middleware(guards.refundWrite, req)).status, 403);
  req.staffRole.permissions = ["*"];
  assert.equal((await middleware(guards.refundWrite, req)).status, 403);
  req.staffRole.permissions = ["operations.refund"];
  assert.equal((await middleware(guards.refundWrite, req)).next, true);
});
test("service authorization cannot be supplied by the request body or an unrelated staff role", async () => {
  await assert.rejects(refundService.refund(new mongoose.Types.ObjectId(), { roleName: "OPERATIONS_MANAGER" }, ops),
    e => e.statusCode === 403);
  await assert.rejects(refundService.refund(new mongoose.Types.ObjectId(), {}, ops,
    { roleName: "CUSTOMER_SUPPORT", scope: { type: "GLOBAL" }, explicitPermissions: ["operations.refund"] }), e => e.statusCode === 403);
});
test("authorized Operations refund is atomic and exactly once with immutable ledger linkage", async () => {
  const txId = new mongoose.Types.ObjectId(), uid = new mongoose.Types.ObjectId(), debitId = new mongoose.Types.ObjectId();
  const ref = "OPS-REFUND-DISPOSABLE";
  await User.collection.insertOne({ _id: uid, fullName: "Disposable refund owner", phone: "08000000999",
    email: "ops-refund@example.invalid", role: "CUSTOMER", status: "ACTIVE", walletBalance: 800 });
  await Transaction.collection.insertOne({ _id: txId, customerId: uid, reference: ref, serviceType: "DATA",
    provider: "TELECOM_ABODE", amount: 200, status: "PENDING", dispatchStatus: "UNKNOWN",
    providerRequestId: ref, providerStatus: "UNKNOWN", dispatchClaimedAt: new Date(),
    debitLedgerEntryId: debitId, createdAt: new Date(), updatedAt: new Date() });
  await Ledger.create({ _id: debitId, user: uid, direction: "DEBIT", amount: 200, openingBalance: 1000,
    closingBalance: 800, currency: "NGN", status: "POSTED", service: "DATA", reference: ref, idempotencyKey: "ops-refund-original-debit", transactionId: txId });
  const body = { reason: "Explicitly authorized disposable test refund.", confirmation: true,
    providerRiskAcknowledged: true, idempotencyKey: "operations-refund-disposable-key" };
  const auth = { roleName: "OPERATIONS_MANAGER", scope: { type: "GLOBAL" }, explicitPermissions: ["operations.refund"] };
  const results = await Promise.allSettled([refundService.refund(String(txId), body, ops, auth),
    refundService.refund(String(txId), body, ops, auth)]);
  assert.ok(results.some(v => v.status === "fulfilled"), JSON.stringify(results));
  assert.equal((await User.findById(uid).lean()).walletBalance, 1000);
  assert.equal(await Ledger.countDocuments({ reversalOf: debitId }), 1);
  assert.equal((await Transaction.findById(txId).lean()).status, "REFUNDED");
  assert.equal(await Audit.countDocuments({ action: "TRANSACTION_MANUAL_REFUNDED", actorId: ops._id, actorRole: "OPERATIONS_MANAGER" }), 1);
  await refundService.refund(String(txId), body, ops, auth);
  assert.equal((await User.findById(uid).lean()).walletBalance, 1000);
});
