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
const Phone = require("../services/accountRecoveryPhone.service");
const Sms = require("../services/accountRecoverySms.service");
const VerifyFlow = require("../services/accountRecoveryVerify.service");
const VerifyProvider = require("../services/twilioVerify.service");
const Admission = require("../services/accountRecoveryAdmission.service");
const Rate = require("../models/privacyRequestRateLimit.model");
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
let smsMessages = [];
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
  await Promise.all([User, Role, Audit, Login, Notification, Rate].map(m => m.createCollection()));
  await Rate.createIndexes();
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
  await Promise.all([User, Role, Audit, Login, Notification, Rate].map(m => m.collection.deleteMany({})));
  delete process.env.SERVICEPAY_VERIFY_SMS_DAILY_LIMIT;
  delete process.env.SERVICEPAY_TWILIO_VERIFY_ENABLED;
  delete process.env.SERVICEPAY_TWILIO_VERIFY_DELIVERY_VERIFIED;
  VerifyFlow.hooks.reserveSend = Admission.reserveSend;
  messages = [];
  smsMessages = [];
  VerifyFlow.hooks.ready = () => false;
  VerifyFlow.hooks.start = VerifyProvider.start;
  VerifyFlow.hooks.check = VerifyProvider.check;
  Phone.hooks.configured = () => true;
  Phone.hooks.sendSms = async input => { smsMessages.push(input); return { success: true, status: "ACCEPTED" }; };
  S.hooks.sendRecoverySms = async input => { smsMessages.push(input); return { success: true, status: "ACCEPTED" }; };
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

const enablePhoneFixture = async () => User.collection.updateOne({ _id: customer._id },
  { $set: { phoneVerified: true, emailVerified: false } });
const beginPhone = async () => {
  await enablePhoneFixture();
  return request(`/api/admin/account-recovery/${customer._id}/challenge`, {
    action: "PASSWORD_RESET", channel: "PHONE", reason, currentPassword: adminPassword,
  });
};
const phoneOtp = () => smsMessages[0].message.match(/code: (\d{6})/)[1];
const verifyPhone = (challenge, otp = phoneOtp()) =>
  request("/api/account-recovery/phone/verify", { challengeId: challenge, otp }, "", "POST");

const managed = () => {
  VerifyFlow.hooks.ready = () => true;
  VerifyFlow.hooks.start = async () => ({ success: true, status: "ACCEPTED",
    verificationSid: "VE" + "a".repeat(32), createdAt: Date.now(),
    serviceFingerprint: R.hash("disposable-service") });
  VerifyFlow.hooks.check = async () => ({ success: true, status: "APPROVED" });
};
const beginManaged = async (action = "PASSWORD_RESET") => {
  managed(); await enablePhoneFixture();
  return request(`/api/admin/account-recovery/${customer._id}/challenge`, {
    action, channel: "PHONE", reason, currentPassword: adminPassword,
  });
};
const managedProof = challengeId => Phone.verify({ challengeId, otp: "123456" });

