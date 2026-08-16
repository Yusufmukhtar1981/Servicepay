const crypto = require("crypto");

const User = require(
  "../models/user.model"
);

const KekeRide = require(
  "../models/kekeRide.model"
);

const {
  getEffectiveFareSetting,
  calculateFare,
} = require(
  "./kekeFareSetting.controller"
);

/*
 * =====================================================
 * HELPERS
 * =====================================================
 */

const toNumber = (
  value
) => {
  const number =
    Number(value);

  if (!Number.isFinite(number)) {
    return null;
  }

  return number;
};

const generateRideReference =
  () => {
    const stamp =
      Date.now()
        .toString()
        .slice(-8);

    const random =
      crypto
        .randomBytes(3)
        .toString("hex")
        .toUpperCase();

    return `KEKE-${stamp}-${random}`;
  };

const generateRideOtp =
  () => {
    return String(
      Math.floor(
        1000 +
          Math.random() * 9000
      )
    );
  };

const calculateDistanceKm =
  (
    lat1,
    lng1,
    lat2,
    lng2
  ) => {
    const earthRadiusKm =
      6371;

    const toRadians =
      (degree) =>
        (degree * Math.PI) /
        180;

    const dLat =
      toRadians(
        lat2 - lat1
      );

    const dLng =
      toRadians(
        lng2 - lng1
      );

    const a =
      Math.sin(dLat / 2) *
        Math.sin(dLat / 2) +
      Math.cos(
        toRadians(lat1)
      ) *
        Math.cos(
          toRadians(lat2)
        ) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);

    const c =
      2 *
      Math.atan2(
        Math.sqrt(a),
        Math.sqrt(1 - a)
      );

    return earthRadiusKm *
      c;
  };

const calculateEstimatedDuration =
  (
    distanceKm
  ) => {
    if (
      !distanceKm ||
      distanceKm <= 0
    ) {
      return 0;
    }

    /*
     * Initial Keke average speed:
     * around 25 km/h.
     */
    const hours =
      distanceKm / 25;

    return Math.max(
      1,
      Math.ceil(
        hours * 60
      )
    );
  };

const getFreshLocationCutoff =
  () => {
    return new Date(
      Date.now() -
        5 *
          60 *
          1000
    );
  };

/*
 * =====================================================
 * FIND NEAREST KEKE DRIVER
 * =====================================================
 */

const findNearestKekeDriver =
  async ({
    pickupLatitude,
    pickupLongitude,
    excludedDriverIds = [],
    maxDistanceMetres,
  }) => {
    const locationFreshAfter =
      getFreshLocationCutoff();

    const query = {
      role:
        "DELIVERY_RIDER",

      status:
        "ACTIVE",

      riderVerificationStatus:
        "VERIFIED",

      availabilityStatus:
        "ONLINE",

      vehicleType:
        "TRICYCLE",

      riderCurrentJobId:
        null,

      riderLocationUpdatedAt: {
        $gte:
          locationFreshAfter,
      },

      riderCurrentLocation: {
        $near: {
          $geometry: {
            type:
              "Point",

            coordinates: [
              pickupLongitude,
              pickupLatitude,
            ],
          },

          $maxDistance:
            maxDistanceMetres,
        },
      },
    };

    if (
      Array.isArray(
        excludedDriverIds
      ) &&
      excludedDriverIds.length >
        0
    ) {
      query._id = {
        $nin:
          excludedDriverIds,
      };
    }

    return User.findOne(
      query
    );
  };

/*
 * =====================================================
 * CREATE KEKE RIDE
 * =====================================================
 *
 * POST /api/keke-rides
 *
 * Body:
 *
 * {
 *   "pickupAddress": "Current Location",
 *   "pickupLatitude": 12.0022,
 *   "pickupLongitude": 8.5920,
 *
 *   "destinationAddress": "Farm Centre, Kano",
 *   "destinationLatitude": 11.9890,
 *   "destinationLongitude": 8.5650,
 *
 *   "paymentMethod": "WALLET",
 *   "state": "Kano"
 * }
 */

