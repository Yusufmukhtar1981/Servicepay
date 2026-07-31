const mongoose = require("mongoose");

const idVerificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    idType: {
      type: String,
      enum: ["NIN", "BVN", "DRIVER_LICENSE", "PASSPORT", "VOTER_CARD"],
      default: "NIN",
    },

    searchType: {
      type: String,
      enum: ["NIN_NUMBER", "PHONE_NUMBER", "DEMOGRAPHIC"],
      default: "NIN_NUMBER",
    },

    slipType: {
      type: String,
      enum: ["PREMIUM", "STANDARD", "REGULAR", "INFORMATION"],
      default: "PREMIUM",
    },

    reference: {
      type: String,
      unique: true,
      required: true,
    },

    amountCharged: {
      type: Number,
      default: 0,
    },

    status: {
      type: String,
      enum: ["PENDING", "SUCCESSFUL", "FAILED"],
      default: "PENDING",
    },

    ninNumberMasked: {
      type: String,
      default: "",
    },

    consentAccepted: {
      type: Boolean,
      default: false,
    },

    verificationData: {
      fullName: { type: String, default: "" },
      firstName: { type: String, default: "" },
      middleName: { type: String, default: "" },
      lastName: { type: String, default: "" },
      nin: { type: String, default: "" },
      phone: { type: String, default: "" },
      gender: { type: String, default: "" },
      dateOfBirth: { type: String, default: "" },
      address: { type: String, default: "" },
      stateOfOrigin: { type: String, default: "" },
      lga: { type: String, default: "" },
      photo: { type: String, default: "" },
    },

    rawResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    failureReason: {
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