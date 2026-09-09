const mongoose = require("mongoose");

const examPinItemSchema =
  new mongoose.Schema(
    {
      pin: {
        type: String,
        trim: true,
        default: "",
      },

      serialNumber: {
        type: String,
        trim: true,
        default: "",
      },

      cardDetails: {
        type: String,
        trim: true,
        default: "",
      },

      providerOrderId: {
        type: String,
        trim: true,
        default: "",
      },

      providerRequestId: {
        type: String,
        trim: true,
        default: "",
      },

      amountCharged: {
        type: Number,
        default: 0,
        min: 0,
      },

      status: {
        type: String,
        enum: [
          "PENDING",
          "SUCCESSFUL",
          "FAILED",
          "REFUNDED",
        ],
        default: "PENDING",
      },

      providerResponse: {
        type: mongoose.Schema.Types.Mixed,
        default: null,
      },
    },
    {
      _id: true,
      timestamps: true,
    }
  );

const examPinSchema =
  new mongoose.Schema(
    {
      customerId: {
        type:
          mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true,
      },

      transactionId: {
        type:
          mongoose.Schema.Types.ObjectId,
        ref: "Transaction",
        default: null,
      },

      reference: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        index: true,
      },

      provider: {
        type: String,
        default: "CLUBKONNECT",
        trim: true,
      },

      examType: {
        type: String,
        enum: [
          "WAEC",
          "JAMB",
        ],
        default: "WAEC",
        required: true,
      },

      productCode: {
        type: String,
        enum: [
          "waecdirect",
          "waec-registration",
        ],
        required: true,
        trim: true,
      },

      productName: {
        type: String,
        required: true,
        trim: true,
      },

      phone: {
        type: String,
        required: true,
        trim: true,
      },

      quantity: {
        type: Number,
        required: true,
        min: 1,
        max: 5,
      },

      unitAmount: {
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
          "PENDING",
          "SUCCESSFUL",
          "PARTIALLY_SUCCESSFUL",
          "FAILED",
          "REFUNDED",
        ],
        default: "PENDING",
        index: true,
      },

      successfulQuantity: {
        type: Number,
        default: 0,
        min: 0,
      },

      failedQuantity: {
        type: Number,
        default: 0,
        min: 0,
      },

      refundedAmount: {
        type: Number,
        default: 0,
        min: 0,
      },

      pins: {
        type: [examPinItemSchema],
        default: [],
      },

      failureReason: {
        type: String,
        trim: true,
        default: null,
      },

      providerResponse: {
        type: mongoose.Schema.Types.Mixed,
        default: null,
      },
    },
    {
      timestamps: true,
    }
  );

examPinSchema.index({
  customerId: 1,
  createdAt: -1,
});

module.exports = mongoose.model(
  "ExamPin",
  examPinSchema
);