exports.createRide = async (
  req,
  res
) => {
  try {
    const customer =
      await User.findById(
        req.user._id
      );

    if (!customer) {
      return res
        .status(404)
        .json({
          success:
            false,

          message:
            "Customer account not found.",
        });
    }

    if (
      customer.status !==
      "ACTIVE"
    ) {
      return res
        .status(403)
        .json({
          success:
            false,

          message:
            "Your account is not active.",
        });
    }

    const {
      pickupAddress,
      pickupLatitude,
      pickupLongitude,

      destinationAddress,
      destinationLatitude,
      destinationLongitude,

      paymentMethod =
        "WALLET",

      state,
    } = req.body || {};

    const pickupLat =
      toNumber(
        pickupLatitude
      );

    const pickupLng =
      toNumber(
        pickupLongitude
      );

    const destinationLat =
      toNumber(
        destinationLatitude
      );

    const destinationLng =
      toNumber(
        destinationLongitude
      );

    if (
      !pickupAddress ||
      !destinationAddress
    ) {
      return res
        .status(400)
        .json({
          success:
            false,

          message:
            "Pickup address and destination address are required.",
        });
    }

    if (
      pickupLat === null ||
      pickupLng === null ||
      destinationLat ===
        null ||
      destinationLng ===
        null
    ) {
      return res
        .status(400)
        .json({
          success:
            false,

          message:
            "Valid pickup and destination coordinates are required.",
        });
    }

    if (
      pickupLat < -90 ||
      pickupLat > 90 ||
      destinationLat <
        -90 ||
      destinationLat >
        90 ||
      pickupLng < -180 ||
      pickupLng > 180 ||
      destinationLng <
        -180 ||
      destinationLng >
        180
    ) {
      return res
        .status(400)
        .json({
          success:
            false,

          message:
            "Invalid pickup or destination coordinates.",
        });
    }

    const normalizedPaymentMethod =
      String(
        paymentMethod ||
          "WALLET"
      )
        .trim()
        .toUpperCase();

    if (
      ![
        "WALLET",
        "CASH",
      ].includes(
        normalizedPaymentMethod
      )
    ) {
      return res
        .status(400)
        .json({
          success:
            false,

          message:
            "Payment method must be WALLET or CASH.",
        });
    }

    /*
     * Prevent customer from creating
     * another active Keke ride.
     */
    const existingRide =
      await KekeRide.findOne({
        customerId:
          customer._id,

        status: {
          $in: [
            "SEARCHING_DRIVER",
            "DRIVER_ASSIGNED",
            "DRIVER_COMING",
            "DRIVER_ARRIVED",
            "RIDE_STARTED",
          ],
        },
      });

    if (existingRide) {
      return res
        .status(409)
        .json({
          success:
            false,

          message:
            "You already have an active Keke ride.",

          ride: {
            id:
              existingRide._id,

            reference:
              existingRide
                .rideReference,

            status:
              existingRide.status,
          },
        });
    }

    /*
     * ===================================================
     * DISTANCE
     * ===================================================
     */

    const estimatedDistanceKm =
      calculateDistanceKm(
        pickupLat,
        pickupLng,
        destinationLat,
        destinationLng
      );

    const estimatedDurationMinutes =
      calculateEstimatedDuration(
        estimatedDistanceKm
      );

    /*
     * ===================================================
     * EFFECTIVE FARE SETTING
     * ===================================================
     *
     * Priority:
     *
     * request state
     * -> customer state
     * -> global pricing
     */

    const pricingState =
      String(
        state ||
          customer.state ||
          ""
      )
        .trim();

    const fareSetting =
      await getEffectiveFareSetting({
        state:
          pricingState ||
          null,
      });

    /*
     * ===================================================
     * REAL FARE CALCULATION
     * ===================================================
     *
     * No waiting charge at order time.
     */
    const fare =
      calculateFare({
        distanceKm:
          estimatedDistanceKm,

        waitingMinutes:
          0,

        setting:
          fareSetting,
      });

    /*
     * Search radius comes from Admin fare settings.
     */
    const maxSearchDistanceMetres =
      Math.max(
        1,
        Number(
          fareSetting
            .maxSearchDistanceKm ||
            15
        )
      ) * 1000;

    /*
     * Driver offer time also comes
     * from Admin fare settings.
     */
    const driverOfferSeconds =
      Math.max(
        10,
        Number(
          fareSetting
            .driverOfferSeconds ||
            60
        )
      );

    /*
     * ===================================================
     * WALLET CHECK
     * ===================================================
     *
     * No debit yet.
     * We only make sure the customer
     * can afford the estimated fare.
     */

    if (
      normalizedPaymentMethod ===
        "WALLET" &&
      Number(
        customer.walletBalance ||
          0
      ) <
        Number(
          fare.totalFare ||
            0
        )
    ) {
      return res
        .status(400)
        .json({
          success:
            false,

          message:
            "Insufficient wallet balance for this ride.",

          requiredAmount:
            fare.totalFare,

          walletBalance:
            Number(
              customer.walletBalance ||
                0
            ),
        });
    }

    /*
     * ===================================================
     * FIND NEAREST DRIVER
     * ===================================================
     */

    const nearestDriver =
      await findNearestKekeDriver({
        pickupLatitude:
          pickupLat,

        pickupLongitude:
          pickupLng,

        maxDistanceMetres:
          maxSearchDistanceMetres,
      });

    const rideReference =
      generateRideReference();

    const rideOtp =
      generateRideOtp();

    /*
     * ===================================================
     * CREATE RIDE
     * ===================================================
     */

    const ride =
      await KekeRide.create({
        customerId:
          customer._id,

        rideReference,

        pickup: {
          address:
            String(
              pickupAddress
            ).trim(),

          location: {
            type:
              "Point",

            coordinates: [
              pickupLng,
              pickupLat,
            ],
          },
        },

        destination: {
          address:
            String(
              destinationAddress
            ).trim(),

          location: {
            type:
              "Point",

            coordinates: [
              destinationLng,
              destinationLat,
            ],
          },
        },

        customerName:
          customer.fullName,

        customerPhone:
          customer.phone,

        estimatedDistanceKm:
          Number(
            estimatedDistanceKm
              .toFixed(2)
          ),

        estimatedDurationMinutes,

        /*
         * Real pricing values.
         */
        baseFare:
          fare.baseFare,

        distanceFare:
          fare.distanceFare,

        waitingFare:
          fare.waitingFare,

        serviceFee:
          0,

        totalFare:
          fare.totalFare,

        /*
         * Commission snapshot.
         *
         * These fields will be added to the
         * model in the next step if not
         * already present.
         */
        servicePayCommissionPercent:
          fare
            .servicePayCommissionPercent,

        servicePayCommission:
          fare
            .servicePayCommission,

        driverEarning:
          fare.driverEarning,

        paymentMethod:
          normalizedPaymentMethod,

        paymentStatus:
          "PENDING",

        rideOtp,

        rideOtpVerified:
          false,

        status:
          nearestDriver
            ? "DRIVER_ASSIGNED"
            : "NO_DRIVER_FOUND",
      });

    /*
     * ===================================================
     * ASSIGN NEAREST DRIVER
     * ===================================================
     */

    if (nearestDriver) {
      ride.assignDriver(
        nearestDriver
      );

      ride.currentOfferExpiresAt =
        new Date(
          Date.now() +
            driverOfferSeconds *
              1000
        );

      ride.offeredDriverIds.push(
        nearestDriver._id
      );

      await ride.save();

      /*
       * Reserve driver temporarily.
       */
      nearestDriver.riderCurrentJobId =
        ride._id;

      nearestDriver.availabilityStatus =
        "BUSY";

      nearestDriver
        .totalAssignedDeliveries =
        Number(
          nearestDriver
            .totalAssignedDeliveries ||
            0
        ) + 1;

      await nearestDriver.save();
    }

    /*
     * ===================================================
     * RESPONSE
     * ===================================================
     */

    const responseRide = {
      id:
        ride._id,

      reference:
        ride.rideReference,

      status:
        ride.status,

      pickup: {
        address:
          ride.pickup.address,

        latitude:
          ride.pickup
            .location
            .coordinates[1],

        longitude:
          ride.pickup
            .location
            .coordinates[0],
      },

      destination: {
        address:
          ride.destination
            .address,

        latitude:
          ride.destination
            .location
            .coordinates[1],

        longitude:
          ride.destination
            .location
            .coordinates[0],
      },

      pricing: {
        scopeType:
          fareSetting.scopeType,

        state:
          fareSetting.state,

        baseFare:
          fare.baseFare,

        minimumFare:
          fare.minimumFare,

        pricePerKm:
          fare.pricePerKm,

        waitingFeePerMinute:
          fare
            .waitingFeePerMinute,

        servicePayCommissionPercent:
          fare
            .servicePayCommissionPercent,

        driverSharePercent:
          100 -
          fare
            .servicePayCommissionPercent,
      },

      estimatedDistanceKm:
        fare.distanceKm,

      estimatedDurationMinutes:
        ride
          .estimatedDurationMinutes,

      fare: {
        baseFare:
          fare.baseFare,

        distanceFare:
          fare.distanceFare,

        waitingFare:
          fare.waitingFare,

        totalFare:
          fare.totalFare,

        servicePayCommission:
          fare
            .servicePayCommission,

        driverEarning:
          fare.driverEarning,
      },

      paymentMethod:
        ride.paymentMethod,

      paymentStatus:
        ride.paymentStatus,

      driverOfferSeconds:
        nearestDriver
          ? driverOfferSeconds
          : null,

      driver:
        nearestDriver
          ? {
              id:
                nearestDriver._id,

              riderId:
                nearestDriver.riderId ||
                null,

              fullName:
                nearestDriver.fullName,

              phone:
                nearestDriver.phone,

              vehicleType:
                nearestDriver
                  .vehicleType,

              plateNumber:
                nearestDriver
                  .plateNumber ||
                null,

              rating:
                nearestDriver
                  .riderRating ||
                0,

              location:
                nearestDriver
                    .riderCurrentLocation
                  ? {
                      latitude:
                        nearestDriver
                          .riderCurrentLocation
                          .coordinates[1],

                      longitude:
                        nearestDriver
                          .riderCurrentLocation
                          .coordinates[0],
                    }
                  : null,

              offerExpiresAt:
                ride
                  .currentOfferExpiresAt,
            }
          : null,
    };

    if (!nearestDriver) {
      return res
        .status(201)
        .json({
          success:
            true,

          message:
            "Keke ride created, but no nearby driver is currently available.",

          ride:
            responseRide,
        });
    }

    return res
      .status(201)
      .json({
        success:
          true,

        message:
          `Nearest Keke driver found. Driver has ${driverOfferSeconds} seconds to respond.`,

        ride:
          responseRide,
      });
  } catch (error) {
    console.error(
      "CREATE KEKE RIDE ERROR:",
      error
    );

    return res
      .status(500)
      .json({
        success:
          false,

        message:
          "Unable to create Keke ride.",
      });
  }
};

