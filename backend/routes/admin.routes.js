const express = require("express");

const adminTransactionRequeryController = require("../controllers/adminTransactionRequery.controller");
const bankTransferController = require("../controllers/bankTransfer.controller");
const adminBankReconciliationController = require("../controllers/adminBankReconciliation.controller");
const transactionIntelligenceController = require("../controllers/adminTransactionIntelligence.controller");
const fintechOperationsController = require("../controllers/adminFintechOperations.controller");
const fraudRiskController = require("../controllers/adminFraudRisk.controller");

const {
  getAdminDashboard,
  getAdminUsers,
  createAdminUser,
  updateAdminUserStatus,
  updateAdminUserRole,
  getAdminTransactions,
  getAdminDeliveries,
  getAvailableRiders,
  assignRiderToDelivery,
  runRiderPushDiagnostic,
  unassignRiderFromDelivery,
  updateDeliveryStatus,
  updateDeliveryPrice,
  getAdminExecutiveDashboard,
} = require("../controllers/admin.controller");

const {
  getAdminUserDetails,
  updateAdminUserProfile,
  resetAdminUserTransactionPin,
  requestAdminUserPasswordReset,
  getAdminUserTransactions,
  getAdminAuditLogs,
} = require("../controllers/adminCustomer.controller");
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
const {
  STAFF_PERMISSIONS: P,
} = require("../config/staffPermissions");

const {
  adjustCustomerWallet,
} = require(
  "../controllers/adminWalletAdjustment.controller"
);


const adminMarketplaceController = require(
  '../controllers/adminMarketplace.controller'
);
const callController = require("../controllers/call.controller");

const router = express.Router();
const canCreateManagedUser = (
  req,
  res,
  next
) => {
  const creator = req.user;

  if (!creator) {
    return res.status(401).json({
      success: false,
      message:
        "Authentication is required.",
    });
  }

  if (creator.status !== "ACTIVE") {
    return res.status(403).json({
      success: false,
      message:
        "Your account is not active.",
    });
  }

  const creatorRole = String(
    creator.role ?? ""
  )
    .trim()
    .toUpperCase();

  const targetRole = String(
    req.body.role ?? ""
  )
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");

  req.body.role = targetRole;

  if (creatorRole === "HEAD_OFFICE") {
    const allowedRoles = [
      "ZONAL_MANAGER",
      "STATE_MANAGER",
      "AGENT",
    ];

    if (!allowedRoles.includes(targetRole)) {
      return res.status(403).json({
        success: false,
        message:
          "Head Office can only create Zonal Manager, State Manager or Agent accounts.",
      });
    }

    return next();
  }

  if (creatorRole === "ZONAL_MANAGER") {
    if (targetRole !== "STATE_MANAGER") {
      return res.status(403).json({
        success: false,
        message:
          "A Zonal Manager can only create State Manager accounts.",
      });
    }

    if (!creator.zone) {
      return res.status(400).json({
        success: false,
        message:
          "Your Zonal Manager account has no assigned zone.",
      });
    }

    req.body.zone = creator.zone;

    req.body.zonalManagerId =
      creator._id.toString();

    req.body.stateManagerId = null;

    return next();
  }

  if (creatorRole === "STATE_MANAGER") {
    if (targetRole !== "AGENT") {
      return res.status(403).json({
        success: false,
        message:
          "A State Manager can only create Agent accounts.",
      });
    }

    if (!creator.zone || !creator.state) {
      return res.status(400).json({
        success: false,
        message:
          "Your State Manager account must have a zone and state.",
      });
    }

    req.body.zone = creator.zone;
    req.body.state = creator.state;

    req.body.stateManagerId =
      creator._id.toString();

    if (creator.zonalManagerId) {
      req.body.zonalManagerId =
        creator.zonalManagerId.toString();
    }

    return next();
  }

  return res.status(403).json({
    success: false,
    message:
      "You do not have permission to create managed accounts.",
  });
};

/*
|--------------------------------------------------------------------------
| DASHBOARD
|--------------------------------------------------------------------------
*/

