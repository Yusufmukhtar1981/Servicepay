const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  key: { type: String, required: true },
  bucket: { type: Number, required: true },
  count: { type: Number, default: 0, min: 0 },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: true });

schema.index({ key: 1, bucket: 1 }, { unique: true });

module.exports = mongoose.models.PrivacyRequestRateLimit ||
  mongoose.model("PrivacyRequestRateLimit", schema);