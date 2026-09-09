const mongoose = require("mongoose");
const noteSchema = new mongoose.Schema({ body: { type: String, required: true, trim: true, maxlength: 2000 }, authorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, idempotencyKey: { type: String, trim: true, maxlength: 120 }, createdAt: { type: Date, default: Date.now } }, { _id: true });
const eventSchema = new mongoose.Schema({ type: { type: String, required: true, trim: true, maxlength: 50 }, fromStatus: { type: String, default: null }, toStatus: { type: String, default: null }, reason: { type: String, required: true, trim: true, maxlength: 500 }, actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, createdAt: { type: Date, default: Date.now } }, { _id: true });
const riskAlertSchema = new mongoose.Schema({
  identity: { type: String, required: true, unique: true, index: true },
  transaction: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction", required: true, index: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  customerZone: { type: String, trim: true, default: null, index: true },
  customerState: { type: String, trim: true, default: null, index: true },
  customerBusinessPartner: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
  rule: { type: mongoose.Schema.Types.ObjectId, ref: "RiskRule", required: true, index: true },
  ruleCode: { type: String, required: true, uppercase: true, index: true },
  ruleVersion: { type: Number, required: true, min: 1 },
  status: { type: String, enum: ["NEW", "UNDER_REVIEW", "ESCALATED", "CLEARED", "CONFIRMED_RISK", "CLOSED"], default: "NEW", index: true },
  severity: { type: String, enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"], required: true, index: true },
  score: { type: Number, required: true, min: 0, max: 100 },
  reasons: [{ code: { type: String, required: true }, text: { type: String, required: true }, evidence: { type: mongoose.Schema.Types.Mixed, default: {} } }],
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
  notes: { type: [noteSchema], default: [] },
  events: { type: [eventSchema], default: [] },
  lastEvaluatedAt: { type: Date, default: Date.now },
  mutationVersion: { type: Number, default: 0, min: 0 },
}, { timestamps: true, optimisticConcurrency: true });
riskAlertSchema.index({ status: 1, severity: -1, createdAt: -1 });
riskAlertSchema.index({ customer: 1, createdAt: -1 });
riskAlertSchema.index({ customerZone: 1, customerState: 1, createdAt: -1 });
riskAlertSchema.index({ customerBusinessPartner: 1, createdAt: -1 });
module.exports = mongoose.model("RiskAlert", riskAlertSchema);