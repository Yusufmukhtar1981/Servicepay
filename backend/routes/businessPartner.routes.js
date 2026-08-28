const router = require("express").Router();
const { protect, adminOnly, businessPartnerOnly } = require("../middleware/auth.middleware");
const c = require("../controllers/businessPartner.controller");
const admin = adminOnly("HEAD_OFFICE", "ADMIN", "SUPER_ADMIN");

// Head Office controls identities, status, permissions and password recovery.
router.get("/admin/partners", protect, admin, c.adminList);
router.get("/admin/partners/count", protect, admin, c.adminCount);
router.post("/admin/partners", protect, admin, c.adminCreate);
router.get("/admin/partners/:partnerId", protect, admin, c.adminDetail);
router.patch("/admin/partners/:partnerId", protect, admin, c.adminUpdate);
router.patch("/admin/partners/:partnerId/status", protect, admin, c.adminStatus);
router.post("/admin/partners/:partnerId/reset-password", protect, admin, c.adminReset);
router.post("/admin/partners/:partnerId/applications/:applicationId/assign", protect, admin, c.adminAssignApplication);
// Commission creation is deliberately not exposed: it is recorded only by
// trusted lifecycle services using a server-derived event key. Reversal has a
// dedicated append-only compensating entry.
router.post("/admin/commissions/:commissionId/reverse", protect, admin, c.adminReverseCommission);
router.get("/admin/commission-rules", protect, admin, c.adminRules);
router.post("/admin/commission-rules", protect, admin, c.adminCreateRule);
router.patch("/admin/commission-rules/:ruleId/status", protect, admin, c.adminRuleStatus);
router.post("/admin/partners/:partnerId/officers/link", protect, admin, c.adminLinkOfficer);

router.get("/me", protect, businessPartnerOnly, c.me);
router.get("/dashboard", protect, businessPartnerOnly, c.dashboard);
router.get("/officers", protect, businessPartnerOnly, c.officers);
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