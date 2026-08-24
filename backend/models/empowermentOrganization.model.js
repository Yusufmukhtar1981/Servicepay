const mongoose = require("mongoose");

const empowermentOrganizationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    organizationType: {
      type: String,
      enum: [
        "GOVERNMENT",
        "STATE_GOVERNMENT",
        "LOCAL_GOVERNMENT",
        "POLITICIAN",
        "ASSOCIATION",
        "NGO",
        "COMPANY",
        "COOPERATIVE",
        "FOUNDATION",
        "INDIVIDUAL",
        "OTHER",
      ],
      required: true,
    },

    registrationNumber: {
      type: String,
      trim: true,
      default: "",
    },

    contactName: {
      type: String,
      trim: true,
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

    address: {
      type: String,
      trim: true,
      default: "",
    },

    description: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: "",
    },

    status: {
      type: String,
      enum: ["PENDING", "ACTIVE", "SUSPENDED", "REJECTED"],
      default: "PENDING",
      index: true,
    },

    // `status` is retained for existing Admin and legacy records. New customer
    // surfaces use this explicit lifecycle so "ACTIVE" is never mistaken for a
    // sponsor-controlled operational state.
    verificationStatus: {
      type: String,
      enum: [
        "DRAFT",
        "PENDING_VERIFICATION",
        "VERIFIED",
        "REJECTED",
        "SUSPENDED",
      ],
      default: "PENDING_VERIFICATION",
      index: true,
    },

    verification: {
      verifiedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      verifiedAt: {
        type: Date,
        default: null,
      },
      rejectionReason: {
        type: String,
        trim: true,
        default: "",
      },
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

empowermentOrganizationSchema.index({
  createdBy: 1,
  createdAt: -1,
});

module.exports = mongoose.model(
  "EmpowermentOrganization",
  empowermentOrganizationSchema
);
