const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const User = require("../models/user.model");
const Prices = require("../models/dataPriceOverride.model");
const Audit = require("../models/adminAuditLog.model");
const { createCustomerRefreshSession } = require("../services/customerRefreshSession.service");
const { createDataPlanAvailability } = require("../services/dataPlanAvailability.service");
const { protect } = require("../middleware/auth.middleware");
let mongo, user;
const secret = "isolated-refresh-test-not-production";
const catalog = async () => [
  { code: "DATA-TEST-A", name: "1GB 7 days", price: 100 },
  { code: "DATA-TEST-B", name: "2GB 30 days", price: 200 },
];
const change = createDataPlanAvailability({ catalog });
const sessions = createCustomerRefreshSession({ secret: () => secret, restricted: async () => false });
test.before(async () => {
  if (["MONGODB_URI", "MONGO_URI", "MONGO_URL", "DATABASE_URL"].some(k => process.env[k])) {
    throw Error("Tests must not inherit database credentials.");
  }
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await Promise.all([User.init(), Prices.init(), Audit.init()]);
});
test.after(async () => { await mongoose.disconnect(); await mongo?.stop(); });
test.beforeEach(async () => {
  // Only this disposable replica: production audit immutability stays intact.
  await Promise.all([User.deleteMany({}), Prices.deleteMany({}), Audit.collection.deleteMany({})]);
  user = await User.create({
    fullName: "Sandbox Customer", phone: "08060009999",
    email: "refresh-sandbox@example.invalid", password: "Password123!",
    role: "CUSTOMER", status: "ACTIVE",
  });
});
test("refresh tokens are hashed, hidden and rotated; old token cannot replay", async () => {
  const token = await sessions.issue(user);
  const ordinary = await User.findById(user._id).lean();
  assert.equal(ordinary.customerRefreshSessions, undefined);
  const stored = await User.findById(user._id).select("+customerRefreshSessions");
  assert.equal(stored.customerRefreshSessions[0].tokenHash.length, 64);
  assert.ok(!JSON.stringify(stored.customerRefreshSessions).includes(token));
  const result = await sessions.refresh(token);
  assert.notEqual(result.refreshToken, token);
  assert.equal(jwt.verify(result.token, secret).tokenUse, "access");
  assert.equal(jwt.verify(result.token, secret).auth_time, jwt.decode(token).auth_time);
  await assert.rejects(sessions.refresh(token), e => e.statusCode === 401);
});
test("parallel refresh requests rotate at most once", async () => {
  const token = await sessions.issue(user);
  const results = await Promise.allSettled([sessions.refresh(token), sessions.refresh(token)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
});
test("logout revokes a refresh credential without changing the PIN or other sessions", async () => {
  const first = await sessions.issue(user);
  const second = await sessions.issue(user);
  await sessions.revoke(first);
  await assert.rejects(sessions.refresh(first), e => e.statusCode === 401);
  assert.ok((await sessions.refresh(second)).token);
});
test("password revocation and inactive accounts cannot refresh", async () => {
  const token = await sessions.issue(user);
  await User.updateOne({ _id: user._id }, { $inc: { authTokenVersion: 1 } });
  await assert.rejects(sessions.refresh(token), e => e.statusCode === 401);
  await User.updateOne({ _id: user._id }, { $set: { authTokenVersion: 0, status: "SUSPENDED" } });
  await assert.rejects(sessions.refresh(token), e => e.statusCode === 401);
});
test("restricted, forged and expired refresh credentials fail closed", async () => {
  const token = await sessions.issue(user);
  const blocked = createCustomerRefreshSession({ secret: () => secret, restricted: async () => true });
  await assert.rejects(blocked.refresh(token), e => e.statusCode === 401);
  await assert.rejects(sessions.refresh(token + "x"), e => e.statusCode === 401);
  const claims = jwt.decode(token); delete claims.iat; claims.exp = 1;
  const expired = jwt.sign(claims, secret);
  await assert.rejects(sessions.refresh(expired), e => e.statusCode === 401);
});
test("refresh credentials cannot authorize an ordinary protected API", async () => {
  const token = await sessions.issue(user);
  const oldSecret = process.env.JWT_SECRET; process.env.JWT_SECRET = secret;
  let status;
  try {
    await protect({ headers: { authorization: "Bearer " + token } }, {
      status(s) { status = s; return this; }, json() {},
    }, () => assert.fail("Refresh token admitted as access token"));
    assert.equal(status, 401);
  } finally { process.env.JWT_SECRET = oldSecret; }
});
const actor = () => ({ _id: user._id, role: "HEAD_OFFICE" });
const seed = () => Prices.create({
  networkCode: "01", planCode: "DATA-TEST-A", providerPrice: 100, sellingPrice: 120, active: true,
});
test("disabling preserves selling price and records the actor; enabling restores availability", async () => {
  await seed();
  await change({ networkCode: "01", actor: actor(),
    body: { confirmed: true, active: false, planCodes: ["DATA-TEST-A"] } });
  const saved = await Prices.findOne({ planCode: "DATA-TEST-A" });
  assert.equal(saved.active, false); assert.equal(saved.sellingPrice, 120);
  assert.equal(await Audit.countDocuments({ actorId: user._id }), 1);
  await change({ networkCode: "01", actor: actor(),
    body: { confirmed: true, active: true, planCodes: ["DATA-TEST-A"] } });
  assert.equal((await Prices.findOne({ planCode: "DATA-TEST-A" })).active, true);
});
test("bulk enable of an unpriced plan rolls back every plan and audit", async () => {
  await seed(); await Prices.updateOne({ planCode: "DATA-TEST-A" }, { $set: { active: false } });
  await assert.rejects(change({ networkCode: "01", actor: actor(),
    body: { confirmed: true, active: true, planCodes: ["DATA-TEST-A", "DATA-TEST-B"] } }),
    e => e.statusCode === 409);
  assert.equal((await Prices.findOne({ planCode: "DATA-TEST-A" })).active, false);
  assert.equal(await Audit.countDocuments(), 0);
});
test("bulk disable persists inactive unpriced plans without inventing a selling price", async () => {
  await change({ networkCode: "01", actor: actor(),
    body: { confirmed: true, active: false, planCodes: ["DATA-TEST-A", "DATA-TEST-B"] } });
  assert.equal(await Prices.countDocuments({ active: false, sellingPrice: null }), 2);
  assert.equal(await Audit.countDocuments(), 1);
});
test("unsupported, duplicate and unconfirmed changes are rejected without writes", async () => {
  for (const body of [
    { active: true, planCodes: ["DATA-TEST-A"] },
    { confirmed: true, active: false, planCodes: ["UNSUPPORTED"] },
    { confirmed: true, active: false, planCodes: ["DATA-TEST-A", "DATA-TEST-A"] },
    { confirmed: true, active: "false", planCodes: ["DATA-TEST-A"] },
  ]) await assert.rejects(change({ networkCode: "01", actor: actor(), body }));
  assert.equal(await Prices.countDocuments(), 0);
});
test("audit failure rolls back the availability change", async () => {
  await seed();
  const bad = createDataPlanAvailability({ catalog, audit: { create: async () => { throw Error("Unavailable audit"); } } });
  await assert.rejects(bad({ networkCode: "01", actor: actor(),
    body: { confirmed: true, active: false, planCodes: ["DATA-TEST-A"] } }));
  assert.equal((await Prices.findOne({ planCode: "DATA-TEST-A" })).active, true);
});
