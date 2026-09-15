const express = require("express");
const multer = require("multer");

const {
  registerUser,
  loginUser,
  getProfile,
  getMyReferral,
  validateReferralCode,
  updateProfile,
  changePassword,
  forgotPassword,
  resetPassword,
  updateRiderAvailability,
  updateProfilePhoto,
  requestCustomerActivation,
  verifyCustomerActivation,
} = require("../controllers/auth.controller");

const {
  protect,
} = require("../middleware/auth.middleware");
const {
  referralValidationRateLimit,
} = require("../middleware/referralValidationRateLimit.middleware");

const router = express.Router();

const profilePhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: (req, file, callback) => {
    const mime =
      String(file.mimetype || "").toLowerCase();

    const originalName =
      String(file.originalname || "");

    const hasImageExtension =
      /\.(jpg|jpeg|png|webp|heic|heif)$/i.test(
        originalName
      );

    if (
      mime.startsWith("image/") ||
      (
        mime === "application/octet-stream" &&
        hasImageExtension
      )
    ) {
      callback(null, true);
      return;
    }

    callback(
      new Error(
        "Only image files are allowed.",
      ),
    );
  },
});


router.post(
  "/register",
  registerUser
);

router.get(
  "/referral/validate",
  referralValidationRateLimit,
  validateReferralCode
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
  "/customer-activation/request",
  requestCustomerActivation
);

router.post(
  "/customer-activation/verify",
  verifyCustomerActivation
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



/*
 * Customer profile photo upload.
 * Multipart field name: photo
 */
router.patch(
  "/profile/photo",
  protect,
  profilePhotoUpload.single("photo"),
  updateProfilePhoto
);

module.exports = router;
