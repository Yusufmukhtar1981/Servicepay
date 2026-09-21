const mongoose = require("mongoose");
const User = require("../models/user.model");
const SchoolUser = require("../models/edupaySchoolUser.model");
const { EduPayAcademicSession, EduPayTerm, EduPayClass } = require("../models/edupayAcademic.model");
const {
  EduPaySubject, EduPayClassSubject, EduPayStudent, EduPayTeacher, EduPayTeacherAssignment,
  EduPayAttendance, EduPayAssessment, EduPayScore, EduPayTimetable,
  EduPayAcademicActivity,
} = require("../models/edupayAcademicManagement.model");
const { audit, notify } = require("../services/edupay.service");
const { models } = require("../services/edupay.service");
const { validateStrongPassword } = require("../utils/passwordPolicy");
const School = models.School;
const EduPayChild = models.Child;
const GuardianLink = require("../models/edupayGuardianLink.model");
const studentLink = require("../services/edupayStudentLink.service");
const normalizeLabel = (value) => String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
const academicStudentForChild = studentLink.academicStudentForChild;
const linkedChildForStudent = studentLink.linkedChildForStudent;
const educationLevel = (value) => {
  const level = String(value || "OTHER").trim().toUpperCase().replace(/\s+/g, "_");
  return ["EARLY_YEARS", "PRIMARY", "JUNIOR_SECONDARY", "SENIOR_SECONDARY", "OTHER"].includes(level) ? level : "OTHER";
};
const classDisplay = (name, arm) => ({ name: String(name || "").trim().replace(/\s+/g, " "), arm: String(arm || "").trim().replace(/\s+/g, " ") || null });
const classDuplicate = async (school, name, arm, exclude = null) => {
  const display = classDisplay(name, arm);
  const expectedName = normalizeLabel(display.name);
  const expectedArm = normalizeLabel(display.arm);
  const query = { school };
  if (exclude) query._id = { $ne: exclude };
  const rows = await EduPayClass.find(query).select("_id name arm normalizedName normalizedArm").lean();
  return rows.find((row) =>
    (normalizeLabel(row.normalizedName || row.name) === expectedName) &&
    (normalizeLabel(row.normalizedArm || row.arm) === expectedArm)
  ) || null;
};
const subjectDuplicate = async (school, name, exclude = null) => {
  const clean = String(name || "").trim().replace(/\s+/g, " ");
  const expected = normalizeLabel(clean);
  const query = { school };
  if (exclude) query._id = { $ne: exclude };
  const rows = await EduPaySubject.find(query).select("_id name normalizedName").lean();
  return rows.find((row) => normalizeLabel(row.normalizedName || row.name) === expected) || null;
};
const mappedPair = async (school, classLevel, subject, session = null) => {
  let query = EduPayClassSubject.findOne({ school, classLevel, subject });
  if (session) query = query.session(session);
  return query;
};
const classHasMappings = async (school, classLevel, session = null) => {
  let query = EduPayClassSubject.exists({ school, classLevel });
  if (session) query = query.session(session);
  return Boolean(await query);
};
const fail = (res, e) => {
  if (e?.code === 11000) {
    const fields = e.keyPattern || {};
    const message = fields.staffId
      ? "Staff ID already exists in this school."
      : fields.studentId
        ? "Admission number already exists in this school."
      : fields.user
        ? "A teacher account already exists for this user in this school."
        : "This academic record already exists.";
    return res.status(409).json({ success: false, message });
  }
  return res.status(e.statusCode || 500).json({ success: false, message: e.message || "Academic request failed." });
};
const inputError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};
const ACADEMIC_STATUSES = new Set(["DRAFT", "ACTIVE", "UPCOMING", "CLOSED"]);
const academicStatus = (value, fallback = "DRAFT") => {
  const status = String(value || fallback).trim().toUpperCase();
  if (!ACADEMIC_STATUSES.has(status)) throw inputError("Academic status must be ACTIVE, UPCOMING, CLOSED, or legacy DRAFT.");
  return status;
};
const dateRange = (startsAt, endsAt) => {
  const start = startsAt ? new Date(startsAt) : null;
  const end = endsAt ? new Date(endsAt) : null;
  if ((start && Number.isNaN(start.getTime())) || (end && Number.isNaN(end.getTime()))) throw inputError("Academic dates must be valid.");
  if (start && end && end < start) throw inputError("Academic end date cannot precede its start date.");
  return { startsAt: start || undefined, endsAt: end || undefined };
};
const currentRequested = (body) => body.isCurrent === true || body.current === true || body.isDefault === true;
const setCurrentSession = async (school, id, actor) => {
  await EduPayAcademicSession.updateMany({ school, _id: { $ne: id }, isCurrent: true }, { $set: { isCurrent: false, updatedBy: actor } });
};
const setCurrentTerm = async (school, session, id, actor) => {
  await EduPayTerm.updateMany({ school, session, _id: { $ne: id }, isCurrent: true }, { $set: { isCurrent: false, updatedBy: actor } });
};
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
const manager = async (req, res) => {
  const membership = req.eduPaySchoolUser;
  const school = req.eduPaySchool;
  const role = String(membership?.role || "").toUpperCase();
  const validMembership = membership && school && req.user?._id && role &&
    ["OWNER", "ADMIN", "SCHOOL_ADMIN"].includes(role) &&
    await SchoolUser.exists({
      user: req.user._id,
      school: school._id,
      status: "ACTIVE",
      role,
    });
  const validContext = validMembership &&
    String(membership.user) === String(req.user._id) &&
    String(membership.school?._id || membership.school) === String(school._id) &&
    membership.status === "ACTIVE" &&
    ["APPROVED"].includes(String(school.status || "").toUpperCase()) &&
    school.active === true;
  if (!validContext) { res.status(403).json({ success: false, message: "School administrator access required." }); return false; }
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
  }).populate("classLevel", "status").lean();
  const activeClassIds = new Set((await EduPayClass.find({ school: schoolId(req), status: "ACTIVE" }).select("_id").lean()).map((row) => String(row._id)));
  const scopedAssignments = assignments.filter((row) => activeClassIds.has(String(row.classLevel?._id || row.classLevel))).map((row) => ({
    ...row,
    classLevel: row.classLevel?._id || row.classLevel,
  }));
  return { teacher, assignments: scopedAssignments };
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
    if (!(await manager(req, res))) return;
    const school = schoolId(req); const status = academicStatus(req.body.status);
    if (!String(req.body.name || "").trim()) throw inputError("Session name is required.");
    const dates = dateRange(req.body.startsAt, req.body.endsAt);
    const makeCurrent = currentRequested(req.body) || (status === "ACTIVE" && !(await EduPayAcademicSession.exists({ school, isCurrent: true })));
    if (makeCurrent && status !== "ACTIVE") throw inputError("Only an ACTIVE session can be current.");
    if (makeCurrent) await setCurrentSession(school, null, req.user._id);
    const row = await EduPayAcademicSession.create({ school, name: req.body.name, ...dates, status, isCurrent: makeCurrent, updatedBy: req.user._id });
    await audit({ actor: req.user._id, action: "EDUPAY_SESSION_CREATED", entityType: "EduPayAcademicSession", entityId: row._id, school, req });
    res.status(201).json({ success: true, session: row });
  } catch (e) { fail(res, e); }
};
exports.updateSession = async (req, res) => {
  try {
    if (!(await manager(req, res))) return; const row = await ensureOwned(EduPayAcademicSession, req.params.sessionId, schoolId(req), "Session");
    const status = req.body.status === undefined ? row.status : academicStatus(req.body.status, row.status);
    const dates = dateRange(req.body.startsAt === undefined ? row.startsAt : req.body.startsAt, req.body.endsAt === undefined ? row.endsAt : req.body.endsAt);
    const explicitCurrent = req.body.isCurrent !== undefined || req.body.current !== undefined || req.body.isDefault !== undefined;
    const makeCurrent = explicitCurrent ? currentRequested(req.body) : (row.isCurrent === true && status === "ACTIVE");
    if (explicitCurrent && makeCurrent && status !== "ACTIVE") throw inputError("Only an ACTIVE session can be current.");
    if (makeCurrent) await setCurrentSession(schoolId(req), row._id, req.user._id);
    if (req.body.name !== undefined) row.name = String(req.body.name).trim();
    row.startsAt = dates.startsAt; row.endsAt = dates.endsAt; row.status = status; row.isCurrent = makeCurrent; row.updatedBy = req.user._id; await row.save();
    res.json({ success: true, session: row });
  } catch (e) { fail(res, e); }
};
exports.createTerm = async (req, res) => {
  try {
    if (!(await manager(req, res))) return; const session = await ensureOwned(EduPayAcademicSession, req.body.session, schoolId(req), "Session");
    const status = academicStatus(req.body.status);
    const name = String(req.body.name || "").trim();
    if (!name) throw inputError("Term name is required.");
    const dates = dateRange(req.body.startsAt, req.body.endsAt);
    const makeCurrent = currentRequested(req.body) || (status === "ACTIVE" && !(await EduPayTerm.exists({ school: schoolId(req), session: session._id, isCurrent: true })));
    if (makeCurrent && status !== "ACTIVE") throw inputError("Only an ACTIVE term can be current.");
    if (makeCurrent) await setCurrentTerm(schoolId(req), session._id, null, req.user._id);
    const row = await EduPayTerm.create({ school: schoolId(req), session: session._id, name, ...dates, status, isCurrent: makeCurrent, updatedBy: req.user._id });
    res.status(201).json({ success: true, term: row });
  } catch (e) { fail(res, e); }
};
exports.updateTerm = async (req, res) => {
  try {
    if (!(await manager(req, res))) return;
    const school = schoolId(req);
    const row = await ensureOwned(EduPayTerm, req.params.termId, school, "Term");
    const status = req.body.status === undefined ? row.status : academicStatus(req.body.status, row.status);
    const dates = dateRange(req.body.startsAt === undefined ? row.startsAt : req.body.startsAt, req.body.endsAt === undefined ? row.endsAt : req.body.endsAt);
    const explicitCurrent = req.body.isCurrent !== undefined || req.body.current !== undefined || req.body.isDefault !== undefined;
    const makeCurrent = explicitCurrent ? currentRequested(req.body) : (row.isCurrent === true && status === "ACTIVE");
    if (explicitCurrent && makeCurrent && status !== "ACTIVE") throw inputError("Only an ACTIVE term can be current.");
    if (makeCurrent) await setCurrentTerm(school, row.session, row._id, req.user._id);
    if (req.body.name !== undefined) row.name = String(req.body.name).trim();
    row.startsAt = dates.startsAt; row.endsAt = dates.endsAt; row.status = status; row.isCurrent = makeCurrent; row.updatedBy = req.user._id; await row.save();
    res.json({ success: true, term: row });
  } catch (e) { fail(res, e); }
};
exports.listAcademic = async (req, res) => {
  try {
    const school = schoolId(req);
    let [sessions, terms, classes, subjects, classSubjects] = await Promise.all([
      EduPayAcademicSession.find({ school }).sort({ startsAt: -1 }).lean(), EduPayTerm.find({ school }).sort({ startsAt: 1 }).lean(),
      EduPayClass.find({ school }).sort({ name: 1 }).lean(), EduPaySubject.find({ school }).sort({ name: 1 }).lean(),
      EduPayClassSubject.find({ school }).populate("classLevel subject").lean(),
    ]);
    let assignments = [];
    if (!isManager(req)) {
      const scope = await teacherScope(req);
      if (!scope.teacher) return res.status(403).json({ success: false, message: "Active teacher profile required." });
      assignments = scope.assignments;
      const classIds = new Set(assignments.map((row) => String(row.classLevel)));
      const subjectIds = new Set(assignments.map((row) => String(row.subject)));
      classes = classes.filter((row) => row.status === "ACTIVE" && classIds.has(String(row._id)));
       subjects = subjects.filter((row) => subjectIds.has(String(row._id)));
       classSubjects = classSubjects.filter((row) => classIds.has(String(row.classLevel?._id || row.classLevel)) && subjectIds.has(String(row.subject?._id || row.subject)));
    }
    res.json({ success: true, sessions, terms, classes, subjects, classSubjects, assignments });
  } catch (e) { fail(res, e); }
};
exports.createClass = async (req, res) => {
  try {
    if (!(await manager(req, res))) return;
    const school = schoolId(req);
    const session = await ensureOwned(EduPayAcademicSession, req.body.session, school, "Session");
    if (req.body.classTeacher) await ensureOwned(EduPayTeacher, req.body.classTeacher, school, "Class teacher");
    const display = classDisplay(req.body.name, req.body.arm);
    if (!display.name) throw inputError("Class name is required.");
    if (await classDuplicate(school, display.name, display.arm)) throw inputError("A class with this name and arm already exists in this school.", 409);
    const row = await EduPayClass.create({ school, name: display.name, arm: display.arm, normalizedName: normalizeLabel(display.name), normalizedArm: normalizeLabel(display.arm) || null, educationLevel: educationLevel(req.body.educationLevel), session: session._id, classTeacher: req.body.classTeacher || null, status: req.body.status || "ACTIVE" });
    res.status(201).json({ success: true, classLevel: row });
  } catch (e) { fail(res, e); }
};
exports.createSubject = async (req, res) => {
  try {
    if (!(await manager(req, res))) return;
    const name = String(req.body.name || "").trim().replace(/\s+/g, " ");
    if (!name) throw inputError("Subject name is required.");
    if (await subjectDuplicate(schoolId(req), name)) throw inputError("A subject with this name already exists in this school.", 409);
    const row = await EduPaySubject.create({ school: schoolId(req), name, normalizedName: normalizeLabel(name), educationLevel: educationLevel(req.body.educationLevel), code: req.body.code, createdBy: req.user._id });
    res.status(201).json({ success: true, subject: row });
  } catch (e) { fail(res, e); }
};
const batchEntries = (body, key) => Array.isArray(body[key]) ? body[key] : [];
exports.createClassesBatch = async (req, res) => {
  try {
    if (!(await manager(req, res))) return;
    const school = schoolId(req), entries = batchEntries(req.body, "classes");
    if (!entries.length) throw inputError("Select at least one class.");
    const session = req.body.session ? await ensureOwned(EduPayAcademicSession, req.body.session, school, "Session") : null;
    const seen = new Set(), docs = [];
    for (const entry of entries) {
      const display = classDisplay(entry.name, entry.arm);
      if (!display.name) throw inputError("Every class must have a name.");
      const key = `${normalizeLabel(display.name)}|${normalizeLabel(display.arm)}`;
      if (seen.has(key) || await classDuplicate(school, display.name, display.arm)) throw inputError(`Class "${display.name}${display.arm ? ` ${display.arm}` : ""}" already exists or is duplicated.`, 409);
      seen.add(key);
      docs.push({ school, name: display.name, arm: display.arm, normalizedName: normalizeLabel(display.name), normalizedArm: normalizeLabel(display.arm) || null, educationLevel: educationLevel(entry.educationLevel || req.body.educationLevel), session: session?._id || null, status: entry.status || "ACTIVE", classTeacher: null, createdBy: req.user._id });
    }
    const classes = await EduPayClass.insertMany(docs, { ordered: true });
    res.status(201).json({ success: true, classes });
  } catch (e) { fail(res, e); }
};
exports.createSubjectsBatch = async (req, res) => {
  try {
    if (!(await manager(req, res))) return;
    const school = schoolId(req), entries = batchEntries(req.body, "subjects");
    if (!entries.length) throw inputError("Select at least one subject.");
    const seen = new Set(), docs = [];
    for (const entry of entries) {
      const name = String(entry.name || entry || "").trim().replace(/\s+/g, " ");
      if (!name) throw inputError("Every subject must have a name.");
      const key = normalizeLabel(name);
      if (seen.has(key) || await subjectDuplicate(school, name)) throw inputError(`Subject "${name}" already exists or is duplicated.`, 409);
      seen.add(key);
      docs.push({ school, name, normalizedName: key, educationLevel: educationLevel(entry.educationLevel || req.body.educationLevel), code: entry.code, createdBy: req.user._id });
    }
    const subjects = await EduPaySubject.insertMany(docs, { ordered: true });
    res.status(201).json({ success: true, subjects });
  } catch (e) { fail(res, e); }
};
exports.replaceClassSubjects = async (req, res) => {
  try {
    if (!(await manager(req, res))) return;
    const school = schoolId(req);
    const classLevel = await ensureOwned(EduPayClass, req.params.classId, school, "Class");
    const subjectIds = Array.isArray(req.body.subjectIds) ? req.body.subjectIds : (Array.isArray(req.body.subjects) ? req.body.subjects : []);
    const unique = [...new Set(subjectIds.map(String))];
    const subjects = [];
    for (const subjectId of unique) subjects.push(await ensureOwned(EduPaySubject, subjectId, school, "Subject"));
    await EduPayClassSubject.deleteMany({ school, classLevel: classLevel._id });
    const mappings = subjects.length ? await EduPayClassSubject.insertMany(subjects.map((subject) => ({ school, classLevel: classLevel._id, subject: subject._id, createdBy: req.user._id })), { ordered: true }) : [];
    res.json({ success: true, classSubject: mappings, classSubjects: mappings });
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
const authorizeStudentClass = async (req, value) => {
  if (!value) {
    if (!isManager(req)) throw inputError("Select one of your assigned classes.");
    return null;
  }
  const classLevel = await ensureOwned(EduPayClass, value, schoolId(req), "Class");
  if (!isManager(req) && classLevel.status !== "ACTIVE") {
    throw inputError("You can only manage students in active classes assigned to you.", 403);
  }
  if (!isManager(req) && !(await teacherFor(req, classLevel._id))) {
    throw inputError("You can only manage students in classes assigned to you.", 403);
  }
  return classLevel;
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
const maskedParent = (parent) => {
  if (!parent) return "Parent/Guardian not provided";
  const phone = String(parent.phone || "");
  const email = String(parent.email || "");
  return [
    parent.fullName || null,
    phone ? `${phone.slice(0, 4)}••••${phone.slice(-2)}` : null,
    email ? `${email.slice(0, 2)}••••${email.includes("@") ? email.slice(email.indexOf("@")) : ""}` : null,
  ].filter(Boolean).join(" · ") || "Parent/Guardian not provided";
};
const linkDto = (child, student) => ({
  childToken: studentLink.childToken(child, child.school),
  childName: child.fullName,
  className: child.className || null,
  parentDisplay: maskedParent(child.parent),
  linkStatus: "RESOLVED",
  academicStudent: { studentId: student.studentId, fullName: student.fullName, className: student.classLevel ? [student.classLevel.name, student.classLevel.arm].filter(Boolean).join(" ") : null },
  candidates: [],
});
exports.listStudentLinkCandidates = async (req, res) => {
  try {
    if (!(await manager(req, res))) return;
    const school = schoolId(req);
    const limit = 500;
    const children = await EduPayChild.find({ school, status: "ACTIVE" })
      .select("fullName firstName middleName lastName admissionNumber dateOfBirth className academicStudent academicStudentLinkStatus parent")
      .populate("parent", "fullName phone email")
      .populate("academicStudent", "studentId fullName classLevel status")
      .sort({ fullName: 1 }).limit(limit + 1).lean();
    const students = await EduPayStudent.find({ school, status: "ACTIVE" })
      .select("studentId fullName firstName middleName lastName dateOfBirth classLevel parent parentPhone")
      .populate("classLevel", "name arm").sort({ fullName: 1 }).limit(limit + 1).lean();
    const truncated = children.length > limit || students.length > limit;
    children.splice(limit); students.splice(limit);
    const candidates = students.map((student) => ({
      candidateToken: studentLink.candidateToken(student, school), studentId: student.studentId,
      fullName: student.fullName, className: student.classLevel ? [student.classLevel.name, student.classLevel.arm].filter(Boolean).join(" ") : null,
    }));
    const links = children.map((child) => ({
      childToken: studentLink.childToken(child, school), childName: child.fullName,
      className: child.className || null,
      parentDisplay: maskedParent(child.parent),
      linkStatus: child.academicStudentLinkStatus || "UNRESOLVED",
      academicStudent: child.academicStudent ? { studentId: child.academicStudent.studentId, fullName: child.academicStudent.fullName, className: child.academicStudent.classLevel ? [child.academicStudent.classLevel.name, child.academicStudent.classLevel.arm].filter(Boolean).join(" ") : null } : null,
      candidates: candidates.filter((row) => {
        const admission = studentLink.normalizeAdmission(child.admissionNumber);
        const childName = normalizeLabel(child.fullName);
        return (admission && studentLink.normalizeAdmission(row.studentId) === admission)
          || (childName && normalizeLabel(row.fullName) === childName);
      }).slice(0, 20),
    }));
    res.json({
      success: true, links, summary: { returned: links.length, candidates: candidates.length, truncated,
        message: truncated ? "Results were capped at 500 records. Refine the school data before resolving additional links." : null },
    });
  } catch (e) { fail(res, e); }
};
exports.resolveStudentLink = async (req, res) => {
  try {
    if (!(await manager(req, res))) return;
    const school = schoolId(req);
    const childPayload = req.body.childToken ? studentLink.verifyChildToken(req.body.childToken) : null;
    const candidatePayload = req.body.candidateToken ? studentLink.verifyCandidateToken(req.body.candidateToken) : null;
    if (!childPayload || !candidatePayload) return res.status(400).json({ success: false, message: "Signed child and candidate tokens are required." });
    const childId = childPayload.childId;
    const studentId = candidatePayload.studentId;
    if ((childPayload && String(childPayload.schoolId) !== String(school)) || (candidatePayload && String(candidatePayload.schoolId) !== String(school))) {
      return res.status(403).json({ success: false, message: "Student-link token does not belong to this school." });
    }
    const child = await EduPayChild.findOne({ _id: id(childId, "Child"), school, status: "ACTIVE" }).populate("parent", "fullName phone email");
    const student = await EduPayStudent.findOne({ _id: id(studentId, "Student"), school, status: "ACTIVE" }).populate("classLevel", "name arm");
    if (!child || !student) return res.status(404).json({ success: false, message: "Child or academic student not found." });
    if (child.academicStudent && String(child.academicStudent) !== String(student._id)) {
      return res.status(409).json({ success: false, message: "Child is already linked to another academic student." });
    }
    await studentLink.persistLink(child, student, "MANUAL", req.user._id, { strict: true });
    res.json({ success: true, link: linkDto(child, student) });
  } catch (e) { fail(res, e); }
};
exports.validateStudentImport = async (req, res) => {
  try {
    const result = validateRows(Array.isArray(req.body.rows) ? req.body.rows : []);
    const referenceValid = [];
    for (const row of result.validRows) {
      try {
        await authorizeStudentClass(req, row.data.classLevel || row.data.classId);
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
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    const result = validateRows(rows);
    if (result.invalidRows.length || result.duplicates.length) return res.status(422).json({ success: false, code: "IMPORT_VALIDATION_FAILED", ...result });
    for (const row of rows) await authorizeStudentClass(req, row.classLevel || row.classId);
    await validateStudentReferences(rows, schoolId(req));
    const ids = rows.map((row) => String(row.studentId || row.admissionNumber || "").trim().toUpperCase());
    const existing = await EduPayStudent.find({ school: schoolId(req), studentId: { $in: ids } }).select("studentId").lean();
    if (existing.length) return res.status(409).json({ success: false, message: "One or more admission numbers already exist in this school.", duplicates: existing.map((row) => ({ studentId: row.studentId, existing: true })) });
    const docs = rows.map((row) => studentPayload(row, schoolId(req), req.user._id));
    const created = await EduPayStudent.insertMany(docs, { ordered: true });
    for (const student of created) await studentLink.linkExactChildToStudent(student, req.user._id);
    await audit({ actor: req.user._id, action: "EDUPAY_STUDENTS_IMPORTED", entityType: "EduPayStudent", school: schoolId(req), metadata: { count: created.length }, req });
    res.status(201).json({ success: true, students: created, count: created.length });
  } catch (e) { fail(res, e); }
};
exports.createStudent = async (req, res) => { try { await authorizeStudentClass(req, req.body.classLevel || req.body.classId); await validateStudentReferences([req.body], schoolId(req)); const row = await EduPayStudent.create(studentPayload(req.body, schoolId(req), req.user._id)); await studentLink.linkExactChildToStudent(row, req.user._id); res.status(201).json({ success: true, student: row }); } catch (e) { fail(res, e); } };
exports.updateStudent = async (req, res) => {
  try {
    const student = await ensureOwned(EduPayStudent, req.params.studentId, schoolId(req), "Student");
    if (!isManager(req)) await authorizeStudentClass(req, student.classLevel);
    if (req.body.classLevel !== undefined || req.body.classId !== undefined) {
      await authorizeStudentClass(req, req.body.classLevel || req.body.classId);
    }
    await validateStudentReferences([req.body], schoolId(req));
    for (const key of ["fullName", "gender", "dateOfBirth", "parent", "parentName", "parentPhone", "parentEmail", "admissionDate", "status"]) {
      if (req.body[key] !== undefined) student[key] = req.body[key] || null;
    }
    if (req.body.classLevel !== undefined || req.body.classId !== undefined) student.classLevel = req.body.classLevel || req.body.classId || null;
    student.updatedBy = req.user._id;
    await student.save();
    await studentLink.linkExactChildToStudent(student, req.user._id);
    await audit({ actor: req.user._id, action: "EDUPAY_STUDENT_UPDATED", entityType: "EduPayStudent", entityId: student._id, school: schoolId(req), metadata: { status: student.status, classLevel: student.classLevel ? String(student.classLevel) : null }, req });
    res.json({ success: true, student });
  } catch (e) { fail(res, e); }
};

const assignmentInputs = (body) => {
  if (Array.isArray(body.assignments)) {
    return body.assignments.map((row) => {
      const assignment = { classLevel: row.classLevel || row.classId, subject: row.subject || row.subjectId };
      if (!assignment.classLevel || !assignment.subject) {
        throw inputError("Select both a class and subject for every assignment.");
      }
      return assignment;
    });
  }
  const hasClasses = body.classIds !== undefined;
  const hasSubjects = body.subjectIds !== undefined;
  if (!hasClasses && !hasSubjects) return [];
  const classes = Array.isArray(body.classIds) ? body.classIds : [];
  const subjects = Array.isArray(body.subjectIds) ? body.subjectIds : [];
  if (classes.length !== subjects.length || classes.some((value) => !value) || subjects.some((value) => !value)) {
    throw inputError("Select both a class and subject for every assignment.");
  }
  return classes.map((classLevel, index) => ({ classLevel, subject: subjects[index] }));
};
const validateAssignments = async (assignments, school, session = null) => {
  for (const assignment of assignments) {
    await ensureOwned(EduPayClass, assignment.classLevel, school, "Class", session);
    await ensureOwned(EduPaySubject, assignment.subject, school, "Subject", session);
    if (await classHasMappings(school, assignment.classLevel, session) &&
        !(await mappedPair(school, assignment.classLevel, assignment.subject, session))) {
      throw inputError("Map the selected subject to this class before assigning it to a teacher.");
    }
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
    if (!(await manager(req, res))) return;
    const school = schoolId(req);
    session = await mongoose.startSession();
    let result;
    await session.withTransaction(async () => {
    let user;
    let accountCreated = false;
    if (req.body.userId) {
      id(req.body.userId, "User");
      user = await User.findOne({ _id: req.body.userId, status: "ACTIVE" }).select("_id fullName email phone").session(session);
       if (!user) { const e = new Error("Active teacher user not found."); e.statusCode = 404; throw e; }
      const otherMembership = await SchoolUser.findOne({ user: user._id, school: { $ne: school }, status: { $in: ["ACTIVE", "INVITED"] } }).session(session);
       if (otherMembership) { const e = new Error("This user already belongs to another school."); e.statusCode = 409; throw e; }
    } else {
      const email = String(req.body.email || "").trim().toLowerCase();
      const phone = String(req.body.phone || "").trim();
      if (!String(req.body.fullName || "").trim()) throw inputError("Full name is required.");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw inputError("Enter a valid email address.");
      if (!/^\+?[0-9]{7,20}$/.test(phone)) throw inputError("Enter a valid phone number.");
      const matches = await User.find({ $or: [{ email }, { phone }] })
        .select("_id fullName email phone status mustChangePassword")
        .session(session);
      if (matches.length > 1) throw inputError("Email and phone belong to different ServicePay accounts.", 409);
      user = matches[0];
      if (user) {
        if (user.status !== "ACTIVE") throw inputError("The matching ServicePay account is not active.", 409);
        const otherMembership = await SchoolUser.findOne({ user: user._id, school: { $ne: school }, status: { $in: ["ACTIVE", "INVITED"] } }).session(session);
        if (otherMembership) throw inputError("This user already belongs to another school.", 409);
        const sameMembership = await SchoolUser.findOne({ user: user._id, school, status: { $in: ["ACTIVE", "INVITED"] } }).session(session);
        if (sameMembership && sameMembership.role !== "TEACHER") {
          throw inputError("This ServicePay account already has another role in this school.", 409);
        }
        if (await EduPayTeacher.exists({ school, user: user._id }).session(session)) {
          throw inputError("A teacher with this email or phone already exists.", 409);
        }
      } else {
        const password = temporaryPassword(req.body.temporaryPassword);
        [user] = await User.create([{ fullName: req.body.fullName, email, phone, password, role: "CUSTOMER", status: "ACTIVE", mustChangePassword: true }], { session });
        accountCreated = true;
      }
    }
    const staffId = String(req.body.staffId || "").trim();
    if (!staffId) throw inputError("Staff ID is required.");
    if (await EduPayTeacher.exists({ school, staffId }).session(session)) {
      throw inputError("Staff ID already exists in this school.", 409);
    }
    const [row] = await EduPayTeacher.create([{ school, user: user._id, staffId, fullName: req.body.fullName || user.fullName, email: req.body.email || user.email, phone: req.body.phone || user.phone, gender: req.body.gender, responsibility: req.body.responsibility, createdBy: req.user._id }], { session });
    await SchoolUser.updateOne({ school, user: user._id }, { $set: { role: "TEACHER", status: "ACTIVE" }, $setOnInsert: { school, user: user._id, invitedBy: req.user._id } }, { upsert: true, session });
    const assignments = await saveAssignments(row, assignmentInputs(req.body), req.user._id, { session });
    await audit({ actor: req.user._id, action: "EDUPAY_TEACHER_CREATED", entityType: "EduPayTeacher", entityId: row._id, school, metadata: { accountCreated, assignmentCount: assignments.length }, req, session });
    result = { teacher: row, assignments, account: { userId: user._id, email: user.email, mustChangePassword: user.mustChangePassword === true } };
    });
    res.status(201).json({ success: true, ...result });
  } catch (e) { fail(res, e); }
  finally { if (session) await session.endSession(); }
};
exports.updateTeacher = async (req, res) => {
  let session;
  try {
    if (!(await manager(req, res))) return;
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
    if (!(await manager(req, res))) return;
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
    if (!(await manager(req, res))) return;
    const password = temporaryPassword(req.body.temporaryPassword);
    const teacher = await ensureOwned(EduPayTeacher, req.params.teacherId, schoolId(req), "Teacher");
    const user = await User.findById(teacher.user).select("+password +authTokenVersion");
    if (!user) return res.status(404).json({ success: false, message: "Teacher account not found." });
    user.password = password; user.passwordResetToken = undefined; user.passwordResetExpires = undefined; user.mustChangePassword = true; user.passwordChangedAt = new Date(); user.authTokenVersion = Number(user.authTokenVersion || 0) + 1; await user.save();
    await audit({ actor: req.user._id, action: "EDUPAY_TEACHER_PASSWORD_RESET", entityType: "User", entityId: user._id, school: schoolId(req), req });
    res.json({ success: true, message: "Temporary teacher password set.", teacher: { id: teacher._id, userId: user._id, mustChangePassword: true } });
  } catch (e) { fail(res, e); }
};
exports.assignTeacher = async (req, res) => { try { if (!(await manager(req, res))) return; const teacher = await ensureOwned(EduPayTeacher, req.body.teacher, schoolId(req), "Teacher"); const assignments = await saveAssignments(teacher, [{ classLevel: req.body.classLevel, subject: req.body.subject }], req.user._id); res.status(201).json({ success: true, assignment: assignments[0] }); } catch (e) { fail(res, e); } };
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
    if (String(term.session) !== String(session._id)) return res.status(400).json({ success: false, message: "Term does not belong to the selected academic session." });
    if (session.status !== "ACTIVE" || term.status !== "ACTIVE") return res.status(400).json({ success: false, message: "Attendance requires the active academic session and term." });
    const teacher = isManager(req) ? null : await teacherFor(req, classLevel._id);
    if (!isManager(req) && !teacher) return res.status(403).json({ success: false, message: "Teacher is not assigned to this class." });
    let rows = Array.isArray(req.body.records) ? req.body.records : [];
    const allStatus = String(req.body.markAllStatus || "").toUpperCase();
    const rosterQuery = { school, classLevel: classLevel._id, status: "ACTIVE" };
    if (allStatus && ["PRESENT", "ABSENT", "LATE", "EXCUSED"].includes(allStatus)) rows = (await EduPayStudent.find(rosterQuery).select("_id").lean()).map((student) => ({ student: student._id, status: allStatus }));
    rows = rows.map((row) => ({ ...row, status: String(row.status || "").toUpperCase() }));
    const submittedStudents = rows.map((row) => String(row.student));
    if (new Set(submittedStudents).size !== submittedStudents.length) return res.status(400).json({ success: false, message: "Attendance contains duplicate students." });
    const students = await EduPayStudent.find({ ...rosterQuery, _id: { $in: rows.map((r) => r.student) } }).select("_id parent fullName studentId").lean(); const allowed = new Set(students.map((r) => String(r._id))); if (rows.some((r) => !allowed.has(String(r.student)) || !["PRESENT", "ABSENT", "LATE", "EXCUSED"].includes(r.status))) return res.status(400).json({ success: false, message: "Attendance contains an invalid student or status." });
    const date = String(req.body.date || "").slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ success: false, message: "Attendance date must be YYYY-MM-DD." });
    const dailyScope = { school, classLevel: classLevel._id, student: { $in: submittedStudents }, date };
    const priorRows = await EduPayAttendance.find(dailyScope).select("_id student status").lean();
    const priorByStudent = new Map();
    for (const prior of priorRows) {
      const studentKey = String(prior.student);
      if (priorByStudent.has(studentKey)) return res.status(409).json({ success: false, message: "Duplicate attendance records require school administrator review." });
      priorByStudent.set(studentKey, prior);
    }
    const output = []; const corrections = [];
    for (const row of rows) {
      const dailyKey = { school, classLevel: classLevel._id, student: row.student, date };
      const existing = priorByStudent.get(String(row.student)) || null;
      const writeKey = existing ? { _id: existing._id, school } : dailyKey;
      const update = { $set: { session: session._id, term: term._id, status: row.status, teacher: teacher?._id || null, updatedBy: req.user._id }, $setOnInsert: { ...dailyKey, createdBy: req.user._id } };
      if (existing) {
        update.$set.correctedAt = new Date();
        update.$set.correctedBy = req.user._id;
        if (existing.status !== row.status) corrections.push({ student: String(row.student), from: existing.status, to: row.status });
      }
      try {
        output.push(await EduPayAttendance.findOneAndUpdate(writeKey, update, { upsert: true, new: true, runValidators: true }));
      } catch (writeError) {
        if (writeError?.code !== 11000 || existing) throw writeError;
        const concurrent = await EduPayAttendance.findOne({ ...dailyKey, session: session._id, term: term._id }).select("_id").lean();
        if (!concurrent) throw writeError;
        output.push(await EduPayAttendance.findOneAndUpdate({ _id: concurrent._id, school }, { $set: update.$set }, { new: true, runValidators: true }));
      }
    }
    await audit({ actor: req.user._id, action: "EDUPAY_ATTENDANCE_SUBMITTED", entityType: "EduPayAttendance", school, metadata: { date, class: String(classLevel._id), count: output.length, corrections }, req });
    for (const row of output) {
      const student = students.find((candidate) => String(candidate._id) === String(row.student));
      if (row.status === "ABSENT" || row.status === "LATE") {
        const recipients = new Set(student?.parent ? [String(student.parent)] : []);
        // Guardian notifications are deliberately best-effort and outside the write path.
        try {
          const child = await linkedChildForStudent(student);
          if (child) {
            recipients.add(String(child.parent));
            (await GuardianLink.find({ school, child: child._id, status: "VERIFIED" }).select("parent").lean()).forEach((link) => recipients.add(String(link.parent)));
          }
        } catch (_) { /* notification lookup must never reject attendance */ }
        for (const recipient of recipients) Promise.resolve(notify(recipient, `Attendance ${row.status}`, `${student?.fullName || "Your child"} was marked ${row.status}.`)).catch(() => {});
      }
    }
    res.json({ success: true, records: output });
  } catch (e) { fail(res, e); }
};

exports.createAssessment = async (req, res) => { try { if (!(await manager(req, res))) return; const school = schoolId(req); await ensureOwned(EduPayAcademicSession, req.body.session, school, "Session"); await ensureOwned(EduPayTerm, req.body.term, school, "Term"); await ensureOwned(EduPayClass, req.body.classLevel, school, "Class"); await ensureOwned(EduPaySubject, req.body.subject, school, "Subject"); if (await classHasMappings(school, req.body.classLevel) && !(await mappedPair(school, req.body.classLevel, req.body.subject))) throw inputError("Map the selected subject to this class before creating an assessment."); const row = await EduPayAssessment.create({ ...req.body, school, components: req.body.components || [{ name: "Total", max: 100 }], grading: ranges(req.body.grading), createdBy: req.user._id }); res.status(201).json({ success: true, assessment: row }); } catch (e) { fail(res, e); } };
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
exports.reviewAssessment = async (req, res) => { try { if (!(await manager(req, res))) return; const row = await EduPayAssessment.findOne({ _id: req.params.assessmentId, school: schoolId(req) }); if (!row) return res.status(404).json({ success: false, message: "Assessment not found." }); const action = String(req.body.action || "").toUpperCase(); const transitions = { SUBMITTED: { RETURN: "RETURNED", APPROVE: "APPROVED" }, APPROVED: { PUBLISH: "PUBLISHED" } }; const next = transitions[row.status]?.[action]; if (!next) return res.status(409).json({ success: false, message: "Invalid assessment review transition." }); row.status = next; row.reviewedBy = req.user._id; row.reviewedAt = new Date(); row.reviewNote = req.body.note; await row.save(); await audit({ actor: req.user._id, action: `EDUPAY_RESULT_${next}`, entityType: "EduPayAssessment", entityId: row._id, school: schoolId(req), req }); res.json({ success: true, assessment: row }); } catch (e) { fail(res, e); } };

exports.createTimetable = async (req, res) => { try { if (!(await manager(req, res))) return; const school = schoolId(req); await ensureOwned(EduPayAcademicSession, req.body.session, school, "Session"); await ensureOwned(EduPayTerm, req.body.term, school, "Term"); await ensureOwned(EduPayClass, req.body.classLevel, school, "Class"); await ensureOwned(EduPaySubject, req.body.subject, school, "Subject"); await ensureOwned(EduPayTeacher, req.body.teacher, school, "Teacher"); const row = await EduPayTimetable.create({ ...req.body, school, createdBy: req.user._id }); res.status(201).json({ success: true, timetable: row }); } catch (e) { fail(res, e); } };
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
  const requested = req.params.childId;
  let student = await EduPayStudent.findOne({ _id: requested, status: "ACTIVE" }).populate("school classLevel").lean().catch(() => null);
  if (student && String(student.parent || "") === String(req.user._id)) return { ...student, academicStudent: student };
  if (student) {
    const linkedChild = await linkedChildForStudent(student);
    if (linkedChild) {
      const directAccess = String(linkedChild.parent) === String(req.user._id);
      const guardianAccess = directAccess ? false : await GuardianLink.exists({
        school: linkedChild.school,
        child: linkedChild._id,
        parent: req.user._id,
        status: "VERIFIED",
      });
      if (directAccess || guardianAccess) return { ...student, academicStudent: student };
    }
  }
  if (!EduPayChild) { const e = new Error("Child not found."); e.statusCode = 404; throw e; }
  const direct = await EduPayChild.findOne({ _id: requested, parent: req.user._id, status: "ACTIVE" }).populate("school").lean().catch(() => null);
  const linked = direct ? null : await GuardianLink.findOne({ child: requested, parent: req.user._id, status: "VERIFIED" }).lean().catch(() => null);
  const legacy = direct || (linked ? await EduPayChild.findOne({ _id: requested, school: linked.school, status: "ACTIVE" }).populate("school").lean() : null);
  if (!legacy) { const e = new Error("Child not found."); e.statusCode = 404; throw e; }
  student = await academicStudentForChild(legacy, "school classLevel");
  if (!student) { const e = new Error("Academic student mapping is unavailable."); e.statusCode = 404; throw e; }
  return { ...legacy, classLevel: student.classLevel, academicStudent: student, school: student.school || school };
};
exports.parentAcademicChildren = async (req, res) => {
  try {
    const children = await EduPayStudent.find({
      parent: req.user._id,
      status: { $in: ["ACTIVE", "GRADUATED", "TRANSFERRED"] },
    }).populate("school", "name location").populate("classLevel", "name arm").sort({ fullName: 1 }).lean();
    const direct = await EduPayChild.find({ parent: req.user._id, status: "ACTIVE" }).lean();
    const links = await GuardianLink.find({ parent: req.user._id, status: "VERIFIED" }).select("child school").lean();
    const legacyIds = [...new Set([
      ...direct.map((row) => String(row._id)),
      ...links.map((row) => String(row.child)),
    ])];
    if (legacyIds.length) {
      const legacy = await EduPayChild.find({ _id: { $in: legacyIds }, status: "ACTIVE" }).lean();
      const mapped = await Promise.all(legacy.map((row) =>
        academicStudentForChild(row, [
          { path: "school", select: "name location" },
          { path: "classLevel", select: "name arm" },
        ])
      ));
      const seen = new Set(children.map((row) => String(row._id)));
      mapped.filter(Boolean).forEach((row) => { if (!seen.has(String(row._id))) { seen.add(String(row._id)); children.push(row); } });
    }
    children.sort((a, b) => String(a.fullName || "").localeCompare(String(b.fullName || "")));
    res.json({ success: true, children });
  } catch (e) { fail(res, e); }
};
exports.parentAttendance = async (req, res) => {
  try {
    const child = await parentChild(req); const student = child.academicStudent || child;
    const query = { school: student.school?._id || student.school, student: student._id };
    const range = String(req.query.range || "").toLowerCase(); const now = new Date(); let from = null;
    if (range === "today") from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    else if (range === "week") from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
    else if (range === "month") from = new Date(now.getFullYear(), now.getMonth(), 1);
    if (from) query.date = { $gte: from.toISOString().slice(0, 10) };
    if (range === "current-term" || range === "current_term") {
      const currentTerm = await EduPayTerm.findOne({ school: query.school, status: "ACTIVE" }).sort({ startDate: -1, createdAt: -1 }).select("_id").lean();
      if (currentTerm) query.term = currentTerm._id;
    }
    const attendance = await EduPayAttendance.find(query)
      .populate("classLevel", "name arm")
      .populate("session", "name")
      .populate("term", "name")
      .sort({ date: -1, updatedAt: -1 }).limit(365).lean();
    res.json({ success: true, child: student, attendance });
  } catch (e) { fail(res, e); }
};
exports.parentResults = async (req, res) => { try { const child = await parentChild(req); const student = child.academicStudent || child; const school = student.school?._id || student.school; const assessments = await EduPayAssessment.find({ school, classLevel: student.classLevel, status: "PUBLISHED" }).select("_id title session term subject grading").lean(); res.json({ success: true, child: student, results: await EduPayScore.find({ school, student: student._id, assessment: { $in: assessments.map((a) => a._id) }, status: "SUBMITTED" }).populate("assessment").sort({ createdAt: -1 }).lean() }); } catch (e) { fail(res, e); } };
exports.parentActivities = async (req, res) => { try { const child = await parentChild(req); const student = child.academicStudent || child; const school = student.school?._id || student.school; res.json({ success: true, child: student, activities: await EduPayAcademicActivity.find({ school, status: "PUBLISHED", $or: [{ audience: "SCHOOL" }, { audience: "CLASS", classLevel: student.classLevel }, { audience: "STUDENT", student: student._id }] }).sort({ eventDate: -1 }).lean() }); } catch (e) { fail(res, e); } };
exports.parentTimetable = async (req, res) => { try { const child = await parentChild(req); const student = child.academicStudent || child; const school = student.school?._id || student.school; res.json({ success: true, child: student, timetable: await EduPayTimetable.find({ school, classLevel: student.classLevel }).populate("subject teacher").sort({ day: 1, startsAt: 1 }).lean() }); } catch (e) { fail(res, e); } };

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