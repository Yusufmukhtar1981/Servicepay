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

      idempotencyKey: {
        type: String,
        required: true,
        unique: true,
        index: true,
      },

      cycle: {
        type: String,
        required: true,
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

      balanceAfter: {
        type: Number,
        min: 0,
        default: null,
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

groupContributionSchema.index(
  { group: 1, member: 1, cycle: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "SUCCESSFUL" },
  }
);
