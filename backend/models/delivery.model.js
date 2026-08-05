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

    /*
     * Total amount charged for the delivery.
     */
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
      index: true,
    },

    paidAt: {
      type: Date,
      default: null,
    },

    refundedAt: {
      type: Date,
      default: null,
    },

    /*
     * Commission can be calculated as:
     *
     * PERCENTAGE:
     * deliveryFee × riderCommissionValue / 100
     *
     * FIXED:
     * riderCommissionValue
     */
    riderCommissionType: {
      type: String,
      enum: [
        "PERCENTAGE",
        "FIXED",
      ],
      default: "PERCENTAGE",
    },

    riderCommissionValue: {
      type: Number,
      default: 80,
      min: 0,
    },

    /*
     * Locked calculated amounts for this delivery.
     *
     * These values will not change later even if
     * the global commission setting changes.
     */
    riderCommissionAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    servicepayProfit: {
      type: Number,
      default: 0,
      min: 0,
    },

    commissionCalculatedAt: {
      type: Date,
      default: null,
    },

    /*
     * PENDING:
     * Price/commission exists but rider has not
     * earned it yet.
     *
     * CREDITED:
     * Rider completed delivery and earnings were
     * added to pending settlement.
     *
     * SETTLED:
     * Head Office paid/settled the rider.
     *
     * CANCELLED:
     * Delivery was cancelled or commission removed.
     */
    riderCommissionStatus: {
      type: String,
      enum: [
        "PENDING",
        "CREDITED",
        "SETTLED",
        "CANCELLED",
      ],
      default: "PENDING",
      index: true,
    },

    /*
     * Prevents crediting the same delivery twice.
     */
    riderCommissionCredited: {
      type: Boolean,
      default: false,
      index: true,
    },

    riderCommissionCreditedAt: {
      type: Date,
      default: null,
    },

    riderCommissionSettledAt: {
      type: Date,
      default: null,
    },

    riderCommissionSettledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    settlementReference: {
      type: String,
      default: "",
      trim: true,
    },

    status: {
      type: String,
      enum: [
        "PENDING",
        "ASSIGNED",
        "ACCEPTED",
        "PICKED_UP",
        "IN_TRANSIT",
        "DELIVERED",
        "CANCELLED",
        "FAILED",
      ],
      default: "PENDING",
      index: true,
    },

    assignedRiderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
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

    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    assignedAt: {
      type: Date,
      default: null,
    },

    riderAcceptedAt: {
      type: Date,
      default: null,
    },

    riderRejectedAt: {
      type: Date,
      default: null,
    },

    riderRejectionReason: {
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

/*
 * Rider delivery lookup.
 */
deliverySchema.index({
  assignedRiderId: 1,
  status: 1,
  createdAt: -1,
});

/*
 * Pending and credited commission lookup.
 */
deliverySchema.index({
  assignedRiderId: 1,
  riderCommissionStatus: 1,
  deliveredAt: -1,
});

/*
 * Head Office settlement lookup.
 */
deliverySchema.index({
  riderCommissionStatus: 1,
  riderCommissionCredited: 1,
  createdAt: -1,
});

/*
 * Calculate and lock Rider commission and
 * ServicePay profit for this delivery.
 */
deliverySchema.methods.calculateCommission =
  function () {
    const deliveryFee = Number(
      this.deliveryFee || 0
    );

    const commissionValue = Number(
      this.riderCommissionValue || 0
    );

    let riderCommissionAmount = 0;

    if (
      this.riderCommissionType ===
      "FIXED"
    ) {
      riderCommissionAmount =
        commissionValue;
    } else {
      riderCommissionAmount =
        deliveryFee *
        (commissionValue / 100);
    }

    /*
     * Rider commission must not exceed
     * the total delivery fee.
     */
    riderCommissionAmount = Math.min(
      riderCommissionAmount,
      deliveryFee
    );

    riderCommissionAmount = Math.max(
      riderCommissionAmount,
      0
    );

    this.riderCommissionAmount =
      Number(
        riderCommissionAmount.toFixed(2)
      );

    this.servicepayProfit =
      Number(
        (
          deliveryFee -
          this.riderCommissionAmount
        ).toFixed(2)
      );

    this.commissionCalculatedAt =
      new Date();

    return {
      deliveryFee,
      riderCommissionAmount:
        this.riderCommissionAmount,
      servicepayProfit:
        this.servicepayProfit,
    };
  };

module.exports = mongoose.model(
  "Delivery",
  deliverySchema
);