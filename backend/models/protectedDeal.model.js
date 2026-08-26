const mongoose = require("mongoose");

const eventSchema = new mongoose.Schema({
  type: { type: String, required: true, trim: true, maxlength: 60 },
  fromStatus: { type: String, default: "", trim: true },
  toStatus: { type: String, required: true, trim: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  note: { type: String, default: "", trim: true, maxlength: 1000 },
  idempotencyKey: { type: String, required: true, trim: true },
  createdAt: { type: Date, default: Date.now, immutable: true },
}, { _id: true });

const protectedDealSchema = new mongoose.Schema({
  reference: { type: String, required: true, unique: true, index: true, trim: true },
  buyer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  seller: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  amount: { type: Number, required: true, min: 0.01 },
  currency: { type: String, default: "NGN", enum: ["NGN"] },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, default: "", trim: true, maxlength: 2000 },
  status: {
    type: String,
    enum: ["CREATED", "FUNDED", "IN_PROGRESS", "DELIVERED", "COMPLETED", "DISPUTED", "REFUNDED", "CANCELLED"],
    default: "CREATED",
    index: true,
  },
  // Undefined until funded so the sparse unique index does not reserve a shared empty value.
  fundingIdempotencyKey: { type: String, default: undefined, trim: true, unique: true, sparse: true },
  deadline: { type: Date, default: null },
  walletHold: { type: mongoose.Schema.Types.ObjectId, ref: "WalletHold", default: null },
  transaction: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction", default: null },
  events: { type: [eventSchema], default: [] },
}, { timestamps: true, optimisticConcurrency: true });

protectedDealSchema.index({ buyer: 1, createdAt: -1 });
protectedDealSchema.index({ seller: 1, createdAt: -1 });
protectedDealSchema.index({ status: 1, createdAt: -1 });
protectedDealSchema.index({ "events.idempotencyKey": 1 }, { unique: true, sparse: true });

// Lifecycle evidence is append-only. Operational transitions may only append it.
protectedDealSchema.pre(["updateOne", "updateMany", "findOneAndUpdate"], function () {
  const update = this.getUpdate() || {};
  const touchesEvents = (value) => value && Object.prototype.hasOwnProperty.call(value, "events");
  if (touchesEvents(update.$set) || touchesEvents(update.$unset) || touchesEvents(update.$pull) ||
      touchesEvents(update.$pop) || touchesEvents(update.$addToSet)) {
    throw new Error("Protected deal lifecycle history is append-only.");
  }
});

module.exports = mongoose.models.ProtectedDeal || mongoose.model("ProtectedDeal", protectedDealSchema);