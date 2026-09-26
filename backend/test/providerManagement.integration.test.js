const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const ProviderManagementConfig = require("../models/providerManagementConfig.model");
const AdminAuditLog = require("../models/adminAuditLog.model");
const { getProviderManagement, patchProviderManagement } = require("../controllers/providerManagement.controller");
const { electricityProviderEnabled } = require("../middleware/providerRouting.middleware");
const { adminOnly } = require("../middleware/auth.middleware");

let mongo;
const actorId = new mongoose.Types.ObjectId();

const makeRequest = (body = {}, role = "HEAD_OFFICE", method = "PATCH") => ({
  body,
  user: { _id: actorId, role, fullName: "Provider Admin" },
  method,
  originalUrl: "/api/admin/fintech-operations/provider-management",
  ip: "127.0.0.1",
  headers: { "user-agent": "provider-management-test" },
  get(name) { return this.headers[name]; },
});

const response = () => {
  const result = { status: 200, body: null };
  return {
    result,
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; return this; },
  };
};

const invoke = async (handler, req) => {
  const res = response();
  await handler(req, res);
  return res.result;
};

const patch = (body) => invoke(patchProviderManagement, makeRequest(body));

test.before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(mongo.getUri(), { dbName: "provider-management-tests" });
  await Promise.all([ProviderManagementConfig.init(), AdminAuditLog.init()]);
});

test.after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

test("persists safe service matrix defaults and audits mutations", async () => {
  const oldUserId = process.env.NELLOBYTES_USERID;
  const oldApiKey = process.env.NELLOBYTES_APIKEY;
  process.env.NELLOBYTES_USERID = "test-user";
  process.env.NELLOBYTES_APIKEY = "test-key";
  try {
    const first = await invoke(getProviderManagement, makeRequest({}, "HEAD_OFFICE", "GET"));
    assert.equal(first.status, 200);
    const electricity = first.body.data.items.find((item) => item.service === "ELECTRICITY");
    const cable = first.body.data.items.find((item) => item.service === "CABLE");
    assert.equal(electricity.primaryProvider, "NELLOBYTES");
    assert.equal(electricity.fallbackSupported, false);
    assert.equal(electricity.currentProvider, "NELLOBYTES");
    assert.equal(electricity.providers.find((p) => p.provider === "NELLOBYTES").enabled, true);
    assert.equal(electricity.providers.find((p) => p.provider === "TELECOM_ABODE").enabled, false);
    assert.equal(cable.currentProvider, null);
    assert.equal(cable.fallbackSupported, false);
    assert.equal(cable.providers.every((p) => !p.enabled && !p.available), true);
    assert.match(cable.providers[0].reason, /no cable purchase route/i);
    assert.equal(await ProviderManagementConfig.countDocuments(), 0, "GET must not create persisted defaults");

    let routeContinued = false;
    await electricityProviderEnabled({}, response(), () => { routeContinued = true; });
    assert.equal(routeContinued, true, "the default legacy provider remains usable when configured");
    assert.equal(await ProviderManagementConfig.countDocuments(), 0, "customer routing checks must not persist defaults");

    const changed = await patch({ service: "ELECTRICITY", action: "disable", provider: "NELLOBYTES" });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.data.currentProvider, null);
    assert.ok(changed.body.data.updatedAt);
    assert.equal(String(changed.body.data.updatedBy), String(actorId));
    assert.equal(await ProviderManagementConfig.countDocuments(), 1, "only the service being changed is persisted");
    assert.equal(await AdminAuditLog.countDocuments({ action: "FINTECH_OPERATION" }), 1);

    // A fresh database read proves the value is persisted rather than held in process memory.
    const persisted = await ProviderManagementConfig.findOne({ service: "ELECTRICITY" }).lean();
    assert.equal(persisted._id, "ELECTRICITY", "service identity must use Mongo's built-in unique _id");
    assert.equal(persisted.providerStates.find((p) => p.provider === "NELLOBYTES").enabled, false);
    assert.equal(persisted.primaryProvider, "NELLOBYTES");
  } finally {
    if (oldUserId === undefined) delete process.env.NELLOBYTES_USERID;
    else process.env.NELLOBYTES_USERID = oldUserId;
    if (oldApiKey === undefined) delete process.env.NELLOBYTES_APIKEY;
    else process.env.NELLOBYTES_APIKEY = oldApiKey;
  }
});

