const express = require("express");

const {
  getRiderDeliveries,
  getRiderDeliveryDetails,
  acceptRiderDelivery,
  rejectRiderDelivery,
  updateRiderDeliveryStatus,
} = require("../controllers/riderDelivery.controller");

const {
  protect,
} = require("../middleware/auth.middleware");

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

module.exports = router;