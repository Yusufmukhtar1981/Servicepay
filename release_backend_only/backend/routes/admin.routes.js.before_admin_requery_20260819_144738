const express = require("express");

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
  adjustCustomerWallet,
} = require(
  "../controllers/adminWalletAdjustment.controller"
);


const adminMarketplaceController = require(
  '../controllers/adminMarketplace.controller'
);

const router = express.Router();

const MANAGEMENT_ROLES = [
  "HEAD_OFFICE",
  "ZONAL_MANAGER",
  "STATE_MANAGER",
];

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
  adminOnly("HEAD_OFFICE"),
  getAdminDeliveries
);

router.get(
  "/deliveries/:id/available-riders",
  protect,
  adminOnly("HEAD_OFFICE"),
  getAvailableRiders
);

router.patch(
  "/deliveries/:id/assign-rider",
  protect,
  adminOnly("HEAD_OFFICE"),
  assignRiderToDelivery
);

router.patch(
  "/deliveries/:id/unassign-rider",
  protect,
  adminOnly("HEAD_OFFICE"),
  unassignRiderFromDelivery
);

router.patch(
  "/deliveries/:id/status",
  protect,
  adminOnly("HEAD_OFFICE"),
  updateDeliveryStatus
);

router.patch(
  "/deliveries/:id/price",
  protect,
  adminOnly("HEAD_OFFICE"),
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

module.exports = router;
