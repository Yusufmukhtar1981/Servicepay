const express = require("express");

const {
  getPermissionCatalog,
  createRole,
  getRoles,
  updateRole,
  createStaff,
  getStaff,
  updateStaffStatus,
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
  "/staff/:staffId/status",
  requirePermission(
    P.STAFF_SUSPEND
  ),
  updateStaffStatus
);

module.exports = router;
