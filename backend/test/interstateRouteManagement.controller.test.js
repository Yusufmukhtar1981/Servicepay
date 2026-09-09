const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const LogisticsRoute = require("../models/logisticsRoute.model");
const Shipment = require("../models/interstateShipment.model");
const controller = require("../controllers/interstateLogistics.controller");

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test("customer route listing requests only active non-archived routes", async () => {
  const originalFind = LogisticsRoute.find;
  let filter;
  LogisticsRoute.find = (value) => {
    filter = value;
    return {
      select() { return this; },
      sort() { return Promise.resolve([]); },
    };
  };
  try {
    const res = response();
    await controller.customerRoutes({}, res);
    assert.deepEqual(filter, { status: "ACTIVE", isArchived: { $ne: true } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.routes, []);
  } finally {
    LogisticsRoute.find = originalFind;
  }
});

test("route lifecycle endpoints activate, deactivate, archive, and restore safely", async () => {
  const originalFindById = LogisticsRoute.findById;
  const originalExists = Shipment.exists;
  const originalStartSession = mongoose.startSession;
  let inTransaction = false;
  const session = {
    startTransaction() { inTransaction = true; },
    async commitTransaction() { inTransaction = false; },
    async abortTransaction() { inTransaction = false; },
    inTransaction() { return inTransaction; },
    async endSession() {},
  };
  const route = {
    _id: "route-1",
    status: "INACTIVE",
    isArchived: false,
    saveCalls: 0,
    async save() { this.saveCalls += 1; return this; },
  };
  mongoose.startSession = async () => session;
  LogisticsRoute.findById = async () => route;
  Shipment.exists = () => ({ session: async () => null });
  const req = {
    params: { id: "route-1" },
    body: { reason: "Route retired safely" },
    user: { _id: "head-office-1" },
  };
  try {
    let res = response();
    await controller.activateRoute(req, res);
    assert.equal(route.status, "ACTIVE");
    res = response();
    await controller.deactivateRoute(req, res);
    assert.equal(route.status, "INACTIVE");
    LogisticsRoute.findById = () => ({ session: async () => route });
    res = response();
    await controller.archiveRoute(req, res);
    assert.equal(route.isArchived, true);
    assert.equal(route.status, "INACTIVE");
    assert.equal(route.archiveReason, "Route retired safely");
    LogisticsRoute.findById = async () => route;
    res = response();
    await controller.restoreRoute(req, res);
    assert.equal(route.isArchived, false);
    assert.equal(route.status, "INACTIVE");
    assert.equal(route.archivedAt, null);
  } finally {
    LogisticsRoute.findById = originalFindById;
    Shipment.exists = originalExists;
    mongoose.startSession = originalStartSession;
  }
});

test("archive refuses routes with active shipments", async () => {
  const originalFindById = LogisticsRoute.findById;
  const originalExists = Shipment.exists;
  const originalStartSession = mongoose.startSession;
  let inTransaction = false;
  const session = {
    startTransaction() { inTransaction = true; },
    async commitTransaction() { inTransaction = false; },
    async abortTransaction() { inTransaction = false; },
    inTransaction() { return inTransaction; },
    async endSession() {},
  };
  const route = { _id: "route-1", status: "ACTIVE", isArchived: false };
  mongoose.startSession = async () => session;
  LogisticsRoute.findById = () => ({ session: async () => route });
  Shipment.exists = () => ({ session: async () => ({ _id: "shipment-1" }) });
  try {
    const res = response();
    await controller.archiveRoute({
      params: { id: "route-1" },
      body: { reason: "Route retired safely" },
      user: { _id: "head-office-1" },
    }, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, "ROUTE_HAS_ACTIVE_SHIPMENTS");
    assert.equal(route.isArchived, false);
  } finally {
    LogisticsRoute.findById = originalFindById;
    Shipment.exists = originalExists;
    mongoose.startSession = originalStartSession;
  }
});

test("direction binding rejects reverse-route pricing and quote hashes bind dimensions", () => {
  const route = { originState: "KANO", destinationState: "ABUJA" };
  assert.doesNotThrow(() => controller._test.assertRouteDirection(route, {
    originState: "KANO",
    destinationState: "ABUJA",
    sender: { state: "KANO" },
    receiver: { state: "ABUJA" },
  }));
  assert.throws(() => controller._test.assertRouteDirection(route, {
    originState: "ABUJA",
    destinationState: "KANO",
  }), /does not match/);

  const base = {
    routeId: "route-1",
    originState: "KANO",
    destinationState: "ABUJA",
    weightKg: 2,
    serviceType: "STANDARD",
    pickupMethod: "BRANCH_DROP_OFF",
    deliveryMethod: "BRANCH_COLLECTION",
  };
  assert.notEqual(
    controller._test.quoteHash({ ...base, dimensions: { length: 90, width: 20, height: 10 } }),
    controller._test.quoteHash({ ...base, dimensions: { length: 120, width: 20, height: 10 } }),
  );
  assert.throws(() => controller._test.canonicalDimensions({
    dimensions: { length: 90, width: 20, height: 10 },
    parcel: { dimensions: { length: 120, width: 20, height: 10 } },
  }), /must match/);
  assert.throws(() => controller._test.canonicalDimensions({
    parcel: { dimensions: { length: 90, diagonal: 120 } },
  }), /only length/);
});