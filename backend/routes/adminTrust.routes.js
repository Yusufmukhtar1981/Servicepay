const express = require("express");

const {
  getTrustProfile,
  listTrustProfiles,
} = require("../controllers/adminTrust.controller");
const {
  protect,
} = require("../middleware/auth.middleware");
const {
  loadStaffRole,
  requirePermission,
} = require("../middleware/staffPermission.middleware");

const router = express.Router();

router.get(
  "/profiles",
  protect,
  loadStaffRole,
  requirePermission("trust.view"),
  listTrustProfiles
);
router.get(
  "/profiles/:servicePayId",
  protect,
  loadStaffRole,
  requirePermission("trust.view"),
  getTrustProfile
);

module.exports = router;