function publicPhoneFixture() {
  process.env.TWILIO_ACCOUNT_SID = "AC" + "1".repeat(32);
  process.env.TWILIO_AUTH_TOKEN = "disposable-test-only";
  process.env.TWILIO_VERIFY_SERVICE_SID = "VA" + "2".repeat(32);
  process.env.SERVICEPAY_TWILIO_VERIFY_ENABLED = "true";
  process.env.SERVICEPAY_TWILIO_VERIFY_DELIVERY_VERIFIED = "true";
  managed();
}
test("public password OTP completes only through provider approval and preserves wallet and account identity", async () => {
  publicPhoneFixture(); await enablePhoneFixture();
  await User.collection.updateOne({ _id: customer._id }, { $set: { authTokenVersion: 5 } });
  const before = await raw();
  const started = await request("/api/account-recovery/phone/challenge",
    { phone: customer.phone, action: "PASSWORD_RESET" }, "", "POST");
  assert.equal(started.status, 200);
  assert(!started.body.token && !started.body.otp);
  assert.equal((await raw()).accountRecoveryState.status, "CHALLENGE_SENT");
  const checked = await verifyPhone(started.body.challengeId, "123456");
  assert.equal(checked.status, 200);
  await S.complete({ action: "PASSWORD_RESET", token: checked.body.token,
    newPassword: "Public-Recovery-Password-73!", confirmPassword: "Public-Recovery-Password-73!" });
  const after = await raw();
  assert.equal(await bcrypt.compare("Public-Recovery-Password-73!", after.password), true);
  assert.equal(after.walletBalance, before.walletBalance);
  assert.equal(after.phone, before.phone);
  assert.equal(after.authTokenVersion, before.authTokenVersion + 1);
  assert.equal(after.accountRecoveryState.status, "COMPLETED");
});
test("public PIN OTP proof cannot replace a PIN without the customer's current password", async () => {
  publicPhoneFixture(); await enablePhoneFixture();
  const started = await request("/api/account-recovery/phone/challenge",
    { phone: customer.phone, action: "PIN_RECOVERY" }, "", "POST");
  const checked = await verifyPhone(started.body.challengeId, "123456");
  const before = await raw();
  await assert.rejects(S.complete({ action: "PIN_RECOVERY", token: checked.body.token, newPin: "5729", confirmPin: "5729" }));
  assert.equal((await raw()).transactionPin, before.transactionPin);
  await S.complete({ action: "PIN_RECOVERY", token: checked.body.token, currentPassword: customerPassword,
    newPin: "5729", confirmPin: "5729" });
  assert.equal(await bcrypt.compare("5729", (await raw()).transactionPin), true);
});
test("unknown and corrected unverified public contacts receive the same response without a provider send", async () => {
  publicPhoneFixture();
  let sends = 0;
  VerifyFlow.hooks.start = async () => { sends++; throw Error("No send expected"); };
  await User.collection.updateOne({ _id: customer._id }, { $set: {
    phoneVerified: false, "profileRecoveryBlocked.phone": true } });
  const first = await request("/api/account-recovery/phone/challenge",
    { phone: customer.phone, action: "PASSWORD_RESET" }, "", "POST");
  const second = await request("/api/account-recovery/phone/challenge",
    { phone: "08000000009", action: "PASSWORD_RESET" }, "", "POST");
  assert.equal(first.status, 200); assert.equal(second.status, 200);
  assert.equal(first.body.message, second.body.message);
  assert.deepEqual(Object.keys(first.body).sort(), Object.keys(second.body).sort());
  assert.equal(sends, 0);
});
test("durable global SMS allowance admits at most the configured count under concurrency", async () => {
  process.env.SERVICEPAY_VERIFY_SMS_DAILY_LIMIT = "2";
  const results = await Promise.allSettled(Array.from({ length: 9 }, () => Admission.reserveSend()));
  assert.equal(results.filter(x => x.status === "fulfilled").length, 2);
  assert.equal(results.filter(x => x.status === "rejected" && x.reason.code === "SMS_LIMIT_REACHED").length, 7);
  assert.equal((await Rate.findOne({ key: "verify-sms:global" }).lean()).count, 2);
});
test("public requests are IP-limited before account lookup without retaining raw addresses", async () => {
  publicPhoneFixture();
  for (let i = 0; i < 5; i++) {
    assert.equal((await request("/api/account-recovery/phone/challenge",
      { phone: "08000000009", action: "PASSWORD_RESET" }, "", "POST")).status, 200);
  }
  assert.equal((await request("/api/account-recovery/phone/challenge",
    { phone: "08000000009", action: "PASSWORD_RESET" }, "", "POST")).status, 429);
  assert(!JSON.stringify(await Rate.find().lean()).includes("127.0.0.1"));
});
test("SMS methods and dispatch fail closed for disabled sending and invalid daily limits", async () => {
  assert.equal((await request("/api/account-recovery/methods", undefined, "")).body.smsAvailable, false);
  assert.equal((await request("/api/account-recovery/phone/challenge",
    { phone: customer.phone, action: "PASSWORD_RESET" }, "", "POST")).status, 503);
  process.env.SERVICEPAY_VERIFY_SMS_DAILY_LIMIT = "not-a-limit";
  assert.equal(await Admission.ready(), false);
  await assert.rejects(Admission.reserveSend(), { code: "SMS_ADMISSION_UNAVAILABLE" });
});

