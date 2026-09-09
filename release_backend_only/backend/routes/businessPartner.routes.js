const router = require("express").Router();
const { protect, businessPartnerOnly } = require("../middleware/auth.middleware");
const {
  loadStaffRole,
  requirePermission,
} = require("../middleware/staffPermission.middleware");
const {
  STAFF_PERMISSIONS: P,
} = require("../config/staffPermissions");
const c = require("../controllers/businessPartner.controller");

const staffAccess = [protect, loadStaffRole];
router.get("/admin/partners", ...staffAccess, requirePermission(P.BUSINESS_PARTNERS_VIEW), c.adminList);
router.get("/admin/partners/count", ...staffAccess, requirePermission(P.BUSINESS_PARTNERS_VIEW), c.adminCount);
router.post("/admin/partners", ...staffAccess, requirePermission(P.BUSINESS_PARTNERS_CREATE), c.adminCreate);
router.get("/admin/partners/:partnerId", ...staffAccess, requirePermission(P.BUSINESS_PARTNERS_VIEW), c.adminDetail);
router.patch("/admin/partners/:partnerId", ...staffAccess, requirePermission(P.BUSINESS_PARTNERS_UPDATE), c.adminUpdate);
router.patch("/admin/partners/:partnerId/status", ...staffAccess, requirePermission(P.BUSINESS_PARTNERS_STATUS), c.adminStatus);
router.post("/admin/partners/:partnerId/reset-password", ...staffAccess, requirePermission(P.BUSINESS_PARTNERS_UPDATE), c.adminReset);
router.post("/admin/partners/:partnerId/applications/:applicationId/assign", ...staffAccess, requirePermission(P.BUSINESS_PARTNERS_ASSIGN), c.adminAssignApplication);
// Commission creation is deliberately not exposed: it is recorded only by
// trusted lifecycle services using a server-derived event key. Reversal has a
// dedicated append-only compensating entry.
router.post("/admin/commissions/:commissionId/reverse", ...staffAccess, requirePermission(P.FINANCE_APPROVE), c.adminReverseCommission);
router.get("/admin/commission-rules", ...staffAccess, requirePermission(P.BUSINESS_PARTNERS_VIEW), c.adminRules);
router.post("/admin/commission-rules", ...staffAccess, requirePermission(P.BUSINESS_PARTNERS_UPDATE), c.adminCreateRule);
router.patch("/admin/commission-rules/:ruleId/status", ...staffAccess, requirePermission(P.BUSINESS_PARTNERS_UPDATE), c.adminRuleStatus);
router.post("/admin/partners/:partnerId/officers/link", ...staffAccess, requirePermission(P.BUSINESS_PARTNERS_ASSIGN), c.adminLinkOfficer);

router.get("/me", protect, businessPartnerOnly, c.me);
router.get("/dashboard", protect, businessPartnerOnly, c.dashboard);
router.get("/officers", protect, businessPartnerOnly, c.officers);
router.post("/officers", protect, businessPartnerOnly, c.createOfficer);
router.get("/officers/:type/:officerId", protect, businessPartnerOnly, c.officerDetail);
router.patch("/officers/:type/:officerId", protect, businessPartnerOnly, c.updateOfficer);
router.patch("/officers/:type/:officerId/status", protect, businessPartnerOnly, c.officerStatus);
router.post("/officers/:type/:officerId/reset-access", protect, businessPartnerOnly, c.resetOfficerAccess);
router.post("/officers/link", protect, businessPartnerOnly, (req, res) => res.status(403).json({ success: false, message: "Business Partners cannot link or transfer officers. Head Office assignment is required." }));
router.get("/customers", protect, businessPartnerOnly, c.customers);
router.get("/applications", protect, businessPartnerOnly, c.applications);
router.post("/applications/:applicationId/assign", protect, businessPartnerOnly, c.assignApplication);
router.post("/applications/:applicationId/verification-review", protect, businessPartnerOnly, c.reviewVerification);
router.get("/repayments", protect, businessPartnerOnly, c.repayments);
router.get("/performance", protect, businessPartnerOnly, c.performance);
router.get("/reports", protect, businessPartnerOnly, c.performance);
router.get("/commissions", protect, businessPartnerOnly, c.commissions);
router.get("/notifications", protect, businessPartnerOnly, c.notifications);
router.get("/activity", protect, businessPartnerOnly, c.activity);
module.exports = router;