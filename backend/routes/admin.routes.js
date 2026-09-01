const express = require("express");

const {
  getAdminDashboard,
  getAdminTransactions,
  getAdminDeliveries,
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

const router = express.Router();

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
  adminOnly("HEAD_OFFICE"),
  getAdminDeliveries
);

router.patch(
  "/deliveries/:id/status",
  protect,
  adminOnly("HEAD_OFFICE"),
  updateDeliveryStatus
);

module.exports = router;