test("Verify managed challenge returns only the customer entry link; provider approval authorizes its bound action", async () => {
  const started = await beginManaged();
  assert.equal(started.status, 200);
  assert.match(started.body.customerEntryUrl, /^https:\/\/api\.servicepay\.ng\/api\/account-recovery\/page#challenge=/);
  assert(!started.body.token && !started.body.otp && !started.body.verificationSid);
  const state = (await raw()).accountRecoveryState;
  assert.equal(state.provider, "TWILIO_VERIFY"); assert(!state.otpHash);
  const checked = await verifyPhone(started.body.challengeId, "123456");
  assert.equal(checked.status, 200); assert.equal(checked.body.action, "PASSWORD_RESET");
  assert.match(checked.body.token, /^[a-f0-9]{64}$/);
  await assert.rejects(() => managedProof(started.body.challengeId));
  assert.equal((await raw()).password, passwordHash);
});

test("Verify approval does not weaken PIN recovery: customer password and official PIN policy remain mandatory", async () => {
  const before = await raw(), started = await beginManaged("PIN_RECOVERY");
  const proof = await managedProof(started.body.challengeId);
  assert.equal(proof.action, "PIN_RECOVERY");
  const body = { token: proof.token, action: "PIN_RECOVERY", newPin: "6381", confirmPin: "6381",
    currentPassword: "wrong-password" };
  assert.equal((await request("/api/account-recovery/complete", body, "")).status, 401);
  body.currentPassword = customerPassword;
  assert.equal((await request("/api/account-recovery/complete", body, "")).status, 200);
  const current = await raw();
  assert(await bcrypt.compare("6381", current.transactionPin));
  assert.equal(current.password, before.password);
  assert.equal(current.walletBalance, before.walletBalance);
  assert.deepEqual(current.virtualAccount, before.virtualAccount);
  assert.equal(current.authTokenVersion, 1);
});

test("Verify incorrect results consume five durable attempts and never issue a credential", async () => {
  const started = await beginManaged();
  VerifyFlow.hooks.check = async () => ({ success: true, status: "INCORRECT" });
  for (let i = 0; i < 5; i++) await assert.rejects(() => managedProof(started.body.challengeId));
  assert.equal((await raw()).accountRecoveryState.attempts, 5);
  assert.equal((await raw()).accountRecoveryState.status, "LOCKED");
  VerifyFlow.hooks.check = async () => { throw Error("must not retry provider"); };
  await assert.rejects(() => managedProof(started.body.challengeId));
});

test("Verify uncertain checks stay blocked and never automatically repeat or become success on 404", async () => {
  const started = await beginManaged(); let calls = 0;
  VerifyFlow.hooks.check = async () => { calls++; return { success: false, status: "UNCONFIRMED" }; };
  await assert.rejects(() => managedProof(started.body.challengeId));
  await assert.rejects(() => managedProof(started.body.challengeId));
  assert.equal(calls, 1);
  assert.equal((await raw()).accountRecoveryState.status, "CHECK_UNCONFIRMED");
  assert(!(await raw()).accountRecoveryState.tokenHash);
});

test("Verify concurrent checks make at most one provider call and one authorization", async () => {
  const started = await beginManaged(); let calls = 0;
  VerifyFlow.hooks.check = async () => {
    calls++; await new Promise(r => setTimeout(r, 60)); return { success: true, status: "APPROVED" };
  };
  const results = await Promise.allSettled([managedProof(started.body.challengeId), managedProof(started.body.challengeId)]);
  assert.equal(results.filter(x => x.status === "fulfilled").length, 1);
  assert.equal(calls, 1);
});

test("Verify provider leases survive local expiry and block cross-purpose code reuse", async () => {
  const started = await beginManaged();
  await User.collection.updateOne({ _id: customer._id }, { $set: {
    "accountRecoveryState.expiresAt": Date.now() - 1, "accountRecoveryRate.lastSentAt": Date.now() - 61000,
  } });
  await assert.rejects(() => managedProof(started.body.challengeId));
  const next = await request(`/api/admin/account-recovery/${customer._id}/challenge`, {
    action: "PIN_RECOVERY", channel: "PHONE", reason, currentPassword: adminPassword,
  });
  assert.equal(next.status, 409);
  const email = await request(`/api/admin/account-recovery/${customer._id}/challenge`, {
    action: "PASSWORD_RESET", channel: "EMAIL", reason, currentPassword: adminPassword,
  });
  assert.notEqual(email.status, 200);
});

test("Verify send uncertainty has no reset authority and cannot be resent while its provider lease remains", async () => {
  managed(); await enablePhoneFixture(); let calls = 0;
  VerifyFlow.hooks.start = async () => { calls++; return { success: false, status: "UNCONFIRMED" }; };
  const body = { action: "PASSWORD_RESET", channel: "PHONE", reason, currentPassword: adminPassword };
  assert.equal((await request(`/api/admin/account-recovery/${customer._id}/challenge`, body)).status, 503);
  await User.collection.updateOne({ _id: customer._id }, { $set: { "accountRecoveryRate.lastSentAt": Date.now() - 61000 } });
  assert.equal((await request(`/api/admin/account-recovery/${customer._id}/challenge`, body)).status, 409);
  assert.equal(calls, 1);
});

test("Verify does not renew a stale provider code or accept approval after its contact binding changed", async () => {
  managed(); await enablePhoneFixture();
  VerifyFlow.hooks.start = async () => ({ success: true, verificationSid: "VE" + "a".repeat(32),
    createdAt: Date.now() - 301000, serviceFingerprint: R.hash("disposable-service") });
  const body = { action: "PASSWORD_RESET", channel: "PHONE", reason, currentPassword: adminPassword };
  assert.equal((await request(`/api/admin/account-recovery/${customer._id}/challenge`, body)).status, 503);
  await User.collection.updateOne({ _id: customer._id }, { $unset: { accountRecoveryState: "", accountRecoveryRate: "" } });
  const started = await beginManaged();
  VerifyFlow.hooks.check = async () => {
    await User.collection.updateOne({ _id: customer._id }, { $set: { phoneVerified: false } });
    return { success: true, status: "APPROVED" };
  };
  await assert.rejects(() => managedProof(started.body.challengeId));
  assert(!(await raw()).accountRecoveryState.tokenHash);
});

test("authenticated existing-phone verification requires the customer's password and marks only that unfenced phone verified", async () => {
  managed();
  await User.collection.updateOne({ _id: customer._id }, { $set: { phoneVerified: false } });
  const path = "/api/account-recovery/phone-verification/challenge";
  assert.equal((await request(path, { currentPassword: customerPassword })).status, 403);
  assert.equal((await request(path, { currentPassword: "wrong" }, tokenFor(customer))).status, 401);
  let seenPhone;
  VerifyFlow.hooks.start = async phone => { seenPhone = phone; return { success: true,
    verificationSid: "VE" + "a".repeat(32), createdAt: Date.now(), serviceFingerprint: R.hash("disposable-service") }; };
  const before = await raw();
  const started = await request(path, { currentPassword: customerPassword, phone: "08099999999" }, tokenFor(customer));
  assert.equal(started.status, 200);
  assert.equal(seenPhone, R.normalizePhone(customer.phone));
  const proof = await managedProof(started.body.challengeId);
  assert.equal(proof.action, "PHONE_VERIFICATION"); assert.equal(proof.verified, true); assert(!proof.token);
  const current = await raw();
  assert.equal(current.phoneVerified, true);
  assert.equal(current.password, before.password);
  assert.equal(current.authTokenVersion, 1);
  assert.equal(current.walletBalance, before.walletBalance);
  assert.deepEqual(current.virtualAccount, before.virtualAccount);
  await assert.rejects(() => managedProof(started.body.challengeId));
});

test("authenticated phone verification never trusts an administratively corrected contact or bypasses account restrictions", async () => {
  managed();
  await User.collection.updateOne({ _id: customer._id }, { $set: {
    phoneVerified: false, "profileRecoveryBlocked.phone": true,
  } });
  const path = "/api/account-recovery/phone-verification/challenge";
  assert.equal((await request(path, { currentPassword: customerPassword }, tokenFor(customer))).status, 409);
  assert.notEqual((await raw()).phoneVerified, true);
});

test("Verify transport sends form bodies and binds approval to exact service, account, phone and verification SID", async () => {
  const keys = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_VERIFY_SERVICE_SID",
    "SERVICEPAY_TWILIO_VERIFY_ENABLED", "SERVICEPAY_TWILIO_VERIFY_DELIVERY_VERIFIED", "TWILIO_VERIFY_TEST_PHONE"];
  const old = keys.map(k => process.env[k]), original = VerifyProvider.hooks.fetch;
  const account = "AC" + "a".repeat(32), service = "VA" + "b".repeat(32), verification = "VE" + "c".repeat(32);
  const phone = "+2348000000002"; let called = 0, bad = false;
  try {
    Object.assign(process.env, { TWILIO_ACCOUNT_SID: account, TWILIO_AUTH_TOKEN: "disposable-only",
      TWILIO_VERIFY_SERVICE_SID: service, SERVICEPAY_TWILIO_VERIFY_ENABLED: "false",
      SERVICEPAY_TWILIO_VERIFY_DELIVERY_VERIFIED: "false", TWILIO_VERIFY_TEST_PHONE: "" });
    assert.equal((await VerifyProvider.start(phone)).status, "UNAVAILABLE");
    process.env.SERVICEPAY_TWILIO_VERIFY_ENABLED = "true";
    assert.equal(VerifyProvider.enabled(phone), false);
    process.env.TWILIO_VERIFY_TEST_PHONE = phone;
    assert.equal(VerifyProvider.enabled("+2348000000003"), false);
    VerifyProvider.hooks.fetch = async (url, options) => {
      called++;
      const body = new URLSearchParams(options.body);
      assert(!body.has("CustomCode") && !body.has("From"));
      assert.equal(options.headers["Content-Type"], "application/x-www-form-urlencoded");
      if (url.endsWith("/VerificationCheck")) {
        assert.equal(body.get("VerificationSid"), verification); assert.equal(body.get("Code"), "123456");
      } else { assert.equal(body.get("To"), phone); assert.equal(body.get("RiskCheck"), "enable"); }
      return { ok: true, status: 200, json: async () => ({ sid: bad ? "VE" + "d".repeat(32) : verification,
        service_sid: service, account_sid: account, to: phone, channel: "sms",
        date_created: new Date().toISOString(), status: url.endsWith("/VerificationCheck") ? "approved" : "pending" }) };
    };
    const sent = await VerifyProvider.start(phone);
    assert.equal(sent.success, true);
    const args = { phone, verificationSid: verification, code: "123456", serviceFingerprint: sent.serviceFingerprint };
    assert.equal((await VerifyProvider.check(args)).status, "APPROVED");
    bad = true; assert.equal((await VerifyProvider.check(args)).status, "UNCONFIRMED");
    VerifyProvider.hooks.fetch = async () => ({ ok: false, status: 404, json: async () => ({ code: 20404 }) });
    assert.equal((await VerifyProvider.check(args)).success, false);
    assert.equal(called, 3);
  } finally {
    VerifyProvider.hooks.fetch = original;
    keys.forEach((k, i) => old[i] === undefined ? delete process.env[k] : process.env[k] = old[i]);
  }
});

