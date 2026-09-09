const mongoose = require("mongoose");

/*
 * This is deliberately separate from the customer wallet ledger: rider
 * commission settlement is not spendable customer-wallet money.
 */
const schema = new mongoose.Schema({
  riderId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  type: {
    type: String,
    required: true,
    enum: ["DELIVERY_EARNING", "ADMIN_CREDIT", "ADMIN_DEBIT", "WITHDRAWAL_RESERVED", "WITHDRAWAL_PAID", "WITHDRAWAL_REVERSAL"],
    index: true,
  },
  direction: { type: String, required: true, enum: ["CREDIT", "DEBIT"] },
  // Rider commission has an available and a withdrawal-reserved sub-ledger.
  balanceAccount: { type: String, enum: ["AVAILABLE", "RESERVED"], default: "AVAILABLE", required: true },
  amount: { type: Number, required: true, min: 0.01 },
  oldBalance: { type: Number, required: true, min: 0 },
  newBalance: { type: Number, required: true, min: 0 },
  reference: { type: String, required: true, unique: true, trim: true },
  withdrawalId: { type: mongoose.Schema.Types.ObjectId, ref: "RiderWithdrawal", default: null, index: true },
  deliveryId: { type: mongoose.Schema.Types.ObjectId, ref: "Delivery", default: null, index: true },
  reason: { type: String, trim: true, default: "" },
  adminId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  adminName: { type: String, trim: true, default: "" },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true, versionKey: false });

schema.index({ riderId: 1, createdAt: -1 });

const immutable = function () {
  throw new Error("Rider wallet ledger entries are immutable and cannot be modified or deleted.");
};
schema.pre("save", function () { if (!this.isNew) immutable(); });
["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "findOneAndReplace", "deleteOne", "deleteMany", "findOneAndDelete", "bulkWrite"]
  .forEach((operation) => schema.pre(operation, { document: false, query: true }, immutable));
schema.pre("deleteOne", { document: true, query: false }, immutable);

module.exports = mongoose.model("RiderWalletLedger", schema);