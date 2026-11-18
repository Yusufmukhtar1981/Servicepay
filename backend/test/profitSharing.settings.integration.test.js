"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
for (const key of ["MONGODB_URI", "MONGO_URI", "MONGO_URL", "DATABASE_URL"]) {
  assert.equal(Boolean(process.env[key]), false, `Remove ambient ${key} before running isolated tests.`);
}
const mongoose = require(require.resolve("mongoose", { paths: [path.resolve(__dirname, "..")] }));
mongoose.set("autoCreate", false); mongoose.set("autoIndex", false);
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const express = require("express"), jwt = require("jsonwebtoken");
const M = require("../models/businessNetwork.models");
const User = require("../models/user.model"), Role = require("../models/role.model");
const router = require("../routes/productCommission.routes");
const { createSettingsService } = require("../services/profitSharing.settings");
let mongo, server, base, actors, walletSnapshot;
const future = new Date(Date.now() + 86400000).toISOString();
let counter = 0;
const body = (extra = {}) => ({
  serviceType: "DATA", revision: 0, idempotencyKey: `synthetic-request-${++counter}`,
  confirmation: true, reason: "Synthetic approved allocation test",
  effectiveAt: future, enabled: true,
  percentages: { HEAD_OFFICE: 38, ZONAL_MANAGER: 27, STATE_MANAGER: 21, AGGREGATOR: 14 },
  ...extra,
});
const person = (role, extra = {}) => ({
  _id: new mongoose.Types.ObjectId(), fullName: "Synthetic " + role,
  role, status: "ACTIVE", authTokenVersion: 0, isDeleted: false,
  walletBalance: 4321.004603467313, commissionBalance: 55, ...extra,
});
async function request(actor, payload) {
  const token = actor && jwt.sign({ id: String(actor._id), tokenVersion: 0 },
    process.env.JWT_SECRET, { expiresIn: "1h" });
  const response = await fetch(base, {
    method: payload ? "POST" : "GET",
    headers: { ...(actor ? { Authorization: `Bearer ${token}` } : {}),
      ...(payload ? { "Content-Type": "application/json" } : {}) },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  return { status: response.status, body: await response.json(),
    cache: response.headers.get("cache-control") };
}
test.before(async () => {
  process.env.JWT_SECRET = "synthetic-profit-sharing-test-key-not-production";
  mongo = await MongoMemoryReplSet.create({
    binary: { systemBinary: process.env.MONGOMS_SYSTEM_BINARY },
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ args: ["--nounixsocket"] }],
  });
  assert.match(mongo.getUri(), /^mongodb:\/\/127\.0\.0\.1:/);
  await mongoose.connect(mongo.getUri(), { dbName: "profit-sharing-settings-isolated" });
  for (const model of [M.Settings, M.Audit, User, Role]) {
    assert.equal(model.db, mongoose.connection);
    await mongoose.connection.db.createCollection(model.collection.name);
  }
  const roleId = new mongoose.Types.ObjectId();
  await Role.collection.insertOne({
    _id: roleId, name: "SYNTHETIC_COMMISSION_ADMIN", status: "ACTIVE",
    permissions: ["commissions.manage"], department: "ADMINISTRATION",
  });
  actors = {
    authorized: person("HEAD_OFFICE", { staffRoleId: roleId }),
    wildcard: person("HEAD_OFFICE"),
    customer: person("CUSTOMER"),
    aggregator: person("AGENT"),
    state: person("STATE_MANAGER"),
    zone: person("ZONAL_MANAGER"),
    support: person("STAFF", { isStaff: true, staffRoleId: roleId }),
  };
  await User.collection.insertMany(Object.values(actors));
  await M.Settings.create({ _id: "network", revision: 7, categories: ["Preserved category"] });
  walletSnapshot = await User.find().select("_id walletBalance commissionBalance").sort({ _id: 1 }).lean();
  const app = express(); app.use(express.json()); app.use("/commission", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/commission/profit-sharing`;
});
test.after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});
test("engine readiness and activation enforce existing Head Office boundaries and fresh authentication", async () => {
  async function engineRequest(actor, suffix, body) {
    const token = actor && jwt.sign({ id: String(actor._id), tokenVersion: 0 },
      process.env.JWT_SECRET, { expiresIn: "1h" });
    const response = await fetch(base + suffix, {
      method: body ? "POST" : "GET", headers: { "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  }
  assert.equal((await engineRequest(null, "/engine")).status, 401);
  for (const name of ["customer", "aggregator", "state", "zone", "support"]) {
    assert.equal((await engineRequest(actors[name], "/engine")).status, 403);
    assert.equal((await engineRequest(actors[name], "/activation", { mode: "LIVE" })).status, 403);
  }
  assert.equal((await engineRequest(actors.wildcard, "/activation", { mode: "LIVE" })).status, 403);
  const ready = await engineRequest(actors.authorized, "/engine");
  assert.equal(ready.status, 200); assert.equal(ready.body.data.distributionLive, false);
  assert.ok(ready.body.data.storageBlockers.length > 0);
  assert.equal((await engineRequest(actors.authorized, "/activation", {
    mode: "LIVE", currentPassword: "", confirmation: true,
  })).status, 401);
  assert.equal((await engineRequest(actors.authorized, "/dry-run", {
    transactionId: "a".repeat(24), costs: { verified: true },
  })).status, 400);
  assert.equal(await M.Settings.countDocuments({ _id: "profit-sharing-engine" }), 0);
});
test("no runtime defaults: initial rules are empty and financial distribution is inactive", async () => {
  const result = await request(actors.authorized);
  assert.equal(result.status, 200);
  assert.match(result.cache, /no-store/);
  assert.equal(result.body.data.canManage, true);
  assert.equal(result.body.data.distributionLive, false);
  assert.equal(result.body.data.items.length, 9);
  assert.ok(result.body.data.items.every(row => row.versions.length === 0 && row.revision === 0));
  assert.equal(await M.Settings.countDocuments({ _id: "profit-sharing" }), 0);
});
test("backend denies anonymous, customer and all non-Head-Office management roles", async () => {
  assert.equal((await request(null)).status, 401);
  for (const name of ["customer", "aggregator", "state", "zone", "support"]) {
    assert.equal((await request(actors[name])).status, 403, name);
    assert.equal((await request(actors[name], body())).status, 403, name);
  }
});
test("Head Office wildcard cannot change percentages without explicit existing permission", async () => {
  const read = await request(actors.wildcard);
  assert.equal(read.status, 200);
  assert.equal(read.body.data.canManage, false);
  assert.equal((await request(actors.wildcard, body())).status, 403);
  assert.equal(await M.Audit.countDocuments({ action: "PROFIT_SHARING_RULE_SAVED" }), 0);
});
test("administrator-entered percentages persist atomically with a complete audit entry", async () => {
  const input = body();
  const result = await request(actors.authorized, input);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.data.revision, 1);
  assert.deepEqual(result.body.data.versions[0].percentages, input.percentages);
  assert.equal(result.body.data.versions[0].poolPercentage, undefined);
  assert.equal(result.body.data.versions[0].policyVersion, 3);
  assert.equal(result.body.data.versions[0].previousPercentages, null);
  assert.equal(result.body.data.versions[0].requestHash, undefined);
  assert.equal(result.body.data.versions[0].reason, input.reason);
  const audit = await M.Audit.findOne({ action: "PROFIT_SHARING_RULE_SAVED" }).lean();
  assert.equal(String(audit.actor), String(actors.authorized._id));
  assert.deepEqual(audit.metadata.rule.percentages, input.percentages);
  assert.equal(audit.metadata.distributionLive, false);
});
test("Head Office reads only the new beneficiary contract while old rule history is preserved exactly", async () => {
  const legacy = { id: "historical-five-role-rule", enabled: false, serviceType: "NIN_VERIFICATION",
    effectiveAt: "2025-01-01T00:00:00.000Z", createdAt: "2025-01-01T00:00:00.000Z",
    percentages: { BUSINESS_NETWORK_AGENT: 40, AGGREGATOR: 20, STATE_MANAGER: 15,
      ZONAL_MANAGER: 10, HEAD_OFFICE: 15 } };
  await M.Settings.updateOne({ _id: "profit-sharing" }, { $set: {
    "profitSharing.services.NIN_VERIFICATION": { revision: 1, versions: [legacy] } } });
  const before = await M.Settings.findById("profit-sharing").lean();
  const read = await request(actors.authorized);
  assert.deepEqual(read.body.data.roles, ["HEAD_OFFICE", "ZONAL_MANAGER", "STATE_MANAGER", "AGGREGATOR"]);
  assert.equal(read.body.data.allocationSuggestion, undefined);
  assert.equal(read.body.data.policyVersion, 3);
  assert.deepEqual(await M.Settings.findById("profit-sharing").lean(), before);
  const saved = await request(actors.authorized, body({
    serviceType: "NIN_VERIFICATION", revision: 1,
  }));
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.data.versions[1], legacy);
  assert.equal(saved.body.data.versions[0].poolPercentage, undefined);
});
test("later changes append versions and do not modify historical settings", async () => {
  const before = (await request(actors.authorized)).body.data.items.find(row => row.serviceType === "DATA");
  const input = body({ revision: before.revision, enabled: false,
    percentages: { HEAD_OFFICE: 11, ZONAL_MANAGER: 29, STATE_MANAGER: 32, AGGREGATOR: 28 } });
  const saved = await request(actors.authorized, input);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.data.revision, 2);
  assert.equal(saved.body.data.versions[0].enabled, false);
  assert.deepEqual(saved.body.data.versions[1], before.versions[0]);
  assert.deepEqual(saved.body.data.versions[0].previousPercentages, before.versions[0].percentages);
  assert.deepEqual(saved.body.data.versions[0].percentages, input.percentages);
  const audit = await M.Audit.findOne({ "metadata.eventId": saved.body.data.versions[0].id }).lean();
  assert.deepEqual(audit.metadata.previousPercentages, before.versions[0].percentages);
  assert.deepEqual(audit.metadata.newPercentages, input.percentages);
});
test("stale concurrent edits are rejected without overwriting newer rules", async () => {
  const input = body({ revision: 0 });
  const result = await request(actors.authorized, input);
  assert.equal(result.status, 409);
  assert.equal(result.body.code, "COMMISSION_RULE_CHANGED");
});
test("concurrent identical submissions produce exactly one version and audit event", async () => {
  const input = body({ serviceType: "AIRTIME" });
  const responses = await Promise.all(Array.from({ length: 4 }, () => request(actors.authorized, input)));
  for (const response of responses) assert.equal(response.status, 200, JSON.stringify(response.body));
  const read = (await request(actors.authorized)).body.data.items.find(row => row.serviceType === "AIRTIME");
  assert.equal(read.revision, 1); assert.equal(read.versions.length, 1);
  assert.equal(await M.Audit.countDocuments({ "metadata.serviceType": "AIRTIME" }), 1);
});
test("reusing a request key with different values fails without side effects", async () => {
  const input = body({ serviceType: "ELECTRICITY" });
  assert.equal((await request(actors.authorized, input)).status, 200);
  const count = await M.Audit.countDocuments();
  assert.equal((await request(actors.authorized, { ...input, enabled: false })).status, 409);
  assert.equal((await request(actors.authorized, { ...input, serviceType: "CABLE" })).status, 409);
  assert.equal(await M.Audit.countDocuments(), count);
});
test("replay remains safe even after the original effective time", async () => {
  const input = body({ serviceType: "CABLE" });
  assert.equal((await request(actors.authorized, input)).status, 200);
  const afterEffective = createSettingsService({ now: () => new Date(Date.parse(future) + 86400000) });
  const result = await afterEffective.save(actors.authorized, input);
  assert.equal(result.replayed, true); assert.equal(result.revision, 1);
});
test("concurrent distinct edits cannot lose or overwrite a saved version", async () => {
  const results = await Promise.all([
    request(actors.authorized, body({ serviceType: "DELIVERY" })),
    request(actors.authorized, body({ serviceType: "DELIVERY", enabled: false })),
  ]);
  assert.deepEqual(results.map(row => row.status).sort(), [200, 409]);
  assert.equal(await M.Audit.countDocuments({ "metadata.serviceType": "DELIVERY" }), 1);
});
test("requires total 100%, explicit confirmation, future date and a reason", async () => {
  const count = await M.Audit.countDocuments();
  const invalid = [
    { confirmation: false }, { reason: "short" },
    { effectiveAt: new Date(Date.now() - 60000).toISOString() },
    { revision: "0" }, { idempotencyKey: "x" }, { enabled: "true" },
    { percentages: {} }, { percentages: { ...body().percentages, HEAD_OFFICE: 9 } },
    { percentages: { ...body().percentages, AGGREGATOR: 47.001 } },
    { percentages: { ...body().percentages, HEAD_OFFICE: undefined } }, { poolPercentage: "50" },
    { poolPercentage: -1 }, { poolPercentage: 100.01 }, { poolPercentage: 50.001 },
    { policyVersion: 1 },
    { walletBalance: 1000000 }, { serviceType: "$invalid.path" },
  ];
  for (const patch of invalid) {
    const result = await request(actors.authorized, body({ serviceType: "EXAM_PIN", ...patch }));
    assert.equal(result.status, 400, JSON.stringify(result.body));
  }
  assert.equal(await M.Audit.countDocuments(), count);
  assert.equal((await M.Settings.findById("profit-sharing").lean()).profitSharing.services.EXAM_PIN, undefined);
});
test("audit failure rolls back the settings change completely", async () => {
  const failingAudit = {
    db: M.Audit.db, collection: M.Audit.collection,
    create: async () => { throw new Error("Synthetic audit failure"); },
  };
  const service = createSettingsService({ auditModel: failingAudit });
  await assert.rejects(service.save(actors.authorized, body({ serviceType: "BVN_VERIFICATION" })),
    /Synthetic audit failure/);
  assert.equal((await M.Settings.findById("profit-sharing").lean()).profitSharing.services.BVN_VERIFICATION, undefined);
});
test("saving never creates missing storage namespaces automatically", async () => {
  // Disposable local database only. Production code has no drop/create call.
  const name = "synthetic_absent_audit";
  const missing = { db: M.Audit.db, collection: { name }, create: M.Audit.create.bind(M.Audit) };
  const service = createSettingsService({ auditModel: missing });
  await assert.rejects(service.save(actors.authorized, body({ serviceType: "NIN_VERIFICATION" })),
    { code: "COMMISSION_SETTINGS_STORAGE_NOT_READY" });
  assert.equal(await mongoose.connection.db.listCollections({ name }).hasNext(), false);
});
test("legacy settings, all wallet balances and main-wallet commission counters are preserved", async () => {
  const legacy = await M.Settings.findById("network").lean();
  assert.equal(legacy.revision, 7); assert.deepEqual(legacy.categories, ["Preserved category"]);
  assert.equal(legacy.profitSharing, undefined);
  assert.deepEqual(await User.find().select("_id walletBalance commissionBalance").sort({ _id: 1 }).lean(), walletSnapshot);
  const indexes = await M.Settings.collection.indexes();
  assert.deepEqual(indexes.map(row => row.name), ["_id_"]);
});
