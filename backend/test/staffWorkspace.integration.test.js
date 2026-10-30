const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const User = require("../models/user.model");
const Role = require("../models/role.model");
const Case = require("../models/fintechCase.model");
const Audit = require("../models/adminAuditLog.model");
const Transaction = require("../models/transaction.model");
const Branch = require("../models/branch.model");
const Delivery = require("../models/delivery.model");
const c = require("../controllers/staffWorkspace.controller");
const { loadStaffRole, requirePermission } = require("../middleware/staffPermission.middleware");

let mongo, sequence = 0, head, customer, supportRole, opsRole;
const makeUser = (role, extra = {}) => User.create({
  fullName: `${role} Workspace ${++sequence}`,
  phone: `080${String(sequence).padStart(8, "0")}`,
  email: `workspace-${sequence}@example.test`, password: "FixturePassword91!",
  role, status: "ACTIVE", ...extra,
});
const call = async (handler, options = {}) => {
  const req = { user: head, staffAccess: { isHeadOffice: true, roleName: "HEAD_OFFICE", permissions: ["*"], scope: { type: "GLOBAL" } },
    params: {}, query: {}, body: {}, method: "POST", originalUrl: "/api/admin/staff-workspace", ...options };
  const result = { status: 200 };
  await handler(req, { status(s) { result.status = s; return this; }, json(body) { result.body = body; return this; } });
  return result;
};
const middleware = async (fn, req) => {
  const result = { status: 200, next: false };
  await fn(req, { status(s) { result.status = s; return this; }, json(body) { result.body = body; } }, () => { result.next = true; });
  return result;
};
test.before(async () => {
  // Deliberately ignore every ambient application database URI.
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  const uri = mongo.getUri();
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:/);
  await mongoose.connect(uri, { dbName: "operations-support-disposable" });
  await Promise.all([User, Role, Case, Audit, Transaction, Branch, Delivery].map((m) => m.init()));
  head = await makeUser("HEAD_OFFICE");
  customer = await makeUser("CUSTOMER");
});
test.after(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });

