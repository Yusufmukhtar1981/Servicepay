const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const controller = require("../controllers/edupay.controller");
const managedRecords = require("../controllers/managedRecords.controller");
const User = require("../models/user.model");
const School = require("../models/edupaySchool.model");
const SchoolRequest = require("../models/edupaySchoolRequest.model");
const SchoolUser = require("../models/edupaySchoolUser.model");
const Audit = require("../models/edupayAuditLog.model");
let mongo;

test.before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(mongo.getUri(), { dbName: "edupay-state-manager" });
  await Promise.all([User, School, SchoolRequest, SchoolUser, Audit].map((model) => model.init()));
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
    SchoolUser.collection.deleteMany({}),
    Audit.collection.deleteMany({}),
  ]);
});

const invoke = (handler, request) => new Promise((resolve, reject) => {
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { resolve({ status: this.statusCode, body }); },
  };
  Promise.resolve(handler(request, response, reject)).catch(reject);
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
  const body = { schoolName: "Scope Academy", location: "Ikeja", state: "Kano", schoolType: "PRIMARY", lga: "Ikeja", contactPerson: "Rep", phone: "08012345678", email: "scope@test.invalid", registrationNumber: "REG-SCOPE-1", authorizedRepresentative: "Rep", aggregatorId: "507f1f77bcf86cd799439011", stateManagerId: "507f1f77bcf86cd799439012", zonalManagerId: "507f1f77bcf86cd799439013", createdByRole: "AGENT" };
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
  assert.equal(request.createdByRole, "STATE_MANAGER");
  assert.equal(request.aggregatorId, null);
  assert.equal(request.zonalManagerId, null);
  const reviewer = await User.create({ fullName: "Head Office", phone: `081${Date.now()}`, email: `reviewer-${dbName}@test.invalid`, password: "Password123!", role: "HEAD_OFFICE", status: "ACTIVE" });
  const approved = await invoke(controller.adminSchoolRequestAction, {
    user: reviewer.toObject(), params: { requestId: request._id.toString() },
    body: { action: "APPROVE", representativeAuthorityConfirmed: true },
  });
  assert.equal(approved.body.success, true);
  const school = await School.findById(approved.body.request.schoolId).lean();
  assert.equal(school.status, "APPROVED");
  assert.equal(String(school.stateManagerId), String(manager._id));
  assert.equal(school.portalUser, null);
  assert.equal(await SchoolUser.countDocuments({ school: school._id, user: manager._id }), 0);
  const listed = await invoke(controller.stateManagerSchools, { user: manager.toObject() });
  assert.equal(listed.body.schools.length, 1, JSON.stringify(listed.body));
  assert.equal(String(listed.body.schools[0].stateManagerId), String(manager._id));
});

test("state-manager school scope lists assignments directly, without request linkage", async () => {
  const manager = await User.create({
    fullName: "Assigned Manager",
    phone: `082${Date.now()}`,
    email: `assigned-${Date.now()}@test.invalid`,
    password: "Password123!",
    role: "STATE_MANAGER",
    status: "ACTIVE",
    state: "Lagos",
  });
  const school = await School.create({
    name: "Direct Assignment Academy",
    address: "Ikeja",
    state: "Lagos",
    status: "APPROVED",
    active: true,
    stateManagerId: manager._id,
  });
  const listed = await invoke(controller.stateManagerSchools, { user: manager.toObject() });
  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  assert.equal(listed.body.schools.length, 1);
  assert.equal(String(listed.body.schools[0]._id), String(school._id));
});