router.get(
  "/dashboard",
  protect,
  loadStaffRole,
  requirePermission(P.DASHBOARD_VIEW),
  getAdminDashboard
);

/*
 * Executive Dashboard is a read-only projection of the existing bounded
 * dashboard aggregation. Keep this route under the same authentication and
 * dashboard permission guard as the legacy dashboard route.
 * GET /api/admin/dashboard/executive?range=today
 */
router.get(
  "/dashboard/executive",
  protect,
  loadStaffRole,
  requirePermission(P.DASHBOARD_VIEW),
  getAdminExecutiveDashboard
);

/*
|--------------------------------------------------------------------------
| USERS
|--------------------------------------------------------------------------
*/

router.get(
  "/users",
  protect,
  loadStaffRole,
  requirePermission(P.USERS_VIEW),
  getAdminUsers
);

router.post(
  "/users",
  protect,
  loadStaffRole,
  requirePermission(P.USERS_CREATE),
  canCreateManagedUser,
  createAdminUser
);

router.get(
  "/users/:id",
  protect,
  loadStaffRole,
  requirePermission(P.USERS_VIEW),
  requireTargetUserScope("id"),
  getAdminUserDetails
);

router.patch(
  "/users/:id/profile",
  protect,
  loadStaffRole,
  requirePermission(P.USERS_UPDATE),
  requireTargetUserScope("id"),
  updateAdminUserProfile
);

router.patch(
  "/users/:id/status",
  protect,
  loadStaffRole,
  requireAnyPermission(P.USERS_SUSPEND, P.USERS_BLOCK),
  requireTargetUserScope("id"),
  updateAdminUserStatus
);

router.patch(
  "/users/:id/role",
  protect,
  loadStaffRole,
  requirePermission(P.USERS_UPDATE),
  requireTargetUserScope("id"),
  updateAdminUserRole
);

router.post(
  "/users/:id/reset-transaction-pin",
  protect,
  loadStaffRole,
  requirePermission(P.USERS_UPDATE),
  requireTargetUserScope("id"),
  resetAdminUserTransactionPin
);

router.post(
  "/users/:id/password-reset",
  protect,
  loadStaffRole,
  requirePermission(P.USERS_UPDATE),
  requireTargetUserScope("id"),
  requestAdminUserPasswordReset
);

router.get(
  "/users/:id/transactions",
  protect,
  loadStaffRole,
  requirePermission(P.TRANSACTIONS_VIEW),
  requireTargetUserScope("id"),
  getAdminUserTransactions
);

router.get(
  "/users/:id/audit-logs",
  protect,
  loadStaffRole,
  requirePermission(P.AUDIT_VIEW),
  requireTargetUserScope("id"),
  getAdminAuditLogs
);

/*
|--------------------------------------------------------------------------
| CUSTOMER 360 — READ ONLY
|--------------------------------------------------------------------------
*/

router.get(
  "/customer360/search",
  protect,
  loadStaffRole,
  requirePermission(P.CUSTOMER360_VIEW),
  searchCustomer360
);

router.get(
  "/customer360/:customerId",
  protect,
  loadStaffRole,
  requirePermission(P.CUSTOMER360_VIEW),
  requireTargetUserScope("customerId"),
  getCustomer360Overview
);

router.get(
  "/customer360/:customerId/timeline",
  protect,
  loadStaffRole,
  requirePermission(P.CUSTOMER360_VIEW),
  requireTargetUserScope("customerId"),
  getCustomer360Timeline
);

router.get(
  "/customer360/:customerId/transactions",
  protect,
  loadStaffRole,
  requirePermission(P.CUSTOMER360_VIEW),
  requireAnyPermission(P.CUSTOMER360_FINANCIAL, P.TRANSACTIONS_VIEW),
  requireTargetUserScope("customerId"),
  getCustomer360Transactions
);

/*
|--------------------------------------------------------------------------
| DELIVERY RIDERS
|--------------------------------------------------------------------------
*/

router.get(
  "/riders",
  protect,
  loadStaffRole,
  requirePermission(P.RIDERS_VIEW),
  getAdminRiders
);

router.post(
  "/riders",
  protect,
  loadStaffRole,
  requirePermission(P.RIDERS_MANAGE),
  createAdminRider
);