/*
 * =====================================================
 * CUSTOMER - GET ACTIVE RIDE
 * =====================================================
 */

exports.getCustomerActiveRide =
  async (
    req,
    res
  ) => {
    try {
      const ride =
        await KekeRide.findOne({
          customerId:
            req.user._id,

          status: {
            $in: [
              "SEARCHING_DRIVER",
              "DRIVER_ASSIGNED",
              "DRIVER_COMING",
              "DRIVER_ARRIVED",
              "RIDE_STARTED",
            ],
          },
        })
          .populate(
            "driverId",
            [
              "fullName",
              "phone",
              "riderId",
              "vehicleType",
              "plateNumber",
              "riderRating",
              "riderCurrentLocation",
              "riderLocationUpdatedAt",
            ].join(" ")
          )
          .sort({
            createdAt:
              -1,
          });

      if (!ride) {
        return res
          .status(200)
          .json({
            success:
              true,

            ride:
              null,

            message:
              "No active Keke ride.",
          });
      }

      return res
        .status(200)
        .json({
          success:
            true,

          ride,
        });
    } catch (error) {
      console.error(
        "GET ACTIVE KEKE RIDE ERROR:",
        error
      );

      return res
        .status(500)
        .json({
          success:
            false,

          message:
            "Unable to load active Keke ride.",
        });
    }
  };