test("aggregator-origin approval inherits persisted provenance without granting portal access", async () => {
  const dbName = `edupay_agent_${crypto.randomBytes(8).toString("hex")}`;
  const zonal = await User.create({
    fullName: "Zonal Manager",
    phone: `083${Date.now()}`,
    email: `zonal-${dbName}@test.invalid`,
    password: "Password123!",
    role: "ZONAL_MANAGER",
    status: "ACTIVE",
  });
  const manager = await User.create({
    fullName: "State Manager",
    phone: `084${Date.now()}`,
    email: `manager-${dbName}@test.invalid`,
    password: "Password123!",
    role: "STATE_MANAGER",
    status: "ACTIVE",
    state: "Lagos",
    zone: "SOUTH",
    zonalManagerId: zonal._id,
  });
  const aggregator = await User.create({
    fullName: "Aggregator Agent",
    phone: `085${Date.now()}`,
    email: `agent-${dbName}@test.invalid`,
    password: "Password123!",
    role: "AGENT",
    status: "ACTIVE",
    stateManagerId: manager._id,
    zonalManagerId: zonal._id,
  });
  const reviewer = await User.create({
    fullName: "Head Office",
    phone: `086${Date.now()}`,
    email: `reviewer-${dbName}@test.invalid`,
    password: "Password123!",
    role: "HEAD_OFFICE",
    status: "ACTIVE",
  });
  const request = await SchoolRequest.create({
    parent: aggregator._id,
    createdBy: aggregator._id,
    createdByRole: "AGENT",
    aggregatorId: aggregator._id,
    stateManagerId: manager._id,
    zonalManagerId: zonal._id,
    schoolName: "Aggregator Review Academy",
    normalizedSchoolName: "AGGREGATOR REVIEW ACADEMY",
    location: "Ikeja",
    normalizedLocation: "IKEJA",
    contactPhone: "08012345678",
    schoolType: "PRIMARY",
    registrationNumber: "REG-AGENT-1",
    state: "Lagos",
    lga: "Ikeja",
    contactPerson: "Representative",
    email: "representative@test.invalid",
    authorizedRepresentative: "Verified Representative",
  });
  const unconfirmed = await invoke(controller.adminSchoolRequestAction, {
    user: reviewer.toObject(),
    params: { requestId: request._id.toString() },
    body: { action: "APPROVE" },
  });
  assert.equal(unconfirmed.status, 400);
  assert.equal(await School.countDocuments({}), 0);
  assert.equal((await SchoolRequest.findById(request._id)).status, "PENDING_REVIEW");

  const approved = await invoke(controller.adminSchoolRequestAction, {
    user: reviewer.toObject(),
    params: { requestId: request._id.toString() },
    body: {
      action: "APPROVE",
      representativeAuthorityConfirmed: true,
      aggregatorId: reviewer._id,
      stateManagerId: zonal._id,
      zonalManagerId: aggregator._id,
    },
  });
  assert.equal(approved.status, 200);
  const school = await School.findById(approved.body.request.schoolId).lean();
  assert.equal(school.status, "APPROVED");
  assert.equal(school.active, true);
  assert.equal(String(school.createdBy), String(aggregator._id));
  assert.equal(school.createdByRole, "AGENT");
  assert.equal(String(school.aggregatorId), String(aggregator._id));
  assert.equal(String(school.stateManagerId), String(manager._id));
  assert.equal(String(school.zonalManagerId), String(zonal._id));
  assert.equal(school.authorizedRepresentative, "Verified Representative");
  assert.equal(school.portalUser, null);
  assert.equal(await SchoolUser.countDocuments({ school: school._id }), 0);
});

