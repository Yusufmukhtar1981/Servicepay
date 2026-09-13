const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  businessPartner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "BusinessPartnerProfile",
    required: true,
    index: true,
  },
  period: {
    type: String,
    enum: ["DAILY", "WEEKLY", "MONTHLY"],
    required: true,
  },
  metric: {
    type: String,
    enum: ["ACTIVE_CUSTOMERS", "TRANSACTION_COUNT", "TRANSACTION_VALUE"],
    required: true,
  },
  target: { type: Number, required: true, min: 0 },
  effectiveFrom: { type: Date, default: Date.now },
  effectiveTo: { type: Date, default: null },
  status: { type: String, enum: ["ACTIVE", "DISABLED"], default: "ACTIVE" },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

schema.index({ businessPartner: 1, period: 1, metric: 1, effectiveFrom: -1 });

module.exports = mongoose.model("BusinessPartnerTarget", schema);