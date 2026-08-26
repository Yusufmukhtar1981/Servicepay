const mongoose = require("mongoose");

const paymentScheduleSchema = new mongoose.Schema({
  installmentNumber: { type: Number, required: true },
  dueDate: { type: Date, required: true },
  amount: { type: Number, required: true, min: 0 },
  paidAmount: { type: Number, default: 0, min: 0 },
  status: { type: String, enum: ["PENDING", "PARTIAL", "PAID", "OVERDUE"], default: "PENDING" },
  paidAt: { type: Date, default: null },
}, { _id: true });

const historySchema = new mongoose.Schema({
  status: { type: String, required: true },
  changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  note: { type: String, default: "" },
  changedAt: { type: Date, default: Date.now },
}, { _id: false });

const solarFinanceSchema = new mongoose.Schema({
  reference: { type: String, required: true, unique: true, index: true },
  application: { type: mongoose.Schema.Types.ObjectId, ref: "SolarApplication", required: true, unique: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  termsSnapshot: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  installationSnapshot: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  totalPayable: { type: Number, required: true, min: 0 },
  amountPaid: { type: Number, default: 0, min: 0 },
  outstandingBalance: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ["FINANCE_ACTIVE", "OVERDUE", "DEFAULT_REVIEW", "RECOVERY_REQUIRED", "RECOVERED", "COMPLETED", "CANCELLED"], default: "FINANCE_ACTIVE", index: true },
  statusHistory: { type: [historySchema], default: [] },
  paymentSchedule: { type: [paymentScheduleSchema], default: [] },
}, { timestamps: true });
solarFinanceSchema.index({ customer: 1, createdAt: -1 });
module.exports = mongoose.model("SolarFinance", solarFinanceSchema);