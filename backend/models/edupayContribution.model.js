const { mongoose, money, immutableSchema } = require("./edupayModelUtils");
const schema = immutableSchema({
  parent: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true, index: true },
  child: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayChild", required: true, immutable: true, index: true },
  plan: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayPlan", required: true, immutable: true, index: true },
  amount: { ...money(0), required: true, min: 0.01, immutable: true },
  type: { type: String, enum: ["CONTRIBUTION", "AUTOSAVE", "SPONSOR"], required: true, immutable: true },
  status: { type: String, enum: ["PENDING", "SUCCESS", "FAILED", "REVERSED"], default: "SUCCESS", immutable: true, index: true },
  reference: { type: String, required: true, unique: true, immutable: true },
  idempotencyKey: { type: String, required: true, unique: true, immutable: true },
  walletLedgerEntry: { type: mongoose.Schema.Types.ObjectId, ref: "LedgerEntry", default: null, immutable: true },
  transaction: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction", default: null, immutable: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
});
schema.index({ plan: 1, status: 1, createdAt: -1 });
module.exports = mongoose.model("EduPayContribution", schema);