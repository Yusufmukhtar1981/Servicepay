const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const User = require("../models/user.model");
const Role = require("../models/role.model");
const Audit = require("../models/adminAuditLog.model");
const Transaction = require("../models/transaction.model");
const auth = require("../controllers/auth.controller");
const { protect } = require("../middleware/auth.middleware");
let mongo, server, base, headToken, customer, sequence = 0;
const password = "DisposableStaffFixture91!";
const user = (role) => User.create({
  fullName: `Safe ${role} ${++sequence}`, role, status: "ACTIVE",
  email: `staff-lifecycle-${sequence}@example.test`,
  phone: `080${String(sequence).padStart(8, "0")}`, password,
});
async function api(path, token, method = "GET", body) {
  const response = await fetch(base + path, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}
async function login(email, secret = password) {
  const result = await api("/api/auth/login", null, "POST", { email, password: secret });
  assert.equal(result.status, 200);
  return result.body.token;
}
test.before(async () => {
  // Always use a disposable local replica. Never connect to ambient Atlas URIs.
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(mongo.getUri(), { dbName: "disposable-staff-lifecycle" });
  await Promise.all([User.init(), Role.init(), Audit.init(), Transaction.init()]);
  const head = await user("HEAD_OFFICE");
  customer = await user("CUSTOMER");
  const app = express();
  app.use(express.json());
  app.post("/api/auth/login", auth.loginUser);
  app.post("/api/auth/change-password", protect, auth.changePassword);
  app.use("/api/staff-management", require("../routes/staffManagement.routes"));
  app.use("/api/admin/staff-workspace", require("../routes/staffWorkspace.routes"));
  server = await new Promise((resolve) => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  base = `http://127.0.0.1:${server.address().port}`;
  headToken = await login(head.email);
  assert.equal((await api("/api/admin/staff-workspace/provision-roles", headToken, "POST", {})).status, 200);
});
test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});
for (const roleName of ["OPERATIONS_MANAGER", "CUSTOMER_SUPPORT"]) {
  test(`${roleName}: Head Office create, password setup, login, edit, reset, role revoke and reactivation`, async () => {
    const baselineCustomer = await User.findById(customer._id).lean();
    const role = await Role.findOne({ name: roleName });
    const n = ++sequence;
    const email = `safe-staff-${n}@example.test`;
    const created = await api("/api/staff-management/staff", headToken, "POST", {
      fullName: `Disposable ${roleName}`, phone: `080${String(n).padStart(8, "0")}`,
      email, password, roleId: String(role._id),
    });
    assert.equal(created.status, 201);
    const id = created.body.staff.id || created.body.staff._id;
    assert.ok(!Object.hasOwn(created.body.staff, "password"));
    assert.equal(created.body.staff.mustChangePassword, true);
    const stored = await User.findById(id).select("+password").lean();
    assert.match(stored.password, /^\$2[aby]\$/);
    assert.notEqual(stored.password, password);
    let token = await login(email);
    assert.notEqual((await api("/api/admin/staff-workspace/overview", token)).status, 200);
    const nextPassword = "DisposableStaffChanged92!";
    const changed = await api("/api/auth/change-password", token, "POST", {
      currentPassword: password, newPassword: nextPassword, confirmPassword: nextPassword,
    });
    assert.equal(changed.status, 200);
    assert.equal((await User.findById(id)).mustChangePassword, false);
    token = await login(email, nextPassword);
    assert.equal((await api("/api/admin/staff-workspace/overview", token)).status, 200);
    assert.equal((await api("/api/staff-management/staff", token)).status, 403);
    assert.equal((await api("/api/staff-management/staff", token, "POST", {})).status, 403);
    assert.equal((await api("/api/staff-management/roles", token)).status, 403);
    for (const action of ["", "/status", "/password"]) {
      assert.equal((await api(`/api/staff-management/staff/${id}${action}`, token, "PUT", {})).status, 403);
    }
    assert.equal((await api(`/api/staff-management/staff/${id}/role`, headToken, "PUT", {})).status, 400);
    assert.equal((await api(`/api/staff-management/staff/${id}/role`, token, "PUT", { revoke: true, reason: "Denied self-administration" })).status, 403);
    assert.equal((await api("/api/staff-management/staff", headToken)).status, 200);
    const edited = await api(`/api/staff-management/staff/${id}`, headToken, "PUT", { fullName: `Updated ${roleName}` });
    assert.equal(edited.status, 200);
    const history = await api(`/api/admin/staff-workspace/staff/${id}/history`, headToken);
    assert.equal(history.status, 200);
    assert.ok(Array.isArray(history.body.data.logins));
    assert.ok(history.body.data.logins.length > 0);
    assert.ok(history.body.data.activities.length > 0);
    assert.equal((await api(`/api/admin/staff-workspace/staff/${id}/history`, token)).status, 403);
    assert.equal((await api(`/api/staff-management/staff/${id}/status`, headToken, "PUT", { status: "SUSPENDED" })).status, 200);
    assert.notEqual((await api("/api/admin/staff-workspace/overview", token)).status, 200);
    assert.equal((await api(`/api/staff-management/staff/${id}/status`, headToken, "PUT", { status: "ACTIVE" })).status, 200);
    token = await login(email, nextPassword);
    const reason = "Controlled fixture role revocation";
    assert.equal((await api(`/api/staff-management/staff/${id}/role`, headToken, "PUT", { revoke: true, reason: "x" })).status, 400);
    assert.equal((await api(`/api/staff-management/staff/${id}/role`, headToken, "PUT", { revoke: true, reason })).status, 200);
    const revoked = await User.findById(id).select("+authTokenVersion").lean();
    assert.equal(revoked.staffRoleId, null);
    assert.equal(revoked.status, "SUSPENDED");
    assert.notEqual((await api("/api/admin/staff-workspace/overview", token)).status, 200);
    const beforeAuditCount = await Audit.countDocuments({ targetUserId: id, "metadata.operation": "REVOKE_STAFF_ROLE" });
    assert.equal(beforeAuditCount, 1);
    assert.equal((await api(`/api/staff-management/staff/${id}/role`, headToken, "PUT", { revoke: true, reason })).status, 200);
    assert.equal(await Audit.countDocuments({ targetUserId: id, "metadata.operation": "REVOKE_STAFF_ROLE" }), beforeAuditCount);
    assert.equal((await User.findById(id).select("+authTokenVersion")).authTokenVersion, revoked.authTokenVersion);
    assert.equal((await api(`/api/staff-management/staff/${id}/status`, headToken, "PUT", { status: "ACTIVE" })).status, 400);
    assert.equal((await api(`/api/staff-management/staff/${id}/role`, headToken, "PUT", { roleId: String(role._id) })).status, 200);
    assert.equal((await api(`/api/staff-management/staff/${id}/status`, headToken, "PUT", { status: "ACTIVE" })).status, 200);
    token = await login(email, nextPassword);
    const temporaryPassword = "DisposableTemporaryReset93!";
    assert.equal((await api(`/api/staff-management/staff/${id}/password`, headToken, "PUT", { temporaryPassword })).status, 200);
    assert.notEqual((await api("/api/admin/staff-workspace/overview", token)).status, 200);
    token = await login(email, temporaryPassword);
    assert.notEqual((await api("/api/admin/staff-workspace/overview", token)).status, 200);
    assert.equal((await api(`/api/staff-management/staff/${customer._id}/role`, headToken, "PUT", { revoke: true, reason })).status, 404);
    assert.deepEqual(await User.findById(customer._id).lean(), baselineCustomer);
    assert.equal(await Transaction.countDocuments({}), 0);
  });
}
test("a failed revocation audit rolls back the staff role and session changes", async () => {
  const member = await User.findOne({ isStaff: true, role: "STAFF", status: "ACTIVE" }).select("+authTokenVersion").lean();
  assert.ok(member);
  const create = Audit.create;
  try {
    Audit.create = async () => { throw Error("Disposable fixture audit failure"); };
    assert.equal((await api(`/api/staff-management/staff/${member._id}/role`, headToken, "PUT", {
      revoke: true, reason: "Test atomic audit failure protection",
    })).status, 500);
  } finally { Audit.create = create; }
  assert.deepEqual(await User.findById(member._id).select("+authTokenVersion").lean(), member);
});
