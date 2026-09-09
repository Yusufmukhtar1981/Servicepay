const mongoose = require("mongoose");

const walletHoldSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    reference: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
    },
    linkedReference: {
      type: String,
      default: "",
      trim: true,
    },
    initialAmount: {
      type: Number,
      required: true,
      min: 0.01,
    },
    remainingAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ["ACTIVE", "PARTIALLY_RELEASED", "RELEASED", "CANCELLED"],
      default: "ACTIVE",
      index: true,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    releases: [
      {
        amount: { type: Number, required: true, min: 0.01 },
        reason: { type: String, required: true, trim: true, maxlength: 500 },
        releasedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        releasedAt: { type: Date, default: Date.now },
        idempotencyKey: { type: String, required: true, unique: true },
      },
    ],
  },
  { timestamps: true }
);

walletHoldSchema.index({ user: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("WalletHold", walletHoldSchema);