test("phone OTP is private, keyed, five-minute and only customer verification issues a reset token", async () => {
  const result = await beginPhone();
  assert.equal(result.status, 200);
  assert.equal(result.body.channel, "PHONE");
  assert(!("token" in result.body) && !("otp" in result.body));
  assert(result.body.expiresAt > Date.now() + 290000 && result.body.expiresAt <= Date.now() + 300000);
  const state = (await raw()).accountRecoveryState;
  assert.equal(state.deliveryStatus, "ACCEPTED");
  assert.equal(state.otpHash, R.mac(`phone:${result.body.challengeId}:${phoneOtp()}`));
  assert(!Object.values(state).includes(phoneOtp()));
  const adminAttempt = await request(`/api/admin/account-recovery/${customer._id}/verify`, {
    challengeId: result.body.challengeId, otp: phoneOtp(), currentPassword: adminPassword,
  });
  assert.equal(adminAttempt.status, 409);
  const verified = await verifyPhone(result.body.challengeId);
  assert.equal(verified.status, 200);
  assert.match(verified.body.token, /^[a-f0-9]{64}$/);
  assert.equal((await raw()).accountRecoveryState.tokenHash, R.hash(verified.body.token));
  const replay = await verifyPhone(result.body.challengeId);
  assert.equal(replay.status, 400);
});

