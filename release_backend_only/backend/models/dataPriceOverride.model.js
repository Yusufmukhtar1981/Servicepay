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
        required: true,
        min: 0.01,
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
