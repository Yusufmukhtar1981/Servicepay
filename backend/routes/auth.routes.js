const express = require("express");

const {
  registerUser,
  loginUser,
  getProfile,
  getMyReferral,
  updateProfile,
  changePassword,
  forgotPassword,
  resetPassword,
  updateRiderAvailability,
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
  "/forgot-password",
  forgotPassword
);

router.post(
  "/reset-password",
  resetPassword
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

/*
|--------------------------------------------------------------------------
| DELIVERY RIDER AVAILABILITY
|--------------------------------------------------------------------------
*/

router.patch(
  "/rider/availability",
  protect,
  updateRiderAvailability
);


router.get(
  "/referral",
  protect,
  getMyReferral
);

module.exports = router;
