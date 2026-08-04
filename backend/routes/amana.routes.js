const express = require("express");

const {
  protect,
} = require("../middleware/auth.middleware");

const amanaController = require(
  "../controllers/amana.controller"
);

const amanaPaymentController = require(
  "../controllers/amanaPayment.controller"
);

const router = express.Router();

/*
 * All ServicePay Amana routes require
 * an authenticated and active user.
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
 * Pay for an Amana request using
 * the customer's ServicePay wallet.
 *
 * POST /api/amana/:id/pay
 *
 * Request body:
 * {
 *   "transactionPin": "1234"
 * }
 */
router.post(
  "/:id/pay",
  amanaPaymentController.payAmanaOrder
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

/*
 * Get one Amana request.
 *
 * Keep this route after the specific
 * /:id/pay and /:id/cancel routes.
 *
 * GET /api/amana/:id
 */
router.get(
  "/:id",
  amanaController.getMyAmanaOrderById
);

module.exports = router;