const express = require("express");
const adminTransactionRequeryController = require("../controllers/adminTransactionRequery.controller");
const adminBankReconciliationController = require("../controllers/adminBankReconciliation.controller");
const transactionIntelligenceController = require("../controllers/adminTransactionIntelligence.controller");

const {
  getAdminDashboard,
  getAdminTransactions,
  getAdminDeliveries,
  getAvailableRiders,
  assignRiderToDelivery,
  reassignRiderToDelivery,
  updateDeliveryStatus,
  getAdminUsers,
  createAdminUser,
  updateAdminUserStatus,
  getAdminExecutiveDashboard,
   getAdminDashboardTargets,
   updateAdminDashboardTargets,
   getAdminDashboardExport,
} = require("../controllers/admin.controller");

const {
  protect,
  adminOnly,
} = require("../middleware/auth.middleware");
const {
  loadStaffRole,
  requirePermission,
  requireAnyPermission,
  requireTargetUserScope,
  enforceActiveBranchScope,
  requireAssignedBranchModule,
} = require("../middleware/staffPermission.middleware");
const { STAFF_PERMISSIONS: P } = require("../config/staffPermissions");
const adminMarketplaceController = require("../controllers/adminMarketplace.controller");
const {
  searchCustomers: searchCustomer360,
  getCustomerOverview: getCustomer360Overview,
  getCustomerTimeline: getCustomer360Timeline,
  getCustomerTransactions: getCustomer360Transactions,
} = require("../controllers/adminCustomer360.controller");
const {
  getAdminRiders,
  createAdminRider,
  getAdminRiderDetails,
  updateAdminRider,
  updateAdminRiderStatus,
  updateAdminRiderVerification,
} = require("../controllers/adminRider.controller");

const router = express.Router();

const MANAGEMENT_ROLES = [
  "HEAD_OFFICE",
  "ZONAL_MANAGER",
  "STATE_MANAGER",
];

const dashboardPermission = (req, res, next) => {
  const role = String(req.user?.role || "").toUpperCase();
  if (role !== "STAFF") return next();
  const permissions = new Set([
    ...(Array.isArray(req.user?.permissions) ? req.user.permissions : []),
    ...(Array.isArray(req.user?.staffRole?.permissions)
      ? req.user.staffRole.permissions
      : []),
  ].map((value) => String(value).trim().toLowerCase()));
  if (permissions.has("*") || permissions.has("dashboard.view")) return next();
  return res.status(403).json({
    success: false,
    message: "Executive dashboard access requires dashboard.view permission.",
  });
};

/*
 * Management dashboard.
 *
 * Important: getAdminDashboard should eventually
 * return records limited to the logged-in manager's
 * zone/state.
 */
router.get(
  "/dashboard",
  protect,
  adminOnly(...MANAGEMENT_ROLES),
  getAdminDashboard
);

router.get(
  "/dashboard/executive",
  protect,
  adminOnly(
    "HEAD_OFFICE",
    "ADMIN",
    "SUPER_ADMIN",
    "HEAD_OFFICE_ADMIN",
    "ZONAL_MANAGER",
    "STATE_MANAGER",
    "STAFF",
  ),
  dashboardPermission,
  getAdminExecutiveDashboard,
);

router.get(
  "/dashboard/executive/targets",
  protect,
  adminOnly("HEAD_OFFICE"),
  getAdminDashboardTargets,
);

router.put(
  "/dashboard/executive/targets",
  protect,
  adminOnly("HEAD_OFFICE"),
  updateAdminDashboardTargets,
);

router.get(
  "/dashboard/executive/export",
  protect,
  adminOnly(
    "HEAD_OFFICE",
    "ADMIN",
    "SUPER_ADMIN",
    "HEAD_OFFICE_ADMIN",
    "ZONAL_MANAGER",
    "STATE_MANAGER",
    "STAFF",
  ),
  getAdminDashboardExport,
);

/*
 * User management.
 */
router.get(
  "/users",
  protect,
  adminOnly(...MANAGEMENT_ROLES),
  getAdminUsers
);

router.post(
  "/users",
  protect,
  adminOnly(...MANAGEMENT_ROLES),
  createAdminUser
);

router.patch(
  "/users/:id/status",
  protect,
  adminOnly(...MANAGEMENT_ROLES),
  updateAdminUserStatus
);

/*
 * Head Office-only financial and operational routes.
 */
router.get(
  "/transactions",
  protect,
  adminOnly("HEAD_OFFICE"),
  getAdminTransactions
);

router.get(
  "/deliveries",
  protect,
  loadStaffRole,
  enforceActiveBranchScope,
  requirePermission(P.DELIVERY_VIEW),
  getAdminDeliveries
);

router.get(
  "/deliveries/:id/available-riders",
  protect,
  loadStaffRole,
  enforceActiveBranchScope,
  requirePermission(P.DELIVERY_ASSIGN),
  getAvailableRiders
);

router.patch(
  "/deliveries/:id/assign-rider",
  protect,
  loadStaffRole,
  enforceActiveBranchScope,
  requirePermission(P.DELIVERY_ASSIGN),
  assignRiderToDelivery
);