test("approval refuses an already-linked school owned by another Aggregator without rewriting provenance", async () => {
  const dbName = `edupay_agent_idor_${crypto.randomBytes(8).toString("hex")}`;
  const zonal = await User.create({
    fullName: "Zonal Manager",
    phone: `095${Date.now()}`,
    email: `zonal-${dbName}@test.invalid`,
    password: "Password123!",
    role: "ZONAL_MANAGER",
    status: "ACTIVE",
  });
  const manager = await User.create({
    fullName: "State Manager",
    phone: `096${Date.now()}`,
    email: `manager-${dbName}@test.invalid`,
    password: "Password123!",
    role: "STATE_MANAGER",
    status: "ACTIVE",
    state: "Lagos",
    zone: "SOUTH",
    zonalManagerId: zonal._id,
  });
  const firstAggregator = await User.create({
    fullName: "First Aggregator",
    phone: `097${Date.now()}`,
    email: `agent-first-${dbName}@test.invalid`,
    password: "Password123!",
    role: "AGENT",
    status: "ACTIVE",
  });
  const otherAggregator = await User.create({
    fullName: "Other Aggregator",
    phone: `098${Date.now()}`,
    email: `agent-other-${dbName}@test.invalid`,
    password: "Password123!",
    role: "AGENT",
    status: "ACTIVE",
  });
  const reviewer = await User.create({
    fullName: "Head Office",
    phone: `099${Date.now()}`,
    email: `reviewer-${dbName}@test.invalid`,
    password: "Password123!",
    role: "HEAD_OFFICE",
    status: "ACTIVE",
  });
  const request = await SchoolRequest.create({
    parent: firstAggregator._id,
    createdBy: firstAggregator._id,
    createdByRole: "AGENT",
    aggregatorId: firstAggregator._id,
    stateManagerId: manager._id,
    zonalManagerId: zonal._id,
    schoolName: "Already Owned Academy",
    normalizedSchoolName: "ALREADY OWNED ACADEMY",
    location: "Ikeja",
    normalizedLocation: "IKEJA",
    state: "Lagos",
    authorizedRepresentative: "Representative",
  });
  const existingSchool = await School.create({
    name: "Already Owned Academy",
    address: "Ikeja",
    state: "Lagos",
    status: "APPROVED",
    active: true,
    portalUser: null,
    createdBy: otherAggregator._id,
    createdByRole: "AGENT",
    aggregatorId: otherAggregator._id,
    stateManagerId: manager._id,
    zonalManagerId: zonal._id,
    sourceRequest: request._id,
    sourceRequestNormalizedSchoolName: "ALREADY OWNED ACADEMY",
    sourceRequestNormalizedLocation: "IKEJA",
    normalizedSchoolName: "ALREADY OWNED ACADEMY",
    normalizedLocation: "IKEJA",
  });
  await SchoolRequest.updateOne({ _id: request._id }, { $set: { school: existingSchool._id } });
  const response = await invoke(controller.adminSchoolRequestAction, {
    user: reviewer.toObject(),
    params: { requestId: request._id.toString() },
    body: { action: "APPROVE", representativeAuthorityConfirmed: true },
  });
  assert.equal(response.status, 409);
  assert.equal(response.body.code, "SCHOOL_REQUEST_LINK_MISMATCH");
  const unchanged = await School.findById(existingSchool._id).lean();
  assert.equal(String(unchanged.createdBy), String(otherAggregator._id));
  assert.equal(unchanged.createdByRole, "AGENT");
  assert.equal(String(unchanged.aggregatorId), String(otherAggregator._id));
  assert.equal(String(unchanged.stateManagerId), String(manager._id));
  assert.equal(String(unchanged.zonalManagerId), String(zonal._id));
  assert.equal((await SchoolRequest.findById(request._id)).status, "PENDING_REVIEW");
  assert.equal(await Audit.countDocuments({ action: "EDUPAY_SCHOOL_REQUEST_APPROVED", entityId: request._id }), 0);
});

