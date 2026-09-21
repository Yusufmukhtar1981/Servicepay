const mongoose = require("mongoose");
const crypto = require("crypto");
const Record = require("../models/edupayActivityCenter.model");
const Child = require("../models/edupayChild.model");
const Link = require("../models/edupayGuardianLink.model");
const Notification = require("../models/notification.model");
const AttendanceBatch = require("../models/edupayAttendanceBatch.model");
const GuardianInvite = require("../models/edupayGuardianInvite.model");
const { EduPayStudent, EduPayAttendance } = require("../models/edupayAcademicManagement.model");
const { EduPayTerm } = require("../models/edupayAcademic.model");

const TYPES = new Set(["ATTENDANCE", "RESULT", "ASSIGNMENT", "ACTIVITY", "CONDUCT", "ANNOUNCEMENT"]);
const id = (value) => mongoose.isValidObjectId(value);
const fail = (message, statusCode = 400) => { const e = new Error(message); e.statusCode = statusCode; return e; };
const stable = (value) => Array.isArray(value) ? value.map(stable) : (value && typeof value === "object" ? Object.keys(value).sort().reduce((out, key) => { out[key] = stable(value[key]); return out; }, {}) : value);
const payloadHash = (value) => crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
const normalizeAdmission = (value) => String(value || "").trim().replace(/\s+/g, "").toUpperCase();
const admissionPattern = (value) => {
  const normalized = normalizeAdmission(value);
  if (!normalized) return null;
  const escaped = [...normalized].map((char) => char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^\\s*${escaped.join("\\s*")}\\s*$`, "i");
};

async function academicStudentForChild(child) {
  const school = child?.school?._id || child?.school;
  const pattern = admissionPattern(child?.admissionNumber);
  if (!school || !pattern) return null;
  const matches = await EduPayStudent.find({ school, studentId: pattern, status: "ACTIVE" })
    .populate("classLevel").limit(2).lean();
  return matches.length === 1 ? matches[0] : null;
}

async function childForParent(userId, childId, schoolId) {
  if (!id(childId)) throw fail("Student is invalid.");
  const scope = { _id: childId, parent: userId, status: "ACTIVE" };
  if (schoolId) scope.school = schoolId;
  const direct = await Child.findOne(scope).lean();
  if (direct) return direct;
  const linkScope = { child: childId, parent: userId, status: "VERIFIED" };
  if (schoolId) linkScope.school = schoolId;
  const linked = await Link.findOne(linkScope).lean();
  if (!linked) throw fail("Verified parent access to this student is required.", 403);
  const childScope = { _id: childId, school: linked.school, status: "ACTIVE" };
  return Child.findOne(childScope).lean();
}

function schoolId(req) { return req.eduPaySchool?._id; }
function requireType(type) { const value = String(type || "").toUpperCase(); if (!TYPES.has(value)) throw fail("Unsupported activity type."); return value; }
function schoolWrite(req) {
  if (!["OWNER", "ADMIN", "STAFF"].includes(String(req.eduPaySchoolUser?.role || "").toUpperCase())) throw fail("School activity write permission required.", 403);
}
function safePayload(type, body) {
  const payload = { ...body };
  delete payload.school; delete payload.schoolId; delete payload.child; delete payload.childId; delete payload.createdBy; delete payload.updatedBy;
  if (type === "ATTENDANCE") {
    payload.status = String(payload.status || "PRESENT").toUpperCase();
    if (!["PRESENT", "ABSENT", "LATE", "EXCUSED"].includes(payload.status)) throw fail("Invalid attendance status.");
  }
  if (type === "RESULT") {
    payload.subject = String(payload.subject || "").trim();
    if (!payload.subject) throw fail("Result subject is required.");
  }
  return payload;
}
async function notifyParents(record, child, label) {
  const parents = new Set([String(child.parent)]);
  const links = await Link.find({ child: child._id, school: record.school, status: "VERIFIED" }).select("parent").lean();
  links.forEach((row) => parents.add(String(row.parent)));
  await Promise.all([...parents].map(async (parent) => {
    const dedupeKey = `edupay:${record._id}:${parent}:${record.status}`;
    try {
      await Notification.findOneAndUpdate(
        { edupayDedupeKey: dedupeKey },
        { $setOnInsert: { userId: parent, title: "EduPay update", message: `A new ${label} has been posted for your child.`, type: "GENERAL", category: "OTHER", referenceId: record._id, referenceType: "EDUPAY_ACTIVITY", edupayDedupeKey: dedupeKey } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    } catch (e) {
      if (e?.code !== 11000) throw e;
      await Notification.findOne({ edupayDedupeKey: dedupeKey }).lean();
    }
  }));
}

async function create(req, type, body, publish = true, session = null, meta = {}) {
  schoolWrite(req);
  const school = schoolId(req);
  const childId = body.childId || body.child;
  let child = null;
  if (childId) {
    if (!id(childId)) throw fail("Student is invalid.");
    const childQuery = Child.findOne({ _id: childId, school, status: "ACTIVE" });
    if (session) childQuery.session(session);
    child = await childQuery;
    if (!child) throw fail("Student does not belong to this school.", 403);
  }
  const recordType = requireType(type);
  const role = String(req.eduPaySchoolUser?.role || "").toUpperCase();
  if (recordType === "CONDUCT" && !["OWNER", "ADMIN"].includes(role)) throw fail("Conduct management requires OWNER or ADMIN permission.", 403);
  const status = recordType === "RESULT" ? "DRAFT" : (publish ? "PUBLISHED" : "DRAFT");
  const parentVisible = recordType === "CONDUCT" ? body.parentVisible === true && status === "PUBLISHED" : (body.parentVisible === true || status === "PUBLISHED");
  const idempotencyKey = body.idempotencyKey ? String(body.idempotencyKey) : null;
  const existingQuery = idempotencyKey ? Record.findOne({ school, recordType, idempotencyKey }) : null;
  if (existingQuery) {
    if (session) existingQuery.session(session);
    const existing = await existingQuery;
    if (existing) return existing;
  }
  const createData = {
    recordType, school, child: child?._id || null, classLevel: body.classLevel || null,
    audience: String(body.audience || (child ? "STUDENT" : "SCHOOL")).toUpperCase(),
    session: body.session || null, term: body.term || null, eventDate: body.eventDate || body.date || new Date(), idempotencyKey,
    status, parentVisible, payload: safePayload(recordType, body), createdBy: req.user._id,
    updatedBy: req.user._id, publishedBy: status === "PUBLISHED" ? req.user._id : null,
    publishedAt: status === "PUBLISHED" ? new Date() : null, batch: meta.batch || null,
    audit: [{ actor: req.user._id, action: status === "PUBLISHED" ? "CREATED_PUBLISHED" : "CREATED_DRAFT", metadata: { recordType } }],
  };
  const record = session ? (await Record.create([createData], { session }))[0] : await Record.create(createData);
  if (!session && record.status === "PUBLISHED" && record.parentVisible && child) await notifyParents(record, child, recordType.toLowerCase());
  return record;
}

async function update(req, recordId, body) {
  schoolWrite(req);
  const record = await Record.findOne({ _id: recordId, school: schoolId(req) });
  if (!record) throw fail("Activity record not found.", 404);
  if (record.status === "PUBLISHED" && record.recordType === "RESULT") throw fail("Published results require a correction record.", 409);
  if (!["OWNER", "ADMIN"].includes(String(req.eduPaySchoolUser?.role || "").toUpperCase()) && !["ATTENDANCE", "ASSIGNMENT", "ACTIVITY", "ANNOUNCEMENT"].includes(record.recordType)) throw fail("This role cannot update this activity type.", 403);
  if (body.childId || body.child || body.school || body.schoolId || body.recordType || body.type) throw fail("Tenant, type and student ownership are immutable.", 400);
  Object.assign(record, { payload: { ...record.payload, ...safePayload(record.recordType, body) }, updatedBy: req.user._id });
  if (body.parentVisible !== undefined) record.parentVisible = body.parentVisible === true;
  record.audit.push({ actor: req.user._id, action: "UPDATED", metadata: { fields: Object.keys(body) } });
  await record.save();
  return record;
}

async function publish(req, recordId) {
  schoolWrite(req);
  const record = await Record.findOne({ _id: recordId, school: schoolId(req) });
  if (!record) throw fail("Activity record not found.", 404);
  if (record.recordType === "RESULT" && !["OWNER", "ADMIN"].includes(String(req.eduPaySchoolUser?.role || "").toUpperCase())) throw fail("Result publication permission required.", 403);
  record.status = "PUBLISHED"; record.parentVisible = record.recordType === "CONDUCT" ? record.parentVisible === true : true;
  record.publishedBy = req.user._id; record.publishedAt = new Date(); record.updatedBy = req.user._id;
  record.audit.push({ actor: req.user._id, action: "PUBLISHED" });
  await record.save();
  if (record.parentVisible && record.child) { const child = await Child.findById(record.child).lean(); if (child) await notifyParents(record, child, record.recordType.toLowerCase()); }
  return record;
}

async function listForSchool(req, type) {
  const query = { school: schoolId(req) };
  if (type) query.recordType = requireType(type);
  if (req.query.childId && id(req.query.childId)) query.child = req.query.childId;
  if (req.query.status) query.status = String(req.query.status).toUpperCase();
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
  const rows = await Record.find(query).populate("child classLevel").sort({ eventDate: -1, createdAt: -1 }).limit(limit).lean();
  return rows;
}

async function listForParent(req, childId, type) {
  const child = await childForParent(req.user._id, childId, req.query.schoolId);
  const recordType = type ? requireType(type) : null;
  const query = { school: child.school, status: "PUBLISHED", parentVisible: true, child: child._id };
  if (recordType) query.recordType = recordType;
  if (!recordType || ["ANNOUNCEMENT", "ACTIVITY"].includes(recordType)) {
    delete query.child;
    query.$or = [{ child: child._id }, { recordType: "ANNOUNCEMENT", audience: "SCHOOL" }, { recordType: "ACTIVITY", audience: "SCHOOL" }];
    if (child.className) query.$or.push({ recordType: "ANNOUNCEMENT", audience: "CLASS", "payload.className": child.className }, { recordType: "ACTIVITY", audience: "CLASS", "payload.className": child.className });
    if (recordType) query.$or = query.$or.filter((part) => part.recordType === recordType || part.child);
  }
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
  const skip = Math.max(0, Number(req.query.page || 1) - 1) * limit;
  const academicStudent = await academicStudentForChild(child);
  const mergesAcademicAttendance = academicStudent && (!recordType || recordType === "ATTENDANCE");
  if (mergesAcademicAttendance && !recordType) query.recordType = { $ne: "ATTENDANCE" };
  const activitySkip = mergesAcademicAttendance && !recordType ? 0 : skip;
  const activityLimit = mergesAcademicAttendance && !recordType ? skip + limit : limit;
  let [rows, total] = await Promise.all([
    Record.find(query).sort({ eventDate: -1, createdAt: -1 }).skip(activitySkip).limit(activityLimit).lean(),
    Record.countDocuments(query),
  ]);
  if (mergesAcademicAttendance) {
    const academicQuery = { school: academicStudent.school, student: academicStudent._id };
    const range = String(req.query.range || "").toLowerCase();
    if (range === "today" || range === "week" || range === "month") {
      const now = new Date();
      const fromDate = range === "today"
        ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
        : range === "week"
          ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)
          : new Date(now.getFullYear(), now.getMonth(), 1);
      const from = fromDate.toISOString().slice(0, 10);
      academicQuery.date = { $gte: from };
    }
    if (range === "current-term" || range === "current_term") {
      const currentTerm = await EduPayTerm.findOne({ school: academicQuery.school, status: "ACTIVE" }).sort({ startDate: -1, createdAt: -1 }).select("_id").lean();
      if (currentTerm) academicQuery.term = currentTerm._id;
    }
    const academic = await EduPayAttendance.find(academicQuery)
      .populate("classLevel", "name arm")
      .populate("session", "name")
      .populate("term", "name")
      .sort({ date: -1, updatedAt: -1 }).limit(365).lean();
    const mapped = academic.map((row) => ({
      _id: row._id, recordType: "ATTENDANCE", eventDate: new Date(`${row.date}T00:00:00.000Z`),
      status: "PUBLISHED", audience: "STUDENT", createdAt: row.createdAt, updatedAt: row.updatedAt,
      academic: true,
      payload: { status: row.status, date: row.date, eventDate: row.date, class: row.classLevel, session: row.session, term: row.term },
    }));
    // Academic attendance is authoritative: remove Activity Center attendance rows
    // whenever a safe mapping exists, including corrections.
    rows = rows.filter((row) => row.recordType !== "ATTENDANCE");
    if (recordType === "ATTENDANCE") {
      rows = mapped.slice(skip, skip + limit);
      total = mapped.length;
    }
    else rows = [...rows, ...mapped];
    rows.sort((a, b) => new Date(b.eventDate || b.createdAt) - new Date(a.eventDate || a.createdAt));
    if (recordType !== "ATTENDANCE") {
      rows = rows.slice(skip, skip + limit);
      total += mapped.length;
    }
  }
  return { child, records: rows, page: Math.floor(skip / limit) + 1, limit, total };
}

async function summary(req, childId) {
  const summaryReq = { ...req, query: { ...(req.query || {}), limit: 365 } };
  const { child, records } = await listForParent(summaryReq, childId);
  const attendance = records.filter((r) => r.recordType === "ATTENDANCE");
  const counts = attendance.reduce((out, row) => { const s = row.payload?.status || "PRESENT"; out[s] = (out[s] || 0) + 1; return out; }, {});
  return { child, attendanceToday: attendance.find((row) => new Date(row.eventDate).toDateString() === new Date().toDateString()) || null, attendance: counts, latestResult: records.find((r) => r.recordType === "RESULT") || null, records };
}

async function bulkAttendance(req, items, eventDate, idempotencyKey) {
  schoolWrite(req);
  if (!Array.isArray(items) || !items.length) throw fail("Attendance records are required.");
  if (!idempotencyKey) throw fail("Idempotency-Key is required for bulk attendance.");
  const school = schoolId(req);
  const hash = payloadHash({ records: items, eventDate: eventDate || null });
  const prior = await AttendanceBatch.findOne({ school, idempotencyKey }).lean();
  if (prior) {
    if (prior.payloadHash !== hash) throw fail("Idempotency-Key was already used with a different attendance payload.", 409);
    return Record.find({ _id: { $in: prior.responseRecordIds }, school }).sort({ createdAt: 1 }).lean();
  }
  const seen = new Set();
  for (const item of items) {
    if (!id(item.childId || item.child) || seen.has(String(item.childId || item.child))) throw fail("Bulk attendance contains an invalid or duplicate student.");
    seen.add(String(item.childId || item.child));
  }
  const session = await mongoose.startSession();
  let records;
  try {
    await session.withTransaction(async () => {
      const [batch] = await AttendanceBatch.create([{ school, idempotencyKey, payloadHash: hash, createdBy: req.user._id }], { session });
      records = [];
      for (const item of items) {
        records.push(await create(req, "ATTENDANCE", { ...item, eventDate: item.eventDate || eventDate, idempotencyKey: `${idempotencyKey}:${item.childId || item.child}` }, true, session, { batch: batch._id }));
      }
      batch.responseRecordIds = records.map((row) => row._id);
      await batch.save({ session });
    });
  } catch (e) {
    if (e?.code === 11000) {
      const raced = await AttendanceBatch.findOne({ school, idempotencyKey }).lean();
      if (raced?.payloadHash === hash) return Record.find({ _id: { $in: raced.responseRecordIds }, school }).sort({ createdAt: 1 }).lean();
      if (raced) throw fail("Idempotency-Key was already used with a different attendance payload.", 409);
    }
    throw e;
  } finally { await session.endSession(); }
  for (const record of records) {
    if (record.parentVisible && record.child) { const child = await Child.findById(record.child).lean(); if (child) await notifyParents(record, child, "attendance"); }
  }
  return records;
}

async function createGuardianInvite(req, childId, expiresInHours = 72) {
  schoolWrite(req);
  if (!["OWNER", "ADMIN"].includes(String(req.eduPaySchoolUser?.role || "").toUpperCase())) throw fail("Guardian invites require OWNER or ADMIN permission.", 403);
  const child = await Child.findOne({ _id: childId, school: schoolId(req), status: "ACTIVE" }).lean();
  if (!child) throw fail("Student does not belong to this school.", 403);
  const code = crypto.randomBytes(24).toString("base64url");
  const invite = await GuardianInvite.create({ school: schoolId(req), child: child._id, codeHash: payloadHash(code), expiresAt: new Date(Date.now() + Math.min(168, Math.max(0, Number(expiresInHours))) * 3600000), createdBy: req.user._id });
  return { invite, code };
}

async function acceptGuardianInvite(req, code) {
  if (!code || typeof code !== "string") throw fail("Guardian invite code is required.");
  const session = await mongoose.startSession();
  let link;
  try {
    await session.withTransaction(async () => {
      const invite = await GuardianInvite.findOneAndUpdate({ codeHash: payloadHash(code), status: "PENDING", expiresAt: { $gt: new Date() } }, { $set: { status: "CONSUMED", consumedBy: req.user._id, consumedAt: new Date() } }, { new: true, session });
      if (!invite) throw fail("Guardian invite is invalid, expired, revoked, or already used.", 400);
      link = await Link.findOneAndUpdate({ child: invite.child, parent: req.user._id, school: invite.school }, { $set: { status: "VERIFIED", verifiedAt: new Date(), verifiedBy: invite.createdBy }, $setOnInsert: { child: invite.child, parent: req.user._id, school: invite.school } }, { upsert: true, new: true, setDefaultsOnInsert: true, session });
    });
  } finally { await session.endSession(); }
  return link;
}

async function revokeGuardianInvite(req, inviteId) {
  schoolWrite(req);
  if (!["OWNER", "ADMIN"].includes(String(req.eduPaySchoolUser?.role || "").toUpperCase())) throw fail("Guardian invite revocation requires OWNER or ADMIN permission.", 403);
  const invite = await GuardianInvite.findOneAndUpdate({ _id: inviteId, school: schoolId(req), status: "PENDING" }, { $set: { status: "REVOKED" } }, { new: true });
  if (!invite) throw fail("Pending guardian invite not found.", 404);
  return invite;
}

module.exports = { create, update, publish, listForSchool, listForParent, summary, bulkAttendance, createGuardianInvite, acceptGuardianInvite, revokeGuardianInvite, childForParent, schoolWrite, requireType };