router.patch(
  "/deliveries/:id/reassign-rider",
  protect,
  loadStaffRole,
  enforceActiveBranchScope,
  requirePermission(P.DELIVERY_ASSIGN),
  reassignRiderToDelivery
);

router.patch(
  "/deliveries/:id/status",
  protect,
  adminOnly("HEAD_OFFICE"),
  updateDeliveryStatus
);

const marketplaceView = [
  protect,
  loadStaffRole,
  enforceActiveBranchScope,
  requireAssignedBranchModule("MARKETPLACE"),
  requirePermission(P.MARKETPLACE_VIEW),
];
const marketplaceModerate = [
  protect,
  loadStaffRole,
  enforceActiveBranchScope,
  requireAssignedBranchModule("MARKETPLACE"),
  requirePermission(P.MARKETPLACE_MODERATE),
];

router.get("/marketplace/products", ...marketplaceView, adminMarketplaceController.listMarketplaceProducts);
router.get("/marketplace/products/:id", ...marketplaceView, adminMarketplaceController.getMarketplaceProduct);
router.patch("/marketplace/products/:id/status", ...marketplaceModerate, adminMarketplaceController.updateMarketplaceProductStatus);
router.patch("/marketplace/products/:id/approve", ...marketplaceModerate, adminMarketplaceController.approveMarketplaceProduct);
router.patch("/marketplace/products/:id/reject", ...marketplaceModerate, adminMarketplaceController.rejectMarketplaceProduct);
router.patch("/marketplace/products/:id/suspend", ...marketplaceModerate, adminMarketplaceController.suspendMarketplaceProduct);

router.get("/customer360/search", protect, loadStaffRole, requirePermission(P.CUSTOMER360_VIEW), searchCustomer360);
router.get("/customer360/:customerId", protect, loadStaffRole, requirePermission(P.CUSTOMER360_VIEW), requireTargetUserScope("customerId"), getCustomer360Overview);
router.get("/customer360/:customerId/timeline", protect, loadStaffRole, requirePermission(P.CUSTOMER360_VIEW), requireTargetUserScope("customerId"), getCustomer360Timeline);
router.get(
  "/customer360/:customerId/transactions",
  protect,
  loadStaffRole,
  requirePermission(P.CUSTOMER360_VIEW),
  requireAnyPermission(P.CUSTOMER360_FINANCIAL, P.TRANSACTIONS_VIEW),
  requireTargetUserScope("customerId"),
  getCustomer360Transactions
);

router.get("/riders", protect, loadStaffRole, requirePermission(P.RIDERS_VIEW), getAdminRiders);
router.post("/riders", protect, loadStaffRole, requirePermission(P.RIDERS_MANAGE), createAdminRider);
router.get("/riders/:id", protect, loadStaffRole, requirePermission(P.RIDERS_VIEW), getAdminRiderDetails);
router.patch("/riders/:id", protect, loadStaffRole, requirePermission(P.RIDERS_MANAGE), updateAdminRider);
router.patch("/riders/:id/status", protect, loadStaffRole, requirePermission(P.RIDERS_MANAGE), updateAdminRiderStatus);
router.patch("/riders/:id/verification", protect, loadStaffRole, requirePermission(P.RIDERS_MANAGE), updateAdminRiderVerification);

router.post("/transaction-requery", protect, loadStaffRole, requirePermission(P.TRANSACTIONS_REQUERY), adminTransactionRequeryController.adminRequeryTransaction);
router.get("/bank-reconciliation", protect, loadStaffRole, requirePermission(P.FINANCE_RECONCILE), adminBankReconciliationController.listBankReconciliation);

const transactionIntelligenceView = [
  protect,
  loadStaffRole,
  requirePermission(P.TRANSACTION_INTELLIGENCE_VIEW),
];
router.get("/transaction-intelligence/summary", ...transactionIntelligenceView, transactionIntelligenceController.getSummary);
router.get("/transaction-intelligence/transactions", ...transactionIntelligenceView, transactionIntelligenceController.searchTransactions);
router.get("/transaction-intelligence/queue", ...transactionIntelligenceView, transactionIntelligenceController.getReconciliationQueue);
router.get("/transaction-intelligence/providers", protect, loadStaffRole, requirePermission(P.TRANSACTION_INTELLIGENCE_PROVIDER_HEALTH), transactionIntelligenceController.getProviderHealth);
router.get("/transaction-intelligence/alerts", ...transactionIntelligenceView, transactionIntelligenceController.getAlerts);
router.get("/transaction-intelligence/transactions/:transactionId", ...transactionIntelligenceView, transactionIntelligenceController.getTransactionDetail);
router.get("/transaction-intelligence/transactions/:transactionId/timeline", ...transactionIntelligenceView, transactionIntelligenceController.getTransactionTimeline);
router.post("/transaction-intelligence/transactions/:transactionId/requery", protect, loadStaffRole, requirePermission(P.TRANSACTION_INTELLIGENCE_REQUERY), transactionIntelligenceController.requeryTransaction);
router.post("/transaction-intelligence/export.csv", protect, loadStaffRole, requirePermission(P.TRANSACTION_INTELLIGENCE_EXPORT), transactionIntelligenceController.exportTransactions);

module.exports = router;