test("HEAD_OFFICE permission is required and legacy routing is unchanged", async () => {
  let called = false;
  const denied = response();
  adminOnly("HEAD_OFFICE")(makeRequest({}, "CUSTOMER"), denied, () => { called = true; });
  assert.equal(denied.result.status, 403);
  assert.equal(called, false);

  const oldUserId = process.env.NELLOBYTES_USERID;
  const oldApiKey = process.env.NELLOBYTES_APIKEY;
  process.env.NELLOBYTES_USERID = "test-user";
  process.env.NELLOBYTES_APIKEY = "test-key";
  try {
    const enabled = await patch({ service: "ELECTRICITY", action: "enable", provider: "NELLOBYTES" });
    assert.equal(enabled.status, 200);
    assert.equal(enabled.body.data.primaryProvider, "NELLOBYTES");
    assert.equal(enabled.body.data.currentProvider, "NELLOBYTES");
    assert.equal(enabled.body.data.fallbackProvider, null);
  } finally {
    if (oldUserId === undefined) delete process.env.NELLOBYTES_USERID;
    else process.env.NELLOBYTES_USERID = oldUserId;
    if (oldApiKey === undefined) delete process.env.NELLOBYTES_APIKEY;
    else process.env.NELLOBYTES_APIKEY = oldApiKey;
  }
});

test("disabled electricity is rejected before downstream verify/pay handlers", async () => {
  await patch({ service: "ELECTRICITY", action: "disable", provider: "NELLOBYTES" });
  let downstreamCalled = false;
  const res = response();
  await electricityProviderEnabled({}, res, () => { downstreamCalled = true; });
  assert.equal(res.result.status, 503);
  assert.equal(res.result.body.code, "ELECTRICITY_PROVIDER_UNAVAILABLE");
  assert.equal(downstreamCalled, false);
});

test("Telecom Abode remains locked even with an API key and fallback fails closed", async () => {
  const oldKey = process.env.TELECOM_ABODE_API_KEY;
  process.env.TELECOM_ABODE_API_KEY = "configured-but-not-authorized";
  try {
    const enable = await patch({ service: "ELECTRICITY", action: "enable", provider: "TELECOM_ABODE" });
    assert.equal(enable.status, 409);
    assert.equal(enable.body.code, "TELECOM_ABODE_PURCHASES_LOCKED");
    const select = await patch({ service: "ELECTRICITY", action: "setPrimary", provider: "TELECOM_ABODE" });
    assert.equal(select.status, 409);
    assert.equal(select.body.code, "TELECOM_ABODE_PURCHASES_LOCKED");
    const fallback = await patch({ service: "ELECTRICITY", action: "setFallback", provider: "NELLOBYTES" });
    assert.equal(fallback.status, 409);
    assert.equal(fallback.body.code, "FALLBACK_ROUTING_UNSUPPORTED");
    const unknown = await patch({ service: "ELECTRICITY", action: "enable", provider: "UNKNOWN" });
    assert.equal(unknown.status, 400);
    const extra = await patch({ service: "ELECTRICITY", action: "disable", provider: "NELLOBYTES", arbitrary: true });
    assert.equal(extra.status, 400);
    const cableEnable = await patch({ service: "CABLE", action: "enable", provider: "NELLOBYTES" });
    assert.equal(cableEnable.status, 409);
    assert.equal(cableEnable.body.code, "CABLE_PURCHASE_UNAVAILABLE");

    const stored = await ProviderManagementConfig.findOne({ service: "ELECTRICITY" }).lean();
    assert.equal(stored.primaryProvider, "NELLOBYTES");
    assert.equal(stored.providerStates.find((p) => p.provider === "TELECOM_ABODE").enabled, false);
  } finally {
    if (oldKey === undefined) delete process.env.TELECOM_ABODE_API_KEY;
    else process.env.TELECOM_ABODE_API_KEY = oldKey;
  }
});

test("concurrent toggles remain atomic and leave one audited persisted state", async () => {
  const oldUserId = process.env.NELLOBYTES_USERID;
  const oldApiKey = process.env.NELLOBYTES_APIKEY;
  process.env.NELLOBYTES_USERID = "test-user";
  process.env.NELLOBYTES_APIKEY = "test-key";
  try {
    // Exercise the first-write race: each admin mutation may attempt to create
    // the missing singleton, but the unique service index and retry must leave
    // one persisted row and an audit row for each committed mutation.
    await ProviderManagementConfig.deleteOne({ service: "ELECTRICITY" });
    const [one, two] = await Promise.all([
      patch({ service: "ELECTRICITY", action: "enable", provider: "NELLOBYTES" }),
      patch({ service: "ELECTRICITY", action: "disable", provider: "NELLOBYTES" }),
    ]);
    assert.equal(one.status, 200);
    assert.equal(two.status, 200);
    const stored = await ProviderManagementConfig.findOne({ service: "ELECTRICITY" }).lean();
    assert.equal(typeof stored.providerStates.find((p) => p.provider === "NELLOBYTES").enabled, "boolean");
    assert.equal(await AdminAuditLog.countDocuments({ action: "FINTECH_OPERATION" }), 5);
  } finally {
    if (oldUserId === undefined) delete process.env.NELLOBYTES_USERID;
    else process.env.NELLOBYTES_USERID = oldUserId;
    if (oldApiKey === undefined) delete process.env.NELLOBYTES_APIKEY;
    else process.env.NELLOBYTES_APIKEY = oldApiKey;
  }
});