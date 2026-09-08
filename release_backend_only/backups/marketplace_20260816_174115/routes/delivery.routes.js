const express = require("express");

const router = express.Router();

const {
  createDelivery,
  getMyDeliveries,
  getDeliveryById,
  trackDelivery,
  payDeliveryFee,
  cancelDelivery,
  getAllDeliveries,
  setDeliveryFee,
  updateDeliveryStatus,
  updatePaymentStatus,
} = require(
  "../controllers/delivery.controller"
);

const {
  getDeliveryCoverage,
  getLiveDeliveryCoverage,
  getAdminDeliveryCoverage,
  updateDeliveryCoverage,
  bulkUpdateDeliveryCoverage,
  validateDeliveryCoverage,
} = require(
  "../controllers/deliveryCoverage.controller"
);

const {
  protect,
} = require(
  "../middleware/auth.middleware"
);

/*
|--------------------------------------------------------------------------
| PUBLIC DELIVERY COVERAGE
|--------------------------------------------------------------------------
|
| These routes must remain above /:id.
|
*/

router.get(
  "/coverage",
  getDeliveryCoverage
);

router.get(
  "/coverage/live",
  getLiveDeliveryCoverage
);

/*
|--------------------------------------------------------------------------
| HEAD OFFICE DELIVERY COVERAGE MANAGEMENT
|--------------------------------------------------------------------------
*/

router.get(
  "/coverage/admin",
  protect,
  getAdminDeliveryCoverage
);

router.patch(
  "/coverage/admin/bulk/update",
  protect,
  bulkUpdateDeliveryCoverage
);

router.patch(
  "/coverage/admin/:stateCode",
  protect,
  updateDeliveryCoverage
);

/*
|--------------------------------------------------------------------------
| CUSTOMER DELIVERY ROUTES
|--------------------------------------------------------------------------
*/

router.post(
  "/",
  protect,
  validateDeliveryCoverage,
  createDelivery
);

router.get(
  "/my",
  protect,
  getMyDeliveries
);

router.get(
  "/track/:trackingNumber",
  trackDelivery
);

router.post(
  "/pay/:id",
  protect,
  payDeliveryFee
);

router.put(
  "/cancel/:id",
  protect,
  cancelDelivery
);

/*
 * Keep this below all named routes.
 */
router.get(
  "/:id",
  protect,
  getDeliveryById
);

/*
|--------------------------------------------------------------------------
| ADMIN DELIVERY ROUTES
|--------------------------------------------------------------------------
*/

router.get(
  "/",
  protect,
  getAllDeliveries
);

router.put(
  "/fee/:id",
  protect,
  setDeliveryFee
);

router.put(
  "/status/:id",
  protect,
  updateDeliveryStatus
);

router.put(
  "/payment/:id",
  protect,
  updatePaymentStatus
);

module.exports = router;