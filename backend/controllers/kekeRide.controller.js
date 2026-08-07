const crypto = require("crypto");

const User = require(
  "../models/user.model"
);

const KekeRide = require(
  "../models/kekeRide.model"
);

/*
 * =====================================================
 * HELPERS
 * =====================================================
 */

const toNumber = (value) => {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return null;
  }

  return number;
};

const generateRideReference = () => {
  const stamp = Date.now()
    .toString()
    .slice(-8);

  const random = crypto
    .randomBytes(3)
    .toString("hex")
    .toUpperCase();

  return `KEKE-${stamp}-${random}`;
};

const generateRideOtp = () => {
  return String(
    Math.floor(
      1000 + Math.random() * 9000
    )
  );
};

const calculateDistanceKm = (
  lat1,
  lng1,
  lat2,
  lng2
) => {
  const earthRadiusKm = 6371;

  const toRadians = (degree) =>
    (degree * Math.PI) / 180;

  const dLat =
    toRadians(lat2 - lat1);

  const dLng =
    toRadians(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) *
      Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c =
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    );

  return earthRadiusKm * c;
};

const calculateEstimatedFare = (
  distanceKm
) => {
  /*
   * Temporary ServicePay Keke pricing.
   *
   * We can later move this to
   * Admin Settings.
   */
  const baseFare = 300;

  const perKm = 150;

  const distanceFare =
    Math.max(
      0,
      distanceKm
    ) * perKm;

  const serviceFee = 50;

  const totalFare =
    baseFare +
    distanceFare +
    serviceFee;

  return {
    baseFare:
      Math.round(baseFare),

    distanceFare:
      Math.round(distanceFare),

    serviceFee:
      Math.round(serviceFee),

    waitingFare: 0,

    totalFare:
      Math.round(totalFare),
  };
};

const calculateEstimatedDuration =
  (distanceKm) => {
    /*
     * Simple initial estimate:
     * average Keke speed ~25 km/h.
     */
    if (
      !distanceKm ||
      distanceKm <= 0
    ) {
      return 0;
    }

    const hours =
      distanceKm / 25;

    return Math.max(
      1,
      Math.ceil(hours * 60)
    );
  };

const getFreshLocationCutoff = () => {
  return new Date(
    Date.now() -
      5 * 60 * 1000
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
    maxDistanceMetres = 15000,
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
      excludedDriverIds.length > 0
    ) {
      query._id = {
        $nin:
          excludedDriverIds,
      };
    }

    return User.findOne(query);
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
 *   "pickupAddress": "Zoo Road, Kano",
 *   "pickupLatitude": 12.0022,
 *   "pickupLongitude": 8.5920,
 *
 *   "destinationAddress": "Farm Centre, Kano",
 *   "destinationLatitude": 11.9890,
 *   "destinationLongitude": 8.5650,
 *
 *   "paymentMethod": "WALLET"
 * }
 */
