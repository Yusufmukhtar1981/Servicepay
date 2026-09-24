const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const User = require("../models/user.model");
const Audit = require("../models/adminAuditLog.model");
const Transaction = require("../models/transaction.model");
const controller = require("../controllers/hierarchyAssignment.controller");
const managementController = require("../controllers/management.controller");
const { requireExplicitPermission } = require("../middleware/staffPermission.middleware");
const { STAFF_PERMISSIONS } = require("../config/staffPermissions");
const { adminOnly } = require("../middleware/auth.middleware");
let phoneSequence = 0;

const invoke = async (handler, req) => {
  const result = {};
  const res = {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; return this; },
  };
  await handler(req, res);
  return result;
};
const user = (role, suffix, fields = {}) => ({
  fullName: `${role} ${suffix}`, phone: `0809${String(Date.now()).slice(-6)}${String(phoneSequence++).padStart(2, "0")}`,
  email: `${role.toLowerCase()}-${suffix.toLowerCase()}-${phoneSequence}@test.invalid`,
  password: "Password123!", role, status: "ACTIVE", ...fields,
});

test("hierarchy route requires explicit assigned-role permission", async () => {
  const middleware = requireExplicitPermission(STAFF_PERMISSIONS.HIERARCHY_MANAGE);
  const invokeGuard = (staffRole) => new Promise((resolve) => {
    const response = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; resolve(this); } };
    middleware({ staffRole }, response, () => resolve(response));
  });
  assert.equal((await invokeGuard({ permissions: [] })).statusCode, 403);
  assert.equal((await invokeGuard({ permissions: [STAFF_PERMISSIONS.HIERARCHY_MANAGE] })).statusCode, 200);
  await new Promise((resolve) => {
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json() { resolve(this); } };
    adminOnly("HEAD_OFFICE", "HEAD_OFFICE_ADMIN", "ADMIN", "SUPER_ADMIN", "SERVICEPAY_SUPER_ADMIN")(
      { user: { role: "ZONAL_MANAGER" } }, response, () => { response.statusCode = 200; resolve(response); }
    );
    setImmediate(() => assert.equal(response.statusCode, 403));
  });
});

