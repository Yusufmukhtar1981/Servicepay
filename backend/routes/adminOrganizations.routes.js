const express = require("express");
const { protect } = require("../middleware/auth.middleware");
const { loadStaffRole, requireAnyPermission } = require("../middleware/staffPermission.middleware");
const { Organization } = require("../models/organizations.models");
const c = require("../controllers/organizations.controller");
const router = express.Router();
router.use(protect);
const normalizeAdminRole = (value) => String(value || "")
  .trim()
  .toUpperCase()
  .replace(/[^A-Z0-9]+/g, "_")
  .replace(/^_+|_+$/g, "");
const isFullAccessOrganizationAdminRole = (value) => [
  "SUPER_ADMIN",
  "SERVICEPAY_SUPER_ADMIN",
  "ADMIN",
  "HEAD_OFFICE",
  "HEAD_OFFICE_ADMIN",
].includes(normalizeAdminRole(value));
const gate = (...permissions) => (req, res, next) => {
  if (isFullAccessOrganizationAdminRole(req.user?.role)) return next();
  return loadStaffRole(req, res, () => requireAnyPermission(...permissions)(req, res, next));
};
const statusGate = async (req, res, next) => {
  const target = String(req.body?.status || "").toUpperCase();
  const organization = await Organization.findById(req.params.id).select("status").lean();
  if (!organization) {
    return res.status(404).json({ success: false, message: "Organization not found." });
  }
  const reviewTransition =
    organization.status === "PENDING_VERIFICATION" &&
    ["VERIFIED", "REJECTED"].includes(target);
  const managementTransition =
    (organization.status === "VERIFIED" && target === "SUSPENDED") ||
    (organization.status === "SUSPENDED" && target === "VERIFIED");
  if (!reviewTransition && !managementTransition) {
    return res.status(409).json({
      success: false,
      message: "Invalid organization status transition.",
    });
  }
  return gate(
    reviewTransition ? "organizations.review" : "organizations.status.manage"
  )(req, res, next);
};
router.get("/summary", gate("organizations.view"), c.adminSummary);
router.get("/", gate("organizations.view"), c.adminList);
router.get("/:id", gate("organizations.view"), c.adminDetail);
router.get("/:id/members", gate("organizations.members.view"), c.adminMembers);
router.get("/:id/payments", gate("organizations.payments.view"), c.adminPayments);
router.get("/:id/audit", gate("organizations.audit.view"), c.adminAudit);
router.get("/:id/wallet", gate("organizations.view"), c.adminWallet);
router.patch("/:id/status", statusGate, c.platformStatus);
router.patch("/:id/wallet", gate("organizations.wallet.manage"), c.adminWallet);
module.exports = router;
module.exports.isFullAccessOrganizationAdminRole =
  isFullAccessOrganizationAdminRole;