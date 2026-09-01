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

module.exports = mongoose.model("LoginSecurityEvent", loginSecurityEventSchema);