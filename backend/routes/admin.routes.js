const express = require("express");

const {
  getAdminDashboard,
  getAdminUsers,
  createAdminUser,
  updateAdminUserStatus,
  updateAdminUserRole,
  getAdminTransactions,
  getAdminDeliveries,
  updateDeliveryStatus,
  updateDeliveryPrice,
} = require("../controllers/admin.controller");

const {
  protect,
  adminOnly,
} = require("../middleware/auth.middleware");

const {
  loadStaffRole,
  requirePermission,
} = require("../middleware/staffPermission.middleware");

const router = express.Router();

const MANAGEMENT_ROLES = [
  "HEAD_OFFICE",
  "ZONAL_MANAGER",
  "STATE_MANAGER",
];


/*
|--------------------------------------------------------------------------
| HIERARCHY ACCOUNT CREATION PERMISSION
|--------------------------------------------------------------------------
*/

const canCreateManagedUser = (
  req,
  res,
  next
) => {
  const creator = req.user;

  if (!creator) {
    return res.status(401).json({
      success: false,
      message: "Authentication is required.",
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


router.get(
  "/dashboard",
  protect,
  loadStaffRole,
  requirePermission("dashboard.view"),
  getAdminDashboard
);

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

router.patch(
  "/deliveries/:id/price",
  protect,
  adminOnly("HEAD_OFFICE"),
  updateDeliveryPrice
);

module.exports = router;
