"use strict";
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto"), mongoose = require("mongoose"), bcrypt = require("bcryptjs");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
mongoose.set("autoIndex", false); mongoose.set("autoCreate", false);
const User = require("../models/user.model"), mail = require("../services/email.service");
const controller = require("../controllers/auth.controller");
const limiter = require("../middleware/passwordRecoveryRateLimit.middleware");
const originalSend = mail.sendEmail, originalEnabled = mail.emailEnabled;
let replica, customer, messages, dispatch;
const address = "controlled-reset@example.invalid";
const originalPassword = "Previous-Local-Password7!";
const nextPassword = "Updated-Local-Password8!";
const hash = text => crypto.createHash("sha256").update(text).digest("hex");
const stored = () => User.collection.findOne({ _id: customer._id });
const reply = () => ({
  code: 200, body: null, headers: {},
  status(code) { this.code = code; return this; },
  json(body) { this.body = body; return this; },
  set(name, value) { this.headers[name] = value; return this; },
});
const request = async email => {
  const res = reply(); await controller.forgotPassword({ body: { email } }, res); return res;
};
const rawToken = message => /token=([a-f0-9]{64})/.exec(message.text)?.[1];
const reset = async (token, password = nextPassword) => {
  const res = reply();
  await controller.resetPassword({ body: { token, newPassword: password, confirmPassword: password } }, res);
  return res;
};
before(async () => {
  assert(!["MONGODB_URI", "MONGO_URI", "MONGO_URL", "DATABASE_URL"].some(key => process.env[key]),
    "Refuse ambient production database credentials.");
  process.env.JWT_SECRET = "local-password-recovery-test-only";
  process.env.FRONTEND_URL = "https://customer.example.invalid";
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  assert.match(replica.getUri(), /^mongodb:\/\/127\.0\.0\.1:/);
  await mongoose.connect(replica.getUri(), { dbName: "forgot_password_disposable", autoIndex: false, autoCreate: false });
  await User.createCollection();
  mail.emailEnabled = () => true;
  mail.sendEmail = async payload => { messages.push(payload); return dispatch(payload); };
});
after(async () => {
  mail.sendEmail = originalSend; mail.emailEnabled = originalEnabled;
  await mongoose.disconnect(); await replica?.stop();
});
beforeEach(async () => {
  await User.collection.deleteMany({});
  limiter._resetForTests(); messages = [];
  dispatch = async () => ({ success: true, messageId: "11111111-1111-4111-8111-111111111111" });
  mail.emailEnabled = () => true;
  customer = { _id: new mongoose.Types.ObjectId(), fullName: "<Guest>", email: address,
    phone: "08000009999", role: "CUSTOMER", status: "ACTIVE",
    password: await bcrypt.hash(originalPassword, 12), authTokenVersion: 4, walletBalance: 12500,
    referralCode: "PRESERVED", kyc: { status: "VERIFIED" },
    customerRefreshSessions: [{ id: "local-session", tokenHash: "local-hash" }] };
  await User.collection.insertOne(customer);
});
test("request calls existing mail provider; only a hashed 15-minute token is saved and unrelated legacy data is intact", async () => {
  const before = await stored(), start = Date.now(), result = await request("  CONTROLLED-RESET@example.invalid ");
  assert.equal(result.code, 200); assert.equal(result.body.success, true);
  assert(!result.body.message.includes("has been sent")); assert.equal(messages.length, 1);
  const message = messages[0], token = rawToken(message), after = await stored();
  assert.equal(message.to, address); assert.equal(message.sensitive, true); assert.match(token, /^[a-f0-9]{64}$/);
  assert(message.text.includes("https://customer.example.invalid/?reset-password=true"));
  assert(message.html.includes("&lt;Guest&gt;")); assert(!message.html.includes("Hello <Guest>"));
  assert.equal(after.passwordResetToken, hash(token)); assert.notEqual(after.passwordResetToken, token);
  assert(+after.passwordResetExpires >= start + 899000 && +after.passwordResetExpires <= Date.now() + 900000);
  const protectedAfter = { ...after }; delete protectedAfter.passwordResetToken; delete protectedAfter.passwordResetExpires;
  assert.deepEqual(protectedAfter, before); assert(!JSON.stringify(result.body).includes(token));
});
test("unregistered and blocked contacts return exactly the same response without issuing email", async () => {
  const missing = await request("absent@example.invalid");
  await User.collection.updateOne({ _id: customer._id }, { $set: { "profileRecoveryBlocked.email": true } });
  const blocked = await request(address);
  assert.deepEqual(blocked.body, missing.body); assert.equal(blocked.code, missing.code);
  assert.equal(messages.length, 0); assert.equal((await stored()).passwordResetToken, undefined);
});
test("missing global mail configuration returns the same useful outage response for registered and absent addresses", async () => {
  mail.emailEnabled = () => false;
  const registered = await request(address), absent = await request("absent@example.invalid");
  assert.equal(registered.code, 503); assert.deepEqual(registered.body, absent.body);
  assert.equal(messages.length, 0); assert.equal((await stored()).passwordResetToken, undefined);
});
test("provider failure objects cannot be mistaken for accepted email; token is conditionally cleared without other changes", async () => {
  const before = await stored(); dispatch = async () => ({ success: false, error: "PRIVATE-TOKEN-AND-PROVIDER-DETAIL" });
  const known = await request(address), absent = await request("absent@example.invalid");
  assert.equal(messages.length, 1); assert.deepEqual(known.body, absent.body);
  assert.deepEqual(await stored(), before);
});
test("provider exceptions and missing provider acknowledgement fail closed", async () => {
  for (const behavior of [async () => { throw Error("PRIVATE-TRANSPORT-DETAIL"); },
    async () => ({ success: true })]) {
    dispatch = behavior; await request(address);
    assert.equal((await stored()).passwordResetToken, undefined);
  }
});
test("one-minute cooldown preserves the original usable link and prevents duplicate sends", async () => {
  await request(address); const before = await stored();
  await request(address); assert.equal(messages.length, 1); assert.deepEqual(await stored(), before);
});
test("concurrent reset requests admit exactly one email send", async () => {
  await Promise.all(Array.from({ length: 12 }, () => request(address)));
  assert.equal(messages.length, 1); assert.equal((await stored()).passwordResetToken, hash(rawToken(messages[0])));
});
test("failed older dispatch cannot clear a newer reset token", async () => {
  dispatch = async () => {
    await User.collection.updateOne({ _id: customer._id }, {
      $set: { passwordResetToken: hash("newer"), passwordResetExpires: new Date(Date.now() + 900000) },
    });
    return { success: false };
  };
  await request(address); assert.equal((await stored()).passwordResetToken, hash("newer"));
});
test("successful reset changes only credential/session fields, revokes sessions and consumes the link", async () => {
  await request(address); const token = rawToken(messages[0]), before = await stored();
  const result = await reset(token), after = await stored();
  assert.equal(result.code, 200); assert.equal(result.body.success, true);
  assert(await bcrypt.compare(nextPassword, after.password)); assert(!(await bcrypt.compare(originalPassword, after.password)));
  assert.equal(after.authTokenVersion, 5); assert.equal(after.passwordResetToken, undefined);
  assert.equal(after.passwordResetExpires, undefined); assert.equal(after.customerRefreshSessions, undefined);
  for (const key of ["walletBalance", "referralCode", "kyc", "virtualAccount", "email", "phone", "role", "status"]) {
    assert.deepEqual(after[key], before[key]);
  }
  assert.equal((await reset(token, "Another-Local-Password9!")).code, 400);
});
test("invalid and expired links cannot change the password", async () => {
  assert.equal((await reset("invalid-token")).code, 400);
  await User.collection.updateOne({ _id: customer._id }, {
    $set: { passwordResetToken: hash("expired"), passwordResetExpires: new Date(Date.now() - 1000) },
  });
  assert.equal((await reset("expired")).code, 400);
  assert(await bcrypt.compare(originalPassword, (await stored()).password));
});
test("simultaneous uses of a valid token can reset the password only once", async () => {
  await request(address); const token = rawToken(messages[0]);
  const results = await Promise.all([reset(token), reset(token, "Other-Local-Password9!")]);
  assert.deepEqual(results.map(r => r.code).sort(), [200, 400]);
  assert.equal((await stored()).authTokenVersion, 5);
});
test("uniform rate limiting precedes account lookup, is case insensitive and has a retry header", () => {
  let admitted = 0;
  const req = { ip: "192.0.2.44", body: { email: "ABSENT@example.invalid" } };
  for (let i = 0; i < 3; i++) limiter.passwordRecoveryRateLimit(req, reply(), () => admitted++);
  req.body.email = "absent@example.invalid"; const blocked = reply();
  limiter.passwordRecoveryRateLimit(req, blocked, () => admitted++);
  assert.equal(admitted, 3); assert.equal(blocked.code, 429); assert(+blocked.headers["Retry-After"] > 0);
});
test("IP request cap applies even when addresses vary", () => {
  let admitted = 0, blocked;
  for (let i = 0; i < 11; i++) {
    blocked = reply();
    limiter.passwordRecoveryRateLimit({ ip: "192.0.2.45", body: { email: `absent${i}@example.invalid` } },
      blocked, () => admitted++);
  }
  assert.equal(admitted, 10); assert.equal(blocked.code, 429);
});
test("sensitive Resend diagnostics never expose recipient, reset token or provider payload", async () => {
  const vm = require("node:vm"), fs = require("node:fs");
  const source = fs.readFileSync(require.resolve("../services/email.service"), "utf8");
  let behavior, logs = [];
  const sandbox = {
    module: { exports: {} }, process: { env: { RESEND_API_KEY: "local-only" } },
    console: { log: (...v) => logs.push(v), error: (...v) => logs.push(v) },
    require: name => name === "resend" ? { Resend: class {
      emails = { send: (...args) => behavior(...args) };
    } } : {},
  };
  vm.runInNewContext(source, sandbox);
  const service = sandbox.module.exports;
  const payload = { to: "PRIVATE-RECIPIENT", html: "PRIVATE-RESET-TOKEN", subject: "Local reset", sensitive: true };
  behavior = async () => ({ error: { name: "validation_error", message: "PRIVATE-REJECTION-DETAIL" } });
  const failure = await service.sendEmail(payload);
  assert.equal(failure.success, false); assert.equal(failure.reason, "PROVIDER_VALIDATION_FAILED");
  behavior = async () => { throw Error("PRIVATE-TRANSPORT-PAYLOAD"); };
  assert.equal((await service.sendEmail(payload)).success, false);
  behavior = async () => ({ data: { id: "11111111-1111-4111-8111-111111111111" } });
  assert.equal((await service.sendEmail(payload)).success, true);
  assert(JSON.stringify(logs).includes("password_reset.email.accepted"));
  assert(!JSON.stringify({ failure, logs }).includes("PRIVATE-"));
  behavior = async () => ({ data: {} });
  assert.equal((await service.sendEmail(payload)).success, false);
  // Preserve legacy ordinary notification acknowledgement behavior.
  assert.equal((await service.sendEmail({ ...payload, sensitive: false })).success, true);
});
