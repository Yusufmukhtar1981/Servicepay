const mongoose = require("mongoose");

const moneyRequestSchema = new mongoose.Schema(
  {
    requester: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    requestedFrom: {
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

    note: {
      type: String,
      default: "",
      trim: true,
    },

    status: {
      type: String,
      enum: ["PENDING", "PAID", "DECLINED", "CANCELLED"],
      default: "PENDING",
      index: true,
    },

    paidAt: Date,
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model(
  "MoneyRequest",
  moneyRequestSchema
);
