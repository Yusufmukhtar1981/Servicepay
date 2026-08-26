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
           "AMANA_REQUEST_REVIEWED",
           "AMANA_INFORMATION_REQUESTED",
           "AMANA_PROVIDER_UPDATED",
           "AMANA_PROVIDER_VERIFIED",
           "AMANA_REQUEST_APPROVED",
           "AMANA_REQUEST_REJECTED",
           "AMANA_FUNDING_RECORDED",
           "AMANA_PROVIDER_PAYMENT_RECORDED",
           "AMANA_FULFILMENT_PROOF_ADDED",
           "AMANA_REQUEST_COMPLETED",
           "AMANA_REQUEST_CANCELLED",
           "FINTECH_CASE_CREATED",
           "FINTECH_CASE_UPDATED",
           "RISK_ALERT_CREATED",
           "RISK_ALERT_UPDATED",
           "SCHEDULED_PAYMENT_CREATED",
           "SCHEDULED_PAYMENT_EXECUTION_REFUSED",
           "SCHEDULED_PAYMENT_UPDATED",
            "SOLAR_PACKAGE_CREATED",
            "SOLAR_PACKAGE_UPDATED",
            "SOLAR_PACKAGE_DELETED",
            "SOLAR_SETTINGS_UPDATED",
            "SOLAR_APPLICATION_STATUS_UPDATED",
            "SOLAR_APPLICATION_APPROVED",
            "SOLAR_RECOVERY_RECORDED",
             "SOLAR_OFFICER_CREATED",
             "SOLAR_OFFICER_STATUS_UPDATED",
             "SOLAR_CUSTOMER_ASSIGNED",
             "SOLAR_CUSTOMER_REASSIGNED",
             "SOLAR_OFFICER_VERIFICATION_RECORDED",
             "SOLAR_OFFICER_RECOMMENDATION_RECORDED",
             "SOLAR_OFFICER_HANDOVER_RECORDED",
             "SOLAR_OFFICER_FOLLOW_UP_RECORDED",
             "SOLAR_OFFICER_RECOVERY_RECOMMENDATION",
             "SOLAR_OFFICER_COMMISSION_CREATED",
             "SOLAR_OFFICER_COMMISSION_REVERSED",
             "SOLAR_OFFICER_WITHDRAWAL_REQUESTED",
             "SOLAR_OFFICER_WITHDRAWAL_APPROVED",
             "SOLAR_OFFICER_WITHDRAWAL_REJECTED",
             "SOLAR_OFFICER_WITHDRAWAL_PAID",
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

// Audit rows are evidence, not mutable operational records.
const denyAuditMutation = function () {
  throw new Error("Admin audit logs are immutable and cannot be modified or deleted.");
};
adminAuditLogSchema.pre("save", function () {
  if (!this.isNew) denyAuditMutation();
});
["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "findOneAndReplace",
  "deleteOne", "deleteMany", "findOneAndDelete", "bulkWrite"].forEach((operation) => {
  adminAuditLogSchema.pre(operation, { document: false, query: true }, denyAuditMutation);
});
adminAuditLogSchema.pre("deleteOne", { document: true, query: false }, denyAuditMutation);

module.exports = mongoose.model(
  "AdminAuditLog",
  adminAuditLogSchema
);