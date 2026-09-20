const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mongoose = require("mongoose");

const User = require("../models/user.model");
const School = require("../models/edupaySchool.model");
const SchoolUser = require("../models/edupaySchoolUser.model");
const edupayController = require("../controllers/edupay.controller");
const authController = require("../controllers/auth.controller");
const controller = require("../controllers/edupayAcademic.controller");
const { EduPayTeacherAssignment } = require("../models/edupayAcademicManagement.model");

const uri = String(process.env.MONGODB_URI || "").trim();
const dbName = `edupay_academic_${crypto.randomBytes(10).toString("hex")}`;

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});
const request = (user, school, role, body = {}, extra = {}) => ({
  user,
  eduPaySchool: school,
  eduPaySchoolUser: { role },
  body,
  params: extra.params || {},
  query: extra.query || {},
  ip: "127.0.0.1",
  get: () => undefined,
});
const invoke = async (name, req) => {
  const res = response();
  await controller[name](req, res);
  return res;
};
const invokeController = async (module, name, req) => {
  const res = response();
  await module[name](req, res);
  return res;
};

test("EduPay academic lifecycle and tenant isolation in isolated Mongo", { skip: !uri }, async (t) => {
  await mongoose.connect(uri, { dbName });
  t.after(async () => {
    try {
      await mongoose.connection.dropDatabase();
    } finally {
      await mongoose.disconnect();
    }
  });

  const stamp = Date.now();
  const [owner, teacherUser, parent, otherParent, headOffice] = await User.create([
    { fullName: "School Owner", phone: `0801${stamp}`, password: "Password123!", role: "CUSTOMER", status: "ACTIVE" },
    { fullName: "Teacher One", phone: `0802${stamp}`, password: "Password123!", role: "CUSTOMER", status: "ACTIVE" },
    { fullName: "Parent One", phone: `0803${stamp}`, password: "Password123!", role: "CUSTOMER", status: "ACTIVE" },
    { fullName: "Other Parent", phone: `0804${stamp}`, password: "Password123!", role: "CUSTOMER", status: "ACTIVE" },
    { fullName: "Head Office", phone: `0805${stamp}`, password: "Password123!", role: "HEAD_OFFICE", status: "ACTIVE" },
  ]);
  let adminCreateResult = await invokeController(edupayController, "adminCreateSchool", {
    user: headOffice,
    body: {
      schoolName: "Manually Provisioned School", schoolType: "COMBINED", proprietorName: "New Proprietor",
      email: `proprietor-${stamp}@example.com`, phone: `0810${stamp}`, address: "18 School Road", state: "Lagos", lga: "Ikeja", temporaryPassword: "AdminTemp9!",
    },
  });
  assert.equal(adminCreateResult.statusCode, 201);
  assert.equal(adminCreateResult.body.school.status, "APPROVED");
  assert.equal(adminCreateResult.body.schoolAdmin.mustChangePassword, true);
  const manuallyProvisionedSchoolId = adminCreateResult.body.school._id;
  assert.equal(Boolean(await SchoolUser.exists({ school: manuallyProvisionedSchoolId, role: "SCHOOL_ADMIN", status: "ACTIVE" })), true);
  const schoolAdminMembership = await SchoolUser.findOne({ school: manuallyProvisionedSchoolId, role: "SCHOOL_ADMIN" });
  const schoolAdminUser = await User.findById(schoolAdminMembership.user).select("+passwordResetToken +passwordResetExpires +authTokenVersion");
  schoolAdminUser.passwordResetToken = "old-reset-token";
  schoolAdminUser.passwordResetExpires = new Date(Date.now() + 3600000);
  const schoolAdminVersion = Number(schoolAdminUser.authTokenVersion || 0);
  await schoolAdminUser.save();
  adminCreateResult = await invokeController(edupayController, "adminResetSchoolPassword", {
    user: headOffice, params: { schoolId: manuallyProvisionedSchoolId }, body: { temporaryPassword: "AdminReset9!" },
  });
  assert.equal(adminCreateResult.statusCode, 200);
  const resetSchoolAdminUser = await User.findById(schoolAdminUser._id).select("+passwordResetToken +passwordResetExpires +authTokenVersion");
  assert.equal(resetSchoolAdminUser.passwordResetToken, undefined);
  assert.equal(resetSchoolAdminUser.passwordResetExpires, undefined);
  assert.equal(Number(resetSchoolAdminUser.authTokenVersion), schoolAdminVersion + 1);
  let schoolLoginResult = await invokeController(edupayController, "schoolLogin", {
    body: { email: `proprietor-${stamp}@example.com`, password: "AdminReset9!" },
  });
  assert.equal(schoolLoginResult.statusCode, 200);
  assert.equal(schoolLoginResult.body.role, "SCHOOL_ADMIN");
  assert.equal(schoolLoginResult.body.schoolId, String(manuallyProvisionedSchoolId));
  assert.deepEqual(schoolLoginResult.body.schoolMembership, {
    schoolId: String(manuallyProvisionedSchoolId),
    role: "SCHOOL_ADMIN",
    status: "ACTIVE",
    schoolStatus: "APPROVED",
  });
  const genericLoginResult = await invokeController(authController, "loginUser", {
    body: { email: `proprietor-${stamp}@example.com`, password: "AdminReset9!" },
    ip: "127.0.0.1",
    headers: {},
    get: () => undefined,
  });
  assert.equal(genericLoginResult.statusCode, 200);
  assert.equal(genericLoginResult.body.user.role, "CUSTOMER");
  assert.equal(genericLoginResult.body.schoolMembership.role, "SCHOOL_ADMIN");
  assert.equal(genericLoginResult.body.schoolMembership.schoolId, String(manuallyProvisionedSchoolId));
  const [pendingUser] = await User.create([{
    fullName: "Pending School Owner", email: `pending-school-${stamp}@example.com`,
    phone: `0813${stamp}`, password: "PendingPass9!", role: "CUSTOMER", status: "PENDING",
  }]);
  await School.create({
    name: "Pending School", address: "Lagos", state: "Lagos",
    status: "PENDING_REVIEW", active: false, portalUser: pendingUser._id,
  });
  schoolLoginResult = await invokeController(edupayController, "schoolLogin", {
    body: { email: `pending-school-${stamp}@example.com`, password: "PendingPass9!" },
  });
  assert.equal(schoolLoginResult.statusCode, 403);
  assert.equal(schoolLoginResult.body.code, "SCHOOL_APPROVAL_PENDING");
  assert.equal(schoolLoginResult.body.message, "School registration is awaiting approval.");
  const [rejectedUser, multiSchoolUser] = await User.create([
    {
      fullName: "Rejected School Owner", email: `rejected-school-${stamp}@example.com`,
      phone: `0814${stamp}`, password: "RejectedPass9!", role: "CUSTOMER", status: "PENDING",
    },
    {
      fullName: "Multi School Owner", email: `multi-school-${stamp}@example.com`,
      phone: `0815${stamp}`, password: "MultiSchoolPass9!", role: "CUSTOMER", status: "ACTIVE",
    },
  ]);
  await School.create({
    name: "Rejected School", address: "Lagos", state: "Lagos",
    status: "REJECTED", active: false, portalUser: rejectedUser._id,
  });
  schoolLoginResult = await invokeController(edupayController, "schoolLogin", {
    body: { email: `rejected-school-${stamp}@example.com`, password: "RejectedPass9!" },
  });
  assert.equal(schoolLoginResult.statusCode, 403);
  assert.equal(schoolLoginResult.body.code, "SCHOOL_REGISTRATION_REJECTED");
  const multiSchools = await School.create([
    { name: "Multi School One", address: "Lagos", state: "Lagos", status: "APPROVED", active: true },
    { name: "Multi School Two", address: "Abuja", state: "Abuja", status: "APPROVED", active: true },
  ]);
  await SchoolUser.create([
    { school: multiSchools[0]._id, user: multiSchoolUser._id, role: "OWNER", status: "ACTIVE" },
    { school: multiSchools[1]._id, user: multiSchoolUser._id, role: "SCHOOL_ADMIN", status: "ACTIVE" },
  ]);
  schoolLoginResult = await invokeController(edupayController, "schoolLogin", {
    body: { email: `multi-school-${stamp}@example.com`, password: "MultiSchoolPass9!" },
  });
  assert.equal(schoolLoginResult.statusCode, 409);
  assert.equal(schoolLoginResult.body.code, "EDUPAY_SCHOOL_CONTEXT_REQUIRED");
  assert.equal(schoolLoginResult.body.schools.length, 2);
  schoolLoginResult = await invokeController(edupayController, "schoolLogin", {
    body: {
      email: `multi-school-${stamp}@example.com`,
      password: "MultiSchoolPass9!",
      schoolId: multiSchools[1]._id,
    },
  });
  assert.equal(schoolLoginResult.statusCode, 200);
  assert.equal(schoolLoginResult.body.schoolId, String(multiSchools[1]._id));
  assert.equal(schoolLoginResult.body.role, "SCHOOL_ADMIN");
  const [school, otherSchool] = await School.create([
    { name: "Academic School", address: "Lagos", state: "Lagos", status: "APPROVED", active: true },
    { name: "Other School", address: "Abuja", state: "Abuja", status: "APPROVED", active: true },
  ]);

  let result = await invoke("createSession", request(owner, school, "OWNER", {
    name: "2026/2027", startsAt: "2026-09-01", endsAt: "2027-07-31", status: "ACTIVE",
  }));
  assert.equal(result.statusCode, 201);
  const session = result.body.session;

  result = await invoke("createTerm", request(owner, school, "OWNER", {
    session: session._id, name: "First Term", startsAt: "2026-09-01", endsAt: "2026-12-18", status: "ACTIVE",
  }));
  assert.equal(result.statusCode, 201);
  const term = result.body.term;

  result = await invoke("createClass", request(owner, school, "OWNER", {
    session: session._id, name: "JSS 1", arm: "A",
  }));
  assert.equal(result.statusCode, 201);
  const classLevel = result.body.classLevel;

  result = await invoke("createSubject", request(owner, school, "OWNER", { name: "Mathematics", code: "MTH" }));
  assert.equal(result.statusCode, 201);
  const subject = result.body.subject;

  result = await invoke("createTeacher", request(owner, school, "OWNER", {
    userId: teacherUser._id, staffId: "T-001",
  }));
  assert.equal(result.statusCode, 201);
  const teacher = result.body.teacher;

  result = await invoke("assignTeacher", request(owner, school, "OWNER", {
    teacher: teacher._id, classLevel: classLevel._id, subject: subject._id,
  }));
  assert.equal(result.statusCode, 201);

  result = await invoke("createTeacher", request(owner, school, "OWNER", {
    fullName: "Provisioned Teacher",
    email: `provisioned-${stamp}@example.com`,
    phone: `0809${stamp}`,
    staffId: `T-${stamp}`,
    gender: "FEMALE",
    responsibility: "Class Teacher",
    temporaryPassword: "TempPass9!",
    classIds: [classLevel._id],
    subjectIds: [subject._id],
  }));
  assert.equal(result.statusCode, 201);
  assert.equal(result.body.account.mustChangePassword, true);
  assert.equal(result.body.assignments.length, 1);
  const provisionedTeacher = result.body.teacher;
  const failedTeacherEmail = `rollback-${stamp}@example.com`;
  result = await invoke("createTeacher", request(owner, school, "OWNER", {
    fullName: "Rollback Teacher", email: failedTeacherEmail, phone: `0819${stamp}`, staffId: `ROLLBACK-${stamp}`,
    temporaryPassword: "TempPass9!", classIds: [new mongoose.Types.ObjectId()], subjectIds: [subject._id],
  }));
  assert.equal(result.statusCode, 400);
  assert.equal(await User.exists({ email: failedTeacherEmail }), null);
  const provisionedUser = await User.findOne({ email: `provisioned-${stamp}@example.com` });
  assert.equal(provisionedUser.mustChangePassword, true);
  result = await invoke("updateTeacher", request(owner, school, "OWNER", {
    replaceAssignments: true,
    assignments: [{ classLevel: new mongoose.Types.ObjectId(), subject: subject._id }],
  }, { params: { teacherId: provisionedTeacher._id } }));
  assert.equal(result.statusCode, 400);
  assert.equal(await EduPayTeacherAssignment.countDocuments({ teacher: provisionedTeacher._id }), 1);
  result = await invoke("updateTeacherStatus", request(owner, school, "OWNER", { status: "INACTIVE" }, { params: { teacherId: provisionedTeacher._id } }));
  assert.equal(result.statusCode, 200);
  result = await invoke("submitAttendance", request(await User.findById(provisionedUser._id), school, "TEACHER", {
    classId: classLevel._id, session: session._id, term: term._id, date: "2026-09-19", records: [],
  }));
  assert.equal(result.statusCode, 403);
  result = await invoke("resetTeacherPassword", request(owner, school, "OWNER", { temporaryPassword: "ResetPass9!" }, { params: { teacherId: provisionedTeacher._id } }));
  assert.equal(result.statusCode, 200);
  const resetTeacherUser = await User.findById(provisionedUser._id).select("+passwordResetToken +passwordResetExpires +authTokenVersion");
  assert.equal(resetTeacherUser.mustChangePassword, true);
  assert.equal(resetTeacherUser.passwordResetToken, undefined);
  assert.equal(resetTeacherUser.passwordResetExpires, undefined);
  result = await invoke("updateTeacherStatus", request(owner, school, "OWNER", { status: "ACTIVE" }, { params: { teacherId: provisionedTeacher._id } }));
  assert.equal(result.statusCode, 200);
  result = await invokeController(edupayController, "adminSchoolUpdate", {
    user: headOffice, params: { schoolId: manuallyProvisionedSchoolId }, body: { schoolName: "Renamed Provisioned School" },
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.school.name, "Renamed Provisioned School");
  assert.equal((await School.findById(manuallyProvisionedSchoolId)).name, "Renamed Provisioned School");
  result = await invokeController(edupayController, "adminCreateSchoolUser", {
    user: headOffice, params: { schoolId: manuallyProvisionedSchoolId },
    body: { fullName: "School Staff", email: `staff-${stamp}@example.com`, phone: `0811${stamp}`, password: "StaffPass9!", role: "STAFF" },
  });
  assert.equal(result.statusCode, 201);
  assert.equal(Boolean(await SchoolUser.exists({ _id: result.body.schoolUser.id, school: manuallyProvisionedSchoolId, status: "ACTIVE" })), true);
  const staffUser = await User.findById(result.body.schoolUser.userId).select("+authTokenVersion");
  result = await invokeController(edupayController, "adminCreateSchoolUser", {
    user: headOffice, params: { schoolId: manuallyProvisionedSchoolId },
    body: { fullName: "Independent Inactive", email: `inactive-${stamp}@example.com`, phone: `0812${stamp}`, password: "StaffPass9!", role: "STAFF" },
  });
  assert.equal(result.statusCode, 201);
  const inactiveUser = await User.findById(result.body.schoolUser.userId).select("+authTokenVersion");
  inactiveUser.status = "BLOCKED";
  await inactiveUser.save();
  const beforeSuspendVersion = Number((await User.findById(schoolAdminUser._id).select("+authTokenVersion")).authTokenVersion || 0);
  const beforeStaffSuspendVersion = Number(staffUser.authTokenVersion || 0);
  const beforeInactiveSuspendVersion = Number(inactiveUser.authTokenVersion || 0);
  result = await invokeController(edupayController, "adminSchoolAction", {
    user: headOffice, params: { schoolId: manuallyProvisionedSchoolId }, body: { action: "SUSPEND" },
  });
  assert.equal(result.statusCode, 200);
  const suspendedVersion = Number((await User.findById(schoolAdminUser._id).select("+authTokenVersion")).authTokenVersion || 0);
  assert.equal(suspendedVersion, beforeSuspendVersion + 1);
  assert.equal(Number((await User.findById(staffUser._id).select("+authTokenVersion")).authTokenVersion), beforeStaffSuspendVersion + 1);
  assert.equal(Number((await User.findById(inactiveUser._id).select("+authTokenVersion")).authTokenVersion), beforeInactiveSuspendVersion + 1);
  result = await invokeController(edupayController, "schoolLogin", {
    body: { email: `proprietor-${stamp}@example.com`, password: "AdminReset9!" },
  });
  assert.equal(result.statusCode, 403);
  result = await invokeController(edupayController, "adminSchoolAction", {
    user: headOffice, params: { schoolId: manuallyProvisionedSchoolId }, body: { action: "REACTIVATE" },
  });
  assert.equal(result.statusCode, 200);
  const reactivatedVersion = Number((await User.findById(schoolAdminUser._id).select("+authTokenVersion")).authTokenVersion || 0);
  assert.equal(reactivatedVersion, suspendedVersion + 1);
  assert.equal(Number((await User.findById(staffUser._id).select("+authTokenVersion")).authTokenVersion), beforeStaffSuspendVersion + 2);
  assert.equal(Number((await User.findById(inactiveUser._id).select("+authTokenVersion")).authTokenVersion), beforeInactiveSuspendVersion + 2);
  assert.equal((await User.findById(inactiveUser._id)).status, "BLOCKED");

  result = await invoke("createStudent", request(owner, school, "OWNER", {
    studentId: "S-001", fullName: "Student One", classLevel: classLevel._id, parent: parent._id,
  }));
  assert.equal(result.statusCode, 201);
  const student = result.body.student;
  result = await invoke("createActivity", request(teacherUser, school, "TEACHER", {
    type: "ANNOUNCEMENT", title: "Class update", body: "Bring your workbook.", audience: "CLASS", classLevel: classLevel._id,
  }));
  assert.equal(result.statusCode, 201);
  result = await invoke("createClass", request(owner, school, "OWNER", {
    session: session._id, name: "JSS 2", arm: "B",
  }));
  assert.equal(result.statusCode, 201);
  const otherClass = result.body.classLevel;
  result = await invoke("createStudent", request(owner, school, "OWNER", {
    studentId: "S-002", fullName: "Student Two", classLevel: otherClass._id, parent: otherParent._id,
  }));
  assert.equal(result.statusCode, 201);
  const otherStudent = result.body.student;
  for (const activity of [
    { title: "School notice", audience: "SCHOOL" },
    { title: "Other class notice", audience: "CLASS", classLevel: otherClass._id },
    { title: "Other student notice", audience: "STUDENT", classLevel: otherClass._id, student: otherStudent._id },
  ]) {
    result = await invoke("createActivity", request(owner, school, "OWNER", {
      type: "ANNOUNCEMENT", body: activity.title, ...activity,
    }));
    assert.equal(result.statusCode, 201);
  }
  result = await invoke("listStudents", request(teacherUser, school, "TEACHER"));
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body.students.map((row) => String(row._id)), [String(student._id)]);
  result = await invoke("listStudents", request(teacherUser, school, "TEACHER", {}, { query: { classId: otherClass._id } }));
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.students.length, 0);
  result = await invoke("listActivities", request(teacherUser, school, "TEACHER"));
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.activities.some((row) => row.title === "School notice"), true);
  assert.equal(result.body.activities.some((row) => row.title === "Class update"), true);
  assert.equal(result.body.activities.some((row) => row.title === "Other class notice" || row.title === "Other student notice"), false);

  result = await invoke("submitAttendance", request(teacherUser, school, "TEACHER", {
    classId: classLevel._id,
    session: session._id,
    term: term._id,
    date: "2026-09-19",
    records: [{ student: student._id, status: "PRESENT" }],
  }));
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.records.length, 1);

  const parentAttendance = await invoke("parentAttendance", request(parent, null, null, {}, {
    params: { childId: student._id },
  }));
  assert.equal(parentAttendance.statusCode, 200);
  assert.equal(parentAttendance.body.attendance.length, 1);
  const deniedParent = await invoke("parentAttendance", request(otherParent, null, null, {}, {
    params: { childId: student._id },
  }));
  assert.equal(deniedParent.statusCode, 404);

  result = await invoke("createAssessment", request(owner, school, "OWNER", {
    session: session._id,
    term: term._id,
    classLevel: classLevel._id,
    subject: subject._id,
    title: "First Term Examination",
    components: [{ name: "CA", max: 30 }, { name: "Exam", max: 70 }],
  }));
  assert.equal(result.statusCode, 201);
  const assessment = result.body.assessment;

  const hidden = await invoke("parentResults", request(parent, null, null, {}, {
    params: { childId: student._id },
  }));
  assert.equal(hidden.body.results.length, 0);

  for (const invalid of [null, undefined, "", "   ", [], NaN, Infinity, -1, 31]) {
    const invalidResult = await invoke("saveScores", request(teacherUser, school, "TEACHER", {
      submit: false,
      scores: [{ student: student._id, values: { CA: invalid, Exam: 60 } }],
    }, { params: { assessmentId: assessment._id } }));
    assert.equal(invalidResult.statusCode, 400, `invalid score should be rejected: ${String(invalid)}`);
  }
  result = await invoke("saveScores", request(teacherUser, school, "TEACHER", {
    submit: true,
    scores: [{ student: student._id, values: { CA: 25, Exam: 60 } }],
  }, { params: { assessmentId: assessment._id } }));
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.scores[0].percentage, 85);

  const invalidPublish = await invoke("reviewAssessment", request(owner, school, "OWNER", {
    action: "PUBLISH",
  }, { params: { assessmentId: assessment._id } }));
  assert.equal(invalidPublish.statusCode, 409);

  result = await invoke("reviewAssessment", request(owner, school, "OWNER", {
    action: "APPROVE",
  }, { params: { assessmentId: assessment._id } }));
  assert.equal(result.statusCode, 200);
  result = await invoke("reviewAssessment", request(owner, school, "OWNER", {
    action: "PUBLISH",
  }, { params: { assessmentId: assessment._id } }));
  assert.equal(result.statusCode, 200);
  result = await invoke("saveScores", request(teacherUser, school, "TEACHER", {
    submit: false,
    scores: [{ student: student._id, values: { CA: 20, Exam: 50 } }],
  }, { params: { assessmentId: assessment._id } }));
  assert.equal(result.statusCode, 409);

  const visible = await invoke("parentResults", request(parent, null, null, {}, {
    params: { childId: student._id },
  }));
  assert.equal(visible.statusCode, 200);
  assert.equal(visible.body.results.length, 1);
  assert.equal(visible.body.results[0].percentage, 85);

  const crossSchool = await invoke("submitAttendance", request(teacherUser, otherSchool, "TEACHER", {
    classId: classLevel._id,
    session: session._id,
    term: term._id,
    date: "2026-09-20",
    records: [{ student: student._id, status: "PRESENT" }],
  }));
  assert.equal(crossSchool.statusCode, 400);
  assert.match(crossSchool.body.message, /does not belong to this school/);
});