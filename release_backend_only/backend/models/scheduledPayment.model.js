const mongoose = require("mongoose");
const scheduledPaymentSchema = new mongoose.Schema({
  reference: { type: String, required: true, unique: true, index: true },
  idempotencyKey: { type: String, required: true, unique: true, index: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  serviceType: { type: String, required: true, enum: ["AIRTIME", "DATA", "CABLE", "ELECTRICITY", "TRANSFER", "BANK_TRANSFER"] },
  provider: { type: String, trim: true, default: "" },
  amount: { type: Number, required: true, min: 0.01 },
  executeAt: { type: Date, required: true, index: true },
  status: { type: String, enum: ["SCHEDULED", "EXECUTION_REFUSED", "CANCELLED"], default: "SCHEDULED", index: true },
  executionAttempts: { type: Number, default: 0, min: 0 },
  lastExecutionIdempotencyKey: { type: String, default: "" },
  refusalReason: { type: String, default: "" },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });
scheduledPaymentSchema.index({ status: 1, executeAt: 1 });
module.exports = mongoose.model("ScheduledPayment", scheduledPaymentSchema);