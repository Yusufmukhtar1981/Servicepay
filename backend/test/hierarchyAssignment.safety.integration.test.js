const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const Audit = require("../models/adminAuditLog.model");
const assignment = require("../controllers/hierarchyAssignment.controller");
const { adminOnly } = require("../middleware/auth.middleware");

let replicaSet;
let sequence = 0;

const makeUser = (role, suffix, fields = {}) => ({
  fullName: `${role} ${suffix}`,
  phone: `080${String(Date.now()).slice(-6)}${String(sequence++).padStart(4, "0")}`,
  email: `${role.toLowerCase()}-${suffix}-${sequence}@safety.test`,
  password: "Password123!",
  role,
  status: "ACTIVE",
  ...fields,
});

const invoke = async (handler, req) => {
  const result = {};
  const res = {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; return this; },
  };
  await handler(req, res);
  return result;
};

const actor = () => ({
  _id: new mongoose.Types.ObjectId(),
  role: "HEAD_OFFICE",
  fullName: "Safety Test Head Office",
});

const assignmentRequest = (target, parent, requestId, user = actor()) => ({
  user,
  body: {
    userId: String(target._id),
    parentId: String(parent._id),
    requestId,
    reason: "Approved reporting-line correction.",
  },
  method: "PATCH",
  originalUrl: "/api/admin/role-users/hierarchy-assignments",
});

test.before(async () => {
  replicaSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ args: ["--nounixsocket"] }],
  });
  await mongoose.connect(replicaSet.getUri(), { dbName: "hierarchy_assignment_safety" });
  await Promise.all([User, Transaction, Audit].map((model) => model.init()));
});

test.after(async () => {
  await mongoose.disconnect();
  await replicaSet.stop();
});

test.beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Transaction.deleteMany({}),
    Audit.collection.deleteMany({}),
  ]);
});

test("assignment fails closed without provisioning an absent idempotency index", async () => {
  const original = Audit.collection.listIndexes;
  const create = Audit.collection.createIndex;
  let provisioned = false;
  Audit.collection.listIndexes = () => ({ toArray: async () => [] });
  Audit.collection.createIndex = async () => { provisioned = true; };
  try {
    const result = await invoke(assignment.assign, assignmentRequest(
      { _id: new mongoose.Types.ObjectId() }, { _id: new mongoose.Types.ObjectId() }, "missing-index"));
    assert.equal(result.status, 503);
    assert.equal(provisioned, false);
    assert.equal(await Audit.countDocuments({}), 0);
  } finally {
    Audit.collection.listIndexes = original;
    Audit.collection.createIndex = create;
  }
});

