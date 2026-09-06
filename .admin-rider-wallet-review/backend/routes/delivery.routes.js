const express = require("express");
const router = express.Router();

const {
  createDelivery,
  getMyDeliveries,
  getDeliveryById,
  trackDelivery,
  cancelDelivery,
  getAllDeliveries,
  setDeliveryFee,
  updateDeliveryStatus,
  updatePaymentStatus,
} = require("../controllers/delivery.controller");

const { protect } = require("../middleware/auth.middleware");

// Customer
router.post("/", protect, createDelivery);
router.get("/my", protect, getMyDeliveries);
router.get("/track/:trackingNumber", trackDelivery);
router.get("/:id", protect, getDeliveryById);
router.put("/cancel/:id", protect, cancelDelivery);

// Admin
router.get("/", protect, getAllDeliveries);
router.put("/fee/:id", protect, setDeliveryFee);
router.put("/status/:id", protect, updateDeliveryStatus);
router.put("/payment/:id", protect, updatePaymentStatus);

module.exports = router;