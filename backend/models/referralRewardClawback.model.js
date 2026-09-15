const mongoose = require("mongoose");

const referralRewardClawbackSchema = new mongoose.Schema(
  {
    claim: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ReferralRewardClaim",
      required: true,
      unique: true,
      immutable: true,
      index: true,
    },
    referredCustomer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      immutable: true,
      index: true,
    },
    referrer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
      index: true,
    },
    amount: { type: Number, required: true, immutable: true, min: 2000, max: 2000 },
    category: {
      type: String,
      enum: ["DATA", "DELIVERY", "MARKETPLACE"],
      required: true,
      immutable: true,
    },
    sourceType: { type: String, enum: ["DATA", "DELIVERY", "MARKETPLACE"], required: true, immutable: true },
    sourceId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
    transaction: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction", required: true, immutable: true },
    ledgerEntry: { type: mongoose.Schema.Types.ObjectId, ref: "LedgerEntry", required: true, immutable: true },
    ledgerReference: { type: String, required: true, immutable: true, trim: true },
    reason: { type: String, required: true, immutable: true, trim: true },
    reversedAt: { type: Date, default: Date.now, immutable: true },
  },
  { timestamps: true, versionKey: false }
);

const denyMutation = function () {
  throw new Error("Referral reward clawbacks are immutable and cannot be modified or deleted.");
};

referralRewardClawbackSchema.pre("save", function () {
  if (!this.isNew) denyMutation();
});
[
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
  "replaceOne",
  "findOneAndReplace",
  "deleteOne",
  "deleteMany",
  "findOneAndDelete",
  "bulkWrite",
].forEach((operation) => {
  referralRewardClawbackSchema.pre(operation, { document: false, query: true }, denyMutation);
});
referralRewardClawbackSchema.pre("deleteOne", { document: true, query: false }, denyMutation);

module.exports = mongoose.model("ReferralRewardClawback", referralRewardClawbackSchema);