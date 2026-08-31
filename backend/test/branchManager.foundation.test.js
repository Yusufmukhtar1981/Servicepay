const test = require("node:test");
const assert = require("node:assert/strict");
const User = require("../models/user.model");
const {
  STAFF_PERMISSIONS: P,
  effectivePermissionsForUser,
  scopeForRole,
} = require("../config/staffPermissions");
const { isUserWithinScope } = require("../middleware/staffPermission.middleware");

test("BRANCH_MANAGER is a branch-scoped internal role", () => {
  const branchId = "000000000000000000000001";
  assert.deepEqual(scopeForRole("BRANCH_MANAGER", { branchId }), {
    type: "BRANCH", branchId,
  });
  assert.equal(isUserWithinScope(
    { scope: scopeForRole("BRANCH_MANAGER", { branchId }) },
    { branchId: "000000000000000000000002" }
  ), false);
});

test("manager grants cannot escape the branch-manager allowlist", () => {
  const permissions = effectivePermissionsForUser({
    role: "BRANCH_MANAGER",
    branchManagerPermissions: [P.BRANCH_DASHBOARD_VIEW, P.WALLETS_ADJUST],
  });
  assert.deepEqual(permissions, [P.BRANCH_DASHBOARD_VIEW]);
});

test("user schema accepts the dedicated BRANCH_MANAGER role", () => {
  const manager = new User({
    fullName: "Branch Manager",
    phone: "08000000000",
    password: "temporary-password",
    role: "BRANCH_MANAGER",
    isStaff: true,
  });
  assert.equal(manager.validateSync(), undefined);
});

test("manager demotion state can preserve a prior STAFF role assignment", () => {
  const priorRole = "000000000000000000000010";
  const manager = new User({
    fullName: "Promoted Staff",
    phone: "08000000001",
    password: "temporary-password",
    role: "BRANCH_MANAGER",
    isStaff: true,
    branchManagerPreviousRole: "STAFF",
    branchManagerPreviousStaffRoleId: priorRole,
  });
  assert.equal(String(manager.branchManagerPreviousStaffRoleId), priorRole);
  assert.equal(manager.branchManagerPreviousRole, "STAFF");
});