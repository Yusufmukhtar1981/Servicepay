const test = require("node:test");
const assert = require("node:assert/strict");

const adminRoutes = require("../routes/admin.routes");
const roleRoutes = require("../routes/adminRoleUsers.routes");
const managementRoutes = require("../routes/management.routes");
const { STAFF_PERMISSIONS: P } = require("../config/staffPermissions");

const routes = (router) => router.stack
  .filter((layer) => layer.route)
  .map((layer) => ({
    path: layer.route.path,
    methods: Object.keys(layer.route.methods),
  }));

test("Phase 1 exposes protected wallet adjustment with exact permission", () => {
  const wallet = routes(adminRoutes).find((x) => x.path === "/wallet-adjustment" && x.methods.includes("post"));
  assert.ok(wallet);
  const layer = adminRoutes.stack.find((x) => x.route?.path === "/wallet-adjustment");
  assert.ok(layer.route.stack.some((entry) => String(entry.handle).includes("requireExactWalletPermission")));
  assert.equal(P.WALLETS_ADJUST, "wallets.adjust");
});

test("Phase 1 exposes canonical Zonal creation and idempotent promotion routes", () => {
  const entries = routes(roleRoutes);
  assert.ok(entries.some((x) => x.path === "/zonal-managers" && x.methods.includes("post")));
  assert.ok(entries.some((x) => x.path === "/:userId/promote" && x.methods.includes("post")));
});

test("Phase 1 exposes server-scoped downline summary and transaction endpoints", () => {
  const entries = routes(managementRoutes);
  assert.ok(entries.some((x) => x.path === "/downline/summary"));
  assert.ok(entries.some((x) => x.path === "/downline/transactions"));
  assert.ok(entries.some((x) => x.path === "/downline/transactions/:transactionId"));
});