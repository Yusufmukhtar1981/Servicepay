const mongoose = require("mongoose");

const securewaveWebhookSchema =
  new mongoose.Schema(
    {
      transactionId: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        index: true,
      },

      providerReference: {
        type: String,
        default: null,
        trim: true,
        index: true,
      },

      notificationStatus: {
        type: String,
        default: null,
        trim: true,
      },

      transactionStatus: {
        type: String,
        default: null,
        trim: true,
      },

      transactionType: {
        type: String,
        default: null,
        trim: true,
      },

      accountNumber: {
        type: String,
        default: null,
        trim: true,
        index: true,
      },

      amount: {
        type: Number,
        default: 0,
      },

      fees: {
        type: Number,
        default: 0,
      },

      settlementAmount: {
        type: Number,
        default: 0,
      },

      currency: {
        type: String,
        default: "NGN",
        trim: true,
      },

      status: {
        type: String,
        enum: [
          "RECEIVED",
          "PROCESSING",
          "PROCESSED",
          "FAILED",
          "IGNORED",
        ],
        default: "RECEIVED",
      },

      creditedUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },

      walletCreditedAmount: {
        type: Number,
        default: 0,
      },

      failureReason: {
        type: String,
        default: null,
        trim: true,
      },

      payload: {
        type: mongoose.Schema.Types.Mixed,
        required: true,
      },

      processedAt: {
        type: Date,
        default: null,
      },
    },
    {
      timestamps: true,
    }
  );

module.exports = mongoose.model(
  "SecurewaveWebhook",
  securewaveWebhookSchema
);