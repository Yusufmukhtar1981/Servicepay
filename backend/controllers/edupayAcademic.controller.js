const mongoose = require("mongoose");
const User = require("../models/user.model");
const SchoolUser = require("../models/edupaySchoolUser.model");
const { EduPayAcademicSession, EduPayTerm, EduPayClass } = require("../models/edupayAcademic.model");
const {
  EduPaySubject, EduPayStudent, EduPayTeacher, EduPayTeacherAssignment,
  EduPayAttendance, EduPayAssessment, EduPayScore, EduPayTimetable,
  EduPayAcademicActivity,
} = require("../models/edupayAcademicManagement.model");
const { audit, notify } = require("../services/edupay.service");
const { models } = require("../services/edupay.service");
const { validateStrongPassword } = require("../utils/passwordPolicy");
const School = models.School;
const EduPayChild = models.Child;
const fail = (res, e) => res.status(e.statusCode || 500).json({ success: false, message: e.message || "Academic request failed." });
const temporaryPassword = (value) => {
  const check = validateStrongPassword(String(value || ""));
  if (!check.valid) { const e = new Error(check.message); e.statusCode = 400; throw e; }
  return String(value);
};
const id = (value, label) => {
  if (!mongoose.isValidObjectId(value)) { const e = new Error(`${label} is invalid.`); e.statusCode = 400; throw e; }
  return value;
};
const schoolId = (req) => req.eduPaySchool._id;
const isManager = (req) => ["OWNER", "ADMIN", "SCHOOL_ADMIN"].includes(String(req.eduPaySchoolUser?.role || "").toUpperCase());
const manager = (req, res) => {
  if (!isManager(req)) { res.status(403).json({ success: false, message: "School administrator access required." }); return false; }
  return true;
};
const teacherFor = async (req, classLevel, subject = null) => {
  if (isManager(req)) return null;
  const row = await EduPayTeacher.findOne({ school: schoolId(req), user: req.user._id, status: "ACTIVE" }).select("_id");
  if (!row) return null;
  const query = { school: schoolId(req), teacher: row._id, classLevel };
  if (subject) query.subject = subject;
  const assignment = await EduPayTeacherAssignment.findOne(query);
  return assignment ? row : null;
};
const teacherScope = async (req) => {
  const teacher = await EduPayTeacher.findOne({
    school: schoolId(req),
    user: req.user._id,
    status: "ACTIVE",
  }).select("_id");
  if (!teacher) return { teacher: null, assignments: [] };
  const assignments = await EduPayTeacherAssignment.find({
    school: schoolId(req),
    teacher: teacher._id,
  }).lean();
  return { teacher, assignments };
};
const clean = (row) => row?.toObject ? row.toObject() : row;
const ensureOwned = async (Model, value, school, label, session = null) => {
  id(value, label);
  let query = Model.findOne({ _id: value, school });
  if (session) query = query.session(session);
  const row = await query;
  if (!row) { const e = new Error(`${label} does not belong to this school.`); e.statusCode = 400; throw e; }
  return row;
};
const ranges = (input) => {
  const rows = Array.isArray(input) && input.length ? input : [
    { grade: "A", min: 80, max: 100, remark: "Excellent" }, { grade: "B", min: 70, max: 79, remark: "Very good" },
    { grade: "C", min: 60, max: 69, remark: "Good" }, { grade: "D", min: 50, max: 59, remark: "Pass" },
    { grade: "E", min: 40, max: 49, remark: "Needs improvement" }, { grade: "F", min: 0, max: 39, remark: "Fail" },
  ];
  if (rows.some((r) => !r.grade || Number(r.min) < 0 || Number(r.max) > 100 || Number(r.min) > Number(r.max))) {
    const e = new Error("Grading ranges are invalid."); e.statusCode = 400; throw e;
  }
  return rows.map((r) => ({ grade: String(r.grade), min: Number(r.min), max: Number(r.max), remark: String(r.remark || "") }));
};

