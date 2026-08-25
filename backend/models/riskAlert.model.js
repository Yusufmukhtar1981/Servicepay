const mongoose = require("mongoose");
const riskAlertSchema = new mongoose.Schema({
  alertReference: { type: String, required: true, unique: true, index: true },
  idempotencyKey: { type: String, required: true, unique: true, index: true },
  transaction: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction", default: null, index: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
  kind: { type: String, required: true, enum: ["SUSPICIOUS_TRANSACTION", "AML"], index: true },
  severity: { type: String, required: true, enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"], default: "MEDIUM" },
  status: { type: String, enum: ["OPEN", "IN_REVIEW", "DISMISSED", "ESCALATED", "RESOLVED"], default: "OPEN", index: true },
  reason: { type: String, required: true, trim: true, maxlength: 1000 },
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  reviewNote: { type: String, trim: true, maxlength: 2000, default: "" },
}, { timestamps: true });
riskAlertSchema.index({ kind: 1, status: 1, createdAt: -1 });
riskAlertSchema.index({ transaction: 1, kind: 1 }, { unique: true, sparse: true });
module.exports = mongoose.model("RiskAlert", riskAlertSchema);