const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const User = require("../models/user.model");
const Role = require("../models/role.model");
const Audit = require("../models/adminAuditLog.model");
const email = require("../services/email.service");
let delivered;
email.sendEmail = async () => { delivered++; return { success: true }; };
const profile = require("../controllers/customerProfile.controller");
const auth = require("../controllers/auth.controller");
const P = require("../services/adminContactCorrection.service").PERMISSION;
const password = "DirectCorrectionTest123!";
let mongo, customer, admin, other, role;
async function call(method, body = {}, actor = admin, controller = profile) {
  const res = { code: 200, status(n) { this.code = n; return this; }, json(body) { this.body = body; return this; } };
  await controller[method]({ user: actor && { _id: actor._id, role: actor.role },
    params: { id: String(customer._id) }, query: {},
    staffAccess: { isHeadOffice: actor?.role === "HEAD_OFFICE", permissions: ["*"] },
    body, method: "PUT", originalUrl: "/api/admin/users/test/profile" }, res);
  return res;
}
const body = (extra = {}) => ({
  phone: "08070000099", email: "corrected@example.invalid", reason: "Correct customer support contact",
  currentPassword: password, expectedPhone: customer.phone, expectedEmail: customer.email, ...extra,
});
async function stored() { return User.collection.findOne({ _id: customer._id }); }
function protectedData(user) {
  const copy = { ...user };
  for (const key of ["phone", "email", "phoneVerified", "emailVerified", "profileRecoveryBlocked",
    "authTokenVersion", "updatedAt", "profileContactChallenge", "profileContactProposal",
    "passwordResetToken", "passwordResetExpires"]) delete copy[key];
  return copy;
}
test.before(async () => {
  assert.equal(process.env.MONGODB_URI, undefined, "Production database must not be inherited.");
  process.env.JWT_SECRET ||= "isolated-contact-correction-test-only";
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ args: ["--nounixsocket"] }] });
  await mongoose.connect(mongo.getUri());
  await Promise.all([User.init(), Role.init(), Audit.init()]);
});
test.after(async () => { await mongoose.disconnect(); await mongo?.stop(); });
test.beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Role.deleteMany({}), Audit.collection.deleteMany({})]);
  delivered = 0;
  role = await Role.create({ name: "CONTACT_SUPPORT", displayName: "Contact support",
    department: "CUSTOMER_SUPPORT", permissions: [P] });
  [customer, admin, other] = await User.create([
    { fullName: "Direct QA Customer", phone: "08070000001", email: "customer@example.invalid",
      password, role: "CUSTOMER", status: "ACTIVE", phoneVerified: true, emailVerified: true,
      walletBalance: 12500, walletHeldBalance: 500, address: "Original address" },
    { fullName: "Direct QA Head Office", phone: "08070000002", email: "admin@example.invalid",
      password, role: "HEAD_OFFICE", status: "ACTIVE", staffRoleId: role._id },
    { fullName: "Other customer", phone: "08070000003", email: "other@example.invalid",
      password, role: "CUSTOMER", status: "ACTIVE" },
  ]);
});
test("direct correction saves both contacts unverified, revokes sessions and preserves protected fields", async () => {
  await User.updateOne({ _id: customer._id }, { $set: {
    passwordResetToken: "obsolete-proof", passwordResetExpires: new Date(Date.now() + 60000),
    "virtualAccount.accountNumber": "0123456789", "virtualAccount.status": "ACTIVE",
  } });
  const before = await stored();
  const result = await call("updateAdmin", body({ phone: "+234 807 000 0099", email: " CORRECTED@EXAMPLE.INVALID " }));
  assert.equal(result.code, 200, JSON.stringify(result.body));
  const after = await stored();
  assert.equal(after.phone, "08070000099"); assert.equal(after.email, "corrected@example.invalid");
  assert.equal(after.phoneVerified, false); assert.equal(after.emailVerified, false);
  assert.deepEqual(after.profileRecoveryBlocked, { phone: true, email: true });
  assert.equal(after.authTokenVersion, Number(before.authTokenVersion || 0) + 1);
  assert.equal(after.passwordResetToken, undefined);
  assert.deepEqual(protectedData(after), protectedData(before));
  const audit = await Audit.findOne({ action: "USER_PROFILE_UPDATED" }).lean();
  assert.equal(audit.previousData.phone, customer.phone);
  assert.equal(audit.newData.phone, after.phone);
  assert.equal(audit.metadata.verificationMethod, "ADMIN_DIRECT_UNVERIFIED");
  assert.equal(audit.metadata.ownershipVerified, false);
  assert.equal(JSON.stringify(audit).includes(password), false);
});
test("wildcard Head Office, inactive roles, non-Head Office and unauthenticated actors cannot correct contacts", async () => {
  assert.equal((await call("updateAdmin", body(), null)).code, 401);
  assert.equal((await call("updateAdmin", body(), other)).code, 403);
  await Role.updateOne({ _id: role._id }, { $set: { permissions: ["*"] } });
  // Raw update bypasses the enum only to model a legacy wildcard role.
  assert.equal((await call("updateAdmin", body())).code, 403);
  await Role.updateOne({ _id: role._id }, { $set: { permissions: [P], status: "INACTIVE" } });
  assert.equal((await call("updateAdmin", body())).code, 403);
  assert.equal((await stored()).phone, customer.phone);
});
test("password, reason, expected contacts and field allowlists are enforced", async () => {
  for (const [extra, status] of [
    [{ currentPassword: "" }, 400], [{ currentPassword: "incorrect" }, 401],
    [{ reason: "" }, 400], [{ expectedPhone: "stale" }, 409],
    [{ expectedEmail: null }, 409], [{ phoneVerified: true }, 400],
    [{ walletBalance: 999999 }, 400],
  ]) assert.equal((await call("updateAdmin", body(extra))).code, status);
  const noPassword = body(); delete noPassword.currentPassword;
  assert.equal((await call("updateAdmin", noPassword)).code, 400);
  assert.equal(await Audit.countDocuments(), 0);
});
test("duplicate and invalid contacts are rejected without partial profile writes", async () => {
  for (const [extra, status] of [
    [{ phone: "+2348070000003" }, 409], [{ email: "OTHER@EXAMPLE.INVALID" }, 409],
    [{ phone: "123" }, 400], [{ email: "bad email" }, 400],
  ]) assert.equal((await call("updateAdmin", body(extra))).code, status);
  assert.equal((await stored()).phone, customer.phone);
  assert.equal(await Audit.countDocuments(), 0);
});
test("concurrent saves cannot overwrite stale contacts or create duplicate audit outcomes", async () => {
  const out = await Promise.all([call("updateAdmin", body()), call("updateAdmin", body({ phone: "08070000098" }))]);
  assert.deepEqual(out.map(x => x.code).sort(), [200, 409]);
  assert.equal(await Audit.countDocuments({ action: "USER_PROFILE_UPDATED" }), 1);
});
test("ordinary edits remain possible without correction permission or password", async () => {
  await Role.updateOne({ _id: role._id }, { $set: { permissions: [] } });
  assert.equal((await call("updateAdmin", { fullName: "Corrected Name", reason: "Fix name spelling" })).code, 200);
  assert.equal((await stored()).phone, customer.phone);
  assert.equal((await call("contactCorrectionAccess")).body.data.canCorrect, false);
});
test("audit failure rolls back contact, trust and token mutations", async () => {
  const before = await stored(), original = Audit.create;
  Audit.create = async () => { throw Error("isolated audit failure"); };
  try { assert.equal((await call("updateAdmin", body())).code, 500); }
  finally { Audit.create = original; }
  assert.deepEqual(await stored(), before);
});
test("corrected email cannot receive reset links or redeem stale reset tokens; legacy recovery stays available", async () => {
  assert.equal((await call("updateAdmin", body())).code, 200);
  assert.equal((await call("forgotPassword", { email: "corrected@example.invalid" }, null, auth)).code, 200);
  assert.equal(delivered, 0);
  const crypto = require("node:crypto");
  await User.updateOne({ _id: customer._id }, { $set: {
    passwordResetToken: crypto.createHash("sha256").update("stale-reset-token").digest("hex"),
    passwordResetExpires: new Date(Date.now() + 60000),
  } });
  const denied = await call("resetPassword", { token: "stale-reset-token",
    newPassword: "DifferentStrongPassword123!", confirmPassword: "DifferentStrongPassword123!" }, null, auth);
  assert.equal(denied.code, 400);
  await call("forgotPassword", { email: other.email }, null, auth);
  assert.equal(delivered, 1);
});
test("unverified direct contacts remain password-login identifiers without changing the password", async () => {
  assert.equal((await call("updateAdmin", body())).code, 200);
  const corrected = await User.findById(customer._id).select("+password");
  assert.equal(await corrected.comparePassword(password), true);
  assert.equal(await User.exists({ phone: "08070000099", _id: customer._id }) !== null, true);
});
test("sensitive historical contact values require the explicit correction permission", async () => {
  assert.equal((await call("updateAdmin", body())).code, 200);
  let history = (await call("history")).body.data.history;
  assert.equal(history[0].metadata.directCorrection.ownershipVerified, false);
  await Role.updateOne({ _id: role._id }, { $set: { permissions: [] } });
  history = (await call("history")).body.data.history;
  assert.equal(history[0].previousData.phone, undefined);
  assert.equal(history[0].newData.email, undefined);
  assert.equal(history[0].metadata.directCorrection, undefined);
});
test("pending activation and deleted accounts cannot have authentication contacts redirected", async () => {
  await User.updateOne({ _id: customer._id }, { $set: { activationPending: true } });
  assert.equal((await call("updateAdmin", body())).code, 409);
  await User.updateOne({ _id: customer._id }, { $set: { activationPending: false, isDeleted: true } });
  assert.equal((await call("updateAdmin", body())).code, 409);
});
test("authenticated HTTP routes enforce permission, save immediately, revoke old sessions and allow password login", async () => {
  const express = require("express"), jwt = require("jsonwebtoken");
  const app = express(); app.use(express.json());
  app.use("/api/auth", require("../routes/auth.routes"));
  app.use("/api/admin", require("../routes/admin.routes"));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const token = actor => jwt.sign({ id: String(actor._id), authTokenVersion: 0 }, process.env.JWT_SECRET);
  const http = async (path, method, data, actor) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { "Content-Type": "application/json",
        ...(actor ? { Authorization: `Bearer ${token(actor)}` } : {}) },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    const path = `/api/admin/users/${customer._id}/profile`;
    assert.equal((await http(path, "PUT", body())).status, 401);
    assert.equal((await http(path + "/contact-correction", "GET", null, other)).status, 403);
    assert.equal((await http(path + "/contact-correction", "GET", null, admin)).body.data.canCorrect, true);
    assert.equal((await http(path, "PUT", body(), admin)).status, 200);
    assert.equal((await http("/api/auth/profile", "GET", null, customer)).status, 401);
    const login = await http("/api/auth/login", "POST", { email: "corrected@example.invalid", password });
    assert.equal(login.status, 200);
    assert.equal(String(login.body.user?._id || login.body.user?.id), String(customer._id));
  } finally { await new Promise(resolve => server.close(resolve)); }
});
