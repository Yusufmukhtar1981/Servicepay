const test = require("node:test");
const assert = require("node:assert/strict");

const adminRoutes = require("../routes/admin.routes");
const adminController = require("../controllers/admin.controller");

const route = (path, method) =>
  adminRoutes.stack.find(
    (layer) => layer.route?.path === path && layer.route.methods?.[method],
  )?.route;

test("admin available-riders endpoint is protected and mounted", () => {
  const mounted = route("/deliveries/:id/available-riders", "get");
  assert.ok(mounted);
  assert.equal(mounted.stack.at(-1).handle, adminController.getAvailableRiders);
  assert.ok(mounted.stack.length >= 5);
});

test("admin rider-assignment endpoint is protected and mounted", () => {
  const mounted = route("/deliveries/:id/assign-rider", "patch");
  assert.ok(mounted);
  assert.equal(mounted.stack.at(-1).handle, adminController.assignRiderToDelivery);
  assert.ok(mounted.stack.length >= 5);
});

test("admin rider-reassignment endpoint keeps delivery assignment protection", () => {
  const mounted = route("/deliveries/:id/reassign-rider", "patch");
  assert.ok(mounted);
  assert.equal(mounted.stack.at(-1).handle, adminController.reassignRiderToDelivery);
  assert.ok(mounted.stack.length >= 5);
});