const mongoose = require("mongoose");

const featurePaymentSchema = new mongoose.Schema(
  {
    reference: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    featureType: {
      type: String,
      enum: [
        "PAY_BY_LINK",
        "MONEY_REQUEST",
        "AJO_CONTRIBUTION",
      ],
      required: true,
      index: true,
    },

    sourceId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    payer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    beneficiary: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 1,
    },

    status: {
      type: String,
      enum: [
        "PENDING",
        "SUCCESSFUL",
        "FAILED",
        "REVERSED",
      ],
      default: "PENDING",
      index: true,
    },

    description: {
      type: String,
      default: "",
      trim: true,
    },

    completedAt: Date,
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model(
  "FeaturePayment",
  featurePaymentSchema
);
