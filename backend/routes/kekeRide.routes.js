const express = require("express");

const {
  protect,
} = require("../middleware/auth.middleware");

const kekeRideController = require(
  "../controllers/kekeRide.controller"
);

const router = express.Router();

/*
 * =====================================================
 * CUSTOMER - CREATE KEKE RIDE
 * =====================================================
 *
 * POST /api/keke-rides
 */
router.post(
  "/",
  protect,
  kekeRideController.createRide
);

/*
 * =====================================================
 * CUSTOMER - ACTIVE RIDE
 * =====================================================
 *
 * GET /api/keke-rides/active
 */
router.get(
  "/active",
  protect,
  kekeRideController.getCustomerActiveRide
);

/*
 * =====================================================
 * CUSTOMER - RIDE HISTORY
 * =====================================================
 *
 * GET /api/keke-rides/history
 */
router.get(
  "/history",
  protect,
  kekeRideController.getCustomerRideHistory
);

/*
 * =====================================================
 * DRIVER - CURRENT RIDE
 * =====================================================
 *
 * GET /api/keke-rides/driver/current
 */
router.get(
  "/driver/current",
  protect,
  kekeRideController.getDriverCurrentRide
);

/*
 * =====================================================
 * CUSTOMER - TRACK DRIVER LOCATION
 * =====================================================
 *
 * GET /api/keke-rides/:rideId/driver-location
 */
router.get(
  "/:rideId/driver-location",
  protect,
  kekeRideController.getDriverLiveLocation
);

/*
 * =====================================================
 * DRIVER - ACCEPT RIDE
 * =====================================================
 *
 * POST /api/keke-rides/:rideId/accept
 */
router.post(
  "/:rideId/accept",
  protect,
  kekeRideController.acceptRide
);

/*
 * =====================================================
 * DRIVER - MARK ARRIVAL
 * =====================================================
 *
 * POST /api/keke-rides/:rideId/arrived
 */
router.post(
  "/:rideId/arrived",
  protect,
  kekeRideController.markArrived
);

/*
 * =====================================================
 * DRIVER - START RIDE WITH OTP
 * =====================================================
 *
 * POST /api/keke-rides/:rideId/start
 */
router.post(
  "/:rideId/start",
  protect,
  kekeRideController.startRide
);

/*
 * =====================================================
 * DRIVER - COMPLETE RIDE
 * =====================================================
 *
 * POST /api/keke-rides/:rideId/complete
 */
router.post(
  "/:rideId/complete",
  protect,
  kekeRideController.completeRide
);

/*
 * =====================================================
 * CUSTOMER - CANCEL RIDE
 * =====================================================
 *
 * POST /api/keke-rides/:rideId/cancel
 */
router.post(
  "/:rideId/cancel",
  protect,
  kekeRideController.cancelRide
);

/*
 * =====================================================
 * CUSTOMER / DRIVER / ADMIN - RIDE DETAILS
 * =====================================================
 *
 * GET /api/keke-rides/:rideId
 */
router.get(
  "/:rideId",
  protect,
  kekeRideController.getRideDetails
);

module.exports = router;