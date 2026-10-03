const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const Shipment = require("../models/interstateShipment.model");
const User = require("../models/user.model");
const Branch = require("../models/branch.model");
const Route = require("../models/logisticsRoute.model");
const History = require("../models/shipmentStatusHistory.model");
const Delivery = require("../models/delivery.model");
const tracking = require("../services/interstateTracking.service");
let mongo, server, base, n = 0;
const user = (role, extra = {}) => User.create({ fullName: `Workflow ${++n}`, phone: `08180${String(n).padStart(6, "0")}`, email: `workflow-${n}@example.test`, password: "TestPassword123!", role, status: "ACTIVE", ...extra });
const api = async (actor, path, method = "GET", body) => {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(actor ? { Authorization: `Bearer ${jwt.sign({ id: String(actor._id), authTokenVersion: actor.authTokenVersion || 0 }, process.env.JWT_SECRET)}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await r.text();
  return { status: r.status, body: r.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text };
};
test.before(async () => {
  delete process.env.RESEND_API_KEY;
  process.env.JWT_SECRET = "isolated-interstate-workflow-test";
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(mongo.getUri(), { dbName: "interstate-office-isolated" });
  const app = express();
  app.use(express.json());
  app.use("/api/admin", require("../routes/admin.routes"));
  app.use("/api/admin/logistics/interstate", require("../routes/adminInterstateLogistics.routes"));
  app.use("/api/branches/logistics/interstate", require("../routes/branchInterstateLogistics.routes"));
  app.use("/api/rider/logistics/interstate", require("../routes/riderInterstateLogistics.routes"));
  app.use("/api/logistics/interstate", require("../routes/interstateLogistics.routes"));
  server = await new Promise(resolve => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  base = `http://127.0.0.1:${server.address().port}`;
  await Promise.all([Shipment, User, Branch, Route, History, Delivery, require("../models/notification.model"), require("../models/adminAuditLog.model"), require("../models/branchAuditLog.model")].map(model => model.init()));
});
test.after(async () => { await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); await mongo.stop(); });
const fixture = async () => {
  const admin = await user("HEAD_OFFICE");
  const a = await Branch.create({ code: `ORIGIN${n}`, name: "Origin Office", status: "ACTIVE", createdBy: admin._id });
  const b = await Branch.create({ code: `DEST${n}`, name: "Destination Office", status: "ACTIVE", createdBy: admin._id });
  const route = await Route.create({ name: "Approved route", originState: "LAGOS", destinationState: "ABUJA", originBranchId: a._id, destinationBranchId: b._id, status: "ACTIVE", baseFare: 2000, minimumWeightKg: 1, maximumWeightKg: 30, pricePerAdditionalKg: 100, standardDeliveryTime: "2 days", createdBy: admin._id });
  const customer = await user("CUSTOMER");
  const riderA = await user("DELIVERY_RIDER", { branchId: a._id, riderVerificationStatus: "VERIFIED", availabilityStatus: "ONLINE" });
  const riderB = await user("DELIVERY_RIDER", { branchId: a._id, riderVerificationStatus: "VERIFIED", availabilityStatus: "OFFLINE" });
  const body = { routeId: String(route._id), customerId: String(customer._id), sender: { name: customer.fullName, phone: customer.phone, email: customer.email, state: "LAGOS", lga: "Lagos Island", address: "Origin Office" }, receiver: { name: "Test Receiver", phone: "08030000001", state: "ABUJA", lga: "Municipal", address: "Receiver Address" }, parcel: { category: "DOCUMENTS", description: "Signed documents", quantity: 1, weightKg: 1, declaredValue: 100 }, deliveryMethod: "DOOR_DELIVERY", serviceType: "STANDARD", prohibitedItemsAcknowledged: true, idempotencyKey: `office-test-${n}` };
  return { admin, a, b, route, customer, riderA, riderB, body };
};
const adminPath = "/api/admin/logistics/interstate";
test("Head Office lists and assigns legitimate branchless riders in both legs; status options, history, notification and tracking stay aligned", async () => {
  const f = await fixture();
  await User.updateMany({ _id: { $in: [f.riderA._id, f.riderB._id] } }, { $unset: { branchId: 1 } });
  const created = await api(f.admin, `${adminPath}/shipments`, "POST", f.body);
  assert.equal(created.status, 201);
  const id = created.body.shipment._id;
  const trackingNumber = created.body.shipment.trackingNumber;
  const update = async status => {
    const response = await api(f.admin, `${adminPath}/shipments/${id}/status`, "PATCH", { status });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.shipment.trackingNumber, trackingNumber);
    const tracked = await api(null, `/api/logistics/interstate/track/${trackingNumber}`);
    assert.equal(tracked.body.shipment.status, status);
  };
  for (const leg of ["ORIGIN", "DESTINATION"]) {
    const list = await api(f.admin, `${adminPath}/shipments/${id}/riders?leg=${leg}`);
    assert.equal(list.status, 200);
    assert.ok(list.body.riders.some(r => r._id === String(f.riderA._id)));
    assert.ok(list.body.riders.some(r => r._id === String(f.riderB._id)));
    assert.equal(list.body.riders[0].availabilityStatus, "ONLINE");
  }
  const assigned = await api(f.admin, `${adminPath}/shipments/${id}/assign-rider`, "POST", { leg: "ORIGIN", riderId: String(f.riderB._id) });
  assert.equal(assigned.status, 200);
  let detail = await api(f.admin, `${adminPath}/shipments/${id}`);
  assert.ok(detail.body.allowedStatusTransitions.some(s => s.status === "PICKED_UP"));
  await update("PICKED_UP");
  await update("RECEIVED_AT_ORIGIN_HUB");
  await update("VERIFIED_AT_ORIGIN_HUB");
  await update("READY_FOR_INTERSTATE_DISPATCH");
  await update("IN_TRANSIT");
  await update("ARRIVED_AT_DESTINATION_HUB");
  await update("DESTINATION_HUB_VERIFIED");
  const lastMile = await api(f.admin, `${adminPath}/shipments/${id}/assign-rider`, "POST", { leg: "DESTINATION", riderId: String(f.riderA._id) });
  assert.equal(lastMile.status, 200);
  assert.equal(lastMile.body.shipment.trackingNumber, trackingNumber);
  const invalid = await api(f.admin, `${adminPath}/shipments/${id}/status`, "PATCH", { status: "DELIVERED" });
  assert.equal(invalid.status, 409);
  detail = await api(f.admin, `${adminPath}/shipments/${id}`);
  assert.ok(detail.body.history.some(h => h.status === "IN_TRANSIT" && String(h.actorId) === String(f.admin._id)));
  assert.ok(await require("../models/notification.model").exists({ userId: f.customer._id, relatedStatus: "IN_TRANSIT", reference: trackingNumber }));
});
test("directional route visibility, simplified pricing and archive preserve all existing shipment/payment/receipt data", async () => {
  const f = await fixture();
  const offices = {};
  for (const state of ["KANO", "ABUJA", "KADUNA", "KOGI"]) {
    offices[state] = await Branch.create({ name: state[0] + state.slice(1).toLowerCase(), code: `SIM-${state}-${++n}`, state, lga: "Test LGA", address: "Test office", phone: "08030000001", status: "ACTIVE", createdBy: f.admin._id });
  }
  const customerRouteIds = async () => {
    const list = await api(f.customer, "/api/logistics/interstate/routes");
    assert.equal(list.status, 200);
    return list.body.routes.map(r => r._id);
  };
  let kano;
  for (const [origin, destination] of [["KANO", "ABUJA"], ["KADUNA", "ABUJA"], ["ABUJA", "KOGI"]]) {
    const response = await api(f.admin, `${adminPath}/routes`, "POST", {
      name: `${offices[origin].name} to ${offices[destination].name}`,
      originState: origin, destinationState: destination,
      originBranchId: String(offices[origin]._id), destinationBranchId: String(offices[destination]._id),
      baseFare: 2000, maximumWeightKg: 5, pricePerAdditionalKg: 100, weightPricingMode: "EXCESS_OVER_MAXIMUM",
      expressEnabled: true, expressSurcharge: 500, expressDeliveryTime: "1 day",
      standardDeliveryTime: "2 days", pickupFee: 300, doorDeliveryFee: 400,
      customerVisible: false,
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.ok(!(await customerRouteIds()).includes(response.body.route._id));
    const enabled = await api(f.admin, `${adminPath}/routes/${response.body.route._id}`, "PATCH", { customerVisible: true });
    assert.equal(enabled.status, 200);
    assert.ok((await customerRouteIds()).includes(response.body.route._id));
    if (origin === "KANO") kano = enabled.body.route;
  }
  const body = {
    ...f.body, routeId: kano._id, sender: { ...f.body.sender, state: "KANO" },
    parcel: { ...f.body.parcel, weightKg: 8 }, serviceType: "EXPRESS",
  };
  const created = await api(f.admin, `${adminPath}/shipments`, "POST", body);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const shipment = created.body.shipment;
  assert.equal(shipment.quote.breakdown.excessKg, 3);
  assert.equal(shipment.quote.breakdown.excessWeightCharge, 300);
  assert.equal(shipment.quote.breakdown.expressSurcharge, 500);
  assert.equal(shipment.quote.breakdown.deliveryFee, 400);
  const quote = await api(f.customer, "/api/logistics/interstate/quote", "POST", {
    ...body, originState: "KANO", destinationState: "ABUJA", weightKg: 8,
    pickupMethod: "RIDER_PICKUP", deliveryMethod: "DOOR_DELIVERY", total: 1,
  });
  assert.equal(quote.status, 200, JSON.stringify(quote.body));
  assert.equal(quote.body.quote.total, 3500);
  assert.equal(quote.body.quote.breakdown.pickupFee, 300);
  const beforeVisibility = await Shipment.findById(shipment._id).lean();
  await api(f.admin, `${adminPath}/routes/${kano._id}`, "PATCH", { customerVisible: false });
  assert.deepEqual(await Shipment.findById(shipment._id).lean(), beforeVisibility);
  assert.ok(!(await customerRouteIds()).includes(kano._id));
  const hiddenQuote = await api(f.customer, "/api/logistics/interstate/quote", "POST", { ...body, originState: "KANO", destinationState: "ABUJA" });
  assert.equal(hiddenQuote.status, 409);
  const stillActive = await api(f.admin, `${adminPath}/routes/${kano._id}/archive`, "POST", { reason: "Safe test route archive" });
  assert.equal(stillActive.status, 409);
  const cancelled = await api(f.admin, `${adminPath}/shipments/${shipment._id}/status`, "PATCH", { status: "CANCELLED" });
  assert.equal(cancelled.status, 200);
  const before = await Shipment.findById(shipment._id).lean();
  const archived = await api(f.admin, `${adminPath}/routes/${kano._id}/archive`, "POST", { reason: "Safe test route archive" });
  assert.equal(archived.status, 200);
  const after = await Shipment.findById(shipment._id).lean();
  assert.deepEqual(after, before);
  const receipt = await api(f.admin, `${adminPath}/shipments/${shipment._id}/receipt`);
  assert.equal(receipt.status, 200);
  assert.ok((typeof receipt.body === "string" ? receipt.body : receipt.body.html).includes(shipment.trackingNumber));
  assert.equal((await api(null, `/api/logistics/interstate/track/${shipment.trackingNumber}`)).status, 200);
  const sameBranch = await api(f.admin, `${adminPath}/routes`, "POST", {
    ...kano, originBranchId: String(offices.KANO._id), destinationBranchId: String(offices.KANO._id),
  });
  assert.equal(sameBranch.status, 400);
});
test("complete office workflow: no rider -> tracking receipt email customer history -> assignment/reassignment -> rider details and customer tracking", async () => {
  const f = await fixture();
  const created = await api(f.admin, `${adminPath}/shipments`, "POST", f.body);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const s = created.body.shipment;
  assert.match(s.trackingNumber, /^SP-INT-\d{8}-[A-F0-9]{16}$/);
  assert.equal(s.status, "RECEIVED_AT_ORIGIN_HUB");
  assert.equal(s.orderType, "INTERSTATE");
  assert.equal(s.assignedRiderId, null);
  assert.equal(s.paymentStatus, "UNPAID");
  const receipt = await api(f.admin, `${adminPath}/shipments/${s._id}/receipt`);
  assert.equal(receipt.status, 200);
  for (const value of [s.trackingNumber, s.sender.name, s.receiver.name, "Origin Office", "2000.00"]) assert.ok(receipt.body.includes(value), value);
  assert.ok(!receipt.body.includes("SERVICEPAY_LOGISTICS"));
  const replay = await api(f.admin, `${adminPath}/shipments`, "POST", f.body);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.shipment._id, s._id);
  await new Promise(resolve => setTimeout(resolve, 50));
  await Shipment.updateOne({ _id: s._id }, { $set: { "trackingEmail.status": "PENDING", "trackingEmail.nextAttemptAt": new Date(0) } });
  let email;
  assert.equal(await tracking.attemptEmail(s._id, async payload => { email = payload; return { success: true }; }), true);
  assert.equal(email.to, f.customer.email);
  assert.ok(email.subject.includes(s.trackingNumber));
  assert.ok(email.text.includes(s.trackingNumber));
  const my = await api(f.customer, "/api/logistics/interstate/shipments/my");
  assert.ok(my.body.shipments.some(row => row._id === s._id && row.trackingNumber === s.trackingNumber));
  const ops = await api(f.admin, `${adminPath}/shipments`);
  assert.ok(ops.body.shipments.some(row => row._id === s._id));
  const choices = await api(f.admin, `${adminPath}/shipments/${s._id}/riders?leg=ORIGIN`);
  assert.deepEqual(choices.body.riders.filter(row => [String(f.riderA._id), String(f.riderB._id)].includes(row._id)).map(row => row.availabilityStatus), ["ONLINE", "OFFLINE"]);
  const assigned = await api(f.admin, `${adminPath}/shipments/${s._id}/assign-rider`, "POST", { riderId: String(f.riderA._id), leg: "ORIGIN" });
  assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
  const riderList = await api(f.riderA, "/api/rider/logistics/interstate/shipments");
  assert.ok(riderList.body.shipments.some(row => row._id === s._id));
  const detail = await api(f.riderA, `/api/rider/logistics/interstate/shipments/${s._id}`);
  assert.equal(detail.body.shipment.receiver.phone, f.body.receiver.phone);
  assert.equal(detail.body.shipment.sender.state, "LAGOS");
  assert.equal(detail.body.shipment.parcel.description, "Signed documents");
  const reassigned = await api(f.admin, `${adminPath}/shipments/${s._id}/assign-rider`, "POST", { riderId: String(f.riderB._id), leg: "ORIGIN" });
  assert.equal(reassigned.status, 200, JSON.stringify(reassigned.body));
  assert.equal(reassigned.body.shipment.trackingNumber, s.trackingNumber);
  assert.equal(reassigned.body.shipment.assignmentHistory.length, 2);
  assert.equal((await api(f.riderA, `/api/rider/logistics/interstate/shipments/${s._id}`)).status, 404);
  assert.equal((await api(f.riderB, `/api/rider/logistics/interstate/shipments/${s._id}`)).status, 200);
  const picked = await api(f.riderB, `/api/rider/logistics/interstate/shipments/${s._id}/status`, "PATCH", { status: "PICKED_UP" });
  assert.equal(picked.status, 200, JSON.stringify(picked.body));
  const publicTrack = await api(null, `/api/logistics/interstate/track/${s.trackingNumber}`);
  assert.equal(publicTrack.body.shipment.status, "PICKED_UP");
  assert.ok(publicTrack.body.timeline.some(row => row.status === "PICKED_UP"));
  assert.equal(publicTrack.body.shipment.receiverPhone, undefined);
  const hub = await api(f.riderB, `/api/rider/logistics/interstate/shipments/${s._id}/status`, "PATCH", { status: "RECEIVED_AT_ORIGIN_HUB" });
  assert.equal(hub.status, 200, JSON.stringify(hub.body));
  for (const status of ["VERIFIED_AT_ORIGIN_HUB", "READY_FOR_INTERSTATE_DISPATCH", "IN_TRANSIT", "ARRIVED_AT_DESTINATION_HUB", "DESTINATION_HUB_VERIFIED"]) {
    const moved = await api(f.admin, `${adminPath}/shipments/${s._id}/status`, "PATCH", { status });
    assert.equal(moved.status, 200, `${status}: ${JSON.stringify(moved.body)}`);
    assert.equal(moved.body.shipment.trackingNumber, s.trackingNumber);
  }
  const lastMile = await user("DELIVERY_RIDER", { branchId: f.b._id, riderVerificationStatus: "VERIFIED", availabilityStatus: "ONLINE" });
  const destination = await api(f.admin, `${adminPath}/shipments/${s._id}/assign-rider`, "POST", { riderId: String(lastMile._id), leg: "DESTINATION" });
  assert.equal(destination.status, 200, JSON.stringify(destination.body));
  assert.equal(destination.body.shipment.status, "OUT_FOR_DELIVERY");
  assert.equal((await api(f.riderB, `/api/rider/logistics/interstate/shipments/${s._id}`)).status, 404);
  assert.equal((await api(lastMile, `/api/rider/logistics/interstate/shipments/${s._id}`)).status, 200);
  assert.equal((await api(f.admin, `${adminPath}/shipments/${s._id}/status`, "PATCH", { status: "DELIVERED" })).status, 409);
  const otpHash = require("crypto").createHash("sha256").update(`123456:${process.env.LOGISTICS_OTP_PEPPER || ""}`).digest("hex");
  await require("../models/shipmentDeliveryOtp.model").create({ shipmentId: s._id, otpHash, expiresAt: new Date(Date.now() + 60000) });
  const completed = await api(lastMile, `/api/rider/logistics/interstate/shipments/${s._id}/verify-delivery`, "POST", { otp: "123456" });
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  assert.equal(completed.body.shipment.trackingNumber, s.trackingNumber);
  assert.equal(completed.body.shipment.status, "DELIVERED");
  assert.equal((await api(null, `/api/logistics/interstate/track/${s.trackingNumber}`)).body.shipment.status, "DELIVERED");
});
test("authorization, invalid customer IDs, branch custody, amount tampering and idempotency conflicts fail without orders", async () => {
  const f = await fixture();
  assert.equal((await api(f.customer, `${adminPath}/shipments`, "POST", f.body)).status, 403);
  assert.equal((await api(f.riderA, `${adminPath}/shipments`, "POST", f.body)).status, 403);
  assert.equal((await api(f.admin, `${adminPath}/shipments`, "POST", { ...f.body, customerId: String(f.riderA._id) })).status, 400);
  assert.equal((await api(f.admin, `${adminPath}/shipments`, "POST", { ...f.body, amount: 1 })).status, 400);
  const foreignManager = await user("BRANCH_MANAGER", { branchId: f.b._id, isStaff: true });
  assert.equal((await api(foreignManager, "/api/branches/logistics/interstate/shipments", "POST", f.body)).status, 403);
  const created = await api(f.admin, `${adminPath}/shipments`, "POST", f.body);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const changed = await api(f.admin, `${adminPath}/shipments`, "POST", { ...f.body, parcel: { ...f.body.parcel, description: "Another parcel" } });
  assert.equal(changed.status, 409);
  assert.equal(await Shipment.countDocuments({ createdBy: f.admin._id }), 1);
  const rejected = await user("DELIVERY_RIDER", { branchId: f.a._id, riderVerificationStatus: "REJECTED", availabilityStatus: "ONLINE" });
  const assign = await api(f.admin, `${adminPath}/shipments/${created.body.shipment._id}/assign-rider`, "POST", { riderId: String(rejected._id), leg: "ORIGIN" });
  assert.equal(assign.status, 409);
});
test("authorized origin branch staff can create and retrieve the same receipt while unrelated branches cannot", async () => {
  const f = await fixture();
  const role = await require("../models/role.model").create({ name: `OFFICE_DELIVERY_${n}`, displayName: "Office delivery staff", department: "DELIVERY", permissions: ["branch.delivery.manage", "branch.delivery.view"], scopeType: "BRANCH" });
  const manager = await user("STAFF", { branchId: f.a._id, isStaff: true, staffRoleId: role._id });
  const other = await user("BRANCH_MANAGER", { branchId: f.b._id, isStaff: true });
  const prefix = "/api/branches/logistics/interstate";
  const routes = await api(manager, `${prefix}/routes`);
  assert.equal(routes.status, 200, JSON.stringify(routes.body));
  assert.ok(routes.body.routes.every(row => row.originBranchId === String(f.a._id)));
  const made = await api(manager, `${prefix}/shipments`, "POST", f.body);
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(made.body.shipment.createdBy, String(manager._id));
  const receipt = await api(manager, `${prefix}/shipments/${made.body.shipment._id}/receipt`);
  assert.equal(receipt.status, 200);
  assert.ok(receipt.body.includes(made.body.shipment.trackingNumber));
  assert.equal((await api(other, `${prefix}/shipments`, "POST", { ...f.body, idempotencyKey: "foreign-branch-test" })).status, 403);
});
test("guest sender does not create a duplicated customer; unique tracking and escaped receipts", async () => {
  const f = await fixture();
  const guest = { ...f.body, customerId: undefined, sender: { ...f.body.sender, name: '<script>alert("x")</script>', email: `guest-${n}@example.test`, phone: "08033334444" } };
  const before = await User.countDocuments();
  const result = await api(f.admin, `${adminPath}/shipments`, "POST", guest);
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(await User.countDocuments(), before);
  const s = result.body.shipment;
  const receipt = await api(f.admin, `${adminPath}/shipments/${s._id}/receipt`);
  assert.ok(receipt.body.includes("&lt;script&gt;"));
  assert.ok(!receipt.body.includes('<script>alert("x")</script>'));
  const next = await api(f.admin, `${adminPath}/shipments`, "POST", { ...guest, idempotencyKey: `${guest.idempotencyKey}-next` });
  assert.notEqual(next.body.shipment.trackingNumber, s.trackingNumber);
  await assert.rejects(Shipment.collection.insertOne({ ...s, _id: new mongoose.Types.ObjectId(), officeIdempotencyKey: undefined }), error => error.code === 11000);
});
test("tracking backfill preserves existing orders and numbers, is repeat-safe, and queues missing emails", async () => {
  const f = await fixture();
  const result = await api(f.admin, `${adminPath}/shipments`, "POST", f.body);
  const original = result.body.shipment;
  const legacyId = new mongoose.Types.ObjectId();
  await Shipment.collection.insertOne({ ...original, _id: legacyId, trackingNumber: undefined, officeIdempotencyKey: undefined, trackingEmail: undefined });
  const count = await Shipment.countDocuments();
  await tracking.migrateTracking();
  const legacy = await Shipment.findById(legacyId).lean();
  assert.ok(legacy.trackingNumber);
  await tracking.migrateTracking();
  assert.equal((await Shipment.findById(legacyId)).trackingNumber, legacy.trackingNumber);
  assert.equal((await Shipment.findById(original._id)).trackingNumber, original.trackingNumber);
  assert.equal(await Shipment.countDocuments(), count);
});
test("email failure remains retryable without recreating the shipment and uses exclusive leases", async () => {
  const f = await fixture();
  const r = await api(f.admin, `${adminPath}/shipments`, "POST", f.body);
  const id = r.body.shipment._id;
  await new Promise(resolve => setTimeout(resolve, 50));
  await Shipment.updateOne({ _id: id }, { $set: { "trackingEmail.status": "PENDING", "trackingEmail.nextAttemptAt": new Date(0) } });
  const count = await Shipment.countDocuments();
  let sends = 0;
  await Promise.all([1, 2].map(() => tracking.attemptEmail(id, async () => { sends++; await new Promise(resolve => setTimeout(resolve, 30)); throw Error("SMTP unavailable"); })));
  assert.equal(sends, 1);
  assert.equal((await Shipment.findById(id)).trackingEmail.status, "RETRY");
  assert.equal(await Shipment.countDocuments(), count);
});
test("local delivery reassignment exposes offline fallback, persists assignment history and preserves tracking", async () => {
  const f = await fixture();
  const d = await Delivery.create({ customerId: f.customer._id, branchId: f.a._id, trackingNumber: `LOCAL-${n}`, pickupAddress: "Origin", deliveryAddress: "Destination", senderName: f.customer.fullName, senderPhone: f.customer.phone, receiverName: "Receiver", receiverPhone: "08030000001", packageName: "Documents", status: "ASSIGNED", assignedRiderId: f.riderA._id });
  const choices = await api(f.admin, `/api/admin/deliveries/${d._id}/available-riders`);
  assert.equal(choices.status, 200);
  assert.ok(choices.body.riders.some(row => row._id === String(f.riderB._id)));
  const reassign = await api(f.admin, `/api/admin/deliveries/${d._id}/reassign-rider`, "PATCH", { riderId: String(f.riderB._id) });
  assert.equal(reassign.status, 200, JSON.stringify(reassign.body));
  const saved = await Delivery.findById(d._id);
  assert.equal(String(saved.assignedRiderId), String(f.riderB._id));
  assert.equal(saved.trackingNumber, d.trackingNumber);
  assert.equal(saved.orderType, "LOCAL_DELIVERY");
  assert.equal(saved.assignmentHistory.length, 1);
});