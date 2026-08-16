const mongoose = require("mongoose");

const empowermentBeneficiarySchema = new mongoose.Schema(
  {
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
  { program: 1, phone: 1 },
  { unique: true }
);

module.exports = mongoose.model(
  "EmpowermentBeneficiary",
  empowermentBeneficiarySchema
);
