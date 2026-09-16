const { mongoose, money, immutableSchema } = require("./edupayModelUtils");
const schema = immutableSchema({
  parent: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true, index: true },
  child: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayChild", required: true, immutable: true, index: true },
  plan: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayPlan", required: true, immutable: true },
  school: { type: mongoose.Schema.Types.ObjectId, ref: "EduPaySchool", required: true, immutable: true, index: true },
  reference: { type: String, required: true, unique: true, immutable: true },
  idempotencyKey: { type: String, required: true, unique: true, immutable: true },
  status: { type: String, enum: ["READY_FOR_SETTLEMENT", "ADMIN_REVIEW", "APPROVED", "PROCESSING", "SETTLED", "FAILED", "REVERSED", "CANCELLED", "DISPUTED"], default: "READY_FOR_SETTLEMENT", index: true },
  officialFee: { ...money(0), required: true, immutable: true },
  parentSavedAmount: { ...money(0), required: true, immutable: true },
  servicepayFundedPrincipal: { ...money(0), required: true, immutable: true },
  schoolCommissionRate: { type: Number, required: true, immutable: true },
  schoolCommissionAmount: { ...money(0), required: true, immutable: true },
  parentChargeRate: { type: Number, required: true, immutable: true },
  parentChargeAmount: { ...money(0), required: true, immutable: true },
  parentTotalRepayment: { ...money(0), required: true, immutable: true },
  schoolGrossSettlement: { ...money(0), required: true, immutable: true },
  schoolNetSettlement: { ...money(0), required: true, immutable: true },
  commissionMethod: { type: String, enum: ["DEDUCT_COMMISSION", "GROSS_AND_RECEIVABLE"], required: true, immutable: true },
  settlementDate: { type: Date, required: true, immutable: true },
  providerReference: { type: String, default: null, immutable: true },
  provider: { type: String, default: null, immutable: true },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, immutable: true },
  approvedAt: Date,
  confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, immutable: true },
  confirmedAt: Date,
  failureReason: String,
  reversalOf: { type: mongoose.Schema.Types.ObjectId, ref: "EduPaySettlement", default: null, immutable: true },
}, { mutablePaths: ["status", "approvedBy", "approvedAt", "confirmedBy", "confirmedAt", "providerReference", "provider", "failureReason", "reversalOf"] });
schema.index({ plan: 1 }, { unique: true });
schema.index({ school: 1, status: 1, settlementDate: 1 });
module.exports = mongoose.model("EduPaySettlement", schema);