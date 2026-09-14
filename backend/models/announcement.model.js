const mongoose = require("mongoose");

const announcementSchema =
  new mongoose.Schema(
    {
      title: {
        type: String,
        trim: true,
        default: "Servicepay Update",
        maxlength: 100,
      },

      message: {
        type: String,
        trim: true,
        default: "",
        maxlength: 500,
      },

      type: {
        type: String,
        enum: ["INFO", "SUCCESS", "WARNING", "CRITICAL", "PROMOTION", "MAINTENANCE", "SECURITY"],
        default: "INFO",
        index: true,
      },

      style: {
        type: String,
        enum: ["POPUP", "BANNER", "BOTH"],
        default: "BANNER",
      },

      audience: {
        type: String,
        enum: ["ALL", "ACTIVE", "KYC_PENDING", "KYC_VERIFIED", "SELECTED_CUSTOMERS", "SELECTED_ROLE"],
        default: "ALL",
        index: true,
      },

      // These fields are intentionally admin-only. Customer serializers must
      // never return either the selected IDs or the selected role.
      selectedCustomerIds: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      }],
      selectedRole: {
        type: String,
        trim: true,
        uppercase: true,
        default: null,
      },

      visibility: {
        type: String,
        enum: ["ONCE", "EVERY_LOGIN", "UNTIL_DISMISSED", "MANDATORY"],
        default: "ONCE",
      },

      imageUrl: {
        type: String,
        trim: true,
        maxlength: 2048,
        default: null,
      },
      cta: {
        label: { type: String, trim: true, maxlength: 80, default: null },
        url: { type: String, trim: true, maxlength: 2048, default: null },
      },
      startAt: {
        type: Date,
        default: null,
        index: true,
      },
      endAt: {
        type: Date,
        default: null,
        index: true,
      },
      priority: {
        type: Number,
        default: 0,
        min: -2147483648,
        max: 2147483647,
        validate: {
          validator: Number.isInteger,
          message: "Priority must be an integer.",
        },
      },

      isActive: {
        type: Boolean,
        default: false,
      },

      // Only records created by the retained singular API may be returned by
      // that API. New plural records are explicitly marked false so a future
      // field addition cannot accidentally widen the legacy response.
      legacyEligible: {
        type: Boolean,
        default: false,
        index: true,
      },

      updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },

      metrics: {
        views: { type: Number, default: 0, min: 0 },
        acknowledgements: { type: Number, default: 0, min: 0 },
        dismissals: { type: Number, default: 0, min: 0 },
        clicks: { type: Number, default: 0, min: 0 },
      },
    },
    {
      timestamps: true,
    }
  );

module.exports = mongoose.model(
  "Announcement",
  announcementSchema
);