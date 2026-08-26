const express = require("express");

const {
  getTrustProfile,
  listTrustProfiles,
} = require("../controllers/adminTrust.controller");
const protectedDeals = require("../controllers/adminProtectedDeal.controller");
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
router.get("/deals", protect, loadStaffRole, requirePermission("trust.view"), protectedDeals.listDeals);
router.get("/disputes", protect, loadStaffRole, requirePermission("trust.view"), protectedDeals.listDisputes);
router.post("/disputes/:disputeId/resolve", protect, loadStaffRole, requirePermission("trust.resolve"), protectedDeals.resolve);
router.patch("/profiles/:servicePayId/restriction", protect, loadStaffRole, requirePermission("trust.restrict"), protectedDeals.restrict);
router.get(
  "/profiles/:servicePayId",
  protect,
  loadStaffRole,
  requirePermission("trust.view"),
  getTrustProfile
);

module.exports = router;