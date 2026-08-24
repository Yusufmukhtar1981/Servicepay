const mongoose = require("mongoose");

const empowermentDisbursementSchema =
  new mongoose.Schema(
    {
      program: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "EmpowermentProgram",
        required: true,
        index: true,
      },

      batchReference: {
        type: String,
        required: true,
        unique: true,
        index: true,
      },

      idempotencyKey: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        index: true,
      },

      fundingReference: {
        type: String,
        trim: true,
        default: "",
      },

      beneficiaryCount: {
        type: Number,
        required: true,
        min: 1,
      },

      amountPerBeneficiary: {
        type: Number,
        required: true,
        min: 0,
      },

      totalAmount: {
        type: Number,
        required: true,
        min: 0,
      },

      status: {
        type: String,
        enum: [
          "PREVIEW",
          "READY",
          "PROCESSING",
          "COMPLETED",
          "PARTIAL",
          "FAILED",
          "CANCELLED",
        ],
        default: "PREVIEW",
        index: true,
      },

      beneficiaryIds: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "EmpowermentBeneficiary",
        },
      ],

      results: [
        {
          beneficiary: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "EmpowermentBeneficiary",
            required: true,
          },
          recipient: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
          },
          amount: {
            type: Number,
            required: true,
            min: 0.01,
          },
          transactionReference: {
            type: String,
            required: true,
            trim: true,
          },
          status: {
            type: String,
            enum: ["SUCCESSFUL", "FAILED", "PENDING"],
            required: true,
          },
          failureReason: {
            type: String,
            trim: true,
            default: "",
          },
        },
      ],

      createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },

      metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
      },
    },
    {
      timestamps: true,
    }
  );

empowermentDisbursementSchema.index({
  program: 1,
  createdAt: -1,
});

module.exports = mongoose.model(
  "EmpowermentDisbursement",
  empowermentDisbursementSchema
);
