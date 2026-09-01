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
        "NEEDS_MORE_INFORMATION",
      ],
      default: "NOT_STARTED",
      index: true,
    },
    assignedOfficer: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    assignmentState: { type: String, enum: ["UNASSIGNED", "ACTIVE"], default: "UNASSIGNED", index: true },
    assignedAt: { type: Date, default: null },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    assignmentVersion: { type: Number, default: 0, min: 0 },
    assignmentHistory: [{
      officer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
      assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
      assignedAt: { type: Date, required: true },
      version: { type: Number, required: true },
    }],

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
     * Submitted identity references are private and only selected by the
     * protected Head Office KYC review API. Customer-facing responses always
     * expose masked last-four values instead.
     */
    submittedNin: {
      type: String,
      trim: true,
      default: "",
      select: false,
      index: true,
    },

    submittedBvn: {
      type: String,
      trim: true,
      default: "",
      select: false,
      index: true,
    },

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
    ninVerifiedAt: {
      type: Date,
      default: null,
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
    bvnVerifiedAt: {
      type: Date,
      default: null,
    },
    identityMatchStatus: {
      type: String,
      enum: ["NOT_VERIFIED", "MATCHED", "REVIEW_REQUIRED", "FAILED"],
      default: "NOT_VERIFIED",
    },
    documentType: {
      type: String,
      enum: ["", "NIN_SLIP", "NATIONAL_ID", "DRIVERS_LICENSE", "INTERNATIONAL_PASSPORT", "VOTERS_CARD"],
      default: "",
    },
    selfieAssetId: {
      type: String,
      trim: true,
      default: "",
    },
    idDocumentAssetId: {
      type: String,
      trim: true,
      default: "",
    },
    idDocumentBackAssetId: {
      type: String,
      trim: true,
      default: "",
    },
    proofOfAddressAssetId: {
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
    reviewReason: {
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
    approvedAt: {
      type: Date,
      default: null,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
    verificationMethod: {
      type: String,
      enum: ["", "PROVIDER", "MANUAL_ADMIN_OVERRIDE"],
      default: "",
    },
    livenessStatus: {
      type: String,
      enum: ["NOT_STARTED", "READY_FOR_CHECK", "PASSED", "FAILED"],
      default: "NOT_STARTED",
    },
    reviewHistory: {
      type: [
        {
          action: {
            type: String,
            required: true,
          },
          reason: {
            type: String,
            default: "",
          },
          reviewer: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
          },
          occurredAt: {
            type: Date,
            default: Date.now,
          },
        },
      ],
      default: [],
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