router.get(
  "/riders/:id",
  protect,
  loadStaffRole,
  requirePermission(P.RIDERS_VIEW),
  getAdminRiderDetails
);

router.patch(
  "/riders/:id",
  protect,
  loadStaffRole,
  requirePermission(P.RIDERS_MANAGE),
  updateAdminRider
);

router.patch(
  "/riders/:id/status",
  protect,
  loadStaffRole,
  requirePermission(P.RIDERS_MANAGE),
  updateAdminRiderStatus
);

router.patch(
  "/riders/:id/verification",
  protect,
  loadStaffRole,
  requirePermission(P.RIDERS_MANAGE),
  updateAdminRiderVerification
);

/*
|--------------------------------------------------------------------------
| GLOBAL AUDIT LOGS
|--------------------------------------------------------------------------
*/

router.get(
  "/calls",
  protect,
  loadStaffRole,
  requirePermission(P.CALLS_VIEW),
  callController.adminList
);

router.get(
  "/audit-logs",
  protect,
  loadStaffRole,
  requirePermission(P.AUDIT_VIEW),
  getAdminAuditLogs
);

/*
|--------------------------------------------------------------------------
| TRANSACTIONS
|--------------------------------------------------------------------------
*/

router.get(
  "/transactions",
  protect,
  loadStaffRole,
  requirePermission(P.TRANSACTIONS_VIEW),
  getAdminTransactions
);

/*
|--------------------------------------------------------------------------
| DELIVERIES
|--------------------------------------------------------------------------
*/

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

router.post(
  "/riders/:id/push-diagnostic",
  protect,
  adminOnly("HEAD_OFFICE", "ADMIN", "SUPER_ADMIN"),
  loadStaffRole,
  enforceActiveBranchScope,
  requirePermission(P.DELIVERY_ASSIGN),
  runRiderPushDiagnostic
);

router.patch(
  "/deliveries/:id/unassign-rider",
  protect,
  loadStaffRole,
  enforceActiveBranchScope,
  requirePermission(P.DELIVERY_ASSIGN),
  unassignRiderFromDelivery
);

router.patch(
  "/deliveries/:id/status",
  protect,
  loadStaffRole,
  enforceActiveBranchScope,
  requirePermission(P.DELIVERY_UPDATE),
  updateDeliveryStatus
);

router.patch(
  "/deliveries/:id/price",
  protect,
  loadStaffRole,
  enforceActiveBranchScope,
  requirePermission(P.DELIVERY_UPDATE),
  updateDeliveryPrice
);


/*
|--------------------------------------------------------------------------
| HEAD OFFICE CUSTOMER WALLET ADJUSTMENT
|--------------------------------------------------------------------------
*/

router.post(
  "/wallet-adjustment",
  protect,
  loadStaffRole,
  requirePermission(P.WALLETS_ADJUST),
  adjustCustomerWallet
);


/*
 * ============================================================
 * MARKETPLACE PRODUCT MODERATION — HEAD OFFICE ONLY
 * ============================================================
 */

router.get(
  '/marketplace/products',
  protect,
  loadStaffRole,
  enforceActiveBranchScope,
  requireAssignedBranchModule("MARKETPLACE"),
  requirePermission(P.MARKETPLACE_VIEW),
  adminMarketplaceController.listMarketplaceProducts
);

router.patch(
  '/marketplace/products/:id/status',
  protect,
  loadStaffRole,
  enforceActiveBranchScope,
  requireAssignedBranchModule("MARKETPLACE"),
  requirePermission(P.MARKETPLACE_MODERATE),
  adminMarketplaceController.updateMarketplaceProductStatus
);

router.patch(
  '/marketplace/products/:id/approve',
  protect,
  loadStaffRole,
  enforceActiveBranchScope,
  requireAssignedBranchModule("MARKETPLACE"),
  requirePermission(P.MARKETPLACE_MODERATE),
  adminMarketplaceController.approveMarketplaceProduct
);

