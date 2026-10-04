const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const express = require("express");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const routes = require("../routes/branch.routes");
const User = require("../models/user.model");
const Branch = require("../models/branch.model");
const Delivery = require("../models/delivery.model");
const Shipment = require("../models/interstateShipment.model");
const Route = require("../models/logisticsRoute.model");
const Audit = require("../models/branchAuditLog.model");
const Coverage = require("../models/deliveryCoverage.model");
const History = require("../models/shipmentStatusHistory.model");
const Role = require("../models/role.model");
const models = [User, Branch, Delivery, Shipment, Route, Audit, Coverage, History, Role];
let mongo, server, base, count = 0, manager, officer, branch, destination;
const user = (role, extra = {}) => User.create({ role, fullName: `${role} ${++count}`,
  phone: `0808${String(count).padStart(7, "0")}`, password: "Fixture-only-pass-123", status: "ACTIVE", ...extra });
const call = async (who, path, method = "GET", body) => {
  const token = jwt.sign({ id: String(who._id) }, process.env.JWT_SECRET);
  const r = await fetch(base + "/api/branches/counter-deliveries" + path, {
    method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, body: await r.json() };
};
const draft = (extra = {}) => ({ kind: "DELIVERY", sender: { name: "<script>Sender</script>", phone: "08012345678",
  address: "Origin desk", state: "KANO", lga: "Kano Municipal" },
  receiver: { name: "Receiver", phone: "08022345678", address: "Destination", state: "KANO", lga: "Fagge" },
  parcel: { description: "Books", quantity: 2, category: "DOCUMENTS" }, paymentMethod: "CASH", ...extra });
const create = async (who, body, key = "fixture-order-key-001") => {
  const q = await call(who, "/quote", "POST", body);
  assert.equal(q.status, 200, JSON.stringify(q.body));
  const input = { ...body, quoteToken: q.body.quote.quoteToken, idempotencyKey: key };
  const result = await call(who, "", "POST", input);
  return { ...result, input };
};
test.before(async () => {
  process.env.JWT_SECRET = "branch-counter-fixture-only";
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(mongo.getUri(), { dbName: "branch-counter-fixture" });
  await Promise.all(models.map(m => m.init()));
  const app = express(); app.use(express.json()); app.use("/api/branches", routes);
  app.use("/api/riders", require("../routes/rider.routes"));
  server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { await new Promise(r => server.close(r)); await mongoose.disconnect(); await mongo.stop(); });
test.beforeEach(async () => {
  await Promise.all(models.map(m => m.deleteMany({}))); count = 0;
  const head = await user("HEAD_OFFICE");
  branch = await Branch.create({ code: "CTR-KANO", name: "Kano Office", state: "KANO", lga: "Fagge",
    address: "ServicePay office", status: "ACTIVE", assignedModules: ["DELIVERY"], createdBy: head._id });
  destination = await Branch.create({ code: "CTR-LAGOS", name: "Lagos Office", state: "LAGOS", lga: "Ikeja",
    status: "ACTIVE", assignedModules: ["DELIVERY"], createdBy: head._id });
  manager = await user("BRANCH_MANAGER", { isStaff: true, branchId: branch._id,
    branchManagerPermissions: ["branch.delivery.manage", "branch.delivery.view"] });
  const role = await Role.create({ name: "COUNTER_DELIVERY_OFFICER", displayName: "Counter Officer",
    department: "DELIVERY", scopeType: "BRANCH", status: "ACTIVE",
    permissions: ["branch.delivery.manage", "branch.delivery.view"] });
  officer = await user("STAFF", { isStaff: true, branchId: branch._id, staffRoleId: role._id });
  branch.managerId = manager._id; await branch.save();
  await Coverage.create({ stateCode: "KANO", stateName: "Kano", isLive: true });
});
test("walk-in order reuses Delivery, standard pricing, and immutable idempotency", async () => {
  const first = await create(officer, draft());
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.match(first.body.order.trackingNumber, /^SPDL-\d{8}-D[A-F0-9]{12}$/);
  assert.equal(first.body.order.paymentStatus, "UNPAID");
  assert.equal(first.body.order.total, Delivery.STANDARD_DELIVERY_FEE);
  const replay = await call(officer, "", "POST", first.input);
  assert.equal(replay.status, 200); assert.equal(replay.body.idempotent, true);
  assert.equal(await Delivery.countDocuments(), 1);
  const conflict = await call(officer, "", "POST", { ...first.input, parcel: { ...first.input.parcel, quantity: 3 } });
  assert.equal(conflict.status, 409);
  assert.equal(await User.countDocuments(), 3, "no fabricated customer account");
});
test("concurrent same-key requests create one canonical order", async () => {
  const q = await call(officer, "/quote", "POST", draft());
  const input = { ...draft(), quoteToken: q.body.quote.quoteToken, idempotencyKey: "same-concurrent-key" };
  const results = await Promise.all(Array.from({ length: 4 }, () => call(officer, "", "POST", input)));
  assert.ok(results.some(r => [200, 201].includes(r.status)), JSON.stringify(results));
  assert.equal(await Delivery.countDocuments(), 1);
});
for (const method of ["CASH", "POS", "BANK_TRANSFER"]) {
  test(`${method} is UNPAID until the assigned manager confirms actual collection`, async () => {
    const { body } = await create(officer, draft({ paymentMethod: method }));
    const path = `/DELIVERY/${body.order._id}`;
    const evidence = { reference: "POS-bank-proof-123", note: "Receipt reviewed" };
    assert.equal((await call(officer, path + "/payment-evidence", "POST", evidence)).status, 200);
    assert.equal((await call(officer, path + "/confirm-payment", "POST", { ...evidence, confirmed: true })).status, 403);
    assert.equal((await call(manager, path + "/confirm-payment", "POST", evidence)).status, 400);
    const approved = await call(manager, path + "/confirm-payment", "POST", { ...evidence, confirmed: true });
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(approved.body.order.paymentStatus, "PAID");
    assert.equal(approved.body.order.amountPaid, 2000);
    assert.equal(approved.body.order.payment.recordedByName, officer.fullName);
    const twice = await call(manager, path + "/confirm-payment", "POST", { ...evidence, confirmed: true });
    assert.equal(twice.status, 200);
    assert.equal(await Audit.countDocuments({ action: "BRANCH_DELIVERY_PAYMENT_CONFIRMED" }), 1);
    assert.equal((await call(manager, path + "/cancel", "POST", {})).status, 409);
    assert.equal((await User.findById(manager._id)).walletBalance, 0, "cash is not a wallet credit");
  });
}
test("receipt is printable, escaped, private and does not leak IDs or internal pricing", async () => {
  const { body } = await create(officer, draft());
  for (const layout of ["A4", "THERMAL"]) {
    const receipt = await call(officer, `/DELIVERY/${body.order._id}/receipt?layout=${layout}`);
    assert.equal(receipt.status, 200, JSON.stringify(receipt.body));
    const html = receipt.body.html;
    assert.match(html, /Yumpay Global Tech Ltd/); assert.match(html, /data:image\/png;base64,/);
    assert.match(html, /@media print/); assert.match(html, /UNPAID/);
    assert.ok(!html.includes("<script>Sender</script>"));
    for (const hidden of [String(branch._id), String(officer._id), String(body.order._id), "servicepayProfit", "riderCommission", "quoteToken"])
      assert.ok(!html.includes(hidden), hidden);
  }
  assert.equal((await call(officer, `/DELIVERY/${body.order._id}/print-events`, "POST", { reprint: true })).status, 200);
  assert.equal(await Audit.countDocuments({ action: "BRANCH_DELIVERY_REPRINT_REQUESTED" }), 1);
});
test("branch isolation, literal search, cancellation and statistics", async () => {
  const { body } = await create(officer, draft());
  const foreign = await user("BRANCH_MANAGER", { branchId: destination._id, isStaff: true,
    branchManagerPermissions: ["branch.delivery.manage"] });
  assert.equal((await call(foreign, `/DELIVERY/${body.order._id}`)).status, 404);
  assert.equal((await call(foreign, `/DELIVERY/${body.order._id}/receipt`)).status, 404);
  assert.equal((await call(officer, "?search=08012345678")).body.total, 1);
  assert.equal((await call(officer, "?search=.*")).body.total, 0);
  const all = await call(manager, "");
  assert.equal(all.body.stats.todayOrders, 1);
  assert.equal(all.body.stats.todayRevenue, 0);
  assert.equal((await call(officer, `/DELIVERY/${body.order._id}/cancel`, "POST", {})).status, 200);
  assert.equal((await call(officer, "?status=CANCELLED")).body.total, 1);
});
test("WALLET never accepts staff manual confirmation or unlinked wallet debit", async () => {
  const bad = await create(officer, draft({ paymentMethod: "WALLET" }));
  assert.equal(bad.status, 400);
  const customer = await user("CUSTOMER", { phone: "08012345678", walletBalance: 5000 });
  const good = await create(officer, draft({ paymentMethod: "WALLET", customerId: String(customer._id) }), "wallet-counter-key");
  assert.equal(good.status, 201, JSON.stringify(good.body));
  assert.equal((await call(manager, `/DELIVERY/${good.body.order._id}/confirm-payment`, "POST", { confirmed: true })).status, 409);
  assert.equal((await User.findById(customer._id)).walletBalance, 5000);
});
test("Interstate counter creation reuses approved routes and canonical office workflow", async () => {
  const route = await Route.create({ name: "Kano to Lagos fixture", originState: "KANO",
    originBranchId: branch._id, destinationState: "LAGOS", destinationBranchId: destination._id,
    baseFare: 5000, minimumWeightKg: 1, maximumWeightKg: 30, pricePerAdditionalKg: 200,
    standardDeliveryTime: "3 days", status: "ACTIVE", createdBy: manager._id });
  const input = draft({ kind: "INTERSTATE", routeId: String(route._id), prohibitedItemsAcknowledged: true,
    receiver: { ...draft().receiver, state: "LAGOS", lga: "Ikeja" },
    parcel: { ...draft().parcel, weightKg: 2 } });
  const result = await create(officer, input);
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(result.body.order.status, "RECEIVED_AT_ORIGIN_HUB");
  assert.equal(await Shipment.countDocuments(), 1); assert.equal(await Delivery.countDocuments(), 0);
  const duplicate = await create(officer, draft());
  assert.equal(duplicate.status, 409, "same key cannot create a second kind");
  const record = await Shipment.findById(result.body.order._id);
  assert.equal(String(record.originBranchId), String(branch._id));
  assert.equal(record.paymentStatus, "UNPAID");
  assert.equal(record.quote.total, result.body.order.total);
});
test("walk-in parcel enters existing assignment and Rider flow through Delivered", async () => {
  const { body } = await create(officer, draft());
  const id = body.order._id;
  assert.equal((await call(manager, `/DELIVERY/${id}/confirm-payment`, "POST", { confirmed: true })).status, 200);
  const rider = await user("DELIVERY_RIDER", { branchId: branch._id, riderId: "COUNTER-RIDER",
    riderVerificationStatus: "VERIFIED", availabilityStatus: "ONLINE" });
  const request = async (actor, path, data) => {
    const r = await fetch(base + path, { method: "PATCH", headers: { "Content-Type": "application/json",
      Authorization: `Bearer ${jwt.sign({ id: String(actor._id) }, process.env.JWT_SECRET)}` }, body: JSON.stringify(data) });
    return { status: r.status, body: await r.json() };
  };
  const assigned = await request(manager, `/api/branches/deliveries/${id}/assign-rider`, { riderId: String(rider._id) });
  assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
  const accept = await request(rider, `/api/riders/deliveries/${id}/accept`, {});
  assert.equal(accept.status, 200, JSON.stringify(accept.body));
  for (const status of ["PICKED_UP", "IN_TRANSIT", "DELIVERED"]) {
    const result = await request(rider, `/api/riders/deliveries/${id}/status`, { status });
    assert.equal(result.status, 200, JSON.stringify(result.body));
  }
  const final = await Delivery.findById(id);
  assert.equal(final.status, "DELIVERED");
  assert.equal(final.riderCommissionAmount, 600);
  assert.equal(final.servicepayProfit, 1400);
  assert.equal(final.riderCommissionCredited, true);
  const replay = await request(rider, `/api/riders/deliveries/${id}/status`, { status: "DELIVERED" });
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  assert.equal((await User.findById(rider._id)).pendingRiderSettlement, 600);
  assert.equal((await User.findById(rider._id)).walletBalance, 0, "cash earnings are not a customer wallet credit");
});