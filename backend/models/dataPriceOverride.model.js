const mongoose = require("mongoose");

const dataPriceOverrideSchema =
  new mongoose.Schema(
    {
      networkCode: {
        type: String,
        required: true,
        trim: true,
        uppercase: true,
      },

      planCode: {
        type: String,
        required: true,
        trim: true,
      },

      planName: {
        type: String,
        default: "",
        trim: true,
      },

      providerPrice: {
        type: Number,
        required: true,
        min: 0,
      },

      sellingPrice: {
        type: Number,
        default: null,
        min: 0.01,
      },

      pricingVersion: {
        type: Number,
        min: 0,
        default: 0,
      },
      // Same canonical plan record and existing unique index as Customer pricing.
      // Missing category overrides preserve legacy selling prices.
      businessPrices: {
        type: new mongoose.Schema(Object.fromEntries(["AGENT", "MERCHANT"].map(category => [category, {
          type: new mongoose.Schema({
            enabled: { type: Boolean, required: true },
            sellingPrice: { type: Number, required: true, min: 0.01 },
            maximumProviderCost: { type: Number, required: true, min: 0 },
            updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
            updatedAt: Date,
          }, { _id: false }),
          default: undefined,
        }])), { _id: false }),
        default: undefined,
      },

      active: {
        type: Boolean,
        default: true,
      },

      updatedBy: {
        type:
          mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
    },
    {
      timestamps: true,
    }
  );

dataPriceOverrideSchema.index(
  {
    networkCode: 1,
    planCode: 1,
  },
  {
    unique: true,
  }
);

module.exports = mongoose.model(
  "DataPriceOverride",
  dataPriceOverrideSchema
);