exports.createRide = async (
  req,
  res
) => {
  try {
    const customer = await User.findById(
      req.user._id
    );

    if (!customer) {
      return res.status(404).json({
        success: false,
        message:
          "Customer account not found.",
      });
    }

    if (
      customer.status !== "ACTIVE"
    ) {
      return res.status(403).json({
        success: false,
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

      paymentMethod = "WALLET",
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
      return res.status(400).json({
        success: false,
        message:
          "Pickup address and destination address are required.",
      });
    }

    if (
      pickupLat === null ||
      pickupLng === null ||
      destinationLat === null ||
      destinationLng === null
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Valid pickup and destination coordinates are required.",
      });
    }

    if (
      pickupLat < -90 ||
      pickupLat > 90 ||
      destinationLat < -90 ||
      destinationLat > 90 ||
      pickupLng < -180 ||
      pickupLng > 180 ||
      destinationLng < -180 ||
      destinationLng > 180
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid pickup or destination coordinates.",
      });
    }

    const normalizedPaymentMethod =
      String(
        paymentMethod || "WALLET"
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
      return res.status(400).json({
        success: false,
        message:
          "Payment method must be WALLET or CASH.",
      });
    }

    /*
     * Prevent customer from creating
     * another active ride.
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
      return res.status(409).json({
        success: false,

        message:
          "You already have an active Keke ride.",

        ride: {
          id:
            existingRide._id,

          reference:
            existingRide.rideReference,

          status:
            existingRide.status,
        },
      });
    }

    const estimatedDistanceKm =
      calculateDistanceKm(
        pickupLat,
        pickupLng,
        destinationLat,
        destinationLng
      );

    const fare =
      calculateEstimatedFare(
        estimatedDistanceKm
      );

    const estimatedDurationMinutes =
      calculateEstimatedDuration(
        estimatedDistanceKm
      );

    /*
     * If wallet payment is selected,
     * make sure customer has enough.
     *
     * We are NOT debiting yet.
     * Debit will happen at the
     * proper payment stage.
     */
    if (
      normalizedPaymentMethod ===
        "WALLET" &&
      Number(
        customer.walletBalance || 0
      ) < fare.totalFare
    ) {
      return res.status(400).json({
        success: false,

        message:
          "Insufficient wallet balance for this ride.",

        requiredAmount:
          fare.totalFare,

        walletBalance:
          Number(
            customer.walletBalance || 0
          ),
      });
    }

    /*
     * Find nearest online Keke driver.
     */
    const nearestDriver =
      await findNearestKekeDriver({
        pickupLatitude:
          pickupLat,

        pickupLongitude:
          pickupLng,

        maxDistanceMetres:
          15000,
      });

    const rideReference =
      generateRideReference();

    const rideOtp =
      generateRideOtp();

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
            estimatedDistanceKm.toFixed(
              2
            )
          ),

        estimatedDurationMinutes,

        baseFare:
          fare.baseFare,

        distanceFare:
          fare.distanceFare,

        waitingFare:
          fare.waitingFare,

        serviceFee:
          fare.serviceFee,

        totalFare:
          fare.totalFare,

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

    if (nearestDriver) {
      ride.assignDriver(
        nearestDriver
      );

      /*
       * Driver has 20 seconds
       * to respond initially.
       */
      ride.currentOfferExpiresAt =
        new Date(
          Date.now() +
            20 * 1000
        );

      ride.offeredDriverIds.push(
        nearestDriver._id
      );

      await ride.save();

      /*
       * Reserve driver temporarily
       * for this ride offer.
       */
      nearestDriver.riderCurrentJobId =
        ride._id;

      nearestDriver.availabilityStatus =
        "BUSY";

      nearestDriver.totalAssignedDeliveries =
        Number(
          nearestDriver
            .totalAssignedDeliveries ||
            0
        ) + 1;

      await nearestDriver.save();
    }

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

      estimatedDistanceKm:
        ride.estimatedDistanceKm,

      estimatedDurationMinutes:
        ride.estimatedDurationMinutes,

      fare: {
        baseFare:
          ride.baseFare,

        distanceFare:
          ride.distanceFare,

        serviceFee:
          ride.serviceFee,

        waitingFare:
          ride.waitingFare,

        totalFare:
          ride.totalFare,
      },

      paymentMethod:
        ride.paymentMethod,

      paymentStatus:
        ride.paymentStatus,

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
                nearestDriver.vehicleType,

              plateNumber:
                nearestDriver.plateNumber ||
                null,

              rating:
                nearestDriver.riderRating ||
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
      return res.status(201).json({
        success: true,

        message:
          "Keke ride created, but no nearby driver is currently available.",

        ride:
          responseRide,
      });
    }

    return res.status(201).json({
      success: true,

      message:
        "Nearest Keke driver found and ride request sent.",

      ride:
        responseRide,
    });
  } catch (error) {
    console.error(
      "CREATE KEKE RIDE ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to create Keke ride.",
    });
  }
};

