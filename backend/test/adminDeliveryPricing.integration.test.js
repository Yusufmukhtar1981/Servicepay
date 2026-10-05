const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const express = require("express");
const jwt = require("jsonwebtoken");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const adminRoutes = require("../routes/adminInterstateLogistics.routes");
const branchRoutes = require("../routes/branch.routes");
const customerRoutes = require("../routes/interstateLogistics.routes");
const User = require("../models/user.model");
const Branch = require("../models/branch.model");
const Route = require("../models/logisticsRoute.model");
const Settings = require("../models/appSettings.model");
const Coverage = require("../models/deliveryCoverage.model");
const Delivery = require("../models/delivery.model");
const Shipment = require("../models/interstateShipment.model");
const Audit = require("../models/adminAuditLog.model");
const pricing = require("../services/deliveryPricing.service");
const { calculateInterstateQuote } = require("../services/interstatePricing.service");
let mongo, server, base, head, manager, customer, origin, destination;
const request = async (who, path, method = "GET", body) => {
  const response = await fetch(base + path, { method, headers: {
    Authorization: `Bearer ${jwt.sign({ id: String(who._id) }, process.env.JWT_SECRET)}`,
    "Content-Type": "application/json",
  }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
};
const admin = (path, method, body) => request(head, "/api/admin/logistics/interstate" + path, method, body);
const newRoute = (extra = {}) => ({
  name: "Fixture Kano Abuja", originState: "KANO", destinationState: "ABUJA",
  originBranchId: String(origin._id), destinationBranchId: String(destination._id),
  baseFare: 5000, pricingMode: "FIXED", maximumWeightKg: 20,
  minimumWeightKg: 0, pricePerAdditionalKg: 0, standardDeliveryTime: "Fixture scheduled service",
  status: "ACTIVE", customerVisible: true, confirmed: true, ...extra,
});
const parcel = (kind = "DELIVERY", routeId) => ({
  kind, routeId, sender: { name: "Fixture sender", phone: "08012345678",
    state: "KANO", lga: "Fagge", address: "Fixture origin" },
  receiver: { name: "Fixture receiver", phone: "08022345678",
    state: kind === "DELIVERY" ? "KANO" : "ABUJA", lga: "Fixture LGA", address: "Fixture destination" },
  parcel: { category: "DOCUMENTS", description: "Fixture books", quantity: 1, weightKg: 1, declaredValue: 0 },
  paymentMethod: "CASH", prohibitedItemsAcknowledged: true,
});
async function counterOrder(input, key) {
  const prefix = "/api/branches/counter-deliveries";
  const quote = await request(manager, prefix + "/quote", "POST", input);
  assert.equal(quote.status, 200, JSON.stringify(quote.body));
  return request(manager, prefix, "POST", { ...input, quoteToken: quote.body.quote.quoteToken,
    idempotencyKey: key, deliveryFee: 1, total: 1 });
}
test.before(async () => {
  process.env.JWT_SECRET = "delivery-pricing-local-fixture-only";
  // Always disposable localhost storage; never consume ambient Atlas URIs.
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(mongo.getUri(), { dbName: "delivery-pricing-fixture" });
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  const app = express(); app.use(express.json());
  app.use("/api/admin/logistics/interstate", adminRoutes);
  app.use("/api/branches", branchRoutes);
  app.use("/api/logistics/interstate", customerRoutes);
  app.use("/api/delivery", require("../routes/delivery.routes"));
  server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await mongoose.disconnect(); if (mongo) await mongo.stop();
});
test.beforeEach(async () => {
  await Promise.all(Object.values(mongoose.models).map(model => model.collection.deleteMany({})));
  head = await User.create({ role: "HEAD_OFFICE", fullName: "Fixture Head Office",
    phone: "08000000001", password: "Fixture-only-password", status: "ACTIVE" });
  origin = await Branch.create({ code: "FIX-KANO", name: "Fixture Kano", state: "KANO",
    lga: "Fagge", status: "ACTIVE", assignedModules: ["DELIVERY"], createdBy: head._id });
  destination = await Branch.create({ code: "FIX-ABUJA", name: "Fixture Abuja", state: "ABUJA",
    lga: "Fixture LGA", status: "ACTIVE", assignedModules: ["DELIVERY"], createdBy: head._id });
  manager = await User.create({ role: "BRANCH_MANAGER", fullName: "Fixture manager",
    phone: "08000000002", password: "Fixture-only-password", status: "ACTIVE",
    isStaff: true, branchId: origin._id, branchManagerPermissions: ["branch.delivery.view", "branch.delivery.manage"] });
  customer = await User.create({ role: "CUSTOMER", fullName: "Fixture customer",
    phone: "08000000003", password: "Fixture-only-password", status: "ACTIVE", walletBalance: 50000 });
  origin.managerId = manager._id; await origin.save();
  await Settings.create({ key: "GLOBAL_SETTINGS" });
  await Coverage.create({ stateCode: "KANO", stateName: "Kano", isLive: true });
});
test("intra-state edit is confirmed, versioned, audited and used by new counter orders", async () => {
  const oldOrder = await counterOrder(parcel(), "fixture-old-intra-order");
  assert.equal(oldOrder.status, 201, JSON.stringify(oldOrder.body));
  const rejected = await admin("/pricing/intra-state", "PATCH", { price: 1500, expectedVersion: 0 });
  assert.equal(rejected.status, 400);
  const changed = await admin("/pricing/intra-state", "PATCH", { price: 1500.50, expectedVersion: 0, confirmed: true });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  const fresh = await counterOrder(parcel(), "fixture-new-intra-order");
  assert.equal(fresh.status, 201, JSON.stringify(fresh.body));
  assert.equal(fresh.body.order.total, 1500.50);
  const original = await Delivery.findById(oldOrder.body.order.id || oldOrder.body.order._id);
  assert.equal(original.deliveryFee, 2000);
  assert.equal(original.counter.total, 2000);
  const publicPrice = await request(customer, "/api/delivery/pricing");
  assert.equal(publicPrice.body.standardDeliveryFee, 1500.50);
  assert.equal(publicPrice.body.version, 1);
  const log = await Audit.findOne({ "metadata.operation": "INTRA_STATE_PRICE_UPDATED" });
  assert.equal(log.metadata.oldPrice, 2000); assert.equal(log.metadata.newPrice, 1500.50);
  assert.equal(String(log.actorId), String(head._id));
  const conflict = await admin("/pricing/intra-state", "PATCH", { price: 1600, expectedVersion: 0, confirmed: true });
  assert.equal(conflict.status, 409);
});
test("reverse route creation is atomic and each direction can later have an independent price", async () => {
  const created = await admin("/routes", "POST", newRoute({ applySamePriceToReverse: true }));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const forward = created.body.route, reverse = created.body.reverseRoute;
  assert.equal(reverse.originState, "ABUJA"); assert.equal(reverse.destinationState, "KANO");
  const changed = await admin(`/routes/${reverse._id}`, "PATCH",
    { baseFare: 7000, pricingMode: "FIXED", expectedUpdatedAt: reverse.updatedAt, confirmed: true });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal((await Route.findById(forward._id)).baseFare, 5000);
  assert.equal((await Route.findById(reverse._id)).baseFare, 7000);
  const conflict = await admin(`/routes/${reverse._id}`, "PATCH",
    { baseFare: 8000, pricingMode: "FIXED", expectedUpdatedAt: reverse.updatedAt, confirmed: true });
  assert.equal(conflict.status, 409);
});
test("an existing reverse direction rolls back the entire paired create", async () => {
  const existing = await admin("/routes", "POST", newRoute({
    originState: "ABUJA", destinationState: "KANO",
    originBranchId: String(destination._id), destinationBranchId: String(origin._id),
  }));
  assert.equal(existing.status, 201);
  const failed = await admin("/routes", "POST", newRoute({ applySamePriceToReverse: true }));
  assert.equal(failed.status, 409);
  assert.equal(await Route.countDocuments(), 1);
  assert.equal(await Audit.countDocuments({ "metadata.operation": "ROUTE_CREATED" }), 1);
});
test("active directional uniqueness includes different physical branch pairs", async () => {
  const created = await admin("/routes", "POST", newRoute());
  assert.equal(created.status, 201);
  const second = await Branch.create({ code: "FIX-KANO-2", name: "Other fixture Kano",
    state: "KANO", lga: "Fagge", status: "ACTIVE", createdBy: head._id });
  const duplicate = await admin("/routes", "POST", newRoute({ originBranchId: String(second._id) }));
  assert.equal(duplicate.status, 409);
  assert.equal(await Route.countDocuments(), 1);
});
test("changed route prices preserve customer/counter snapshots and disabling blocks new bookings", async () => {
  const created = await admin("/routes", "POST", newRoute());
  const route = created.body.route;
  const input = parcel("INTERSTATE", route._id);
  const old = await counterOrder(input, "fixture-old-interstate-order");
  assert.equal(old.status, 201, JSON.stringify(old.body));
  const customerInput = { ...input, originState: "KANO", destinationState: "ABUJA",
    serviceType: "STANDARD", pickupMethod: "BRANCH_DROP_OFF", deliveryMethod: "DOOR_DELIVERY",
    prohibitedItemsAcknowledged: true };
  const quote = await request(customer, "/api/logistics/interstate/quote", "POST", customerInput);
  assert.equal(quote.status, 200, JSON.stringify(quote.body));
  const booked = await request(customer, "/api/logistics/interstate/shipments", "POST",
    { ...customerInput, quoteId: quote.body.quoteId });
  assert.equal(booked.status, 201, JSON.stringify(booked.body));
  const changed = await admin(`/routes/${route._id}`, "PATCH",
    { baseFare: 6000, pricingMode: "FIXED", expectedUpdatedAt: route.updatedAt, confirmed: true });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  const fresh = await counterOrder(input, "fixture-new-interstate-order");
  assert.equal(fresh.body.order.total, 6000);
  const priorCustomer = await Shipment.findById(booked.body.shipment._id);
  assert.equal(priorCustomer.quote.total, 5000); assert.equal(priorCustomer.pricingSnapshot.baseFare, 5000);
  const priorCounter = await Shipment.findById(old.body.order.id || old.body.order._id);
  assert.equal(priorCounter.quote.total, 5000); assert.equal(priorCounter.counter.total, 5000);
  const oldTariff = calculateInterstateQuote(priorCustomer.pricingSnapshot,
    { weightKg: 2, serviceType: "STANDARD", pickupMethod: "BRANCH_DROP_OFF", deliveryMethod: "DOOR_DELIVERY" });
  assert.equal(oldTariff.total, 5000);
  const disabled = await admin(`/routes/${route._id}/deactivate`, "PATCH", { confirmed: true });
  assert.equal(disabled.status, 200);
  const blocked = await request(manager, "/api/branches/counter-deliveries/quote", "POST", input);
  assert.equal(blocked.status, 409);
  const customerBlocked = await request(customer, "/api/logistics/interstate/quote", "POST", customerInput);
  assert.equal(customerBlocked.status, 409);
  const deleteBlocked = await admin(`/routes/${route._id}`, "DELETE", { confirmed: true });
  assert.equal(deleteBlocked.status, 409); assert.equal(deleteBlocked.body.code, "ROUTE_IN_USE");
});
test("unused routes delete safely and customer/branch users cannot change tariffs", async () => {
  const created = await admin("/routes", "POST", newRoute({ status: "INACTIVE" }));
  const deleted = await admin(`/routes/${created.body.route._id}`, "DELETE", { confirmed: true });
  assert.equal(deleted.status, 200); assert.equal(await Route.countDocuments(), 0);
  for (const actor of [customer, manager]) {
    const denied = await request(actor, "/api/admin/logistics/interstate/pricing/intra-state", "PATCH",
      { price: 1, expectedVersion: 0, confirmed: true });
    assert.equal(denied.status, 403);
  }
});
test("money input rejects fabricated, zero, negative and excess-precision prices", () => {
  for (const value of [0, -1, "1500", null, NaN, Infinity, 1.001, 10000001]) {
    assert.throws(() => pricing.validPrice(value));
  }
  assert.equal(pricing.validPrice(1500.50), 1500.50);
});