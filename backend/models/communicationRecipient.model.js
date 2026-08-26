const mongoose = require("mongoose");

const communicationRecipientSchema = new mongoose.Schema(
  {
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CommunicationCampaign",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    recipientKey: { type: String, required: true },
    email: { type: String, default: null, trim: true, lowercase: true },
    outcome: {
      type: String,
      enum: ["PENDING", "PROCESSING", "SENT", "DELIVERED", "FAILED", "SKIPPED"],
      required: true,
    },
    providerMessageId: { type: String, default: null },
    error: { type: String, default: null, maxlength: 1000 },
  },
  { timestamps: true }
);

communicationRecipientSchema.index(
  { campaignId: 1, recipientKey: 1 },
  { unique: true }
);
communicationRecipientSchema.index({ campaignId: 1, createdAt: -1 });
communicationRecipientSchema.index({ campaignId: 1, outcome: 1, _id: 1 });

module.exports = mongoose.model(
  "CommunicationRecipient",
  communicationRecipientSchema
);