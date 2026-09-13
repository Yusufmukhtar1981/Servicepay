const mongoose = require("mongoose");

/*
 * A projection of the append-only commission ledger. It is deliberately
 * separate from User.walletBalance and is never a customer-money account.
 * The projection can be rebuilt from BusinessPartnerCommission rows.
 */
const schema = new mongoose.Schema({
  businessPartner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "BusinessPartnerProfile",
    required: true,
    immutable: true,
  },
  available: { type: Number, default: 0, min: 0 },
  pending: { type: Number, default: 0, min: 0 },
  paid: { type: Number, default: 0, min: 0 },
  lifetime: { type: Number, default: 0, min: 0 },
  // Recovery owed after reversing a commission that was already paid.
  recoveryLiability: { type: Number, default: 0, min: 0 },
  // Withdrawals remain an explicit, separately approved workflow.
  withdrawalLocked: { type: Number, default: 0, min: 0 },
  lastLedgerEntryAt: { type: Date, default: null },
}, { timestamps: true });

schema.index({ businessPartner: 1 }, { unique: true });

module.exports = mongoose.model("BusinessPartnerCommissionWallet", schema);