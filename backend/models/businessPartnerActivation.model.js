const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  purpose: { type: String, enum: ["CUSTOMER_ACTIVATION"], default: "CUSTOMER_ACTIVATION", immutable: true },
  channel: { type: String, enum: ["PHONE"], default: "PHONE", immutable: true },
  otpHash: { type: String, required: true, select: false },
  expiresAt: { type: Date, required: true },
  attempts: { type: Number, default: 0, min: 0 },
  maxAttempts: { type: Number, default: 5, min: 1, immutable: true },
  consumedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { timestamps: true });

schema.index({ user: 1, purpose: 1, channel: 1 }, { unique: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model("BusinessPartnerActivation", schema);