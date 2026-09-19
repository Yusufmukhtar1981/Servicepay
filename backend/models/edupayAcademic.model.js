const { mongoose } = require("./edupayModelUtils");
const sessionSchema = new mongoose.Schema({
  school: { type: mongoose.Schema.Types.ObjectId, ref: "EduPaySchool", required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  startsAt: Date, endsAt: Date,
  status: { type: String, enum: ["DRAFT", "ACTIVE", "CLOSED"], default: "DRAFT", index: true },
}, { timestamps: true });
sessionSchema.index({ school: 1, name: 1 }, { unique: true });
sessionSchema.index({ school: 1, status: 1 }, { unique: true, partialFilterExpression: { status: "ACTIVE" } });
const termSchema = new mongoose.Schema({
  school: { type: mongoose.Schema.Types.ObjectId, ref: "EduPaySchool", required: true, index: true },
  session: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayAcademicSession", required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  startsAt: Date, endsAt: Date,
  status: { type: String, enum: ["DRAFT", "ACTIVE", "CLOSED"], default: "DRAFT" },
}, { timestamps: true });
termSchema.index({ session: 1, name: 1 }, { unique: true });
termSchema.index({ school: 1, status: 1 }, { unique: true, partialFilterExpression: { status: "ACTIVE" } });
const classSchema = new mongoose.Schema({
  school: { type: mongoose.Schema.Types.ObjectId, ref: "EduPaySchool", required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  arm: { type: String, trim: true, maxlength: 40, default: null },
  session: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayAcademicSession", default: null, index: true },
  classTeacher: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayTeacher", default: null },
  status: { type: String, enum: ["ACTIVE", "INACTIVE"], default: "ACTIVE" },
}, { timestamps: true });
classSchema.index({ school: 1, name: 1, arm: 1 }, { unique: true });
module.exports = {
  EduPayAcademicSession: mongoose.model("EduPayAcademicSession", sessionSchema),
  EduPayTerm: mongoose.model("EduPayTerm", termSchema),
  EduPayClass: mongoose.model("EduPayClass", classSchema),
};