test("bulk customer assignments persist, audit, replay safely and retain blocked history", async () => {
  const zonal = await User.create(makeUser("ZONAL_MANAGER", "bulk", { zone: "NORTH" }));
  const state = await User.create(makeUser("STATE_MANAGER", "bulk", {
    zone: "NORTH", state: "KANO", zonalManagerId: zonal._id }));
  const [first, second] = await User.create(["first", "second"].map(suffix => makeUser("AGENT", suffix, {
    zone: "NORTH", state: "KANO", zonalManagerId: zonal._id, stateManagerId: state._id })));
  const customers = await User.create(["new", "legacy", "assigned"].map((suffix, i) => makeUser("CUSTOMER", suffix, {
    walletBalance: 1000.25, agentId: i === 2 ? first._id : null,
    stateManagerId: i === 2 ? state._id : null, zonalManagerId: i === 2 ? zonal._id : null })));
  await Transaction.collection.insertOne({ customerId: customers[1]._id, serviceType: "AIRTIME", amount: 100,
    status: "PENDING", reference: "legacy-bulk-preserved", description: "Unverified historical transaction" });
  await Transaction.collection.insertOne({ customerId: customers[2]._id, serviceType: "DATA", amount: 200,
    status: "SUCCESSFUL", reference: "captured-bulk-preserved", hierarchyCapturedAt: new Date(),
    agentId: first._id, stateManagerId: state._id, zonalManagerId: zonal._id });
  const history = await Transaction.find({}).sort({ reference: 1 }).lean();
  const Role = require("../models/role.model");
  const permissionRole = await Role.create({ name: "FIXTURE_ASSIGNMENT_ADMIN", displayName: "Fixture assignment administrator", department: "ADMINISTRATION",
    permissions: ["hierarchy.manage"], status: "ACTIVE", scopeType: "GLOBAL" });
  const operator = await User.create(makeUser("HEAD_OFFICE", "bulk-operator", { staffRoleId: permissionRole._id }));
  const request = {
    user: operator, method: "POST", originalUrl: "/api/admin/hierarchy/customer-assignments/bulk",
    body: { customers: customers.map(c => ({ userId: String(c._id),
      expectedParentId: c.agentId ? String(c.agentId) : null })),
      parentId: String(second._id), reason: "Reviewed customer assignment batch", requestId: "reviewed-batch" },
  };
  const [result, concurrent] = await Promise.all([
    invoke(assignment.assignCustomers, request), invoke(assignment.assignCustomers, request),
  ]);
  assert.equal(result.body.completed, 2);
  assert.equal(concurrent.body.completed, 2);
  assert.equal(result.body.results[1].code, "HIERARCHY_HISTORY_UNVERIFIED");
  for (const index of [0, 2]) {
    assert.equal(String((await User.findById(customers[index]._id)).agentId), String(second._id));
  }
  assert.equal((await User.findById(customers[1]._id)).agentId, null);
  const replay = await invoke(assignment.assignCustomers, request);
  assert.equal(replay.body.completed, 2);
  assert.equal(replay.body.results[0].duplicate, true);
  assert.equal(await Audit.countDocuments({ action: "HIERARCHY_ASSIGNMENT_UPDATED" }), 2);
  assert.deepEqual(await Transaction.find({}).sort({ reference: 1 }).lean(), history);
  assert.ok((await User.find({ _id: { $in: customers.map(c => c._id) } }).lean())
    .every(c => c.walletBalance === 1000.25 && c.role === "CUSTOMER"));
  const changed = await invoke(assignment.assignCustomers, {
    ...request, body: { ...request.body, parentId: String(first._id) },
  });
  assert.equal(changed.body.results[0].code, "HIERARCHY_REQUEST_INTENT_MISMATCH");
  const staffMove = await invoke(assignment.assignCustomers, {
    ...request, body: { ...request.body, requestId: "staff-is-not-customer",
      customers: [{ userId: String(first._id), expectedParentId: String(state._id) }] },
  });
  assert.equal(staffMove.body.completed, 0);
  assert.equal(String((await User.findById(first._id)).stateManagerId), String(state._id));
  const list = await invoke(assignment.listUsers, { query: { role: "CUSTOMER", parentId: String(second._id), includeInactive: "true" } });
  assert.equal(list.body.pagination.total, 2);
  assert.ok(list.body.users.every(c => c.lastAssignment.actorName === operator.fullName));
  assert.ok(list.body.users.every(c => c.walletBalance === undefined));
  const unassigned = await invoke(assignment.listUsers, { query: { role: "CUSTOMER", assignment: "UNASSIGNED", includeInactive: "true" } });
  assert.equal(unassigned.body.pagination.total, 1);
  const audits = await invoke(assignment.history, { query: { userId: String(customers[0]._id) } });
  assert.equal(audits.body.records.length, 1);
  assert.equal(String(audits.body.records[0].actorId), String(operator._id));
  const workspace = require("../services/managementWorkspace.service");
  assert.equal((await workspace.customerList(first)).total, 0);
  assert.equal((await workspace.customerList(second)).total, 2);
  assert.equal((await workspace.customerList(state)).total, 2);
  await assert.rejects(workspace.customerDetail(first, String(customers[2]._id)), /not found/i);
  const moved = await workspace.customerDetail(second, String(customers[2]._id));
  assert.equal(moved.transactions.total, 0, "new Aggregator must not inherit the old Aggregator's transaction custody");
  // Exercise the actual HTTP router, JWT authentication and assigned-role guard.
  const express = require("express");
  const app = express(); app.use(express.json());
  app.use("/api/admin/hierarchy", require("../routes/hierarchyAssignment.routes"));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try {
    const jwt = require("jsonwebtoken");
    const key = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "synthetic-assignment-http-only";
    try {
      const url = `http://127.0.0.1:${server.address().port}/api/admin/hierarchy/customer-assignments/bulk`;
      const headers = user => ({ "Content-Type": "application/json", Authorization: `Bearer ${jwt.sign({
        id: String(user._id), tokenVersion: user.authTokenVersion || 0,
      }, process.env.JWT_SECRET, { expiresIn: "5m" })}` });
      const denied = await fetch(url, { method: "POST", headers: headers(first), body: JSON.stringify(request.body) });
      assert.equal(denied.status, 403);
      const replayed = await fetch(url, { method: "POST", headers: headers(operator), body: JSON.stringify(request.body) });
      assert.equal(replayed.status, 200);
      assert.equal((await replayed.json()).completed, 2);
      assert.equal(await Audit.countDocuments({ action: "HIERARCHY_ASSIGNMENT_UPDATED" }), 2);
    } finally {
      if (key === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = key;
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    await Role.collection.deleteOne({ _id: permissionRole._id });
  }
});

test("bulk validation and route guards reject unauthorized, duplicate and unreviewed input", async () => {
  const body = { requestId: "validation", reason: "Approved reviewed assignment",
    parentId: String(new mongoose.Types.ObjectId()),
    customers: [{ userId: String(new mongoose.Types.ObjectId()), expectedParentId: null }] };
  for (const role of ["AGENT", "STATE_MANAGER", "ZONAL_MANAGER", "CUSTOMER", "CUSTOMER_SUPPORT", "OPERATIONS_MANAGER"]) {
    assert.equal((await invoke(assignment.assignCustomers, { user: { ...actor(), role }, body })).status, 403);
  }
  for (const customers of [[], [...body.customers, ...body.customers],
    [{ userId: body.customers[0].userId }], Array.from({ length: 51 }, () => body.customers[0])]) {
    assert.equal((await invoke(assignment.assignCustomers, { user: actor(), body: { ...body, customers } })).status, 400);
  }
  const router = require("../routes/hierarchyAssignment.routes");
  const route = router.stack.find(layer => layer.route?.path === "/customer-assignments/bulk").route;
  assert.equal(route.stack[2].name, "loadStaffRole");
  const denied = await invoke(route.stack[3].handle, { staffRole: { permissions: [] } });
  assert.equal(denied.status, 403);
});

test("customer directory filters status, assignment, literal search and pagination", async () => {
  await User.create([
    makeUser("CUSTOMER", "filter-first", { fullName: "Literal [name]", status: "ACTIVE" }),
    makeUser("CUSTOMER", "filter-second", { status: "SUSPENDED" }),
  ]);
  const list = query => invoke(assignment.listUsers, { query: { role: "CUSTOMER", includeInactive: "true", ...query } });
  assert.equal((await list({ status: "SUSPENDED" })).body.pagination.total, 1);
  assert.equal((await list({ search: "[name]" })).body.pagination.total, 1);
  assert.equal((await list({ limit: "1", page: "2" })).body.users.length, 1);
  assert.equal((await list({ assignment: "ASSIGNED" })).body.pagination.total, 0);
  assert.equal((await list({ status: "INVALID" })).status, 400);
  assert.equal((await list({ assignment: "UNASSIGNED", parentId: String(new mongoose.Types.ObjectId()) })).status, 400);
});

test("only Head Office can submit an assignment and route guard remains restrictive", async () => {
  const denied = await invoke(assignment.assign, assignmentRequest(
    { _id: new mongoose.Types.ObjectId() },
    { _id: new mongoose.Types.ObjectId() },
    "not-head-office",
    { _id: new mongoose.Types.ObjectId(), role: "ZONAL_MANAGER" },
  ));
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, "HEAD_OFFICE_REQUIRED");
  const response = {};
  await adminOnly("HEAD_OFFICE")(
    { user: { _id: new mongoose.Types.ObjectId(), role: "STATE_MANAGER" } },
    {
      status(code) { response.status = code; return this; },
      json(body) { response.body = body; return this; },
    },
    () => { response.passed = true; },
  );
  assert.equal(response.status, 403);
  assert.equal(response.passed, undefined);
});

test("a stale Head Office assignment view cannot change a reporting line", async () => {
  const [oldZonal, newZonal] = await User.create([
    makeUser("ZONAL_MANAGER", "old-view", { zone: "NORTH" }),
    makeUser("ZONAL_MANAGER", "new-view", { zone: "NORTH" }),
  ]);
  const manager = await User.create(makeUser("STATE_MANAGER", "stale-view", {
    zone: "NORTH", state: "KANO", zonalManagerId: newZonal._id,
  }));
  const request = assignmentRequest(manager, oldZonal, "stale-view-rejected");
  request.body.expectedParentId = String(newZonal._id);
  const result = await invoke(assignment.assign, request);
  assert.equal(result.status, undefined);
  assert.equal(result.body.success, true);

  const staleRequest = assignmentRequest(manager, newZonal, "stale-view-2");
  staleRequest.body.expectedParentId = String(newZonal._id);
  const stale = await invoke(assignment.assign, staleRequest);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, "HIERARCHY_PARENT_CHANGED");
  assert.equal(String((await User.findById(manager._id)).zonalManagerId), String(oldZonal._id));
  assert.equal(await Audit.countDocuments({ action: "HIERARCHY_ASSIGNMENT_UPDATED" }), 1);
});