exports.dashboard = async (req, res) => {
  try {
    const school = schoolId(req);
    if (!isManager(req)) {
      const scope = await teacherScope(req);
      if (!scope.teacher) return res.status(403).json({ success: false, message: "Active teacher profile required." });
      const classIds = [...new Set(scope.assignments.map((row) => String(row.classLevel)))];
      const pairs = scope.assignments.map((row) => ({ classLevel: row.classLevel, subject: row.subject }));
      const today = new Date().toISOString().slice(0, 10);
      const [students, pendingAttendance, upcomingExams, pendingResults] = await Promise.all([
        EduPayStudent.countDocuments({ school, classLevel: { $in: classIds }, status: "ACTIVE" }),
        EduPayAttendance.distinct("classLevel", { school, classLevel: { $in: classIds }, date: today }).then((marked) => Math.max(0, classIds.length - marked.length)),
        pairs.length ? EduPayAssessment.countDocuments({ school, status: { $in: ["DRAFT", "RETURNED"] }, $or: pairs }) : 0,
        pairs.length ? EduPayAssessment.countDocuments({ school, status: "SUBMITTED", $or: pairs }) : 0,
      ]);
      return res.json({ success: true, role: "TEACHER", assignments: scope.assignments, summary: { todayClasses: classIds.length, totalAssignedStudents: students, attendancePendingToday: pendingAttendance, upcomingExams, resultsAwaitingSubmission: pendingResults } });
    }
    const [students, teachers, classes, attendance, assessments, published] = await Promise.all([
      EduPayStudent.countDocuments({ school, status: "ACTIVE" }), EduPayTeacher.countDocuments({ school, status: "ACTIVE" }),
      EduPayClass.countDocuments({ school, status: "ACTIVE" }), EduPayAttendance.countDocuments({ school, date: new Date().toISOString().slice(0, 10) }),
      EduPayAssessment.countDocuments({ school, status: { $in: ["DRAFT", "SUBMITTED", "RETURNED", "APPROVED"] } }),
      EduPayAssessment.countDocuments({ school, status: "PUBLISHED" }),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    const [present, absent] = await Promise.all([
      EduPayAttendance.countDocuments({ school, date: today, status: "PRESENT" }),
      EduPayAttendance.countDocuments({ school, date: today, status: "ABSENT" }),
    ]);
    const totalMarked = present + absent;
    res.json({ success: true, summary: { totalStudents: students, totalTeachers: teachers, totalClasses: classes, studentsPresentToday: present, studentsAbsentToday: absent, attendancePercentage: totalMarked ? Math.round(present / totalMarked * 10000) / 100 : null, pendingResults: assessments, publishedResults: published } });
  } catch (e) { fail(res, e); }
};

exports.createSession = async (req, res) => {
  try {
    if (!manager(req, res)) return;
    const school = schoolId(req); const status = String(req.body.status || "DRAFT").toUpperCase();
    if (status === "ACTIVE") await EduPayAcademicSession.updateMany({ school, status: "ACTIVE" }, { $set: { status: "CLOSED", updatedBy: req.user._id } });
    const row = await EduPayAcademicSession.create({ school, name: req.body.name, startsAt: req.body.startsAt, endsAt: req.body.endsAt, status });
    await audit({ actor: req.user._id, action: "EDUPAY_SESSION_CREATED", entityType: "EduPayAcademicSession", entityId: row._id, school, req });
    res.status(201).json({ success: true, session: row });
  } catch (e) { fail(res, e); }
};
exports.updateSession = async (req, res) => {
  try {
    if (!manager(req, res)) return; const row = await ensureOwned(EduPayAcademicSession, req.params.sessionId, schoolId(req), "Session");
    if (req.body.status === "ACTIVE") await EduPayAcademicSession.updateMany({ school: schoolId(req), status: "ACTIVE", _id: { $ne: row._id } }, { $set: { status: "CLOSED" } });
    ["name", "startsAt", "endsAt", "status"].forEach((k) => { if (req.body[k] !== undefined) row[k] = req.body[k]; }); row.updatedBy = req.user._id; await row.save();
    res.json({ success: true, session: row });
  } catch (e) { fail(res, e); }
};
exports.createTerm = async (req, res) => {
  try {
    if (!manager(req, res)) return; const session = await ensureOwned(EduPayAcademicSession, req.body.session, schoolId(req), "Session");
    const status = String(req.body.status || "DRAFT").toUpperCase();
    if (status === "ACTIVE") await EduPayTerm.updateMany({ school: schoolId(req), status: "ACTIVE" }, { $set: { status: "CLOSED" } });
    const row = await EduPayTerm.create({ school: schoolId(req), session: session._id, name: req.body.name, startsAt: req.body.startsAt, endsAt: req.body.endsAt, status });
    res.status(201).json({ success: true, term: row });
  } catch (e) { fail(res, e); }
};
exports.listAcademic = async (req, res) => {
  try {
    const school = schoolId(req);
    let [sessions, terms, classes, subjects] = await Promise.all([
      EduPayAcademicSession.find({ school }).sort({ startsAt: -1 }).lean(), EduPayTerm.find({ school }).sort({ startsAt: 1 }).lean(),
      EduPayClass.find({ school }).sort({ name: 1 }).lean(), EduPaySubject.find({ school }).sort({ name: 1 }).lean(),
    ]);
    let assignments = [];
    if (!isManager(req)) {
      const scope = await teacherScope(req);
      if (!scope.teacher) return res.status(403).json({ success: false, message: "Active teacher profile required." });
      assignments = scope.assignments;
      const classIds = new Set(assignments.map((row) => String(row.classLevel)));
      const subjectIds = new Set(assignments.map((row) => String(row.subject)));
      classes = classes.filter((row) => classIds.has(String(row._id)));
      subjects = subjects.filter((row) => subjectIds.has(String(row._id)));
    }
    res.json({ success: true, sessions, terms, classes, subjects, assignments });
  } catch (e) { fail(res, e); }
};
exports.createClass = async (req, res) => {
  try {
    if (!manager(req, res)) return;
    const school = schoolId(req);
    const session = await ensureOwned(EduPayAcademicSession, req.body.session, school, "Session");
    if (req.body.classTeacher) await ensureOwned(EduPayTeacher, req.body.classTeacher, school, "Class teacher");
    const row = await EduPayClass.create({ school, name: req.body.name, arm: req.body.arm, session: session._id, classTeacher: req.body.classTeacher || null, status: req.body.status || "ACTIVE" });
    res.status(201).json({ success: true, classLevel: row });
  } catch (e) { fail(res, e); }
};
exports.createSubject = async (req, res) => {
  try {
    if (!manager(req, res)) return; const row = await EduPaySubject.create({ school: schoolId(req), name: req.body.name, code: req.body.code, createdBy: req.user._id });
    res.status(201).json({ success: true, subject: row });
  } catch (e) { fail(res, e); }
};

const studentPayload = (body, school, actor) => ({
  school, studentId: String(body.studentId || body.admissionNumber || "").trim().toUpperCase(), fullName: body.fullName || [body.firstName, body.middleName, body.lastName].filter(Boolean).join(" ").trim(),
  firstName: body.firstName, middleName: body.middleName, lastName: body.lastName, gender: body.gender, dateOfBirth: body.dob || body.dateOfBirth,
  classLevel: body.classLevel || body.classId || null, parent: body.parent || null, parentName: body.parentName, parentPhone: body.parentPhone, parentEmail: body.parentEmail, admissionDate: body.admissionDate, createdBy: actor,
});
const validateStudentReferences = async (rows, school) => {
  for (const body of rows) {
    if (body.classLevel || body.classId) await ensureOwned(EduPayClass, body.classLevel || body.classId, school, "Class");
    if (body.parent) {
      const parent = await User.findOne({ _id: body.parent, role: "CUSTOMER", status: "ACTIVE" }).select("_id");
      if (!parent) { const e = new Error("Parent account is invalid."); e.statusCode = 400; throw e; }
    }
  }
};
const validateRows = (rows) => {
  const seen = new Set(); const validRows = []; const invalidRows = []; const duplicates = [];
  rows.forEach((body, index) => {
    const row = studentPayload(body, null, null); const missingRequired = [];
    if (!row.studentId) missingRequired.push("studentId"); if (!row.fullName) missingRequired.push("fullName");
    if (seen.has(row.studentId)) duplicates.push({ row: index + 1, studentId: row.studentId });
    else if (missingRequired.length) invalidRows.push({ row: index + 1, missingRequired });
    else { seen.add(row.studentId); validRows.push({ row: index + 1, data: body }); }
  });
  return { validRows, invalidRows, duplicates };
};
exports.listStudents = async (req, res) => {
  try {
    const school = schoolId(req);
    const query = { school, ...(req.query.status ? { status: req.query.status } : {}) };
    if (!isManager(req)) {
      const scope = await teacherScope(req);
      if (!scope.teacher) return res.status(403).json({ success: false, message: "Active teacher profile required." });
      const assignedClasses = [...new Set(scope.assignments.map((row) => String(row.classLevel)))];
      const requested = req.query.classId ? String(req.query.classId) : null;
      query.classLevel = requested && assignedClasses.includes(requested) ? requested : requested ? { $in: [] } : { $in: assignedClasses };
    } else if (req.query.classId) query.classLevel = req.query.classId;
    res.json({ success: true, students: await EduPayStudent.find(query).populate("classLevel").sort({ fullName: 1 }).lean() });
  } catch (e) { fail(res, e); }
};
exports.validateStudentImport = async (req, res) => {
  try {
    const result = validateRows(Array.isArray(req.body.rows) ? req.body.rows : []);
    const referenceValid = [];
    for (const row of result.validRows) {
      try {
        await validateStudentReferences([row.data], schoolId(req));
        referenceValid.push(row);
      } catch (error) {
        result.invalidRows.push({ row: row.row, message: error.message });
      }
    }
    result.validRows = referenceValid;
    const ids = result.validRows.map((row) => row.data.studentId || row.data.admissionNumber).filter(Boolean).map((value) => String(value).trim().toUpperCase());
    const existing = await EduPayStudent.find({ school: schoolId(req), studentId: { $in: ids } }).select("studentId").lean();
    const existingIds = new Set(existing.map((row) => row.studentId));
    result.validRows = result.validRows.filter((row) => !existingIds.has(String(row.data.studentId || row.data.admissionNumber).trim().toUpperCase()));
    result.duplicates.push(...existing.map((row) => ({ studentId: row.studentId, existing: true })));
    res.json({ success: true, ...result, canCommit: result.invalidRows.length === 0 && result.duplicates.length === 0 });
  } catch (e) { fail(res, e); }
};
exports.commitStudentImport = async (req, res) => {
  try {
    if (!manager(req, res)) return; const rows = Array.isArray(req.body.rows) ? req.body.rows : []; const result = validateRows(rows); if (result.invalidRows.length || result.duplicates.length) return res.status(422).json({ success: false, code: "IMPORT_VALIDATION_FAILED", ...result });
    await validateStudentReferences(rows, schoolId(req)); const docs = rows.map((row) => studentPayload(row, schoolId(req), req.user._id)); const created = await EduPayStudent.insertMany(docs, { ordered: true }); await audit({ actor: req.user._id, action: "EDUPAY_STUDENTS_IMPORTED", entityType: "EduPayStudent", school: schoolId(req), metadata: { count: created.length }, req }); res.status(201).json({ success: true, students: created, count: created.length });
  } catch (e) { fail(res, e); }
};
exports.createStudent = async (req, res) => { try { if (!manager(req, res)) return; await validateStudentReferences([req.body], schoolId(req)); const row = await EduPayStudent.create(studentPayload(req.body, schoolId(req), req.user._id)); res.status(201).json({ success: true, student: row }); } catch (e) { fail(res, e); } };
exports.updateStudent = async (req, res) => {
  try {
    if (!manager(req, res)) return;
    const student = await ensureOwned(EduPayStudent, req.params.studentId, schoolId(req), "Student");
    await validateStudentReferences([req.body], schoolId(req));
    for (const key of ["fullName", "gender", "dateOfBirth", "parent", "parentName", "parentPhone", "parentEmail", "admissionDate", "status"]) {
      if (req.body[key] !== undefined) student[key] = req.body[key] || null;
    }
    if (req.body.classLevel !== undefined || req.body.classId !== undefined) student.classLevel = req.body.classLevel || req.body.classId || null;
    student.updatedBy = req.user._id;
    await student.save();
    await audit({ actor: req.user._id, action: "EDUPAY_STUDENT_UPDATED", entityType: "EduPayStudent", entityId: student._id, school: schoolId(req), metadata: { status: student.status, classLevel: student.classLevel ? String(student.classLevel) : null }, req });
    res.json({ success: true, student });
  } catch (e) { fail(res, e); }
};

const assignmentInputs = (body) => {
  if (Array.isArray(body.assignments)) return body.assignments.map((row) => ({ classLevel: row.classLevel || row.classId, subject: row.subject || row.subjectId }));
  const classes = Array.isArray(body.classIds) ? body.classIds : [];
  const subjects = Array.isArray(body.subjectIds) ? body.subjectIds : [];
  return classes.map((classLevel, index) => ({ classLevel, subject: subjects[index] })).filter((row) => row.subject);
};
const validateAssignments = async (assignments, school, session = null) => {
  for (const assignment of assignments) {
    await ensureOwned(EduPayClass, assignment.classLevel, school, "Class", session);
    await ensureOwned(EduPaySubject, assignment.subject, school, "Subject", session);
  }
};
const saveAssignments = async (teacher, assignments, actor, { replace = false, session = null } = {}) => {
  const school = schoolId({ eduPaySchool: teacher.school });
  await validateAssignments(assignments, school, session);
  if (replace) await EduPayTeacherAssignment.deleteMany({ school, teacher: teacher._id }).session(session);
  const output = [];
  for (const assignment of assignments) {
    const row = await EduPayTeacherAssignment.findOneAndUpdate(
      { school, teacher: teacher._id, classLevel: assignment.classLevel, subject: assignment.subject },
      { $setOnInsert: { school, teacher: teacher._id, classLevel: assignment.classLevel, subject: assignment.subject, createdBy: actor } },
      { upsert: true, new: true, setDefaultsOnInsert: true, session },
    );
    output.push(row);
  }
  return output;
};
exports.createTeacher = async (req, res) => {
  let session;
  try {
    if (!manager(req, res)) return;
    const school = schoolId(req);
    session = await mongoose.startSession();
    let result;
    await session.withTransaction(async () => {
    let user;
    if (req.body.userId) {
      id(req.body.userId, "User");
      user = await User.findOne({ _id: req.body.userId, status: "ACTIVE" }).select("_id fullName email phone").session(session);
       if (!user) { const e = new Error("Active teacher user not found."); e.statusCode = 404; throw e; }
      const otherMembership = await SchoolUser.findOne({ user: user._id, school: { $ne: school }, status: { $in: ["ACTIVE", "INVITED"] } }).session(session);
       if (otherMembership) { const e = new Error("This user already belongs to another school."); e.statusCode = 409; throw e; }
    } else {
      const email = String(req.body.email || "").trim().toLowerCase();
      const phone = String(req.body.phone || "").trim();
       if (!req.body.fullName || !email || !phone) { const e = new Error("Full name, email, and phone are required for a new teacher account."); e.statusCode = 400; throw e; }
      const password = temporaryPassword(req.body.temporaryPassword);
      if (await User.exists({ $or: [{ email }, { phone }] }).session(session)) { const e = new Error("An account already exists with this email or phone."); e.statusCode = 409; throw e; }
      [user] = await User.create([{ fullName: req.body.fullName, email, phone, password, role: "CUSTOMER", status: "ACTIVE", mustChangePassword: true }], { session });
    }
    const staffId = String(req.body.staffId || "").trim();
    if (!staffId) { const e = new Error("Teacher ID is required."); e.statusCode = 400; throw e; }
    const [row] = await EduPayTeacher.create([{ school, user: user._id, staffId, fullName: req.body.fullName || user.fullName, email: req.body.email || user.email, phone: req.body.phone || user.phone, gender: req.body.gender, responsibility: req.body.responsibility, createdBy: req.user._id }], { session });
    await SchoolUser.updateOne({ school, user: user._id }, { $set: { role: "TEACHER", status: "ACTIVE" }, $setOnInsert: { school, user: user._id, invitedBy: req.user._id } }, { upsert: true, session });
    const assignments = await saveAssignments(row, assignmentInputs(req.body), req.user._id, { session });
    await audit({ actor: req.user._id, action: "EDUPAY_TEACHER_CREATED", entityType: "EduPayTeacher", entityId: row._id, school, metadata: { accountCreated: !req.body.userId, assignmentCount: assignments.length }, req, session });
    result = { teacher: row, assignments, account: { userId: user._id, email: user.email, mustChangePassword: user.mustChangePassword === true } };
    });
    res.status(201).json({ success: true, ...result });
  } catch (e) { fail(res, e); }
  finally { if (session) await session.endSession(); }
};
exports.updateTeacher = async (req, res) => {
  let session;
  try {
    if (!manager(req, res)) return;
    const school = schoolId(req);
    session = await mongoose.startSession();
    let result;
    await session.withTransaction(async () => {
    const teacher = await ensureOwned(EduPayTeacher, req.params.teacherId, school, "Teacher", session);
    for (const key of ["fullName", "phone", "email", "gender", "responsibility", "staffId"]) if (req.body[key] !== undefined) teacher[key] = req.body[key];
    teacher.updatedBy = req.user._id; await teacher.save({ session });
    const user = await User.findById(teacher.user).session(session);
    if (user) { if (req.body.fullName !== undefined) user.fullName = req.body.fullName; if (req.body.phone !== undefined) user.phone = req.body.phone; if (req.body.email !== undefined) user.email = String(req.body.email).trim().toLowerCase(); await user.save({ session }); }
    const assignments = req.body.assignments || req.body.classIds || req.body.subjectIds ? await saveAssignments(teacher, assignmentInputs(req.body), req.user._id, { replace: req.body.replaceAssignments === true, session }) : undefined;
    await audit({ actor: req.user._id, action: "EDUPAY_TEACHER_UPDATED", entityType: "EduPayTeacher", entityId: teacher._id, school, metadata: { assignmentsChanged: assignments !== undefined }, req, session });
    result = { teacher, assignments };
    });
    res.json({ success: true, ...result, ...(result.assignments ? { assignments: result.assignments } : {}) });
  } catch (e) { fail(res, e); }
  finally { if (session) await session.endSession(); }
};
exports.updateTeacherStatus = async (req, res) => {
  let session;
  try {
    if (!manager(req, res)) return;
    const status = String(req.body.status || "").toUpperCase();
    if (!["ACTIVE", "INACTIVE"].includes(status)) return res.status(400).json({ success: false, message: "Teacher status must be ACTIVE or INACTIVE." });
    const school = schoolId(req);
    session = await mongoose.startSession();
    let teacher;
    await session.withTransaction(async () => {
    teacher = await ensureOwned(EduPayTeacher, req.params.teacherId, school, "Teacher", session);
    teacher.status = status; teacher.updatedBy = req.user._id; await teacher.save({ session });
    await SchoolUser.updateOne({ school, user: teacher.user }, { $set: { status: status === "ACTIVE" ? "ACTIVE" : "SUSPENDED" } }, { session });
    await User.updateOne({ _id: teacher.user }, { $set: { status: status === "ACTIVE" ? "ACTIVE" : "SUSPENDED" }, $inc: { authTokenVersion: 1 } }, { session });
    await audit({ actor: req.user._id, action: `EDUPAY_TEACHER_${status}`, entityType: "EduPayTeacher", entityId: teacher._id, school, req, session });
    });
    res.json({ success: true, teacher });
  } catch (e) { fail(res, e); }
  finally { if (session) await session.endSession(); }
};
exports.resetTeacherPassword = async (req, res) => {
  try {
    if (!manager(req, res)) return;
    const password = temporaryPassword(req.body.temporaryPassword);
    const teacher = await ensureOwned(EduPayTeacher, req.params.teacherId, schoolId(req), "Teacher");
    const user = await User.findById(teacher.user).select("+password +authTokenVersion");
    if (!user) return res.status(404).json({ success: false, message: "Teacher account not found." });
    user.password = password; user.passwordResetToken = undefined; user.passwordResetExpires = undefined; user.mustChangePassword = true; user.passwordChangedAt = new Date(); user.authTokenVersion = Number(user.authTokenVersion || 0) + 1; await user.save();
    await audit({ actor: req.user._id, action: "EDUPAY_TEACHER_PASSWORD_RESET", entityType: "User", entityId: user._id, school: schoolId(req), req });
    res.json({ success: true, message: "Temporary teacher password set.", teacher: { id: teacher._id, userId: user._id, mustChangePassword: true } });
  } catch (e) { fail(res, e); }
};
exports.assignTeacher = async (req, res) => { try { if (!manager(req, res)) return; const teacher = await ensureOwned(EduPayTeacher, req.body.teacher, schoolId(req), "Teacher"); const assignments = await saveAssignments(teacher, [{ classLevel: req.body.classLevel, subject: req.body.subject }], req.user._id); res.status(201).json({ success: true, assignment: assignments[0] }); } catch (e) { fail(res, e); } };
exports.listTeachers = async (req, res) => {
  try {
    const school = schoolId(req);
    if (isManager(req)) return res.json({ success: true, teachers: await EduPayTeacher.find({ school }).populate("user", "fullName email phone").lean(), assignments: await EduPayTeacherAssignment.find({ school }).populate("teacher classLevel subject").lean() });
    const scope = await teacherScope(req);
    if (!scope.teacher) return res.status(403).json({ success: false, message: "Active teacher profile required." });
    res.json({ success: true, teachers: await EduPayTeacher.find({ _id: scope.teacher._id }).populate("user", "fullName email phone").lean(), assignments: await EduPayTeacherAssignment.find({ school, teacher: scope.teacher._id }).populate("teacher classLevel subject").lean() });
  } catch (e) { fail(res, e); }
};

exports.attendanceRoster = async (req, res) => { try { const classLevel = await ensureOwned(EduPayClass, req.query.classId, schoolId(req), "Class"); if (!isManager(req) && !(await teacherFor(req, classLevel._id))) return res.status(403).json({ success: false, message: "Teacher is not assigned to this class." }); res.json({ success: true, students: await EduPayStudent.find({ school: schoolId(req), classLevel: classLevel._id, status: "ACTIVE" }).sort({ fullName: 1 }).lean() }); } catch (e) { fail(res, e); } };
exports.submitAttendance = async (req, res) => {
  try {
    const school = schoolId(req); const classLevel = await ensureOwned(EduPayClass, req.body.classId, school, "Class"); const session = await ensureOwned(EduPayAcademicSession, req.body.session, school, "Session"); const term = await ensureOwned(EduPayTerm, req.body.term, school, "Term");
    const teacher = isManager(req) ? null : await teacherFor(req, classLevel._id);
    if (!isManager(req) && !teacher) return res.status(403).json({ success: false, message: "Teacher is not assigned to this class." });
    let rows = Array.isArray(req.body.records) ? req.body.records : [];
    const allStatus = String(req.body.markAllStatus || "").toUpperCase();
    const rosterQuery = { school, classLevel: classLevel._id, status: "ACTIVE" };
    if (allStatus && ["PRESENT", "ABSENT", "LATE", "EXCUSED"].includes(allStatus)) rows = (await EduPayStudent.find(rosterQuery).select("_id").lean()).map((student) => ({ student: student._id, status: allStatus }));
    const students = await EduPayStudent.find({ ...rosterQuery, _id: { $in: rows.map((r) => r.student) } }).select("_id parent").lean(); const allowed = new Set(students.map((r) => String(r._id))); if (rows.some((r) => !allowed.has(String(r.student)) || !["PRESENT", "ABSENT", "LATE", "EXCUSED"].includes(r.status))) return res.status(400).json({ success: false, message: "Attendance contains an invalid student or status." });
    const date = String(req.body.date || "").slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ success: false, message: "Attendance date must be YYYY-MM-DD." });
    const output = []; const corrections = [];
    for (const row of rows) {
      const key = { school, classLevel: classLevel._id, student: row.student, date, session: session._id, term: term._id };
      const existing = await EduPayAttendance.findOne(key).select("status").lean();
      const update = { $set: { status: row.status, teacher: teacher?._id || null, updatedBy: req.user._id }, $setOnInsert: { ...key, createdBy: req.user._id } };
      if (existing) {
        update.$set.correctedAt = new Date();
        update.$set.correctedBy = req.user._id;
        if (existing.status !== row.status) corrections.push({ student: String(row.student), from: existing.status, to: row.status });
      }
      output.push(await EduPayAttendance.findOneAndUpdate(key, update, { upsert: true, new: true, runValidators: true }));
    }
    await audit({ actor: req.user._id, action: "EDUPAY_ATTENDANCE_SUBMITTED", entityType: "EduPayAttendance", school, metadata: { date, class: String(classLevel._id), count: output.length, corrections }, req });
    for (const row of output) {
      const student = students.find((candidate) => String(candidate._id) === String(row.student));
      if ((row.status === "ABSENT" || row.status === "LATE") && student?.parent) Promise.resolve(notify(student.parent, `Attendance ${row.status}`, `Attendance was marked ${row.status}.`)).catch(() => {});
    }
    res.json({ success: true, records: output });
  } catch (e) { fail(res, e); }
};