/*
 * =====================================================
 * CUSTOMER - GET RIDE DETAILS
 * =====================================================
 */

exports.getRideDetails = async (
  req,
  res
) => {
  try {
    const ride =
      await KekeRide.findById(
        req.params.rideId
      )
        .populate(
          "customerId",
          "fullName phone"
        )
        .populate(
          "driverId",
          [
            "fullName",
            "phone",
            "riderId",
            "vehicleType",
            "plateNumber",
            "riderRating",
            "riderRatingCount",
            "riderCurrentLocation",
            "riderLocationUpdatedAt",
          ].join(" ")
        );

    if (!ride) {
      return res
        .status(404)
        .json({
          success:
            false,

          message:
            "Keke ride not found.",
        });
    }

    const requesterId =
      String(
        req.user._id
      );

    const customerId =
      String(
        ride.customerId?._id ||
          ride.customerId
      );

    const driverId =
      ride.driverId
        ? String(
            ride.driverId?._id ||
              ride.driverId
          )
        : null;

    const isCustomer =
      requesterId ===
      customerId;

    const isDriver =
      driverId &&
      requesterId ===
        driverId;

    const isAdmin =
      [
        "HEAD_OFFICE",
        "STAFF",
      ].includes(
        req.user.role
      );

    if (
      !isCustomer &&
      !isDriver &&
      !isAdmin
    ) {
      return res
        .status(403)
        .json({
          success:
            false,

          message:
            "You are not allowed to view this ride.",
        });
    }

    return res
      .status(200)
      .json({
        success:
          true,

        ride,
      });
  } catch (error) {
    console.error(
      "GET KEKE RIDE DETAILS ERROR:",
      error
    );

    return res
      .status(500)
      .json({
        success:
          false,

        message:
          "Unable to load Keke ride details.",
      });
  }
};
/*
 * =====================================================
 * DRIVER - GET CURRENT RIDE OFFER / JOB
 * =====================================================
 */

