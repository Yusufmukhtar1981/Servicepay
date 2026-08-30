const express = require("express");

const adminTransactionRequeryController = require("../controllers/adminTransactionRequery.controller");
const bankTransferController = require("../controllers/bankTransfer.controller");
const adminBankReconciliationController = require("../controllers/adminBankReconciliation.controller");
const transactionIntelligenceController = require("../controllers/adminTransactionIntelligence.controller");
const fintechOperationsController = require("../controllers/adminFintechOperations.controller");

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

const router = express.Router();
const DELIVERY_ADMIN_ROLES = [
  "HEAD_OFFICE",
  "ADMIN",
  "SUPER_ADMIN",
  "HEAD_OFFICE_ADMIN",
];

const MANAGEMENT_ROLES = [
  "HEAD_OFFICE",
  "ZONAL_MANAGER",
  "STATE_MANAGER",
];

const dashboardPermission = (req, res, next) => {
  const role = String(req.user?.role || "").toUpperCase();
  if (role !== "STAFF") return next();
  return res.status(403).json({
    success: false,
    message:
      "Executive dashboard access requires a server-defined management scope.",
  });
};

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
  requirePermission("dashboard.view"),
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

/*
|--------------------------------------------------------------------------
| USERS
|--------------------------------------------------------------------------
*/

router.get(
  "/users",
  protect,
  adminOnly(
    "HEAD_OFFICE",
    "ZONAL_MANAGER",
    "STATE_MANAGER"
  ),
  getAdminUsers
);

router.post(
  "/users",
  protect,
  canCreateManagedUser,
  createAdminUser
);

router.get(
  "/users/:id",
  protect,
  adminOnly(
    "HEAD_OFFICE",
    "ZONAL_MANAGER",
    "STATE_MANAGER"
  ),
  getAdminUserDetails
);

router.patch(
  "/users/:id/profile",
  protect,
  adminOnly("HEAD_OFFICE"),
  updateAdminUserProfile
);

router.patch(
  "/users/:id/status",
  protect,
  adminOnly(...MANAGEMENT_ROLES),
  updateAdminUserStatus
);

router.patch(
  "/users/:id/role",
  protect,
  adminOnly("HEAD_OFFICE"),
  updateAdminUserRole
);

router.post(
  "/users/:id/reset-transaction-pin",
  protect,
  adminOnly("HEAD_OFFICE"),
  resetAdminUserTransactionPin
);

router.post(
  "/users/:id/password-reset",
  protect,
  adminOnly("HEAD_OFFICE"),
  requestAdminUserPasswordReset
);

router.get(
  "/users/:id/transactions",
  protect,
  adminOnly(
    "HEAD_OFFICE",
    "ZONAL_MANAGER",
    "STATE_MANAGER"
  ),
  getAdminUserTransactions
);

router.get(
  "/users/:id/audit-logs",
  protect,
  adminOnly("HEAD_OFFICE"),
  getAdminAuditLogs
);

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
  getCustomer360Overview
);

router.get(
  "/customer360/:customerId/timeline",
  protect,
  loadStaffRole,
  requirePermission(P.CUSTOMER360_VIEW),
  getCustomer360Timeline
);

router.get(
  "/customer360/:customerId/transactions",
  protect,
  loadStaffRole,
  requirePermission(P.CUSTOMER360_FINANCIAL),
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
  adminOnly("HEAD_OFFICE"),
  getAdminRiders
);

router.post(
  "/riders",
  protect,
  adminOnly("HEAD_OFFICE"),
  createAdminRider
);

router.get(
  "/riders/:id",
  protect,
  adminOnly("HEAD_OFFICE"),
  getAdminRiderDetails
);

router.patch(
  "/riders/:id",
  protect,
  adminOnly("HEAD_OFFICE"),
  updateAdminRider
);

router.patch(
  "/riders/:id/status",
  protect,
  adminOnly("HEAD_OFFICE"),
  updateAdminRiderStatus
);

router.patch(
  "/riders/:id/verification",
  protect,
  adminOnly("HEAD_OFFICE"),
  updateAdminRiderVerification
);

/*
|--------------------------------------------------------------------------
| GLOBAL AUDIT LOGS
|--------------------------------------------------------------------------
*/

router.get(
  "/audit-logs",
  protect,
  adminOnly("HEAD_OFFICE"),
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
  adminOnly("HEAD_OFFICE"),
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
  adminOnly(...DELIVERY_ADMIN_ROLES),
  getAdminDeliveries
);

router.get(
  "/deliveries/:id/available-riders",
  protect,
  adminOnly(...DELIVERY_ADMIN_ROLES),
  getAvailableRiders
);

router.patch(
  "/deliveries/:id/assign-rider",
  protect,
  adminOnly(...DELIVERY_ADMIN_ROLES),
  assignRiderToDelivery
);

router.patch(
  "/deliveries/:id/unassign-rider",
  protect,
  adminOnly(...DELIVERY_ADMIN_ROLES),
  unassignRiderFromDelivery
);

