const mongoose = require("mongoose");

const adminAuditLogSchema =
  new mongoose.Schema(
    {
      actorId: {
        type:
          mongoose.Schema.Types
            .ObjectId,
        ref: "User",
        required: true,
        index: true,
      },

      actorRole: {
        type: String,
        trim: true,
        uppercase: true,
        required: true,
      },

      actorName: {
        type: String,
        trim: true,
        default: "",
      },

      targetUserId: {
        type:
          mongoose.Schema.Types
            .ObjectId,
        ref: "User",
        default: null,
        index: true,
      },

      targetUserName: {
        type: String,
        trim: true,
        default: "",
      },

      action: {
        type: String,
        trim: true,
        uppercase: true,
        required: true,
        index: true,
        enum: [
          "USER_PROFILE_UPDATED",
          "USER_STATUS_UPDATED",
          "USER_ROLE_UPDATED",
          "TRANSACTION_PIN_RESET",
          "PASSWORD_RESET_REQUESTED",
          "WALLET_CREDITED",
          "WALLET_DEBITED",
          "USER_CREATED",
          "KYC_STATUS_UPDATED",
          "SERVICE_SETTING_UPDATED",
          "SYSTEM_SETTING_UPDATED",
          "FINTECH_OPERATION",
        ],
      },

      reason: {
        type: String,
        trim: true,
        required: true,
        maxlength: 500,
      },

      previousData: {
        type:
          mongoose.Schema.Types.Mixed,
        default: null,
      },

      newData: {
        type:
          mongoose.Schema.Types.Mixed,
        default: null,
      },

      metadata: {
        type:
          mongoose.Schema.Types.Mixed,
        default: null,
      },

      ipAddress: {
        type: String,
        trim: true,
        default: "",
      },

      userAgent: {
        type: String,
        trim: true,
        default: "",
      },

      requestMethod: {
        type: String,
        trim: true,
        uppercase: true,
        default: "",
      },

      requestPath: {
        type: String,
        trim: true,
        default: "",
      },

      status: {
        type: String,
        enum: [
          "SUCCESSFUL",
          "FAILED",
        ],
        default: "SUCCESSFUL",
        index: true,
      },

      failureReason: {
        type: String,
        trim: true,
        default: null,
      },
    },
    {
      timestamps: true,
    }
  );

adminAuditLogSchema.index({
  targetUserId: 1,
  createdAt: -1,
});

adminAuditLogSchema.index({
  actorId: 1,
  createdAt: -1,
});

adminAuditLogSchema.index({
  action: 1,
  createdAt: -1,
});

adminAuditLogSchema.index({
  createdAt: -1,
});

module.exports = mongoose.model(
  "AdminAuditLog",
  adminAuditLogSchema
);