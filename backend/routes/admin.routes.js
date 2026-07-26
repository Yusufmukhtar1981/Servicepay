const express = require("express");

const {
  getAdminDashboard,
} = require("../controllers/admin.controller");

const {
  protect,
  adminOnly,
} = require("../middleware/auth.middleware");

const router = express.Router();

// Dashboard
router.get(
  "/dashboard",
  protect,
  adminOnly("HEAD_OFFICE"),
  getAdminDashboard
);

module.exports = router;