test("State Manager reassignment cascades downline and preserves transaction snapshots", async () => {
  const [zonalA, zonalB] = await User.create([
    makeUser("ZONAL_MANAGER", "A", { zone: "NORTH" }),
    makeUser("ZONAL_MANAGER", "B", { zone: "NORTH" }),
  ]);
  const state = await User.create(makeUser("STATE_MANAGER", "A", {
    zone: "NORTH", state: "KANO", zonalManagerId: zonalA._id,
  }));
  const agent = await User.create(makeUser("AGENT", "A", {
    zone: "NORTH", state: "KANO", zonalManagerId: zonalA._id, stateManagerId: state._id,
  }));
  const [customer, directCustomer, suspendedCustomer] = await User.create([
    makeUser("CUSTOMER", "A", {
      zone: "NORTH", state: "KANO", zonalManagerId: zonalA._id,
      stateManagerId: state._id, agentId: agent._id, walletBalance: 500,
      walletHeldBalance: 40, withdrawalLockedBalance: 25, kycVerified: true,
    }),
    makeUser("CUSTOMER", "DIRECT", {
      zone: "NORTH", state: "KANO", zonalManagerId: zonalA._id, stateManagerId: state._id,
      walletBalance: 250, walletHeldBalance: 30, withdrawalLockedBalance: 15, kycVerified: true,
    }),
    makeUser("CUSTOMER", "SUSPENDED", {
      zone: "NORTH", state: "KANO", status: "SUSPENDED",
      zonalManagerId: zonalA._id, stateManagerId: state._id, agentId: agent._id,
      walletBalance: 125, walletHeldBalance: 20, withdrawalLockedBalance: 10, kycVerified: true,
    }),
  ]);
  const prior = await Transaction.create({
    reference: "SAFETY-STATE-SNAPSHOT",
    customerId: customer._id,
    serviceType: "AIRTIME",
    amount: 500,
    status: "SUCCESSFUL",
  });

  const moved = await invoke(assignment.assign, assignmentRequest(
    state, zonalB, "safety-state-move",
  ));
  assert.equal(moved.body.success, true, JSON.stringify(moved.body));
  assert.equal(moved.body.affectedCount, 5);
  for (const id of [state._id, agent._id, customer._id, directCustomer._id, suspendedCustomer._id]) {
    const saved = await User.findById(id).lean();
    assert.equal(String(saved.zonalManagerId), String(zonalB._id));
    assert.equal(saved.zone, "NORTH");
    assert.equal(saved.state, "KANO");
  }
  for (const [userId, walletBalance, walletHeldBalance, withdrawalLockedBalance] of [
    [customer._id, 500, 40, 25],
    [directCustomer._id, 250, 30, 15],
    [suspendedCustomer._id, 125, 20, 10],
  ]) {
    const saved = await User.findById(userId).lean();
    assert.equal(saved.role, "CUSTOMER");
    assert.equal(saved.walletBalance, walletBalance);
    assert.equal(saved.walletHeldBalance, walletHeldBalance);
    assert.equal(saved.withdrawalLockedBalance, withdrawalLockedBalance);
    assert.equal(saved.kycVerified, true);
  }
  assert.equal((await User.findById(state._id)).stateManagerId, null);
  assert.equal((await User.findById(agent._id)).agentId, null);
  assert.equal(String((await User.findById(customer._id)).agentId), String(agent._id));
  const unchanged = await Transaction.findById(prior._id).lean();
  assert.equal(String(unchanged.agentId), String(agent._id));
  assert.equal(String(unchanged.stateManagerId), String(state._id));
  assert.equal(String(unchanged.zonalManagerId), String(zonalA._id));
  const audit = await Audit.findOne({ action: "HIERARCHY_ASSIGNMENT_UPDATED" }).lean();
  assert.equal(audit.actorRole, "HEAD_OFFICE");
  assert.equal(audit.reason, "Approved reporting-line correction.");
  assert.equal(audit.metadata.affectedCount, 5);
});

