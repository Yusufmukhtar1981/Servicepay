const mongoose = require("mongoose");

const solarOfficerWithdrawalSchema = new mongoose.Schema(
  {
    officer: { type: mongoose.Schema.Types.ObjectId, ref: "SolarOfficer", required: true, index: true },
    reference: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    amount: { type: Number, required: true, min: 0.01 },
    currency: { type: String, uppercase: true, default: "NGN" },
    bankCode: { type: String, required: true, trim: true },
    bankName: { type: String, required: true, trim: true },
    accountNumber: { type: String, required: true, trim: true },
    accountName: { type: String, required: true, trim: true },
    allocations: [{
      commission: { type: mongoose.Schema.Types.ObjectId, ref: "SolarOfficerCommission", required: true },
      amount: { type: Number, required: true, min: 0 },
    }],
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "PROCESSING", "PAID", "REJECTED", "FAILED"],
      default: "PENDING",
      index: true,
    },
    fundsLocked: { type: Boolean, default: true },
    fundsReturned: { type: Boolean, default: false },
    requestedAt: { type: Date, default: Date.now, index: true },
    approvedAt: { type: Date, default: null },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    rejectedAt: { type: Date, default: null },
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    rejectionReason: { type: String, trim: true, default: "", maxlength: 500 },
    paidAt: { type: Date, default: null },
    adminNote: { type: String, trim: true, default: "", maxlength: 500 },
  },
  { timestamps: true }
);

solarOfficerWithdrawalSchema.index({ officer: 1, createdAt: -1 });
solarOfficerWithdrawalSchema.index({ status: 1, requestedAt: 1 });

module.exports = mongoose.model("SolarOfficerWithdrawal", solarOfficerWithdrawalSchema);