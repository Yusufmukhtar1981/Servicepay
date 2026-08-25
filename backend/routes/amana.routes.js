const express = require("express");
const multer = require("multer");

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
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 5 },
});

const handleUpload = (fields) => (req, res, next) => {
  upload.fields(fields)(req, res, (error) => {
    if (!error) return next();
    return res.status(400).json({
      success: false,
      message: error.code === "LIMIT_FILE_SIZE"
        ? "Amana documents must be 8 MB or smaller."
        : error.code === "LIMIT_FILE_COUNT"
          ? "You can attach up to five Amana documents."
          : "Unable to process the Amana document upload.",
    });
  });
};

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
  handleUpload([
    { name: "attachment", maxCount: 5 },
    { name: "attachments", maxCount: 5 },
  ]),
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
 * Send the additional information requested by Head Office.
 */
router.post(
  "/:id/information",
  handleUpload([
    { name: "attachment", maxCount: 5 },
    { name: "attachments", maxCount: 5 },
  ]),
  amanaController.provideRequestedInformation
);

/*
 * Legacy route retained for backwards-compatible
 * client errors. Protected Amana requests can never
 * be paid directly from a beneficiary/customer wallet.
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