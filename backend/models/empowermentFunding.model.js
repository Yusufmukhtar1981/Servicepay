const mongoose = require("mongoose");

const empowermentFundingSchema = new mongoose.Schema(
  {
    program: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EmpowermentProgram",
      required: true,
      index: true,
    },
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EmpowermentOrganization",
      required: true,
      index: true,
    },
    fundedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0.01,
    },
    reference: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    note: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },
    sourceReference: {
      type: String,
      trim: true,
      maxlength: 200,
      default: "",
    },
    type: {
      type: String,
      enum: ["FUNDING"],
      default: "FUNDING",
      required: true,
    },
    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    transaction: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transaction",
      default: null,
    },
    status: {
      type: String,
      enum: ["SUCCESSFUL", "FAILED"],
      default: "SUCCESSFUL",
      index: true,
    },
  },
  { timestamps: true }
);

empowermentFundingSchema.index({ program: 1, createdAt: -1 });

module.exports = mongoose.model(
  "EmpowermentFunding",
  empowermentFundingSchema
);