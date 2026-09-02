const mongoose = require("mongoose");

const loginSecurityEventSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    identifier: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    outcome: {
      type: String,
      enum: ["SUCCESS", "FAILED", "REVOKED"],
      required: true,
      index: true,
    },
    // These defaults deliberately make pre-existing login rows readable.
    eventType: {
      type: String,
      enum: ["LOGIN_SUCCESS", "LOGIN_FAILED", "SESSION_REVOKED"],
      default: "LOGIN_SUCCESS",
      index: true,
    },
    severity: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
      default: "LOW",
      index: true,
    },
    workflowStatus: {
      type: String,
      enum: ["OPEN", "ACKNOWLEDGED", "RESOLVED"],
      default: "OPEN",
      index: true,
    },
    acknowledgedAt: { type: Date, default: null },
    acknowledgedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    investigationNote: { type: String, trim: true, maxlength: 1000, default: "" },
    ipAddress: {
      type: String,
      default: "",
      trim: true,
    },
    userAgent: {
      type: String,
      default: "",
      trim: true,
      maxlength: 1000,
    },
    sessionReference: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
  },
  { timestamps: true }
);

loginSecurityEventSchema.index({ user: 1, createdAt: -1 });
loginSecurityEventSchema.index({ createdAt: -1 });
loginSecurityEventSchema.index({ workflowStatus: 1, createdAt: -1 });

module.exports = mongoose.model("LoginSecurityEvent", loginSecurityEventSchema);