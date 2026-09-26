const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const ProviderManagementConfig = require("../models/providerManagementConfig.model");
const AdminAuditLog = require("../models/adminAuditLog.model");
const Transaction = require("../models/transaction.model");
const User = require("../models/user.model");
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
  await Promise.all([ProviderManagementConfig.init(), AdminAuditLog.init(), Transaction.init()]);
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
    const airtime = first.body.data.items.find((item) => item.service === "AIRTIME");
    const data = first.body.data.items.find((item) => item.service === "DATA");
    const electricity = first.body.data.items.find((item) => item.service === "ELECTRICITY");
    const cable = first.body.data.items.find((item) => item.service === "CABLE");
    assert.ok(airtime);
    assert.ok(data);
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
    const audit = await AdminAuditLog.findOne({ action: "FINTECH_OPERATION" }).lean();
    assert.equal(String(audit.actorId), String(actorId));
    assert.equal(audit.actorRole, "HEAD_OFFICE");
    assert.ok(audit.createdAt);
    assert.equal(audit.metadata.service, "ELECTRICITY");
    assert.equal(audit.metadata.action, "disable");
    assert.equal(audit.previousData.currentProvider, "NELLOBYTES");
    assert.equal(audit.newData.currentProvider, null);

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

test("Airtime and Data truthfully identify the wired ClubKonnect defaults without changing purchase routing", async () => {
  const oldUserId = process.env.CLUBKONNECT_USER_ID;
  const oldApiKey = process.env.CLUBKONNECT_API_KEY;
  process.env.CLUBKONNECT_USER_ID = "test-clubkonnect-user";
  process.env.CLUBKONNECT_API_KEY = "test-clubkonnect-key";
  try {
    const result = await invoke(getProviderManagement, makeRequest({}, "HEAD_OFFICE", "GET"));
    assert.equal(result.status, 200);
    for (const service of ["AIRTIME", "DATA"]) {
      const config = result.body.data.items.find((item) => item.service === service);
      assert.equal(config.primaryProvider, "CLUBKONNECT");
      assert.equal(config.currentProvider, "CLUBKONNECT");
      assert.equal(config.fallbackProvider, null);
      assert.equal(config.fallbackSupported, false);
      const legacy = config.providers.find((provider) => provider.provider === "CLUBKONNECT");
      const telecomAbode = config.providers.find((provider) => provider.provider === "TELECOM_ABODE");
      assert.equal(legacy.enabled, true);
      assert.equal(legacy.available, true);
      assert.equal(telecomAbode.enabled, false);
      assert.equal(telecomAbode.available, false);

      const disable = await patch({ service, action: "disable", provider: "CLUBKONNECT" });
      assert.equal(disable.status, 409);
      assert.equal(disable.body.code, "ROUTING_CONTROL_UNAVAILABLE");
      const select = await patch({ service, action: "setPrimary", provider: "TELECOM_ABODE" });
      assert.equal(select.status, 409);
      assert.equal(select.body.code, "TELECOM_ABODE_PURCHASES_LOCKED");
      const enable = await patch({ service, action: "enable", provider: "TELECOM_ABODE" });
      assert.equal(enable.status, 409);
      assert.equal(enable.body.code, "TELECOM_ABODE_PURCHASES_LOCKED");
    }
    const responseJson = JSON.stringify(result.body);
    assert.equal(responseJson.includes(process.env.CLUBKONNECT_USER_ID), false);
    assert.equal(responseJson.includes(process.env.CLUBKONNECT_API_KEY), false);
    assert.equal(
      await ProviderManagementConfig.countDocuments({ service: { $in: ["AIRTIME", "DATA"] } }),
      0,
      "GET and rejected actions do not persist Airtime/Data defaults",
    );

    process.env.CLUBKONNECT_USER_ID = " \t ";
    process.env.CLUBKONNECT_API_KEY = " \t ";
    const unconfigured = await invoke(getProviderManagement, makeRequest({}, "HEAD_OFFICE", "GET"));
    for (const service of ["AIRTIME", "DATA"]) {
      const config = unconfigured.body.data.items.find((item) => item.service === service);
      assert.equal(config.primaryProvider, "CLUBKONNECT");
      assert.equal(config.currentProvider, null);
      const legacy = config.providers.find((provider) => provider.provider === "CLUBKONNECT");
      assert.equal(legacy.enabled, true);
      assert.equal(legacy.available, false);
      assert.match(legacy.reason, /credentials are not configured/i);
    }

    const customer = await User.create({
      fullName: "Provider Management Test Customer",
      phone: `080${new mongoose.Types.ObjectId().toString().slice(-8)}`,
      password: "provider-management-test-password",
    });
    const legacyTransaction = await Transaction.create({
      reference: "legacy-airtime-provider-management",
      customerId: customer._id,
      serviceType: "AIRTIME",
      amount: 100,
      status: "SUCCESSFUL",
    });
    assert.equal(legacyTransaction.providerReference, "");
    assert.equal(legacyTransaction.providerStatus, "UNKNOWN");
  } finally {
    if (oldUserId === undefined) delete process.env.CLUBKONNECT_USER_ID;
    else process.env.CLUBKONNECT_USER_ID = oldUserId;
    if (oldApiKey === undefined) delete process.env.CLUBKONNECT_API_KEY;
    else process.env.CLUBKONNECT_API_KEY = oldApiKey;
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
    const cableEnable = await patch({ service: "CABLE", action: "enable", provider: "CLUBKONNECT" });
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