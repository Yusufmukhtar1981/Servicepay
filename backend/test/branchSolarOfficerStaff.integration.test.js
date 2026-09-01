const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const controller = require("../controllers/branch.controller");
const User = require("../models/user.model");
const Branch = require("../models/branch.model");
const SolarOfficer = require("../models/solarOfficer.model");
const SolarAssignment = require("../models/solarAssignment.model");
const SolarApplication = require("../models/solarApplication.model");

let mongo; let sequence = 0;
const response = () => {
  const result = { statusCode: 200, body: null };
  result.status = (code) => { result.statusCode = code; return result; };
  result.json = (body) => { result.body = body; return result; };
  return result;
};
const managerAndBranch = async (located) => {
  const manager = await User.create({ fullName: "Manager", phone: `0807${++sequence}000000`, email: `m${sequence}@solar.test`, password: "Password123!", role: "BRANCH_MANAGER", isStaff: true });
  const branch = await Branch.create({ code: `S${sequence}`, name: "Solar branch", status: "ACTIVE", createdBy: manager._id, managerId: manager._id, ...(located ? { state: "Lagos", lga: "Ikeja", address: "1 Branch Road" } : {}) });
  manager.branchId = branch._id; await manager.save({ validateBeforeSave: false });
  return { manager, branch };
};
const req = (manager, branch, body, params = {}) => ({
  method: "POST", body, params: { branchId: String(branch._id), ...params },
  user: manager, staffAccess: { isHeadOffice: false, scope: { type: "BRANCH", branchId: branch._id } },
});

test.before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(mongo.getUri(), { dbName: "branch-solar-staff" });
  await Promise.all([User.init(), Branch.init(), SolarOfficer.init(), SolarAssignment.init(), SolarApplication.init()]);
});
test.after(async () => { await mongoose.disconnect(); await mongo.stop(); });
test.beforeEach(async () => Promise.all([User, Branch, SolarOfficer, SolarAssignment, SolarApplication].map((model) => model.deleteMany({}))));

