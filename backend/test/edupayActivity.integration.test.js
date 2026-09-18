const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const EduPaySchoolUser = require("../models/edupaySchoolUser.model");
const School = require("../models/edupaySchool.model");
const Child = require("../models/edupayChild.model");
const User = require("../models/user.model");
const Notification = require("../models/notification.model");
const Invite = require("../models/edupayGuardianInvite.model");
const service = require("../services/edupayActivity.service");
const controller = require("../controllers/edupayActivity.controller");
const activityRoutes = require("../routes/edupayActivity.routes");
const { school: schoolMiddleware } = require("../middleware/edupay.middleware");

const uri = process.env.MONGODB_URI;
const dbName = `edupay_activity_test_${Math.random().toString(36).slice(2, 12)}`;
const reqFor = (user, school, role = "OWNER") => ({ user, eduPaySchool: school, eduPaySchoolUser: { role }, body: {}, query: {}, get: () => undefined });
const response = () => ({ statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } });

test("EduPay activity center real Mongo integration gate", { skip: !uri }, async (t) => {
  await mongoose.connect(uri, { dbName });
  t.after(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });

  const [owner, staff, parent, otherParent] = await User.create([
    { fullName: "Owner", phone: `+234900${Date.now()}01`, password: "secret123", role: "CUSTOMER" },
    { fullName: "Staff", phone: `+234900${Date.now()}02`, password: "secret123", role: "CUSTOMER" },
    { fullName: "Parent", phone: `+234900${Date.now()}03`, password: "secret123", role: "CUSTOMER" },
    { fullName: "Other", phone: `+234900${Date.now()}04`, password: "secret123", role: "CUSTOMER" },
  ]);
  const [schoolA, schoolB] = await School.create([
    { name: "A", address: "A", state: "Lagos", status: "APPROVED", active: true },
    { name: "B", address: "B", state: "Lagos", status: "APPROVED", active: true },
  ]);
  await EduPaySchoolUser.create([
    { school: schoolA._id, user: owner._id, role: "OWNER", status: "ACTIVE" },
    { school: schoolA._id, user: staff._id, role: "STAFF", status: "ACTIVE" },
    { school: schoolB._id, user: owner._id, role: "OWNER", status: "ACTIVE" },
  ]);
  const [child, otherChild] = await Child.create([
    { parent: parent._id, fullName: "Child A", school: schoolA._id, createdBy: owner._id },
    { parent: otherParent._id, fullName: "Child B", school: schoolB._id, createdBy: owner._id },
  ]);
  const selectedReq = { user: owner, headers: { "x-edupay-school-id": String(schoolB._id) }, query: {}, body: {} };
  let selectedNext = false;
  await schoolMiddleware[1](selectedReq, response(), () => { selectedNext = true; });
  assert.equal(selectedNext, true);

  await assert.rejects(() => service.listForParent(reqFor(otherParent, schoolA), child._id), /Verified parent access/);
  const parentReq = reqFor(parent, schoolA);
  const denied = response();
  await controller.parentList({ ...parentReq, params: { childId: otherChild._id } }, denied);
  assert.equal(denied.statusCode, 403);

  const result = await service.create(reqFor(owner, schoolA), "RESULT", { childId: child._id, subject: "Math", ca: 20, exam: 60 });
  assert.equal(result.status, "DRAFT");
  const hidden = await service.listForParent(parentReq, child._id, "RESULT");
  assert.equal(hidden.records.length, 0);
  await service.publish(reqFor(owner, schoolA), result._id);
  const visible = await service.listForParent(parentReq, child._id, "RESULT");
  assert.equal(visible.records.length, 1);

  const conduct = await service.create(reqFor(owner, schoolA), "CONDUCT", { childId: child._id, note: "internal" }, true);
  assert.equal(conduct.parentVisible, false);
  assert.equal((await service.listForParent(parentReq, child._id, "CONDUCT")).records.length, 0);
  await assert.rejects(() => service.create(reqFor({ ...staff, _id: staff._id }, schoolA, "STAFF"), "CONDUCT", { childId: child._id }), /Conduct management/);

  const parentInvite = await service.createGuardianInvite(reqFor(owner, schoolA), child._id);
  assert.ok(parentInvite.code);
  assert.notEqual(parentInvite.code, parentInvite.invite.codeHash);
  const accepted = await service.acceptGuardianInvite(reqFor(parent, schoolA), parentInvite.code);
  assert.equal(accepted.status, "VERIFIED");
  await assert.rejects(() => service.acceptGuardianInvite(reqFor(otherParent, schoolA), parentInvite.code), /invalid, expired, revoked, or already used/);
  const expired = await service.createGuardianInvite(reqFor(owner, schoolA), child._id, -1);
  await assert.rejects(() => service.acceptGuardianInvite(reqFor(otherParent, schoolA), expired.code), /invalid, expired/);
  const wrongSchool = await service.createGuardianInvite(reqFor(owner, schoolA), child._id);
  await assert.rejects(() => service.revokeGuardianInvite(reqFor(owner, schoolB), wrongSchool.invite._id), /not found/);

  const bulkReq = reqFor(owner, schoolA);
  const attendance = [{ childId: child._id, status: "PRESENT" }];
  const first = await service.bulkAttendance(bulkReq, attendance, new Date("2026-01-01"), "integration-bulk");
  const replay = await service.bulkAttendance(bulkReq, attendance, new Date("2026-01-01"), "integration-bulk");
  assert.deepEqual(replay.map((row) => String(row._id)), first.map((row) => String(row._id)));
  await assert.rejects(() => service.bulkAttendance(bulkReq, [{ childId: child._id, status: "ABSENT" }], new Date("2026-01-01"), "integration-bulk"), /different attendance payload/);
  const before = await mongoose.model("EduPayActivityCenterRecord").countDocuments({ batch: { $ne: null } });
  await assert.rejects(() => service.bulkAttendance(bulkReq, [{ childId: child._id }, { childId: new mongoose.Types.ObjectId() }], new Date("2026-01-02"), "integration-rollback"));
  assert.equal(await mongoose.model("EduPayActivityCenterRecord").countDocuments({ batch: { $ne: null } }), before);
  const notificationCount = await Notification.countDocuments({ edupayDedupeKey: { $exists: true } });
  assert.ok(notificationCount >= 2);
  assert.equal(await Notification.countDocuments({ edupayDedupeKey: { $regex: String(first[0]._id) } }), 1);

  const routes = activityRoutes.stack.map((layer) => layer.route?.path).filter(Boolean);
  assert.ok(routes.includes("/school/guardians/invites"));
  assert.ok(routes.includes("/parent/guardian-links/accept"));
});