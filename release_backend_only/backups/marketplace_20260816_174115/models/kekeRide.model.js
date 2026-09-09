const mongoose = require("mongoose");

/*
 * =====================================================
 * REUSABLE GEO POINT
 * =====================================================
 */

const geoPointSchema =
  new mongoose.Schema(
    {
      type: {
        type: String,
        enum: ["Point"],
        required: true,
      },

      coordinates: {
        type: [Number],
        required: true,

        validate: {
          validator(value) {
            return (
              Array.isArray(value) &&
              value.length === 2 &&
              Number.isFinite(
                Number(value[0])
              ) &&
              Number.isFinite(
                Number(value[1])
              )
            );
          },

          message:
            "Geo location requires valid longitude and latitude.",
        },
      },
    },
    {
      _id: false,
    }
  );

/*
 * =====================================================
 * KEKE RIDE SCHEMA
 * =====================================================
 */

const kekeRideSchema =
  new mongoose.Schema(
    {
      /*
       * =================================================
       * CUSTOMER / DRIVER
       * =================================================
       */

      customerId: {
        type:
          mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true,
      },

      driverId: {
        type:
          mongoose.Schema.Types.ObjectId,
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
       * =================================================
       * PICKUP
       * =================================================
       */

      pickup: {
        address: {
          type: String,
          required: true,
          trim: true,
        },

        location: {
          type: geoPointSchema,
          required: true,
        },
      },

      /*
       * =================================================
       * DESTINATION
       * =================================================
       */

      destination: {
        address: {
          type: String,
          required: true,
          trim: true,
        },

        location: {
          type: geoPointSchema,
          required: true,
        },
      },

      /*
       * =================================================
       * CUSTOMER SNAPSHOT
       * =================================================
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
       * =================================================
       * DRIVER SNAPSHOT
       * =================================================
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
          min: 0,
          max: 5,
        },
      },

      /*
       * =================================================
       * RIDE STATUS
       * =================================================
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

        default:
          "SEARCHING_DRIVER",

        index: true,
      },

      /*
       * =================================================
       * DRIVER MATCHING / OFFER
       * =================================================
       */

      offeredDriverIds: [
        {
          type:
            mongoose.Schema.Types
              .ObjectId,

          ref: "User",
        },
      ],

      currentOfferDriverId: {
        type:
          mongoose.Schema.Types.ObjectId,

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
       * =================================================
       * RIDE OTP
       * =================================================
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
       * =================================================
       * DISTANCE / TIME
       * =================================================
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
       * =================================================
       * REAL FARE
       * =================================================
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

      /*
       * Kept for backward compatibility.
       *
       * New Keke pricing currently uses
       * ServicePay commission instead of
       * a separate fixed service fee.
       */
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

      /*
       * =================================================
       * SERVICEPAY COMMISSION SNAPSHOT
       * =================================================
       *
       * These values are saved when the ride
       * is created.
       *
       * This means if Head Office changes
       * commission later, an existing ride
       * keeps the pricing it started with.
       */

      servicePayCommissionPercent: {
        type: Number,
        default: 0,
        min: 0,
        max: 100,
      },

      servicePayCommission: {
        type: Number,
        default: 0,
        min: 0,
      },

      driverEarning: {
        type: Number,
        default: 0,
        min: 0,
      },

      /*
       * =================================================
       * PAYMENT
       * =================================================
       */

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
       * =================================================
       * DRIVER LOCATION SNAPSHOT
       * =================================================
       *
       * Live matching and live tracking use:
       *
       * User.riderCurrentLocation
       *
       * This field is only an optional snapshot.
       *
       * IMPORTANT:
       * No 2dsphere index here.
       */

      driverLastLocation: {
        type: geoPointSchema,
        default: undefined,
      },

      driverLastLocationUpdatedAt: {
        type: Date,
        default: null,
      },

      /*
       * =================================================
       * CANCELLATION
       * =================================================
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
       * =================================================
       * RATING
       * =================================================
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
  "pickup.location":
    "2dsphere",
});

kekeRideSchema.index({
  "destination.location":
    "2dsphere",
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

kekeRideSchema.index({
  paymentStatus: 1,
  createdAt: -1,
});

/*
 * =====================================================
 * METHODS
 * =====================================================
 */

/*
 * Assign nearest driver.
 */
kekeRideSchema.methods.assignDriver =
  function (
    driver
  ) {
    this.driverId =
      driver._id;

    this.currentOfferDriverId =
      driver._id;

    this.driverSnapshot = {
      fullName:
        driver.fullName ||
        null,

      phone:
        driver.phone ||
        null,

      riderId:
        driver.riderId ||
        null,

      plateNumber:
        driver.plateNumber ||
        null,

      vehicleType:
        driver.vehicleType ||
        null,

      rating:
        driver.riderRating ||
        0,
    };

    this.status =
      "DRIVER_ASSIGNED";

    this.driverAssignedAt =
      new Date();
  };

/*
 * Driver accepts.
 */
kekeRideSchema.methods
  .markDriverAccepted =
  function () {
    this.status =
      "DRIVER_COMING";

    this.driverAcceptedAt =
      new Date();

    this.currentOfferExpiresAt =
      null;
  };

/*
 * Driver arrives.
 */
kekeRideSchema.methods
  .markDriverArrived =
  function () {
    this.status =
      "DRIVER_ARRIVED";

    this.driverArrivedAt =
      new Date();
  };

/*
 * Ride starts after OTP.
 */
kekeRideSchema.methods
  .markRideStarted =
  function () {
    this.status =
      "RIDE_STARTED";

    this.rideOtpVerified =
      true;

    this.rideStartedAt =
      new Date();
  };

/*
 * Ride completed.
 */
kekeRideSchema.methods
  .markRideCompleted =
  function () {
    this.status =
      "RIDE_COMPLETED";

    this.rideCompletedAt =
      new Date();
  };

/*
 * Cancel ride.
 */
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

/*
 * =====================================================
 * EXPORT
 * =====================================================
 */

module.exports =
  mongoose.model(
    "KekeRide",
    kekeRideSchema
  );