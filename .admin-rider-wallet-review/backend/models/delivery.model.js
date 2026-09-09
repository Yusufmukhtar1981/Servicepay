const mongoose = require("mongoose");

const deliverySchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    trackingNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    pickupAddress: {
      type: String,
      required: true,
      trim: true,
    },

    deliveryAddress: {
      type: String,
      required: true,
      trim: true,
    },

    senderName: {
      type: String,
      required: true,
      trim: true,
    },

    senderPhone: {
      type: String,
      required: true,
      trim: true,
    },

    receiverName: {
      type: String,
      required: true,
      trim: true,
    },

    receiverPhone: {
      type: String,
      required: true,
      trim: true,
    },

    packageName: {
      type: String,
      required: true,
      trim: true,
    },

    packageDescription: {
      type: String,
      default: "",
      trim: true,
    },

    packageWeight: {
      type: Number,
      default: 0,
      min: 0,
    },

    deliveryFee: {
      type: Number,
      default: 0,
      min: 0,
    },

    paymentStatus: {
      type: String,
      enum: [
        "UNPAID",
        "PAID",
        "REFUNDED",
      ],
      default: "UNPAID",
    },

    status: {
      type: String,
      enum: [
        "PENDING",
        "ACCEPTED",
        "PICKED_UP",
        "IN_TRANSIT",
        "DELIVERED",
        "CANCELLED",
        "FAILED",
      ],
      default: "PENDING",
    },

    assignedRiderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    riderName: {
      type: String,
      default: "",
      trim: true,
    },

    riderPhone: {
      type: String,
      default: "",
      trim: true,
    },

    adminNote: {
      type: String,
      default: "",
      trim: true,
    },

    acceptedAt: {
      type: Date,
      default: null,
    },

    pickedUpAt: {
      type: Date,
      default: null,
    },

    inTransitAt: {
      type: Date,
      default: null,
    },

    deliveredAt: {
      type: Date,
      default: null,
    },

    cancelledAt: {
      type: Date,
      default: null,
    },

    failedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model(
  "Delivery",
  deliverySchema
);