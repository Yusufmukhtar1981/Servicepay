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
router.get("/admin/partners", ...staffAccess, requirePermission(P.BUSINESS_PARTNERS_VIEW), c.adminCollectionScopeGuard, c.adminList);
router.get("/admin/partners/count", ...staffAccess, requirePermission(P.BUSINESS_PARTNERS_VIEW), c.adminCollectionScopeGuard, c.adminCount);
router.post("/admin/partners", ...staffAccess, requirePermission(P.BUSINESS_PARTNERS_CREATE), c.adminCreate);
router.get("/admin/partners/:partnerId", ...staffAccess, requirePermission(P.BUSINESS_PARTNERS_VIEW), c.adminPartnerScopeGuard, c.adminDetail);
router.get("/admin/partners/:partnerId/customers", ...staffAccess, requirePermission(P.BUSINESS_PARTNERS_CUSTOMERS_VIEW), c.adminPartnerScopeGuard, c.adminCustomers);
router.get("/admin/partners/:partnerId/officers", ...staffAccess, requirePermission(P.BUSINESS_PARTNERS_OFFICERS_VIEW), c.adminPartnerScopeGuard, c.adminOfficers);
router.get("/admin/partners/:partnerId/transactions", ...staffAccess, requirePermission(P.BUSINESS_PARTNERS_TRANSACTIONS_VIEW), c.adminPartnerScopeGuard, c.adminTransactions);
router.get("/admin/partners/:partnerId/transaction-volume", ...staffAccess, requirePermission(P.BUSINESS_PARTNERS_TRANSACTIONS_VIEW), c.adminPartnerScopeGuard, c.adminTransactionVolume);
router.get("/admin/partners/:partnerId/commissions", ...staffAccess, requirePermission(P.BUSINESS_PARTNERS_COMMISSIONS_VIEW), c.adminPartnerScopeGuard, c.adminCommissions);
router.get("/admin/partners/:partnerId/targets", ...staffAccess, requirePermission(P.BUSINESS_PARTNERS_TARGETS_VIEW), c.adminPartnerScopeGuard, c.adminPartnerTargets);
router.post("/admin/partners/:partnerId/targets", ...staffAccess, requirePermission(P.BUSINESS_PARTNERS_UPDATE), c.adminPartnerScopeGuard, c.adminCreateTarget);
router.get("/admin/partners/:partnerId/bonuses", ...staffAccess, requirePermission(P.BUSINESS_PARTNERS_BONUSES_VIEW), c.adminPartnerScopeGuard, c.adminPartnerBonuses);
router.get("/admin/partners/:partnerId/liabilities", ...staffAccess, requirePermission(P.BUSINESS_PARTNERS_LIABILITIES_VIEW), c.adminPartnerScopeGuard, c.adminPartnerLiabilities);
router.get("/admin/partners/:partnerId/audit", ...staffAccess, requirePermission(P.BUSINESS_PARTNERS_AUDIT_VIEW), c.adminPartnerScopeGuard, c.adminPartnerAudit);
router.patch("/admin/partners/:partnerId", ...staffAccess, requirePermission(P.BUSINESS_PARTNERS_UPDATE), c.adminPartnerScopeGuard, c.adminUpdate);
router.patch("/admin/partners/:partnerId/status", ...staffAccess, requirePermission(P.BUSINESS_PARTNERS_STATUS), c.adminPartnerScopeGuard, c.adminStatus);
router.post("/admin/partners/:partnerId/reset-password", ...staffAccess, requirePermission(P.BUSINESS_PARTNERS_UPDATE), c.adminPartnerScopeGuard, c.adminReset);
router.post("/admin/partners/:partnerId/applications/:applicationId/assign", ...staffAccess, requirePermission(P.BUSINESS_PARTNERS_ASSIGN), c.adminPartnerScopeGuard, c.adminAssignApplication);
// Commission creation is deliberately not exposed: it is recorded only by
// trusted lifecycle services using a server-derived event key. Reversal has a
// dedicated append-only compensating entry.
router.post("/admin/commissions/:commissionId/reverse", ...staffAccess, requirePermission(P.FINANCE_APPROVE), c.adminCommissionScopeGuard, c.adminReverseCommission);
router.post("/admin/commission-reversals/:reversalId/recovery", ...staffAccess, requirePermission(P.FINANCE_APPROVE), c.adminCommissionScopeGuard, c.adminRecordCommissionRecovery);
router.get("/admin/commission-rules", ...staffAccess, requirePermission(P.BUSINESS_PARTNERS_VIEW), c.adminGlobalScopeGuard, c.adminRules);
router.post("/admin/commission-rules", ...staffAccess, requirePermission(P.BUSINESS_PARTNERS_UPDATE), c.adminGlobalScopeGuard, c.adminCreateRule);
router.patch("/admin/commission-rules/:ruleId", ...staffAccess, requirePermission(P.BUSINESS_PARTNERS_UPDATE), c.adminGlobalScopeGuard, c.adminUpdateRule);
router.patch("/admin/commission-rules/:ruleId/status", ...staffAccess, requirePermission(P.BUSINESS_PARTNERS_UPDATE), c.adminGlobalScopeGuard, c.adminRuleStatus);
router.get("/admin/bonus-rules", ...staffAccess, requirePermission(P.BUSINESS_PARTNERS_BONUSES_VIEW), c.adminBonusRules);
router.post("/admin/bonus-rules", ...staffAccess, requirePermission(P.BUSINESS_PARTNERS_UPDATE), c.adminCreateBonusRule);
router.patch("/admin/bonus-rules/:ruleId", ...staffAccess, requirePermission(P.BUSINESS_PARTNERS_UPDATE), c.adminUpdateBonusRule);
router.post("/admin/bonus-rules/:ruleId/evaluate", ...staffAccess, requirePermission(P.BUSINESS_PARTNERS_UPDATE), c.adminEvaluateBonusRule);
router.patch("/admin/bonus-rules/:ruleId/status", ...staffAccess, requirePermission(P.BUSINESS_PARTNERS_UPDATE), c.adminBonusRuleStatus);
router.get("/admin/targets", ...staffAccess, requirePermission(P.BUSINESS_PARTNERS_TARGETS_VIEW), c.adminGlobalScopeGuard, c.adminTargets);
router.post("/admin/targets", ...staffAccess, requirePermission(P.BUSINESS_PARTNERS_UPDATE), c.adminGlobalScopeGuard, c.adminCreateTarget);
router.post("/admin/partners/:partnerId/officers/link", ...staffAccess, requirePermission(P.BUSINESS_PARTNERS_ASSIGN), c.adminPartnerScopeGuard, c.adminLinkOfficer);

