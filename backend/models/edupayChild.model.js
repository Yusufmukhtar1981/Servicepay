const { mongoose } = require("./edupayModelUtils");
const schema = new mongoose.Schema({
  parent: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true, index: true },
  fullName: { type: String, required: true, trim: true, maxlength: 180 },
  dateOfBirth: Date,
  gender: { type: String, trim: true, maxlength: 30 },
  photo: { type: String, default: null },
  admissionNumber: { type: String, trim: true, maxlength: 80, default: null },
  className: { type: String, trim: true, maxlength: 100, default: null },
  arm: { type: String, trim: true, maxlength: 50, default: null },
  academicSession: { type: String, trim: true, maxlength: 80, default: null },
  term: { type: String, trim: true, maxlength: 50, default: null },
  studentStatus: { type: String, trim: true, maxlength: 40, default: "ACTIVE" },
  school: { type: mongoose.Schema.Types.ObjectId, ref: "EduPaySchool", required: true, immutable: true, index: true },
  academicStudent: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayStudent", default: null, index: true },
  academicStudentLinkStatus: { type: String, enum: ["UNRESOLVED", "RESOLVED", "CONFLICT"], default: "UNRESOLVED", index: true },
  academicStudentLinkSource: { type: String, enum: ["ADMISSION", "MANUAL", "PARENT_REFERENCE", "BACKFILL"], default: null },
  academicStudentLinkedAt: { type: Date, default: null },
  academicStudentLinkedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  status: { type: String, enum: ["ACTIVE", "ARCHIVED"], default: "ACTIVE", index: true },
}, { timestamps: true });
schema.index({ parent: 1, fullName: 1 });
schema.index({ school: 1, academicStudent: 1 });
schema.index({ school: 1, academicStudentLinkStatus: 1 });
module.exports = mongoose.model("EduPayChild", schema);