test("aggregator enrollment stores fenced current ownership on a pending request only", async () => {
  const dbName = `edupay_create_agent_${crypto.randomBytes(8).toString("hex")}`;
  const zonal = await User.create({
    fullName: "Zonal Manager",
    phone: `090${Date.now()}`,
    email: `zonal-${dbName}@test.invalid`,
    password: "Password123!",
    role: "ZONAL_MANAGER",
    status: "ACTIVE",
    zone: "SOUTH",
  });
  const manager = await User.create({
    fullName: "State Manager",
    phone: `091${Date.now()}`,
    email: `manager-${dbName}@test.invalid`,
    password: "Password123!",
    role: "STATE_MANAGER",
    status: "ACTIVE",
    state: "Lagos",
    zone: "SOUTH",
    zonalManagerId: zonal._id,
  });
  const aggregator = await User.create({
    fullName: "Aggregator Agent",
    phone: `092${Date.now()}`,
    email: `agent-${dbName}@test.invalid`,
    password: "Password123!",
    role: "AGENT",
    status: "ACTIVE",
    state: "Lagos",
    zone: "SOUTH",
    stateManagerId: manager._id,
    zonalManagerId: zonal._id,
  });
  const body = {
    schoolName: "Direct Aggregator Academy",
    location: "Ikeja",
    state: "Lagos",
    schoolType: "PRIMARY",
    lga: "Ikeja",
    contactPerson: "Representative",
    phone: "08012345671",
    email: `school-${dbName}@test.invalid`,
    registrationNumber: `REG-${dbName}`,
    authorizedRepresentative: "Representative",
    aggregatorId: zonal._id,
    stateManagerId: zonal._id,
    zonalManagerId: aggregator._id,
    createdBy: zonal._id,
    createdByRole: "STATE_MANAGER",
  };
  const created = await invoke(controller.aggregatorCreateSchool, { user: aggregator.toObject(), body });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const request = await SchoolRequest.findById(created.body.request.id).lean();
  assert.equal(request.status, "PENDING_REVIEW");
  assert.equal(String(request.parent), String(aggregator._id));
  assert.equal(String(request.createdBy), String(aggregator._id));
  assert.equal(request.createdByRole, "AGENT");
  assert.equal(String(request.aggregatorId), String(aggregator._id));
  assert.equal(String(request.stateManagerId), String(manager._id));
  assert.equal(String(request.zonalManagerId), String(zonal._id));
  assert.equal(await School.countDocuments({}), 0);
  const creationAudit = await Audit.findOne({ action: "EDUPAY_AGGREGATOR_SCHOOL_CREATED", entityId: request._id }).lean();
  assert.equal(String(creationAudit.metadata.aggregatorId), String(aggregator._id));
  assert.equal(String(creationAudit.metadata.stateManagerId), String(manager._id));
  assert.equal(String(creationAudit.metadata.zonalManagerId), String(zonal._id));

  const listed = await invoke(controller.stateManagerSchools, { user: manager.toObject() });
  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  assert.equal(listed.body.requests.length, 1);
  assert.equal(String(listed.body.requests[0].id), String(request._id));

  const duplicateFromOwner = await invoke(controller.aggregatorCreateSchool, {
    user: aggregator.toObject(),
    body,
  });
  assert.equal(duplicateFromOwner.status, 409);
  assert.equal(duplicateFromOwner.body.code, "ACTIVE_SCHOOL_REQUEST_EXISTS");
  assert.equal(String(duplicateFromOwner.body.request.id), String(request._id));

  const peerAggregator = await User.create({
    fullName: "Second Aggregator Agent",
    phone: `094${Date.now()}`,
    email: `peer-agent-${dbName}@test.invalid`,
    password: "Password123!",
    role: "AGENT",
    status: "ACTIVE",
    state: "Lagos",
    zone: "SOUTH",
    stateManagerId: manager._id,
    zonalManagerId: zonal._id,
  });
  const duplicateFromPeer = await invoke(controller.aggregatorCreateSchool, {
    user: peerAggregator.toObject(),
    body,
  });
  assert.equal(duplicateFromPeer.status, 409);
  assert.equal(duplicateFromPeer.body.code, "ACTIVE_SCHOOL_REQUEST_EXISTS");
  assert.deepEqual(Object.keys(duplicateFromPeer.body).sort(), ["code", "message", "success"]);
  assert.equal(await SchoolRequest.countDocuments({ stateManagerId: manager._id }), 1);

  const concurrentBody = {
    ...body,
    schoolName: "Concurrent Aggregator Academy",
    location: "Surulere",
    email: `concurrent-${dbName}@test.invalid`,
    phone: "08012345672",
    registrationNumber: `REG-CONCURRENT-${dbName}`,
  };
  const concurrent = await Promise.all([
    invoke(controller.aggregatorCreateSchool, { user: aggregator.toObject(), body: concurrentBody }),
    invoke(controller.aggregatorCreateSchool, { user: aggregator.toObject(), body: concurrentBody }),
  ]);
  assert.deepEqual(concurrent.map((response) => response.status).sort(), [201, 409]);
  assert.equal(await SchoolRequest.countDocuments({
    parent: aggregator._id,
    normalizedSchoolName: "CONCURRENT AGGREGATOR ACADEMY",
    normalizedLocation: "SURULERE",
  }), 1);
  const concurrentRequest = await SchoolRequest.findOne({
    parent: aggregator._id,
    normalizedSchoolName: "CONCURRENT AGGREGATOR ACADEMY",
  });
  assert.ok(concurrentRequest);

  const newManager = await User.create({
    fullName: "New State Manager",
    phone: `093${Date.now()}`,
    email: `new-manager-${dbName}@test.invalid`,
    password: "Password123!",
    role: "STATE_MANAGER",
    status: "ACTIVE",
    state: "Lagos",
    zone: "SOUTH",
    zonalManagerId: zonal._id,
  });
  await User.updateOne({ _id: aggregator._id }, { $set: { stateManagerId: newManager._id } });
  const previousParentList = await invoke(controller.stateManagerSchools, { user: manager.toObject() });
  assert.equal(previousParentList.status, 200, JSON.stringify(previousParentList.body));
  assert.equal(previousParentList.body.requests.length, 0);
  const currentParentList = await invoke(controller.stateManagerSchools, { user: newManager.toObject() });
  assert.equal(currentParentList.status, 200, JSON.stringify(currentParentList.body));
  assert.equal(currentParentList.body.requests.length, 2);

  const duplicate = await invoke(controller.aggregatorCreateSchool, { user: aggregator.toObject(), body });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, "ACTIVE_SCHOOL_REQUEST_EXISTS");
  const wrongState = await invoke(controller.aggregatorCreateSchool, {
    user: aggregator.toObject(),
    body: { ...body, schoolName: "Out of State Academy", state: "Kano", registrationNumber: `REG-OTHER-${dbName}` },
  });
  assert.equal(wrongState.status, 403);
  assert.equal(wrongState.body.code, "STATE_SCOPE_FORBIDDEN");

  const incomplete = await invoke(controller.aggregatorCreateSchool, {
    user: aggregator.toObject(),
    body: { schoolName: "Incomplete Academy" },
  });
  assert.equal(incomplete.status, 400);
  assert.equal(incomplete.body.code, "SCHOOL_FIELDS_REQUIRED");
});