test("Aggregator and Customer moves preserve old snapshots and capture new lineages", async () => {
  const zonal = await User.create(makeUser("ZONAL_MANAGER", "A", { zone: "NORTH" }));
  const [stateA, stateB] = await User.create([
    makeUser("STATE_MANAGER", "A", { zone: "NORTH", state: "KANO", zonalManagerId: zonal._id }),
    makeUser("STATE_MANAGER", "B", { zone: "NORTH", state: "KANO", zonalManagerId: zonal._id }),
  ]);
  const [agentA, agentB] = await User.create([
    makeUser("AGENT", "A", { zone: "NORTH", state: "KANO", zonalManagerId: zonal._id, stateManagerId: stateA._id }),
    makeUser("AGENT", "B", { zone: "NORTH", state: "KANO", zonalManagerId: zonal._id, stateManagerId: stateB._id }),
  ]);
  const customer = await User.create(makeUser("CUSTOMER", "A", {
    zone: "NORTH", state: "KANO", zonalManagerId: zonal._id,
    stateManagerId: stateA._id, agentId: agentA._id, walletBalance: 500,
    walletHeldBalance: 40, withdrawalLockedBalance: 25, kycVerified: true,
  }));
  const before = await Transaction.create({
    reference: "SAFETY-AGENT-BEFORE", customerId: customer._id,
    serviceType: "DATA", amount: 150, status: "SUCCESSFUL",
  });
  const moveAgent = await invoke(assignment.assign, assignmentRequest(
    agentA, stateB, "safety-agent-move",
  ));
  assert.equal(moveAgent.body.success, true, JSON.stringify(moveAgent.body));
  const afterAgentMove = await Transaction.create({
    reference: "SAFETY-AGENT-AFTER", customerId: customer._id,
    serviceType: "AIRTIME", amount: 200, status: "SUCCESSFUL",
  });
  assert.equal(String(afterAgentMove.stateManagerId), String(stateB._id));
  const afterAgentCustomer = await User.findById(customer._id).lean();
  assert.equal(String(afterAgentCustomer.stateManagerId), String(stateB._id));
  assert.equal(afterAgentCustomer.walletBalance, 500);
  assert.equal(afterAgentCustomer.walletHeldBalance, 40);
  assert.equal(afterAgentCustomer.withdrawalLockedBalance, 25);
  assert.equal(afterAgentCustomer.kycVerified, true);
  assert.equal(String((await Transaction.findById(before._id)).stateManagerId), String(stateA._id));

  const beforeCustomerMove = await Transaction.create({
    reference: "SAFETY-CUSTOMER-BEFORE", customerId: customer._id,
    serviceType: "AIRTIME", amount: 300, status: "SUCCESSFUL",
  });
  const moveCustomer = await invoke(assignment.assign, assignmentRequest(
    customer, agentB, "safety-customer-move",
  ));
  assert.equal(moveCustomer.body.success, true, JSON.stringify(moveCustomer.body));
  const afterCustomerMove = await User.findById(customer._id).lean();
  assert.equal(String(afterCustomerMove.agentId), String(agentB._id));
  assert.equal(afterCustomerMove.walletBalance, 500);
  assert.equal(afterCustomerMove.walletHeldBalance, 40);
  assert.equal(afterCustomerMove.withdrawalLockedBalance, 25);
  assert.equal(afterCustomerMove.kycVerified, true);
  const newLine = await Transaction.create({
    reference: "SAFETY-CUSTOMER-AFTER", customerId: customer._id,
    serviceType: "AIRTIME", amount: 225, status: "SUCCESSFUL",
  });
  assert.equal(String(newLine.agentId), String(agentB._id));
  assert.equal(String(newLine.stateManagerId), String(stateB._id));
  const reversal = await Transaction.create({
    reference: "SAFETY-REVERSAL", customerId: customer._id,
    reversedTransactionId: beforeCustomerMove._id,
    serviceType: "AIRTIME", amount: 300, status: "REFUNDED",
  });
  assert.equal(String(reversal.agentId), String(agentA._id));
  assert.equal(String(reversal.stateManagerId), String(stateB._id));
  assert.ok(reversal.hierarchyCapturedAt);
});

