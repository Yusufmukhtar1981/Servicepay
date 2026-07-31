const mongoose = require("mongoose");

const productCommissionSchema = new mongoose.Schema(
  {
    serviceType: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    productCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    productName: {
      type: String,
      required: true,
      trim: true,
    },

    agentCommission: {
      type: Number,
      default: 0,
      min: 0,
    },

    stateCommission: {
      type: Number,
      default: 0,
      min: 0,
    },

    zonalCommission: {
      type: Number,
      default: 0,
      min: 0,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

productCommissionSchema.index(
  {
    serviceType: 1,
    productCode: 1,
  },
  {
    unique: true,
  }
);

module.exports = mongoose.model(
  "ProductCommission",
  productCommissionSchema
);
