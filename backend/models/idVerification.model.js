const mongoose = require("mongoose");

const idVerificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    idType: {
      type: String,
      required: true,
      enum: [
        "NIN",
        "BVN",
        "DRIVER_LICENSE",
        "PASSPORT",
        "VOTER_CARD",
      ],
    },

    idNumber: {
      type: String,
      required: true,
      trim: true,
    },

    amountCharged: {
      type: Number,
      required: true,
      default: 0,
    },

    status: {
      type: String,
      enum: ["PENDING", "SUCCESS", "FAILED"],
      default: "PENDING",
    },

    consent: {
      type: Boolean,
      required: true,
      default: false,
    },

    provider: {
      type: String,
      default: "NOT_CONNECTED",
    },

    providerReference: {
      type: String,
      default: "",
    },

    verificationData: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    providerResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    errorMessage: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model(
  "IdVerification",
  idVerificationSchema
);