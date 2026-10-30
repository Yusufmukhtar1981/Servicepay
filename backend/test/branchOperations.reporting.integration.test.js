const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const Branch = require("../models/branch.model");
const Delivery = require("../models/delivery.model");
const Shipment = require("../models/interstateShipment.model");
const User = require("../models/user.model");
const Audit = require("../models/branchAuditLog.model");
const Request = require("../models/branchOperationalRequest.model");
const c = require("../controllers/branch.controller");
const { branchDeliveryOperations, lifecycleCounts } = require("../services/branchDeliveryReporting.service");
let mongo, a, b;
const head = new mongoose.Types.ObjectId(), rider = new mongoose.Types.ObjectId();
const response = () => ({
  statusCode: 200, status(n) { this.statusCode = n; return this; },
  json(body) { this.body = body; return this; },
});
const req = (body = {}, params = {}) => ({
  body, params, query: {}, user: { _id: head, role: "HEAD_OFFICE" },
  staffAccess: { isHeadOffice: true }, branchScope: {},
});
test.before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  const uri = mongo.getUri();
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:/);
  await mongoose.connect(uri, { dbName: "disposable-branch-reporting" });
  await Branch.init();
});
test.beforeEach(async () => {
  await Promise.all([Branch.deleteMany({}), Delivery.deleteMany({}), Shipment.deleteMany({}), User.deleteMany({}), Audit.deleteMany({}), Request.deleteMany({})]);
  [a, b] = await Branch.create([
    { code: "FIXTURE_A", name: "Fixture A", createdBy: head },
    { code: "FIXTURE_B", name: "Fixture B", createdBy: head },
  ]);
});
test.after(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });
test("scoped workload combines both interstate hubs without double-counting fees or transactions", async () => {
  const today = new Date("2026-10-29T23:00:00Z");
  await Delivery.collection.insertMany([
    { branchId: a._id, status: "DELIVERED", paymentStatus: "PAID", deliveryFee: 2000, riderCommissionAmount: 800, riderCommissionCredited: true, riderCommissionStatus: "CREDITED", assignedRiderId: rider, createdAt: new Date("2026-10-29T22:59:59Z") },
    { branchId: a._id, status: "PENDING", paymentStatus: "UNPAID", deliveryFee: 3100, createdAt: today },
    { branchId: a._id, status: "CANCELLED", paymentStatus: "REFUNDED", deliveryFee: 2000, createdAt: today },
    { branchId: b._id, status: "DELIVERED", paymentStatus: "PAID", deliveryFee: 99999, createdAt: today },
    { status: "DELIVERED", paymentStatus: "PAID", deliveryFee: 55555, createdAt: today },
  ].map((row, index) => ({ ...row, trackingNumber: `LOCAL-FIXTURE-${index}`, idempotencyKey: `LOCAL-KEY-${index}` })));
  const other = new mongoose.Types.ObjectId();
  await Shipment.collection.insertMany([
    { originBranchId: a._id, destinationBranchId: b._id, status: "IN_TRANSIT", paymentStatus: "PAID", quote: { total: 5000 }, createdAt: today },
    { originBranchId: b._id, destinationBranchId: a._id, status: "READY_FOR_COLLECTION", paymentStatus: "UNPAID", quote: { total: 4000 }, createdAt: today },
    { originBranchId: b._id, destinationBranchId: other, status: "DELIVERED", paymentStatus: "PAID", quote: { total: 88888 }, createdAt: today },
  ].map((row, index) => ({ ...row, trackingNumber: `INTERSTATE-FIXTURE-${index}` })));
  await User.collection.insertMany([
    { branchId: a._id, role: "DELIVERY_RIDER", status: "ACTIVE" },
    { branchId: b._id, role: "DELIVERY_RIDER", status: "ACTIVE" },
    { branchId: a._id, role: "DELIVERY_RIDER", status: "SUSPENDED" },
  ].map((row, index) => ({ ...row, phone: `0809000000${index}`, email: `rider-${index}@example.test` })));
  const report = await branchDeliveryOperations({ branchId: a._id, now: new Date("2026-10-30T12:00:00Z") });
  assert.equal(report.total, 5);
  assert.equal(report.today, 4);
  assert.equal(report.localOrders, 3);
  assert.equal(report.interstateOrders, 2);
  assert.equal(report.activeRiders, 1);
  assert.equal(report.inTransit, 1);
  assert.equal(report.inProgress, 2);
  assert.equal(report.delivered, 1);
  assert.equal(report.cancelled, 1);
  assert.equal(report.financial.grossOrderValue, 12100);
  assert.equal(report.financial.recordedPaidValue, 7000);
  assert.equal(report.financial.unpaidValue, 3100);
  assert.equal(report.financial.refundedValue, 2000);
  assert.equal(report.financial.recordedRiderCommissions, 800);
  assert.equal(report.financial.reconciledProfit, null);
  assert.equal(report.financial.operationalExpenses, null);
  const filtered = await branchDeliveryOperations({ branchId: a._id, staffId: rider });
  assert.equal(filtered.total, 1);
  const day = await branchDeliveryOperations({ branchId: a._id, dateRange: { $gte: today, $lt: new Date(+today + 86400000) } });
  assert.equal(day.total, 4);
});
test("compatible lifecycle mappings retain unknown records rather than losing them", () => {
  const counts = lifecycleCounts({ PENDING: 1, CREATED: 2, CONFIRMED: 3, READY_FOR_COLLECTION: 4, FAILED_DELIVERY: 5, LEGACY_UNKNOWN: 6 });
  assert.equal(counts.CREATED, 3);
  assert.equal(counts.CONFIRMED, 3);
  assert.equal(counts.ARRIVED_AT_DESTINATION_BRANCH, 4);
  assert.equal(counts.FAILED, 5);
  assert.equal(counts.UNCLASSIFIED, 6);
});
test("branch code and city editing is unique, trimmed and audited with snapshots", async () => {
  const r = response();
  await c.update(req({ code: "fixture_edited", city: " Kano ", name: "Updated branch" }, { branchId: a._id }), r);
  assert.equal(r.statusCode, 200);
  const saved = await Branch.findById(a._id);
  assert.equal(saved.code, "FIXTURE_EDITED");
  assert.equal(saved.city, "Kano");
  const event = await Audit.findOne({ branchId: a._id, action: "BRANCH_UPDATED" });
  assert.equal(event.before.name, "Fixture A");
  assert.equal(event.after.name, "Updated branch");
  const duplicate = response();
  await c.update(req({ code: b.code }, { branchId: a._id }), duplicate);
  assert.equal(duplicate.statusCode, 409);
  assert.equal((await Branch.findById(a._id)).code, "FIXTURE_EDITED");
});
test("failed branch update or status audit rolls back every database change", async () => {
  const before = await Branch.findById(a._id).lean();
  const create = Audit.create;
  try {
    Audit.create = async () => { throw Error("Disposable audit failure"); };
    for (const [handler, body] of [[c.update, { city: "Must not persist" }], [c.activate, { status: "INACTIVE" }]]) {
      const r = response();
      await handler(req(body, { branchId: a._id }), r);
      assert.equal(r.statusCode, 500);
      assert.deepEqual(await Branch.findById(a._id).lean(), before);
    }
  } finally { Audit.create = create; }
});
test("invalid status never silently deactivates a branch", async () => {
  const r = response();
  await c.activate(req({ status: "ACTVE" }, { branchId: a._id }), r);
  assert.equal(r.statusCode, 400);
  assert.equal((await Branch.findById(a._id)).status, "DRAFT");
});
test("delivery-only access cannot expose new financial metrics or cross another branch", async () => {
  const actor = req();
  actor.user.role = "BRANCH_MANAGER";
  actor.staffAccess = { isHeadOffice: false, scope: { branchId: a._id }, permissions: ["branch.dashboard.view", "branch.delivery.view"] };
  actor.branchScope = { _id: a._id, assignedModules: ["DELIVERY"] };
  let r = response();
  await c.dashboard(actor, r);
  assert.equal(r.statusCode, 200);
  const dashboard = r.body.dashboard || r.body;
  assert.ok(dashboard.metrics.deliveries.operations);
  assert.equal(dashboard.metrics.deliveries.operations.financial, undefined);
  actor.query.branchId = String(b._id);
  r = response();
  await c.dashboard(actor, r);
  assert.equal(r.statusCode, 403);
});
test("operational tasks assign only same-branch active staff, with idempotent audit and terminal-state guards", async () => {
  const staffId = new mongoose.Types.ObjectId(), otherId = new mongoose.Types.ObjectId();
  await User.collection.insertMany([
    { _id: staffId, phone: "08090000901", email: "local-staff@example.test", branchId: a._id, role: "STAFF", isStaff: true, status: "ACTIVE", authTokenVersion: 4 },
    { _id: otherId, phone: "08090000902", email: "other-staff@example.test", branchId: b._id, role: "STAFF", isStaff: true, status: "ACTIVE" },
  ]);
  const beforeStaff = await User.findById(staffId).select("+authTokenVersion").lean();
  const task = await Request.create({ branchId: a._id, type: "GENERAL", title: "Disposable sorting task", requestedBy: head });
  const update = async (body, options = {}) => {
    const r = response(), actor = req({ reason: "Controlled operational fixture", ...body }, { requestId: task._id });
    if (options.manager) {
      actor.user.role = "BRANCH_MANAGER";
      actor.staffAccess = { isHeadOffice: false, scope: { branchId: options.branch || a._id }, permissions: ["branch.staff.manage"] };
    }
    await c.updateOperational(actor, r);
    return r;
  };
  assert.equal((await update({ assignedStaffId: otherId })).statusCode, 400);
  assert.equal((await update({ assignedStaffId: staffId }, { manager: true, branch: b._id })).statusCode, 404);
  assert.equal((await update({ assignedStaffId: staffId }, { manager: true })).statusCode, 200);
  const count = await Audit.countDocuments({ action: "BRANCH_OPERATIONAL_REQUEST_UPDATED" });
  assert.equal(count, 1);
  assert.equal((await update({ assignedStaffId: staffId }, { manager: true })).statusCode, 200);
  assert.equal(await Audit.countDocuments({ action: "BRANCH_OPERATIONAL_REQUEST_UPDATED" }), count);
  assert.equal((await update({ status: "IN_PROGRESS" })).statusCode, 200);
  assert.equal((await update({ status: "RESOLVED" })).statusCode, 200);
  assert.ok((await Request.findById(task._id)).resolvedAt);
  assert.equal((await update({ status: "OPEN" })).statusCode, 409);
  assert.equal((await update({ assignedStaffId: null })).statusCode, 409);
  assert.deepEqual(await User.findById(staffId).select("+authTokenVersion").lean(), beforeStaff);
});
test("operational request creation and its audit are atomic, and do not copy arbitrary metadata into audit", async () => {
  const actor = req({ branchId: a._id, type: "GENERAL", title: "Disposable request", metadata: { privateFixture: "not an audit field" } });
  actor.method = "POST";
  const create = Audit.create;
  try {
    Audit.create = async () => { throw Error("Disposable create audit failure"); };
    const failed = response();
    await c.operational(actor, failed);
    assert.equal(failed.statusCode, 500);
    assert.equal(await Request.countDocuments({}), 0);
  } finally { Audit.create = create; }
  const success = response();
  await c.operational(actor, success);
  assert.equal(success.statusCode, 201);
  assert.equal(await Request.countDocuments({}), 1);
  const audit = await Audit.findOne({ action: "BRANCH_OPERATIONAL_REQUEST_CREATED" }).lean();
  assert.deepEqual(audit.after, { type: "GENERAL", status: "OPEN" });
});
test("ordinary staff see only own/assigned requests and can progress only an assigned task without reassigning", async () => {
  const staffId = new mongoose.Types.ObjectId(), colleague = new mongoose.Types.ObjectId();
  await User.collection.insertOne({ _id: staffId, branchId: a._id, role: "STAFF", isStaff: true, status: "ACTIVE", phone: "08090000801", email: "assigned-worker@example.test" });
  const tasks = await Request.create([
    { branchId: a._id, type: "GENERAL", title: "Assigned task", requestedBy: head, assignedStaffId: staffId },
    { branchId: a._id, type: "GENERAL", title: "Own request", requestedBy: staffId },
    { branchId: a._id, type: "GENERAL", title: "Private colleague request", requestedBy: colleague },
    { branchId: b._id, type: "GENERAL", title: "Other branch", requestedBy: staffId },
  ]);
  const actor = req();
  actor.user = { _id: staffId, role: "STAFF" };
  actor.staffAccess = { isHeadOffice: false, scope: { branchId: a._id }, permissions: ["branch.dashboard.view"] };
  actor.method = "GET";
  delete actor.body; // Express 5 leaves a body-less GET undefined.
  let r = response();
  await c.operational(actor, r);
  assert.equal(r.body.requests.length, 2);
  actor.params.requestId = tasks[0]._id;
  actor.body = { status: "IN_PROGRESS", reason: "Started assigned work" };
  r = response(); await c.updateOperational(actor, r);
  assert.equal(r.statusCode, 200);
  actor.body = { status: "RESOLVED", reason: "Completed assigned work" };
  r = response(); await c.updateOperational(actor, r);
  assert.equal(r.statusCode, 200);
  actor.body = { assignedStaffId: colleague, reason: "Forbidden reassignment" };
  r = response(); await c.updateOperational(actor, r);
  assert.equal(r.statusCode, 403);
  actor.params.requestId = tasks[2]._id;
  actor.body = { status: "RESOLVED", reason: "Forbidden colleague update" };
  r = response(); await c.updateOperational(actor, r);
  assert.equal(r.statusCode, 404);
});