router.patch(
  '/marketplace/products/:id/reject',
  protect,
  loadStaffRole,
  enforceActiveBranchScope,
  requireAssignedBranchModule("MARKETPLACE"),
  requirePermission(P.MARKETPLACE_MODERATE),
  adminMarketplaceController.rejectMarketplaceProduct
);

router.patch(
  '/marketplace/products/:id/suspend',
  protect,
  loadStaffRole,
  enforceActiveBranchScope,
  requireAssignedBranchModule("MARKETPLACE"),
  requirePermission(P.MARKETPLACE_MODERATE),
  adminMarketplaceController.suspendMarketplaceProduct
);



/*
 * HEAD OFFICE-only real bank-transfer requery.
 * POST /api/admin/transaction-requery
 * Body: { "reference": "..." }
 */
router.post(
  "/transaction-requery",
  protect,
  loadStaffRole,
  requirePermission(P.TRANSACTIONS_REQUERY),
  adminTransactionRequeryController.adminRequeryTransaction
);

router.get(
  "/bank-reconciliation",
  protect,
  loadStaffRole,
  requirePermission(P.FINANCE_RECONCILE),
  adminBankReconciliationController.listBankReconciliation
);

/*
 * Transaction Intelligence is read-only unless an explicit action route is
 * called. Requery delegates to the existing provider-safe implementation.
 */
const transactionIntelligenceView = [
  protect,
  loadStaffRole,
  requirePermission(P.TRANSACTION_INTELLIGENCE_VIEW),
];
router.get("/transaction-intelligence/summary", ...transactionIntelligenceView, transactionIntelligenceController.getSummary);
router.get("/transaction-intelligence/transactions", ...transactionIntelligenceView, transactionIntelligenceController.searchTransactions);
router.get("/transaction-intelligence/queue", ...transactionIntelligenceView, transactionIntelligenceController.getReconciliationQueue);
router.get(
  "/transaction-intelligence/providers",
  protect,
  loadStaffRole,
  requirePermission(P.TRANSACTION_INTELLIGENCE_PROVIDER_HEALTH),
  transactionIntelligenceController.getProviderHealth
);
router.get("/transaction-intelligence/alerts", ...transactionIntelligenceView, transactionIntelligenceController.getAlerts);
router.get("/transaction-intelligence/transactions/:transactionId", ...transactionIntelligenceView, transactionIntelligenceController.getTransactionDetail);
router.get("/transaction-intelligence/transactions/:transactionId/timeline", ...transactionIntelligenceView, transactionIntelligenceController.getTransactionTimeline);
router.post(
  "/transaction-intelligence/transactions/:transactionId/requery",
  protect,
  loadStaffRole,
  requirePermission(P.TRANSACTION_INTELLIGENCE_REQUERY),
  transactionIntelligenceController.requeryTransaction
);
router.post(
  "/transaction-intelligence/export.csv",
  protect,
  loadStaffRole,
  requirePermission(P.TRANSACTION_INTELLIGENCE_EXPORT),
  transactionIntelligenceController.exportTransactions
);

/*
 * Fraud & Risk Command Center is monitoring-first. It has no route that
 * changes customer, wallet, transaction, or provider state.
 */
const fraudRiskView = [protect, loadStaffRole, requirePermission(P.FRAUD_RISK_VIEW)];
router.get("/fraud-risk/overview", ...fraudRiskView, fraudRiskController.overview);
router.get("/fraud-risk/alerts", ...fraudRiskView, fraudRiskController.list);
router.get("/fraud-risk/alerts/:alertId", ...fraudRiskView, fraudRiskController.detail);
router.get("/fraud-risk/alerts/:alertId/audit", ...fraudRiskView, fraudRiskController.auditHistory);
router.get("/fraud-risk/customers/:customerId", ...fraudRiskView, fraudRiskController.customerProfile);
router.get("/fraud-risk/analytics", ...fraudRiskView, fraudRiskController.analytics);
router.post("/fraud-risk/evaluate", protect, loadStaffRole, requirePermission(P.FRAUD_RISK_INVESTIGATE), fraudRiskController.evaluate);
router.post("/fraud-risk/alerts/:alertId/case", protect, loadStaffRole, requireAnyPermission(P.FRAUD_RISK_INVESTIGATE, P.FRAUD_RISK_ASSIGN, P.FRAUD_RISK_RESOLVE), fraudRiskController.mutate);
router.get("/fraud-risk/rules", ...fraudRiskView, fraudRiskController.rules);
router.patch("/fraud-risk/rules/:ruleId", protect, loadStaffRole, requirePermission(P.FRAUD_RISK_RULES_MANAGE), fraudRiskController.updateRule);
router.post("/fraud-risk/export.csv", protect, loadStaffRole, requirePermission(P.FRAUD_RISK_EXPORT), fraudRiskController.exportCsv);
router.post("/fraud-risk/restrict", protect, loadStaffRole, requirePermission(P.FRAUD_RISK_RESTRICT), fraudRiskController.restrictUnsupported);

