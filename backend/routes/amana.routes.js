const express = require("express");

const {
  protect,
} = require("../middleware/auth.middleware");

const amanaController = require(
  "../controllers/amana.controller"
);

const router = express.Router();

/*
 * All ServicePay Amana routes below
 * require a logged-in user.
 */
router.use(protect);

/*
 * Create a new Amana request.
 *
 * POST /api/amana
 */
router.post(
  "/",
  amanaController.createAmanaOrder
);

/*
 * Get all Amana requests belonging
 * to the logged-in customer.
 *
 * GET /api/amana
 */
router.get(
  "/",
  amanaController.getMyAmanaOrders
);

/*
 * Get one Amana request.
 *
 * GET /api/amana/:id
 */
router.get(
  "/:id",
  amanaController.getMyAmanaOrderById
);

/*
 * Cancel an unpaid Amana request.
 *
 * PATCH /api/amana/:id/cancel
 */
router.patch(
  "/:id/cancel",
  amanaController.cancelMyAmanaOrder
);

module.exports = router;