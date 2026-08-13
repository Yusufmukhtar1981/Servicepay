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

module.exports = mongoose.model(
  "EmpowermentDisbursement",
  empowermentDisbursementSchema
);