test("phone recovery rejects unverified and administratively corrected phones without sending SMS", async () => {
  const input = { action: "PASSWORD_RESET", channel: "PHONE", reason, currentPassword: adminPassword };
  assert.equal((await request(`/api/admin/account-recovery/${customer._id}/challenge`, input)).status, 409);
  await enablePhoneFixture();
  await User.collection.updateOne({ _id: customer._id }, { $set: { "profileRecoveryBlocked.phone": true } });
  assert.equal((await request(`/api/admin/account-recovery/${customer._id}/challenge`, input)).status, 409);
  assert.equal(smsMessages.length, 0);
});

test("phone recovery is unavailable without verified sender readiness and fails closed on delivery error", async () => {
  await enablePhoneFixture();
  Phone.hooks.configured = () => false;
  const input = { action: "PASSWORD_RESET", channel: "PHONE", reason, currentPassword: adminPassword };
  assert.equal((await request(`/api/admin/account-recovery/${customer._id}/challenge`, input)).status, 503);
  assert.equal(smsMessages.length, 0);
  Phone.hooks.configured = () => true;
  Phone.hooks.sendSms = async () => ({ success: false, status: "UNCONFIRMED" });
  assert.equal((await request(`/api/admin/account-recovery/${customer._id}/challenge`, input)).status, 503);
  const state = (await raw()).accountRecoveryState;
  assert.equal(state.status, "DELIVERY_FAILED");
  assert.equal(state.deliveryStatus, "UNCONFIRMED");
});