/*
 * Fintech operational workspaces. All mutations carry immutable AdminAuditLog
 * entries and each financial action requires an idempotency key.
 */
const financeViewAccess = [protect, loadStaffRole, requirePermission(P.FINANCE_VIEW)];
const financeApproveAccess = [protect, loadStaffRole, requirePermission(P.FINANCE_APPROVE)];
router.get("/fintech-operations/customers", ...financeViewAccess, fintechOperationsController.searchCustomers);
router.get("/fintech-operations/customers/:userId", ...financeViewAccess, fintechOperationsController.getCustomerOperations);
router.post("/fintech-operations/restrictions", ...financeApproveAccess, fintechOperationsController.createRestriction);
router.post("/fintech-operations/restrictions/:restrictionId/remove", ...financeApproveAccess, fintechOperationsController.removeRestriction);
router.get("/fintech-operations/wallet-holds", ...financeViewAccess, fintechOperationsController.listWalletHolds);
router.post("/fintech-operations/wallet-holds", ...financeApproveAccess, fintechOperationsController.createWalletHold);
router.post("/fintech-operations/wallet-holds/:holdId/release", ...financeApproveAccess, fintechOperationsController.releaseWalletHold);
router.get("/fintech-operations/failed-transactions", ...financeViewAccess, fintechOperationsController.listFailedTransactions);
router.post("/fintech-operations/failed-transactions/:transactionId/investigate", ...financeApproveAccess, fintechOperationsController.markTransactionInvestigation);
router.get("/fintech-operations/virtual-accounts", ...financeViewAccess, fintechOperationsController.listVirtualAccounts);
router.get("/fintech-operations/dedicated-accounts", ...financeViewAccess, fintechOperationsController.listDedicatedAccounts);
router.get("/fintech-operations/bank-partners", ...financeViewAccess, fintechOperationsController.listBankPartners);
router.get("/fintech-operations/routing-status", ...financeViewAccess, fintechOperationsController.listRoutingStatus);
router.get("/fintech-operations/fraud-alerts", ...financeViewAccess, fintechOperationsController.listFraudAlerts);
router.post("/fintech-operations/fraud-alerts/:alertId", ...financeApproveAccess, fintechOperationsController.updateFraudAlert);
router.get("/fintech-operations/watchlist", ...financeViewAccess, fintechOperationsController.listWatchlist);
router.post("/fintech-operations/watchlist", ...financeApproveAccess, fintechOperationsController.createWatchlistEntry);
router.post("/fintech-operations/watchlist/:entryId/clear", ...financeApproveAccess, fintechOperationsController.clearWatchlistEntry);
router.get("/fintech-operations/login-risk", ...financeViewAccess, fintechOperationsController.listLoginRisk);
router.get("/fintech-operations/financial-actions", ...financeViewAccess, fintechOperationsController.listFinancialActions);
router.post("/fintech-operations/financial-actions/:type", ...financeApproveAccess, fintechOperationsController.executeFinancialAction);
router.get("/fintech-operations/disputes", ...financeViewAccess, fintechOperationsController.listDisputes);
router.post("/fintech-operations/disputes", ...financeApproveAccess, fintechOperationsController.createDispute);
router.post("/fintech-operations/disputes/:disputeId", ...financeApproveAccess, fintechOperationsController.updateDispute);

module.exports = router;
