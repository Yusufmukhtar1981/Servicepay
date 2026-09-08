const mongoose = require("mongoose");

const trustProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    servicePayId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      match: /^SPT-[A-Z0-9]{12}$/,
      index: true,
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    displayNameNormalized: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    businessName: {
      type: String,
      default: "",
      trim: true,
      maxlength: 120,
    },
    businessNameNormalized: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    profilePhotoUrl: {
      type: String,
      default: "",
      trim: true,
    },
    identityVerified: {
      type: Boolean,
      default: false,
      index: true,
    },
    businessVerified: {
      type: Boolean,
      default: false,
      index: true,
    },
    accountOwnershipVerified: {
      type: Boolean,
      default: false,
      index: true,
    },
    memberSince: {
      type: Date,
      required: true,
    },
    protectedTransactionsCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    protectedTradeVolume: {
      type: Number,
      default: 0,
      min: 0,
    },
    completionRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    disputesCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    resolvedDisputesCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    trustScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    trustLevel: {
      type: String,
      enum: [
        "NEW",
        "BASIC",
        "VERIFIED",
        "TRUSTED",
        "HIGHLY_TRUSTED",
        "RESTRICTED",
      ],
      default: "NEW",
      index: true,
    },
    restricted: {
      type: Boolean,
      default: false,
      index: true,
    },
    restrictionReason: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
      select: false,
    },
    discoverable: {
      type: Boolean,
      default: false,
      index: true,
    },
    lastCalculatedAt: {
      type: Date,
      default: null,
    },
    scoreInputs: {
      accountActive: { type: Boolean, default: false },
      accountAgeMonths: { type: Number, default: 0, min: 0 },
      kycVerified: { type: Boolean, default: false },
      kycTier: { type: String, default: "" },
      successfulIdentityVerifications: {
        type: Number,
        default: 0,
        min: 0,
      },
      businessVerified: { type: Boolean, default: false },
      accountOwnershipVerified: { type: Boolean, default: false },
    },
  },
  {
    timestamps: true,
  }
);

trustProfileSchema.index({
  discoverable: 1,
  restricted: 1,
  businessNameNormalized: 1,
});

trustProfileSchema.index({
  discoverable: 1,
  restricted: 1,
  displayNameNormalized: 1,
});

module.exports =
  mongoose.models.TrustProfile ||
  mongoose.model("TrustProfile", trustProfileSchema);