exports.getDriverCurrentRide =
  async (
    req,
    res
  ) => {
    try {
      const driver =
        await User.findById(
          req.user._id
        );

      if (!driver) {
        return res
          .status(404)
          .json({
            success: false,
            message:
              "Driver account not found.",
          });
      }

      if (
        driver.role !==
        "DELIVERY_RIDER"
      ) {
        return res
          .status(403)
          .json({
            success: false,
            message:
              "Only riders can access this endpoint.",
          });
      }

      const ride =
        await KekeRide.findOne({
          driverId:
            driver._id,

          status: {
            $in: [
              "DRIVER_ASSIGNED",
              "DRIVER_COMING",
              "DRIVER_ARRIVED",
              "RIDE_STARTED",
            ],
          },
        }).sort({
          createdAt: -1,
        });

      return res
        .status(200)
        .json({
          success: true,
          ride:
            ride || null,
        });
    } catch (error) {
      console.error(
        "GET DRIVER CURRENT KEKE RIDE ERROR:",
        error
      );

      return res
        .status(500)
        .json({
          success: false,
          message:
            "Unable to load driver ride.",
        });
    }
  };

/*
 * =====================================================
 * DRIVER - ACCEPT RIDE
 * =====================================================
 */

exports.acceptRide = async (
  req,
  res
) => {
  try {
    const driver =
      await User.findById(
        req.user._id
      );

    if (!driver) {
      return res
        .status(404)
        .json({
          success: false,
          message:
            "Driver account not found.",
        });
    }

    if (
      driver.role !==
      "DELIVERY_RIDER"
    ) {
      return res
        .status(403)
        .json({
          success: false,
          message:
            "Only riders can accept Keke rides.",
        });
    }

    const ride =
      await KekeRide.findById(
        req.params.rideId
      );

    if (!ride) {
      return res
        .status(404)
        .json({
          success: false,
          message:
            "Keke ride not found.",
        });
    }

    if (
      String(
        ride.driverId
      ) !==
      String(
        driver._id
      )
    ) {
      return res
        .status(403)
        .json({
          success: false,
          message:
            "This ride was not assigned to you.",
        });
    }

    if (
      ride.status !==
      "DRIVER_ASSIGNED"
    ) {
      return res
        .status(409)
        .json({
          success: false,
          message:
            `Ride cannot be accepted while status is ${ride.status}.`,
        });
    }

    if (
      ride.currentOfferExpiresAt &&
      new Date() >
        ride.currentOfferExpiresAt
    ) {
      return res
        .status(409)
        .json({
          success: false,
          message:
            "This ride offer has expired.",
        });
    }

    ride.markDriverAccepted();

    await ride.save();

    driver.availabilityStatus =
      "BUSY";

    driver.riderCurrentJobId =
      ride._id;

    driver.totalAcceptedDeliveries =
      Number(
        driver.totalAcceptedDeliveries ||
          0
      ) + 1;

    await driver.save();

    return res
      .status(200)
      .json({
        success: true,

        message:
          "Keke ride accepted successfully.",

        ride: {
          id:
            ride._id,

          reference:
            ride.rideReference,

          status:
            ride.status,

          pickup:
            ride.pickup,

          destination:
            ride.destination,

          customerName:
            ride.customerName,

          customerPhone:
            ride.customerPhone,

          totalFare:
            ride.totalFare,

          driverEarning:
            ride.driverEarning,

          servicePayCommission:
            ride.servicePayCommission,
        },
      });
  } catch (error) {
    console.error(
      "ACCEPT KEKE RIDE ERROR:",
      error
    );

    return res
      .status(500)
      .json({
        success: false,
        message:
          "Unable to accept Keke ride.",
      });
  }
};

/*
 * =====================================================
 * DRIVER - MARK ARRIVED
 * =====================================================
 */

