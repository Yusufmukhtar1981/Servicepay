const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { STAFF_PERMISSIONS, directRolePermissions } = require("../config/staffPermissions");

test("branch managers retain the dedicated branch staff management permission", () => {
  assert.ok(directRolePermissions.BRANCH_MANAGER.includes(STAFF_PERMISSIONS.BRANCH_STAFF_MANAGE));
});

test("branch staff routes are permission guarded before the branch catch-all", () => {
  const routes = fs.readFileSync(require.resolve("../routes/branch.routes"), "utf8");
  const staff = routes.indexOf('router.route("/:branchId/staff")');
  const catchAll = routes.indexOf('router.route("/:branchId")');
  assert.ok(staff >= 0 && staff < catchAll);
  assert.match(routes, /staff\/:staffId\/status", requireAnyPermission\(P\.BRANCH_STAFF_MANAGE\)/);
  assert.match(routes, /staff\/:staffId\/password-reset", requireAnyPermission\(P\.BRANCH_STAFF_MANAGE\)/);
});

test("branch staff lifecycle cannot manage the branch manager or Head Office", () => {
  const controller = fs.readFileSync(
    require.resolve("../controllers/branch.controller"),
    "utf8"
  );
  assert.match(controller, /same\(user\._id, branch\?\.managerId\)/);
  assert.match(
    controller,
    /\["HEAD_OFFICE", "BRANCH_MANAGER"\]\.includes\(String\(user\.role\)\.toUpperCase\(\)\)/
  );
  assert.match(controller, /role: \{ \$nin: \["HEAD_OFFICE", "BRANCH_MANAGER"\] \}/);
});