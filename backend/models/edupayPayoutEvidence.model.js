const { mongoose, immutableSchema } = require("./edupayModelUtils");
const schema = immutableSchema({
  settlement: { type: mongoose.Schema.Types.ObjectId, ref: "EduPaySettlement", required: true, immutable: true, index: true },
  coreTransaction: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction", default: null },
  providerReference: { type: String, required: true, immutable: true },
  providerId: { type: String, default: null, immutable: true },
  normalizedStatus: { type: String, enum: ["SUCCESSFUL", "FAILED", "REVERSED", "PENDING_REVIEW"], required: true, immutable: true },
  amount: { type: Number, required: true, immutable: true },
  currency: { type: String, required: true, immutable: true },
  eventType: { type: String, required: true, immutable: true },
  payloadDigest: { type: String, required: true, immutable: true },
  receivedAt: { type: Date, default: Date.now, immutable: true },
  source: { type: String, enum: ["WEBHOOK", "REQUERY"], required: true, immutable: true },
}, { timestamps: true, mutablePaths: ["coreTransaction"] });
schema.index({ settlement: 1, payloadDigest: 1 }, { unique: true });
schema.index({ providerReference: 1, eventType: 1 }, { unique: true });
schema.pre(["findOneAndUpdate", "updateOne"], async function () {
  const update = this.getUpdate() || {};
  if (!Object.prototype.hasOwnProperty.call(update.$set || {}, "coreTransaction")) return;
  let lookup = this.model.findOne(this.getQuery()).select("coreTransaction"); if (this.getOptions().session) lookup = lookup.session(this.getOptions().session); const current = await lookup.lean();
  if (current?.coreTransaction) throw new Error("Payout evidence transaction link is immutable.");
});
module.exports = mongoose.model("EduPayPayoutEvidence", schema);