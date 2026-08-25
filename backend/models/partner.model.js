const mongoose = require('mongoose');

const partnerSchema = new mongoose.Schema(
  {
    businessName: {
      type: String,
      required: true,
      trim: true,
    },

    contactName: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
    },

    phone: {
      type: String,
      trim: true,
      default: '',
    },

    apiKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    apiSecretHash: {
      type: String,
      required: true,
      select: false,
    },

    initialCredentialDeliveryPending: {
      type: Boolean,
      default: false,
    },

    status: {
      type: String,
      enum: ['ACTIVE', 'SUSPENDED', 'REVOKED'],
      default: 'ACTIVE',
      index: true,
    },

    permissions: {
      type: [String],
      default: [],
    },

    environment: {
      type: String,
      enum: ["LIVE"],
      default: "LIVE",
    },

    perTransactionLimit: {
      type: Number,
      default: null,
      min: 0,
    },

    walletBalance: {
      type: Number,
      default: 0,
      min: 0,
    },

    dailyLimit: {
      type: Number,
      default: 1000000,
      min: 0,
    },

    dailySpent: {
      type: Number,
      default: 0,
      min: 0,
    },

    dailySpentDate: {
      type: String,
      default: '',
    },

    lastUsedAt: {
      type: Date,
      default: null,
    },

    approvedAt: {
      type: Date,
      default: null,
    },

    lastRequestAt: {
      type: Date,
      default: null,
    },

    failedRequestCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports =
  mongoose.models.Partner ||
  mongoose.model('Partner', partnerSchema);