test("legacy unattributed history prevents reassignment without audit or mutation", async () => {
  const [zonalA, zonalB] = await User.create([
    makeUser("ZONAL_MANAGER", "A", { zone: "NORTH" }),
    makeUser("ZONAL_MANAGER", "B", { zone: "NORTH" }),
  ]);
  const state = await User.create(makeUser("STATE_MANAGER", "A", {
    zone: "NORTH", state: "KANO", zonalManagerId: zonalA._id,
  }));
  const customer = await User.create(makeUser("CUSTOMER", "A", {
    zone: "NORTH", state: "KANO", zonalManagerId: zonalA._id, stateManagerId: state._id,
  }));
  await Transaction.collection.insertOne({
    reference: "SAFETY-LEGACY-UNCAPTURED",
    customerId: customer._id,
    serviceType: "AIRTIME",
    amount: 50,
    status: "SUCCESSFUL",
    createdAt: new Date(),
  });
  const result = await invoke(assignment.assign, assignmentRequest(
    state, zonalB, "safety-legacy-move",
  ));
  assert.equal(result.status, 409);
  assert.equal(result.body.code, "HIERARCHY_HISTORY_UNVERIFIED");
  assert.equal(String((await User.findById(state._id)).zonalManagerId), String(zonalA._id));
  assert.equal(await Audit.countDocuments({ action: "HIERARCHY_ASSIGNMENT_UPDATED" }), 0);
});

