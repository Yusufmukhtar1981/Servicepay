const mongoose = require("mongoose");

const businessWalletWithdrawalSchema =
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

      amount: {
        type: Number,
        required: true,
        min: 100,
      },

      bankName: {
        type: String,
        required: true,
        trim: true,
        maxlength: 100,
      },

      accountNumber: {
        type: String,
        required: true,
        trim: true,
        maxlength: 20,
      },

      accountName: {
        type: String,
        required: true,
        trim: true,
        maxlength: 140,
      },

      status: {
        type: String,
        enum: [
          "PENDING",
          "APPROVED",
          "PAID",
          "REJECTED",
        ],
        default: "PENDING",
        index: true,
      },

      adminNote: {
        type: String,
        default: "",
        trim: true,
        maxlength: 300,
      },

      approvedAt: {
        type: Date,
        default: undefined,
      },

      paidAt: {
        type: Date,
        default: undefined,
      },

      rejectedAt: {
        type: Date,
        default: undefined,
      },
    },
    {
      timestamps: true,
    },
  );

businessWalletWithdrawalSchema.index({
  user: 1,
  createdAt: -1,
});

module.exports = mongoose.model(
  "BusinessWalletWithdrawal",
  businessWalletWithdrawalSchema,
);