test("legacy direct assignments never outlive resolvable owners and retain live-owner parity", async () => {
  const dbName = `edupay_legacy_agent_reparent_${crypto.randomBytes(8).toString("hex")}`;
  const zonal = await User.create({
    fullName: "Zonal Manager",
    phone: `095${Date.now()}`,
    email: `zonal-${dbName}@test.invalid`,
    password: "Password123!",
    role: "ZONAL_MANAGER",
    status: "ACTIVE",
    zone: "SOUTH",
  });
  const oldManager = await User.create({
    fullName: "Old State Manager",
    phone: `096${Date.now()}`,
    email: `old-manager-${dbName}@test.invalid`,
    password: "Password123!",
    role: "STATE_MANAGER",
    status: "ACTIVE",
    state: "Lagos",
    zone: "SOUTH",
    zonalManagerId: zonal._id,
  });
  const newManager = await User.create({
    fullName: "New State Manager",
    phone: `097${Date.now()}`,
    email: `new-manager-${dbName}@test.invalid`,
    password: "Password123!",
    role: "STATE_MANAGER",
    status: "ACTIVE",
    state: "Lagos",
    zone: "SOUTH",
    zonalManagerId: zonal._id,
  });
  const aggregator = await User.create({
    fullName: "Legacy Aggregator",
    phone: `098${Date.now()}`,
    email: `legacy-agent-${dbName}@test.invalid`,
    password: "Password123!",
    role: "AGENT",
    status: "ACTIVE",
    state: "Lagos",
    zone: "SOUTH",
    stateManagerId: oldManager._id,
    zonalManagerId: zonal._id,
  });
  const customer = await User.create({
    fullName: "Moving Customer",
    phone: `099${Date.now()}`,
    email: `moving-customer-${dbName}@test.invalid`,
    password: "Password123!",
    role: "CUSTOMER",
    status: "ACTIVE",
    state: "Lagos",
    zone: "SOUTH",
    stateManagerId: oldManager._id,
    zonalManagerId: zonal._id,
  });
  const deletedCustomer = await User.create({
    fullName: "Soft Deleted Customer",
    phone: `100${Date.now()}`,
    email: `deleted-customer-${dbName}@test.invalid`,
    password: "Password123!",
    role: "CUSTOMER",
    status: "ACTIVE",
    isDeleted: true,
    state: "Lagos",
    zone: "SOUTH",
    stateManagerId: oldManager._id,
    zonalManagerId: zonal._id,
  });
  const promotedAgent = await User.create({
    fullName: "Promoted Aggregator",
    phone: `101${Date.now()}`,
    email: `promoted-agent-${dbName}@test.invalid`,
    password: "Password123!",
    role: "AGENT",
    status: "ACTIVE",
    state: "Lagos",
    zone: "SOUTH",
    stateManagerId: oldManager._id,
    zonalManagerId: zonal._id,
  });
  const unresolvedOwnerId = new mongoose.Types.ObjectId();
  const school = await School.create({
    name: "Legacy Agent School",
    address: "Ikeja",
    state: "Lagos",
    status: "APPROVED",
    active: true,
    createdBy: aggregator._id,
    createdByRole: "AGENT",
    aggregatorId: null,
    stateManagerId: oldManager._id,
    zonalManagerId: zonal._id,
  });
  const request = await SchoolRequest.create({
    parent: aggregator._id,
    createdBy: aggregator._id,
    createdByRole: "AGENT",
    aggregatorId: null,
    stateManagerId: oldManager._id,
    zonalManagerId: zonal._id,
    schoolName: "Legacy Agent Request",
    normalizedSchoolName: "LEGACY AGENT REQUEST",
    location: "Surulere",
    normalizedLocation: "SURULERE",
    state: "Lagos",
    authorizedRepresentative: "Representative",
  });
  const customerSchool = await School.create({
    name: "Moved Customer School",
    address: "Yaba",
    state: "Lagos",
    status: "APPROVED",
    active: true,
    createdBy: customer._id,
    aggregatorId: null,
    stateManagerId: oldManager._id,
  });
  const promotedSchool = await School.create({
    name: "Promoted Agent School",
    address: "Surulere",
    state: "Lagos",
    status: "APPROVED",
    active: true,
    createdBy: promotedAgent._id,
    createdByRole: "AGENT",
    aggregatorId: null,
    stateManagerId: oldManager._id,
  });
  const promotedCurrentSchool = await School.create({
    name: "Promoted Agent Current Owner School",
    address: "Mushin",
    state: "Lagos",
    status: "APPROVED",
    active: true,
    createdBy: promotedAgent._id,
    createdByRole: "STATE_MANAGER",
    aggregatorId: null,
    stateManagerId: null,
  });
  const unresolvedSchool = await School.create({
    name: "Unresolved Legacy School",
    address: "Ojuelegba",
    state: "Lagos",
    status: "APPROVED",
    active: true,
    createdBy: unresolvedOwnerId,
    aggregatorId: null,
    stateManagerId: oldManager._id,
  });
  const customerRequest = await SchoolRequest.create({
    parent: customer._id,
    createdBy: customer._id,
    aggregatorId: null,
    stateManagerId: oldManager._id,
    schoolName: "Moved Customer Request",
    normalizedSchoolName: "MOVED CUSTOMER REQUEST",
    location: "Yaba",
    normalizedLocation: "YABA",
    state: "Lagos",
  });
  const parentOnlyRequest = await SchoolRequest.create({
    parent: customer._id,
    aggregatorId: null,
    stateManagerId: oldManager._id,
    schoolName: "Parent Only Customer Request",
    normalizedSchoolName: "PARENT ONLY CUSTOMER REQUEST",
    location: "Ikeja",
    normalizedLocation: "IKEJA",
    state: "Lagos",
  });
  const dualOwnerRequest = await SchoolRequest.create({
    parent: customer._id,
    createdBy: oldManager._id,
    createdByRole: "STATE_MANAGER",
    aggregatorId: null,
    stateManagerId: oldManager._id,
    schoolName: "Current Creator Parent Elsewhere",
    normalizedSchoolName: "CURRENT CREATOR PARENT ELSEWHERE",
    location: "Victoria Island",
    normalizedLocation: "VICTORIA ISLAND",
    state: "Lagos",
  });
  const deletedCustomerRequest = await SchoolRequest.create({
    parent: deletedCustomer._id,
    aggregatorId: null,
    stateManagerId: oldManager._id,
    schoolName: "Deleted Customer Request",
    normalizedSchoolName: "DELETED CUSTOMER REQUEST",
    location: "Lekki",
    normalizedLocation: "LEKKI",
    state: "Lagos",
  });
  const promotedRequest = await SchoolRequest.create({
    parent: promotedAgent._id,
    createdBy: promotedAgent._id,
    createdByRole: "AGENT",
    aggregatorId: null,
    stateManagerId: oldManager._id,
    schoolName: "Promoted Agent Request",
    normalizedSchoolName: "PROMOTED AGENT REQUEST",
    location: "Ikorodu",
    normalizedLocation: "IKORODU",
    state: "Lagos",
  });
  const promotedCurrentRequest = await SchoolRequest.create({
    parent: promotedAgent._id,
    createdBy: promotedAgent._id,
    createdByRole: "STATE_MANAGER",
    aggregatorId: null,
    stateManagerId: null,
    schoolName: "Promoted Agent Current Owner Request",
    normalizedSchoolName: "PROMOTED AGENT CURRENT OWNER REQUEST",
    location: "Ketu",
    normalizedLocation: "KETU",
    state: "Lagos",
  });
  const unresolvedRequest = await SchoolRequest.create({
    parent: unresolvedOwnerId,
    createdBy: unresolvedOwnerId,
    aggregatorId: null,
    stateManagerId: oldManager._id,
    schoolName: "Unresolved Legacy Request",
    normalizedSchoolName: "UNRESOLVED LEGACY REQUEST",
    location: "Agege",
    normalizedLocation: "AGEGE",
    state: "Lagos",
  });

  await User.updateOne({ _id: aggregator._id }, { $set: { stateManagerId: newManager._id } });
  await User.updateOne({ _id: customer._id }, { $set: { stateManagerId: newManager._id } });
  await User.updateOne({ _id: promotedAgent._id }, { $set: { role: "STATE_MANAGER" } });
  const oldManagerRecords = await invoke(controller.stateManagerSchools, { user: oldManager.toObject() });
  assert.equal(oldManagerRecords.status, 200, JSON.stringify(oldManagerRecords.body));
  assert.equal(oldManagerRecords.body.schools.some((row) => String(row._id || row.id) === String(school._id)), false);
  assert.equal(oldManagerRecords.body.schools.some((row) => String(row._id || row.id) === String(customerSchool._id)), false);
  assert.equal(oldManagerRecords.body.schools.some((row) => String(row._id || row.id) === String(promotedSchool._id)), false);
  assert.equal(oldManagerRecords.body.schools.some((row) => String(row._id || row.id) === String(promotedCurrentSchool._id)), false);
  assert.equal(oldManagerRecords.body.schools.some((row) => String(row._id || row.id) === String(unresolvedSchool._id)), true);
  assert.equal(oldManagerRecords.body.requests.some((row) => String(row.id) === String(request._id)), false);
  assert.equal(oldManagerRecords.body.requests.some((row) => String(row.id) === String(customerRequest._id)), false);
  assert.equal(oldManagerRecords.body.requests.some((row) => String(row.id) === String(parentOnlyRequest._id)), false);
  assert.equal(oldManagerRecords.body.requests.some((row) => String(row.id) === String(deletedCustomerRequest._id)), false);
  assert.equal(oldManagerRecords.body.requests.some((row) => String(row.id) === String(promotedRequest._id)), false);
  assert.equal(oldManagerRecords.body.requests.some((row) => String(row.id) === String(promotedCurrentRequest._id)), false);
  assert.equal(oldManagerRecords.body.requests.some((row) => String(row.id) === String(unresolvedRequest._id)), true);
  // The legacy fallback rejects the moved parent, but the live creator branch
  // must preserve this old-manager-owned request.
  assert.equal(oldManagerRecords.body.requests.some((row) => String(row.id) === String(dualOwnerRequest._id)), true);

  const newManagerRecords = await invoke(controller.stateManagerSchools, { user: newManager.toObject() });
  assert.equal(newManagerRecords.status, 200, JSON.stringify(newManagerRecords.body));
  assert.equal(newManagerRecords.body.schools.some((row) => String(row._id || row.id) === String(school._id)), true);
  assert.equal(newManagerRecords.body.requests.some((row) => String(row.id) === String(request._id)), true);

  const oldSharedList = await invoke(managedRecords.list, {
    user: oldManager.toObject(),
    params: { section: "schools" },
    query: {},
  });
  const oldSharedSummary = await invoke(managedRecords.summary, { user: oldManager.toObject(), query: {} });
  assert.equal(oldSharedList.status, 200, JSON.stringify(oldSharedList.body));
  assert.equal(oldSharedList.body.items.some((row) => String(row._id) === String(customerSchool._id)), false);
  assert.equal(oldSharedList.body.items.some((row) => String(row._id) === String(customerRequest._id)), false);
  assert.equal(oldSharedList.body.items.some((row) => String(row._id) === String(parentOnlyRequest._id)), false);
  assert.equal(oldSharedList.body.items.some((row) => String(row._id) === String(promotedSchool._id)), false);
  assert.equal(oldSharedList.body.items.some((row) => String(row._id) === String(promotedRequest._id)), false);
  assert.equal(oldSharedList.body.items.some((row) => String(row._id) === String(dualOwnerRequest._id)), true);
  assert.equal(oldSharedSummary.status, 200, JSON.stringify(oldSharedSummary.body));
  assert.equal(oldSharedSummary.body.counts.schools, oldSharedList.body.total);

  const newSharedList = await invoke(managedRecords.list, {
    user: newManager.toObject(),
    params: { section: "schools" },
    query: {},
  });
  const newSharedSummary = await invoke(managedRecords.summary, { user: newManager.toObject(), query: {} });
  assert.equal(newSharedList.status, 200, JSON.stringify(newSharedList.body));
  for (const ownedId of [customerSchool._id, customerRequest._id, parentOnlyRequest._id, dualOwnerRequest._id, school._id, request._id]) {
    assert.equal(newSharedList.body.items.some((row) => String(row._id) === String(ownedId)), true);
  }
  assert.equal(newSharedList.body.items.some((row) => String(row._id) === String(promotedSchool._id)), false);
  assert.equal(newSharedList.body.items.some((row) => String(row._id) === String(promotedRequest._id)), false);
  assert.equal(newSharedList.body.items.some((row) => String(row._id) === String(promotedCurrentSchool._id)), false);
  assert.equal(newSharedList.body.items.some((row) => String(row._id) === String(promotedCurrentRequest._id)), false);
  assert.equal(newSharedSummary.status, 200, JSON.stringify(newSharedSummary.body));
  assert.equal(newSharedSummary.body.counts.schools, newSharedList.body.total);

  const promotedSharedList = await invoke(managedRecords.list, {
    user: promotedAgent.toObject(),
    params: { section: "schools" },
    query: {},
  });
  const promotedSharedSummary = await invoke(managedRecords.summary, { user: promotedAgent.toObject(), query: {} });
  assert.equal(promotedSharedList.status, 200, JSON.stringify(promotedSharedList.body));
  assert.equal(promotedSharedList.body.items.some((row) => String(row._id) === String(promotedSchool._id)), false);
  assert.equal(promotedSharedList.body.items.some((row) => String(row._id) === String(promotedRequest._id)), false);
  assert.equal(promotedSharedList.body.items.some((row) => String(row._id) === String(promotedCurrentSchool._id)), true);
  assert.equal(promotedSharedList.body.items.some((row) => String(row._id) === String(promotedCurrentRequest._id)), true);
  assert.equal(promotedSharedSummary.status, 200, JSON.stringify(promotedSharedSummary.body));
  assert.equal(promotedSharedSummary.body.counts.schools, promotedSharedList.body.total);
});