test("Head Office provisions two individual-account roles idempotently without financial adjustment permissions", async () => {
  const first = await call(c.provisionRoles);
  assert.equal(first.status, 200);
  const again = await call(c.provisionRoles);
  assert.equal(again.status, 200);
  assert.equal(await Role.countDocuments(), 2);
  opsRole = await Role.findOne({ name: "OPERATIONS_MANAGER" });
  supportRole = await Role.findOne({ name: "CUSTOMER_SUPPORT" });
  for (const role of [opsRole, supportRole]) {
    assert.equal(role.scopeType, "GLOBAL");
    assert.ok(role.permissions.includes("support.assign"));
    assert.ok(!role.permissions.some((p) => /wallet|refund|withdrawal|reconcil|staff\.|roles\./.test(p)));
  }
});
test("staff cannot provision or grant roles", async () => {
  const result = await call(c.provisionRoles, { staffAccess: { isHeadOffice: false } });
  assert.equal(result.status, 403);
});
test("existing role permissions, custom scope and inactive status are preserved", async () => {
  await Role.updateOne({ _id: supportRole._id }, { $set: { scopeType: "SELF", status: "INACTIVE" } });
  assert.equal((await call(c.provisionRoles)).status, 200);
  const role = await Role.findById(supportRole._id);
  assert.equal(role.scopeType, "SELF"); assert.equal(role.status, "INACTIVE");
  await Role.updateOne({ _id: supportRole._id }, { $set: { scopeType: "GLOBAL", status: "ACTIVE" } });
});
test("assigned active staff load least-privilege role; deactivated role cannot authenticate staff access", async () => {
  const user = await makeUser("STAFF", { isStaff: true, staffRoleId: supportRole._id });
  const req = { user };
  assert.equal((await middleware(loadStaffRole, req)).next, true);
  assert.equal(req.staffAccess.roleName, "CUSTOMER_SUPPORT");
  assert.equal((await middleware(requirePermission("wallets.adjust"), req)).status, 403);
  assert.equal((await middleware(requirePermission("support.resolve"), req)).next, true);
  await Role.updateOne({ _id: supportRole._id }, { $set: { status: "INACTIVE" } });
  assert.equal((await middleware(loadStaffRole, { user })).status, 403);
  await Role.updateOne({ _id: supportRole._id }, { $set: { status: "ACTIVE" } });
});
test("customer search uses allowlist projection and escapes regex input", async () => {
  const response = await call(c.customers, { query: { q: customer.email } });
  assert.equal(response.status, 200); assert.equal(response.body.data.total, 1);
  assert.deepEqual(Object.keys(response.body.data.items[0]).sort(), ["email", "fullName", "id", "phone", "status"]);
  assert.equal((await call(c.customers, { query: { q: ".*[" } })).status, 200);
  assert.equal((await call(c.customers, { query: { q: "a" } })).status, 400);
});
test("customer detail never exposes secrets, identity or wallet data", async () => {
  const response = await call(c.customerDetail, { params: { id: String(customer._id) } });
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body.data.customer).sort(), ["email", "fullName", "id", "phone", "status"]);
  assert.equal((await call(c.customerDetail, { params: { id: "$ne" } })).status, 404);
});
let ticket;
test("staff complaint creation is idempotent, audited and records actual staff actor", async () => {
  const body = { customerId: String(customer._id), subject: "Investigate fixture transaction",
    description: "Non-production complaint for regression verification.", category: "OTHER", priority: "HIGH", idempotencyKey: "workspace-fixture-key-001" };
  const first = await call(c.createTicket, { body });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const second = await call(c.createTicket, { body });
  assert.equal(second.body.data.id, first.body.data.id);
  ticket = await Case.findById(first.body.data.id);
  assert.equal(String(ticket.createdBy), String(head._id));
  assert.equal(await Case.countDocuments(), 1);
  assert.ok(await Audit.findOne({ "metadata.caseId": String(ticket._id) }));
  assert.equal((await call(c.createTicket, { body: { ...body, description: "Different complaint with reused key." } })).status, 409);
});
test("invalid and unrelated customer transaction references cannot be attached to complaints", async () => {
  const result = await call(c.createTicket, { body: { customerId: String(customer._id), subject: "Example",
    description: "Example description", idempotencyKey: "bad-transaction-key", transactionId: "not-an-owned-history-lookup" } });
  assert.equal(result.status, 404);
});
test("escalation records preserved complaint history and reason exactly once", async () => {
  const req = { params: { id: String(ticket._id) }, body: { reason: "Head Office review required for fixture." } };
  assert.equal((await call(c.escalate, req)).status, 200);
  assert.equal((await call(c.escalate, req)).status, 200);
  const latest = await Case.findById(ticket._id);
  assert.equal(latest.status, "ESCALATED");
  assert.equal(latest.statusEvents.filter((v) => v.status === "ESCALATED").length, 1);
  assert.equal(latest.notes.length, 1);
  assert.equal(await Audit.countDocuments({ "metadata.caseId": String(ticket._id), "metadata.escalatedTo": "HEAD_OFFICE" }), 1);
});
test("closed complaints cannot be escalated and unknown statuses/filters do not broaden searches", async () => {
  await Case.updateOne({ _id: ticket._id }, { $set: { status: "CLOSED" } });
  assert.equal((await call(c.escalate, { params: { id: String(ticket._id) }, body: { reason: "Try closed complaint." } })).status, 409);
  assert.equal((await call(c.transactions, { query: { status: '{"$ne":""}' } })).status, 400);
});
test("support summary excludes global financial monitoring and customer records", async () => {
  const response = await call(c.overview, { staffAccess: { isHeadOffice: false, roleName: "CUSTOMER_SUPPORT", permissions: ["support.workspace.view"] } });
  assert.equal(response.status, 200);
  assert.ok(response.body.data.tickets);
  assert.equal(response.body.data.transactions, undefined);
  assert.equal(response.body.data.issues, undefined);
});
test("operational overview reads records without changing transactions or balances", async () => {
  const before = await User.findById(customer._id).lean();
  const count = await Transaction.countDocuments();
  const result = await call(c.overview);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.ok(result.body.data.transactions);
  assert.equal(await Transaction.countDocuments(), count);
  const after = await User.findById(customer._id).lean();
  assert.deepEqual(after, before);
});
test("route contract requires authenticated role and guards global scope and mutation permissions", () => {
  const fs = require("node:fs");
  const source = fs.readFileSync(require.resolve("../routes/staffWorkspace.routes"), "utf8");
  assert.match(source, /router\.use\(protect, loadStaffRole\)/);
  assert.match(source, /scope\?\.type !== "GLOBAL"/);
  assert.match(source, /requirePermission\("support\.resolve"\)/);
  assert.match(source, /Operations permission required/);
});
test("real stored transaction fields drive service filters, revenue and owned complaint context without mutation", async () => {
  const record = await Transaction.create({
    customerId: customer._id, reference: "WORKSPACE-FIXTURE-DATA-001",
    serviceType: "DATA", provider: "CLUBKONNECT", phone: customer.phone,
    amount: 1000, servicepayProfit: 12, status: "SUCCESSFUL",
  });
  const before = await Transaction.findById(record._id).lean();
  const list = await call(c.transactions, { query: { type: "DATA", status: "SUCCESSFUL" } });
  assert.equal(list.status, 200);
  assert.equal(list.body.data.items[0].type, "DATA");
  assert.equal(list.body.data.items[0].status, "SUCCESSFUL");
  assert.equal((await call(c.customers, { query: { q: record.reference } })).body.data.total, 1);
  const summary = await call(c.overview);
  assert.equal(summary.status, 200);
  assert.equal(summary.body.data.revenue.recordedServicepayProfit, 12);
  assert.ok(summary.body.data.transactions.services.some((v) => v._id === "DATA"));
  const payload = { customerId: String(customer._id), subject: "Owned transaction",
    description: "Read-only test context", category: "TRANSACTION", priority: "NORMAL",
    transactionId: String(record._id), idempotencyKey: "owned-workspace-transaction-001" };
  const created = await call(c.createTicket, { body: payload });
  assert.equal(created.status, 200);
  const complaint = await Case.findById(created.body.data.id);
  assert.equal(complaint.transactionContext.transactionType, "DATA");
  assert.equal(complaint.transactionContext.reference, record.reference);
  const other = await makeUser("CUSTOMER");
  assert.equal((await call(c.createTicket, { body: { ...payload, customerId: String(other._id) } })).status, 404);
  assert.deepEqual(await Transaction.findById(record._id).lean(), before);
});
test("HTTP login, cross-role restrictions, staff suspension and session revocation use existing authentication", async () => {
  const express = require("express");
  const { loginUser } = require("../controllers/auth.controller");
  const jwt = require("jsonwebtoken");
  const app = express();
  app.use(express.json());
  app.post("/login", loginUser);
  app.use("/workspace", require("../routes/staffWorkspace.routes"));
  app.use("/support", require("../routes/support.routes").admin);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, token, body) => {
    const response = await fetch(base + path, { method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  try {
    assert.equal((await request("/workspace/overview")).status, 401);
    for (const role of [supportRole, opsRole]) {
      const staff = await makeUser("STAFF", { isStaff: true, staffRoleId: role._id });
      const login = await request("/login", null, { email: staff.email, password: "FixturePassword91!" });
      assert.equal(login.status, 200);
      const token = login.body.token || login.body.data?.token;
      assert.ok(token);
      assert.equal((await request("/workspace/overview", token)).status, 200);
      assert.equal((await request("/workspace/provision-roles", token, {})).status, 403);
      const aiResponse = await fetch(base + "/support/ai-settings", {
        method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ enabled: false }),
      });
      assert.equal(aiResponse.status, 403);
      const tx = await request("/workspace/transactions", token);
      assert.equal(tx.status, role.name === "OPERATIONS_MANAGER" ? 200 : 403);
      const history = await request(`/workspace/staff/${staff._id}/history`, token);
      assert.equal(history.status, 403);
      await User.updateOne({ _id: staff._id }, { $set: { status: "SUSPENDED" } });
      assert.equal((await request("/workspace/overview", token)).status, 403);
      await User.updateOne({ _id: staff._id }, { $set: { status: "ACTIVE" }, $inc: { authTokenVersion: 1 } });
      assert.equal((await request("/workspace/overview", token)).status, 401);
    }
    const headLogin = await request("/login", null, { email: head.email, password: "FixturePassword91!" });
    assert.equal(headLogin.status, 200);
    const headToken = headLogin.body.token || headLogin.body.data?.token;
    assert.equal((await request("/workspace/overview", headToken)).status, 200);
    const supportMember = await makeUser("STAFF", { isStaff: true, staffRoleId: supportRole._id });
    const history = await request(`/workspace/staff/${supportMember._id}/history`, headToken);
    assert.equal(history.status, 200);
    assert.ok(Array.isArray(history.body.data.logins));
    const rawCustomerToken = jwt.sign({ id: String(customer._id) }, process.env.JWT_SECRET);
    assert.equal((await request("/workspace/overview", rawCustomerToken)).status, 403);
    const scopedRole = await Role.create({ name: "SCOPED_SUPPORT_TEST", displayName: "Scoped Support Test", department: "CUSTOMER_SUPPORT",
      scopeType: "SELF", permissions: ["support.workspace.view", "support.view", "support.resolve"] });
    const scopedStaff = await makeUser("STAFF", { isStaff: true, staffRoleId: scopedRole._id });
    const scopedToken = jwt.sign({ id: String(scopedStaff._id) }, process.env.JWT_SECRET);
    assert.equal((await request("/workspace/overview", scopedToken)).status, 403);
    assert.equal((await request("/support/tickets", scopedToken)).status, 403);
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});
