const mongoose = require("mongoose");

const cleanupSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    assetId: {
      type: String,
      required: true,
      trim: true,
    },
    resourceType: {
      type: String,
      enum: ["image", "raw"],
      required: true,
    },
    kind: {
      type: String,
      enum: ["PROVISIONAL", "RETIREMENT"],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "PROCESSING"],
      default: "PENDING",
      index: true,
    },
    attempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    nextAttemptAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    leaseUntil: {
      type: Date,
      default: null,
      index: true,
    },
    lastErrorCategory: {
      type: String,
      default: null,
      maxlength: 80,
    },
  },
  { timestamps: true },
);

cleanupSchema.index(
  { organization: 1, assetId: 1, resourceType: 1, kind: 1 },
  { unique: true },
);

module.exports =
  mongoose.models.OrganizationDocumentCleanup ||
  mongoose.model("OrganizationDocumentCleanup", cleanupSchema);