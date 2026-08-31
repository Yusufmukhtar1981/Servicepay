const mongoose = require("mongoose");

const empowermentPayoutSchema = new mongoose.Schema(
  {
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      default: null,
      index: true,
    },
    program: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EmpowermentProgram",
      required: true,
      index: true,
    },
    disbursement: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EmpowermentDisbursement",
      required: true,
      index: true,
    },
    beneficiary: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EmpowermentBeneficiary",
      required: true,
      index: true,
    },
    recipient: {
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
    walletBalanceBefore: {
      type: Number,
      required: true,
      min: 0,
    },
    walletBalanceAfter: {
      type: Number,
      required: true,
      min: 0,
    },
    reference: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    transaction: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transaction",
      required: true,
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

/*
 * The database ultimately enforces one payout per beneficiary/program.
 * A retry must return the original batch or fail, never credit twice.
 */
empowermentPayoutSchema.index(
  { program: 1, beneficiary: 1 },
  { unique: true }
);

module.exports = mongoose.model(
  "EmpowermentPayout",
  empowermentPayoutSchema
);