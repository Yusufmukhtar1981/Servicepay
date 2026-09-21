const { mongoose, money } = require("./edupayModelUtils");
const schema = new mongoose.Schema({
  parent: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true, index: true },
  child: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayChild", required: true, immutable: true, index: true },
  school: { type: mongoose.Schema.Types.ObjectId, ref: "EduPaySchool", required: true, immutable: true, index: true },
  session: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayAcademicSession", required: true, immutable: true },
  term: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayTerm", required: true, immutable: true },
  classLevel: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayClass", required: true, immutable: true },
  feeStructure: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayFeeStructure", required: true, immutable: true },
  officialFee: { ...money(0), required: true, immutable: true },
  targetAmount: { ...money(0), immutable: true, min: 0 },
  savingFrequency: { type: String, enum: ["DAILY", "WEEKLY", "MONTHLY", "FLEXIBLE", "CUSTOM"], default: "MONTHLY" },
  preferredContributionAmount: { ...money(0), default: 0, min: 0, immutable: false },
  targetDate: { type: Date, required: true },
  recommendedContribution: money(0),
  status: { type: String, enum: ["SAVING", "UPCOMING", "READY_FOR_SETTLEMENT", "ADMIN_REVIEW", "APPROVED", "PROCESSING", "SETTLED", "COMPLETED", "PAUSED", "FAILED", "REVERSED", "CANCELLED", "DISPUTED"], default: "SAVING", index: true },
  ledgerVersion: { type: Number, default: 0, min: 0 },
  autosave: { enabled: { type: Boolean, default: false }, amount: money(0), frequency: { type: String, enum: ["DAILY", "WEEKLY", "MONTHLY", "CUSTOM", null], default: null }, nextContributionAt: Date, pausedAt: Date },
}, { timestamps: true });
schema.index({ parent: 1, status: 1 });
schema.index({ school: 1, status: 1, targetDate: 1 });
schema.index({ school: 1, child: 1, status: 1 });
module.exports = mongoose.model("EduPayPlan", schema);