exports.markArrived = async (
  req,
  res
) => {
  try {
    const ride =
      await KekeRide.findById(
        req.params.rideId
      );

    if (!ride) {
      return res
        .status(404)
        .json({
          success: false,
          message:
            "Keke ride not found.",
        });
    }

    if (
      String(
        ride.driverId
      ) !==
      String(
        req.user._id
      )
    ) {
      return res
        .status(403)
        .json({
          success: false,
          message:
            "This ride is not assigned to you.",
        });
    }

    if (
      ride.status !==
      "DRIVER_COMING"
    ) {
      return res
        .status(409)
        .json({
          success: false,
          message:
            "Driver can only mark arrival while coming to pickup.",
        });
    }

    ride.markDriverArrived();

    await ride.save();

    return res
      .status(200)
      .json({
        success: true,

        message:
          "Driver arrival confirmed.",

        ride: {
          id:
            ride._id,

          status:
            ride.status,

          arrivedAt:
            ride.driverArrivedAt,
        },
      });
  } catch (error) {
    console.error(
      "KEKE DRIVER ARRIVED ERROR:",
      error
    );

    return res
      .status(500)
      .json({
        success: false,
        message:
          "Unable to mark driver arrival.",
      });
  }
};

/*
 * =====================================================
 * DRIVER - START RIDE WITH OTP
 * =====================================================
 */

exports.startRide = async (
  req,
  res
) => {
  try {
    const {
      otp,
    } = req.body || {};

    if (!otp) {
      return res
        .status(400)
        .json({
          success: false,
          message:
            "Ride OTP is required.",
        });
    }

    if (
      !/^\d{4}$/.test(
        String(
          otp
        ).trim()
      )
    ) {
      return res
        .status(400)
        .json({
          success: false,
          message:
            "Ride OTP must contain exactly 4 digits.",
        });
    }

    const ride =
      await KekeRide.findById(
        req.params.rideId
      ).select(
        "+rideOtp"
      );

    if (!ride) {
      return res
        .status(404)
        .json({
          success: false,
          message:
            "Keke ride not found.",
        });
    }

    if (
      String(
        ride.driverId
      ) !==
      String(
        req.user._id
      )
    ) {
      return res
        .status(403)
        .json({
          success: false,
          message:
            "This ride is not assigned to you.",
        });
    }

    if (
      ride.status !==
      "DRIVER_ARRIVED"
    ) {
      return res
        .status(409)
        .json({
          success: false,
          message:
            "Ride can only start after driver arrival.",
        });
    }

    if (
      String(
        ride.rideOtp
      ) !==
      String(
        otp
      ).trim()
    ) {
      return res
        .status(400)
        .json({
          success: false,
          message:
            "Incorrect ride OTP.",
        });
    }

    ride.markRideStarted();

    await ride.save();

    return res
      .status(200)
      .json({
        success: true,

        message:
          "Keke ride started successfully.",

        ride: {
          id:
            ride._id,

          reference:
            ride.rideReference,

          status:
            ride.status,

          startedAt:
            ride.rideStartedAt,
        },
      });
  } catch (error) {
    console.error(
      "START KEKE RIDE ERROR:",
      error
    );

    return res
      .status(500)
      .json({
        success: false,
        message:
          "Unable to start Keke ride.",
      });
  }
};

/*
 * =====================================================
 * DRIVER - COMPLETE RIDE
 * =====================================================
 */

