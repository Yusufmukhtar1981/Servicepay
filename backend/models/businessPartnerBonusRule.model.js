const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 160 },
  metric: { type: String, enum: ["ACTIVE_CUSTOMERS", "TRANSACTION_COUNT", "TRANSACTION_VALUE"], required: true, index: true },
  sourceType: { type: String, enum: ["SOLAR", "PHONE", "PHONE_FINANCING"], default: null, index: true },
  period: { type: String, enum: ["DAILY", "WEEKLY", "MONTHLY"], required: true },
  threshold: { type: Number, required: true, min: 0 },
  bonusAmount: { type: Number, required: true, min: 0 },
  availableMargin: { type: Number, required: true, min: 0 },
  allocatedMargin: { type: Number, default: 0, min: 0 },
  commissionType: { type: String, enum: ["PERFORMANCE_BONUS", "CAMPAIGN_BONUS"], default: "PERFORMANCE_BONUS" },
  businessPartner: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessPartnerProfile", default: null, index: true },
  status: { type: String, enum: ["ACTIVE", "SUSPENDED"], default: "ACTIVE", index: true },
  effectiveFrom: { type: Date, default: Date.now, index: true },
  effectiveTo: { type: Date, default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

module.exports = mongoose.model("BusinessPartnerBonusRule", schema);