test("customer and Head Office legacy creation ignore client managed-record ownership fields", async () => {
  const dbName = `edupay_spoof_${crypto.randomBytes(8).toString("hex")}`;
  const customer = await User.create({
    fullName: "Customer",
    phone: `087${Date.now()}`,
    email: `customer-${dbName}@test.invalid`,
    password: "Password123!",
    role: "CUSTOMER",
    status: "ACTIVE",
  });
  const reviewer = await User.create({
    fullName: "Head Office",
    phone: `088${Date.now()}`,
    email: `reviewer-${dbName}@test.invalid`,
    password: "Password123!",
    role: "HEAD_OFFICE",
    status: "ACTIVE",
  });
  const spoofed = {
    aggregatorId: reviewer._id,
    stateManagerId: reviewer._id,
    zonalManagerId: reviewer._id,
  };
  const requested = await invoke(controller.createSchoolRequest, {
    user: customer.toObject(),
    body: { schoolName: "Customer Request Academy", location: "Lagos", contactPhone: "08012345679", ...spoofed },
  });
  assert.equal(requested.status, 201);
  const request = await SchoolRequest.findById(requested.body.request.id).lean();
  assert.equal(request.aggregatorId, null);
  assert.equal(request.stateManagerId, null);
  assert.equal(request.zonalManagerId, null);
  assert.equal(request.createdByRole, null);

  const created = await invoke(controller.adminCreateSchool, {
    user: reviewer.toObject(),
    body: {
      schoolName: "Admin Created Academy",
      schoolType: "PRIMARY",
      proprietorName: "Proprietor",
      email: `school-${dbName}@test.invalid`,
      phone: `089${Date.now()}`,
      address: "Victoria Island",
      state: "Lagos",
      lga: "Eti-Osa",
      temporaryPassword: "Password123!",
      ...spoofed,
    },
  });
  assert.equal(created.status, 201);
  const school = await School.findById(created.body.school._id).lean();
  assert.equal(school.status, "APPROVED");
  assert.equal(school.active, true);
  assert.equal(school.aggregatorId, null);
  assert.equal(school.stateManagerId, null);
  assert.equal(school.zonalManagerId, null);
  assert.equal(school.createdByRole, null);

  const updated = await invoke(controller.adminSchoolUpdate, {
    user: reviewer.toObject(),
    params: { schoolId: school._id.toString() },
    body: { ...spoofed },
  });
  assert.equal(updated.status, 200);
  const afterUpdate = await School.findById(school._id).lean();
  assert.equal(afterUpdate.aggregatorId, null);
  assert.equal(afterUpdate.stateManagerId, null);
  assert.equal(afterUpdate.zonalManagerId, null);
});