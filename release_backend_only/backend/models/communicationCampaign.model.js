const mongoose = require("mongoose");

const communicationCampaignSchema = new mongoose.Schema(
  {
    channel: {
      type: String,
      enum: ["EMAIL", "IN_APP"],
      required: true,
      index: true,
    },
    kind: {
      type: String,
      enum: ["TEST", "BROADCAST"],
      required: true,
    },
    subject: { type: String, trim: true, maxlength: 160 },
    title: { type: String, trim: true, maxlength: 160 },
    message: { type: String, required: true, trim: true, maxlength: 10000 },
    audience: {
      kind: { type: String, required: true },
      role: { type: String, default: null },
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    idempotencyKey: { type: String, trim: true, default: null },
    status: {
      type: String,
      enum: ["PROCESSING", "COMPLETED", "COMPLETED_WITH_ERRORS"],
      default: "PROCESSING",
    },
    recipientCount: { type: Number, default: 0 },
    sentCount: { type: Number, default: 0 },
    deliveredCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    skippedCount: { type: Number, default: 0 },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

communicationCampaignSchema.index(
  { channel: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: "string" } },
  }
);
communicationCampaignSchema.index({ channel: 1, createdAt: -1 });

module.exports = mongoose.model(
  "CommunicationCampaign",
  communicationCampaignSchema
);