exports.createAssessment = async (req, res) => { try { if (!manager(req, res)) return; const school = schoolId(req); await ensureOwned(EduPayAcademicSession, req.body.session, school, "Session"); await ensureOwned(EduPayTerm, req.body.term, school, "Term"); await ensureOwned(EduPayClass, req.body.classLevel, school, "Class"); await ensureOwned(EduPaySubject, req.body.subject, school, "Subject"); const row = await EduPayAssessment.create({ ...req.body, school, components: req.body.components || [{ name: "Total", max: 100 }], grading: ranges(req.body.grading), createdBy: req.user._id }); res.status(201).json({ success: true, assessment: row }); } catch (e) { fail(res, e); } };
exports.listAssessments = async (req, res) => {
  try {
    const query = { school: schoolId(req) };
    if (!isManager(req)) {
      const scope = await teacherScope(req);
      if (!scope.teacher) return res.status(403).json({ success: false, message: "Active teacher profile required." });
      query.$or = scope.assignments.map((row) => ({ classLevel: row.classLevel, subject: row.subject }));
      if (!query.$or.length) return res.json({ success: true, assessments: [] });
    }
    res.json({ success: true, assessments: await EduPayAssessment.find(query).populate("classLevel subject session term").sort({ createdAt: -1 }).lean() });
  } catch (e) { fail(res, e); }
};
const scoreResult = (assessment, values, allowMissing = false) => {
  const keys = assessment.components.map((c) => c.name);
  const entered = [];
  for (const key of keys) {
    const hasValue = Object.prototype.hasOwnProperty.call(values, key);
    if (!hasValue && allowMissing) continue;
    const raw = values[key];
    if (raw === null || raw === undefined || typeof raw === "boolean" || (typeof raw === "object" && raw !== null) || (typeof raw === "string" && !raw.trim())) {
      const e = new Error(`Score for ${key} is required and must be a finite number.`); e.statusCode = 400; throw e;
    }
    const value = Number(raw);
    const max = assessment.components.find((c) => c.name === key).max;
    if (!Number.isFinite(value) || value < 0 || value > max) {
      const e = new Error(`Score for ${key} must be between 0 and ${max}.`); e.statusCode = 400; throw e;
    }
    entered.push([key, value]);
  }
  const total = entered.reduce((sum, [, value]) => sum + value, 0);
  const max = assessment.components.reduce((sum, c) => sum + Number(c.max), 0);
  const percentage = max ? Math.round(total / max * 10000) / 100 : 0;
  const grade = assessment.grading.find((r) => percentage >= r.min && percentage <= r.max) || {};
  return { total, percentage, grade: grade.grade || null, remark: grade.remark || null };
};
exports.saveScores = async (req, res) => {
  let session;
  try {
    const school = schoolId(req);
    session = await mongoose.startSession();
    let result;
    await session.withTransaction(async () => {
      const assessment = await EduPayAssessment.findOne({ _id: req.params.assessmentId, school }).session(session);
      if (!assessment) { const e = new Error("Assessment not found."); e.statusCode = 404; throw e; }
      if (!["DRAFT", "RETURNED"].includes(assessment.status)) { const e = new Error("This assessment is locked."); e.statusCode = 409; throw e; }
      const expectedVersion = Number(assessment.__v || 0);
      const teacher = isManager(req) ? null : await teacherFor(req, assessment.classLevel, assessment.subject);
      if (!isManager(req) && !teacher) { const e = new Error("Teacher is not assigned to this assessment."); e.statusCode = 403; throw e; }
      const entries = [];
      for (const input of (req.body.scores || [])) {
        const student = await EduPayStudent.findOne({ _id: input.student, school, classLevel: assessment.classLevel, status: "ACTIVE" }).session(session);
        if (!student) { const e = new Error("Score student is outside the assigned class."); e.statusCode = 403; throw e; }
        const calculated = scoreResult(assessment, input.values || {}, !req.body.submit);
        entries.push(await EduPayScore.findOneAndUpdate({ school, assessment: assessment._id, student: student._id }, { $set: { values: input.values, ...calculated, status: req.body.submit ? "SUBMITTED" : "DRAFT", teacher: teacher?._id || null, updatedBy: req.user._id }, $setOnInsert: { school, assessment: assessment._id, student: student._id, createdBy: req.user._id } }, { upsert: true, new: true, runValidators: true, session }));
      }
      const nextStatus = req.body.submit ? "SUBMITTED" : assessment.status;
      const updated = await EduPayAssessment.findOneAndUpdate(
        { _id: assessment._id, school, status: { $in: ["DRAFT", "RETURNED"] }, __v: expectedVersion },
        { $set: { status: nextStatus, updatedBy: req.user._id }, $inc: { __v: 1 } },
        { new: true, session },
      );
      if (!updated) { const e = new Error("Assessment changed while scores were being saved."); e.statusCode = 409; throw e; }
      result = { entries, status: updated.status };
    });
    res.json({ success: true, scores: result.entries, status: result.status });
  } catch (e) { fail(res, e); }
  finally { if (session) await session.endSession(); }
};
exports.reviewAssessment = async (req, res) => { try { if (!manager(req, res)) return; const row = await EduPayAssessment.findOne({ _id: req.params.assessmentId, school: schoolId(req) }); if (!row) return res.status(404).json({ success: false, message: "Assessment not found." }); const action = String(req.body.action || "").toUpperCase(); const transitions = { SUBMITTED: { RETURN: "RETURNED", APPROVE: "APPROVED" }, APPROVED: { PUBLISH: "PUBLISHED" } }; const next = transitions[row.status]?.[action]; if (!next) return res.status(409).json({ success: false, message: "Invalid assessment review transition." }); row.status = next; row.reviewedBy = req.user._id; row.reviewedAt = new Date(); row.reviewNote = req.body.note; await row.save(); await audit({ actor: req.user._id, action: `EDUPAY_RESULT_${next}`, entityType: "EduPayAssessment", entityId: row._id, school: schoolId(req), req }); res.json({ success: true, assessment: row }); } catch (e) { fail(res, e); } };

