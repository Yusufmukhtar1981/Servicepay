const mongoose = require("mongoose");

const groupWalletLedgerSchema = new mongoose.Schema(
  {
    group: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GroupWallet",
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: ["CREDIT", "DEBIT"],
      required: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 0.01,
    },

    balanceAfter: {
      type: Number,
      required: true,
      min: 0,
    },

    reference: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    contribution: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GroupContribution",
      default: null,
    },

    description: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { timestamps: true }
);

groupWalletLedgerSchema.index({ group: 1, createdAt: -1 });

module.exports = mongoose.model("GroupWalletLedger", groupWalletLedgerSchema);