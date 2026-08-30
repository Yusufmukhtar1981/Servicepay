const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const adminRoutes = require("../routes/admin.routes");
const riderRoutes = require("../routes/rider.routes");
const User = require("../models/user.model");
const Delivery = require("../models/delivery.model");
const DeliveryAlertDispatch = require("../models/deliveryAlertDispatch.model");

let mongo;
let server;
let baseUrl;
let sequence = 0;

const models = [User, Delivery, DeliveryAlertDispatch];

const createUser = async (role, extra = {}) => {
  sequence += 1;
  return User.create({
    fullName: `${role} ${sequence}`,
    phone: `081700${String(sequence).padStart(5, "0")}`,
    email: `${role.toLowerCase()}-${sequence}@assignment.test`,
    password: "Password123!",
    role,
    status: "ACTIVE",
    ...extra,
  });
};

const createDelivery = async (customer) => {
  sequence += 1;
  return Delivery.create({
    customerId: customer._id,
    trackingNumber: `SP-DELIVERY-${sequence}`,
    pickupAddress: "12 Marina Road, Lagos",
    deliveryAddress: "8 Allen Avenue, Lagos",
    senderName: customer.fullName,
    senderPhone: customer.phone,
    receiverName: "Delivery Receiver",
    receiverPhone: "08030000001",
    packageName: "Documents",
    status: "PENDING",
    paymentStatus: "PAID",
  });
};

const tokenFor = (actor) =>
  jwt.sign(
    {
      id: String(actor._id),
      authTokenVersion: Number(actor.authTokenVersion || 0),
    },
    process.env.JWT_SECRET
  );

const api = async ({ actor, path, method = "GET", body }) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${tokenFor(actor)}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json(),
  };
};

test.before(async () => {
  process.env.JWT_SECRET = "admin-delivery-assignment-test-secret";
  mongo = await MongoMemoryReplSet.create({
    replSet: {
      count: 1,
      storageEngine: "wiredTiger",
    },
  });
  await mongoose.connect(mongo.getUri(), {
    dbName: "admin-delivery-assignment-tests",
  });
  await Promise.all(models.map((model) => model.init()));

  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminRoutes);
  app.use("/api/rider", riderRoutes);
  server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  await mongoose.disconnect();
  await mongo.stop();
});

test.beforeEach(async () => {
  sequence = 0;
  await Promise.all(models.map((model) => model.collection.deleteMany({})));
});

test("available-riders returns only verified online riders and a stable empty list", async () => {
  const headOffice = await createUser("HEAD_OFFICE");
  const customer = await createUser("CUSTOMER");
  const delivery = await createDelivery(customer);
  const available = await createUser("DELIVERY_RIDER", {
    riderId: "SP-RIDER-000001",
    riderVerificationStatus: "VERIFIED",
    availabilityStatus: "ONLINE",
  });
  await createUser("DELIVERY_RIDER", {
    riderId: "SP-RIDER-000002",
    riderVerificationStatus: "VERIFIED",
    availabilityStatus: "OFFLINE",
  });
  await createUser("DELIVERY_RIDER", {
    riderId: "SP-RIDER-000003",
    riderVerificationStatus: "PENDING",
    availabilityStatus: "ONLINE",
  });

  const result = await api({
    actor: headOffice,
    path: `/api/admin/deliveries/${delivery._id}/available-riders`,
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.success, true);
  assert.equal(result.body.data.count, 1);
  assert.equal(result.body.riders.length, 1);
  assert.equal(String(result.body.riders[0]._id), String(available._id));

  await User.updateOne(
    { _id: available._id },
    { $set: { availabilityStatus: "OFFLINE" } }
  );
  const empty = await api({
    actor: headOffice,
    path: `/api/admin/deliveries/${delivery._id}/available-riders`,
  });
  assert.equal(empty.status, 200, JSON.stringify(empty.body));
  assert.deepEqual(empty.body.riders, []);
  assert.equal(empty.body.data.count, 0);
});

test("legacy admin authorization can load available riders", async () => {
  const customer = await createUser("CUSTOMER");
  const delivery = await createDelivery(customer);
  await createUser("DELIVERY_RIDER", {
    riderId: "SP-RIDER-000004",
    riderVerificationStatus: "VERIFIED",
    availabilityStatus: "ONLINE",
  });
  const inserted = await User.collection.insertOne({
    fullName: "Legacy Admin",
    email: "legacy-admin@assignment.test",
    phone: "08170099999",
    password: "not-used-by-token-auth",
    role: "ADMIN",
    status: "ACTIVE",
    authTokenVersion: 0,
  });
  const legacyAdmin = await User.findById(inserted.insertedId);

  const result = await api({
    actor: legacyAdmin,
    path: `/api/admin/deliveries/${delivery._id}/available-riders`,
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.riders.length, 1);
});

test("assignment persists once, appears on the rider dashboard, and dispatches an alert", async () => {
  const headOffice = await createUser("HEAD_OFFICE");
  const customer = await createUser("CUSTOMER");
  const delivery = await createDelivery(customer);
  const rider = await createUser("DELIVERY_RIDER", {
    riderId: "SP-RIDER-000005",
    riderVerificationStatus: "VERIFIED",
    availabilityStatus: "ONLINE",
  });

  const assigned = await api({
    actor: headOffice,
    method: "PATCH",
    path: `/api/admin/deliveries/${delivery._id}/assign-rider`,
    body: { riderId: String(rider._id) },
  });
  assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
  assert.equal(assigned.body.delivery.status, "ASSIGNED");
  assert.equal(
    String(assigned.body.delivery.assignedRiderId._id),
    String(rider._id)
  );

  const saved = await Delivery.findById(delivery._id).lean();
  assert.equal(saved.status, "ASSIGNED");
  assert.equal(String(saved.assignedRiderId), String(rider._id));
  assert.ok(saved.assignedAt);
  assert.ok(saved.assignmentEventId);
  assert.equal(String(saved.assignedBy), String(headOffice._id));

  const updatedRider = await User.findById(rider._id).lean();
  assert.equal(updatedRider.totalAssignedDeliveries, 1);

  const riderDashboard = await api({
    actor: rider,
    path: "/api/rider/deliveries",
  });
  assert.equal(riderDashboard.status, 200, JSON.stringify(riderDashboard.body));
  assert.equal(riderDashboard.body.deliveries.length, 1);
  assert.equal(
    String(riderDashboard.body.deliveries[0]._id),
    String(delivery._id)
  );

  const dispatch = await DeliveryAlertDispatch.findOne({
    assignmentEventId: saved.assignmentEventId,
    type: "DELIVERY_ASSIGNED",
    riderId: rider._id,
  }).lean();
  assert.ok(dispatch);
  assert.equal(dispatch.status, "SKIPPED");

  const duplicate = await api({
    actor: headOffice,
    method: "PATCH",
    path: `/api/admin/deliveries/${delivery._id}/assign-rider`,
    body: { riderId: String(rider._id) },
  });
  assert.equal(duplicate.status, 409, JSON.stringify(duplicate.body));
  assert.match(duplicate.body.message, /already has a rider assigned/i);
  assert.equal(
    (await User.findById(rider._id).lean()).totalAssignedDeliveries,
    1
  );
  assert.equal(
    await DeliveryAlertDispatch.countDocuments({
      assignmentEventId: saved.assignmentEventId,
      type: "DELIVERY_ASSIGNED",
    }),
    1
  );
});