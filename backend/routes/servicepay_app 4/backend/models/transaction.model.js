const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    reference: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    agentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    stateManagerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    zonalManagerId: {
      type: mongoose.Schema.Types.ObjectId,
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
      ],
      required: true,
    },

    provider: {
      type: String,
      trim: true,
    },

    phone: {
      type: String,
      trim: true,
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
      enum: ["PENDING", "SUCCESSFUL", "FAILED", "REFUNDED"],
      default: "PENDING",
    },

    providerResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

const Transaction = mongoose.model(
  "Transaction",
  transactionSchema
);

module.exports = Transaction;