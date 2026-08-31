const mongoose = require("mongoose");
const solarPaymentSchema = new mongoose.Schema({
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", default: null, index: true },
  application: { type: mongoose.Schema.Types.ObjectId, ref: "SolarApplication", required: true, index: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  type: { type: String, enum: ["DEPOSIT", "INSTALLMENT"], required: true },
  amount: { type: Number, required: true, min: 0.01 },
  idempotencyKey: { type: String, required: true, trim: true, unique: true },
  transaction: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction", required: true },
  ledgerEntry: { type: mongoose.Schema.Types.ObjectId, ref: "LedgerEntry", required: true },
  allocations: { type: mongoose.Schema.Types.Mixed, default: [] },
}, { timestamps: true });
module.exports = mongoose.model("SolarPayment", solarPaymentSchema);