const mongoose = require("mongoose");

const businessWalletTransactionSchema =
  new mongoose.Schema(
    {
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true,
      },

      reference: {
        type: String,
        required: true,
        unique: true,
        index: true,
        trim: true,
      },

      type: {
        type: String,
        enum: [
          "PERSONAL_TO_BUSINESS",
          "BUSINESS_TO_PERSONAL",
          "CREDIT",
          "DEBIT",
          "WITHDRAWAL",
          "REVERSAL",
        ],
        required: true,
        index: true,
      },

      direction: {
        type: String,
        enum: ["CREDIT", "DEBIT"],
        required: true,
      },

      amount: {
        type: Number,
        required: true,
        min: 0,
      },

      balanceBefore: {
        type: Number,
        required: true,
        min: 0,
      },

      balanceAfter: {
        type: Number,
        required: true,
        min: 0,
      },

      status: {
        type: String,
        enum: [
          "PENDING",
          "SUCCESSFUL",
          "FAILED",
          "REVERSED",
        ],
        default: "SUCCESSFUL",
        index: true,
      },

      narration: {
        type: String,
        default: "",
        trim: true,
        maxlength: 180,
      },

      metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: undefined,
      },
    },
    {
      timestamps: true,
    },
  );

businessWalletTransactionSchema.index({
  user: 1,
  createdAt: -1,
});

module.exports = mongoose.model(
  "BusinessWalletTransaction",
  businessWalletTransactionSchema,
);
