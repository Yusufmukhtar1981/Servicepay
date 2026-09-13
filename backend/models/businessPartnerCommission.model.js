const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  businessPartner: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessPartnerProfile", required: true, index: true, immutable: true },
  application: { type: mongoose.Schema.Types.ObjectId, default: null, index: true, immutable: true },
  transactionId: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction", default: null, index: true, immutable: true },
  transactionReference: { type: String, trim: true, default: "", immutable: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true, immutable: true },
  officerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true, immutable: true },
  sourceType: { type: String, required: true, trim: true, uppercase: true, immutable: true, index: true },
  commissionType: {
    type: String,
    enum: ["DIRECT_CUSTOMER_COMMISSION", "OFFICER_COMMISSION", "PARTNER_OVERRIDE_COMMISSION", "PERFORMANCE_BONUS", "CAMPAIGN_BONUS"],
    default: "DIRECT_CUSTOMER_COMMISSION",
    immutable: true,
  },
  commissionRate: { type: Number, default: 0, min: 0, immutable: true },
  commissionRule: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessPartnerCommissionRule", default: null, index: true, immutable: true },
  bonusRule: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessPartnerBonusRule", default: null, index: true, immutable: true },
  bonusMetric: { type: String, default: null, immutable: true },
  bonusSourceType: { type: String, default: null, immutable: true },
  bonusPeriodStart: { type: Date, default: null, immutable: true },
  bonusPeriodEnd: { type: Date, default: null, immutable: true },
  transactionAmount: { type: Number, default: 0, min: 0, immutable: true },
  // Reversal entries are negative compensating accounting rows.
  amount: { type: Number, required: true, immutable: true },
  eventKey: { type: String, required: true, unique: true, immutable: true },
  status: { type: String, enum: ["PENDING", "AVAILABLE", "EARNED", "PAID", "REVERSED", "CANCELLED"], default: "PENDING", index: true },
  earnedAt: { type: Date, default: null },
  paidAt: { type: Date, default: null },
  // Normal commissions omit this field. A reversal references its original
  // commission explicitly; omitting the field keeps legacy null records
  // compatible with the ObjectId-only partial index below.
  reversalOf: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessPartnerCommission", default: undefined, immutable: true },
  reversalReason: { type: String, trim: true, maxlength: 500, default: "" },
  settledAt: { type: Date, default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
}, { timestamps: true });
schema.index({ businessPartner: 1, createdAt: -1 });
schema.index(
  { reversalOf: 1 },
  { unique: true, partialFilterExpression: { reversalOf: { $type: "objectId" } } }
);
schema.index(
  { transactionId: 1, commissionType: 1 },
  { unique: true, partialFilterExpression: { transactionId: { $type: "objectId" }, reversalOf: null } }
);
// Commission rows are an append-only accounting trail. Reversal is a new row.
schema.pre("save", function () { if (!this.isNew) throw new Error("Business Partner commissions are append-only."); });
["updateOne", "updateMany", "findOneAndUpdate", "findByIdAndUpdate", "deleteOne", "deleteMany", "findOneAndDelete", "findByIdAndDelete"].forEach(op => schema.pre(op, function () { throw new Error("Business Partner commissions are append-only."); }));
module.exports = mongoose.model("BusinessPartnerCommission", schema);