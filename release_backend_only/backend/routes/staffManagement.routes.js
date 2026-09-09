const express = require("express");

const {
  getPermissionCatalog,
  createRole,
  getRoles,
  updateRole,
  createStaff,
  getStaff,
  getStaffDetail,
  updateStaff,
  updateStaffStatus,
  resetStaffPassword,
  duplicateRole,
  getRoleStaff,
  assignStaffRole,
  deleteRole,
  seedDefaultRoles,
} = require("../controllers/staffManagement.controller");

const {
  protect,
} = require("../middleware/auth.middleware");

const {
  loadStaffRole,
  requirePermission,
} = require("../middleware/staffPermission.middleware");

const {
  STAFF_PERMISSIONS: P,
} = require("../config/staffPermissions");

const router = express.Router();

/*
 * Every endpoint here requires a logged-in user.
 * HEAD_OFFICE receives full access inside loadStaffRole.
 */
router.use(
  protect,
  loadStaffRole
);

router.post(
  "/roles/seed-defaults",
  requirePermission(
    P.ROLES_CREATE
  ),
  seedDefaultRoles
);

router.get(
  "/permissions",
  requirePermission(
    P.ROLES_VIEW
  ),
  getPermissionCatalog
);

router
  .route("/roles")
  .get(
    requirePermission(
      P.ROLES_VIEW
    ),
    getRoles
  )
  .post(
    requirePermission(
      P.ROLES_CREATE
    ),
    createRole
  );

router.put(
  "/roles/:roleId",
  requirePermission(
    P.ROLES_UPDATE
  ),
  updateRole
);

router.post(
  "/roles/:roleId/duplicate",
  requirePermission(P.ROLES_CREATE),
  duplicateRole
);

router.get(
  "/roles/:roleId/staff",
  requirePermission(P.STAFF_VIEW),
  getRoleStaff
);

router.delete(
  "/roles/:roleId",
  requirePermission(P.ROLES_DELETE),
  deleteRole
);

router
  .route("/staff")
  .get(
    requirePermission(
      P.STAFF_VIEW
    ),
    getStaff
  )
  .post(
    requirePermission(
      P.STAFF_CREATE
    ),
    createStaff
  );

router.put(
  "/staff/:staffId",
  requirePermission(P.STAFF_UPDATE),
  updateStaff
);

router.get(
  "/staff/:staffId",
  requirePermission(P.STAFF_VIEW),
  getStaffDetail
);

router.put(
  "/staff/:staffId/status",
  requirePermission(
    P.STAFF_SUSPEND
  ),
  updateStaffStatus
);

router.put(
  "/staff/:staffId/password",
  requirePermission(P.STAFF_RESET_PASSWORD),
  resetStaffPassword
);

router.put(
  "/staff/:staffId/role",
  requirePermission(P.STAFF_ASSIGN_ROLE),
  assignStaffRole
);

module.exports = router;
