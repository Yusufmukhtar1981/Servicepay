const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const User = require("../models/user.model");
const School = require("../models/edupaySchool.model");
const SchoolUser = require("../models/edupaySchoolUser.model");
const Child = require("../models/edupayChild.model");
const Link = require("../models/edupayGuardianLink.model");
const Notification = require("../models/notification.model");
const academic = require("../controllers/edupayAcademic.controller");
const activity = require("../controllers/edupayActivity.controller");
const { EduPayAcademicSession, EduPayTerm, EduPayClass } = require("../models/edupayAcademic.model");
const { EduPayStudent, EduPayTeacher, EduPayTeacherAssignment, EduPayAttendance } = require("../models/edupayAcademicManagement.model");

const uri = String(process.env.MONGODB_URI || "").trim();
const dbName = `ep_att_${Math.random().toString(36).slice(2, 12)}`;
const response = () => ({ statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const invoke = async (handler, req) => { const res = response(); await handler(req, res); return res; };

test("academic attendance is visible through the parent activity-center path", { skip: !uri }, async (t) => {
  await mongoose.connect(uri, { dbName });
  t.after(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });
  const stamp = Date.now();
  const [teacherUser, parent, guardian, unrelated, owner] = await User.create([
    { fullName: "Attendance Teacher", phone: `+234910${stamp}1`, password: "secret123", role: "CUSTOMER", status: "ACTIVE" },
    { fullName: "Direct Parent", phone: `+234910${stamp}2`, password: "secret123", role: "CUSTOMER", status: "ACTIVE" },
    { fullName: "Verified Guardian", phone: `+234910${stamp}3`, password: "secret123", role: "CUSTOMER", status: "ACTIVE" },
    { fullName: "Unrelated Parent", phone: `+234910${stamp}4`, password: "secret123", role: "CUSTOMER", status: "ACTIVE" },
    { fullName: "School Owner", phone: `+234910${stamp}5`, password: "secret123", role: "CUSTOMER", status: "ACTIVE" },
  ]);
  const [school, otherSchool] = await School.create([
    { name: `Attendance School ${stamp}`, address: "A", state: "Lagos", status: "APPROVED", active: true },
    { name: `Other Attendance School ${stamp}`, address: "B", state: "Lagos", status: "APPROVED", active: true },
  ]);
  const [session, otherSession, mismatchedSession] = await EduPayAcademicSession.create([
    { school: school._id, name: `2026-${stamp}`, status: "ACTIVE" },
    { school: otherSchool._id, name: `2026-other-${stamp}`, status: "ACTIVE" },
    { school: school._id, name: `2025-${stamp}`, status: "CLOSED" },
  ]);
  const [term, otherTerm, mismatchedTerm] = await EduPayTerm.create([
    { school: school._id, session: session._id, name: "First", status: "ACTIVE" },
    { school: otherSchool._id, session: otherSession._id, name: "First", status: "ACTIVE" },
    { school: school._id, session: mismatchedSession._id, name: "Closed term", status: "CLOSED" },
  ]);
  const [classLevel, otherClass] = await EduPayClass.create([
    { school: school._id, session: session._id, name: "JSS 1", status: "ACTIVE" },
    { school: otherSchool._id, session: otherSession._id, name: "JSS 1", status: "ACTIVE" },
  ]);
  await SchoolUser.create({ school: school._id, user: owner._id, role: "OWNER", status: "ACTIVE", createdBy: owner._id });
  const teacher = await EduPayTeacher.create({ school: school._id, user: teacherUser._id, staffId: `T-${stamp}`, fullName: teacherUser.fullName, createdBy: owner._id });
  await EduPayTeacherAssignment.create({ school: school._id, teacher: teacher._id, classLevel: classLevel._id, subject: new mongoose.Types.ObjectId(), createdBy: owner._id });
  const student = await EduPayStudent.create({ school: school._id, studentId: ` AD-${stamp} `, fullName: "Ada Student", classLevel: classLevel._id, parent: parent._id, createdBy: owner._id });
  const foreignStudent = await EduPayStudent.create({ school: otherSchool._id, studentId: `AD-${stamp}`, fullName: "Foreign Student", classLevel: otherClass._id, parent: unrelated._id, createdBy: owner._id });
  const child = await Child.create({ school: school._id, admissionNumber: `ad-${stamp}`, fullName: student.fullName, parent: parent._id, createdBy: owner._id });
  const foreignChild = await Child.create({ school: otherSchool._id, admissionNumber: foreignStudent.studentId, fullName: foreignStudent.fullName, parent: unrelated._id, createdBy: owner._id });
  const missing = await Child.create({ school: school._id, admissionNumber: `missing-${stamp}`, fullName: "Unmapped Child", parent: parent._id, createdBy: owner._id });
  const manualChild = await Child.create({ school: school._id, fullName: "Legacy Manual Student", parent: parent._id, createdBy: owner._id });
  const manualStudent = await EduPayStudent.create({ school: school._id, studentId: `MANUAL-${stamp}`, fullName: manualChild.fullName, classLevel: classLevel._id, createdBy: owner._id });
  await Link.create({ school: school._id, child: child._id, parent: guardian._id, status: "VERIFIED", verifiedAt: new Date() });
  const schoolReq = (body) => ({ user: teacherUser, eduPaySchool: school, eduPaySchoolUser: { role: "TEACHER", user: teacherUser._id, school: school._id, status: "ACTIVE" }, body, query: {} });
  const submit = async (status) => invoke(academic.submitAttendance, schoolReq({ classId: classLevel._id, session: session._id, term: term._id, date: "2026-09-20", records: [{ student: student._id, status }] }));
  const parentReq = (user, childId) => ({ user, params: { childId }, query: {}, body: {} });
  const managerReq = (body = {}) => ({ user: owner, eduPaySchool: school, eduPaySchoolUser: { role: "OWNER", user: owner._id, school: school._id, status: "ACTIVE" }, body, query: {} });

  const originalCreate = Notification.create;
  t.after(() => { Notification.create = originalCreate; });
  Notification.create = async () => { throw new Error("notification outage"); };
  for (const status of ["PRESENT", "ABSENT", "LATE", "EXCUSED"]) {
    const result = await submit(status);
    assert.equal(result.statusCode, 200, `${status} submission should succeed`);
  }
  assert.equal((await EduPayAttendance.countDocuments({ school: school._id, student: student._id })).toString(), "1");
  const correction = await submit("ABSENT");
  assert.equal(correction.statusCode, 200);
  assert.equal((await EduPayAttendance.findOne({ student: student._id })).status, "ABSENT");
  Notification.create = originalCreate;

  const direct = await invoke(activity.parentList, parentReq(parent, child._id));
  assert.equal(direct.statusCode, 200);
  assert.equal(direct.body.records.filter((row) => row.type === "ATTENDANCE").length, 1);
  assert.equal(direct.body.records[0].payload.status, "ABSENT");
  assert.equal(direct.body.records[0].payload.class.name, "JSS 1");
  const verified = await invoke(activity.parentList, parentReq(guardian, child._id));
  assert.equal(verified.statusCode, 200);
  assert.equal(verified.body.records.some((row) => row.type === "ATTENDANCE"), true);
  const guardianAcademic = await invoke(academic.parentAttendance, parentReq(guardian, student._id));
  assert.equal(guardianAcademic.statusCode, 200);
  assert.equal(guardianAcademic.body.attendance.length, 1);
  assert.equal(guardianAcademic.body.attendance[0].status, "ABSENT");
  const guardianChildren = await invoke(academic.parentAcademicChildren, parentReq(guardian, child._id));
  assert.equal(guardianChildren.statusCode, 200);
  assert.equal(guardianChildren.body.children.some((row) => String(row._id) === String(student._id)), true);
  assert.equal((await invoke(academic.parentAttendance, parentReq(unrelated, student._id))).statusCode, 404);
  assert.equal((await invoke(activity.parentList, parentReq(unrelated, child._id))).statusCode, 403);
  assert.equal((await invoke(activity.parentList, parentReq(parent, foreignChild._id))).statusCode, 403);
  const noMapping = await invoke(activity.parentList, parentReq(parent, missing._id));
  assert.equal(noMapping.statusCode, 200);
  assert.equal(noMapping.body.records.some((row) => row.type === "ATTENDANCE"), false);
  const linkList = await invoke(academic.listStudentLinkCandidates, managerReq());
  assert.equal(linkList.statusCode, 200);
  const manualLink = linkList.body.links.find((row) => row.childName === manualChild.fullName);
  assert.ok(manualLink);
  assert.equal(manualLink.candidates.length, 1);
  assert.equal("_id" in manualLink, false);
  assert.match(manualLink.parentDisplay, /Direct Parent/);
  const manualResolution = await invoke(academic.resolveStudentLink, managerReq({
    childToken: manualLink.childToken,
    candidateToken: manualLink.candidates[0].candidateToken,
  }));
  assert.equal(manualResolution.statusCode, 200);
  assert.equal("_id" in manualResolution.body.link, false);
  assert.equal(String((await Child.findById(manualChild._id)).academicStudent), String(manualStudent._id));
  const teacherList = await invoke(academic.listStudentLinkCandidates, schoolReq({}));
  assert.equal(teacherList.statusCode, 403);
  const mismatch = await invoke(academic.submitAttendance, schoolReq({
    classId: classLevel._id,
    session: session._id,
    term: mismatchedTerm._id,
    date: "2026-09-20",
    records: [{ student: student._id, status: "PRESENT" }],
  }));
  assert.equal(mismatch.statusCode, 400);
  const duplicateInput = await invoke(academic.submitAttendance, schoolReq({
    classId: classLevel._id,
    session: session._id,
    term: term._id,
    date: "2026-09-20",
    records: [
      { student: student._id, status: "PRESENT" },
      { student: student._id, status: "ABSENT" },
    ],
  }));
  assert.equal(duplicateInput.statusCode, 400);
  assert.equal(await EduPayAttendance.countDocuments({ school: school._id, student: student._id, date: "2026-09-20" }), 1);
  await EduPayTerm.updateOne({ _id: term._id }, { $set: { status: "CLOSED" } });
  await EduPayAcademicSession.updateOne({ _id: session._id }, { $set: { status: "CLOSED" } });
  await EduPayAcademicSession.updateOne({ _id: mismatchedSession._id }, { $set: { status: "ACTIVE" } });
  await EduPayTerm.updateOne({ _id: mismatchedTerm._id }, { $set: { status: "ACTIVE" } });
  const rollover = await invoke(academic.submitAttendance, schoolReq({
    classId: classLevel._id,
    session: mismatchedSession._id,
    term: mismatchedTerm._id,
    date: "2026-09-21",
    records: [{ student: student._id, status: "PRESENT" }],
  }));
  assert.equal(rollover.statusCode, 200);
  assert.equal(rollover.body.records[0].status, "PRESENT");
});