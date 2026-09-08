const mongoose = require("mongoose");

const transactionEmailDeliverySchema = new mongoose.Schema(
  {
    eventKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    reference: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    recipientUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    recipientEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    serviceType: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    direction: {
      type: String,
      enum: ["DEBIT", "CREDIT"],
      required: true,
    },
    transactionStatus: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    deliveryStatus: {
      type: String,
      enum: ["PROCESSING", "SENT", "FAILED", "SKIPPED"],
      default: "PROCESSING",
      index: true,
    },
    attempts: {
      type: Number,
      default: 1,
      min: 1,
    },
    nextAttemptAt: {
      type: Date,
      default: null,
      index: true,
    },
    processingStartedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      select: false,
    },
    providerMessageId: {
      type: String,
      default: null,
      trim: true,
    },
    failureReason: {
      type: String,
      default: "",
      trim: true,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

transactionEmailDeliverySchema.index({
  reference: 1,
  recipientEmail: 1,
  transactionStatus: 1,
});

transactionEmailDeliverySchema.index({
  deliveryStatus: 1,
  nextAttemptAt: 1,
});

module.exports = mongoose.model(
  "TransactionEmailDelivery",
  transactionEmailDeliverySchema
);