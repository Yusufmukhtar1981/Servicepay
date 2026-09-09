const express = require("express");

const {
  protect,
  adminOnly,
} = require("../middleware/auth.middleware");

const adminAmanaController = require(
  "../controllers/adminAmana.controller"
);

const router = express.Router();

/*
 * All routes here are for HEAD_OFFICE only.
 */
router.use(
  protect,
  adminOnly("HEAD_OFFICE")
);

/*
 * GET /api/admin/amana
 *
 * Get all Amana orders with search,
 * filters, summary and pagination.
 */
router.get(
  "/",
  adminAmanaController.getAllAmanaOrders
);

/*
 * PATCH /api/admin/amana/:id/assign
 *
 * Assign an Amana order to staff,
 * Aggregator, State Manager or Zonal Manager.
 */
router.patch(
  "/:id/assign",
  adminAmanaController.assignAmanaOrder
);

/*
 * PATCH /api/admin/amana/:id/status
 *
 * Update operational status.
 */
router.patch(
  "/:id/status",
  adminAmanaController.updateAmanaOrderStatus
);

/*
 * PATCH /api/admin/amana/:id/vendor
 *
 * Add or update vendor information.
 */
router.patch(
  "/:id/vendor",
  adminAmanaController.updateAmanaVendor
);

/*
 * PATCH /api/admin/amana/:id/proof
 *
 * Add fulfilment receipt, images or notes.
 */
router.patch(
  "/:id/proof",
  adminAmanaController.addAmanaFulfilmentProof
);

/*
 * GET /api/admin/amana/:id
 *
 * Keep this route after all specific
 * /:id/... routes.
 */
router.get(
  "/:id",
  adminAmanaController.getAmanaOrderById
);

module.exports = router;