const mongoose = require("mongoose");

const withdrawalRequestSchema =
  new mongoose.Schema(
    {
      reference: {
        type: String,
        required: true,
        unique: true,
        index: true,
      },

      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true,
      },

      idempotencyKey: {
        type: String,
        trim: true,
        maxlength: 128,
        default: null,
      },

      amount: {
        type: Number,
        required: true,
        min: 100,
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

      status: {
        type: String,
        enum: [
          "PENDING",
          "APPROVED",
          "REJECTED",
        ],
        default: "PENDING",
        index: true,
      },

      adminNote: {
        type: String,
        default: "",
        trim: true,
      },

      payoutReference: {
        type: String,
        default: "",
        trim: true,
      },

      balanceAfter: {
        type: Number,
        default: null,
      },

      debitLedgerEntry: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "LedgerEntry",
        default: null,
      },

      refundLedgerEntry: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "LedgerEntry",
        default: null,
      },

      approvedAt: Date,
      rejectedAt: Date,

      approvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },

      rejectedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
    },
    {
      timestamps: true,
    }
  );

withdrawalRequestSchema.index(
  {
    user: 1,
    idempotencyKey: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      idempotencyKey: {
        $type: "string",
      },
    },
  }
);

module.exports = mongoose.model(
  "WithdrawalRequest",
  withdrawalRequestSchema
);