exports.completeRide = async (
  req,
  res
) => {
  try {
    const ride =
      await KekeRide.findById(
        req.params.rideId
      );

    if (!ride) {
      return res
        .status(404)
        .json({
          success: false,
          message:
            "Keke ride not found.",
        });
    }

    if (
      String(
        ride.driverId
      ) !==
      String(
        req.user._id
      )
    ) {
      return res
        .status(403)
        .json({
          success: false,
          message:
            "This ride is not assigned to you.",
        });
    }

    if (
      ride.status !==
      "RIDE_STARTED"
    ) {
      return res
        .status(409)
        .json({
          success: false,
          message:
            "Only a started ride can be completed.",
        });
    }

    const driver =
      await User.findById(
        req.user._id
      );

    const customer =
      await User.findById(
        ride.customerId
      );

    if (
      !driver ||
      !customer
    ) {
      return res
        .status(404)
        .json({
          success: false,
          message:
            "Customer or driver account not found.",
        });
    }

    /*
     * ===================================================
     * FINAL COMMISSION VALUES
     * ===================================================
     *
     * These values were snapshotted when
     * the ride was created.
     */

    const totalFare =
      Math.max(
        0,
        Number(
          ride.totalFare ||
            0
        )
      );

    const commissionPercent =
      Math.min(
        100,
        Math.max(
          0,
          Number(
            ride
              .servicePayCommissionPercent ||
              0
          )
        )
      );

    let servicePayCommission =
      Number(
        ride.servicePayCommission ||
          0
      );

    let driverEarning =
      Number(
        ride.driverEarning ||
          0
      );

    /*
     * Backward compatibility for old rides
     * created before commission fields existed.
     */
    if (
      servicePayCommission <=
        0 &&
      commissionPercent >
        0
    ) {
      servicePayCommission =
        Math.round(
          totalFare *
            (
              commissionPercent /
              100
            )
        );
    }

    if (
      driverEarning <= 0
    ) {
      driverEarning =
        Math.max(
          0,
          totalFare -
            servicePayCommission
        );
    }

    ride.servicePayCommission =
      servicePayCommission;

    ride.driverEarning =
      driverEarning;

    /*
     * ===================================================
     * WALLET PAYMENT
     * ===================================================
     */

    if (
      ride.paymentMethod ===
        "WALLET" &&
      ride.paymentStatus !==
        "PAID"
    ) {
      if (
        Number(
          customer.walletBalance ||
            0
        ) <
        totalFare
      ) {
        return res
          .status(400)
          .json({
            success: false,

            message:
              "Customer wallet balance is insufficient to complete payment.",

            totalFare,

            walletBalance:
              Number(
                customer.walletBalance ||
                  0
              ),
          });
      }

      /*
       * Debit customer the full ride fare.
       */
      customer.walletBalance =
        Number(
          customer.walletBalance ||
            0
        ) -
        totalFare;

      /*
       * Rider gets ONLY driver share.
       */
      driver.totalRiderEarnings =
        Number(
          driver.totalRiderEarnings ||
            0
        ) +
        driverEarning;

      driver.pendingRiderSettlement =
        Number(
          driver.pendingRiderSettlement ||
            0
        ) +
        driverEarning;

      ride.paymentStatus =
        "PAID";

      await customer.save();
    } else if (
      ride.paymentMethod ===
        "CASH"
    ) {
      /*
       * For CASH:
       *
       * Customer physically pays the driver.
       *
       * We still record the fare and commission,
       * but we do NOT add driverEarning to
       * pending settlement because ServicePay
       * did not collect the cash.
       *
       * Later we can build a commission debt /
       * driver wallet deduction system for CASH.
       */
      ride.paymentStatus =
        "PAID";
    }

    ride.markRideCompleted();

    driver.riderCurrentJobId =
      null;

    driver.availabilityStatus =
      "ONLINE";

    driver.totalCompletedDeliveries =
      Number(
        driver.totalCompletedDeliveries ||
          0
      ) + 1;

    await driver.save();

    await ride.save();

    return res
      .status(200)
      .json({
        success: true,

        message:
          "Keke ride completed successfully.",

        ride: {
          id:
            ride._id,

          reference:
            ride.rideReference,

          status:
            ride.status,

          totalFare,

          servicePayCommissionPercent:
            ride
              .servicePayCommissionPercent,

          servicePayCommission,

          driverEarning,

          paymentMethod:
            ride.paymentMethod,

          paymentStatus:
            ride.paymentStatus,

          completedAt:
            ride.rideCompletedAt,
        },

        customer: {
          walletBalance:
            customer.walletBalance,
        },

        driver: {
          totalRiderEarnings:
            driver.totalRiderEarnings,

          pendingRiderSettlement:
            driver
              .pendingRiderSettlement,

          availabilityStatus:
            driver.availabilityStatus,
        },
      });
  } catch (error) {
    console.error(
      "COMPLETE KEKE RIDE ERROR:",
      error
    );

    return res
      .status(500)
      .json({
        success: false,
        message:
          "Unable to complete Keke ride.",
      });
  }
};

/*
 * =====================================================
 * CUSTOMER - CANCEL RIDE
 * =====================================================
 */

