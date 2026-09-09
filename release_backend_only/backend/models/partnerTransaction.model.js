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
        "REQUERY_REQUIRED",
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

    provider: {
      type: String,
      default: "CLUBKONNECT",
      trim: true,
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

    walletDebitStatus: {
      type: String,
      enum: ["DEBITED", "REFUNDED"],
      default: "DEBITED",
    },

    completedAt: {
      type: Date,
      default: null,
    },

    lastRequeryAt: {
      type: Date,
      default: null,
    },

    requeryCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    uncertaintyReason: {
      type: String,
      default: "",
      maxlength: 250,
    },

    resolvedAt: {
      type: Date,
      default: null,
    },

    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    resolutionSource: {
      type: String,
      enum: ["PROVIDER_RESPONSE", "HEAD_OFFICE_MANUAL"],
      default: null,
    },

    resolutionNote: {
      type: String,
      default: "",
      maxlength: 500,
    },

    dailyLimitAtRequest: {
      type: Number,
      default: 0,
    },

    dailySpentDateAtRequest: {
      type: String,
      default: "",
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

partnerTransactionSchema.index({
  status: 1,
  lastRequeryAt: 1,
  createdAt: -1,
});

module.exports =
  mongoose.models.PartnerTransaction ||
  mongoose.model(
    "PartnerTransaction",
    partnerTransactionSchema
  );