exports.createTimetable = async (req, res) => { try { if (!manager(req, res)) return; const school = schoolId(req); await ensureOwned(EduPayAcademicSession, req.body.session, school, "Session"); await ensureOwned(EduPayTerm, req.body.term, school, "Term"); await ensureOwned(EduPayClass, req.body.classLevel, school, "Class"); await ensureOwned(EduPaySubject, req.body.subject, school, "Subject"); await ensureOwned(EduPayTeacher, req.body.teacher, school, "Teacher"); const row = await EduPayTimetable.create({ ...req.body, school, createdBy: req.user._id }); res.status(201).json({ success: true, timetable: row }); } catch (e) { fail(res, e); } };
exports.listTimetable = async (req, res) => { try { const query = { school: schoolId(req), ...(req.query.classId ? { classLevel: req.query.classId } : {}) }; if (!isManager(req)) { const scope = await teacherScope(req); if (!scope.teacher) return res.status(403).json({ success: false, message: "Active teacher profile required." }); query.teacher = scope.teacher._id; } const rows = await EduPayTimetable.find(query).populate("classLevel subject teacher").sort({ day: 1, startsAt: 1 }).lean(); res.json({ success: true, timetable: rows }); } catch (e) { fail(res, e); } };
exports.createActivity = async (req, res) => {
  try {
    const school = schoolId(req);
    if (!isManager(req)) {
      const audience = String(req.body.audience || "CLASS").toUpperCase();
      if (!["CLASS", "STUDENT"].includes(audience)) return res.status(403).json({ success: false, message: "Teachers may only publish class or student updates." });
      const scope = await teacherScope(req);
      if (!scope.teacher) return res.status(403).json({ success: false, message: "Active teacher profile required." });
      const classLevel = await ensureOwned(EduPayClass, req.body.classLevel || req.body.classId, school, "Class");
      if (!(await teacherFor(req, classLevel._id))) return res.status(403).json({ success: false, message: "Teacher is not assigned to this class." });
      if (audience === "STUDENT") {
        const student = await ensureOwned(EduPayStudent, req.body.student, school, "Student");
        if (String(student.classLevel) !== String(classLevel._id)) return res.status(403).json({ success: false, message: "Student is outside the assigned class." });
      }
      req.body.audience = audience; req.body.classLevel = classLevel._id;
    } else if (req.body.classLevel || req.body.classId) {
      await ensureOwned(EduPayClass, req.body.classLevel || req.body.classId, school, "Class");
    }
    const row = await EduPayAcademicActivity.create({ ...req.body, school, classLevel: req.body.classLevel || req.body.classId || null, type: String(req.body.type || "ANNOUNCEMENT").toUpperCase(), createdBy: req.user._id });
    res.status(201).json({ success: true, activity: row });
  } catch (e) { fail(res, e); }
};
exports.listActivities = async (req, res) => {
  try {
    const school = schoolId(req);
    const query = { school, status: "PUBLISHED" };
    if (!isManager(req)) {
      const scope = await teacherScope(req);
      if (!scope.teacher) return res.status(403).json({ success: false, message: "Active teacher profile required." });
      const classIds = [...new Set(scope.assignments.map((row) => String(row.classLevel)))];
      const studentIds = await EduPayStudent.find({ school, classLevel: { $in: classIds } }).distinct("_id");
      query.$or = [
        { audience: "SCHOOL" },
        { audience: "CLASS", classLevel: { $in: classIds } },
        { audience: "STUDENT", student: { $in: studentIds } },
      ];
    }
    res.json({ success: true, activities: await EduPayAcademicActivity.find(query).sort({ eventDate: -1, createdAt: -1 }).lean() });
  } catch (e) { fail(res, e); }
};

