const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const User = require("../models/user.model");
const Audit = require("../models/adminAuditLog.model");
const Transaction = require("../models/transaction.model");
const controller = require("../controllers/hierarchyAssignment.controller");
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
    user("ZONAL_MANAGER", "B", { zone: "NORTH_B" }),
    user("STATE_MANAGER", "A", { zone: "NORTH_A", state: "KANO" }),
    user("STATE_MANAGER", "B", { zone: "NORTH_B", state: "KADUNA" }),
    user("AGENT", "A", { zone: "NORTH_A", state: "KANO" }),
    user("CUSTOMER", "A", { zone: "NORTH_A", state: "KANO", walletBalance: 77, referredBy: null }),
  ]);
  await User.updateOne({ _id: stateA._id }, { $set: { zonalManagerId: zonalA._id } });
  await User.updateOne({ _id: stateB._id }, { $set: { zonalManagerId: zonalB._id } });
  await User.updateOne({ _id: agentA._id }, { $set: { zonalManagerId: zonalA._id, stateManagerId: stateA._id } });
  await User.updateOne({ _id: customerA._id }, { $set: { zonalManagerId: zonalA._id, stateManagerId: stateA._id, agentId: agentA._id } });
  await Transaction.create({
    reference: "HIERARCHY-HISTORICAL-1", customerId: customerA._id, serviceType: "AIRTIME",
    amount: 12, status: "SUCCESSFUL", agentId: agentA._id, stateManagerId: stateA._id, zonalManagerId: zonalA._id,
  });
  const actor = { _id: new mongoose.Types.ObjectId(), role: "HEAD_OFFICE", fullName: "Head Office" };

  const moveState = await invoke(controller.assign, {
    user: actor, body: { userId: stateA._id, parentId: zonalB._id, requestId: "assignment-state-a-1", reason: "Operational territory realignment." },
    method: "POST", originalUrl: "/api/admin/hierarchy/assignments",
  });
  assert.equal(moveState.status, undefined);
  assert.equal(moveState.body.success, true);
  assert.equal(moveState.body.duplicate, false);
  const movedState = await User.findById(stateA._id).lean();
  const movedAgent = await User.findById(agentA._id).lean();
  const movedCustomer = await User.findById(customerA._id).lean();
  assert.equal(movedState.role, "STATE_MANAGER");
  assert.equal(String(movedState.zonalManagerId), String(zonalB._id));
  assert.equal(String(movedAgent.zonalManagerId), String(zonalB._id));
  assert.equal(String(movedCustomer.zonalManagerId), String(zonalB._id));
  assert.equal(movedCustomer.walletBalance, 77);
  const historical = await Transaction.findOne({ reference: "HIERARCHY-HISTORICAL-1" }).lean();
  assert.equal(String(historical.agentId), String(agentA._id));
  assert.equal(String(historical.stateManagerId), String(stateA._id));
  assert.equal(String(historical.zonalManagerId), String(zonalA._id));

  const duplicate = await invoke(controller.assign, {
    user: actor, body: { userId: stateA._id, parentId: zonalB._id, requestId: "assignment-state-a-1", reason: "Replay." },
    method: "POST", originalUrl: "/api/admin/hierarchy/assignments",
  });
  assert.equal(duplicate.status, undefined);
  assert.equal(duplicate.body.duplicate, true);
  assert.equal(await Audit.countDocuments({ action: "HIERARCHY_ASSIGNMENT_UPDATED" }), 1);

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

  const agentB = await User.create(user("AGENT", "B", {
    zone: "NORTH_B", state: "KADUNA", zonalManagerId: zonalB._id, stateManagerId: stateB._id,
  }));
  const agentC = await User.create(user("AGENT", "C", {
    zone: "NORTH_B", state: "KADUNA", zonalManagerId: zonalB._id, stateManagerId: stateB._id,
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