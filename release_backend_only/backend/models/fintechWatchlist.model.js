const mongoose = require("mongoose");

const fintechWatchlistSchema = new mongoose.Schema(
  {
    identifierType: {
      type: String,
      enum: ["USER_ID", "PHONE", "EMAIL", "BANK_ACCOUNT", "DEVICE", "PARTNER"],
      required: true,
      index: true,
    },
    identifierValue: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    identifierDisplay: {
      type: String,
      default: "",
      trim: true,
    },
    status: {
      type: String,
      enum: ["WATCHLIST", "BLACKLISTED", "CLEARED"],
      required: true,
      index: true,
    },
    severity: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
      default: "MEDIUM",
    },
    reason: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    notes: {
      type: String,
      default: "",
      trim: true,
      maxlength: 2000,
    },
    expiresAt: {
      type: Date,
      default: null,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    clearedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    clearedAt: {
      type: Date,
      default: null,
    },
    clearReason: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },
  },
  { timestamps: true }
);

fintechWatchlistSchema.index(
  { identifierType: 1, identifierValue: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ["WATCHLIST", "BLACKLISTED"] } },
  }
);

module.exports = mongoose.model("FintechWatchlist", fintechWatchlistSchema);