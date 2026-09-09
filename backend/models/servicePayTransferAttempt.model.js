const mongoose = require("mongoose");

/*
 * A request record is deliberately separate from Transfer.  Transfer only
 * represents committed financial movement; this model also records requests
 * which failed before money could be moved or whose commit outcome is unknown.
 */
const servicePayTransferAttemptSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    receiverPhone: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 1 },
    reference: { type: String, required: true, unique: true, trim: true },
    idempotencyKey: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128,
    },
    status: {
      type: String,
      enum: ["PENDING", "SUCCESS", "FAILED"],
      default: "PENDING",
      index: true,
    },
    failureCode: { type: String, default: null },
    // Only the request worker which owns this lease may complete its financial
    // transaction.  An expired reservation can be safely reconciled by status.
    leaseExpiresAt: { type: Date, required: true, index: true },
    transfer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transfer",
      default: null,
    },
  },
  { timestamps: true }
);

servicePayTransferAttemptSchema.index({ sender: 1, idempotencyKey: 1 }, { unique: true });
servicePayTransferAttemptSchema.index({ status: 1, createdAt: 1, leaseExpiresAt: 1 });

module.exports = mongoose.model(
  "ServicePayTransferAttempt",
  servicePayTransferAttemptSchema
);