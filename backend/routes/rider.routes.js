const express = require("express");

const {
  getRiderDeliveries,
  getRiderDeliveryDetails,
  acceptRiderDelivery,
  rejectRiderDelivery,
  updateRiderDeliveryStatus,
} = require(
  "../controllers/riderDelivery.controller"
);

const {
  getCommissionSummary,
  getMyWithdrawals,
  getMyWithdrawalById,
  createWithdrawalRequest,
  getAllWithdrawals,
  approveWithdrawal,
  rejectWithdrawal,
  markWithdrawalProcessing,
  markWithdrawalPaid,
  markWithdrawalFailed,
} = require(
  "../controllers/riderWithdrawal.controller"
);

const {
  protect,
} = require(
  "../middleware/auth.middleware"
);

const router = express.Router();

/*
|--------------------------------------------------------------------------
| RIDER DELIVERIES
|--------------------------------------------------------------------------
*/

router.get(
  "/deliveries",
  protect,
  getRiderDeliveries
);

router.get(
  "/deliveries/:id",
  protect,
  getRiderDeliveryDetails
);

router.patch(
  "/deliveries/:id/accept",
  protect,
  acceptRiderDelivery
);

router.patch(
  "/deliveries/:id/reject",
  protect,
  rejectRiderDelivery
);

router.patch(
  "/deliveries/:id/status",
  protect,
  updateRiderDeliveryStatus
);

/*
|--------------------------------------------------------------------------
| RIDER COMMISSION
|--------------------------------------------------------------------------
|
| GET /api/rider/commission-summary
|
*/

router.get(
  "/commission-summary",
  protect,
  getCommissionSummary
);

/*
|--------------------------------------------------------------------------
| RIDER WITHDRAWALS
|--------------------------------------------------------------------------
|
| GET  /api/rider/withdrawals
| GET  /api/rider/withdrawals/:id
| POST /api/rider/withdrawals
|
*/

router.get(
  "/withdrawals",
  protect,
  getMyWithdrawals
);

router.post(
  "/withdrawals",
  protect,
  createWithdrawalRequest
);

router.get(
  "/withdrawals/:id",
  protect,
  getMyWithdrawalById
);

/*
|--------------------------------------------------------------------------
| HEAD OFFICE RIDER WITHDRAWAL MANAGEMENT
|--------------------------------------------------------------------------
|
| GET   /api/rider/admin/withdrawals
| PATCH /api/rider/admin/withdrawals/:id/approve
| PATCH /api/rider/admin/withdrawals/:id/reject
| PATCH /api/rider/admin/withdrawals/:id/processing
| PATCH /api/rider/admin/withdrawals/:id/paid
| PATCH /api/rider/admin/withdrawals/:id/failed
|
*/

router.get(
  "/admin/withdrawals",
  protect,
  getAllWithdrawals
);

router.patch(
  "/admin/withdrawals/:id/approve",
  protect,
  approveWithdrawal
);

router.patch(
  "/admin/withdrawals/:id/reject",
  protect,
  rejectWithdrawal
);

router.patch(
  "/admin/withdrawals/:id/processing",
  protect,
  markWithdrawalProcessing
);

router.patch(
  "/admin/withdrawals/:id/paid",
  protect,
  markWithdrawalPaid
);

router.patch(
  "/admin/withdrawals/:id/failed",
  protect,
  markWithdrawalFailed
);

module.exports = router;