test("invalid ancestry, cross-zone and cross-state moves are rejected", async () => {
  const [zonalA, zonalB] = await User.create([
    makeUser("ZONAL_MANAGER", "A", { zone: "NORTH" }),
    makeUser("ZONAL_MANAGER", "B", { zone: "SOUTH" }),
  ]);
  const [stateA, stateB] = await User.create([
    makeUser("STATE_MANAGER", "A", { zone: "NORTH", state: "KANO", zonalManagerId: zonalA._id }),
    makeUser("STATE_MANAGER", "B", { zone: "NORTH", state: "KADUNA", zonalManagerId: zonalA._id }),
  ]);
  const agent = await User.create(makeUser("AGENT", "A", {
    zone: "NORTH", state: "KANO", zonalManagerId: zonalA._id, stateManagerId: stateA._id,
  }));
  const crossZone = await invoke(assignment.assign, assignmentRequest(
    stateA, zonalB, "safety-cross-zone",
  ));
  assert.equal(crossZone.status, 409);
  assert.equal(crossZone.body.code, "HIERARCHY_CROSS_ZONE");
  const crossState = await invoke(assignment.assign, assignmentRequest(
    agent, stateB, "safety-cross-state",
  ));
  assert.equal(crossState.status, 409);
  assert.equal(crossState.body.code, "HIERARCHY_CROSS_STATE");
  assert.equal(await Audit.countDocuments({ action: "HIERARCHY_ASSIGNMENT_UPDATED" }), 0);
});
test("Head Office can reassign a Customer across zones without moving financial history or referral attribution", async () => {
  const [za, zb] = await User.create([
    makeUser("ZONAL_MANAGER", "cross-customer-a", { zone: "NORTH" }),
    makeUser("ZONAL_MANAGER", "cross-customer-b", { zone: "SOUTH" }),
  ]);
  const [sa, sb] = await User.create([
    makeUser("STATE_MANAGER", "cross-customer-a", { zone: "NORTH", state: "KANO", zonalManagerId: za._id }),
    makeUser("STATE_MANAGER", "cross-customer-b", { zone: "SOUTH", state: "LAGOS", zonalManagerId: zb._id }),
  ]);
  const [aa, ab] = await User.create([
    makeUser("AGENT", "cross-customer-a", { zone: "NORTH", state: "KANO", stateManagerId: sa._id, zonalManagerId: za._id }),
    makeUser("AGENT", "cross-customer-b", { zone: "SOUTH", state: "LAGOS", stateManagerId: sb._id, zonalManagerId: zb._id }),
  ]);
  const customer = await User.create(makeUser("CUSTOMER", "cross-customer", {
    zone: "NORTH", state: "KANO", agentId: aa._id, stateManagerId: sa._id, zonalManagerId: za._id, walletBalance: 7500,
  }));
  await User.collection.updateOne({ _id: customer._id }, { $set: {
    referralCode: "LOCAL-CROSS-REFERRAL", referredBy: aa._id,
  } });
  const transaction = { _id: new mongoose.Types.ObjectId(), customerId: customer._id,
    reference: "cross-customer-history", amount: 100, status: "SUCCESSFUL",
    agentId: aa._id, stateManagerId: sa._id, zonalManagerId: za._id, hierarchyCapturedAt: new Date() };
  await Transaction.collection.insertOne(transaction);
  const before = await Transaction.findById(transaction._id).lean();
  const request = assignmentRequest(customer, ab, "cross-customer-safe");
  request.body.expectedParentId = String(aa._id);
  const moved = await invoke(assignment.assign, request);
  assert.equal(moved.body.success, true);
  const after = await User.findById(customer._id).lean();
  assert.equal(String(after.agentId), String(ab._id));
  assert.equal(after.zone, "SOUTH"); assert.equal(after.state, "LAGOS");
  assert.equal(after.walletBalance, 7500);
  assert.equal(after.referralCode, "LOCAL-CROSS-REFERRAL");
  assert.equal(String(after.referredBy), String(aa._id));
  assert.deepEqual(await Transaction.findById(transaction._id).lean(), before);
  const audit = await Audit.findOne({ "metadata.hierarchyRequestId": "cross-customer-safe" }).lean();
  assert.equal(audit.previousData.hierarchy.zone, "NORTH");
  assert.equal(audit.newData.hierarchy.zone, "SOUTH");
  const retry = await invoke(assignment.assign, request);
  assert.equal(retry.body.duplicate, true);
  assert.equal(await Audit.countDocuments({ "metadata.hierarchyRequestId": "cross-customer-safe" }), 1);
});

