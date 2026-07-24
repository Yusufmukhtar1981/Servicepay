const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/auth.middleware");
const { requireAdmin } = require("../middleware/admin.middleware");
const adminController = require("../controllers/admin.controller");

router.get("/dashboard", protect, requireAdmin, adminController.getDashboard);

module.exports = router;
