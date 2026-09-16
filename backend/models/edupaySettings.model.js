const { mongoose, money } = require("./edupayModelUtils");
const schema = new mongoose.Schema({
  key: { type: String, default: "GLOBAL", immutable: true },
  enabled: { type: Boolean, default: true },
  schoolCommissionRate: { type: Number, default: 5, min: 0, max: 100 },
  parentShortfallChargeRate: { type: Number, default: 10, min: 0, max: 100 },
  minimumSavingsRequirement: money(0),
  maximumEduPayCover: money(0),
  maximumCoverPercentage: { type: Number, default: 100, min: 0, max: 100 },
  defaultRepaymentPeriodDays: { type: Number, default: 90, min: 1, max: 3650 },
  settlementMethod: { type: String, enum: ["DEDUCT_COMMISSION", "GROSS_AND_RECEIVABLE"], default: "DEDUCT_COMMISSION" },
  settlementLeadDays: { type: Number, default: 0, min: 0, max: 365 },
  gracePeriodDays: { type: Number, default: 7, min: 0, max: 365 },
  autosaveEnabled: { type: Boolean, default: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
}, { timestamps: true });
schema.index({ key: 1 }, { unique: true });
module.exports = mongoose.model("EduPaySettings", schema);