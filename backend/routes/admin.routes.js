const express = require("express");

const {
  getAdminDashboard,
  getUsers,
  getUserById,
  updateUserStatus,
} = require("../controllers/admin.controller");

const {
  protect,
  adminOnly,
} = require("../middleware/auth.middleware");

const router = express.Router();

router.use(protect);
router.use(adminOnly("HEAD_OFFICE"));

router.get("/dashboard", getAdminDashboard);

router.get("/users", getUsers);

router.get("/users/:userId", getUserById);

router.patch(
  "/users/:userId/status",
  updateUserStatus
);

module.exports = router;