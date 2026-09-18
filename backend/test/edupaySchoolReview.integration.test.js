const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mongoose = require("mongoose");

const User = require("../models/user.model");
const School = require("../models/edupaySchool.model");
const SchoolUser = require("../models/edupaySchoolUser.model");
const SchoolRequest = require("../models/edupaySchoolRequest.model");
const Audit = require("../models/edupayAuditLog.model");
const controller = require("../controllers/edupay.controller");
const { school: schoolMiddleware } = require("../middleware/edupay.middleware");

const uri = String(process.env.MONGODB_URI || "").trim();
const dbName = `edupay_sr_${crypto.randomBytes(12).toString("hex")}`;

const invoke = async (handler, req) => {
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

test("school request approval and rejection are atomic, audited, and admit only approved schools", { skip: !uri }, async (t) => {
  await mongoose.connect(uri, { dbName });
  t.after(async () => {
    try {
      await mongoose.connection.dropDatabase();
    } finally {
      await mongoose.disconnect();
    }
  });
  await Promise.all([User, School, SchoolUser, SchoolRequest, Audit].map((model) => model.init()));

  const parent = await User.create({
    fullName: "School Applicant",
    phone: `080${Date.now()}`,
    email: `${dbName}@test.invalid`,
    password: "Password123!",
    role: "CUSTOMER",
    status: "ACTIVE",
  });
  const reviewer = new mongoose.Types.ObjectId();
  const request = await SchoolRequest.create({
    parent: parent._id,
    schoolName: "Unity Academy",
    normalizedSchoolName: "UNITY ACADEMY",
    location: "Kano",
    normalizedLocation: "KANO",
    contactPhone: "08012345678",
  });
  const phoneOnly = await User.create({
    fullName: "Phone Only Representative",
    phone: `082${Date.now()}`,
    password: "Password123!",
    role: "CUSTOMER",
    status: "ACTIVE",
  });
  const phoneOnlyRequest = await SchoolRequest.create({
    parent: phoneOnly._id,
    schoolName: "Phone Only Academy",
    normalizedSchoolName: "PHONE ONLY ACADEMY",
    location: "Enugu",
    normalizedLocation: "ENUGU",
  });
  const phoneOnlyDetail = await invoke(controller.adminSchoolRequestDetail, {
    params: { requestId: phoneOnlyRequest._id.toString() },
  });
  assert.equal(phoneOnlyDetail.body.request.requesterName, "Phone Only Representative");
  assert.equal(phoneOnlyDetail.body.request.requesterEmail, null);
  assert.equal(phoneOnlyDetail.body.request.requesterPhone, phoneOnly.phone);
  assert.equal(phoneOnlyDetail.body.request.contactPhone, null);

  const missingAttestation = await invoke(controller.adminSchoolRequestAction, {
    user: { _id: reviewer },
    params: { requestId: request._id.toString() },
    body: { action: "APPROVE" },
  });
  assert.equal(missingAttestation.status, 400);
  assert.equal(missingAttestation.body.code, "REPRESENTATIVE_AUTHORITY_CONFIRMATION_REQUIRED");
  const falseAttestation = await invoke(controller.adminSchoolRequestAction, {
    user: { _id: reviewer },
    params: { requestId: request._id.toString() },
    body: { action: "APPROVE", representativeAuthorityConfirmed: false },
  });
  assert.equal(falseAttestation.status, 400);

  const approved = await invoke(controller.adminSchoolRequestAction, {
    user: { _id: reviewer },
    params: { requestId: request._id.toString() },
    body: { action: "APPROVE", representativeAuthorityConfirmed: true },
    ip: "127.0.0.1",
  });
  assert.equal(approved.status, undefined);
  assert.equal(approved.body.success, true);
  assert.equal(approved.body.request.status, "APPROVED");
  const saved = await SchoolRequest.findById(request._id).lean();
  assert.equal(saved.status, "APPROVED");
  assert.equal(String(saved.approvedBy), String(reviewer));
  assert.ok(saved.approvedAt);
  assert.ok(saved.school);
  const school = await School.findById(saved.school).lean();
  assert.equal(school.status, "APPROVED");
  assert.equal(school.active, true);
  assert.equal(String(school.portalUser), String(parent._id));
  assert.equal(await SchoolUser.countDocuments({ school: school._id, user: parent._id, role: "ADMIN", status: "ACTIVE" }), 1);
  const approvalAudit = await Audit.findOne({ action: "EDUPAY_SCHOOL_REQUEST_APPROVED", entityId: request._id }).lean();
  assert.equal(approvalAudit.metadata.representativeAuthorityConfirmed, true);
  assert.equal(approvalAudit.metadata.requesterIdentityRef, String(parent._id));
  assert.equal(approvalAudit.metadata.email, undefined);
  assert.equal(approvalAudit.metadata.phone, undefined);
  assert.equal(await Audit.countDocuments({ action: "EDUPAY_SCHOOL_REQUEST_APPROVED", entityId: request._id }), 1);

  const denied = await new Promise((resolve, reject) => {
    const req = { user: { _id: parent._id }, headers: { "x-edupay-school-id": String(school._id) } };
    const res = { status: (status) => ({ json: (body) => resolve({ status, body }) }) };
    schoolMiddleware[1](req, res, (error) => error ? reject(error) : resolve({ status: 200, req }));
  });
  assert.equal(denied.status, 200);

  const duplicateParent = await User.create({
    fullName: "Second Applicant",
    phone: `081${Date.now()}`,
    email: `second-${dbName}@test.invalid`,
    password: "Password123!",
    role: "CUSTOMER",
    status: "ACTIVE",
  });
  const duplicateRequest = await SchoolRequest.create({
    parent: duplicateParent._id,
    schoolName: " Unity   Academy ",
    normalizedSchoolName: "UNITY ACADEMY",
    location: " Kano ",
    normalizedLocation: "KANO",
  });
  const duplicateApproval = await invoke(controller.adminSchoolRequestAction, {
    user: { _id: reviewer },
    params: { requestId: duplicateRequest._id.toString() },
    body: { action: "APPROVE", representativeAuthorityConfirmed: true },
  });
  assert.equal(duplicateApproval.status, 409);
  assert.equal(duplicateApproval.body.code, "SCHOOL_ALREADY_EXISTS");

  await School.create({
    name: "Legacy Academy",
    address: "  Legacy   Road ",
    state: "Lagos",
    status: "APPROVED",
    active: true,
  });
  const legacyRequest = await SchoolRequest.create({
    parent: duplicateParent._id,
    schoolName: "Legacy Academy",
    normalizedSchoolName: "LEGACY ACADEMY",
    location: "Legacy Road",
    normalizedLocation: "LEGACY ROAD",
  });
  const legacyConflict = await invoke(controller.adminSchoolRequestAction, {
    user: { _id: reviewer },
    params: { requestId: legacyRequest._id.toString() },
    body: { action: "APPROVE", representativeAuthorityConfirmed: true },
  });
  assert.equal(legacyConflict.status, 409);
  assert.equal(legacyConflict.body.code, "SCHOOL_ALREADY_EXISTS");

  await School.create({
    name: "Canonical Academy",
    address: "Canonical Road",
    state: "Lagos",
    normalizedSchoolName: "CANONICAL ACADEMY",
    normalizedLocation: "CANONICAL ROAD",
    status: "PENDING_REVIEW",
    active: false,
  });
  const canonicalRequest = await SchoolRequest.create({
    parent: parent._id,
    schoolName: "Canonical Academy",
    normalizedSchoolName: "CANONICAL ACADEMY",
    location: "Canonical Road",
    normalizedLocation: "CANONICAL ROAD",
  });
  const canonicalConflict = await invoke(controller.adminSchoolRequestAction, {
    user: { _id: reviewer },
    params: { requestId: canonicalRequest._id.toString() },
    body: { action: "APPROVE", representativeAuthorityConfirmed: true },
  });
  assert.equal(canonicalConflict.status, 409);
  assert.equal(canonicalConflict.body.code, "SCHOOL_ALREADY_EXISTS");

  const concurrentA = await SchoolRequest.create({
    parent: parent._id,
    schoolName: "Concurrent Duplicate Academy",
    normalizedSchoolName: "CONCURRENT DUPLICATE ACADEMY",
    location: "Ibadan",
    normalizedLocation: "IBADAN",
  });
  const concurrentB = await SchoolRequest.create({
    parent: duplicateParent._id,
    schoolName: "Concurrent Duplicate Academy",
    normalizedSchoolName: "CONCURRENT DUPLICATE ACADEMY",
    location: "Ibadan",
    normalizedLocation: "IBADAN",
  });
  const duplicateRace = await Promise.all([concurrentA, concurrentB].map((candidate) => invoke(controller.adminSchoolRequestAction, {
    user: { _id: reviewer },
    params: { requestId: candidate._id.toString() },
    body: { action: "APPROVE", representativeAuthorityConfirmed: true },
  })));
  assert.ok(duplicateRace.every((response) => response.status === undefined || response.status === 409));
  assert.equal(await School.countDocuments({
    sourceRequestNormalizedSchoolName: "CONCURRENT DUPLICATE ACADEMY",
    sourceRequestNormalizedLocation: "IBADAN",
  }), 1);

  const repeated = await invoke(controller.adminSchoolRequestAction, {
    user: { _id: reviewer },
    params: { requestId: request._id.toString() },
    body: { action: "APPROVE", representativeAuthorityConfirmed: true },
  });
  assert.equal(repeated.status, 409);
  assert.equal(await School.countDocuments({
    sourceRequestNormalizedSchoolName: "UNITY ACADEMY",
    sourceRequestNormalizedLocation: "KANO",
  }), 1);

  const racedRequest = await SchoolRequest.create({
    parent: parent._id,
    schoolName: "Raced Academy",
    normalizedSchoolName: "RACED ACADEMY",
    location: "Kaduna",
    normalizedLocation: "KADUNA",
  });
  const raced = await Promise.all([
    invoke(controller.adminSchoolRequestAction, {
      user: { _id: reviewer },
      params: { requestId: racedRequest._id.toString() },
      body: { action: "APPROVE", representativeAuthorityConfirmed: true },
    }),
    invoke(controller.adminSchoolRequestAction, {
      user: { _id: reviewer },
      params: { requestId: racedRequest._id.toString() },
      body: { action: "APPROVE", representativeAuthorityConfirmed: true },
    }),
  ]);
  assert.equal(raced.filter((response) => response.status === undefined).length, 1);
  assert.equal(raced.filter((response) => response.status === 409).length, 1);
  assert.equal(await School.countDocuments({ name: "Raced Academy" }), 1);

  const mismatchRequest = await SchoolRequest.create({
    parent: parent._id,
    schoolName: "Mismatch Academy",
    normalizedSchoolName: "MISMATCH ACADEMY",
    location: "Lagos",
    normalizedLocation: "LAGOS",
  });
  const mismatchedSchool = await School.create({
    name: "Other Academy",
    address: "Other Location",
    state: "Other Location",
    status: "APPROVED",
    active: true,
    sourceRequest: new mongoose.Types.ObjectId(),
    sourceRequestNormalizedSchoolName: "OTHER ACADEMY",
    sourceRequestNormalizedLocation: "OTHER LOCATION",
  });
  await SchoolRequest.updateOne({ _id: mismatchRequest._id }, { $set: { school: mismatchedSchool._id } });
  const mismatch = await invoke(controller.adminSchoolRequestAction, {
    user: { _id: reviewer },
    params: { requestId: mismatchRequest._id.toString() },
    body: { action: "APPROVE", representativeAuthorityConfirmed: true },
  });
  assert.equal(mismatch.status, 409);
  assert.equal((await SchoolRequest.findById(mismatchRequest._id).lean()).status, "PENDING_REVIEW");

  const longLocation = "L".repeat(240);
  const longRequest = await SchoolRequest.create({
    parent: parent._id,
    schoolName: "Long Address Academy",
    normalizedSchoolName: "LONG ADDRESS ACADEMY",
    location: longLocation,
    normalizedLocation: longLocation,
  });
  const longApproval = await invoke(controller.adminSchoolRequestAction, {
    user: { _id: reviewer },
    params: { requestId: longRequest._id.toString() },
    body: { action: "APPROVE", representativeAuthorityConfirmed: true },
  });
  assert.equal(longApproval.status, undefined);
  const longSchool = await School.findById(longApproval.body.request.schoolId).lean();
  assert.equal(longSchool.address, longLocation);
  assert.equal(longSchool.state, "Not specified");

  const rejectedRequest = await SchoolRequest.create({
    parent: parent._id,
    schoolName: "Rejected Academy",
    normalizedSchoolName: "REJECTED ACADEMY",
    location: "Abuja",
    normalizedLocation: "ABUJA",
  });
  const missingReason = await invoke(controller.adminSchoolRequestAction, {
    user: { _id: reviewer },
    params: { requestId: rejectedRequest._id.toString() },
    body: { action: "REJECT" },
  });
  assert.equal(missingReason.status, 400);
  const rejected = await invoke(controller.adminSchoolRequestAction, {
    user: { _id: reviewer },
    params: { requestId: rejectedRequest._id.toString() },
    body: { action: "REJECT", rejectionReason: "Unable to verify the submitted school details." },
  });
  assert.equal(rejected.status, undefined);
  assert.equal(rejected.body.request.status, "REJECTED");
  assert.equal(await School.countDocuments({ name: "Rejected Academy" }), 0);
  assert.equal(await Audit.countDocuments({ action: "EDUPAY_SCHOOL_REQUEST_REJECTED", entityId: rejectedRequest._id }), 1);

  const invalidFilter = await invoke(controller.adminSchoolRequests, { query: { status: "NOT_A_STATUS" } });
  assert.equal(invalidFilter.status, 400);
});