test("concurrent customer moves with one expected parent commit only one winner", async () => {
  const zonal = await User.create(makeUser("ZONAL_MANAGER", "A", { zone: "NORTH" }));
  const [stateA, stateB] = await User.create([
    makeUser("STATE_MANAGER", "A", { zone: "NORTH", state: "KANO", zonalManagerId: zonal._id }),
    makeUser("STATE_MANAGER", "B", { zone: "NORTH", state: "KANO", zonalManagerId: zonal._id }),
  ]);
  const [agentA, agentB, agentC] = await User.create([
    makeUser("AGENT", "A", { zone: "NORTH", state: "KANO", zonalManagerId: zonal._id, stateManagerId: stateA._id }),
    makeUser("AGENT", "B", { zone: "NORTH", state: "KANO", zonalManagerId: zonal._id, stateManagerId: stateB._id }),
    makeUser("AGENT", "C", { zone: "NORTH", state: "KANO", zonalManagerId: zonal._id, stateManagerId: stateB._id }),
  ]);
  const customer = await User.create(makeUser("CUSTOMER", "A", {
    zone: "NORTH", state: "KANO", zonalManagerId: zonal._id,
    stateManagerId: stateA._id, agentId: agentA._id,
  }));
  const originalFindOne = User.findOne;
  let expectedParentReads = 0;
  let releaseReads;
  const bothReadExpectedParent = new Promise((resolve) => { releaseReads = resolve; });
  User.findOne = function (filter, ...args) {
    const query = originalFindOne.call(this, filter, ...args);
    let isAssignmentSnapshotRead = false;
    const originalSelect = query.select.bind(query);
    query.select = (projection, ...selectArgs) => {
      isAssignmentSnapshotRead = projection === "_id role zonalManagerId stateManagerId agentId";
      return originalSelect(projection, ...selectArgs);
    };
    const originalLean = query.lean.bind(query);
    query.lean = async (...leanArgs) => {
      const result = await originalLean(...leanArgs);
      if (isAssignmentSnapshotRead && String(filter?._id) === String(customer._id)) {
        expectedParentReads += 1;
        if (expectedParentReads === 2) releaseReads();
        await bothReadExpectedParent;
      }
      return result;
    };
    return query;
  };
  let responses;
  try {
    responses = await Promise.all([
      invoke(assignment.assign, assignmentRequest(customer, agentB, "safety-race-move-b")),
      invoke(assignment.assign, assignmentRequest(customer, agentC, "safety-race-move-c")),
    ]);
  } finally {
    User.findOne = originalFindOne;
  }
  assert.equal(responses.filter((result) => result.body?.success === true).length, 1, JSON.stringify(responses));
  assert.equal(responses.filter((result) => result.status === 409).length, 1, JSON.stringify(responses));
  assert.equal(await Audit.countDocuments({ action: "HIERARCHY_ASSIGNMENT_UPDATED" }), 1);
  const saved = await User.findById(customer._id).lean();
  assert.ok([String(agentB._id), String(agentC._id)].includes(String(saved.agentId)));
  assert.equal(
    String(saved.stateManagerId),
    String(stateB._id),
  );
});

