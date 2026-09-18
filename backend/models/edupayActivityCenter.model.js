const mongoose = require("mongoose");

/*
 * Activity-center records intentionally share one collection.  This keeps the
 * new feature additive to legacy EduPay documents while allowing a common
 * tenant, publication and audit contract for every parent-visible update.
 */
const schema = new mongoose.Schema({
  recordType: { type: String, enum: ["ATTENDANCE", "RESULT", "ASSIGNMENT", "ACTIVITY", "CONDUCT", "ANNOUNCEMENT"], required: true, index: true },
  school: { type: mongoose.Schema.Types.ObjectId, ref: "EduPaySchool", required: true, immutable: true, index: true },
  child: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayChild", default: null, immutable: true, index: true },
  classLevel: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayClass", default: null, immutable: true, index: true },
  audience: { type: String, enum: ["SCHOOL", "CLASS", "STUDENT"], default: "STUDENT" },
  session: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayAcademicSession", default: null },
  term: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayTerm", default: null },
  eventDate: { type: Date, default: Date.now, index: true },
  idempotencyKey: { type: String, trim: true, maxlength: 160, default: null },
  batch: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayAttendanceBatch", default: null, immutable: true, index: true },
  status: { type: String, enum: ["DRAFT", "PUBLISHED", "ARCHIVED"], default: "PUBLISHED", index: true },
  parentVisible: { type: Boolean, default: false, index: true },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  publishedAt: { type: Date, default: null },
  audit: { type: [{ actor: mongoose.Schema.Types.ObjectId, action: String, at: { type: Date, default: Date.now }, metadata: mongoose.Schema.Types.Mixed }], default: [] },
}, { timestamps: true });
schema.index({ school: 1, recordType: 1, child: 1, eventDate: -1 });
schema.index({ school: 1, status: 1, parentVisible: 1, eventDate: -1 });
schema.index({ school: 1, recordType: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } });
schema.index({ school: 1, child: 1, recordType: 1, eventDate: -1, status: 1 });
module.exports = mongoose.model("EduPayActivityCenterRecord", schema);