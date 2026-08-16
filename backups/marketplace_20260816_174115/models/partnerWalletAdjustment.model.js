const mongoose = require("mongoose");

const partnerWalletAdjustmentSchema = new mongoose.Schema(
  {
    partner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Partner",
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: ["CREDIT", "DEBIT"],
      required: true,
      index: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 0.01,
    },

    walletBefore: {
      type: Number,
      required: true,
      default: 0,
    },

    walletAfter: {
      type: Number,
      required: true,
      default: 0,
    },

    reference: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    narration: {
      type: String,
      trim: true,
      maxlength: 250,
      default: "",
    },

    performedBy: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    status: {
      type: String,
      enum: ["SUCCESSFUL", "FAILED"],
      default: "SUCCESSFUL",
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports =
  mongoose.models.PartnerWalletAdjustment ||
  mongoose.model(
    "PartnerWalletAdjustment",
    partnerWalletAdjustmentSchema
  );
