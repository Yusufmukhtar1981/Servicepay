const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  eventKey: { type: String, required: true, immutable: true },
  transactionId: { type: mongoose.Schema.Types.ObjectId, default: null, immutable: true },
  commissionType: { type: String, required: true, immutable: true },
  token: { type: String, required: true, immutable: true },
  commission: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessPartnerCommission", default: null },
  leaseExpiresAt: { type: Date, required: true, index: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: true });

// Reservations independently protect both idempotency dimensions. This is
// deliberately outside caller-owned transactions so a loser never poisons
// its parent session with a duplicate-key abort.
schema.index({ eventKey: 1 }, { unique: true });
schema.index(
  { transactionId: 1, commissionType: 1 },
  { unique: true, partialFilterExpression: { transactionId: { $type: "objectId" } } }
);

module.exports = mongoose.model("BusinessPartnerCommissionReservation", schema);