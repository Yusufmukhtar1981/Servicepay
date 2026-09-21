const { mongoose, money, immutableSchema } = require("./edupayModelUtils");
const schema = immutableSchema({
  parent: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true, index: true },
  child: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayChild", required: true, immutable: true, index: true },
  plan: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayPlan", required: true, immutable: true, index: true },
  school: { type: mongoose.Schema.Types.ObjectId, ref: "EduPaySchool", default: null, immutable: true, index: true },
  direction: { type: String, enum: ["CREDIT", "DEBIT"], required: true, immutable: true },
  type: { type: String, enum: ["CONTRIBUTION", "AUTOSAVE", "SPONSOR_CONTRIBUTION", "SETTLEMENT_DEBIT", "REFUND", "REVERSAL", "ADJUSTMENT"], required: true, immutable: true },
  amount: { ...money(0), required: true, min: 0.01, immutable: true },
  openingBalance: { ...money(0), immutable: true },
  closingBalance: { ...money(0), immutable: true },
  reference: { type: String, required: true, unique: true, immutable: true },
  idempotencyKey: { type: String, required: true, unique: true, immutable: true },
  source: { type: String, immutable: true },
  reversalOf: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayLedgerEntry", default: null, immutable: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {}, immutable: true },
});
schema.index({ plan: 1, createdAt: 1 });
schema.index({ school: 1, createdAt: -1 });
module.exports = mongoose.model("EduPayLedgerEntry", schema);