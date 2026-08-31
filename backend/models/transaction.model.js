const mongoose = require("mongoose");

const transactionSchema =
  new mongoose.Schema(
    {
      reference: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        index: true,
      },

      customerId: {
        type:
          mongoose.Schema.Types
            .ObjectId,
        ref: "User",
        required: true,
        index: true,
      },
      branchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", default: null, index: true },

      agentId: {
        type:
          mongoose.Schema.Types
            .ObjectId,
        ref: "User",
        default: null,
      },

      stateManagerId: {
        type:
          mongoose.Schema.Types
            .ObjectId,
        ref: "User",
        default: null,
      },

      zonalManagerId: {
        type:
          mongoose.Schema.Types
            .ObjectId,
        ref: "User",
        default: null,
      },

      serviceType: {
        type: String,
        enum: [
          "AIRTIME",
          "DATA",
          "CABLE",
          "ELECTRICITY",
          "EXAM_PIN",
          "WALLET_FUNDING",
          "TRANSFER",
          "BANK_TRANSFER",
          "DELIVERY",
          "ID_VERIFICATION",
          "AMANA",
          "EMPOWERMENT_FUNDING",
          "EMPOWERMENT_DISBURSEMENT",
          "MARKETPLACE",
          "REFERRAL_BONUS",
           "SOLAR_DEPOSIT",
           "SOLAR_INSTALLMENT",
           "PHONE_FINANCING_DEPOSIT",
           "PHONE_FINANCING_INSTALLMENT",
           "PHONE_FINANCING_REFUND",
           "PROTECTED_DEAL",
        ],
        required: true,
        index: true,
      },

      provider: {
        type: String,
        trim: true,
        default: null,
      },

      phone: {
        type: String,
        trim: true,
        default: null,
      },

      amount: {
        type: Number,
        required: true,
        min: 0,
      },

      agentCommission: {
        type: Number,
        default: 0,
        min: 0,
      },

      stateManagerCommission: {
        type: Number,
        default: 0,
        min: 0,
      },

      zonalManagerCommission: {
        type: Number,
        default: 0,
        min: 0,
      },

      servicepayProfit: {
        type: Number,
        default: 0,
        min: 0,
      },

      status: {
        type: String,
        enum: [
          "PENDING",
          "SUCCESSFUL",
          "FAILED",
          "REFUNDED",
        ],
        default: "PENDING",
        index: true,
      },

      providerResponse: {
        type:
          mongoose.Schema.Types.Mixed,
        default: null,
      },
    },
    {
      timestamps: true,
    }
  );

transactionSchema.index({
  customerId: 1,
  createdAt: -1,
});
transactionSchema.index({ branchId: 1, createdAt: -1 });

transactionSchema.index({
  serviceType: 1,
  status: 1,
  createdAt: -1,
});

transactionSchema.index({
  provider: 1,
  createdAt: -1,
});

transactionSchema.index({
  amount: 1,
  createdAt: -1,
});

const Transaction =
  mongoose.model(
    "Transaction",
    transactionSchema
  );

module.exports = Transaction;