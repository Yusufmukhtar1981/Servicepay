const test = require("node:test");
const assert = require("node:assert/strict");

const branchRoutes = require("../routes/branch.routes");
const adminController = require("../controllers/admin.controller");
const branchController = require("../controllers/branch.controller");

const route = (path, method) =>
  branchRoutes.stack.find(
    (layer) => layer.route?.path === path && layer.route.methods?.[method],
  )?.route;

test("branch delivery list uses the scoped delivery controller", () => {
  const mounted = route("/deliveries", "get");
  assert.ok(mounted);
  assert.equal(mounted.stack.at(-1).handle, adminController.getAdminDeliveries);
  // The router-wide authentication, role loading, and branch scope middleware
  // run before this permission-guarded endpoint.
  assert.ok(mounted.stack.length >= 2);
});

test("branch rider assignment is mounted behind branch permissions", () => {
  const riders = route("/deliveries/:id/available-riders", "get");
  const assign = route("/deliveries/:id/assign-rider", "patch");
  assert.ok(riders);
  assert.ok(assign);
  assert.equal(riders.stack.at(-1).handle, branchController.availableRiders);
  assert.equal(assign.stack.at(-1).handle, adminController.assignRiderToDelivery);
  assert.ok(riders.stack.length >= 2);
  assert.ok(assign.stack.length >= 2);
});

test("branch rider and reassignment routes stay in the scoped router", () => {
  const riders = route("/riders", "get");
  const detail = route("/riders/:riderId", "get");
  const unassign = route("/deliveries/:id/unassign-rider", "patch");
  assert.equal(riders.stack.at(-1).handle, branchController.riders);
  assert.equal(detail.stack.at(-1).handle, branchController.rider);
  assert.equal(unassign.stack.at(-1).handle, adminController.unassignRiderFromDelivery);
  assert.equal(route("/deliveries/:id/reassign-rider", "patch").stack.at(-1).handle, adminController.reassignRiderToDelivery);
});

test("branch customer and finance views use branch-scoped controllers", () => {
  const customers = route("/customers", "get");
  const customer = route("/customers/:customerId", "get");
  const transactions = route("/transactions", "get");
  assert.ok(customers);
  assert.ok(customer);
  assert.ok(transactions);
  assert.equal(customers.stack.at(-1).handle, branchController.customers);
  assert.equal(customer.stack.at(-1).handle, branchController.customer);
  assert.equal(transactions.stack.at(-1).handle, branchController.transactions);
  // Permission middleware is route-local; authentication and branch scope are
  // installed once at the router level.
  assert.ok(customers.stack.length >= 2);
  assert.ok(transactions.stack.length >= 2);
});

test("branch operational views are mounted without global admin handlers", () => {
  assert.equal(route("/officers", "get").stack.at(-1).handle, branchController.officers);
  assert.equal(route("/kyc", "get").stack.at(-1).handle, branchController.kyc);
  assert.equal(route("/solar/applications", "get").stack.at(-1).handle, branchController.solarApplications);
  assert.equal(route("/marketplace/orders", "get").stack.at(-1).handle, branchController.marketplaceOrders);
});