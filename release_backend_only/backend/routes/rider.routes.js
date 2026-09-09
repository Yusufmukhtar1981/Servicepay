const express = require("express");

const {
  protect,
} = require("../middleware/auth.middleware");

const riderController = require(
  "../controllers/rider.controller"
);

const riderWithdrawalController = require(
  "../controllers/riderWithdrawal.controller"
);

const riderDeliveryController = require(
  "../controllers/riderDelivery.controller"
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

router.post("/device-tokens", protect, riderController.registerDeviceToken);
router.delete("/device-tokens", protect, riderController.removeDeviceToken);

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


/*
 * ============================================================
 * ADMIN RIDER WITHDRAWALS
 * ============================================================
 *
 * GET /api/rider/admin/withdrawals
 *
 * Controller performs Head Office authorization.
 */
router.get(
  "/admin/withdrawals",
  protect,
  riderWithdrawalController.getAllWithdrawals
);


/*
 * ============================================================
 * ADMIN RIDER WITHDRAWAL ACTIONS
 * ============================================================
 */

router.patch(
  "/admin/withdrawals/:id/approve",
  protect,
  riderWithdrawalController.approveWithdrawal
);

router.patch(
  "/admin/withdrawals/:id/reject",
  protect,
  riderWithdrawalController.rejectWithdrawal
);

router.patch(
  "/admin/withdrawals/:id/processing",
  protect,
  riderWithdrawalController.markWithdrawalProcessing
);

router.patch(
  "/admin/withdrawals/:id/paid",
  protect,
  riderWithdrawalController.markWithdrawalPaid
);

router.patch(
  "/admin/withdrawals/:id/failed",
  protect,
  riderWithdrawalController.markWithdrawalFailed
);


/*
 * ============================================================
 * RIDER WITHDRAWALS
 * ============================================================
 */

router.get(
  "/commission-summary",
  protect,
  riderWithdrawalController.getCommissionSummary
);

router.get(
  "/withdrawals",
  protect,
  riderWithdrawalController.getMyWithdrawals
);

router.get(
  "/withdrawals/:id",
  protect,
  riderWithdrawalController.getMyWithdrawalById
);

router.post(
  "/withdrawals",
  protect,
  riderWithdrawalController.createWithdrawalRequest
);


/*
 * ============================================================
 * RIDER DELIVERIES
 * ============================================================
 */

router.get(
  "/deliveries",
  protect,
  riderDeliveryController.getRiderDeliveries
);

router.get(
  "/deliveries/:id",
  protect,
  riderDeliveryController.getRiderDeliveryDetails
);


/*
 * =========================================================
 * RIDER DELIVERY ACTIONS
 * =========================================================
 */

router.patch(
  "/deliveries/:id/accept",
  protect,
  riderDeliveryController.acceptRiderDelivery
);

router.patch(
  "/deliveries/:id/reject",
  protect,
  riderDeliveryController.rejectRiderDelivery
);

router.patch(
  "/deliveries/:id/status",
  protect,
  riderDeliveryController.updateRiderDeliveryStatus
);

module.exports = router;