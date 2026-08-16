const mongoose = require("mongoose");

const kycProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },

    level: {
      type: String,
      enum: ["TIER_1", "TIER_2", "TIER_3"],
      default: "TIER_1",
      index: true,
    },
  requestedLevel: {
    type: String,
    enum: ["TIER_1", "TIER_2", "TIER_3"],
    default: "TIER_1",
    index: true,
  },


    status: {
      type: String,
      enum: [
        "NOT_STARTED",
        "PENDING",
        "UNDER_REVIEW",
        "VERIFIED",
        "REJECTED",
      ],
      default: "NOT_STARTED",
      index: true,
    },

    firstName: {
      type: String,
      trim: true,
      default: "",
    },

    middleName: {
      type: String,
      trim: true,
      default: "",
    },

    lastName: {
      type: String,
      trim: true,
      default: "",
    },

    dateOfBirth: {
      type: Date,
      default: null,
    },

    gender: {
      type: String,
      enum: ["MALE", "FEMALE", "OTHER", ""],
      default: "",
    },

    phone: {
      type: String,
      trim: true,
      default: "",
    },

    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },

    address: {
      type: String,
      trim: true,
      default: "",
    },

    state: {
      type: String,
      trim: true,
      default: "",
    },

    lga: {
      type: String,
      trim: true,
      default: "",
    },

    /*
     * We intentionally do not store raw NIN/BVN here.
     * Verification references will be connected to the
     * existing ServicePay ID verification system.
     */
    ninVerified: {
      type: Boolean,
      default: false,
    },

    ninVerificationId: {
      type: String,
      trim: true,
      default: "",
    },

    ninLast4: {
      type: String,
      trim: true,
      default: "",
    },

    bvnVerified: {
      type: Boolean,
      default: false,
    },

    bvnVerificationId: {
      type: String,
      trim: true,
      default: "",
    },

    bvnLast4: {
      type: String,
      trim: true,
      default: "",
    },

    selfieUrl: {
      type: String,
      trim: true,
      default: "",
    },

    idDocumentUrl: {
      type: String,
      trim: true,
      default: "",
    },

    proofOfAddressUrl: {
      type: String,
      trim: true,
      default: "",
    },

    rejectionReason: {
      type: String,
      trim: true,
      default: "",
    },

    submittedAt: {
      type: Date,
      default: null,
    },

    reviewedAt: {
      type: Date,
      default: null,
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

module.exports =
  mongoose.models.KycProfile ||
  mongoose.model("KycProfile", kycProfileSchema);
