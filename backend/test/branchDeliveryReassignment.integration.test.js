const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const branchRoutes = require("../routes/branch.routes");
const User = require("../models/user.model");
const Delivery = require("../models/delivery.model");
const Branch = require("../models/branch.model");

let mongo; let server; let base; let n = 0;
const models = [User, Delivery, Branch];
const user = async (role, extra = {}) => User.create({
  fullName: `${role} ${++n}`, phone: `0808${String(n).padStart(7, "0")}`,
  email: `${role}-${n}@branch-reassign.test`, password: "Password123!",
  role, status: "ACTIVE", ...extra,
});
const token = (actor) => jwt.sign({ id: String(actor._id), authTokenVersion: Number(actor.authTokenVersion || 0) }, process.env.JWT_SECRET);
const request = async (actor, path, body) => {
  const response = await fetch(`${base}${path}`, { method: "PATCH", headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token(actor)}` }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
};
const delivery = (customer, branch, rider, status = "ASSIGNED") => Delivery.create({
  customerId: customer._id, branchId: branch._id, trackingNumber: `BR-${++n}`,
  pickupAddress: "A", deliveryAddress: "B", senderName: "Customer", senderPhone: "0801",
  receiverName: "Receiver", receiverPhone: "0802", packageName: "Parcel",
  paymentStatus: "PAID", status, assignedRiderId: rider._id, riderName: rider.fullName,
});

test.before(async () => {
  process.env.JWT_SECRET = "branch-reassign-test";
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(mongo.getUri(), { dbName: "branch-reassign" });
  await Promise.all(models.map((model) => model.init()));
  const app = express(); app.use(express.json()); app.use("/api/branches", branchRoutes);
  server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { await new Promise((resolve) => server.close(resolve)); await mongoose.disconnect(); await mongo.stop(); });
test.beforeEach(async () => { n = 0; await Promise.all(models.map((model) => model.collection.deleteMany({}))); });

test("same-branch reassignment is atomic and updates both counters", async () => {
  const creator = await user("HEAD_OFFICE");
  const branch = await Branch.create({ code: "BRA", name: "A", status: "ACTIVE", assignedModules: ["DELIVERY"], createdBy: creator._id });
  const manager = await user("BRANCH_MANAGER", { isStaff: true, branchId: branch._id, branchManagerPermissions: ["branch.delivery.manage"] });
  const customer = await user("CUSTOMER", { branchId: branch._id });
  const old = await user("DELIVERY_RIDER", { branchId: branch._id, riderId: "OLD", riderVerificationStatus: "VERIFIED", availabilityStatus: "ONLINE", totalAssignedDeliveries: 1 });
  const next = await user("DELIVERY_RIDER", { branchId: branch._id, riderId: "NEW", riderVerificationStatus: "VERIFIED", availabilityStatus: "ONLINE", totalAssignedDeliveries: 0 });
  const item = await delivery(customer, branch, old);
  const result = await request(manager, `/api/branches/deliveries/${item._id}/reassign-rider`, { riderId: String(next._id) });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(String((await Delivery.findById(item._id)).assignedRiderId), String(next._id));
  assert.equal((await User.findById(old._id)).totalAssignedDeliveries, 0);
  assert.equal((await User.findById(next._id)).totalAssignedDeliveries, 1);
});

test("cross-branch rider/delivery and non-reassignable lifecycle are rejected", async () => {
  const creator = await user("HEAD_OFFICE");
  const [a, b] = await Promise.all([Branch.create({ code: "RAA", name: "A", status: "ACTIVE", assignedModules: ["DELIVERY"], createdBy: creator._id }), Branch.create({ code: "RBB", name: "B", status: "ACTIVE", assignedModules: ["DELIVERY"], createdBy: creator._id })]);
  const manager = await user("BRANCH_MANAGER", { isStaff: true, branchId: a._id, branchManagerPermissions: ["branch.delivery.manage"] });
  const customer = await user("CUSTOMER", { branchId: a._id });
  const old = await user("DELIVERY_RIDER", { branchId: a._id, riderVerificationStatus: "VERIFIED", availabilityStatus: "ONLINE" });
  const foreign = await user("DELIVERY_RIDER", { branchId: b._id, riderVerificationStatus: "VERIFIED", availabilityStatus: "ONLINE" });
  const item = await delivery(customer, a, old);
  assert.equal((await request(manager, `/api/branches/deliveries/${item._id}/reassign-rider`, { riderId: String(foreign._id) })).status, 409);
  await Delivery.updateOne({ _id: item._id }, { $set: { status: "ACCEPTED" } });
  assert.equal((await request(manager, `/api/branches/deliveries/${item._id}/reassign-rider`, { riderId: String(old._id) })).status, 409);
});