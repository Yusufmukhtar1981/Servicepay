const mongoose = require("mongoose");

const partnerTransactionSchema = new mongoose.Schema(
  {
    partner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Partner",
      required: true,
      index: true,
    },

    reference: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    externalReference: {
      type: String,
      default: "",
      index: true,
    },

    idempotencyKey: {
      type: String,
      default: "",
      index: true,
      trim: true,
    },

    service: {
      type: String,
      enum: ["AIRTIME", "DATA"],
      required: true,
      index: true,
    },

    network: {
      type: String,
      default: "",
    },

    phone: {
      type: String,
      default: "",
    },

    amount: {
      type: Number,
      required: true,
      default: 0,
    },

    planCode: {
      type: String,
      default: "",
    },

    status: {
      type: String,
      enum: [
        "PENDING",
        "PROCESSING",
        "SUCCESSFUL",
        "FAILED",
        "REVERSED",
      ],
      default: "PENDING",
      index: true,
    },

    providerReference: {
      type: String,
      default: "",
    },

    providerResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    requestPayload: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    responsePayload: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    walletBefore: {
      type: Number,
      default: 0,
    },

    walletAfter: {
      type: Number,
      default: 0,
    },

    completedAt: {
      type: Date,
      default: null,
    },

    dailyLimitAtRequest: {
      type: Number,
      default: 0,
    },

    perTransactionLimitAtRequest: {
      type: Number,
      default: null,
    },

    errorMessage: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

partnerTransactionSchema.index(
  {
    partner: 1,
    externalReference: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      externalReference: {
        $type: "string",
        $gt: "",
      },
    },
  }
);

partnerTransactionSchema.index(
  { partner: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      idempotencyKey: { $type: "string", $gt: "" },
    },
  }
);

module.exports =
  mongoose.models.PartnerTransaction ||
  mongoose.model(
    "PartnerTransaction",
    partnerTransactionSchema
  );
