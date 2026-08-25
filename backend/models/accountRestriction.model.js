const mongoose = require("mongoose");

const accountRestrictionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: [
        "BLOCK_LOGIN",
        "BLOCK_OUTGOING_TRANSFERS",
        "BLOCK_WITHDRAWALS",
        "BLOCK_WALLET_DEBIT",
        "BLOCK_BILL_PURCHASES",
        "BLOCK_MARKETPLACE_PURCHASE",
        "BLOCK_PARTNER_API",
        "FULL_FREEZE",
      ],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["ACTIVE", "REMOVED", "EXPIRED"],
      default: "ACTIVE",
      index: true,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    expiresAt: {
      type: Date,
      default: null,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    removedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    removedAt: {
      type: Date,
      default: null,
    },
    removalReason: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },
  },
  { timestamps: true }
);

accountRestrictionSchema.index({ user: 1, type: 1, status: 1 });

module.exports = mongoose.model("AccountRestriction", accountRestrictionSchema);