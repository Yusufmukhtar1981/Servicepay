const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const { DeviceCompanion } = require("../services/deviceCompanion.service");
const { provisionNewCollections, readiness } = require("../services/deviceProvisioning.service");
const v = require("../services/deviceValidation.service");
let replica, connection, service, server, origin;
const actor = new mongoose.Types.ObjectId(), staffA = new mongoose.Types.ObjectId(), staffB = new mongoose.Types.ObjectId();
let sequence = 0;
function validImei() {
  const base = String(35600000000000n + BigInt(++sequence));
  let sum = 0;
  for (let i = 0; i < 14; i++) { let n = +base[i]; if (i % 2) { n *= 2; if (n > 9) n -= 9; } sum += n; }
  return base + ((10 - sum % 10) % 10);
}
const input = (extra = {}) => ({ requestId: crypto.randomUUID(), manufacturer: "TECNO", model: "Pilot",
  imei1: validImei(), serialNumber: `PILOT-${++sequence}`, androidVersion: "14", purchaseDate: "2020-01-01",
  purchasePrice: 100000, warrantyExpiry: "2030-01-01", department: "Operations", state: "Kano", ...extra });
const randomToken = () => crypto.randomBytes(32).toString("base64url");
async function enrolled() {
  const device = await service.register(input(), actor);
  const grant = await service.issueEnrollment(device._id, { expectedVersion: device.version }, actor);
  const request = { enrollmentToken: grant.enrollmentToken, installationId: crypto.randomUUID(), deviceToken: randomToken(), model: "Pilot" };
  await service.enroll(request);
  return { device, grant, request, auth: await service.authenticate(request.deviceToken, request.installationId) };
}
before(async () => {
  // This suite never uses an ambient Atlas URI or starts the legacy API/workers.
  assert.equal(process.env.MONGODB_URI, undefined, "Remove ambient MongoDB credentials before running this suite.");
  const binary = process.env.MONGOMS_SYSTEM_BINARY;
  assert.ok(binary && path.isAbsolute(binary), "An explicit cached mongod binary is required.");
  replica = await MongoMemoryReplSet.create({ binary: { systemBinary: binary, version: "7.0.14" },
    replSet: { count: 1, storageEngine: "wiredTiger" } });
  assert.match(replica.getUri(), /^mongodb:\/\/127\.0\.0\.1:/);
  connection = await mongoose.createConnection(replica.getUri(), {
    dbName: "servicepay_test_enterprise", autoCreate: false, autoIndex: false,
  }).asPromise();
  await provisionNewCollections(connection);
  service = new DeviceCompanion(connection);
  const express = require("express"), routes = require("../routes/enterpriseDevice.routes");
  const app = express();
  app.use(express.json());
  const protect = (req, res, next) => {
    if (!req.headers["x-test-access"]) return res.status(401).json({ success: false });
    req.user = { _id: actor };
    const mode = req.headers["x-test-access"];
    req.staffAccess = { isHeadOffice: mode === "head-office",
      scope: { type: mode === "branch" ? "BRANCH" : "GLOBAL" },
      permissions: mode === "viewer" ? ["enterprise.devices.view"] : [] };
    next();
  };
  app.use("/api/admin/enterprise-devices", routes.createAdminRouter({
    connection, protect, loadStaffRole: (req, res, next) => next() }));
  app.use("/api/device-companion", routes.createCompanionRouter({ connection }));
  server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  origin = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(async () => {
  for (const name of ["enterprisedevices", "deviceassignments", "deviceauditlogs"]) await connection.collection(name).deleteMany({});
  await connection.collection("users").deleteMany({});
  await connection.collection("users").insertMany([
    { _id: actor, name: "Pilot administrator", role: "HEAD_OFFICE", status: "ACTIVE" },
    { _id: staffA, name: "Pilot staff A", role: "STAFF", status: "ACTIVE", isStaff: true },
    { _id: staffB, name: "Pilot staff B", role: "STATE_MANAGER", status: "ACTIVE" },
  ]);
});
after(async () => { if (server) await new Promise((r) => server.close(r)); if (connection) await connection.close(); if (replica) await replica.stop(); });
test("missing provisioning fails closed without creating collections", async () => {
  const isolated = await mongoose.createConnection(replica.getUri(), { dbName: "servicepay_test_enterprise_empty", autoCreate: false, autoIndex: false }).asPromise();
  try {
    await assert.rejects(readiness(isolated), (e) => e.code === "DEVICE_PROVISIONING_REQUIRED");
    assert.equal((await isolated.db.listCollections().toArray()).length, 0);
  } finally { await isolated.close(); }
});
test("registration preserves values, generates an ID and is request-idempotent", async () => {
  const body = input({ serialNumber: "pilot-lower" });
  const first = await service.register(body, actor), second = await service.register(body, actor);
  assert.equal(first._id, second._id); assert.match(first.deviceId, /^SPDEV-\d{4}-[A-F0-9]{16}$/);
  assert.equal(first.serialNumber, "PILOT-LOWER"); assert.equal(await service.Device.countDocuments(), 1);
  assert.equal(await service.Audit.countDocuments({ action: "REGISTERED" }), 1);
  await assert.rejects(service.register({ ...body, model: "changed" }, actor), /different details/);
});
test("IMEI validation rejects absent, invalid and duplicate in-device slots", () => {
  for (const value of [null, "", "000000000000000", "123", "123456789012345"]) assert.throws(() => v.imei(value));
  const first = validImei(); assert.throws(() => v.registration(input({ imei1: first, imei2: first })), /must differ/);
  assert.throws(() => v.registration(input({ purchasePrice: 1.001 })));
  assert.throws(() => v.registration(input({ purchaseDate: "2020-02-31" })));
});
test("cross-slot IMEI and case-normalized serial duplicates are rejected", async () => {
  const imei2 = validImei(), body = input({ imei2 });
  await service.register(body, actor);
  await assert.rejects(service.register(input({ imei1: imei2 }), actor), (e) => e.code === 11000);
  await assert.rejects(service.register(input({ serialNumber: body.serialNumber.toLowerCase() }), actor), (e) => e.code === 11000);
  assert.equal(await service.Device.countDocuments(), 1);
});
test("concurrent duplicate registration yields one device and one registration audit", async () => {
  const imei1 = validImei();
  const results = await Promise.allSettled([service.register(input({ imei1 }), actor), service.register(input({ imei1 }), actor)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(await service.Device.countDocuments(), 1);
  assert.equal(await service.Audit.countDocuments({ action: "REGISTERED" }), 1);
});
test("assignment/reassignment is atomic, auditable and rejects stale concurrent writers", async () => {
  const device = await service.register(input(), actor);
  const outcomes = await Promise.allSettled([staffA, staffB].map((staffId) => service.assign(device._id, {
    staffId: String(staffId), expectedVersion: 0, reason: "Pilot assignment",
  }, actor)));
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(await service.Assignment.countDocuments({ endedAt: null }), 1);
  const current = await service.Device.findById(device._id).lean();
  const other = String(current.assignedStaff) === String(staffA) ? staffB : staffA;
  const changed = await service.assign(device._id, { staffId: String(other), expectedVersion: 1, reason: "Pilot reassignment" }, actor);
  assert.equal(changed.assignedStaff._id, String(other));
  assert.equal(await service.Assignment.countDocuments({ endedAt: null }), 1);
  assert.equal(await service.Assignment.countDocuments(), 2);
});
test("inactive/customer staff cannot receive company assignments", async () => {
  await connection.collection("users").updateOne({ _id: staffA }, { $set: { status: "SUSPENDED" } });
  const device = await service.register(input(), actor);
  await assert.rejects(service.assign(device._id, { staffId: String(staffA), expectedVersion: 0, reason: "Invalid assignment" }, actor));
  assert.equal(await service.Assignment.countDocuments(), 0);
});
test("retirement ends assignment, revokes credentials and is irreversible", async () => {
  const data = await enrolled();
  let device = await service.Device.findById(data.device._id).lean();
  await service.assign(device._id, { staffId: String(staffA), expectedVersion: device.version, reason: "Assignment" }, actor);
  device = await service.Device.findById(device._id).lean();
  await service.status(device._id, { status: "RETIRED", expectedVersion: device.version, reason: "Pilot retirement" }, actor);
  assert.equal(await service.Assignment.countDocuments({ endedAt: null }), 0);
  await assert.rejects(service.authenticate(data.request.deviceToken, data.request.installationId));
  await assert.rejects(service.status(device._id, { status: "AVAILABLE", expectedVersion: device.version + 1, reason: "Attempt reactivation" }, actor));
});
test("enrollment is one-use and retries acknowledge only the same installation and credential", async () => {
  const data = await enrolled();
  const again = await service.enroll(data.request); assert.equal(again.deviceId, data.device.deviceId);
  await assert.rejects(service.enroll({ ...data.request, installationId: crypto.randomUUID() }), /consumed/);
  await assert.rejects(service.enroll({ ...data.request, deviceToken: randomToken() }), /consumed/);
  assert.equal(await service.Audit.countDocuments({ action: "COMPANION_ENROLLED" }), 1);
});
test("expired enrollment cannot create a companion", async () => {
  const device = await service.register(input(), actor), grant = await service.issueEnrollment(device._id, { expectedVersion: 0 }, actor);
  await service.Device.updateOne({ _id: device._id }, { $set: { "enrollment.expiresAt": new Date(0) } });
  await assert.rejects(service.enroll({ enrollmentToken: grant.enrollmentToken, installationId: crypto.randomUUID(), deviceToken: randomToken() }), /expired/);
});
test("installation uniqueness, credential isolation and revocation hold", async () => {
  const data = await enrolled();
  await assert.rejects(service.authenticate(randomToken(), data.request.installationId));
  await assert.rejects(service.authenticate(data.request.deviceToken, crypto.randomUUID()));
  const other = await service.register(input(), actor), grant = await service.issueEnrollment(other._id, { expectedVersion: 0 }, actor);
  await assert.rejects(service.enroll({ enrollmentToken: grant.enrollmentToken, installationId: data.request.installationId, deviceToken: randomToken() }), (e) => e.code === 11000);
  const current = await service.Device.findById(data.device._id).lean();
  await service.revoke(current._id, { expectedVersion: current.version, reason: "Lost pilot authorization" }, actor);
  await assert.rejects(service.authenticate(data.request.deviceToken, data.request.installationId));
});
test("sync cannot overwrite manual identifiers, assignment or ownership", async () => {
  const data = await enrolled();
  await assert.rejects(service.sync(data.auth, { imei1: validImei() }), /cannot change/);
  const synced = await service.sync(data.auth, { installationId: data.request.installationId, model: "Reported model" });
  assert.equal(synced.model, "Pilot"); assert.ok(synced.lastSyncAt);
  const persisted = await service.Device.findById(data.device._id).lean();
  assert.equal(persisted.companion.reported.model, "Reported model");
  assert.ok(!JSON.stringify(synced).includes(data.request.deviceToken));
  assert.equal(synced.imei1, undefined);
});
test("credential rotation supports acknowledgement retries, grace and per-device revoke", async () => {
  const data = await enrolled(), next = randomToken();
  await service.rotate(data.auth, { deviceToken: next });
  await service.rotate(data.auth, { deviceToken: next });
  assert.ok(await service.authenticate(next, data.request.installationId));
  assert.ok(await service.authenticate(data.request.deviceToken, data.request.installationId));
  await service.Device.updateOne({ _id: data.device._id }, { $set: { "companion.previousTokenExpiresAt": new Date(0) } });
  await assert.rejects(service.authenticate(data.request.deviceToken, data.request.installationId));
});
test("shared database device throttle enforces a finite window", async () => {
  const data = await enrolled();
  await service.Device.updateOne({ _id: data.device._id }, { $set: { "companion.rateCount": 30, "companion.rateWindow": new Date() } });
  await assert.rejects(service.authenticate(data.request.deviceToken, data.request.installationId), (e) => e.status === 429);
});
test("audit events reject application updates and deletion", async () => {
  await service.register(input(), actor);
  await assert.rejects(service.Audit.updateMany({}, { $set: { reason: "changed" } }), /append-only/);
  await assert.rejects(service.Audit.deleteMany({}), /append-only/);
  const event = await service.Audit.findOne();
  event.reason = "changed";
  await assert.rejects(event.save(), /append-only|immutable/);
});
test("settings are validated, immutable and reject concurrent stale revisions", async () => {
  const body = { allowWallpaper: true, allowLauncher: false, approvedPackages: ["ng.servicepay.app"], revision: 0, reason: "Pilot policy" };
  const results = await Promise.allSettled([service.updateSettings(body, actor), service.updateSettings(body, actor)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await service.settings()).revision, 1);
  await assert.rejects(service.updateSettings({ ...body, approvedPackages: ["not a package"] }, actor));
});
test("search, reports and views mask unnecessary identifiers and preserve unrelated fixtures", async () => {
  const body = input(); await service.register(body, actor);
  const fixture = { _id: "unrelated-test-wallet", balance: 123.4567, principal: "DO NOT TOUCH" };
  await connection.collection("enterprise_test_unrelated").replaceOne({ _id: fixture._id }, fixture, { upsert: true });
  const list = await service.search({ q: body.imei1 }); assert.equal(list.total, 1);
  assert.ok(!JSON.stringify(list.devices).includes(body.imei1));
  const report = await service.reports(actor); assert.equal(report.rows.length, 1);
  assert.ok(!JSON.stringify(report).includes(body.imei1));
  assert.deepEqual(await connection.collection("enterprise_test_unrelated").findOne({ _id: fixture._id }), fixture);
});
test("HTTP authorization rejects unauthenticated/scoped staff and viewer mutations", async () => {
  const root = `${origin}/api/admin/enterprise-devices`;
  assert.equal((await fetch(root + "/overview")).status, 401);
  for (const mode of ["branch", "ordinary-staff"]) assert.equal((await fetch(root + "/overview", { headers: { "x-test-access": mode } })).status, 403);
  assert.equal((await fetch(root + "/overview", { headers: { "x-test-access": "head-office" } })).status, 200);
  assert.equal((await fetch(root, { method: "POST", headers: { "x-test-access": "viewer", "Content-Type": "application/json" }, body: JSON.stringify(input()) })).status, 403);
});
test("HTTP enrollment and sync expose no secret or registry identifiers", async () => {
  const data = await enrolled();
  const headers = { Authorization: `Bearer ${data.request.deviceToken}`, "X-Device-Installation": data.request.installationId };
  const response = await fetch(`${origin}/api/device-companion/config`, { headers }); assert.equal(response.status, 200);
  const body = await response.json(); assert.equal(body.data.deviceId, data.device.deviceId);
  assert.ok(!JSON.stringify(body).includes(data.request.deviceToken)); assert.equal(body.data.imei1, undefined);
  assert.equal((await fetch(`${origin}/api/device-companion/config`)).status, 401);
});
test("initial staff registration commits assignment atomically and duplicate failure rolls back", async () => {
  const body = input({ staffId: String(staffA) });
  const created = await service.register(body, actor);
  assert.equal(created.status, "ASSIGNED");
  assert.equal(created.assignedStaff._id, String(staffA));
  await assert.rejects(service.register(input({ imei1: body.imei1, staffId: String(staffB) }), actor));
  assert.equal(await service.Assignment.countDocuments(), 1);
  assert.equal(await service.Audit.countDocuments({ action: "REGISTERED" }), 1);
});
test("concurrent enrollment cannot consume one grant for different installations", async () => {
  const device = await service.register(input(), actor);
  const grant = await service.issueEnrollment(device._id, { expectedVersion: 0 }, actor);
  const results = await Promise.allSettled([1, 2].map(() => service.enroll({
    enrollmentToken: grant.enrollmentToken, installationId: crypto.randomUUID(), deviceToken: randomToken(),
  })));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(await service.Audit.countDocuments({ action: "COMPANION_ENROLLED" }), 1);
});
test("revocation invalidates an already-authenticated in-flight sync", async () => {
  const data = await enrolled();
  const current = await service.Device.findById(data.device._id).lean();
  await service.revoke(current._id, { expectedVersion: current.version, reason: "Pilot revoke" }, actor);
  await assert.rejects(service.sync(data.auth, { installationId: data.request.installationId }), (e) => e.status === 401);
  assert.equal(await service.Audit.countDocuments({ action: "SYNCED" }), 0);
});
test("plain HTTP companion requests are rejected outside isolated test mode", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const response = await fetch(`${origin}/api/device-companion/register`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).message, /HTTPS/);
  } finally { process.env.NODE_ENV = previous; }
});
