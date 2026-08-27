const User = require("../models/user.model");
const RiderDeviceToken = require("../models/riderDeviceToken.model");

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

const normalizeAvailabilityStatus = (value) => {
  return String(value || "")
    .trim()
    .toUpperCase();
};

const requireDeliveryRider = async (req, res) => {
  const rider = await User.findById(req.user._id).select("role status");
  if (!rider || rider.role !== "DELIVERY_RIDER" || rider.status !== "ACTIVE") {
    res.status(403).json({ success: false, message: "Only active delivery riders can manage device registrations." });
    return null;
  }
  return rider;
};

exports.registerDeviceToken = async (req, res) => {
  try {
    const rider = await requireDeliveryRider(req, res);
    if (!rider) return;
    const token = String(req.body?.token || "").trim();
    const platform = String(req.body?.platform || "UNKNOWN").trim().toUpperCase();
    if (!token || token.length > 4096 || !["ANDROID", "IOS", "WEB", "UNKNOWN"].includes(platform)) {
      return res.status(400).json({ success: false, message: "A valid device token and platform are required." });
    }
    await RiderDeviceToken.findOneAndUpdate(
      { token },
      { $set: { riderId: rider._id, platform, active: true, lastSeenAt: new Date() } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return res.status(200).json({ success: true, message: "Device registered for delivery alerts." });
  } catch (_) {
    return res.status(500).json({ success: false, message: "Unable to register this device." });
  }
};

exports.removeDeviceToken = async (req, res) => {
  try {
    const rider = await requireDeliveryRider(req, res);
    if (!rider) return;
    const token = String(req.body?.token || "").trim();
    if (!token) return res.status(400).json({ success: false, message: "A device token is required." });
    await RiderDeviceToken.updateOne({ riderId: rider._id, token }, { $set: { active: false, lastSeenAt: new Date() } });
    return res.status(200).json({ success: true, message: "Device removed from delivery alerts." });
  } catch (_) {
    return res.status(500).json({ success: false, message: "Unable to remove this device." });
  }
};

/*
 * =====================================================
 * GET RIDER PROFILE
 * =====================================================
 *
 * GET /api/riders/me
 */
exports.getMyRiderProfile = async (
  req,
  res
) => {
  try {
    const rider = await User.findById(
      req.user._id
    ).select(
      [
        "fullName",
        "phone",
        "email",
        "role",
        "status",
        "riderId",
        "vehicleType",
        "plateNumber",
        "riderState",
        "riderLga",
        "riderAddress",
        "availabilityStatus",
        "riderVerificationStatus",
        "riderVerificationNote",
        "riderCurrentLocation",
        "riderLocationUpdatedAt",
        "riderCurrentJobId",
        "riderRating",
        "riderRatingCount",
        "totalRiderEarnings",
        "pendingRiderSettlement",
        "settledRiderEarnings",
        "totalAssignedDeliveries",
        "totalAcceptedDeliveries",
        "totalCompletedDeliveries",
        "totalRejectedDeliveries",
        "walletBalance",
      ].join(" ")
    );

    if (!rider) {
      return res.status(404).json({
        success: false,
        message: "Rider account not found.",
      });
    }

    if (
      rider.role !== "DELIVERY_RIDER"
    ) {
      return res.status(403).json({
        success: false,
        message:
          "This account is not a delivery rider.",
      });
    }

    return res.status(200).json({
      success: true,

      rider: {
        id: rider._id,

        riderId:
          rider.riderId || null,

        fullName:
          rider.fullName,

        phone:
          rider.phone,

        email:
          rider.email || null,

        role:
          rider.role,

        status:
          rider.status,

        vehicleType:
          rider.vehicleType || null,

        plateNumber:
          rider.plateNumber || null,

        state:
          rider.riderState || null,

        lga:
          rider.riderLga || null,

        address:
          rider.riderAddress || null,

        availabilityStatus:
          rider.availabilityStatus,

        verificationStatus:
          rider.riderVerificationStatus,

        verificationNote:
          rider.riderVerificationNote ||
          null,

        currentLocation:
          rider.riderCurrentLocation ||
          null,

        locationUpdatedAt:
          rider.riderLocationUpdatedAt ||
          null,

        currentJobId:
          rider.riderCurrentJobId ||
          null,

        rating:
          rider.riderRating || 0,

        ratingCount:
          rider.riderRatingCount || 0,

        totalRiderEarnings:
          rider.totalRiderEarnings || 0,

        pendingRiderSettlement:
          rider.pendingRiderSettlement ||
          0,

        settledRiderEarnings:
          rider.settledRiderEarnings ||
          0,

        totalAssignedDeliveries:
          rider.totalAssignedDeliveries ||
          0,

        totalAcceptedDeliveries:
          rider.totalAcceptedDeliveries ||
          0,

        totalCompletedDeliveries:
          rider.totalCompletedDeliveries ||
          0,

        totalRejectedDeliveries:
          rider.totalRejectedDeliveries ||
          0,

        walletBalance:
          rider.walletBalance || 0,
      },
    });
  } catch (error) {
    console.error(
      "GET RIDER PROFILE ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to load rider profile.",
    });
  }
};

/*
 * =====================================================
 * UPDATE RIDER LIVE LOCATION
 * =====================================================
 *
 * POST /api/riders/location
 *
 * Body:
 *
 * {
 *   "latitude": 12.0022,
 *   "longitude": 8.5920,
 *   "address": "Kano",
 *   "accuracy": 5,
 *   "heading": 120,
 *   "speed": 8
 * }
 */
exports.updateLocation = async (
  req,
  res
) => {
  try {
    const {
      latitude,
      longitude,
      address,
      accuracy,
      heading,
      speed,
    } = req.body || {};

    const lat =
      toNumber(latitude);

    const lng =
      toNumber(longitude);

    if (
      lat === null ||
      lng === null
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Latitude and longitude are required.",
      });
    }

    if (
      lat < -90 ||
      lat > 90
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid latitude.",
      });
    }

    if (
      lng < -180 ||
      lng > 180
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid longitude.",
      });
    }

    const rider = await User.findById(
      req.user._id
    );

    if (!rider) {
      return res.status(404).json({
        success: false,
        message:
          "Rider account not found.",
      });
    }

    if (
      rider.role !== "DELIVERY_RIDER"
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Only delivery riders can update rider location.",
      });
    }

    if (
      rider.status !== "ACTIVE"
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Your rider account is not active.",
      });
    }

    rider.setRiderLocation({
      latitude: lat,

      longitude: lng,

      address:
        address
          ? String(address).trim()
          : null,

      accuracy:
        accuracy === undefined ||
        accuracy === null
          ? null
          : toNumber(accuracy),

      heading:
        heading === undefined ||
        heading === null
          ? null
          : toNumber(heading),

      speed:
        speed === undefined ||
        speed === null
          ? null
          : toNumber(speed),
    });

    await rider.save();

    return res.status(200).json({
      success: true,

      message:
        "Rider location updated successfully.",

      location: {
        type: "Point",

        coordinates: [
          lng,
          lat,
        ],

        latitude: lat,

        longitude: lng,

        address:
          rider.riderCurrentLocation
            ?.address || null,

        accuracy:
          rider.riderCurrentLocation
            ?.accuracy ?? null,

        heading:
          rider.riderCurrentLocation
            ?.heading ?? null,

        speed:
          rider.riderCurrentLocation
            ?.speed ?? null,

        updatedAt:
          rider.riderLocationUpdatedAt,
      },
    });
  } catch (error) {
    console.error(
      "UPDATE RIDER LOCATION ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to update rider location.",
    });
  }
};