const parentChild = async (req) => {
  let child = await EduPayStudent.findOne({ _id: req.params.childId, parent: req.user._id, school: { $exists: true }, status: "ACTIVE" }).populate("classLevel").lean();
  if (!child && EduPayChild) {
    const legacy = await EduPayChild.findOne({ _id: req.params.childId, parent: req.user._id, status: "ACTIVE" }).populate("school").lean();
    if (legacy) child = { ...legacy, classLevel: null };
  }
  if (!child) { const e = new Error("Child not found."); e.statusCode = 404; throw e; } return child;
};
exports.parentAcademicChildren = async (req, res) => {
  try {
    const children = await EduPayStudent.find({
      parent: req.user._id,
      status: { $in: ["ACTIVE", "GRADUATED", "TRANSFERRED"] },
    }).populate("school", "name location").populate("classLevel", "name arm").sort({ fullName: 1 }).lean();
    res.json({ success: true, children });
  } catch (e) { fail(res, e); }
};
exports.parentAttendance = async (req, res) => { try { const child = await parentChild(req); res.json({ success: true, child, attendance: await EduPayAttendance.find({ school: child.school, student: child._id }).sort({ date: -1 }).limit(365).lean() }); } catch (e) { fail(res, e); } };
exports.parentResults = async (req, res) => { try { const child = await parentChild(req); const assessments = await EduPayAssessment.find({ school: child.school, classLevel: child.classLevel, status: "PUBLISHED" }).select("_id title session term subject grading").lean(); res.json({ success: true, child, results: await EduPayScore.find({ school: child.school, student: child._id, assessment: { $in: assessments.map((a) => a._id) }, status: "SUBMITTED" }).populate("assessment").sort({ createdAt: -1 }).lean() }); } catch (e) { fail(res, e); } };
exports.parentActivities = async (req, res) => { try { const child = await parentChild(req); res.json({ success: true, child, activities: await EduPayAcademicActivity.find({ school: child.school, status: "PUBLISHED", $or: [{ audience: "SCHOOL" }, { audience: "CLASS", classLevel: child.classLevel }, { audience: "STUDENT", student: child._id }] }).sort({ eventDate: -1 }).lean() }); } catch (e) { fail(res, e); } };
exports.parentTimetable = async (req, res) => { try { const child = await parentChild(req); res.json({ success: true, child, timetable: await EduPayTimetable.find({ school: child.school, classLevel: child.classLevel }).populate("subject teacher").sort({ day: 1, startsAt: 1 }).lean() }); } catch (e) { fail(res, e); } };

