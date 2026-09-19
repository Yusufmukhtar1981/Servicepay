const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mongoose = require("mongoose");

const User = require("../models/user.model");
const School = require("../models/edupaySchool.model");
const controller = require("../controllers/edupayAcademic.controller");

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
  const [owner, teacherUser, parent, otherParent] = await User.create([
    { fullName: "School Owner", phone: `0801${stamp}`, password: "Password123!", role: "CUSTOMER", status: "ACTIVE" },
    { fullName: "Teacher One", phone: `0802${stamp}`, password: "Password123!", role: "CUSTOMER", status: "ACTIVE" },
    { fullName: "Parent One", phone: `0803${stamp}`, password: "Password123!", role: "CUSTOMER", status: "ACTIVE" },
    { fullName: "Other Parent", phone: `0804${stamp}`, password: "Password123!", role: "CUSTOMER", status: "ACTIVE" },
  ]);
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

  result = await invoke("createStudent", request(owner, school, "OWNER", {
    studentId: "S-001", fullName: "Student One", classLevel: classLevel._id, parent: parent._id,
  }));
  assert.equal(result.statusCode, 201);
  const student = result.body.student;

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