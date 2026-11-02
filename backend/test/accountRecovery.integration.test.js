"use strict";
const { before, after, beforeEach, test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const User = require("../models/user.model");
const Role = require("../models/role.model");
const Audit = require("../models/adminAuditLog.model");
const Login = require("../models/loginSecurityEvent.model");
const Notification = require("../models/notification.model");
const S = require("../services/accountRecovery.service");
const R = require("../services/accountRecovery.rules");
const { protect } = require("../middleware/auth.middleware");
const { adminRouter, customerRouter } = require("../routes/accountRecovery.routes");
const { normalizeStaffPermission } = require("../config/permissionRegistry");
const { validateStrongPassword } = require("../utils/passwordPolicy");
const authSource = require("node:fs").readFileSync(require("node:path").join(__dirname, "../controllers/auth.controller.js"), "utf8");
const resetStart = authSource.indexOf("exports.resetPassword = ") + "exports.resetPassword = ".length;
const resetEnd = authSource.indexOf("\n};", resetStart) + 2;
// Evaluate the actual existing reset handler with only its dependencies; avoid
// loading unrelated integrations into this isolated authentication test.
const legacyReset = new Function("User", "crypto", "bcrypt", "validateStrongPassword", "generateToken",
  `return (${authSource.slice(resetStart, resetEnd)});`)(User, crypto, bcrypt, validateStrongPassword, () => "disposable-access-token");
async function legacyResetRequest(payload) {
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; } };
  await legacyReset({ body: payload, params: {} }, response);
  return response;
}
let mongo, server, base, customer, actor, passwordHash;
let messages = [];
const adminPassword = "Disposable-Admin-Only-21!";
const customerPassword = "Disposable-Customer-Only-21!";
const reason = "Customer requested assistance after failed self-service recovery";
const allPermissions = Object.values(R.PERMISSIONS);
const emailHook = async input => { messages.push(input); return { success: true }; };
const tokenFor = user => jwt.sign({ id: String(user._id), authTokenVersion: user.authTokenVersion || 0 },
  process.env.JWT_SECRET, { expiresIn: "10m" });
const request = async (url, body, token = tokenFor(actor), method = body ? "POST" : "GET") => {
  const res = await fetch(base + url, { method, headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(body ? { "Content-Type": "application/json" } : {}),
  }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, body: await res.json() };
};
const raw = () => User.findById(customer._id).select(
  "+password +authTokenVersion +accountRecoveryState +passwordResetToken +customerRefreshSessions +transactionPin").lean();
const begin = action => S.start(customer._id, actor,
  { action, reason, currentPassword: adminPassword });
const otpFrom = () => messages.find(x => x.subject.includes("verification")).text.match(/\b\d{6}\b/)[0];
const verify = async (challenge, otp = otpFrom()) => S.verify(customer._id, actor,
  { challengeId: challenge.challengeId, otp, currentPassword: adminPassword });
