const express = require("express");

const {
  registerUser,
  loginUser,
  getProfile,
  updateProfile,
  changePassword,
} = require("../controllers/auth.controller");

const {
  protect,
} = require("../middleware/auth.middleware");

const router = express.Router();

router.post(
  "/register",
  registerUser
);

router.post(
  "/login",
  loginUser
);

router.get(
  "/profile",
  protect,
  getProfile
);

router.put(
  "/profile",
  protect,
  updateProfile
);

router.put(
  "/change-password",
  protect,
  changePassword
);

module.exports = router;
