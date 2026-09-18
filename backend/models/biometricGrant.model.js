const mongoose = require("mongoose");

const biometricGrantSchema = new mongoose.Schema({
  grantHash: { type: String, required: true, unique: true, select: false },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  deviceId: { type: String, required: true },
  operation: { type: String, required: true },
  intentHash: { type: String, required: true },
  idempotencyKey: { type: String, required: true },
  expiresAt: { type: Date, required: true, index: true },
}, { timestamps: true });

module.exports = mongoose.model("BiometricGrant", biometricGrantSchema);