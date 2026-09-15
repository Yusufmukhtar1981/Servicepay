const mongoose = require("mongoose");

const referralRewardClaimSchema = new mongoose.Schema(
  {
    referredCustomer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
      immutable: true,
    },
    referrer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
      immutable: true,
    },
    category: {
      type: String,
      enum: ["DATA", "DELIVERY", "MARKETPLACE"],
      required: true,
      immutable: true,
    },
    amount: {
      type: Number,
      required: true,
      immutable: true,
      default: 2000,
      min: 2000,
      max: 2000,
    },
    status: {
      type: String,
      enum: ["AWARDED"],
      default: "AWARDED",
      immutable: true,
    },
    qualificationCount: {
      type: Number,
      required: true,
      immutable: true,
      default: 10,
      min: 10,
      max: 10,
    },
    evidence: {
      type: [
        {
          category: { type: String, immutable: true },
          reference: { type: String, immutable: true },
          sourceId: { type: mongoose.Schema.Types.ObjectId, immutable: true },
          amount: { type: Number, immutable: true },
          qualifiedAt: { type: Date, immutable: true },
        },
      ],
      required: true,
      immutable: true,
    },
    transaction: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transaction",
      required: true,
      immutable: true,
    },
    ledgerEntry: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LedgerEntry",
      required: true,
      immutable: true,
    },
    ledgerReference: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
    },
    awardedAt: {
      type: Date,
      default: Date.now,
      immutable: true,
    },
  },
  { timestamps: true, versionKey: false }
);

referralRewardClaimSchema.index({ referrer: 1, createdAt: -1 });

const denyMutation = function () {
  throw new Error("Referral reward claims are immutable and cannot be modified or deleted.");
};

referralRewardClaimSchema.pre("save", function () {
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
  referralRewardClaimSchema.pre(
    operation,
    { document: false, query: true },
    denyMutation
  );
});

referralRewardClaimSchema.pre(
  "deleteOne",
  { document: true, query: false },
  denyMutation
);

module.exports = mongoose.model("ReferralRewardClaim", referralRewardClaimSchema);