/*
 * =====================================================
 * UPDATE RIDER AVAILABILITY
 * =====================================================
 *
 * POST /api/riders/availability
 *
 * Body:
 *
 * {
 *   "status": "ONLINE"
 * }
 *
 * Allowed:
 * ONLINE
 * OFFLINE
 */
exports.updateAvailability = async (
  req,
  res
) => {
  try {
    const requestedStatus =
      normalizeAvailabilityStatus(
        req.body?.status
      );

    if (
      ![
        "ONLINE",
        "OFFLINE",
      ].includes(requestedStatus)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Status must be ONLINE or OFFLINE.",
      });
    }

    const rider = await User.findById(
      req.user._id
    );

    if (!rider) {
      return res.status(404).json({
        success: false,
        message:
          "Rider account not found.",
      });
    }

    if (
      rider.role !== "DELIVERY_RIDER"
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Only delivery riders can change rider availability.",
      });
    }

    if (
      rider.status !== "ACTIVE"
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Your account is not active.",
      });
    }

    /*
     * Rider must be verified before going online.
     */
    if (
      requestedStatus === "ONLINE" &&
      rider.riderVerificationStatus !==
        "VERIFIED"
    ) {
      return res.status(403).json({
        success: false,

        message:
          "Your rider account must be verified before you can go online.",

        verificationStatus:
          rider.riderVerificationStatus,
      });
    }

    /*
     * A rider handling an active job
     * must remain BUSY.
     */
    if (
      requestedStatus === "ONLINE" &&
      rider.riderCurrentJobId
    ) {
      return res.status(409).json({
        success: false,
        message:
          "You already have an active job.",
      });
    }

    rider.availabilityStatus =
      requestedStatus;

    if (
      requestedStatus === "ONLINE"
    ) {
      rider.riderLastOnlineAt =
        new Date();
    }

    await rider.save();

    return res.status(200).json({
      success: true,

      message:
        requestedStatus === "ONLINE"
          ? "You are now online and available for jobs."
          : "You are now offline.",

      availabilityStatus:
        rider.availabilityStatus,
    });
  } catch (error) {
    console.error(
      "UPDATE RIDER AVAILABILITY ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to update rider availability.",
    });
  }
};