test("phone OTP has five bounded guesses and no credential change on failure", async () => {
  const started = await beginPhone();
  const wrong = phoneOtp() === "999999" ? "888888" : "999999";
  for (let i = 0; i < 5; i++) assert.equal((await verifyPhone(started.body.challengeId, wrong)).status, 400);
  assert.equal((await raw()).accountRecoveryState.status, "LOCKED");
  assert.equal((await verifyPhone(started.body.challengeId)).status, 400);
  assert.equal((await raw()).password, passwordHash);
});

test("expired phone codes and changed phone ownership cannot authorize recovery", async () => {
  const started = await beginPhone();
  await User.collection.updateOne({ _id: customer._id }, { $set: { "accountRecoveryState.expiresAt": Date.now() - 1 } });
  assert.equal((await verifyPhone(started.body.challengeId)).status, 400);
  await User.collection.updateOne({ _id: customer._id }, { $set: {
    "accountRecoveryState.expiresAt": Date.now() + Phone.OTP_TTL, phone: "08000000003",
  } });
  assert.equal((await verifyPhone(started.body.challengeId)).status, 400);
});

test("phone reset preserves PIN, wallet and virtual account, revokes sessions and is single use", async () => {
  await User.collection.updateOne({ _id: customer._id }, { $set: {
    transactionPin: "unchanged-existing-pin-hash", transactionPinSet: true,
  } });
  const before = await raw();
  const started = await beginPhone();
  const proof = await verifyPhone(started.body.challengeId);
  const payload = { action: "PASSWORD_RESET", token: proof.body.token,
    newPassword: "New-Disposable-Password-32!", confirmPassword: "New-Disposable-Password-32!" };
  const result = await request("/api/account-recovery/complete", payload, "");
  assert.equal(result.status, 200);
  const current = await raw();
  assert(await bcrypt.compare(payload.newPassword, current.password));
  assert.notEqual(current.password, payload.newPassword);
  assert.equal(current.authTokenVersion, 1);
  assert(!current.customerRefreshSessions?.length);
  assert.equal(current.transactionPin, before.transactionPin);
  assert.equal(current.walletBalance, before.walletBalance);
  assert.deepEqual(current.virtualAccount, before.virtualAccount);
  assert.equal(current.accountRecoveryState.smsNotificationStatus, "ACCEPTED");
  assert.equal((await request("/api/account-recovery/complete", payload, "")).status, 400);
  const oldSession = await request("/api/spending-fixture", undefined, tokenFor(customer));
  assert.equal(oldSession.status, 401);
  assert.equal((await S.snapshot(customer._id, allPermissions)).auditIntegrity, "VERIFIED_RECENT_CHAIN");
});

