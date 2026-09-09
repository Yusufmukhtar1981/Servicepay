const mongoose = require("mongoose");

const transactionIntelligenceCommandSchema = new mongoose.Schema(
  {
    transaction: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transaction",
      required: true,
      index: true,
    },
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    operation: {
      type: String,
      enum: ["REQUERY"],
      required: true,
    },
    idempotencyKey: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
    },
    state: {
      type: String,
      enum: ["PROCESSING", "COMPLETED", "FAILED"],
      default: "PROCESSING",
      index: true,
    },
    httpStatus: {
      type: Number,
      default: 202,
    },
    safeResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

transactionIntelligenceCommandSchema.index(
  { transaction: 1, operation: 1, idempotencyKey: 1 },
  { unique: true }
);

module.exports =
  mongoose.models.TransactionIntelligenceCommand ||
  mongoose.model(
    "TransactionIntelligenceCommand",
    transactionIntelligenceCommandSchema
  );