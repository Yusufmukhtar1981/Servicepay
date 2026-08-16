const mongoose = require("mongoose");

const amanaOrderSchema = new mongoose.Schema(
  {
    /*
     * Customer who created and paid for the order.
     */
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    /*
     * Unique ServicePay Amana order reference.
     */
    reference: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      uppercase: true,
    },

    /*
     * Initial ServicePay Amana categories.
     */
    category: {
      type: String,
      required: true,
      enum: [
        "FOOD_PACKAGE",
        "SCHOOL_FEES",
        "MEDICAL_SUPPORT",
        "BUILDING_SUPPORT",
        "LIVESTOCK_SUPPORT",
        "RENT_SUPPORT",
        "SOLAR_AND_UTILITIES",
        "CUSTOM_REQUEST",
      ],
      index: true,
    },

    /*
     * Short title describing the order.
     *
     * Examples:
     * Monthly Family Food Package
     * School Fees Payment
     * Hospital Bill Payment
     */
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 150,
    },

    /*
     * More information about what the customer wants.
     */
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },

    /*
     * Beneficiary information.
     */
    beneficiary: {
      fullName: {
        type: String,
        required: true,
        trim: true,
      },

      phone: {
        type: String,
        required: true,
        trim: true,
      },

      email: {
        type: String,
        default: "",
        trim: true,
        lowercase: true,
      },

      relationship: {
        type: String,
        default: "",
        trim: true,
      },

      state: {
        type: String,
        required: true,
        trim: true,
      },

      lga: {
        type: String,
        required: true,
        trim: true,
      },

      address: {
        type: String,
        required: true,
        trim: true,
      },

      landmark: {
        type: String,
        default: "",
        trim: true,
      },
    },

    /*
     * Institution or service provider information.
     *
     * This can be:
     * - School
     * - Hospital
     * - Pharmacy
     * - Food vendor
     * - Building materials vendor
     */
    providerDetails: {
      name: {
        type: String,
        default: "",
        trim: true,
      },

      phone: {
        type: String,
        default: "",
        trim: true,
      },

      accountName: {
        type: String,
        default: "",
        trim: true,
      },

      accountNumber: {
        type: String,
        default: "",
        trim: true,
      },

      bankName: {
        type: String,
        default: "",
        trim: true,
      },

      address: {
        type: String,
        default: "",
        trim: true,
      },

      additionalInformation: {
        type: String,
        default: "",
        trim: true,
      },
    },

    /*
     * Order financial information.
     */
    amount: {
      type: Number,
      required: true,
      min: 1,
    },

    serviceFee: {
      type: Number,
      default: 0,
      min: 0,
    },

    deliveryFee: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalAmount: {
      type: Number,
      required: true,
      min: 1,
    },

    currency: {
      type: String,
      default: "NGN",
      uppercase: true,
      trim: true,
    },

    /*
     * Payment information.
     */
    paymentMethod: {
      type: String,
      enum: ["SERVICEPAY_WALLET"],
      default: "SERVICEPAY_WALLET",
    },

    paymentStatus: {
      type: String,
      enum: [
        "PENDING",
        "PAID",
        "FAILED",
        "REFUNDED",
        "PARTIALLY_REFUNDED",
      ],
      default: "PENDING",
      index: true,
    },

    paidAt: {
      type: Date,
      default: null,
    },

    paymentTransaction: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transaction",
      default: null,
    },

    refundTransaction: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transaction",
      default: null,
    },

    /*
     * Main Amana order status.
     */
    status: {
      type: String,
      enum: [
        "PENDING_PAYMENT",
        "PAID",
        "PROCESSING",
        "ASSIGNED",
        "FULFILLED",
        "COMPLETED",
        "CANCELLED",
        "REFUNDED",
      ],
      default: "PENDING_PAYMENT",
      index: true,
    },

    /*
     * Aggregator or staff assigned to fulfil the request.
     */
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
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

    /*
     * Vendor selected to fulfil the order.
     */
    vendor: {
      name: {
        type: String,
        default: "",
        trim: true,
      },

      phone: {
        type: String,
        default: "",
        trim: true,
      },

      address: {
        type: String,
        default: "",
        trim: true,
      },

      accountName: {
        type: String,
        default: "",
        trim: true,
      },

      accountNumber: {
        type: String,
        default: "",
        trim: true,
      },

      bankName: {
        type: String,
        default: "",
        trim: true,
      },
    },

    /*
     * Proof that the order was fulfilled.
     */
    fulfilmentProof: {
      receiptUrl: {
        type: String,
        default: "",
        trim: true,
      },

      imageUrls: {
        type: [String],
        default: [],
      },

      notes: {
        type: String,
        default: "",
        trim: true,
        maxlength: 2000,
      },

      uploadedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },

      uploadedAt: {
        type: Date,
        default: null,
      },
    },

    /*
     * OTP confirmation from the beneficiary.
     *
     * The OTP must be hashed before saving.
     * Do not save the plain OTP in MongoDB.
     */
    confirmationOtpHash: {
      type: String,
      default: "",
      select: false,
    },

    confirmationOtpExpiresAt: {
      type: Date,
      default: null,
      select: false,
    },

    confirmationOtpVerified: {
      type: Boolean,
      default: false,
    },

    confirmedAt: {
      type: Date,
      default: null,
    },

    /*
     * Important dates in the Amana process.
     */
    processingStartedAt: {
      type: Date,
      default: null,
    },

    fulfilledAt: {
      type: Date,
      default: null,
    },

    completedAt: {
      type: Date,
      default: null,
    },

    cancelledAt: {
      type: Date,
      default: null,
    },

    refundedAt: {
      type: Date,
      default: null,
    },

    /*
     * Cancellation and refund information.
     */
    cancellationReason: {
      type: String,
      default: "",
      trim: true,
      maxlength: 1000,
    },

    refundReason: {
      type: String,
      default: "",
      trim: true,
      maxlength: 1000,
    },

    refundedAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    /*
     * Admin notes are not intended for customers.
     */
    adminNotes: {
      type: String,
      default: "",
      trim: true,
      maxlength: 3000,
    },

    /*
     * Prevent the same order from being charged
     * or refunded more than once.
     */
    walletDebited: {
      type: Boolean,
      default: false,
    },

    walletRefunded: {
      type: Boolean,
      default: false,
    },

    /*
     * Customer can optionally choose a preferred
     * date for delivery or fulfilment.
     */
    preferredFulfilmentDate: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

/*
 * Useful database indexes.
 */
amanaOrderSchema.index({
  customer: 1,
  createdAt: -1,
});

amanaOrderSchema.index({
  status: 1,
  createdAt: -1,
});

amanaOrderSchema.index({
  category: 1,
  status: 1,
});

amanaOrderSchema.index({
  assignedTo: 1,
  status: 1,
});

amanaOrderSchema.index({
  "beneficiary.phone": 1,
});

/*
 * Safe public JSON response.
 */
amanaOrderSchema.methods.toSafeObject = function () {
  const order = this.toObject();

  delete order.confirmationOtpHash;
  delete order.confirmationOtpExpiresAt;

  return order;
};

module.exports = mongoose.model(
  "AmanaOrder",
  amanaOrderSchema
);