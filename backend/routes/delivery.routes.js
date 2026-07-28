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
} = require("../controllers/delivery.controller");

const {
  protect,
} = require("../middleware/auth.middleware");

// Customer routes
router.post("/", protect, createDelivery);

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

router.get(
  "/:id",
  protect,
  getDeliveryById
);

// Admin routes
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