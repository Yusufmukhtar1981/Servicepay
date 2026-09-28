const express = require("express");

const {
  protect,
  adminOnly,
} = require("../middleware/auth.middleware");

const controller = require(
  "../controllers/adminRoleUsers.controller"
);

const router = express.Router();
const hierarchyAssignmentController = require("../controllers/hierarchyAssignment.controller");
const { loadStaffRole, requireExplicitPermission } = require("../middleware/staffPermission.middleware");
const { STAFF_PERMISSIONS } = require("../config/staffPermissions");

router.get(
  "/hierarchy-assignments/history",
  protect,
  adminOnly("HEAD_OFFICE"),
  loadStaffRole,
  requireExplicitPermission(STAFF_PERMISSIONS.HIERARCHY_MANAGE),
  hierarchyAssignmentController.history
);

router.patch(
  "/hierarchy-assignments",
  protect,
  adminOnly("HEAD_OFFICE"),
  loadStaffRole,
  requireExplicitPermission(STAFF_PERMISSIONS.HIERARCHY_MANAGE),
  hierarchyAssignmentController.assign
);

router.get(
  "/",
  protect,
  controller.getRoleUsers
);

router.post("/zonal-managers", protect, controller.createZonalManager);

router.get(
  "/:userId",
  protect,
  controller.getRoleUserById
);

router.put(
  "/:userId/status",
  protect,
  controller.updateRoleUserStatus
);

router.post("/:userId/promote", protect, controller.promoteRoleUser);

router.delete(
  "/:userId",
  protect,
  controller.safeDeleteRoleUser
);

module.exports = router;
