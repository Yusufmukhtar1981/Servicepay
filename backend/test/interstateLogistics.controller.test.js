const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const User = require("../models/user.model");
const Branch = require("../models/branch.model");
const Route = require("../models/logisticsRoute.model");
const Shipment = require("../models/interstateShipment.model");
const Quote = require("../models/logisticsQuote.model");
const History = require("../models/shipmentStatusHistory.model");
const controller = require("../controllers/interstateLogistics.controller");

let mongo;
let customer;
let routes;
const call = async (handler, body) => {
  const result = {};
  await handler(
    { user: customer, body, get: () => "" },
    { status: (status) => { result.status = status; return { json: (body) => { result.body = body; return result; } }; },
      json: (body) => { result.status = 200; result.body = body; return result; } },
  );
  return result;
};
const payload = (route, extra = {}) => ({
  routeId: route._id,
  originState: route.originState,
  destinationState: route.destinationState,
  sender: { name: "A Sender", phone: "08030000000", state: route.originState, lga: "Origin LGA", address: "1 Origin Road" },
  receiver: { name: "A Receiver", phone: "08040000000", state: route.destinationState, lga: "Destination LGA", address: "2 Destination Road" },
  parcel: { category: "DOCUMENTS", description: "Documents", quantity: 1, declaredValue: 1000, weightKg: 1 },
  weightKg: 1, declaredValue: 1000, pickupMethod: "RIDER_PICKUP", deliveryMethod: "DOOR_DELIVERY",
  serviceType: "STANDARD", prohibitedItemsAcknowledged: true, ...extra,
});

test.before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(mongo.getUri(), { dbName: "interstate-logistics-tests" });
  customer = await User.create({ fullName: "Logistics Customer", phone: "08050000000", email: "logistics@example.test", password: "Password123!", role: "CUSTOMER", status: "ACTIVE" });
  const branch = async (code, state) => Branch.create({ code, name: code, state, status: "ACTIVE", createdBy: customer._id });
  const kanoOne = await branch("KN1", "KANO");
  const kanoTwo = await branch("KN2", "KANO");
  const abuja = await branch("AB1", "ABUJA");
  const lagos = await branch("LG1", "LAGOS");
  const makeRoute = (name, origin, destination, originState, destinationState) => Route.create({
    name, originBranchId: origin._id, destinationBranchId: destination._id, originState, destinationState,
    baseFare: 1000, minimumWeightKg: 1, maximumWeightKg: 10, pricePerAdditionalKg: 100,
    standardDeliveryTime: "2 days", createdBy: customer._id,
  });
  routes = {
    kanoAbuja: await makeRoute("Kano Abuja", kanoOne, abuja, "KANO", "ABUJA"),
    kanoLagos: await makeRoute("Kano Lagos", kanoOne, lagos, "KANO", "LAGOS"),
    abujaKano: await makeRoute("Abuja Kano", abuja, kanoOne, "ABUJA", "KANO"),
    kanoKano: await makeRoute("Kano branches", kanoOne, kanoTwo, "KANO", "KANO"),
  };
});
test.after(async () => { await mongoose.disconnect(); await mongo.stop(); });

test("quotes configured directed routes, including distinct same-state branches", async () => {
  for (const route of Object.values(routes)) {
    const result = await call(controller.quote, payload(route));
    assert.equal(result.status, 200);
    assert.equal(result.body.success, true);
    assert.ok(result.body.quote.quoteId);
  }
});

test("returns stable route and address reason codes", async () => {
  let result = await call(controller.quote, payload(routes.kanoAbuja, { sender: { name: "A", phone: "0803", state: "KANO", lga: "", address: "" } }));
  assert.equal(result.status, 400);
  assert.equal(result.body.code, "ADDRESS_LGA_REQUIRED");
  result = await call(controller.quote, payload(routes.kanoAbuja, { destinationState: "RIVERS" }));
  assert.equal(result.status, 422);
  assert.equal(result.body.code, "ROUTE_UNSUPPORTED");
  result = await call(controller.quote, payload(routes.kanoAbuja, { destinationState: "LAGOS" }));
  assert.equal(result.status, 400);
  assert.equal(result.body.code, "ROUTE_STATE_MISMATCH");
  result = await call(controller.quote, payload(routes.kanoAbuja, { routeId: new mongoose.Types.ObjectId() }));
  assert.equal(result.status, 404);
  assert.equal(result.body.code, "ROUTE_NOT_FOUND");
  await Route.updateOne({ _id: routes.kanoLagos._id }, { status: "PAUSED" });
  result = await call(controller.quote, payload(routes.kanoLagos));
  assert.equal(result.status, 409);
  assert.equal(result.body.code, "ROUTE_INACTIVE");
  await Route.updateOne({ _id: routes.kanoLagos._id }, { status: "ACTIVE" });
});

test("creates an unpaid shipment and records customer history without wallet payment", async () => {
  const quoted = await call(controller.quote, payload(routes.kanoAbuja));
  const created = await call(controller.createShipment, payload(routes.kanoAbuja, { quoteId: quoted.body.quote.quoteId }));
  assert.equal(created.status, 201);
  assert.equal(created.body.shipment.paymentStatus, "UNPAID");
  assert.equal(created.body.shipment.status, "AWAITING_PAYMENT");
  assert.equal(await Shipment.countDocuments({ customerId: customer._id }), 1);
  assert.equal(await History.countDocuments({ shipmentId: created.body.shipment._id, status: "AWAITING_PAYMENT" }), 1);
  assert.ok(await Quote.countDocuments({ customerId: customer._id }));
});