exports.cancelRide = async (
  req,
  res
) => {
  try {
    const ride =
      await KekeRide.findById(
        req.params.rideId
      );

    if (!ride) {
      return res
        .status(404)
        .json({
          success: false,
          message:
            "Keke ride not found.",
        });
    }

    if (
      String(
        ride.customerId
      ) !==
      String(
        req.user._id
      )
    ) {
      return res
        .status(403)
        .json({
          success: false,
          message:
            "Only the customer who created this ride can cancel it.",
        });
    }

    if (
      [
        "RIDE_STARTED",
        "RIDE_COMPLETED",
        "CANCELLED",
      ].includes(
        ride.status
      )
    ) {
      return res
        .status(409)
        .json({
          success: false,
          message:
            `Ride cannot be cancelled while status is ${ride.status}.`,
        });
    }

    const {
      reason,
    } = req.body || {};

    if (
      ride.driverId
    ) {
      const driver =
        await User.findById(
          ride.driverId
        );

      if (driver) {
        driver.riderCurrentJobId =
          null;

        if (
          driver.status ===
            "ACTIVE" &&
          driver
            .riderVerificationStatus ===
            "VERIFIED"
        ) {
          driver.availabilityStatus =
            "ONLINE";
        } else {
          driver.availabilityStatus =
            "OFFLINE";
        }

        await driver.save();
      }
    }

    ride.cancelRide({
      cancelledBy:
        "CUSTOMER",

      reason:
        reason
          ? String(
              reason
            ).trim()
          : "Cancelled by customer.",
    });

    await ride.save();

    return res
      .status(200)
      .json({
        success: true,

        message:
          "Keke ride cancelled successfully.",

        ride: {
          id:
            ride._id,

          reference:
            ride.rideReference,

          status:
            ride.status,
        },
      });
  } catch (error) {
    console.error(
      "CANCEL KEKE RIDE ERROR:",
      error
    );

    return res
      .status(500)
      .json({
        success: false,
        message:
          "Unable to cancel Keke ride.",
      });
  }
};

/*
 * =====================================================
 * CUSTOMER - GET DRIVER LIVE LOCATION
 * =====================================================
 */

exports.getDriverLiveLocation =
  async (
    req,
    res
  ) => {
    try {
      const ride =
        await KekeRide.findById(
          req.params.rideId
        );

      if (!ride) {
        return res
          .status(404)
          .json({
            success: false,
            message:
              "Keke ride not found.",
          });
      }

      if (
        String(
          ride.customerId
        ) !==
        String(
          req.user._id
        )
      ) {
        return res
          .status(403)
          .json({
            success: false,
            message:
              "You are not allowed to track this driver.",
          });
      }

      if (
        !ride.driverId
      ) {
        return res
          .status(200)
          .json({
            success: true,

            driverAssigned:
              false,

            location:
              null,

            rideStatus:
              ride.status,
          });
      }

      const driver =
        await User.findById(
          ride.driverId
        ).select(
          [
            "fullName",
            "phone",
            "riderId",
            "plateNumber",
            "vehicleType",
            "riderRating",
            "riderCurrentLocation",
            "riderLocationUpdatedAt",
          ].join(" ")
        );

      if (!driver) {
        return res
          .status(404)
          .json({
            success: false,
            message:
              "Assigned driver not found.",
          });
      }

      const coordinates =
        driver
          .riderCurrentLocation
          ?.coordinates;

      const hasLocation =
        Array.isArray(
          coordinates
        ) &&
        coordinates.length ===
          2;

      return res
        .status(200)
        .json({
          success: true,

          driverAssigned:
            true,

          driver: {
            id:
              driver._id,

            riderId:
              driver.riderId ||
              null,

            fullName:
              driver.fullName,

            phone:
              driver.phone,

            plateNumber:
              driver.plateNumber ||
              null,

            vehicleType:
              driver.vehicleType ||
              null,

            rating:
              driver.riderRating ||
              0,
          },

          location:
            hasLocation
              ? {
                  latitude:
                    coordinates[1],

                  longitude:
                    coordinates[0],

                  updatedAt:
                    driver
                      .riderLocationUpdatedAt ||
                    null,
                }
              : null,

          rideStatus:
            ride.status,
        });
    } catch (error) {
      console.error(
        "GET DRIVER LIVE LOCATION ERROR:",
        error
      );

      return res
        .status(500)
        .json({
          success: false,
          message:
            "Unable to load driver location.",
        });
    }
  };

/*
 * =====================================================
 * CUSTOMER - RIDE HISTORY
 * =====================================================
 */

exports.getCustomerRideHistory =
  async (
    req,
    res
  ) => {
    try {
      const rides =
        await KekeRide.find({
          customerId:
            req.user._id,
        })
          .sort({
            createdAt: -1,
          })
          .limit(50)
          .select(
            "-rideOtp"
          );

      return res
        .status(200)
        .json({
          success: true,

          count:
            rides.length,

          rides,
        });
    } catch (error) {
      console.error(
        "GET KEKE RIDE HISTORY ERROR:",
        error
      );

      return res
        .status(500)
        .json({
          success: false,
          message:
            "Unable to load Keke ride history.",
        });
    }
  };