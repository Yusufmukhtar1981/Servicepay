const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  shipmentId: { type: mongoose.Schema.Types.ObjectId, ref: "InterstateShipment", required: true, unique: true },
  otpHash: { type: String, required: true, select: false },
  expiresAt: { type: Date, required: true }, attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 5 }, lastSentAt: { type: Date, default: Date.now },
  resendCount: { type: Number, default: 0 },
  providerMessageId: { type: String, default: "", trim: true },
  verifiedAt: { type: Date, default: null },
}, { timestamps: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model("ShipmentDeliveryOtp", schema);