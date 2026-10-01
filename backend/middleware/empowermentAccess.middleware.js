const {
  loadStaffRole,
  requireAnyPermission,
  enforceActiveBranchScope,
  requireAssignedBranchModule,
} = require("./staffPermission.middleware");
const { STAFF_PERMISSIONS: P } = require("../config/staffPermissions");

// Customers retain their existing sponsor/application ownership routes. Any
// staff actor, however, must have an active branch, the EMPOWERMENT module,
// and an explicit permission before reaching an administrative surface.
const staffActor = (user) => user?.isStaff === true || [
  "HEAD_OFFICE",
  "ZONAL_MANAGER",
  "STATE_MANAGER",
].includes(String(user?.role || "").trim().toUpperCase());
const hierarchyManager = (user) => [
  "ZONAL_MANAGER",
  "STATE_MANAGER",
].includes(String(user?.role || "").trim().toUpperCase());

const staffAccess = (...permissions) => async (req, res, next) => {
  if (!staffActor(req.user)) return next();
  return loadStaffRole(req, res, () =>
    requireAnyPermission(permissions)(req, res, () =>
      hierarchyManager(req.user)
        ? next()
        : enforceActiveBranchScope(req, res, () =>
            requireAssignedBranchModule("EMPOWERMENT")(req, res, next)
          )
    )
  );
};

const viewAccess = staffAccess(
  P.EMPOWERMENT_VIEW,
  P.BRANCH_EMPOWERMENT_VIEW
);
const manageAccess = staffAccess(
  P.EMPOWERMENT_MANAGE,
  P.BRANCH_EMPOWERMENT_MANAGE
);

module.exports = {
  staffAccess,
  viewAccess,
  manageAccess,
};