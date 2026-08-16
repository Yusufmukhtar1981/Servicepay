const mongoose = require("mongoose");

const airtimeToCashSchema = new mongoose.Schema(
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
      unique: true,
      index: true,
    },

    network: {
      type: String,
      enum: ["MTN", "AIRTEL", "GLO", "9MOBILE"],
      required: true,
    },

    airtimeAmount: {
      type: Number,
      required: true,
      min: 1,
    },

    ratePercent: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },

    cashAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    senderPhone: {
      type: String,
      required: true,
      trim: true,
    },

    receivingPhone: {
      type: String,
      required: true,
      trim: true,
    },

    status: {
      type: String,
      enum: [
        "PENDING",
        "APPROVED",
        "REJECTED",
        "CANCELLED",
      ],
      default: "PENDING",
      index: true,
    },

    note: {
      type: String,
      default: "",
      trim: true,
    },

    adminNote: {
      type: String,
      default: "",
      trim: true,
    },

    approvedAt: Date,
    rejectedAt: Date,

    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    walletCredited: {
      type: Boolean,
      default: false,
      index: true,
    },

    walletCreditedAt: Date,
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model(
  "AirtimeToCash",
  airtimeToCashSchema
);
