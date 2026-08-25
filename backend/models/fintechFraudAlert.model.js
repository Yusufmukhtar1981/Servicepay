const mongoose = require("mongoose");

const fintechFraudAlertSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    transaction: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transaction",
      default: null,
      index: true,
    },
    riskLevel: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
      required: true,
      index: true,
    },
    rule: {
      type: String,
      required: true,
      trim: true,
    },
    details: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    status: {
      type: String,
      enum: ["OPEN", "REVIEWING", "CLEARED", "ESCALATED"],
      default: "OPEN",
      index: true,
    },
    notes: [
      {
        note: { type: String, required: true, trim: true, maxlength: 2000 },
        author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

fintechFraudAlertSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("FintechFraudAlert", fintechFraudAlertSchema);