test("phone authorization cannot change a PIN or bypass customer contact changes", async () => {
  const started = await beginPhone();
  const proof = await verifyPhone(started.body.challengeId);
  assert.equal((await request("/api/account-recovery/complete", {
    token: proof.body.token, action: "PIN_RECOVERY", newPin: "6381", confirmPin: "6381",
  }, "")).status, 400);
  await User.collection.updateOne({ _id: customer._id }, { $set: { phoneVerified: false } });
  assert.equal((await request("/api/account-recovery/complete", { token: proof.body.token,
    action: "PASSWORD_RESET", newPassword: "New-Disposable-Password-32!",
    confirmPassword: "New-Disposable-Password-32!" }, "")).status, 400);
});

test("phone challenge enforces cooldown, shared limits and exact Head Office permissions", async () => {
  const started = await beginPhone();
  assert.equal(started.status, 200);
  const body = { action: "PASSWORD_RESET", channel: "PHONE", reason, currentPassword: adminPassword };
  assert.equal((await request(`/api/admin/account-recovery/${customer._id}/challenge`, body)).status, 429);
  await Role.collection.updateOne({ _id: actor.staffRoleId }, { $set: { permissions: [R.PERMISSIONS.VIEW, "*"] } });
  assert.equal((await request(`/api/admin/account-recovery/${customer._id}/challenge`, body)).status, 403);
  await User.collection.updateOne({ _id: actor._id }, { $set: { role: "CUSTOMER_SUPPORT" } });
  assert.equal((await request(`/api/admin/account-recovery/${customer._id}/challenge`, body)).status, 403);
});

test("phone verification concurrent claims yield exactly one customer authorization", async () => {
  const started = await beginPhone();
  const results = await Promise.all([verifyPhone(started.body.challengeId), verifyPhone(started.body.challengeId)]);
  assert.deepEqual(results.map(x => x.status).sort(), [200, 400]);
});

test("identity handoff never marks a contact verified or creates credential authorization", async () => {
  await User.collection.updateOne({ _id: customer._id }, { $set: { emailVerified: false } });
  const before = await raw();
  const result = await request(`/api/admin/account-recovery/${customer._id}/contact-verification`, {
    reason, currentPassword: adminPassword,
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.status, "IDENTITY_VERIFICATION_REQUIRED");
  const current = await raw();
  assert.equal(current.password, before.password);
  assert.equal(current.emailVerified, false);
  assert.notEqual(current.phoneVerified, true);
  assert(!current.accountRecoveryState.tokenHash && !current.accountRecoveryState.otpHash);
  const snapshot = await S.snapshot(customer._id, allPermissions);
  assert.equal(snapshot.contactVerificationRequired, true);
  assert.deepEqual(snapshot.availableRecoveryMethods, []);
  assert.match(snapshot.customer.phoneMasked, /\*/);
});

test("recovery SMS adapter gates delivery, reports acceptance honestly and never retries uncertain sends", async () => {
  const keys = ["ACCOUNT_RECOVERY_PHONE_SMS_VERIFIED", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"];
  const old = keys.map(k => process.env[k]), fetchBefore = global.fetch;
  let calls = 0;
  try {
    process.env.ACCOUNT_RECOVERY_PHONE_SMS_VERIFIED = "false";
    assert.equal((await Sms.send({ phone: "+2348000000002", message: "disposable" })).status, "UNAVAILABLE");
    process.env.ACCOUNT_RECOVERY_PHONE_SMS_VERIFIED = "true";
    process.env.TWILIO_ACCOUNT_SID = "AC" + "a".repeat(32);
    process.env.TWILIO_AUTH_TOKEN = "local-test-only";
    process.env.TWILIO_FROM_NUMBER = "LocalTest";
    global.fetch = async () => { calls++; return { ok: true, json: async () => ({ sid: "SM" + "b".repeat(32), status: "queued" }) }; };
    assert.deepEqual(await Sms.send({ phone: "+2348000000002", message: "disposable" }),
      { success: true, status: "ACCEPTED" });
    global.fetch = async () => { calls++; throw new Error("simulated timeout"); };
    assert.deepEqual(await Sms.send({ phone: "+2348000000002", message: "disposable" }),
      { success: false, status: "UNCONFIRMED" });
    assert.equal(calls, 2);
  } finally {
    global.fetch = fetchBefore;
    keys.forEach((k, i) => old[i] === undefined ? delete process.env[k] : process.env[k] = old[i]);
  }
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
