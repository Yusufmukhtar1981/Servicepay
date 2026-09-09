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
        "STATE_GOVERNMENT",
        "LOCAL_GOVERNMENT",
        "POLITICIAN",
        "NGO",
        "FOUNDATION",
        "COMPANY",
        "COOPERATIVE",
        "INDIVIDUAL",
        "OTHER",
      ],
      required: true,
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

    status: {
      type: String,
      enum: ["PENDING", "ACTIVE", "SUSPENDED", "REJECTED"],
      default: "PENDING",
      index: true,
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

module.exports = mongoose.model(
  "EmpowermentOrganization",
  empowermentOrganizationSchema
);
