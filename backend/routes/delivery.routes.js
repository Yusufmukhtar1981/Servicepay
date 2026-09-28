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
  adminOnly,
} = require(
  "../middleware/auth.middleware"
);
const requireDeliveryAdmin = adminOnly(
  "HEAD_OFFICE",
  "ADMIN",
  "SUPER_ADMIN",
  "HEAD_OFFICE_ADMIN",
  "STATE_MANAGER"
);
const requireHeadOfficeDeliveryAdmin = adminOnly(
  "HEAD_OFFICE", "HEAD_OFFICE_ADMIN", "ADMIN", "SUPER_ADMIN"
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
  requireDeliveryAdmin,
  getAllDeliveries
);

router.put(
  "/fee/:id",
  protect,
  requireHeadOfficeDeliveryAdmin,
  setDeliveryFee
);

router.put(
  "/status/:id",
  protect,
  requireDeliveryAdmin,
  updateDeliveryStatus
);

router.put(
  "/payment/:id",
  protect,
  requireHeadOfficeDeliveryAdmin,
  updatePaymentStatus
);

module.exports = router;