exports.adminAcademicOverview = async (req, res) => {
  try {
    const requestedSchoolId = String(req.query.schoolId || "").trim();
    if (requestedSchoolId && !mongoose.isValidObjectId(requestedSchoolId)) {
      return res.status(400).json({
        success: false,
        message: "School is invalid.",
      });
    }

    const schoolFilter = {
      status: "APPROVED",
      active: true,
      ...(requestedSchoolId
        ? { _id: new mongoose.Types.ObjectId(requestedSchoolId) }
        : {}),
    };
    const schools = await School.find(schoolFilter)
      .select("name location status active")
      .sort({ name: 1 })
      .lean();
    const schoolIds = schools.map((school) => school._id);
    const scoped = { school: { $in: schoolIds } };
    const last30Days = new Date(Date.now() - 30 * 86400000);

    const countBySchool = async (Model, match = {}) =>
      Model.aggregate([
        { $match: { ...scoped, ...match } },
        { $group: { _id: "$school", count: { $sum: 1 } } },
      ]);
    const latestBySchool = async (Model, dateField, match = {}) =>
      Model.aggregate([
        { $match: { ...scoped, ...match } },
        {
          $group: {
            _id: "$school",
            count: { $sum: 1 },
            latestAt: { $max: `$${dateField}` },
          },
        },
      ]);

    const [
      studentCounts,
      teacherCounts,
      classCounts,
      subjectCounts,
      sessionCounts,
      attendanceActivity,
      publishedResultActivity,
      timetableCounts,
      activityCounts,
      linkedParents,
    ] = await Promise.all([
      countBySchool(EduPayStudent, { status: "ACTIVE" }),
      countBySchool(EduPayTeacher, { status: "ACTIVE" }),
      countBySchool(EduPayClass),
      countBySchool(EduPaySubject),
      countBySchool(EduPayAcademicSession),
      latestBySchool(EduPayAttendance, "createdAt"),
      latestBySchool(EduPayAssessment, "updatedAt", { status: "PUBLISHED" }),
      countBySchool(EduPayTimetable),
      latestBySchool(EduPayAcademicActivity, "createdAt", {
        status: "PUBLISHED",
      }),
      EduPayStudent.distinct("parent", {
        ...scoped,
        parent: { $ne: null },
      }).then((rows) => rows.length),
    ]);

    const asCountMap = (rows) =>
      new Map(rows.map((row) => [String(row._id), Number(row.count || 0)]));
    const asActivityMap = (rows) =>
      new Map(
        rows.map((row) => [
          String(row._id),
          {
            count: Number(row.count || 0),
            latestAt: row.latestAt || null,
          },
        ])
      );
    const studentsBySchool = asCountMap(studentCounts);
    const teachersBySchool = asCountMap(teacherCounts);
    const classesBySchool = asCountMap(classCounts);
    const subjectsBySchool = asCountMap(subjectCounts);
    const sessionsBySchool = asCountMap(sessionCounts);
    const attendanceBySchool = asActivityMap(attendanceActivity);
    const resultsBySchool = asActivityMap(publishedResultActivity);
    const timetableBySchool = asCountMap(timetableCounts);
    const activitiesBySchool = asActivityMap(activityCounts);
    const schoolProfiles = schools.map((school) => {
      const key = String(school._id);
      return {
        id: school._id,
        name: school.name,
        location: school.location,
        status: school.status,
        students: studentsBySchool.get(key) || 0,
        teachers: teachersBySchool.get(key) || 0,
        classes: classesBySchool.get(key) || 0,
        subjects: subjectsBySchool.get(key) || 0,
        academicSessions: sessionsBySchool.get(key) || 0,
        attendanceRecords: attendanceBySchool.get(key)?.count || 0,
        lastAttendanceAt: attendanceBySchool.get(key)?.latestAt || null,
        publishedResults: resultsBySchool.get(key)?.count || 0,
        lastPublishedResultAt: resultsBySchool.get(key)?.latestAt || null,
        timetableEntries: timetableBySchool.get(key) || 0,
        schoolActivities: activitiesBySchool.get(key)?.count || 0,
        lastSchoolActivityAt: activitiesBySchool.get(key)?.latestAt || null,
      };
    });
    const sum = (rows) =>
      rows.reduce((total, row) => total + Number(row.count || 0), 0);

    return res.json({
      success: true,
      usage: {
        activeSchools: schools.length,
        activeStudents: sum(studentCounts),
        activeTeachers: sum(teacherCounts),
        linkedParents,
        classes: sum(classCounts),
        subjects: sum(subjectCounts),
        academicSessions: sum(sessionCounts),
        timetableEntries: sum(timetableCounts),
        schoolActivities: sum(activityCounts),
        attendanceLast30Days: await EduPayAttendance.countDocuments({
          ...scoped,
          createdAt: { $gte: last30Days },
        }),
        publishedResultsLast30Days: await EduPayAssessment.countDocuments({
          ...scoped,
          status: "PUBLISHED",
          updatedAt: { $gte: last30Days },
        }),
      },
      schoolProfiles,
    });
  } catch (e) {
    fail(res, e);
  }
};