const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const User = require("../models/user.model");
const Audit = require("../models/adminAuditLog.model");
const provider = require("../services/securewave.service");
let dispatch, calls, mongo, customer, admin;
provider.generateVirtualAccount = async body => { calls++; return dispatch(body); };
const controller = require("../controllers/adminVirtualAccount.controller");
const customerController = require("../controllers/securewave.controller");
const bank = { accountNumber: "0123456789", accountName: "Sandbox Customer",
  bankName: "Sandbox Bank", bankCode: "001", provider: "SECUREWAVENG", status: "ACTIVE" };
const success = () => ({ success: true, data: {
  account_number: bank.accountNumber, account_name: bank.accountName,
  bank_name: bank.bankName, bank_code: bank.bankCode,
} });
const body = () => ({ requestId: randomUUID(), reason: "Authorized sandbox account test" });
async function invoke(method = "generate", input = body(), actor = admin, id = customer._id, query = {}) {
  const res = { code: 200, body: null, status(code) { this.code = code; return this; },
    json(data) { this.body = data; return this; } };
  await controller[method]({ user: actor, params: { id: String(id) }, body: input, query }, res);
  return res;
}
const stored = () => User.findById(customer._id);
const saveAccount = virtualAccount => User.updateOne({ _id: customer._id }, { $set: { virtualAccount } });
test.before(async () => {
  if (["MONGODB_URI", "MONGO_URI", "MONGO_URL", "DATABASE_URL"].some(k => process.env[k])) {
    throw new Error("Refusing ambient database credentials.");
  }
  process.env.JWT_SECRET = "sandbox-admin-virtual-account";
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 },
    instanceOpts: [{ args: ["--nounixsocket"] }] });
  await mongoose.connect(mongo.getUri());
  await User.init();
});
test.after(async () => { await mongoose.disconnect(); await mongo?.stop(); });
test.beforeEach(async () => {
  await User.deleteMany({});
  // Audit is append-only. Each test uses a different target instead of deleting history.
  calls = 0; dispatch = async () => success();
  customer = await User.create({ fullName: "Sandbox Customer", phone: "08060009999",
    email: "va-admin@example.invalid", password: "SandboxOnly123!", role: "CUSTOMER",
    status: "ACTIVE", walletBalance: 6543.21, totalTransactions: 8, totalEarnings: 17,
    kycVerified: false });
  admin = await User.create({ fullName: "Sandbox Head Office", phone: "08060009998",
    email: "va-admin-actor@example.invalid", password: "SandboxOnly123!", role: "HEAD_OFFICE", status: "ACTIVE" });
});
test.afterEach(async () => {
  const user = await stored();
  assert.equal(user.walletBalance, 6543.21);
  assert.equal(user.totalTransactions, 8);
  assert.equal(user.totalEarnings, 17);
  assert.equal(user.kycVerified, false);
  assert.equal(user.phone, "08060009999");
  assert.equal(user.email, "va-admin@example.invalid");
});
test("eligible customer uses existing provider and synchronizes the customer endpoint", async () => {
  const before = await stored();
  const result = await invoke();
  assert.equal(result.code, 201); assert.equal(calls, 1);
  assert.equal(result.body.data.virtualAccount.accountNumber, bank.accountNumber);
  const after = await stored();
  const protectedView = u => {
    const value = u.toObject(); delete value.virtualAccount; delete value.updatedAt; return value;
  };
  assert.deepEqual(protectedView(after), protectedView(before));
  const res = { status() { return this; }, json(body) { this.body = body; return this; } };
  await customerController.getMyVirtualAccount({ user: { _id: customer._id } }, res);
  assert.equal(res.body.data.virtualAccount.accountNumber, bank.accountNumber);
  assert.equal(result.body.data.history.length, 2);
  assert.ok(result.body.data.history.some(row => row.outcome === "ACCOUNT_AVAILABLE"));
});
test("any assigned account number is returned unchanged, including disabled legacy accounts", async () => {
  for (const status of ["ACTIVE", "DISABLED", "FAILED"]) {
    await saveAccount({ ...bank, status });
    const before = (await stored()).virtualAccount.toObject();
    const res = await invoke();
    assert.equal(res.code, 200); assert.equal(calls, 0);
    assert.deepEqual((await stored()).virtualAccount.toObject(), before);
    assert.equal(res.body.data.eligibility.canGenerate, false);
  }
});
test("legacy FAILED without evidence requires reconciliation and never dispatches", async () => {
  await saveAccount({ status: "FAILED", failureReason: "upstream timeout fake-private-key" });
  const res = await invoke();
  assert.equal(res.code, 409); assert.equal(calls, 0);
  assert.equal(res.body.data.eligibility.requiresReconciliation, true);
  assert.ok(!JSON.stringify(res.body).includes("fake-private"));
});
test("only proven pre-dispatch or access-rejected failures permit controlled retry", async () => {
  for (const failureReason of ["PROVIDER_ACCESS_REJECTED", "CONFIGURATION_UNAVAILABLE"]) {
    await saveAccount({ status: "FAILED", failureReason });
    assert.equal((await invoke("get")).body.data.eligibility.canRetry, true);
    assert.equal((await invoke()).code, 201);
  }
  assert.equal(calls, 2);
});
test("unknown states, hidden prior attempts and orphaned provider references require reconciliation", async () => {
  for (const virtualAccount of [
    { status: "UNKNOWN" },
    { status: "NOT_CREATED", creationAttemptId: "historical-unresolved-attempt" },
    { status: "NOT_CREATED", customerReference: "historical-provider-reference" },
    { status: "NOT_CREATED", isDeleted: true },
  ]) {
    await User.collection.updateOne({ _id: customer._id }, { $set: { virtualAccount } });
    const result = await invoke();
    assert.equal(result.code, 409);
    assert.equal(result.body.data.eligibility.requiresReconciliation, true);
    assert.ok(!JSON.stringify(result.body).includes("historical-unresolved-attempt"));
  }
  assert.equal(calls, 0);
});
test("timeout remains uncertain and both same-ID replay and new-ID retry never redispatch", async () => {
  dispatch = async () => { throw new Error("timeout fake-secret"); };
  const request = body();
  const result = await invoke("generate", request);
  assert.equal(result.code, 503); assert.equal(calls, 1);
  assert.equal((await stored()).virtualAccount.status, "PENDING");
  assert.equal(result.body.data.eligibility.requiresReconciliation, true);
  assert.ok(!JSON.stringify(result.body).includes("fake-secret"));
  assert.equal((await invoke("generate", request)).code, 200);
  assert.equal((await invoke()).code, 409); assert.equal(calls, 1);
});
test("repeated and concurrent clicks, including different request IDs, dispatch once", async () => {
  let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const wait = new Promise(resolve => { release = resolve; });
  dispatch = async () => { entered(); await wait; return success(); };
  const request = body();
  const first = invoke("generate", request);
  await Promise.race([ready, first.then(() => {
    throw new Error("Generation completed before entering the controlled provider.");
  })]);
  const duplicates = await Promise.all([invoke("generate", request), invoke()]);
  assert.ok(duplicates.every(row => [200, 409].includes(row.code)));
  assert.equal(calls, 1);
  release(); assert.equal((await first).code, 201);
});
test("same request ID is durable even after definite rejection", async () => {
  dispatch = async () => {
    const err = Object.assign(new Error("This IP address 74.220.48.164 is not whitelisted."),
      { statusCode: 404, providerResponse: { secret: "never-return" } });
    throw err;
  };
  const request = body();
  assert.equal((await invoke("generate", request)).code, 503);
  assert.equal((await invoke("generate", request)).code, 200);
  assert.equal(calls, 1);
  const res = await invoke("get");
  assert.equal(res.body.data.virtualAccount.failureReason, "PROVIDER_ACCESS_REJECTED");
  assert.ok(!JSON.stringify(res.body).includes("never-return"));
});
test("blocked, suspended and deleted customers cannot generate", async () => {
  for (const patch of [{ status: "BLOCKED" }, { status: "SUSPENDED" },
    { status: "ACTIVE", isDeleted: true }, { isDeleted: false, deletedAt: new Date() }]) {
    await User.updateOne({ _id: customer._id }, { $set: patch });
    assert.equal((await invoke()).code, 403);
    assert.equal((await invoke("get")).body.data.eligibility.canGenerate, false);
  }
  assert.equal(calls, 0);
});
test("missing required identity, foreign fields, reason and malformed IDs fail closed", async () => {
  assert.equal((await invoke("generate", { ...body(), walletBalance: 0 })).code, 400);
  assert.equal((await invoke("generate", { ...body(), reason: "" })).code, 400);
  assert.equal((await invoke("generate", { ...body(), requestId: "invalid" })).code, 400);
  await User.updateOne({ _id: customer._id }, { $set: { email: "" } });
  assert.equal((await invoke()).code, 400); assert.equal(calls, 0);
  await User.updateOne({ _id: customer._id }, { $set: { email: "va-admin@example.invalid" } });
});
test("only active HEAD_OFFICE actors can view or generate, including direct-controller checks", async () => {
  for (const role of ["CUSTOMER", "STAFF", "SUPER_ADMIN", "BRANCH"]) {
    assert.equal((await invoke("get", null, { _id: admin._id, role })).code, 403);
    assert.equal((await invoke("generate", body(), { _id: admin._id, role })).code, 403);
  }
  await User.updateOne({ _id: admin._id }, { $set: { status: "BLOCKED" } });
  assert.equal((await invoke()).code, 403); assert.equal(calls, 0);
});
test("failed audit persistence prevents provider dispatch", async () => {
  const original = Audit.create;
  Audit.create = async () => { throw new Error("audit storage unavailable private"); };
  try {
    const res = await invoke();
    assert.equal(res.code, 503); assert.equal(calls, 0);
    assert.ok(!JSON.stringify(res.body).includes("private"));
  } finally { Audit.create = original; }
});
test("audit failure after successful creation preserves canonical account and prevents replay", async () => {
  const original = Audit.create;
  let count = 0;
  Audit.create = async (...args) => {
    if (++count === 2) throw new Error("outcome storage unavailable");
    return original.apply(Audit, args);
  };
  const request = body();
  try { assert.equal((await invoke("generate", request)).code, 503); }
  finally { Audit.create = original; }
  assert.equal((await stored()).virtualAccount.accountNumber, bank.accountNumber);
  assert.equal((await invoke("generate", request)).code, 200);
  assert.equal(calls, 1);
});
test("bounded generation history is customer scoped, chronological and sanitized", async () => {
  const rows = Array.from({ length: 53 }, (_, i) => ({
    actorId: admin._id, actorRole: "HEAD_OFFICE", targetUserId: customer._id,
    action: "VIRTUAL_ACCOUNT_GENERATION_REQUESTED", reason: "Sandbox history fixture",
    createdAt: new Date(Date.now() - i * 1000),
    metadata: { requestId: randomUUID(), secret: "hidden-audit-metadata" },
  }));
  await Audit.create(rows);
  const first = await invoke("get");
  assert.equal(first.body.data.history.length, 50);
  assert.ok(first.body.data.nextCursor);
  assert.ok(!JSON.stringify(first.body).includes("hidden-audit-metadata"));
  const second = await invoke("get", null, admin, customer._id, { before: first.body.data.nextCursor });
  assert.equal(second.body.data.history.length, 3);
  const dates = [...first.body.data.history, ...second.body.data.history].map(r => new Date(r.createdAt).getTime());
  assert.ok(dates.every((value, i) => !i || value <= dates[i - 1]));
  assert.equal(new Set([...first.body.data.history, ...second.body.data.history].map(r => r.id)).size, 53);
});
test("real authenticated admin routes reject unauthorized users and create through existing integration", async () => {
  const express = require("express"), jwt = require("jsonwebtoken");
  const app = express(); app.use(express.json());
  app.use("/api/admin", require("../routes/admin.routes"));
  app.use("/api/securewave", require("../routes/securewave.routes"));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, method = "GET", actor, data) => {
    const response = await fetch(base + path, { method, headers: {
      "Content-Type": "application/json",
      ...(actor ? { Authorization: `Bearer ${jwt.sign({ id: String(actor._id), authTokenVersion: 0 }, process.env.JWT_SECRET)}` } : {}),
    }, ...(data ? { body: JSON.stringify(data) } : {}) });
    return { code: response.status, body: await response.json() };
  };
  try {
    const path = `/api/admin/users/${customer._id}/virtual-account`;
    assert.equal((await request(path)).code, 401);
    assert.equal((await request(path, "GET", customer)).code, 403);
    assert.equal((await request(path, "POST", customer, body())).code, 403);
    assert.equal((await request(path, "GET", admin)).code, 200);
    const result = await request(path, "POST", admin, body());
    assert.equal(result.code, 201);
    assert.equal(result.body.data.virtualAccount.accountNumber, bank.accountNumber);
    const own = await request("/api/securewave/virtual-account", "GET", customer);
    assert.equal(own.code, 200);
    assert.equal(own.body.data.virtualAccount.accountNumber, bank.accountNumber);
    assert.equal(calls, 1);
  } finally { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
});
