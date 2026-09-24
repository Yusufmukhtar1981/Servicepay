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
 * Zonal managers have a separate, scope-aware oversight surface.  In
 * particular, do not let them fall through to the legacy delivery endpoints:
 * those endpoints predate zonal scoping and either return all deliveries or
 * accept an ID before applying a tenant check.
 */
const denyZonalManager = (req, res, next) => {
  if (String(req.user?.role || "").toUpperCase() === "ZONAL_MANAGER") {
    return res.status(403).json({
      success: false,
      message: "Use the zonal oversight delivery endpoint.",
    });
  }
  return next();
};

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
  denyZonalManager,
  payDeliveryFee
);

router.put(
  "/cancel/:id",
  protect,
  denyZonalManager,
  cancelDelivery
);

/*
 * Keep this below all named routes.
 */
router.get(
  "/:id",
  protect,
  denyZonalManager,
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
  denyZonalManager,
  getAllDeliveries
);

router.put(
  "/fee/:id",
  protect,
  denyZonalManager,
  setDeliveryFee
);

router.put(
  "/status/:id",
  protect,
  denyZonalManager,
  updateDeliveryStatus
);

router.put(
  "/payment/:id",
  protect,
  denyZonalManager,
  updatePaymentStatus
);

module.exports = router;