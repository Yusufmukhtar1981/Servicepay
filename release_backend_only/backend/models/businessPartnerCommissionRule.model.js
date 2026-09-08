const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  sourceType: { type: String, enum: ["SOLAR", "PHONE_FINANCING"], required: true, index: true },
  version: { type: Number, required: true, min: 1 },
  calculation: { type: String, enum: ["PERCENT", "FIXED"], required: true },
  value: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ["ACTIVE", "DISABLED"], default: "ACTIVE", index: true },
  effectiveFrom: { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });
schema.index({ sourceType: 1, version: 1 }, { unique: true });
module.exports = mongoose.model("BusinessPartnerCommissionRule", schema);