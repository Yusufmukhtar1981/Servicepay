const express = require("express");

const {
  getAdminDashboard,
  getAdminTransactions,
  getAdminDeliveries,
  updateDeliveryStatus,
  updateDeliveryPrice,
} = require("../controllers/admin.controller");

const {
  protect,
  adminOnly,
} = require("../middleware/auth.middleware");

const router = express.Router();

router.get(
  "/dashboard",
  protect,
  adminOnly("HEAD_OFFICE"),
  getAdminDashboard
);

router.get(
  "/transactions",
  protect,
  adminOnly("HEAD_OFFICE"),
  getAdminTransactions
);

router.get(
  "/deliveries",
  protect,
  adminOnly("HEAD_OFFICE"),
  getAdminDeliveries
);

router.patch(
  "/deliveries/:id/status",
  protect,
  adminOnly("HEAD_OFFICE"),
  updateDeliveryStatus
);

router.patch(
  "/deliveries/:id/price",
  protect,
  adminOnly("HEAD_OFFICE"),
  updateDeliveryPrice
);

module.exports = router;