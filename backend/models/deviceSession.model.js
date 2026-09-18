const mongoose = require("mongoose");

/*
 * A device session deliberately contains no biometric material or secret.
 * credentialHash is SHA-256(opaque 32-byte credential), and is never returned.
 */
const deviceSessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  deviceId: { type: String, required: true, unique: true, immutable: true },
  // Allocated atomically from 0..4 for new enrollments.  The partial index
  // intentionally ignores legacy documents which do not have this field.
  activeSlot: { type: Number, min: 0, max: 4, default: null },
  credentialHash: { type: String, required: true, select: false },
  previousCredentialHash: { type: String, select: false, default: null },
  familyId: { type: String, required: true, index: true },
  reuseDetectedAt: { type: Date, default: null },
  status: { type: String, enum: ["ACTIVE", "REVOKED", "DISABLED"], default: "ACTIVE", index: true },
  loginEnabled: { type: Boolean, default: true },
  transactionEnabled: { type: Boolean, default: false },
  authTokenVersionAtEnrollment: { type: Number, required: true },
  expiresAt: { type: Date, required: true },
  lastUsedAt: { type: Date, default: null },
  revokedAt: { type: Date, default: null },
}, { timestamps: true, minimize: true });

deviceSessionSchema.index({ userId: 1, status: 1 });
deviceSessionSchema.index(
  { userId: 1, activeSlot: 1 },
  { unique: true, partialFilterExpression: { status: "ACTIVE", activeSlot: { $exists: true } } },
);
deviceSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("DeviceSession", deviceSessionSchema);