/*
 * =====================================================
 * CUSTOMER - GET ACTIVE RIDE
 * =====================================================
 *
 * GET /api/keke-rides/active
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
            createdAt: -1,
          });

      if (!ride) {
        return res.status(200).json({
          success: true,
          ride: null,
          message:
            "No active Keke ride.",
        });
      }

      return res.status(200).json({
        success: true,
        ride,
      });
    } catch (error) {
      console.error(
        "GET ACTIVE KEKE RIDE ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to load active Keke ride.",
      });
    }
  };

/*
 * =====================================================
 * CUSTOMER - GET RIDE DETAILS
 * =====================================================
 *
 * GET /api/keke-rides/:rideId
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
      return res.status(404).json({
        success: false,
        message:
          "Keke ride not found.",
      });
    }

    const requesterId =
      String(req.user._id);

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
      return res.status(403).json({
        success: false,
        message:
          "You are not allowed to view this ride.",
      });
    }

    return res.status(200).json({
      success: true,
      ride,
    });
  } catch (error) {
    console.error(
      "GET KEKE RIDE DETAILS ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to load Keke ride details.",
    });
  }
};

/*
 * =====================================================
 * DRIVER - GET CURRENT RIDE OFFER/JOB
 * =====================================================
 *
 * GET /api/keke-rides/driver/current
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
        return res.status(404).json({
          success: false,
          message:
            "Driver account not found.",
        });
      }

      if (
        driver.role !==
        "DELIVERY_RIDER"
      ) {
        return res.status(403).json({
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

      return res.status(200).json({
        success: true,
        ride:
          ride || null,
      });
    } catch (error) {
      console.error(
        "GET DRIVER CURRENT KEKE RIDE ERROR:",
        error
      );

      return res.status(500).json({
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
 *
 * POST /api/keke-rides/:rideId/accept
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
      return res.status(404).json({
        success: false,
        message:
          "Driver account not found.",
      });
    }

    if (
      driver.role !==
      "DELIVERY_RIDER"
    ) {
      return res.status(403).json({
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
      return res.status(404).json({
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
      return res.status(403).json({
        success: false,
        message:
          "This ride was not assigned to you.",
      });
    }

    if (
      ride.status !==
      "DRIVER_ASSIGNED"
    ) {
      return res.status(409).json({
        success: false,
        message:
          `Ride cannot be accepted while status is ${ride.status}.`,
      });
    }

    if (
      ride
        .currentOfferExpiresAt &&
      new Date() >
        ride
          .currentOfferExpiresAt
    ) {
      return res.status(409).json({
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
        driver
          .totalAcceptedDeliveries ||
          0
      ) + 1;

    await driver.save();

    return res.status(200).json({
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
      },
    });
  } catch (error) {
    console.error(
      "ACCEPT KEKE RIDE ERROR:",
      error
    );

    return res.status(500).json({
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
 *
 * POST /api/keke-rides/:rideId/arrived
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
      return res.status(404).json({
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
      return res.status(403).json({
        success: false,
        message:
          "This ride is not assigned to you.",
      });
    }

    if (
      ride.status !==
      "DRIVER_COMING"
    ) {
      return res.status(409).json({
        success: false,
        message:
          "Driver can only mark arrival while coming to pickup.",
      });
    }

    ride.markDriverArrived();

    await ride.save();

    return res.status(200).json({
      success: true,

      message:
        "Driver arrival confirmed.",

      ride: {
        id:
          ride._id,

        status:
          ride.status,
      },
    });
  } catch (error) {
    console.error(
      "KEKE DRIVER ARRIVED ERROR:",
      error
    );

    return res.status(500).json({
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
 *
 * POST /api/keke-rides/:rideId/start
 *
 * Body:
 *
 * {
 *   "otp": "1234"
 * }
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
      return res.status(400).json({
        success: false,
        message:
          "Ride OTP is required.",
      });
    }

    /*
     * rideOtp is select:false
     * so explicitly include it.
     */
    const ride =
      await KekeRide.findById(
        req.params.rideId
      ).select(
        "+rideOtp"
      );

    if (!ride) {
      return res.status(404).json({
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
      return res.status(403).json({
        success: false,
        message:
          "This ride is not assigned to you.",
      });
    }

    if (
      ride.status !==
      "DRIVER_ARRIVED"
    ) {
      return res.status(409).json({
        success: false,
        message:
          "Ride can only start after driver arrival.",
      });
    }

    if (
      String(
        ride.rideOtp
      ) !==
      String(otp).trim()
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Incorrect ride OTP.",
      });
    }

    ride.markRideStarted();

    await ride.save();

    return res.status(200).json({
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

    return res.status(500).json({
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
 *
 * POST /api/keke-rides/:rideId/complete
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
      return res.status(404).json({
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
      return res.status(403).json({
        success: false,
        message:
          "This ride is not assigned to you.",
      });
    }

    if (
      ride.status !==
      "RIDE_STARTED"
    ) {
      return res.status(409).json({
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
      return res.status(404).json({
        success: false,
        message:
          "Customer or driver account not found.",
      });
    }

    /*
     * WALLET PAYMENT
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
        Number(
          ride.totalFare || 0
        )
      ) {
        return res.status(400).json({
          success: false,

          message:
            "Customer wallet balance is insufficient to complete payment.",

          totalFare:
            ride.totalFare,

          walletBalance:
            customer.walletBalance,
        });
      }

      customer.walletBalance =
        Number(
          customer.walletBalance ||
            0
        ) -
        Number(
          ride.totalFare || 0
        );

      /*
       * Initial version:
       * full fare goes to rider earnings.
       *
       * We will later split
       * ServicePay commission.
       */
      driver.totalRiderEarnings =
        Number(
          driver
            .totalRiderEarnings ||
            0
        ) +
        Number(
          ride.totalFare || 0
        );

      driver.pendingRiderSettlement =
        Number(
          driver
            .pendingRiderSettlement ||
            0
        ) +
        Number(
          ride.totalFare || 0
        );

      ride.paymentStatus =
        "PAID";

      await customer.save();
    } else if (
      ride.paymentMethod ===
        "CASH"
    ) {
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
        driver
          .totalCompletedDeliveries ||
          0
      ) + 1;

    await driver.save();

    await ride.save();

    return res.status(200).json({
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

        totalFare:
          ride.totalFare,

        paymentMethod:
          ride.paymentMethod,

        paymentStatus:
          ride.paymentStatus,

        completedAt:
          ride.rideCompletedAt,
      },
    });
  } catch (error) {
    console.error(
      "COMPLETE KEKE RIDE ERROR:",
      error
    );

    return res.status(500).json({
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
 *
 * POST /api/keke-rides/:rideId/cancel
 *
 * Body:
 *
 * {
 *   "reason": "Changed my mind"
 * }
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
      return res.status(404).json({
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
      return res.status(403).json({
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
      return res.status(409).json({
        success: false,
        message:
          `Ride cannot be cancelled while status is ${ride.status}.`,
      });
    }

    const {
      reason,
    } = req.body || {};

    if (ride.driverId) {
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
          driver.riderVerificationStatus ===
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
          ? String(reason).trim()
          : "Cancelled by customer.",
    });

    await ride.save();

    return res.status(200).json({
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

    return res.status(500).json({
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
 *
 * GET /api/keke-rides/:rideId/driver-location
 *
 * The Flutter customer screen can call this
 * repeatedly until we add Socket.IO.
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
        return res.status(404).json({
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
        return res.status(403).json({
          success: false,
          message:
            "You are not allowed to track this driver.",
        });
      }

      if (!ride.driverId) {
        return res.status(200).json({
          success: true,
          driverAssigned:
            false,
          location:
            null,
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
        return res.status(404).json({
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
        coordinates.length === 2;

      return res.status(200).json({
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

      return res.status(500).json({
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
 *
 * GET /api/keke-rides/history
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

      return res.status(200).json({
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

      return res.status(500).json({
        success: false,
        message:
          "Unable to load Keke ride history.",
      });
    }
  };