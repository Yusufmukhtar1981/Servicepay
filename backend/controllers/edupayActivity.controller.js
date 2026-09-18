const service = require("../services/edupayActivity.service");
const Child = require("../models/edupayChild.model");
const Link = require("../models/edupayGuardianLink.model");
const Record = require("../models/edupayActivityCenter.model");
const error = (res, e) => res.status(e.statusCode || 500).json({ success: false, message: e.message || "EduPay activity request failed." });
const send = (res, data, status = 200) => res.status(status).json({ success: true, ...data });

exports.schoolList = async (req, res) => { try { send(res, { records: await service.listForSchool(req, req.query.type) }); } catch (e) { error(res, e); } };
exports.schoolCreate = async (req, res) => { try { send(res, { record: await service.create(req, req.params.type, req.body, req.body.publish !== false) }, 201); } catch (e) { error(res, e); } };
exports.schoolUpdate = async (req, res) => { try { send(res, { record: await service.update(req, req.params.recordId, req.body) }); } catch (e) { error(res, e); } };
exports.schoolPublish = async (req, res) => { try { send(res, { record: await service.publish(req, req.params.recordId) }); } catch (e) { error(res, e); } };
exports.schoolBulkAttendance = async (req, res) => {
  try {
    const records = await service.bulkAttendance(req, req.body.records, req.body.eventDate, (req.get && req.get("Idempotency-Key")) || req.body.idempotencyKey);
    send(res, { records }, 201);
  } catch (e) { error(res, e); }
};
exports.schoolGuardianInvite = async (req, res) => {
  try {
    const { invite, code } = await service.createGuardianInvite(req, req.body.childId, req.body.expiresInHours);
    // The plaintext code is intentionally returned only in this response and
    // is never persisted or logged.
    send(res, { invite: { id: invite._id, child: invite.child, expiresAt: invite.expiresAt, status: invite.status }, code }, 201);
  } catch (e) { error(res, e); }
};
exports.parentGuardianAccept = async (req, res) => {
  try {
    const link = await service.acceptGuardianInvite(req, req.body.code);
    send(res, { link: { id: link._id, child: link.child, school: link.school, relationship: link.relationship, status: link.status, verifiedAt: link.verifiedAt } }, 201);
  } catch (e) { error(res, e); }
};
exports.schoolGuardianRevoke = async (req, res) => {
  try {
    const invite = await service.revokeGuardianInvite(req, req.params.inviteId);
    send(res, { invite: { id: invite._id, child: invite.child, expiresAt: invite.expiresAt, status: invite.status } });
  } catch (e) { error(res, e); }
};
exports.schoolLink = async (req, res) => {
  return res.status(410).json({ success: false, message: "Direct guardian verification is retired; use a one-time guardian invite." });
};
exports.parentChildren = async (req, res) => {
  try {
    const direct = await Child.find({ parent: req.user._id, status: "ACTIVE" }).populate("school").lean();
    const links = await Link.find({ parent: req.user._id, status: "VERIFIED" }).populate({ path: "child", populate: { path: "school" } }).lean();
    const map = new Map(direct.map((row) => [String(row._id), row]));
    links.forEach((row) => { if (row.child) map.set(String(row.child._id), row.child); });
    send(res, { children: [...map.values()].map((child) => ({ id: child._id, fullName: child.fullName, admissionNumber: child.admissionNumber || null, photo: child.photo || null, school: child.school?._id || child.school || null, className: child.className || null, arm: child.arm || null, academicSession: child.academicSession || null, term: child.term || null, studentStatus: child.studentStatus || child.status })) });
  } catch (e) { error(res, e); }
};
const parentChildDto = (child) => child && ({ id: child._id, fullName: child.fullName, admissionNumber: child.admissionNumber || null, photo: child.photo || null, school: child.school?._id || child.school || null, className: child.className || null, arm: child.arm || null, academicSession: child.academicSession || null, term: child.term || null, studentStatus: child.studentStatus || child.status });
const parentRecordDto = (row) => {
  const payload = row.payload || {};
  const allowed = { ATTENDANCE: ["status", "note"], RESULT: ["subject", "ca", "exam", "total", "grade", "position", "teacherComment"], ASSIGNMENT: ["title", "subject", "description", "dueDate", "status"], ACTIVITY: ["title", "description", "category", "image", "date"], CONDUCT: ["category", "note", "severity", "title"], ANNOUNCEMENT: ["title", "description", "message", "date", "eventDate"] }[row.recordType] || [];
  const clean = Object.fromEntries(allowed.filter((key) => payload[key] !== undefined).map((key) => [key, payload[key]]));
  return { id: row._id, type: row.recordType, eventDate: row.eventDate, status: row.status, audience: row.audience, payload: clean };
};
const parentDto = (result) => ({ ...result, child: parentChildDto(result.child), records: (result.records || []).map(parentRecordDto), attendanceToday: result.attendanceToday ? parentRecordDto(result.attendanceToday) : null, latestResult: result.latestResult ? parentRecordDto(result.latestResult) : null });
exports.parentList = async (req, res) => { try { const result = await service.listForParent(req, req.params.childId, req.query.type); send(res, parentDto(result)); } catch (e) { error(res, e); } };
exports.parentSummary = async (req, res) => { try { send(res, parentDto(await service.summary(req, req.params.childId))); } catch (e) { error(res, e); } };
exports.parentDashboard = async (req, res) => { try { send(res, parentDto(await service.summary(req, req.params.childId))); } catch (e) { error(res, e); } };
exports.parentReport = async (req, res) => { try { const result = await service.listForParent(req, req.params.childId, "RESULT"); send(res, { child: parentChildDto(result.child), results: result.records.map(parentRecordDto) }); } catch (e) { error(res, e); } };