/*
 * =====================================================
 * GET RIDER LIVE STATUS
 * =====================================================
 *
 * GET /api/riders/status
 */
exports.getRiderStatus = async (
  req,
  res
) => {
  try {
    const rider = await User.findById(
      req.user._id
    ).select(
      [
        "role",
        "status",
        "riderId",
        "vehicleType",
        "plateNumber",
        "availabilityStatus",
        "riderVerificationStatus",
        "riderCurrentLocation",
        "riderLocationUpdatedAt",
        "riderCurrentJobId",
      ].join(" ")
    );

    if (!rider) {
      return res.status(404).json({
        success: false,
        message:
          "Rider account not found.",
      });
    }

    if (
      rider.role !== "DELIVERY_RIDER"
    ) {
      return res.status(403).json({
        success: false,
        message:
          "This account is not a rider account.",
      });
    }

    const hasLocation =
      rider.hasValidRiderLocation();

    let latitude = null;
    let longitude = null;

    if (hasLocation) {
      longitude =
        rider.riderCurrentLocation
          .coordinates[0];

      latitude =
        rider.riderCurrentLocation
          .coordinates[1];
    }

    return res.status(200).json({
      success: true,

      rider: {
        riderId:
          rider.riderId || null,

        accountStatus:
          rider.status,

        verificationStatus:
          rider.riderVerificationStatus,

        availabilityStatus:
          rider.availabilityStatus,

        vehicleType:
          rider.vehicleType || null,

        plateNumber:
          rider.plateNumber || null,

        hasLocation,

        latitude,

        longitude,

        locationUpdatedAt:
          rider.riderLocationUpdatedAt ||
          null,

        currentJobId:
          rider.riderCurrentJobId ||
          null,

        canReceiveDelivery:
          rider.canReceiveDelivery(),

        canReceiveKekeRide:
          rider.canReceiveKekeRide(),
      },
    });
  } catch (error) {
    console.error(
      "GET RIDER STATUS ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to load rider status.",
    });
  }
};

/*
 * =====================================================
 * FIND NEARBY KEKE DRIVERS
 * =====================================================
 *
 * This will later be used internally when
 * a customer creates a ServicePay Keke ride.
 *
 * GET /api/riders/nearby-keke
 *
 * Query:
 *
 * latitude=12.0022
 * longitude=8.5920
 * radius=10000
 *
 * radius is in metres.
 */
exports.findNearbyKekeDrivers = async (
  req,
  res
) => {
  try {
    const latitude =
      toNumber(
        req.query.latitude
      );

    const longitude =
      toNumber(
        req.query.longitude
      );

    const requestedRadius =
      toNumber(
        req.query.radius
      );

    if (
      latitude === null ||
      longitude === null
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Latitude and longitude are required.",
      });
    }

    if (
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid latitude or longitude.",
      });
    }

    /*
     * Default search radius:
     * 10 kilometres.
     *
     * Maximum:
     * 30 kilometres.
     */
    let radius =
      requestedRadius || 10000;

    radius = Math.max(
      500,
      Math.min(
        radius,
        30000
      )
    );

    /*
     * Driver location must have been
     * refreshed recently.
     *
     * For now we accept locations
     * updated within the last
     * 5 minutes.
     */
    const locationFreshAfter =
      new Date(
        Date.now() -
          5 * 60 * 1000
      );

    const riders =
      await User.find({
        role: "DELIVERY_RIDER",

        status: "ACTIVE",

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
              type: "Point",

              coordinates: [
                longitude,
                latitude,
              ],
            },

            $maxDistance:
              radius,
          },
        },
      })
        .select(
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
        )
        .limit(10);

    const nearbyRiders =
      riders.map((rider) => {
        const coordinates =
          rider
            .riderCurrentLocation
            ?.coordinates || [];

        return {
          id:
            rider._id,

          riderId:
            rider.riderId || null,

          fullName:
            rider.fullName,

          vehicleType:
            rider.vehicleType,

          plateNumber:
            rider.plateNumber ||
            null,

          rating:
            rider.riderRating || 0,

          ratingCount:
            rider.riderRatingCount ||
            0,

          location: {
            latitude:
              coordinates.length === 2
                ? coordinates[1]
                : null,

            longitude:
              coordinates.length === 2
                ? coordinates[0]
                : null,

            updatedAt:
              rider
                .riderLocationUpdatedAt ||
              null,
          },
        };
      });

    return res.status(200).json({
      success: true,

      search: {
        latitude,
        longitude,
        radiusMetres:
          radius,
      },

      count:
        nearbyRiders.length,

      riders:
        nearbyRiders,
    });
  } catch (error) {
    console.error(
      "FIND NEARBY KEKE RIDERS ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to find nearby Keke drivers.",
    });
  }
};