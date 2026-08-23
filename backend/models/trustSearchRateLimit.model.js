const mongoose = require("mongoose");

const trustSearchRateLimitSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    bucket: {
      type: Number,
      required: true,
      index: true,
    },
    count: {
      type: Number,
      default: 0,
      min: 0,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
  },
  {
    timestamps: true,
  }
);

trustSearchRateLimitSchema.index(
  { user: 1, bucket: 1 },
  { unique: true }
);

module.exports =
  mongoose.models.TrustSearchRateLimit ||
  mongoose.model(
    "TrustSearchRateLimit",
    trustSearchRateLimitSchema
  );