const mongoose = require("mongoose");

const ledgerEntrySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    direction: {
      type: String,
      enum: ["DEBIT", "CREDIT"],
      required: true,
      index: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 0.01,
    },

    openingBalance: {
      type: Number,
      required: true,
      min: 0,
    },

    closingBalance: {
      type: Number,
      required: true,
      min: 0,
    },

    currency: {
      type: String,
      default: "NGN",
      uppercase: true,
      trim: true,
    },

    service: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    reference: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    idempotencyKey: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },

    transactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transaction",
      default: null,
      index: true,
    },

    relatedUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    narration: {
      type: String,
      trim: true,
      default: "",
    },

    status: {
      type: String,
      enum: [
        "POSTED",
        "REVERSED",
      ],
      default: "POSTED",
      index: true,
    },

    reversalOf: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LedgerEntry",
      default: null,
      index: true,
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

/*
 * One reference may legitimately have multiple ledger entries
 * e.g. sender DEBIT + receiver CREDIT.
 */
ledgerEntrySchema.index({
  reference: 1,
  user: 1,
  direction: 1,
});

ledgerEntrySchema.index({
  user: 1,
  createdAt: -1,
});

/*
 * Ledger entries must never be modified or deleted.
 */
const denyMutation = function (next) {
  next(
    new Error(
      "Ledger entries are immutable and cannot be modified or deleted."
    )
  );
};

ledgerEntrySchema.pre("updateOne", denyMutation);
ledgerEntrySchema.pre("updateMany", denyMutation);
ledgerEntrySchema.pre("findOneAndUpdate", denyMutation);
ledgerEntrySchema.pre("deleteOne", denyMutation);
ledgerEntrySchema.pre("deleteMany", denyMutation);
ledgerEntrySchema.pre("findOneAndDelete", denyMutation);

module.exports = mongoose.model(
  "LedgerEntry",
  ledgerEntrySchema
);
