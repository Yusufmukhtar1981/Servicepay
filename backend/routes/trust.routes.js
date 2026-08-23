const express = require("express");

const {
  getMyTrustProfile,
  getTrustProfile,
  searchTrustProfiles,
  updateMyDiscoverability,
} = require("../controllers/trust.controller");
const {
  protect,
} = require("../middleware/auth.middleware");
const {
  trustSearchRateLimit,
} = require("../middleware/trustRateLimit.middleware");

const router = express.Router();

router.get(
  "/search",
  protect,
  trustSearchRateLimit,
  searchTrustProfiles
);
router.get("/me", protect, getMyTrustProfile);
router.patch(
  "/me/discoverability",
  protect,
  updateMyDiscoverability
);
router.get(
  "/profiles/:servicePayId",
  protect,
  getTrustProfile
);

module.exports = router;