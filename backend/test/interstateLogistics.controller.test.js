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
const Transaction = require("../models/transaction.model");
const { setTransactionPin } = require("../services/transactionPin.service");
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

const createUnpaidShipment = async () => {
  const quoted = await call(controller.quote, payload(routes.kanoAbuja));
  assert.equal(quoted.status, 200);
  const created = await call(
    controller.createShipment,
    payload(routes.kanoAbuja, { quoteId: quoted.body.quote.quoteId }),
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return Shipment.findById(created.body.shipment._id);
};
const payableShipment = async (amount) => {
  const shipment = await createUnpaidShipment();
  await Shipment.updateOne({ _id: shipment._id }, { $set: { "quote.total": amount } });
  return Shipment.findById(shipment._id);
};
const callPayment = async (handler, shipment, key) => {
  const result = {};
  await handler(
    {
      user: customer, params: { id: shipment._id },
      body: { transactionPin: "2468", idempotencyKey: key },
      get: (header) => header === "Idempotency-Key" ? key : "",
    },
    {
      status(status) {
        result.status = status;
        return { json(body) { result.body = body; return result; } };
      },
      json(body) {
        result.status = 200;
        result.body = body;
        return result;
      },
    },
  );
  return result;
};
const setWallet = (balance, held) => User.updateOne(
  { _id: customer._id },
  { $set: { walletBalance: balance, walletHeldBalance: held } },
);
const wallet = () => User.findById(customer._id).select("walletBalance walletHeldBalance");

test.before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(mongo.getUri(), { dbName: "interstate-logistics-tests" });
  customer = await User.create({ fullName: "Logistics Customer", phone: "08050000000", email: "logistics@example.test", password: "Password123!", role: "CUSTOMER", status: "ACTIVE" });
  await setTransactionPin(customer._id, "2468");
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
  await Promise.all([User.init(), Shipment.init(), Transaction.init(), History.init()]);
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

test("three additional unpaid shipments have no payment key and coexist under the partial index", async () => {
  const before = await Shipment.countDocuments({ customerId: customer._id });
  for (let i = 0; i < 3; i += 1) {
    const shipment = await createUnpaidShipment();
    assert.equal(shipment.paymentStatus, "UNPAID");
    assert.equal(shipment.toObject().paymentIdempotencyKey, undefined);
  }
  assert.equal(await Shipment.countDocuments({ customerId: customer._id }), before + 3);
  const index = (await Shipment.collection.indexes()).find(
    (entry) => entry.key.paymentIdempotencyKey === 1,
  );
  assert.equal(index.unique, true);
  assert.deepEqual(index.partialFilterExpression, {
    paymentIdempotencyKey: { $type: "string" },
  });
});

test("distinct real payment keys work; a duplicate key on another shipment is rejected", async () => {
  const first = await payableShipment(1000);
  const second = await payableShipment(1000);
  const third = await createUnpaidShipment();
  await setWallet(10000, 0);
  assert.equal((await callPayment(controller.pay, first, "paid-key-first")).status, 200);
  assert.equal((await callPayment(controller.pay, second, "paid-key-second")).status, 200);
  assert.equal((await Shipment.findById(first._id)).paymentStatus, "PAID");
  assert.equal((await Shipment.findById(second._id)).paymentStatus, "PAID");
  await assert.rejects(
    Shipment.updateOne({ _id: third._id }, { $set: { paymentIdempotencyKey: "paid-key-first" } }),
    (error) => error.code === 11000,
  );
  assert.equal((await Shipment.findById(third._id)).paymentIdempotencyKey, undefined);
  assert.equal((await wallet()).walletBalance, 8000);
});

test("initial payment spends exactly available funds and preserves the hold", async () => {
  const shipment = await payableShipment(6000);
  await setWallet(10000, 4000);
  const result = await callPayment(controller.pay, shipment, `pay-${shipment._id}`);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const current = await wallet();
  assert.equal(current.walletBalance, 4000);
  assert.equal(current.walletHeldBalance, 4000);
  assert.equal((await Shipment.findById(shipment._id)).paymentStatus, "PAID");
});

test("initial payment rejects a debit above available funds without changing the wallet", async () => {
  const shipment = await payableShipment(6001);
  await setWallet(10000, 4000);
  const before = await Transaction.countDocuments({ serviceType: "INTERSTATE_LOGISTICS" });
  const result = await callPayment(controller.pay, shipment, `pay-${shipment._id}`);
  assert.equal(result.status, 400, JSON.stringify(result.body));
  const current = await wallet();
  assert.equal(current.walletBalance, 10000);
  assert.equal(current.walletHeldBalance, 4000);
  assert.equal((await Shipment.findById(shipment._id)).paymentStatus, "UNPAID");
  assert.equal(await Transaction.countDocuments({ serviceType: "INTERSTATE_LOGISTICS" }), before);
});

test("a fully held wallet is rejected without a debit", async () => {
  const shipment = await payableShipment(1);
  await setWallet(10000, 10000);
  const result = await callPayment(controller.pay, shipment, `pay-${shipment._id}`);
  assert.equal(result.status, 400);
  assert.equal((await wallet()).walletBalance, 10000);
  assert.equal((await wallet()).walletHeldBalance, 10000);
});

test("a wallet with no hold permits a full debit and one idempotent retry", async () => {
  const shipment = await payableShipment(10000);
  await setWallet(10000, 0);
  const key = `pay-${shipment._id}`;
  const first = await callPayment(controller.pay, shipment, key);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const retry = await callPayment(controller.pay, shipment, key);
  assert.equal(retry.status, 200, JSON.stringify(retry.body));
  assert.equal(retry.body.idempotent, true);
  assert.equal((await wallet()).walletBalance, 0);
  assert.equal(await Transaction.countDocuments({ "providerResponse.shipmentId": shipment._id }), 1);
});

test("supplemental payment preserves holds on rejection and retry", async () => {
  const shipment = await payableShipment(1000);
  await Shipment.updateOne(
    { _id: shipment._id },
    {
      $set: { status: "ADDITIONAL_PAYMENT_REQUIRED", paymentStatus: "PAID" },
      $push: { priceAdjustments: { difference: 6001 } },
    },
  );
  await setWallet(10000, 4000);
  const key = `supplement-${shipment._id}`;
  const rejected = await callPayment(controller.paySupplement, shipment, key);
  assert.equal(rejected.status, 400, JSON.stringify(rejected.body));
  assert.equal((await wallet()).walletBalance, 10000);
  assert.equal((await wallet()).walletHeldBalance, 4000);

  await Shipment.updateOne(
    { _id: shipment._id },
    { $set: { "priceAdjustments.0.difference": 6000 } },
  );
  const paid = await callPayment(controller.paySupplement, shipment, key);
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  const duplicate = await callPayment(controller.paySupplement, shipment, key);
  assert.equal(duplicate.status, 200, JSON.stringify(duplicate.body));
  assert.equal(duplicate.body.idempotent, true);
  assert.equal((await wallet()).walletBalance, 4000);
  assert.equal((await wallet()).walletHeldBalance, 4000);
  assert.equal(await Transaction.countDocuments({
    "providerResponse.shipmentId": shipment._id,
    "providerResponse.type": "WEIGHT_ADJUSTMENT",
  }), 1);
});