const mongoose = require("mongoose");

const empowermentBeneficiarySchema = new mongoose.Schema(
  {
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      default: null,
      index: true,
    },
    program: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EmpowermentProgram",
      required: true,
      index: true,
    },

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    fullName: {
      type: String,
      required: true,
      trim: true,
    },

    phone: {
      type: String,
      required: true,
      trim: true,
    },

    normalizedPhone: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    email: {
      type: String,
      trim: true,
      lowercase: true,
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

    ward: {
      type: String,
      trim: true,
      default: "",
    },

    gender: {
      type: String,
      enum: ["FEMALE", "MALE", "OTHER", "PREFER_NOT_TO_SAY", ""],
      default: "",
    },

    dateOfBirth: {
      type: Date,
      default: null,
    },

    address: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },

    /*
     * Store a KYC record reference only. Do not persist raw NIN/BVN
     * values in the Empowerment domain.
     */
    kycReference: {
      type: String,
      trim: true,
      default: "",
    },

    kycStatus: {
      type: String,
      enum: [
        "NOT_STARTED",
        "PENDING",
        "UNDER_REVIEW",
        "VERIFIED",
        "REJECTED",
      ],
      default: "NOT_STARTED",
    },

    verificationStatus: {
      type: String,
      enum: ["PENDING", "VERIFIED", "REJECTED"],
      default: "PENDING",
      index: true,
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

    applicationStatus: {
      type: String,
      enum: [
        "SUBMITTED",
        "UNDER_REVIEW",
        "APPROVED",
        "REJECTED",
        "PAYMENT_PENDING",
        "PAID",
        "FAILED",
        "REVERSED",
      ],
      default: "SUBMITTED",
      index: true,
    },

    amount: {
      type: Number,
      default: 0,
      min: 0,
    },

    rejectionReason: {
      type: String,
      trim: true,
      default: "",
    },

    paymentReference: {
      type: String,
      trim: true,
      default: "",
    },

    paidAt: {
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

empowermentBeneficiarySchema.index(
  { program: 1, normalizedPhone: 1 },
  { unique: true }
);

empowermentBeneficiarySchema.index(
  { program: 1, user: 1 },
  {
    unique: true,
    partialFilterExpression: {
      user: { $type: "objectId" },
    },
  }
);

module.exports = mongoose.model(
  "EmpowermentBeneficiary",
  empowermentBeneficiarySchema
);
