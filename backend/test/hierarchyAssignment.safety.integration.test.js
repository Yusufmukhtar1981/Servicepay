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
      stateManagerId: state._id, agentId: agent._id,
    }),
    makeUser("CUSTOMER", "DIRECT", {
      zone: "NORTH", state: "KANO", zonalManagerId: zonalA._id, stateManagerId: state._id,
    }),
    makeUser("CUSTOMER", "SUSPENDED", {
      zone: "NORTH", state: "KANO", status: "SUSPENDED",
      zonalManagerId: zonalA._id, stateManagerId: state._id, agentId: agent._id,
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
    stateManagerId: stateA._id, agentId: agentA._id,
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
  assert.equal(String((await User.findById(customer._id)).stateManagerId), String(stateB._id));
  assert.equal(String((await Transaction.findById(before._id)).stateManagerId), String(stateA._id));

  const beforeCustomerMove = await Transaction.create({
    reference: "SAFETY-CUSTOMER-BEFORE", customerId: customer._id,
    serviceType: "AIRTIME", amount: 300, status: "SUCCESSFUL",
  });
  const moveCustomer = await invoke(assignment.assign, assignmentRequest(
    customer, agentB, "safety-customer-move",
  ));
  assert.equal(moveCustomer.body.success, true, JSON.stringify(moveCustomer.body));
  assert.equal(String((await User.findById(customer._id)).agentId), String(agentB._id));
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