test("missing branch location rejects Solar staff without partial writes", async () => {
  const { manager, branch } = await managerAndBranch(false); const res = response();
  await controller.staff(req(manager, branch, { fullName: "Solar", phone: "08030000001", jobTitle: "SOLAR_OFFICER" }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(await User.countDocuments({ branchId: branch._id, jobTitle: "SOLAR_OFFICER" }), 0);
  assert.equal(await SolarOfficer.countDocuments(), 0);
  assert.deepEqual((await Branch.findById(branch._id)).staffIds, []);
});

test("successful Solar staff create commits user, profile and membership", async () => {
  const { manager, branch } = await managerAndBranch(true); const res = response();
  await controller.staff(req(manager, branch, { fullName: "Solar", phone: "08030000002", jobTitle: "SOLAR_OFFICER" }), res);
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  const staff = await User.findOne({ branchId: branch._id, jobTitle: "SOLAR_OFFICER" });
  assert.ok(staff); assert.ok(await SolarOfficer.findOne({ user: staff._id, branchId: branch._id }));
  assert.ok((await Branch.findById(branch._id)).staffIds.some((id) => String(id) === String(staff._id)));
});

test("conversion prevalidation preserves existing job title", async () => {
  const { manager, branch } = await managerAndBranch(false);
  const staff = await User.create({ fullName: "Staff", phone: "08030000003", password: "Password123!", role: "STAFF", isStaff: true, branchId: branch._id, jobTitle: "GENERAL_STAFF" });
  const res = response();
  await controller.updateStaff(req(manager, branch, { jobTitle: "SOLAR_OFFICER" }, { staffId: String(staff._id) }), res);
  assert.equal(res.statusCode, 400);
  assert.equal((await User.findById(staff._id)).jobTitle, "GENERAL_STAFF");
});

test("conversion away deactivates profile and stale profile cannot be assigned", async () => {
  const { manager, branch } = await managerAndBranch(true); const create = response();
  await controller.staff(req(manager, branch, { fullName: "Solar", phone: "08030000004", jobTitle: "SOLAR_OFFICER" }), create);
  const staff = await User.findOne({ branchId: branch._id, jobTitle: "SOLAR_OFFICER" });
  const update = response();
  await controller.updateStaff(req(manager, branch, { jobTitle: "GENERAL_STAFF" }, { staffId: String(staff._id) }), update);
  assert.equal(update.statusCode, 200, JSON.stringify(update.body));
  assert.equal((await SolarOfficer.findOne({ user: staff._id })).status, "INACTIVE");
  await SolarOfficer.updateOne({ user: staff._id }, { $set: { status: "ACTIVE" } });
  const applicationId = new mongoose.Types.ObjectId();
  await SolarApplication.collection.insertOne({ _id: applicationId, branchId: branch._id, customer: manager._id });
  const assign = response();
  await controller.assignSolarOfficer(req(manager, branch, { officerId: String(staff._id) }, { applicationId: String(applicationId) }), assign);
  assert.equal(assign.statusCode, 409);
});

test("conversion with active assignment is rejected atomically", async () => {
  const { manager, branch } = await managerAndBranch(true); const create = response();
  await controller.staff(req(manager, branch, { fullName: "Solar", phone: "08030000005", jobTitle: "SOLAR_OFFICER" }), create);
  const staff = await User.findOne({ branchId: branch._id, jobTitle: "SOLAR_OFFICER" });
  const profile = await SolarOfficer.findOne({ user: staff._id });
  await SolarAssignment.collection.insertOne({
    branchId: branch._id, application: new mongoose.Types.ObjectId(),
    customer: manager._id, officer: profile._id, assignedBy: manager._id,
    status: "ACTIVE", assignedAt: new Date(),
  });
  const update = response();
  await controller.updateStaff(req(manager, branch, { jobTitle: "GENERAL_STAFF" }, { staffId: String(staff._id) }), update);
  assert.equal(update.statusCode, 409);
  assert.equal((await User.findById(staff._id)).jobTitle, "SOLAR_OFFICER");
  assert.equal((await SolarOfficer.findById(profile._id)).status, "ACTIVE");
  assert.equal(await SolarAssignment.countDocuments({ officer: profile._id, status: "ACTIVE" }), 1);
});

test("assignment racing conversion never leaves active work on ineligible staff", async () => {
  const { manager, branch } = await managerAndBranch(true); const create = response();
  await controller.staff(req(manager, branch, { fullName: "Solar", phone: "08030000006", jobTitle: "SOLAR_OFFICER" }), create);
  const staff = await User.findOne({ branchId: branch._id, jobTitle: "SOLAR_OFFICER" });
  const profile = await SolarOfficer.findOne({ user: staff._id });
  const applicationId = new mongoose.Types.ObjectId();
  await SolarApplication.collection.insertOne({ _id: applicationId, branchId: branch._id, customer: manager._id });
  const conversion = response(); const assignment = response();
  await Promise.all([
    controller.updateStaff(req(manager, branch, { jobTitle: "GENERAL_STAFF" }, { staffId: String(staff._id) }), conversion),
    controller.assignSolarOfficer(req(manager, branch, { officerId: String(staff._id) }, { applicationId: String(applicationId) }), assignment),
  ]);
  const freshStaff = await User.findById(staff._id);
  const freshProfile = await SolarOfficer.findById(profile._id);
  const active = await SolarAssignment.countDocuments({ officer: profile._id, status: "ACTIVE" });
  const assignmentWon = assignment.statusCode === 201;
  const conversionWon = conversion.statusCode === 200;
  assert.equal(Number(assignmentWon) + Number(conversionWon), 1, JSON.stringify({ conversion, assignment }));
  if (assignmentWon) {
    assert.equal(conversion.statusCode, 409);
    assert.equal(freshStaff.jobTitle, "SOLAR_OFFICER");
    assert.equal(freshProfile.status, "ACTIVE");
    assert.equal(active, 1);
  } else {
    assert.equal(assignment.statusCode, 409);
    assert.equal(freshStaff.jobTitle, "GENERAL_STAFF");
    assert.equal(freshProfile.status, "INACTIVE");
    assert.equal(active, 0);
  }
});