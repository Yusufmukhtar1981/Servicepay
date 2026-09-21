const jwt = require("jsonwebtoken");
const Child = require("../models/edupayChild.model");
const { EduPayStudent } = require("../models/edupayAcademicManagement.model");

const normalizeAdmission = (value) => String(value || "").trim().replace(/\s+/g, "").toUpperCase();
const admissionPattern = (value) => {
  const normalized = normalizeAdmission(value);
  if (!normalized) return null;
  const escaped = [...normalized].map((char) => char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^\\s*${escaped.join("\\s*")}\\s*$`, "i");
};
const secret = () => {
  if (!process.env.JWT_SECRET) throw Object.assign(new Error("JWT_SECRET is required for EduPay student-link tokens."), { statusCode: 500 });
  return process.env.JWT_SECRET;
};
const linkToken = (type, payload, expiresIn = "15m") => jwt.sign({ ...payload, typ: type }, secret(), { expiresIn });
const verifyToken = (token, type) => {
  try {
    const payload = jwt.verify(String(token || ""), secret());
    if (payload.typ !== type || !payload.schoolId) throw new Error("Invalid token.");
    return payload;
  } catch (_) {
    throw Object.assign(new Error("Student-link token is invalid or expired."), { statusCode: 400 });
  }
};
const childToken = (child, school) => linkToken("EDUPAY_CHILD_LINK", { childId: String(child._id), schoolId: String(school) });
const candidateToken = (student, school) => linkToken("EDUPAY_STUDENT_CANDIDATE", { studentId: String(student._id), schoolId: String(school) });

async function persistLink(child, student, source = "ADMISSION", actor = null, { strict = false } = {}) {
  const update = {
    $set: {
      academicStudent: student._id,
      academicStudentLinkStatus: "RESOLVED",
      academicStudentLinkSource: source,
      academicStudentLinkedAt: new Date(),
      academicStudentLinkedBy: actor || null,
    },
  };
  try {
    const result = await Child.updateOne({
      _id: child._id,
      school: student.school,
      $or: [{ academicStudent: null }, { academicStudent: student._id }],
    }, update);
    if (strict && result.matchedCount !== 1) {
      const error = new Error("Child link conflicts with an existing academic student mapping.");
      error.statusCode = 409;
      throw error;
    }
    if (strict && result.modifiedCount !== 1) {
      const error = new Error("Academic student mapping could not be persisted.");
      error.statusCode = 409;
      throw error;
    }
  } catch (error) {
    if (strict) throw error;
    /* Legacy read-through links remain best effort. */
  }
}

async function uniqueStudentForChild(child, populate = "") {
  const school = child?.school?._id || child?.school;
  if (!school) return null;
  if (child.academicStudent) {
    let refQuery = EduPayStudent.findOne({ _id: child.academicStudent, school, status: "ACTIVE" });
    if (populate) refQuery = refQuery.populate(populate);
    const referenced = await refQuery.lean();
    // A persisted but stale/mismatched ref must fail closed; do not fall
    // through to a weaker legacy identity.
    return referenced || null;
  }
  const pattern = admissionPattern(child.admissionNumber);
  if (!pattern) return null;
  let query = EduPayStudent.find({ school, studentId: pattern, status: "ACTIVE" }).limit(2);
  if (populate) query = query.populate(populate);
  const matches = await query.lean();
  if (matches.length !== 1) return null;
  await persistLink(child, matches[0], "ADMISSION");
  return matches[0];
}

async function linkedChildForStudent(student) {
  const school = student?.school?._id || student?.school;
  if (!school || !student?._id) return null;
  const linked = await Child.find({ school, academicStudent: student._id, status: "ACTIVE" }).limit(2).lean();
  if (linked.length === 1) return linked[0];
  if (linked.length > 1) return null;
  const pattern = admissionPattern(student.studentId);
  if (!pattern) return null;
  const matches = await Child.find({ school, admissionNumber: pattern, status: "ACTIVE" }).limit(2).lean();
  if (matches.length !== 1) return null;
  await persistLink(matches[0], student, "ADMISSION");
  return matches[0];
}

async function linkExactChildToStudent(student, actor = null) {
  const school = student?.school?._id || student?.school;
  const pattern = admissionPattern(student?.studentId);
  if (!school || !pattern) return { status: "MISSING" };
  const matches = await Child.find({ school, admissionNumber: pattern, status: "ACTIVE" }).limit(2).lean();
  if (!matches.length) return { status: "MISSING" };
  if (matches.length > 1) return { status: "AMBIGUOUS" };
  if (matches[0].academicStudent && String(matches[0].academicStudent) !== String(student._id)) return { status: "CONFLICT" };
  await persistLink(matches[0], student, "ADMISSION", actor, { strict: true });
  return { status: "LINKED", child: matches[0] };
}

module.exports = {
  normalizeAdmission,
  admissionPattern,
  academicStudentForChild: uniqueStudentForChild,
  linkedChildForStudent,
  linkExactChildToStudent,
  persistLink,
  childToken,
  candidateToken,
  verifyChildToken: (token) => verifyToken(token, "EDUPAY_CHILD_LINK"),
  verifyCandidateToken: (token) => verifyToken(token, "EDUPAY_STUDENT_CANDIDATE"),
};