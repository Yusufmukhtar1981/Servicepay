const { mongoose, money, immutableSchema } = require("./edupayModelUtils");
const repaymentSchema = new mongoose.Schema({
  parent: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  child: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayChild", required: true, index: true },
  plan: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayPlan", required: true, index: true },
  settlement: { type: mongoose.Schema.Types.ObjectId, ref: "EduPaySettlement", required: true, unique: true },
  principal: { ...money(0), required: true, immutable: true },
  serviceCharge: { ...money(0), required: true, immutable: true },
  totalAmount: { ...money(0), required: true, immutable: true },
  amountPaid: money(0),
  amountRemaining: money(0),
  dueDate: Date,
  nextPaymentAt: Date,
  status: { type: String, enum: ["ACTIVE", "PARTIALLY_PAID", "PAID", "OVERDUE", "RESTRUCTURED", "CANCELLED"], default: "ACTIVE", index: true },
  reversalSettlement: { type: mongoose.Schema.Types.ObjectId, ref: "EduPaySettlement", default: null },
  reversedUnpaidAmount: money(0),
}, { timestamps: true });
repaymentSchema.index({ parent: 1, status: 1 });
const transactionSchema = immutableSchema({
  repayment: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayRepayment", required: true, immutable: true, index: true },
  parent: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  amount: { ...money(0), required: true, immutable: true },
  reference: { type: String, required: true, unique: true, immutable: true },
  idempotencyKey: { type: String, required: true, unique: true, immutable: true },
  intentHash: { type: String, required: true, immutable: true },
  walletLedgerEntry: { type: mongoose.Schema.Types.ObjectId, ref: "LedgerEntry", default: null, immutable: true },
  status: { type: String, enum: ["SUCCESS", "FAILED", "REVERSED"], default: "SUCCESS", immutable: true },
});
module.exports = {
  EduPayRepayment: mongoose.model("EduPayRepayment", repaymentSchema),
  EduPayRepaymentTransaction: mongoose.model("EduPayRepaymentTransaction", transactionSchema),
};