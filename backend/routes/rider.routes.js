const express = require("express");

const {
  protect,
} = require("../middleware/auth.middleware");

const riderController = require(
  "../controllers/rider.controller"
);

const router = express.Router();

/*
 * =====================================================
 * RIDER PROFILE
 * =====================================================
 *
 * GET /api/riders/me
 */
router.get(
  "/me",
  protect,
  riderController.getMyRiderProfile
);

/*
 * =====================================================
 * RIDER LIVE LOCATION
 * =====================================================
 *
 * POST /api/riders/location
 */
router.post(
  "/location",
  protect,
  riderController.updateLocation
);

/*
 * =====================================================
 * RIDER AVAILABILITY
 * =====================================================
 *
 * POST /api/riders/availability
 */
router.post(
  "/availability",
  protect,
  riderController.updateAvailability
);

/*
 * =====================================================
 * RIDER STATUS
 * =====================================================
 *
 * GET /api/riders/status
 */
router.get(
  "/status",
  protect,
  riderController.getRiderStatus
);

/*
 * =====================================================
 * NEARBY KEKE DRIVERS
 * =====================================================
 *
 * GET /api/riders/nearby-keke
 *
 * Example:
 *
 * /api/riders/nearby-keke
 * ?latitude=12.0022
 * &longitude=8.5920
 * &radius=10000
 */
router.get(
  "/nearby-keke",
  protect,
  riderController.findNearbyKekeDrivers
);

module.exports = router;