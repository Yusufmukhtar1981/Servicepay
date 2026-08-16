const mongoose = require("mongoose");

const bankTransferSchema =
  new mongoose.Schema(
    {
      sender: {
        type:
          mongoose.Schema.Types
            .ObjectId,
        ref: "User",
        required: true,
        index: true,
      },

      transactionId: {
        type:
          mongoose.Schema.Types
            .ObjectId,
        ref: "Transaction",
        default: null,
      },

      reference: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        index: true,
      },

      provider: {
        type: String,
        default: "SQUAD",
        trim: true,
      },

      providerReference: {
        type: String,
        trim: true,
        default: undefined,
        index: true,
      },

      providerTransactionId: {
        type: String,
        trim: true,
        default: "",
      },

      bankCode: {
        type: String,
        required: true,
        trim: true,
      },

      bankName: {
        type: String,
        required: true,
        trim: true,
      },

      accountNumber: {
        type: String,
        required: true,
        trim: true,
      },

      accountName: {
        type: String,
        required: true,
        trim: true,
      },

      narration: {
        type: String,
        trim: true,
        maxlength: 100,
        default:
          "ServicePay bank transfer",
      },

      amount: {
        type: Number,
        required: true,
        min: 0,
      },

      transferFee: {
        type: Number,
        default: 0,
        min: 0,
      },

      totalDebit: {
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

      status: {
        type: String,
        enum: [
          "PENDING",
          "PROCESSING",
          "SUCCESSFUL",
          "FAILED",
          "REFUNDED",
        ],
        default: "PENDING",
        index: true,
      },

      walletBalanceAfterDebit: {
        type: Number,
        default: null,
      },

      walletBalanceAfterRefund: {
        type: Number,
        default: null,
      },

      refundProcessed: {
        type: Boolean,
        default: false,
        index: true,
      },

      refundedAmount: {
        type: Number,
        default: 0,
        min: 0,
      },

      failureReason: {
        type: String,
        trim: true,
        default: null,
      },

      providerResponse: {
        type:
          mongoose.Schema.Types.Mixed,
        default: null,
      },

      webhookResponse: {
        type:
          mongoose.Schema.Types.Mixed,
        default: null,
      },

      completedAt: {
        type: Date,
        default: null,
      },

      failedAt: {
        type: Date,
        default: null,
      },

      refundedAt: {
        type: Date,
        default: null,
      },
    },
    {
      timestamps: true,
    }
  );

bankTransferSchema.index({
  sender: 1,
  createdAt: -1,
});

bankTransferSchema.index(
  {
    providerReference: 1,
  },
  {
    unique: true,
    sparse: true,
  }
);

module.exports = mongoose.model(
  "BankTransfer",
  bankTransferSchema
);