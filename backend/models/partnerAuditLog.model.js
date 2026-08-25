const mongoose = require("mongoose");

const partnerAuditLogSchema = new mongoose.Schema(
  {
    partner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Partner",
      required: true,
      index: true,
    },
    action: {
      type: String,
      required: true,
      enum: [
        "CREDENTIALS_CREATED",
        "CREDENTIALS_REGENERATED",
        "ACCESS_REVOKED",
        "ACCESS_RESTORED",
        "STATUS_CHANGED",
        "PERMISSIONS_CHANGED",
        "LIMITS_CHANGED",
        "API_REQUEST_FAILED",
      ],
    },
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  { timestamps: true }
);

partnerAuditLogSchema.index({ partner: 1, createdAt: -1 });

module.exports =
  mongoose.models.PartnerAuditLog ||
  mongoose.model("PartnerAuditLog", partnerAuditLogSchema);