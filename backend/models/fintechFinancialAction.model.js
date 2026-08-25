const mongoose = require("mongoose");

const fintechFinancialActionSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["REFUND", "REVERSAL"],
      required: true,
      index: true,
    },
    originalTransaction: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transaction",
      required: true,
      index: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    reference: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0.01,
    },
    status: {
      type: String,
      enum: ["PENDING", "COMPLETED", "FAILED", "REJECTED"],
      default: "PENDING",
      index: true,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    initiatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    failureReason: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { timestamps: true }
);

fintechFinancialActionSchema.index({ originalTransaction: 1, type: 1 }, { unique: true });

module.exports = mongoose.model("FintechFinancialAction", fintechFinancialActionSchema);