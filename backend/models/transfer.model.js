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

    idempotencyKey: {
      type: String,
      trim: true,
      maxlength: 128,
      default: undefined,
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

transferSchema.index(
  {
    sender: 1,
    idempotencyKey: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      idempotencyKey: {
        $type: "string",
      },
    },
  }
);

module.exports = mongoose.model("Transfer", transferSchema);