test("Head Office hierarchy assignments are transactional, scoped, idempotent, and audited", async (t) => {
  const mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ args: ["--nounixsocket"] }],
  });
  process.env.MONGODB_URI = mongo.getUri();
  await mongoose.connect(mongo.getUri(), { dbName: "hierarchy_assignment" });
  t.after(async () => { await mongoose.disconnect(); await mongo.stop(); });
  await Promise.all([User, Audit, Transaction].map((model) => model.init()));

  const [zonalA, zonalB, stateA, stateB, agentA, customerA] = await User.create([
    user("ZONAL_MANAGER", "A", { zone: "NORTH_A" }),
    user("ZONAL_MANAGER", "B", { zone: "NORTH_A" }),
    user("STATE_MANAGER", "A", { zone: "NORTH_A", state: "KANO" }),
    user("STATE_MANAGER", "B", { zone: "NORTH_A", state: "KANO" }),
    user("AGENT", "A", { zone: "NORTH_A", state: "KANO" }),
    user("CUSTOMER", "A", { zone: "NORTH_A", state: "KANO", walletBalance: 77, referredBy: null }),
  ]);
  const directCustomer = await User.create(user("CUSTOMER", "DIRECT", {
    zone: "NORTH_A", state: "KANO", walletBalance: 88, stateManagerId: null, agentId: null,
  }));
  const blockedCustomer = await User.create(user("CUSTOMER", "BLOCKED", {
    zone: "NORTH_A", state: "KANO", status: "SUSPENDED",
    zonalManagerId: zonalA._id, stateManagerId: stateA._id, agentId: agentA._id,
  }));
  const zonalOtherZone = await User.create(user("ZONAL_MANAGER", "OTHER", { zone: "NORTH_B" }));
  await User.updateOne({ _id: stateA._id }, { $set: { zonalManagerId: zonalA._id } });
  await User.updateOne({ _id: stateB._id }, { $set: { zonalManagerId: zonalB._id } });
  await User.updateOne({ _id: agentA._id }, { $set: { zonalManagerId: zonalA._id, stateManagerId: stateA._id } });
  await User.updateOne({ _id: customerA._id }, { $set: { zonalManagerId: zonalA._id, stateManagerId: stateA._id, agentId: agentA._id } });
  await User.updateOne({ _id: directCustomer._id }, { $set: { zonalManagerId: zonalA._id, stateManagerId: stateA._id, agentId: null } });
  await Transaction.create({
    reference: "HIERARCHY-HISTORICAL-1", customerId: customerA._id, serviceType: "AIRTIME",
    amount: 12, status: "SUCCESSFUL", agentId: agentA._id, stateManagerId: stateA._id, zonalManagerId: zonalA._id,
  });
  const actor = { _id: new mongoose.Types.ObjectId(), role: "HEAD_OFFICE", fullName: "Head Office" };

  const crossZone = await invoke(controller.assign, {
    user: actor, body: { userId: stateA._id, parentId: zonalOtherZone._id, requestId: "invalid-cross-zone", reason: "Invalid geography." },
    method: "POST", originalUrl: "/api/admin/hierarchy/assignments",
  });
  assert.equal(crossZone.status, 409);
  assert.equal(crossZone.body.code, "HIERARCHY_CROSS_ZONE");
  const moveState = await invoke(controller.assign, {
    user: actor, body: { userId: stateA._id, parentId: zonalB._id, requestId: "assignment-state-a-1", reason: "Operational territory realignment." },
    method: "POST", originalUrl: "/api/admin/hierarchy/assignments",
  });
  assert.equal(moveState.status, undefined);
  assert.equal(moveState.body.success, true);
  assert.equal(moveState.body.duplicate, false);
  assert.equal(moveState.body.affectedCount, 5);
  const movedState = await User.findById(stateA._id).lean();
  const movedAgent = await User.findById(agentA._id).lean();
  const movedCustomer = await User.findById(customerA._id).lean();
  assert.equal(movedState.role, "STATE_MANAGER");
  assert.equal(String(movedState.zonalManagerId), String(zonalB._id));
  assert.equal(String(movedAgent.zonalManagerId), String(zonalB._id));
  assert.equal(String(movedCustomer.zonalManagerId), String(zonalB._id));
  assert.equal(movedCustomer.walletBalance, 77);
  const movedDirectCustomer = await User.findById(directCustomer._id).lean();
  assert.equal(String(movedDirectCustomer.zonalManagerId), String(zonalB._id));
  assert.equal(String(movedDirectCustomer.stateManagerId), String(stateA._id));
  assert.equal(movedDirectCustomer.agentId, null);
  assert.equal(movedDirectCustomer.walletBalance, 88);
  const movedBlockedCustomer = await User.findById(blockedCustomer._id).lean();
  assert.equal(movedBlockedCustomer.status, "SUSPENDED");
  assert.equal(String(movedBlockedCustomer.zonalManagerId), String(zonalB._id));
  const statesInZone = await invoke(controller.listUsers, {
    query: { role: "STATE_MANAGER", parentId: String(zonalB._id) },
  });
  assert.ok(statesInZone.body.users.some((entry) => String(entry._id) === String(stateA._id)));
  const aggregators = await invoke(controller.listUsers, {
    query: { role: "AGENT", parentId: String(stateA._id) },
  });
  assert.ok(aggregators.body.users.some((entry) => String(entry._id) === String(agentA._id)));
  const directCustomers = await invoke(controller.listUsers, {
    query: { role: "CUSTOMER", parentId: String(stateA._id) },
  });
  assert.ok(directCustomers.body.users.some((entry) => String(entry._id) === String(directCustomer._id)));
  const customerTree = await invoke(controller.listUsers, {
    query: { role: "CUSTOMER", parentId: String(agentA._id), includeInactive: "true" },
  });
  assert.ok(customerTree.body.users.some((entry) => entry.status === "SUSPENDED" && String(entry._id) === String(blockedCustomer._id)));
  const invalidTreeParent = await invoke(controller.listUsers, {
    query: { role: "AGENT", parentId: String(agentA._id) },
  });
  assert.equal(invalidTreeParent.status, 400);
  const historical = await Transaction.findOne({ reference: "HIERARCHY-HISTORICAL-1" }).lean();
  assert.equal(String(historical.agentId), String(agentA._id));
  assert.equal(String(historical.stateManagerId), String(stateA._id));
  assert.equal(String(historical.zonalManagerId), String(zonalA._id));
  const beforeReport = await invoke(managementController.getDownlineSummary, { user: { _id: zonalA._id, role: "ZONAL_MANAGER" } });
  assert.equal(beforeReport.body.counts.transactionValue, 12);

  const duplicate = await invoke(controller.assign, {
    user: actor, body: { userId: stateA._id, parentId: zonalB._id, requestId: "assignment-state-a-1", reason: "Operational territory realignment." },
    method: "POST", originalUrl: "/api/admin/hierarchy/assignments",
  });
  assert.equal(duplicate.status, undefined);
  assert.equal(duplicate.body.duplicate, true);
  assert.equal(await Audit.countDocuments({ action: "HIERARCHY_ASSIGNMENT_UPDATED" }), 1);
  const mismatchedReplay = await invoke(controller.assign, {
    user: actor, body: { userId: stateB._id, parentId: zonalA._id, requestId: "assignment-state-a-1", reason: "Changed intent." },
    method: "POST", originalUrl: "/api/admin/hierarchy/assignments",
  });
  assert.equal(mismatchedReplay.status, 409);
  assert.equal(mismatchedReplay.body.code, "HIERARCHY_REQUEST_INTENT_MISMATCH");

  const moveAgent = await invoke(controller.assign, {
    user: actor, body: { userId: agentA._id, parentId: stateB._id, requestId: "assignment-agent-a-1", reason: "Move aggregator." },
    method: "POST", originalUrl: "/api/admin/hierarchy/assignments",
  });
  assert.equal(moveAgent.status, undefined);
  assert.equal(moveAgent.body.success, true);
  const afterAgent = await User.findById(agentA._id).lean();
  const afterCustomer = await User.findById(customerA._id).lean();
  assert.equal(afterAgent.role, "AGENT");
  assert.equal(String(afterAgent.stateManagerId), String(stateB._id));
  assert.equal(String(afterCustomer.agentId), String(agentA._id));
  assert.equal(String(afterCustomer.stateManagerId), String(stateB._id));
  assert.equal(afterCustomer.walletBalance, 77);
  const historicalAfterAgentMove = await Transaction.findOne({ reference: "HIERARCHY-HISTORICAL-1" }).lean();
  assert.deepEqual(
    [historicalAfterAgentMove.agentId, historicalAfterAgentMove.stateManagerId, historicalAfterAgentMove.zonalManagerId].map(String),
    [agentA._id, stateA._id, zonalA._id].map(String),
  );
  await Transaction.create({
    reference: "HIERARCHY-FUTURE-1", customerId: customerA._id, serviceType: "DATA",
    amount: 13, status: "SUCCESSFUL", agentId: afterCustomer.agentId,
    stateManagerId: afterCustomer.stateManagerId, zonalManagerId: afterCustomer.zonalManagerId,
  });
  const future = await Transaction.findOne({ reference: "HIERARCHY-FUTURE-1" }).lean();
  assert.deepEqual(
    [future.agentId, future.stateManagerId, future.zonalManagerId].map(String),
    [agentA._id, stateB._id, zonalB._id].map(String),
  );
  const oldManagerReport = await invoke(managementController.getDownlineSummary, { user: { _id: zonalA._id, role: "ZONAL_MANAGER" } });
  const newManagerReport = await invoke(managementController.getDownlineSummary, { user: { _id: zonalB._id, role: "ZONAL_MANAGER" } });
  assert.equal(oldManagerReport.body.counts.transactionValue, 12);
  assert.equal(newManagerReport.body.counts.transactionValue, 13);
  await Transaction.create({
    reference: "HIERARCHY-NO-SNAPSHOT-IN-PAYMENT-CODE",
    customerId: customerA._id, serviceType: "EDUPAY", amount: 3, status: "SUCCESSFUL",
  });
  const autoAttributed = await Transaction.findOne({ reference: "HIERARCHY-NO-SNAPSHOT-IN-PAYMENT-CODE" }).lean();
  assert.deepEqual(
    [autoAttributed.agentId, autoAttributed.stateManagerId, autoAttributed.zonalManagerId].map(String),
    [agentA._id, stateB._id, zonalB._id].map(String),
  );

  const agentB = await User.create(user("AGENT", "B", {
    zone: "NORTH_A", state: "KANO", zonalManagerId: zonalB._id, stateManagerId: stateB._id,
  }));
  const agentC = await User.create(user("AGENT", "C", {
    zone: "NORTH_A", state: "KANO", zonalManagerId: zonalB._id, stateManagerId: stateB._id,
  }));
  const raced = await Promise.all([
    invoke(controller.assign, {
      user: actor, body: { userId: customerA._id, parentId: agentB._id, requestId: "assignment-customer-race-a", reason: "Race A." },
      method: "POST", originalUrl: "/api/admin/hierarchy/assignments",
    }),
    invoke(controller.assign, {
      user: actor, body: { userId: customerA._id, parentId: agentC._id, requestId: "assignment-customer-race-b", reason: "Race B." },
      method: "POST", originalUrl: "/api/admin/hierarchy/assignments",
    }),
  ]);
  assert.equal(raced.filter((response) => response.body?.success === true).length, 1);
  assert.equal(raced.filter((response) => response.status === 409).length, 1);
  const racedCustomer = await User.findById(customerA._id).lean();
  assert.ok([String(agentB._id), String(agentC._id)].includes(String(racedCustomer.agentId)));
  // Simulate a legacy record saved before the creation hook existed.
  await Transaction.collection.insertOne({
    reference: "HIERARCHY-UNATTRIBUTED-1", customerId: customerA._id,
    serviceType: "EDUPAY", amount: 5, status: "SUCCESSFUL",
    agentId: null, stateManagerId: null, zonalManagerId: null,
    createdAt: new Date(), updatedAt: new Date(),
  });
  const unverifiedHistory = await invoke(controller.assign, {
    user: actor,
    body: {
      userId: customerA._id,
      parentId: String(racedCustomer.agentId) === String(agentB._id) ? agentC._id : agentB._id,
      requestId: "history-unverified-1",
      reason: "Must not transfer unattributed history.",
    },
    method: "POST", originalUrl: "/api/admin/hierarchy/assignments",
  });
  assert.equal(unverifiedHistory.status, 409);
  assert.equal(unverifiedHistory.body.code, "HIERARCHY_HISTORY_UNVERIFIED");
  assert.equal(String((await User.findById(customerA._id)).agentId), String(racedCustomer.agentId));
  const unassigned = await User.create(user("CUSTOMER", "UNASSIGNED", {
    zone: "NORTH_A", state: "KANO",
  }));
  await Transaction.create({
    reference: "HIERARCHY-BEFORE-FIRST-ASSIGNMENT", customerId: unassigned._id,
    serviceType: "EDUPAY", amount: 11, status: "SUCCESSFUL",
  });
  const preAssignment = await Transaction.findOne({ reference: "HIERARCHY-BEFORE-FIRST-ASSIGNMENT" }).lean();
  assert.ok(preAssignment.hierarchyCapturedAt);
  assert.equal(preAssignment.agentId, null);
  const assignFirst = await invoke(controller.assign, {
    user: actor,
    body: { userId: unassigned._id, parentId: agentB._id, requestId: "first-customer-assignment", reason: "Assign first manager." },
    method: "POST", originalUrl: "/api/admin/hierarchy/assignments",
  });
  assert.equal(assignFirst.body.success, true);
  const agentBReport = await invoke(managementController.getDownlineSummary, {
    user: { _id: agentB._id, role: "AGENT" },
  });
  assert.ok(!agentBReport.body.recentTransactions.some((entry) => entry.reference === "HIERARCHY-BEFORE-FIRST-ASSIGNMENT"));

  const history = await invoke(controller.history, { query: { role: "AGENT", limit: "10" } });
  assert.equal(history.status, undefined);
  assert.equal(history.body.success, true);
  assert.equal(history.body.records.length, 1);
  assert.equal(history.body.records[0].requestId, "assignment-agent-a-1");

  const invalid = await invoke(controller.assign, {
    user: actor, body: { userId: customerA._id, parentId: zonalA._id, requestId: "invalid-parent-1", reason: "Invalid." },
    method: "POST", originalUrl: "/api/admin/hierarchy/assignments",
  });
  assert.equal(invalid.status, 400);
});