const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const User = require("../models/user.model");
const SchoolRequest = require("../models/edupaySchoolRequest.model");
const Audit = require("../models/edupayAuditLog.model");
const Settings = require("../models/edupaySettings.model");
const AppSettings = require("../models/appSettings.model");
const controller = require("../controllers/edupay.controller");
const { featureBindingsForRequest } = require("../config/featureRouteRegistry");

let mongo;
const models = [User, SchoolRequest, Audit, Settings, AppSettings];

test.before(async () => {
  mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  await mongoose.connect(mongo.getUri(), { dbName: "edupay-school-request-tests" });
  await Promise.all(models.map((model) => model.init()));
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

test.beforeEach(async () => {
  await Promise.all(models.map((model) => model.collection.deleteMany({})));
});

const user = () => new User({
  fullName: "EduPay Parent",
  email: `parent-${new mongoose.Types.ObjectId()}@test.invalid`,
  phone: `080${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`,
  password: "Password123!",
  role: "CUSTOMER",
  status: "ACTIVE",
});

const call = async (handler, req) => {
  const result = {};
  const res = {
    status(code) {
      result.status = code;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    },
  };
  await handler(req, res);
  return result;
};

test("customer school request persists ownership-safe pending data and audit", async () => {
  const parent = user();
  await parent.save();
  const response = await call(controller.createSchoolRequest, {
    user: parent,
    body: {
      schoolName: "  Unity Academy  ",
      location: " Kano   Municipal ",
      contactPhone: "08012345678",
    },
    ip: "127.0.0.1",
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.success, true);
  assert.equal(response.body.request.status, "PENDING_REVIEW");
  assert.equal(response.body.request.schoolName, "Unity Academy");
  assert.equal(response.body.request.location, "Kano   Municipal");
  assert.equal(response.body.request.parent, undefined);
  assert.equal(response.body.request.normalizedSchoolName, undefined);

  const saved = await SchoolRequest.findOne().lean();
  assert.equal(String(saved.parent), String(parent._id));
  assert.equal(saved.status, "PENDING_REVIEW");
  assert.equal(await Audit.countDocuments({
    action: "EDUPAY_SCHOOL_REQUEST_CREATED",
    entityId: saved._id,
  }), 1);
});

test("duplicate active request is rejected for the same customer and school", async () => {
  const parent = user();
  await parent.save();
  const req = {
    user: parent,
    body: { schoolName: "Unity Academy", location: "Kano" },
    ip: "127.0.0.1",
  };
  assert.equal((await call(controller.createSchoolRequest, req)).status, 201);
  const duplicate = await call(controller.createSchoolRequest, req);
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, "ACTIVE_SCHOOL_REQUEST_EXISTS");
  assert.equal(await SchoolRequest.countDocuments({ parent: parent._id }), 1);
});

test("concurrent duplicate submits yield one creation and one conflict", async () => {
  const parent = user();
  await parent.save();
  const req = {
    user: parent,
    body: { schoolName: "Concurrent Academy", location: "Kano" },
    ip: "127.0.0.1",
  };
  const responses = await Promise.all([
    call(controller.createSchoolRequest, req),
    call(controller.createSchoolRequest, req),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  assert.equal(await SchoolRequest.countDocuments({ parent: parent._id }), 1);
});

test("SchoolRequest readiness index is partial and unique", async () => {
  const indexes = await SchoolRequest.collection.listIndexes().toArray();
  const index = indexes.find((entry) => entry.unique && entry.key.parent && entry.key.normalizedSchoolName && entry.key.normalizedLocation);
  assert.ok(index);
  assert.deepEqual(index.partialFilterExpression, {
    status: { $in: ["PENDING_REVIEW", "CONTACTED"] },
  });
});

test("admin settings rejects unknown fields without creating settings or audit", async () => {
  const parent = user();
  await parent.save();
  const response = await call(controller.adminSettings, {
    method: "PATCH",
    user: parent,
    body: { schoolCommissionRate: 12, secretKey: "do-not-save" },
  });
  assert.equal(response.status, 400);
  assert.equal(await Settings.countDocuments({}), 0);
  assert.equal(await Audit.countDocuments({ action: "EDUPAY_SETTINGS_UPDATED" }), 0);
});

test("admin settings rejects invalid day and percentage values", async () => {
  const parent = user();
  await parent.save();
  for (const body of [
    { gracePeriodDays: 1.5 },
    { maximumCoverPercentage: 101 },
  ]) {
    const response = await call(controller.adminSettings, {
      method: "PATCH", user: parent, body,
    });
    assert.equal(response.status, 400);
  }
  assert.equal(await Settings.countDocuments({}), 0);
});

test("admin settings audits only the sanitized applied payload", async () => {
  const parent = user();
  await parent.save();
  const response = await call(controller.adminSettings, {
    method: "PATCH",
    user: parent,
    body: { schoolCommissionRate: 12, autosaveEnabled: false },
  });
  assert.equal(response.status, undefined);
  const record = await Audit.findOne({ action: "EDUPAY_SETTINGS_UPDATED" }).lean();
  assert.deepEqual(record.metadata, { schoolCommissionRate: 12, autosaveEnabled: false });
  assert.equal(record.metadata.secretKey, undefined);
});

test("oversized school request fields return 400 before any write", async () => {
  const parent = user();
  await parent.save();
  const response = await call(controller.createSchoolRequest, {
    user: parent,
    body: {
      schoolName: "S".repeat(181),
      location: "Kano",
      contactPhone: "08012345678",
    },
    ip: "127.0.0.1",
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.code, "SCHOOL_REQUEST_FIELD_TOO_LONG");
  assert.equal(response.body.field, "schoolName");
  assert.equal(await SchoolRequest.countDocuments({}), 0);
});

test("request and audit roll back together when audit creation fails", async () => {
  const parent = user();
  await parent.save();
  const originalCreate = Audit.create;
  Audit.create = async () => {
    throw new Error("audit unavailable");
  };
  try {
    const response = await call(controller.createSchoolRequest, {
      user: parent,
      body: { schoolName: "Unity Academy", location: "Kano" },
      ip: "127.0.0.1",
    });
    assert.equal(response.status, 500);
  } finally {
    Audit.create = originalCreate;
  }
  assert.equal(await SchoolRequest.countDocuments({ parent: parent._id }), 0);
});

test("Head Office request listing exposes safe onboarding DTOs only", async () => {
  const parent = user();
  await parent.save();
  await SchoolRequest.create({
    parent: parent._id,
    schoolName: "Unity Academy",
    normalizedSchoolName: "UNITY ACADEMY",
    location: "Kano",
    normalizedLocation: "KANO",
    contactPhone: "08012345678",
  });
  const response = await call(controller.adminSchoolRequests, { query: {} });
  assert.equal(response.status, undefined);
  assert.equal(response.body.success, true);
  assert.equal(response.body.requests.length, 1);
  assert.deepEqual(
    Object.keys(response.body.requests[0]).sort(),
    ["contactPhone", "createdAt", "id", "location", "schoolName", "status"].sort()
  );
  assert.equal(response.body.requests[0].parent, undefined);
});

test("school discovery request is not bound to the EduPay financial feature gate", () => {
  assert.deepEqual(featureBindingsForRequest({
    method: "POST",
    originalUrl: "/api/edupay/school-requests",
  }), []);
  assert.deepEqual(featureBindingsForRequest({
    method: "POST",
    originalUrl: "/api/edupay/children",
  }), ["edupay"]);
});