const linkToken = () => messages.find(x => x.subject.includes("Complete your")).text.match(/#token=([a-f0-9]{64})/)[1];
const authorize = async action => { const challenge = await begin(action); await verify(challenge); return linkToken(); };
before(async () => {
  // Never use ambient Atlas/Render connection strings or real notifications.
  process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
  process.env.RESEND_API_KEY = "disposable-mocked-delivery";
  S.hooks.sendEmail = emailHook;
  S.hooks.createInAppNotification = async input => ({ _id: "mock", ...input });
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  const uri = mongo.getUri();
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:/);
  await mongoose.connect(uri, { dbName: "account-recovery-disposable", autoIndex: false });
  await Promise.all([User, Role, Audit, Login, Notification].map(m => m.createCollection()));
  passwordHash = await bcrypt.hash(customerPassword, 12);
  const app = express();
  app.use(express.json({ limit: "16kb" }));
  app.use("/api/admin/account-recovery", adminRouter);
  app.use("/api/account-recovery", customerRouter);
  app.get("/api/spending-fixture", protect, (req, res) => res.json({ success: true }));
  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(async () => {
  // Raw cleanup is confined to this newly created local disposable database;
  // production audit immutability remains enabled and is not bypassed in code.
  assert.match(mongoose.connection.host, /^(127\.0\.0\.1|localhost)$/);
  await Promise.all([User, Role, Audit, Login, Notification].map(m => m.collection.deleteMany({})));
  messages = [];
  S.hooks.sendEmail = emailHook;
  S.hooks.createInAppNotification = async input => ({ _id: "mock", ...input });
  const roleId = new mongoose.Types.ObjectId();
  await Role.collection.insertOne({ _id: roleId, name: "Recovery permissions fixture",
    status: "ACTIVE", permissions: allPermissions });
  actor = { _id: new mongoose.Types.ObjectId(), role: "HEAD_OFFICE", status: "ACTIVE",
    authTokenVersion: 0, staffRoleId: roleId };
  await User.collection.insertOne({ ...actor, isStaff: true, fullName: "Disposable Admin",
    phone: "08000000001", email: "admin@example.invalid",
    password: await bcrypt.hash(adminPassword, 10) });
  customer = { _id: new mongoose.Types.ObjectId(), role: "CUSTOMER", status: "ACTIVE",
    fullName: "Disposable Customer", phone: "08000000002", email: "customer@example.invalid",
    emailVerified: true, password: passwordHash, authTokenVersion: 0, walletBalance: 12345,
    virtualAccount: { accountNumber: "TEST-ONLY-NOT-A-BANK-ACCOUNT", status: "ACTIVE" },
    customerRefreshSessions: [{ tokenHash: "test-refresh", expiresAt: new Date(Date.now() + R.TTL) }] };
  await User.collection.insertOne(customer);
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});
test("permission catalog recognizes each explicit permission without wildcard", () => {
  for (const p of allPermissions) assert.equal(normalizeStaffPermission(p), p);
  assert.equal(R.authorized("HEAD_OFFICE", ["*"], R.PERMISSIONS.VIEW), false);
});
test("unauthenticated and ordinary customer access is denied", async () => {
  assert.equal((await request(`/api/admin/account-recovery/${customer._id}`, null, null)).status, 401);
  assert.equal((await request(`/api/admin/account-recovery/${customer._id}`, null, tokenFor(customer))).status, 403);
});
test("all excluded staff roles are denied even if assigned recovery permissions", async () => {
  for (const role of ["ZONAL_MANAGER", "STATE_MANAGER", "BRANCH_MANAGER", "OPERATIONS_MANAGER", "CUSTOMER_SUPPORT"]) {
    assert.equal(R.authorized(role, allPermissions, R.PERMISSIONS.VIEW), false);
  }
});
test("Head Office wildcard without active assigned recovery permissions is denied", async () => {
  await Role.updateOne({ _id: actor.staffRoleId }, { $set: { permissions: ["*"] } });
  assert.equal((await request(`/api/admin/account-recovery/${customer._id}`)).status, 403);
});
test("disabled assigned role cannot authorize recovery", async () => {
  await Role.updateOne({ _id: actor.staffRoleId }, { $set: { status: "INACTIVE" } });
  assert.equal((await request(`/api/admin/account-recovery/${customer._id}`)).status, 403);
});
test("view permission does not grant recovery actions", async () => {
  await Role.updateOne({ _id: actor.staffRoleId }, { $set: { permissions: [R.PERMISSIONS.VIEW] } });
  assert.equal((await request(`/api/admin/account-recovery/${customer._id}/challenge`,
    { action: "PASSWORD_RESET", reason, currentPassword: adminPassword })).status, 403);
});
test("diagnostics expose no hashes, tokens or credentials", async () => {
  const result = await request(`/api/admin/account-recovery/${customer._id}`);
  assert.equal(result.status, 200);
  assert.equal(result.body.channelAvailable, true);
  assert.equal(result.body.diagnostics.ordinaryLockSupported, false);
  assert.doesNotMatch(JSON.stringify(result.body), /passwordResetToken|tokenHash|otpHash|\$2[aby]\$/);
});
test("fresh admin authentication is mandatory and durable rate limits apply", async () => {
  for (let n = 0; n < 12; n++) {
    await assert.rejects(S.start(customer._id, actor, {
      action: "PASSWORD_RESET", reason, currentPassword: "wrong",
    }), e => e.statusCode === 401);
  }
  await assert.rejects(begin("PASSWORD_RESET"), e => e.statusCode === 429);
});
test("customer verification is required; no plaintext OTP is stored", async () => {
  const challenge = await begin("PASSWORD_RESET");
  assert.equal(challenge.expiresAt > Date.now(), true);
  const row = await raw();
  assert.equal(row.accountRecoveryState.status, "CHALLENGE_SENT");
  assert.equal(row.accountRecoveryState.expiresAt <= Date.now() + R.TTL, true);
  assert.doesNotMatch(JSON.stringify(row), new RegExp(otpFrom()));
  assert.equal(row.password, passwordHash);
});
test("unverified and directly corrected email cannot receive recovery", async () => {
  await User.updateOne({ _id: customer._id }, { $set: { emailVerified: false } });
  await assert.rejects(begin("PASSWORD_RESET"), e => e.statusCode === 409);
  await User.updateOne({ _id: customer._id }, { $set: {
    emailVerified: true, profileRecoveryBlocked: { email: true },
  } });
  await assert.rejects(begin("PASSWORD_RESET"), e => e.statusCode === 409);
  assert.equal(messages.length, 0);
});
test("inactive customers cannot be recovered or silently activated", async () => {
  await User.updateOne({ _id: customer._id }, { $set: { status: "SUSPENDED" } });
  await assert.rejects(begin("PASSWORD_RESET"), e => e.statusCode === 409);
  assert.equal((await raw()).status, "SUSPENDED");
});
test("ordinary unlock never clears fraud/compliance/account restrictions", async () => {
  await assert.rejects(begin("UNLOCK"), e => e.statusCode === 409);
  assert.equal((await raw()).status, "ACTIVE");
});
test("missing delivery configuration and failed delivery do not authorize recovery", async () => {
  delete process.env.RESEND_API_KEY;
  await assert.rejects(begin("PASSWORD_RESET"), e => e.statusCode === 503);
  process.env.RESEND_API_KEY = "disposable-mocked-delivery";
  S.hooks.sendEmail = async () => ({ success: false });
  await assert.rejects(begin("PASSWORD_RESET"), e => e.statusCode === 503);
  assert.equal((await raw()).accountRecoveryState.status, "DELIVERY_FAILED");
  assert.equal((await raw()).password, passwordHash);
});
test("expired challenge is rejected", async () => {
  const challenge = await begin("PASSWORD_RESET");
  await User.updateOne({ _id: customer._id }, { $set: { "accountRecoveryState.expiresAt": Date.now() - 1 } });
  await assert.rejects(verify(challenge), e => e.statusCode === 409);
});
test("five incorrect OTP attempts lock only the recovery challenge", async () => {
  const challenge = await begin("PASSWORD_RESET");
  for (let n = 0; n < 5; n++) await assert.rejects(verify(challenge, "000000"), e => e.code === "OTP_INCORRECT");
  await assert.rejects(verify(challenge), e => e.statusCode === 409);
  const row = await raw();
  assert.equal(row.accountRecoveryState.status, "LOCKED");
  assert.equal(row.status, "ACTIVE");
  assert.equal(row.password, passwordHash);
});
test("contact change invalidates the identity-bound challenge", async () => {
  const challenge = await begin("PASSWORD_RESET");
  await User.updateOne({ _id: customer._id }, { $set: { email: "different@example.invalid" } });
  await assert.rejects(verify(challenge), e => e.statusCode === 409);
});
test("another administrator cannot consume a customer verification challenge", async () => {
  const challenge = await begin("PASSWORD_RESET");
  const other = { ...actor, _id: new mongoose.Types.ObjectId() };
  await User.collection.insertOne({ ...other, phone: "08000000003", email: "other@example.invalid",
    fullName: "Another Admin", password: await bcrypt.hash(adminPassword, 10) });
  await assert.rejects(S.verify(customer._id, other, {
    challengeId: challenge.challengeId, otp: otpFrom(), currentPassword: adminPassword,
  }), e => e.statusCode === 409);
});
test("one administrator completes verification without any second-person approval", async () => {
  const challenge = await begin("PASSWORD_RESET");
  await verify(challenge);
  const row = await raw();
  assert.equal(row.accountRecoveryState.status, "READY");
  assert.equal(linkToken().length, 64);
  assert.equal(row.accountRecoveryState.tokenHash, R.hash(linkToken()));
  assert.doesNotMatch(JSON.stringify(row), new RegExp(linkToken()));
});
test("OTP and link issuance are single-use under concurrent verification", async () => {
  const challenge = await begin("PASSWORD_RESET");
  const outcomes = await Promise.allSettled([verify(challenge), verify(challenge)]);
  assert.equal(outcomes.filter(x => x.status === "fulfilled").length, 1);
  assert.equal(messages.filter(x => x.subject.includes("Complete your")).length, 1);
});
test("customer sets password and previous sessions/refresh/reset tokens are revoked atomically", async () => {
  const token = await authorize("PASSWORD_RESET");
  const oldAccess = tokenFor(customer);
  const nextPassword = "New-Customer-Password-82!";
  await S.complete({ token, action: "PASSWORD_RESET", newPassword: nextPassword, confirmPassword: nextPassword });
  const row = await raw();
  assert.equal(await bcrypt.compare(nextPassword, row.password), true);
  assert.equal(row.authTokenVersion, 1);
  assert.equal(row.customerRefreshSessions, undefined);
  assert.equal(row.passwordResetToken, undefined);
  assert.equal(row.accountRecoveryState.status, "COMPLETED");
  assert.equal((await request("/api/spending-fixture", null, oldAccess)).status, 401);
});
test("concurrent completion cannot use the same recovery link twice", async () => {
  const token = await authorize("PASSWORD_RESET");
  const payload = { token, action: "PASSWORD_RESET", newPassword: "New-Password-28!", confirmPassword: "New-Password-28!" };
  const results = await Promise.allSettled([S.complete(payload), S.complete(payload)]);
  assert.equal(results.filter(x => x.status === "fulfilled").length, 1);
  assert.equal((await raw()).authTokenVersion, 1);
});
test("expired and action-mismatched completion links cannot change credentials", async () => {
  const token = await authorize("PASSWORD_RESET");
  await assert.rejects(S.complete({ token, action: "PIN_RECOVERY", newPin: "6381", confirmPin: "6381" }));
  await User.updateOne({ _id: customer._id }, { $set: { "accountRecoveryState.expiresAt": Date.now() - 1 } });
  await assert.rejects(S.complete({ token, action: "PASSWORD_RESET", newPassword: "New-Password-28!", confirmPassword: "New-Password-28!" }));
  assert.equal((await raw()).password, passwordHash);
});
test("PIN recovery requires customer password in addition to ownership OTP", async () => {
  const token = await authorize("PIN_RECOVERY");
  await assert.rejects(S.complete({ token, action: "PIN_RECOVERY",
    newPin: "6381", confirmPin: "6381", currentPassword: "wrong" }), e => e.statusCode === 401);
  assert.equal((await raw()).transactionPin, undefined);
  await S.complete({ token, action: "PIN_RECOVERY",
    newPin: "6381", confirmPin: "6381", currentPassword: customerPassword });
  const row = await raw();
  assert.equal(await bcrypt.compare("6381", row.transactionPin), true);
  assert.equal(row.authTokenVersion, 1);
});
test("PIN recovery temporarily fences authenticated spending and legacy reset paths", async () => {
  await authorize("PIN_RECOVERY");
  const result = await request("/api/spending-fixture", null, tokenFor(customer));
  assert.equal(result.status, 403);
  assert.equal(result.body.code, "PIN_RECOVERY_IN_PROGRESS");
  await User.updateOne({ _id: customer._id }, { $set: { "accountRecoveryState.expiresAt": Date.now() - 1 } });
  assert.equal((await request("/api/spending-fixture", null, tokenFor(customer))).status, 200);
});
test("mandatory password change revokes existing sessions without revealing a password", async () => {
  const challenge = await begin("FORCE_PASSWORD_CHANGE");
  await verify(challenge);
  const row = await raw();
  assert.equal(row.mustChangePassword, true);
  assert.equal(row.password, passwordHash);
  assert.equal(row.authTokenVersion, 1);
  const result = await request("/api/spending-fixture", null, tokenFor(row));
  assert.equal(result.body.code, "PASSWORD_CHANGE_REQUIRED");
  await S.complete({ token: linkToken(), action: "PASSWORD_RESET",
    newPassword: "Forced-Customer-Password-39!", confirmPassword: "Forced-Customer-Password-39!" });
  assert.equal((await raw()).mustChangePassword, false);
});
test("audit records contain keyed chain evidence and no credentials", async () => {
  const token = await authorize("PASSWORD_RESET");
  await S.complete({ token, action: "PASSWORD_RESET", newPassword: "New-Password-28!", confirmPassword: "New-Password-28!" });
  const events = await Audit.find({ action: "ACCOUNT_RECOVERY_EVENT" }).sort({ "metadata.sequence": 1 }).lean();
  assert.ok(events.length >= 6);
  let previous = "";
  for (const event of events) {
    const metadata = { ...event.metadata };
    const digest = metadata.digest;
    delete metadata.digest;
    assert.equal(metadata.previous, previous);
    assert.equal(digest, R.mac(JSON.stringify({ customerId: String(customer._id),
      actorId: String(event.actorId), actorRole: event.actorRole, reason: event.reason, metadata })));
    previous = digest;
  }
  assert.equal((await User.findById(customer._id).select("+recoveryAuditHead")).recoveryAuditHead, previous);
  assert.doesNotMatch(JSON.stringify(events), new RegExp(`${token}|${adminPassword}|${customerPassword}|otpHash|tokenHash`));
});
test("audit failure rolls back the security transition", async () => {
  const before = await raw();
  await assert.rejects(S.transition(customer._id, { _id: null, role: "HEAD_OFFICE" },
    "TEST", reason, async user => { user.mustChangePassword = true; return {}; }));
  assert.equal((await raw()).mustChangePassword, before.mustChangePassword);
});
test("recovery history requires its own permission", async () => {
  await begin("PASSWORD_RESET");
  const result = await S.snapshot(customer._id, [R.PERMISSIONS.VIEW]);
  assert.deepEqual(result.history, []);
});
test("wallet, virtual account and historical identity remain unchanged", async () => {
  const before = await raw();
  const token = await authorize("PIN_RECOVERY");
  await S.complete({ token, action: "PIN_RECOVERY", currentPassword: customerPassword, newPin: "6381", confirmPin: "6381" });
  const after = await raw();
  for (const field of ["walletBalance", "virtualAccount", "fullName", "email", "phone", "role", "status"]) {
    assert.deepEqual(after[field], before[field], field);
  }
});
test("existing self-service reset token is consumed once under concurrency", async () => {
  const token = crypto.randomBytes(32).toString("hex");
  await User.updateOne({ _id: customer._id }, { $set: {
    passwordResetToken: R.hash(token), passwordResetExpires: new Date(Date.now() + R.TTL),
    mustChangePassword: true,
  } });
  const payload = { token, newPassword: "Legacy-Reset-Only-32!", confirmPassword: "Legacy-Reset-Only-32!" };
  const results = await Promise.all([legacyResetRequest(payload), legacyResetRequest(payload)]);
  assert.equal(results.filter(x => x.statusCode === 200).length, 1);
  const row = await raw();
  assert.equal(row.authTokenVersion, 1);
  assert.equal(row.customerRefreshSessions, undefined);
  assert.equal(row.mustChangePassword, false);
  assert.deepEqual(row.virtualAccount, customer.virtualAccount);
});
test("existing self-service expired token cannot change credentials", async () => {
  const token = crypto.randomBytes(32).toString("hex");
  await User.updateOne({ _id: customer._id }, { $set: {
    passwordResetToken: R.hash(token), passwordResetExpires: new Date(Date.now() - 1),
  } });
  const result = await legacyResetRequest({ token, newPassword: "Legacy-Reset-Only-32!", confirmPassword: "Legacy-Reset-Only-32!" });
  assert.equal(result.statusCode, 400);
  assert.equal((await raw()).password, passwordHash);
});
test("recovery audit integrity detects raw database tampering", async () => {
  await begin("PASSWORD_RESET");
  assert.equal((await S.snapshot(customer._id, allPermissions)).auditIntegrity, "VERIFIED_RECENT_CHAIN");
  // Test-only adversarial write in a disposable replica, not an application API.
  await Audit.collection.updateOne({ targetUserId: customer._id }, { $set: { reason: "Altered test evidence" } });
  assert.equal((await S.snapshot(customer._id, allPermissions)).auditIntegrity, "CHECK_FAILED");
});
test("in-app security notification failure rolls back credential completion", async () => {
  const token = await authorize("PASSWORD_RESET");
  S.hooks.createInAppNotification = async () => null;
  await assert.rejects(S.complete({ token, action: "PASSWORD_RESET",
    newPassword: "Notify-Failure-Password-84!", confirmPassword: "Notify-Failure-Password-84!" }),
    e => e.statusCode === 503);
  const row = await raw();
  assert.equal(row.password, passwordHash);
  assert.equal(row.authTokenVersion, 0);
  assert.equal(row.accountRecoveryState.status, "READY");
});
test("completion email failure is audited without misreporting committed recovery", async () => {
  const token = await authorize("PASSWORD_RESET");
  S.hooks.sendEmail = async () => ({ success: false });
  const result = await S.complete({ token, action: "PASSWORD_RESET",
    newPassword: "Notify-Failure-Password-84!", confirmPassword: "Notify-Failure-Password-84!" });
  assert.equal(result.notificationPending, true);
  assert.equal((await raw()).accountRecoveryState.emailNotificationStatus, "FAILED");
  assert.equal((await raw()).accountRecoveryState.status, "COMPLETED");
});
