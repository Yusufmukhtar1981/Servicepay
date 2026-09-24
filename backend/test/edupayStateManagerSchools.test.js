const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const controller = require("../controllers/edupay.controller");
const User = require("../models/user.model");
const School = require("../models/edupaySchool.model");
const SchoolRequest = require("../models/edupaySchoolRequest.model");
const Audit = require("../models/edupayAuditLog.model");
let mongo;

test.before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(mongo.getUri(), { dbName: "edupay-state-manager" });
  await Promise.all([User, School, SchoolRequest, Audit].map((model) => model.init()));
});
test.after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
test.beforeEach(async () => {
  // EduPay financial models install production safety middleware that rejects
  // model-level deleteMany. These are isolated test collections, so bypass
  // that middleware explicitly rather than ever touching a production DB.
  await Promise.all([
    User.collection.deleteMany({}),
    School.collection.deleteMany({}),
    SchoolRequest.collection.deleteMany({}),
    Audit.collection.deleteMany({}),
  ]);
});

const invoke = (handler, request) => new Promise((resolve, reject) => {
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { resolve({ status: this.statusCode, body }); },
  };
  Promise.resolve(handler(request, response)).catch(reject);
});

test("state-manager school endpoints reject users outside STATE_MANAGER role", async () => {
  const response = await invoke(controller.stateManagerCreateSchool, {
    user: { _id: "507f1f77bcf86cd799439011", role: "CUSTOMER" },
    body: { schoolName: "No Access", location: "Lagos", state: "Lagos" },
  });
  assert.equal(response.status, 403);
});

test("state-manager school creation validates required registration fields", async () => {
  const response = await invoke(controller.stateManagerCreateSchool, {
    user: { _id: "507f1f77bcf86cd799439011", role: "STATE_MANAGER" },
    body: { schoolName: "Incomplete School", location: "Lagos" },
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.code, "SCHOOL_FIELDS_REQUIRED");
});

test("state-manager onboarding enforces state scope, deduplicates, and links approval", async () => {
  const dbName = `edupay_sm_${crypto.randomBytes(8).toString("hex")}`;
  const manager = await User.create({ fullName: "State Manager", phone: `080${Date.now()}`, email: `sm-${dbName}@test.invalid`, password: "Password123!", role: "STATE_MANAGER", status: "ACTIVE", state: "Lagos", zone: "SOUTH" });
  const body = { schoolName: "Scope Academy", location: "Ikeja", state: "Kano", schoolType: "PRIMARY", lga: "Ikeja", contactPerson: "Rep", phone: "08012345678", email: "scope@test.invalid", registrationNumber: "REG-SCOPE-1", authorizedRepresentative: "Rep" };
  const crossState = await invoke(controller.stateManagerCreateSchool, { user: manager.toObject(), body });
  assert.equal(crossState.status, 403);
  assert.equal(crossState.body.code, "STATE_SCOPE_FORBIDDEN");
  body.state = "Lagos";
  const created = await invoke(controller.stateManagerCreateSchool, { user: manager.toObject(), body });
  assert.equal(created.status, 201);
  const duplicate = await invoke(controller.stateManagerCreateSchool, { user: manager.toObject(), body });
  assert.equal(duplicate.status, 409);
  const request = await SchoolRequest.findOne({ stateManagerId: manager._id });
  assert.equal(request.status, "PENDING_REVIEW");
  const reviewer = await User.create({ fullName: "Head Office", phone: `081${Date.now()}`, email: `reviewer-${dbName}@test.invalid`, password: "Password123!", role: "HEAD_OFFICE", status: "ACTIVE" });
  const approved = await invoke(controller.adminSchoolRequestAction, {
    user: reviewer.toObject(), params: { requestId: request._id.toString() },
    body: { action: "APPROVE", representativeAuthorityConfirmed: true },
  });
  assert.equal(approved.body.success, true);
  const school = await School.findById(approved.body.request.schoolId).lean();
  assert.equal(school.status, "APPROVED");
  assert.equal(String(school.stateManagerId), String(manager._id));
  const listed = await invoke(controller.stateManagerSchools, { user: manager.toObject() });
  assert.equal(listed.body.schools.length, 1);
  assert.equal(String(listed.body.schools[0].stateManagerId), String(manager._id));
});