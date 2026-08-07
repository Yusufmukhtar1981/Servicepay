const mongoose = require("mongoose");

const kekeRideSchema = new mongoose.Schema(
  {
    /*
     * =====================================================
     * BASIC REFERENCES
     * =====================================================
     */

    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    rideReference: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },

    /*
     * =====================================================
     * PICKUP
     * =====================================================
     */

    pickup: {
      address: {
        type: String,
        required: true,
        trim: true,
      },

      location: {
        type: {
          type: String,
          enum: ["Point"],
          default: "Point",
        },

        coordinates: {
          type: [Number],
          required: true,
        },
      },
    },

    /*
     * =====================================================
     * DESTINATION
     * =====================================================
     */

    destination: {
      address: {
        type: String,
        required: true,
        trim: true,
      },

      location: {
        type: {
          type: String,
          enum: ["Point"],
          default: "Point",
        },

        coordinates: {
          type: [Number],
          required: true,
        },
      },
    },

    /*
     * =====================================================
     * CUSTOMER CONTACT
     * =====================================================
     */

    customerName: {
      type: String,
      required: true,
      trim: true,
    },

    customerPhone: {
      type: String,
      required: true,
      trim: true,
    },

    /*
     * =====================================================
     * DRIVER SNAPSHOT
     * =====================================================
     *
     * We save a snapshot so ride history still has
     * the driver's details even if profile changes later.
     */

    driverSnapshot: {
      fullName: {
        type: String,
        default: null,
        trim: true,
      },

      phone: {
        type: String,
        default: null,
        trim: true,
      },

      riderId: {
        type: String,
        default: null,
        trim: true,
      },

      plateNumber: {
        type: String,
        default: null,
        trim: true,
      },

      vehicleType: {
        type: String,
        default: null,
        trim: true,
      },

      rating: {
        type: Number,
        default: 0,
      },
    },

    /*
     * =====================================================
     * RIDE STATUS
     * =====================================================
     */

    status: {
      type: String,
      enum: [
        "SEARCHING_DRIVER",
        "DRIVER_ASSIGNED",
        "DRIVER_COMING",
        "DRIVER_ARRIVED",
        "RIDE_STARTED",
        "RIDE_COMPLETED",
        "CANCELLED",
        "NO_DRIVER_FOUND",
      ],
      default: "SEARCHING_DRIVER",
      index: true,
    },

    /*
     * =====================================================
     * DRIVER OFFER / MATCHING
     * =====================================================
     */

    offeredDriverIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    currentOfferDriverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    currentOfferExpiresAt: {
      type: Date,
      default: null,
      index: true,
    },

    driverAssignedAt: {
      type: Date,
      default: null,
    },

    driverAcceptedAt: {
      type: Date,
      default: null,
    },

    driverArrivedAt: {
      type: Date,
      default: null,
    },

    rideStartedAt: {
      type: Date,
      default: null,
    },

    rideCompletedAt: {
      type: Date,
      default: null,
    },

    cancelledAt: {
      type: Date,
      default: null,
    },

    /*
     * =====================================================
     * RIDE OTP
     * =====================================================
     */

    rideOtp: {
      type: String,
      default: null,
      select: false,
    },

    rideOtpVerified: {
      type: Boolean,
      default: false,
    },

    /*
     * =====================================================
     * DISTANCE / TIME
     * =====================================================
     */

    estimatedDistanceKm: {
      type: Number,
      default: 0,
      min: 0,
    },

    estimatedDurationMinutes: {
      type: Number,
      default: 0,
      min: 0,
    },

    actualDistanceKm: {
      type: Number,
      default: 0,
      min: 0,
    },

    actualDurationMinutes: {
      type: Number,
      default: 0,
      min: 0,
    },

    /*
     * =====================================================
     * FARE
     * =====================================================
     */

    baseFare: {
      type: Number,
      default: 0,
      min: 0,
    },

    distanceFare: {
      type: Number,
      default: 0,
      min: 0,
    },

    waitingFare: {
      type: Number,
      default: 0,
      min: 0,
    },

    serviceFee: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalFare: {
      type: Number,
      default: 0,
      min: 0,
    },

    paymentMethod: {
      type: String,
      enum: [
        "WALLET",
        "CASH",
      ],
      default: "WALLET",
    },

    paymentStatus: {
      type: String,
      enum: [
        "PENDING",
        "PAID",
        "FAILED",
        "REFUNDED",
      ],
      default: "PENDING",
      index: true,
    },

    /*
     * =====================================================
     * DRIVER LIVE LOCATION SNAPSHOT
     * =====================================================
     */

    driverLastLocation: {
      type: {
        type: String,
        enum: ["Point"],
        default: undefined,
      },

      coordinates: {
        type: [Number],
        default: undefined,
      },

      updatedAt: {
        type: Date,
        default: null,
      },
    },

    /*
     * =====================================================
     * CANCELLATION
     * =====================================================
     */

    cancelledBy: {
      type: String,
      enum: [
        "CUSTOMER",
        "DRIVER",
        "SYSTEM",
        null,
      ],
      default: null,
    },

    cancellationReason: {
      type: String,
      trim: true,
      default: null,
    },

    /*
     * =====================================================
     * RATING
     * =====================================================
     */

    customerRating: {
      type: Number,
      min: 1,
      max: 5,
      default: null,
    },

    customerRatingComment: {
      type: String,
      trim: true,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

/*
 * =====================================================
 * GEO INDEXES
 * =====================================================
 */

kekeRideSchema.index({
  "pickup.location": "2dsphere",
});

kekeRideSchema.index({
  "destination.location": "2dsphere",
});

kekeRideSchema.index({
  driverLastLocation: "2dsphere",
});

/*
 * =====================================================
 * SEARCH INDEXES
 * =====================================================
 */

kekeRideSchema.index({
  customerId: 1,
  createdAt: -1,
});

kekeRideSchema.index({
  driverId: 1,
  status: 1,
  createdAt: -1,
});

kekeRideSchema.index({
  status: 1,
  createdAt: -1,
});

/*
 * =====================================================
 * METHODS
 * =====================================================
 */

kekeRideSchema.methods.assignDriver =
  function (driver) {
    this.driverId = driver._id;

    this.currentOfferDriverId =
      driver._id;

    this.driverSnapshot = {
      fullName:
        driver.fullName || null,

      phone:
        driver.phone || null,

      riderId:
        driver.riderId || null,

      plateNumber:
        driver.plateNumber || null,

      vehicleType:
        driver.vehicleType || null,

      rating:
        driver.riderRating || 0,
    };

    this.status =
      "DRIVER_ASSIGNED";

    this.driverAssignedAt =
      new Date();
  };

kekeRideSchema.methods.markDriverAccepted =
  function () {
    this.status =
      "DRIVER_COMING";

    this.driverAcceptedAt =
      new Date();

    this.currentOfferExpiresAt =
      null;
  };

kekeRideSchema.methods.markDriverArrived =
  function () {
    this.status =
      "DRIVER_ARRIVED";

    this.driverArrivedAt =
      new Date();
  };

kekeRideSchema.methods.markRideStarted =
  function () {
    this.status =
      "RIDE_STARTED";

    this.rideOtpVerified =
      true;

    this.rideStartedAt =
      new Date();
  };

kekeRideSchema.methods.markRideCompleted =
  function () {
    this.status =
      "RIDE_COMPLETED";

    this.rideCompletedAt =
      new Date();
  };

kekeRideSchema.methods.cancelRide =
  function ({
    cancelledBy,
    reason,
  }) {
    this.status =
      "CANCELLED";

    this.cancelledBy =
      cancelledBy;

    this.cancellationReason =
      reason || null;

    this.cancelledAt =
      new Date();
  };

module.exports =
  mongoose.model(
    "KekeRide",
    kekeRideSchema
  );