router.get("/me", protect, businessPartnerOnly, c.me);
router.get("/dashboard", protect, businessPartnerOnly, c.dashboard);
router.get("/officers", protect, businessPartnerOnly, c.officers);
router.post("/officers", protect, businessPartnerOnly, c.createOfficer);
router.get("/officers/:type/:officerId", protect, businessPartnerOnly, c.officerDetail);
router.patch("/officers/:type/:officerId", protect, businessPartnerOnly, c.updateOfficer);
router.patch("/officers/:type/:officerId/status", protect, businessPartnerOnly, c.officerStatus);
router.post("/officers/:type/:officerId/reset-access", protect, businessPartnerOnly, c.resetOfficerAccess);
router.post("/officers/link", protect, businessPartnerOnly, (req, res) => res.status(403).json({ success: false, message: "Business Partners cannot link or transfer officers. Head Office assignment is required." }));
router.post("/customers", protect, businessPartnerOnly, c.createCustomer);
router.get("/customers", protect, businessPartnerOnly, c.customers);
router.get("/customers/:customerId", protect, businessPartnerOnly, c.customerDetail);
router.get("/customers/:customerId/transactions", protect, businessPartnerOnly, c.customerTransactions);
router.get("/transactions", protect, businessPartnerOnly, c.transactions);
router.get("/transactions/:transactionId", protect, businessPartnerOnly, c.transactionDetail);
router.get("/commission-wallet", protect, businessPartnerOnly, c.commissionWallet);
router.get("/targets", protect, businessPartnerOnly, c.targets);
router.get("/applications", protect, businessPartnerOnly, c.applications);
router.post("/applications/:applicationId/assign", protect, businessPartnerOnly, c.assignApplication);
router.post("/applications/:applicationId/verification-review", protect, businessPartnerOnly, c.reviewVerification);
router.get("/repayments", protect, businessPartnerOnly, c.repayments);
router.get("/performance", protect, businessPartnerOnly, c.performance);
router.get("/reports", protect, businessPartnerOnly, c.performance);
router.get("/commissions", protect, businessPartnerOnly, c.commissions);
router.get("/commission-history", protect, businessPartnerOnly, c.commissions);
router.get("/bonuses", protect, businessPartnerOnly, c.partnerBonuses);
router.get("/notifications", protect, businessPartnerOnly, c.notifications);
router.get("/activity", protect, businessPartnerOnly, c.activity);
module.exports = router;