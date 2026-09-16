const { mongoose, money } = require("./edupayModelUtils");
const schema = new mongoose.Schema({
  school: { type: mongoose.Schema.Types.ObjectId, ref: "EduPaySchool", required: true, immutable: true, index: true },
  session: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayAcademicSession", required: true, immutable: true },
  term: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayTerm", required: true, immutable: true },
  classLevel: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayClass", required: true, immutable: true },
  amount: { ...money(0), required: true, min: 0.01 },
  currency: { type: String, default: "NGN", immutable: true },
  status: { type: String, enum: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "RETIRED"], default: "DRAFT", index: true },
  submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  reviewedAt: Date,
  reviewNote: String,
  effectiveFrom: Date,
}, { timestamps: true });
schema.index({ school: 1, session: 1, term: 1, classLevel: 1, status: 1 });
module.exports = mongoose.model("EduPayFeeStructure", schema);