test("reassigning through a destination parent serializes with moving that parent", async () => {
  const [zonalA, zonalB] = await User.create([
    makeUser("ZONAL_MANAGER", "A", { zone: "NORTH" }),
    makeUser("ZONAL_MANAGER", "B", { zone: "NORTH" }),
  ]);
  const [sourceState, destinationState] = await User.create([
    makeUser("STATE_MANAGER", "SOURCE", { zone: "NORTH", state: "KANO", zonalManagerId: zonalA._id }),
    makeUser("STATE_MANAGER", "DESTINATION", { zone: "NORTH", state: "KANO", zonalManagerId: zonalA._id }),
  ]);
  const agent = await User.create(makeUser("AGENT", "A", {
    zone: "NORTH", state: "KANO", zonalManagerId: zonalA._id, stateManagerId: sourceState._id,
  }));
  const [agentMove, destinationMove] = await Promise.all([
    invoke(assignment.assign, assignmentRequest(
      agent, destinationState, "safety-destination-agent-move",
    )),
    invoke(assignment.assign, assignmentRequest(
      destinationState, zonalB, "safety-destination-parent-move",
    )),
  ]);
  assert.ok([undefined, 409].includes(agentMove.status), JSON.stringify(agentMove));
  assert.ok([undefined, 409].includes(destinationMove.status), JSON.stringify(destinationMove));
  const savedAgent = await User.findById(agent._id).lean();
  const savedParent = await User.findById(savedAgent.stateManagerId).lean();
  assert.equal(String(savedAgent.zonalManagerId), String(savedParent.zonalManagerId));
});