router.patch(
  "/deliveries/:id/status",
  protect,
  adminOnly(...DELIVERY_ADMIN_ROLES),
  updateDeliveryStatus
);

router.patch(
  "/deliveries/:id/price",
  protect,
  adminOnly(...DELIVERY_ADMIN_ROLES),
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
  adminOnly("HEAD_OFFICE"),
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
  adminOnly('HEAD_OFFICE'),
  adminMarketplaceController.listMarketplaceProducts
);

router.patch(
  '/marketplace/products/:id/status',
  protect,
  adminOnly('HEAD_OFFICE'),
  adminMarketplaceController.updateMarketplaceProductStatus
);

router.patch(
  '/marketplace/products/:id/approve',
  protect,
  adminOnly('HEAD_OFFICE'),
  adminMarketplaceController.approveMarketplaceProduct
);

router.patch(
  '/marketplace/products/:id/reject',
  protect,
  adminOnly('HEAD_OFFICE'),
  adminMarketplaceController.rejectMarketplaceProduct
);

router.patch(
  '/marketplace/products/:id/suspend',
  protect,
  adminOnly('HEAD_OFFICE'),
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
  adminOnly("HEAD_OFFICE"),
  adminTransactionRequeryController.adminRequeryTransaction
);

router.get(
  "/bank-reconciliation",
  protect,
  adminOnly("HEAD_OFFICE"),
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
 * Fintech operational workspaces. All mutations carry immutable AdminAuditLog
 * entries and each financial action requires an idempotency key.
 */
router.get("/fintech-operations/customers", protect, adminOnly("HEAD_OFFICE"), fintechOperationsController.searchCustomers);
router.get("/fintech-operations/customers/:userId", protect, adminOnly("HEAD_OFFICE"), fintechOperationsController.getCustomerOperations);
router.post("/fintech-operations/restrictions", protect, adminOnly("HEAD_OFFICE"), fintechOperationsController.createRestriction);
router.post("/fintech-operations/restrictions/:restrictionId/remove", protect, adminOnly("HEAD_OFFICE"), fintechOperationsController.removeRestriction);
router.get("/fintech-operations/wallet-holds", protect, adminOnly("HEAD_OFFICE"), fintechOperationsController.listWalletHolds);
router.post("/fintech-operations/wallet-holds", protect, adminOnly("HEAD_OFFICE"), fintechOperationsController.createWalletHold);
router.post("/fintech-operations/wallet-holds/:holdId/release", protect, adminOnly("HEAD_OFFICE"), fintechOperationsController.releaseWalletHold);
router.get("/fintech-operations/failed-transactions", protect, adminOnly("HEAD_OFFICE"), fintechOperationsController.listFailedTransactions);
router.post("/fintech-operations/failed-transactions/:transactionId/investigate", protect, adminOnly("HEAD_OFFICE"), fintechOperationsController.markTransactionInvestigation);
router.get("/fintech-operations/virtual-accounts", protect, adminOnly("HEAD_OFFICE"), fintechOperationsController.listVirtualAccounts);
router.get("/fintech-operations/dedicated-accounts", protect, adminOnly("HEAD_OFFICE"), fintechOperationsController.listDedicatedAccounts);
router.get("/fintech-operations/bank-partners", protect, adminOnly("HEAD_OFFICE"), fintechOperationsController.listBankPartners);
router.get("/fintech-operations/routing-status", protect, adminOnly("HEAD_OFFICE"), fintechOperationsController.listRoutingStatus);
router.get("/fintech-operations/fraud-alerts", protect, adminOnly("HEAD_OFFICE"), fintechOperationsController.listFraudAlerts);
router.post("/fintech-operations/fraud-alerts/:alertId", protect, adminOnly("HEAD_OFFICE"), fintechOperationsController.updateFraudAlert);
router.get("/fintech-operations/watchlist", protect, adminOnly("HEAD_OFFICE"), fintechOperationsController.listWatchlist);
router.post("/fintech-operations/watchlist", protect, adminOnly("HEAD_OFFICE"), fintechOperationsController.createWatchlistEntry);
router.post("/fintech-operations/watchlist/:entryId/clear", protect, adminOnly("HEAD_OFFICE"), fintechOperationsController.clearWatchlistEntry);
router.get("/fintech-operations/login-risk", protect, adminOnly("HEAD_OFFICE"), fintechOperationsController.listLoginRisk);
router.get("/fintech-operations/financial-actions", protect, adminOnly("HEAD_OFFICE"), fintechOperationsController.listFinancialActions);
router.post("/fintech-operations/financial-actions/:type", protect, adminOnly("HEAD_OFFICE"), fintechOperationsController.executeFinancialAction);
router.get("/fintech-operations/disputes", protect, adminOnly("HEAD_OFFICE"), fintechOperationsController.listDisputes);
router.post("/fintech-operations/disputes", protect, adminOnly("HEAD_OFFICE"), fintechOperationsController.createDispute);
router.post("/fintech-operations/disputes/:disputeId", protect, adminOnly("HEAD_OFFICE"), fintechOperationsController.updateDispute);

module.exports = router;
