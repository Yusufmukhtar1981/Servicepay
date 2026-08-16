const mongoose = require("mongoose");

const appSettingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      default: "GLOBAL_SETTINGS",
      unique: true,
      trim: true,
    },

    services: {
      airtimeEnabled: {
        type: Boolean,
        default: true,
      },

      dataEnabled: {
        type: Boolean,
        default: true,
      },

      electricityEnabled: {
        type: Boolean,
        default: true,
      },

      ninVerificationEnabled: {
        type: Boolean,
        default: true,
      },
    },

    electricity: {
      minimumAmount: {
        type: Number,
        default: 1000,
        min: 0,
      },

      maximumAmount: {
        type: Number,
        default: 200000,
        min: 1,
      },
    },

    platform: {
      maintenanceMode: {
        type: Boolean,
        default: false,
      },
    },

    support: {
      phone: {
        type: String,
        default: "08000000000",
        trim: true,
      },

      email: {
        type: String,
        default: "support@servicepay.ng",
        lowercase: true,
        trim: true,
      },
    },

    updatedBy: {
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
  "AppSettings",
  appSettingsSchema
);
