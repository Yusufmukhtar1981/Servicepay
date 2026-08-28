const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  businessPartner: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessPartnerProfile", required: true, index: true, immutable: true },
  application: { type: mongoose.Schema.Types.ObjectId, required: true, index: true, immutable: true },
  sourceType: { type: String, enum: ["SOLAR", "PHONE"], required: true, immutable: true },
  // Reversal entries are negative compensating accounting rows.
  amount: { type: Number, required: true, immutable: true },
  eventKey: { type: String, required: true, unique: true, immutable: true },
  status: { type: String, enum: ["PENDING", "EARNED", "PAID", "REVERSED"], default: "PENDING", index: true },
  earnedAt: { type: Date, default: null },
  paidAt: { type: Date, default: null },
  reversalOf: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessPartnerCommission", default: null, immutable: true },
  reversalReason: { type: String, trim: true, maxlength: 500, default: "" },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
}, { timestamps: true });
schema.index({ businessPartner: 1, createdAt: -1 });
schema.index({ reversalOf: 1 }, { unique: true, sparse: true });
// Commission rows are an append-only accounting trail. Reversal is a new row.
schema.pre("save", function () { if (!this.isNew) throw new Error("Business Partner commissions are append-only."); });
["updateOne", "updateMany", "findOneAndUpdate", "findByIdAndUpdate", "deleteOne", "deleteMany", "findOneAndDelete", "findByIdAndDelete"].forEach(op => schema.pre(op, function () { throw new Error("Business Partner commissions are append-only."); }));
module.exports = mongoose.model("BusinessPartnerCommission", schema);