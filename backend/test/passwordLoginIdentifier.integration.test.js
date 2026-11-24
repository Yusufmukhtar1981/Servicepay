"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
assert.equal(Boolean(process.env.MONGODB_URI), false, "Remove ambient production database credentials.");
const mongoose = require("mongoose"), express = require("express"), jwt = require("jsonwebtoken");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const User = require("../models/user.model");
const Login = require("../models/loginSecurityEvent.model");
const Restriction = require("../models/accountRestriction.model");
const Role = require("../models/role.model");
const { passwordLoginIdentifier } = require("../services/passwordLoginIdentifier.service");
const routes = require("../routes/auth.routes");
const { protect } = require("../middleware/auth.middleware");
const password = "Synthetic-Password-317!";
let mongo, server, base, sequence = 0;
async function customer(extra = {}) {
  const n = ++sequence;
  return User.create({ fullName: "Synthetic Login Customer", email: `login-${n}@fixture.invalid`,
    phone: `080${String(n).padStart(8, "0")}`, password, role: "CUSTOMER", status: "ACTIVE",
    walletBalance: 1234.56, commissionBalance: 32, authTokenVersion: 3, ...extra });
}
async function login(body) {
  const r = await fetch(base + "/api/auth/login", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}
before(async () => {
  process.env.JWT_SECRET = "synthetic-local-login-test-key-not-production";
  process.env.SERVICEPAY_CUSTOMER_EMAIL_SIGNIN_OTP = "false";
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 }, instanceOpts: [{ args: ["--nounixsocket"] }] });
  assert.match(mongo.getUri(), /^mongodb:\/\/127\.0\.0\.1:/);
  await mongoose.connect(mongo.getUri("synthetic_password_login"));
  await Promise.all([User.init(), Login.init(), Restriction.init(), Role.init()]);
  const app = express(); app.use(express.json()); app.use("/api/auth", routes);
  app.get("/protected", protect, (req, res) => res.json({ role: req.user.role, id: String(req.user._id) }));
  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await mongoose.disconnect(); if (mongo) await mongo.stop();
});
test("identifier normalization is exact, bounded and rejects malformed/query inputs", () => {
  for (const value of ["08012345678", "2348012345678", "+2348012345678", " +234 (801) 234-5678 "]) {
    const p = passwordLoginIdentifier(value);
    assert.equal(p.auditIdentifier, "08012345678");
    assert.deepEqual(p.filter.phone.$in, ["08012345678", "2348012345678", "+2348012345678"]);
  }
  assert.deepEqual(passwordLoginIdentifier(" Test@Example.com ").filter, { email: "test@example.com" });
  for (const v of [null, {}, { $ne: null }, ["08012345678"], "", "8012345678", "080123", "+12348012345678", "0".repeat(255)])
    assert.equal(passwordLoginIdentifier(v), null);
});
test("email and all phone formats use the same existing password, JWT identity and account", async () => {
  const u = await customer(), beforeHash = (await User.findById(u._id).select("+password")).password;
  const local = u.phone, international = `234${local.slice(1)}`, count = await User.countDocuments();
  for (const body of [
    { email: ` ${u.email.toUpperCase()} ` }, { identifier: u.email },
    { identifier: local }, { identifier: international }, { phone: `+${international}` },
    { identifier: `+234 (${local.slice(1, 4)}) ${local.slice(4, 7)}-${local.slice(7)}` },
  ]) {
    const r = await login({ ...body, password }); assert.equal(r.status, 200);
    assert.equal(String(r.body.user._id), String(u._id)); assert.equal(r.body.challenge, undefined);
    assert.equal(r.body.user.password, undefined);
    const claims = jwt.verify(r.body.token, process.env.JWT_SECRET);
    assert.equal(String(claims.id), String(u._id)); assert.equal(claims.authTokenVersion, 3);
    const p = await fetch(base + "/protected", { headers: { Authorization: `Bearer ${r.body.token}` } });
    assert.equal(p.status, 200); assert.equal((await p.json()).id, String(u._id));
  }
  const saved = await User.findById(u._id).select("+password");
  assert.equal(saved.password, beforeHash); assert.equal(saved.phone, local);
  assert.equal(saved.walletBalance, 1234.56); assert.equal(saved.commissionBalance, 32);
  assert.equal(await User.countDocuments(), count);
});
test("canonical variants also find numbers stored in legacy international forms", async () => {
  for (const prefix of ["234", "+234"]) {
    const n = ++sequence, local = `081${String(n).padStart(8, "0")}`;
    const u = await customer({ phone: prefix + local.slice(1) });
    for (const identifier of [local, "234" + local.slice(1), "+234" + local.slice(1)]) {
      const r = await login({ identifier, password });
      assert.equal(r.status, 200); assert.equal(String(r.body.user._id), String(u._id));
    }
  }
});
test("registration cannot create another account for an existing international phone variant", async () => {
  for (const prefix of ["234", "+234"]) {
    const n = ++sequence, local = `090${String(n).padStart(8, "0")}`;
    await customer({ phone: prefix + local.slice(1) });
    const count = await User.countDocuments();
    const r = await fetch(base + "/api/auth/register", { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName: "Synthetic Duplicate", phone: local,
        email: `unused-${n}@fixture.invalid`, password, acceptTerms: true }) });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).message, "An account already exists with this phone number or email.");
    assert.equal(await User.countDocuments(), count);
  }
});
test("ambiguous equivalent numbers fail closed, even when only one password matches", async () => {
  const a = await customer(), b = await customer({ phone: "234" + a.phone.slice(1), password: "Different-Password-317!" });
  const count = await User.countDocuments();
  for (const identifier of [a.phone, b.phone, "+" + b.phone]) {
    const r = await login({ identifier, password });
    assert.equal(r.status, 401); assert.equal(r.body.token, undefined);
    assert.equal(r.body.message, "Incorrect email, phone number or password.");
  }
  assert.equal(await User.countDocuments(), count);
});
test("invalid credentials and malformed identifiers never yield a token or create an account", async () => {
  const u = await customer(), count = await User.countDocuments();
  for (const body of [
    { identifier: u.phone, password: "Wrong-Password-317!" },
    { email: u.email, password: "Wrong-Password-317!" },
    { identifier: "09099998888", password }, { identifier: "unknown@fixture.invalid", password },
    { identifier: "8012345678", password }, { identifier: "not an email", password },
  ]) {
    const r = await login(body); assert.equal(r.status, 401); assert.equal(r.body.token, undefined);
    assert.equal(r.body.message, "Incorrect email, phone number or password.");
  }
  for (const body of [{}, { identifier: { $ne: null }, password }, { identifier: u.phone, password: {} }]) {
    assert.equal((await login(body)).status, 400);
  }
  assert.equal(await User.countDocuments(), count);
  assert.ok(await Login.exists({ user: u._id, identifier: u.phone, outcome: "FAILED" }));
});
test("pending, inactive and security-restricted accounts cannot use phone login to bypass protections", async () => {
  for (const extra of [{ status: "SUSPENDED" }, { activationPending: true }, { status: "BLOCKED" }]) {
    const u = await customer(extra), r = await login({ identifier: "234" + u.phone.slice(1), password });
    assert.equal(r.status, 403); assert.equal(r.body.token, undefined);
  }
  const u = await customer();
  await Restriction.collection.insertOne({ user: u._id, status: "ACTIVE", type: "BLOCK_LOGIN", expiresAt: null });
  const r = await login({ identifier: u.phone, password });
  assert.equal(r.status, 403); assert.equal(r.body.token, undefined);
});
test("Head Office and assigned staff retain email login and temporary-password flags", async () => {
  const role = await Role.create({ name: "LOGIN_FIXTURE_SUPPORT", displayName: "Fixture support",
    department: "CUSTOMER_SUPPORT", status: "ACTIVE", permissions: [], scopeType: "SELF" });
  for (const extra of [{ role: "HEAD_OFFICE" },
    { role: "STAFF", isStaff: true, staffRoleId: role._id, mustChangePassword: true }]) {
    const u = await customer(extra), r = await login({ email: u.email, password });
    assert.equal(r.status, 200); assert.equal(r.body.user.role, extra.role);
    assert.equal((await User.findById(u._id)).mustChangePassword, extra.mustChangePassword || false);
  }
});
