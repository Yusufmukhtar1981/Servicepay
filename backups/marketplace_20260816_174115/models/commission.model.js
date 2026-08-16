const mongoose = require("mongoose");

const commissionSchema = new mongoose.Schema(
  {
    transactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transaction",
      required: true,
      index: true,
    },

    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    beneficiaryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    beneficiaryRole: {
      type: String,
      enum: [
        "HEAD_OFFICE",
        "ZONAL_MANAGER",
        "STATE_MANAGER",
        "AGENT",
      ],
      required: true,
      index: true,
    },

    serviceType: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    transactionReference: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    transactionAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    providerCost: {
      type: Number,
      default: 0,
      min: 0,
    },

    netProfit: {
      type: Number,
      required: true,
      min: 0,
    },

    commissionRate: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },

    commissionAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    status: {
      type: String,
      enum: [
        "PENDING",
        "AVAILABLE",
        "WITHDRAWN",
        "REVERSED",
      ],
      default: "AVAILABLE",
      index: true,
    },

    description: {
      type: String,
      default: "",
      trim: true,
    },

    availableAt: {
      type: Date,
      default: Date.now,
    },

    withdrawnAt: {
      type: Date,
      default: null,
    },

    reversedAt: {
      type: Date,
      default: null,
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

/*
 * Hana a ba mutum ɗaya commission iri ɗaya sau biyu
 * daga transaction guda.
 */
commissionSchema.index(
  {
    transactionId: 1,
    beneficiaryRole: 1,
    beneficiaryId: 1,
  },
  {
    unique: true,
  }
);

commissionSchema.index({
  beneficiaryId: 1,
  status: 1,
  createdAt: -1,
});

commissionSchema.index({
  customerId: 1,
  createdAt: -1,
});

module.exports = mongoose.model(
  "Commission",
  commissionSchema
);
