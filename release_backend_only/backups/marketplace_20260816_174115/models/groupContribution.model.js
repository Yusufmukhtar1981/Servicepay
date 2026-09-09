const mongoose = require("mongoose");

const groupContributionSchema =
  new mongoose.Schema(
    {
      group: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "GroupWallet",
        required: true,
        index: true,
      },

      member: {
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
      },

      amount: {
        type: Number,
        required: true,
        min: 1,
      },

      status: {
        type: String,
        enum: ["SUCCESSFUL", "REVERSED"],
        default: "SUCCESSFUL",
        index: true,
      },
    },
    {
      timestamps: true,
    }
  );

module.exports = mongoose.model(
  "GroupContribution",
  groupContributionSchema
);
