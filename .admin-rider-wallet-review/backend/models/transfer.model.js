const mongoose = require("mongoose");

const transferSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 1,
    },

    reference: {
      type: String,
      required: true,
      unique: true,
    },

    status: {
      type: String,
      enum: ["PENDING", "SUCCESSFUL", "FAILED"],
      default: "SUCCESSFUL",
    },

    senderBalanceAfter: {
      type: Number,
      required: true,
    },

    receiverBalanceAfter: {
      type: Number,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Transfer", transferSchema);