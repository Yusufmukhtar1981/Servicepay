const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  businessPartner: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessPartnerProfile", required: true, index: true },
  reversal: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessPartnerCommission", required: true, immutable: true, index: true },
  amount: { type: Number, required: true, min: 0, immutable: true },
  eventKey: { type: String, required: true, unique: true, immutable: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
}, { timestamps: true });

schema.index({ reversal: 1, eventKey: 1 }, { unique: true });

module.exports = mongoose.model("BusinessPartnerCommissionRecovery", schema);