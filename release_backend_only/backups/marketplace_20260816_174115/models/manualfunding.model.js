const mongoose = require("mongoose");

const manualFundingSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 100,
    },

    senderName: {
      type: String,
      required: true,
      trim: true,
    },

    senderBank: {
      type: String,
      required: true,
      trim: true,
    },

    paymentReference: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    note: {
      type: String,
      trim: true,
      default: "",
    },

    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
      index: true,
    },

    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    reviewedAt: {
      type: Date,
      default: null,
    },

    adminNote: {
      type: String,
      trim: true,
      default: "",
    },

    balanceBefore: {
      type: Number,
      default: null,
    },

    balanceAfter: {
      type: Number,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

manualFundingSchema.index(
  {
    user: 1,
    paymentReference: 1,
  },
  {
    unique: true,
  }
);

module.exports = mongoose.model(
  "ManualFunding",
  manualFundingSchema
);