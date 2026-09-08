const mongoose = require("mongoose");

const noteSchema = new mongoose.Schema(
  {
    note: { type: String, required: true, trim: true, maxlength: 2000 },
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, _id: false }
);

const fintechDisputeSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true, index: true, trim: true },
    transaction: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction", required: true, unique: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    category: {
      type: String,
      enum: ["UNRECOGNISED", "SERVICE_NOT_RECEIVED", "DUPLICATE_CHARGE", "INCORRECT_AMOUNT", "OTHER"],
      required: true,
    },
    reason: { type: String, required: true, trim: true, maxlength: 2000 },
    amount: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ["OPEN", "IN_REVIEW", "RESOLVED", "REJECTED", "CLOSED"],
      default: "OPEN",
      index: true,
    },
    notes: { type: [noteSchema], default: [] },
    resolution: { type: String, default: "", trim: true, maxlength: 2000 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

fintechDisputeSchema.index({ customer: 1, createdAt: -1 });

module.exports = mongoose.model("FintechDispute", fintechDisputeSchema);