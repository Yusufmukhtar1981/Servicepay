const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const managementRoutes = require("../routes/management.routes");
const adminRoleUsersRoutes = require("../routes/adminRoleUsers.routes");
const adminController = require("../controllers/admin.controller");
const { protect, adminOnly } = require("../middleware/auth.middleware");
const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const Role = require("../models/role.model");
const { STAFF_PERMISSIONS } = require("../config/staffPermissions");

let replicaSet;
let server;
let baseUrl;
let nextUser = 0;
let hierarchyStaffRoleId;

const createUser = async (role, overrides = {}) => {
  nextUser += 1;
  return User.create({
    fullName: `${role} ${nextUser}`,
    phone: `080${String(nextUser).padStart(8, "0")}`,
    email: `${role.toLowerCase()}-${nextUser}@management.test`,
    password: "password123",
    role,
    status: "ACTIVE",
    ...(role === "HEAD_OFFICE" ? { staffRoleId: hierarchyStaffRoleId } : {}),
    ...overrides,
  });
};

const request = async ({ method = "GET", path, actor, body }) => {
  const headers = { Accept: "application/json" };
  if (actor) {
    headers.Authorization = `Bearer ${jwt.sign(
      { id: String(actor._id) },
      process.env.JWT_SECRET,
    )}`;
  }
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

test.before(async () => {
  process.env.JWT_SECRET = "management-creation-test-secret";
  replicaSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  await mongoose.connect(replicaSet.getUri(), {
    dbName: "management-creation-tests",
  });
  await Promise.all([User.init(), Transaction.init(), Role.init()]);
  hierarchyStaffRoleId = (await Role.create({
    name: "HIERARCHY_TEST_ADMIN",
    displayName: "Hierarchy test admin",
    department: "ADMINISTRATION",
    permissions: [STAFF_PERMISSIONS.HIERARCHY_MANAGE],
  }))._id;
  const app = express();
  app.use(express.json());
  app.use("/api/management", managementRoutes);
  app.use("/api/admin/role-users", adminRoleUsersRoutes);
  app.post(
    "/api/admin/users",
    protect,
    adminOnly("HEAD_OFFICE", "ZONAL_MANAGER", "STATE_MANAGER"),
    adminController.createAdminUser,
  );
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  if (server) {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
  await mongoose.disconnect();
  if (replicaSet) await replicaSet.stop();
});

test.beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Transaction.deleteMany({})]);
  nextUser = 0;
});

test("parent roles create trusted State Manager, Aggregator, and Customer lineage", async () => {
  const zonal = await createUser("ZONAL_MANAGER", { zone: "South West" });
  const otherZonal = await createUser("ZONAL_MANAGER", { zone: "North Central" });
  const stateResponse = await request({
    method: "POST",
    path: "/api/management/state-managers",
    actor: zonal,
    body: {
      fullName: "Scoped State Manager",
      phone: "08055500001",
      email: "state-manager@management.test",
      password: "password123",
      state: "Lagos",
      zone: "North Central",
      role: "HEAD_OFFICE",
      zonalManagerId: String(otherZonal._id),
    },
  });
  assert.equal(stateResponse.status, 201, JSON.stringify(stateResponse.body));
  const state = await User.findOne({ phone: "08055500001" });
  assert.equal(state.role, "STATE_MANAGER");
  assert.equal(state.zone, "South West");
  assert.equal(state.state, "Lagos");
  assert.equal(String(state.zonalManagerId), String(zonal._id));
  assert.equal(state.stateManagerId, null);
  assert.equal(state.agentId, null);

  const unrelatedState = await createUser("STATE_MANAGER", {
    zone: "North Central", state: "Kano", zonalManagerId: otherZonal._id,
  });
  const agentResponse = await request({
    method: "POST",
    path: "/api/management/aggregators",
    actor: state,
    body: {
      fullName: "Scoped Aggregator", phone: "08055500002",
      email: "aggregator@management.test", password: "password123", lga: "Ikeja",
      role: "HEAD_OFFICE", zone: "North Central", state: "Kano",
      zonalManagerId: String(otherZonal._id), stateManagerId: String(unrelatedState._id),
      agentId: String(unrelatedState._id),
    },
  });
  assert.equal(agentResponse.status, 201, JSON.stringify(agentResponse.body));
  const agent = await User.findOne({ phone: "08055500002" });
  assert.equal(agentResponse.body.agent.role, "AGENT");
  assert.equal(agent.zone, "South West");
  assert.equal(agent.state, "Lagos");
  assert.equal(String(agent.zonalManagerId), String(zonal._id));
  assert.equal(String(agent.stateManagerId), String(state._id));
  assert.equal(agent.agentId, null);

  const customerResponse = await request({
    method: "POST",
    path: "/api/management/customers",
    actor: agent,
    body: {
      fullName: "Scoped Customer", phone: "08055500003",
      email: "customer@management.test", password: "password123", lga: "Ikeja",
      role: "ZONAL_MANAGER", zone: "North Central", state: "Kano",
      zonalManagerId: String(otherZonal._id), stateManagerId: String(unrelatedState._id),
      agentId: String(unrelatedState._id),
    },
  });
  assert.equal(customerResponse.status, 201, JSON.stringify(customerResponse.body));
  const customer = await User.findOne({ phone: "08055500003" });
  assert.equal(customer.role, "CUSTOMER");
  assert.equal(customer.zone, "South West");
  assert.equal(customer.state, "Lagos");
  assert.equal(String(customer.zonalManagerId), String(zonal._id));
  assert.equal(String(customer.stateManagerId), String(state._id));
  assert.equal(String(customer.agentId), String(agent._id));
  assert.equal(customer.walletBalance, 0);
});

test("creation endpoints reject wrong roles and unauthenticated callers", async () => {
  const zonal = await createUser("ZONAL_MANAGER", { zone: "South West" });
  const state = await createUser("STATE_MANAGER");
  const agent = await createUser("AGENT");
  const customer = await createUser("CUSTOMER");
  const body = {
    fullName: "Unauthorized Child", phone: "08055500010",
    password: "password123", state: "Lagos",
  };
  for (const [path, actor] of [
    ["/api/management/state-managers", customer],
    ["/api/management/aggregators", zonal],
    ["/api/management/customers", state],
  ]) {
    const response = await request({ method: "POST", path, actor, body });
    assert.equal(response.status, 403, JSON.stringify(response.body));
    assert.equal(response.body.success, false);
  }
  const unauthenticated = await request({
    method: "POST", path: "/api/management/customers", body,
  });
  assert.equal(unauthenticated.status, 401);
  assert.equal(agent.role, "AGENT");
  assert.equal(await User.countDocuments({ phone: "08055500010" }), 0);
});

test("admin managed-account creation uses the validated parent fence", async () => {
  const zonal = await createUser("ZONAL_MANAGER", { zone: "North" });
  const state = await createUser("STATE_MANAGER", {
    zone: "North", state: "Lagos", zonalManagerId: zonal._id,
  });
  const headOffice = await createUser("HEAD_OFFICE");
  const response = await request({
    method: "POST",
    path: "/api/admin/users",
    actor: headOffice,
    body: {
      fullName: "Admin Created Aggregator", phone: "08055500030",
      password: "password123", role: "AGENT",
      stateManagerId: String(state._id), lga: "Ikeja",
    },
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const created = await User.findOne({ phone: "08055500030" }).lean();
  assert.equal(created.zone, "North");
  assert.equal(created.state, "Lagos");
  assert.equal(String(created.zonalManagerId), String(zonal._id));
  assert.equal(String(created.stateManagerId), String(state._id));
});

test("child creation rejects inactive and incoherent ancestry", async () => {
  const deletedZonal = await createUser("ZONAL_MANAGER", {
    zone: "North", isDeleted: true,
  });
  const deletedAncestorManager = await createUser("STATE_MANAGER", {
    zone: "North", state: "Lagos", zonalManagerId: deletedZonal._id,
  });
  const inactive = await request({
    method: "POST",
    path: "/api/management/aggregators",
    actor: deletedAncestorManager,
    body: { fullName: "Must Not Create", phone: "08055500031", password: "password123" },
  });
  assert.equal(inactive.status, 409);
  assert.equal(inactive.body.code, "HIERARCHY_PARENT_INVALID");
  assert.equal(await User.countDocuments({ role: "AGENT" }), 0);

  const broken = await createUser("STATE_MANAGER", {
    zone: "North", state: "Lagos", zonalManagerId: new mongoose.Types.ObjectId(),
  });
  const invalid = await request({
    method: "POST",
    path: "/api/management/aggregators",
    actor: broken,
    body: { fullName: "Must Not Create", phone: "08055500032", password: "password123" },
  });
  assert.equal(invalid.status, 409);
  assert.equal(invalid.body.code, "HIERARCHY_PARENT_INVALID");
  assert.equal(await User.countDocuments({ role: "AGENT" }), 0);
});

test("all child creation flows preserve duplicate phone and email conflicts", async () => {
  const zonal = await createUser("ZONAL_MANAGER", { zone: "South West" });
  const state = await createUser("STATE_MANAGER", {
    zone: "South West", state: "Lagos", zonalManagerId: zonal._id,
  });
  const agent = await createUser("AGENT", {
    zone: "South West", state: "Lagos", zonalManagerId: zonal._id, stateManagerId: state._id,
  });
  await createUser("CUSTOMER", {
    phone: "08055500020", email: "already-used@management.test",
  });
  const cases = [
    {
      path: "/api/management/state-managers", actor: zonal,
      body: { fullName: "Duplicate phone", phone: "08055500020", state: "Lagos", password: "password123" },
    },
    {
      path: "/api/management/aggregators", actor: state,
      body: { fullName: "Duplicate email", phone: "08055500021", email: "already-used@management.test", password: "password123" },
    },
    {
      path: "/api/management/customers", actor: agent,
      body: { fullName: "Duplicate phone", phone: "08055500020", password: "password123" },
    },
  ];
  for (const item of cases) {
    const response = await request({ method: "POST", ...item });
    assert.equal(response.status, 409, JSON.stringify(response.body));
    assert.equal(response.body.success, false);
    assert.match(response.body.message, /already exists/i);
  }
  assert.equal(await User.countDocuments({}), 4);
});

test("manager child creation serializes with a concurrent parent reassignment", async () => {
  const [zonalA, zonalB] = await Promise.all([
    createUser("ZONAL_MANAGER", { zone: "North" }),
    createUser("ZONAL_MANAGER", { zone: "North" }),
  ]);
  const state = await createUser("STATE_MANAGER", {
    zone: "North", state: "Lagos", zonalManagerId: zonalA._id,
  });
  const headOffice = await createUser("HEAD_OFFICE");
  let enteredResolve;
  let releaseResolve;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  let moveAttemptResolve;
  const moveAttempted = new Promise((resolve) => { moveAttemptResolve = resolve; });
  const hold = new Promise((resolve) => { releaseResolve = resolve; });
  const originalSave = User.prototype.save;
  const originalUpdateOne = User.updateOne;
  User.prototype.save = async function (...args) {
    if (this.role === "AGENT" && this.fullName === "Racing Agent") {
      enteredResolve();
      await hold;
    }
    return originalSave.apply(this, args);
  };
  let creationPaused = false;
  User.updateOne = function (filter, update, ...args) {
    if (creationPaused && update?.$inc?.hierarchyVersion === 1) moveAttemptResolve();
    return originalUpdateOne.call(this, filter, update, ...args);
  };
  let createResponse;
  let moveResponse;
  try {
    const createPromise = request({
      method: "POST",
      path: "/api/management/aggregators",
      actor: state,
      body: { fullName: "Racing Agent", phone: "08055500101", password: "password123" },
    });
    await entered;
    const movePromise = request({
      method: "PATCH",
      path: "/api/admin/role-users/hierarchy-assignments",
      actor: headOffice,
      body: {
        userId: String(state._id), parentId: String(zonalB._id),
        requestId: "management-race-state-move", reason: "Concurrent create/move fence test.",
      },
    });
    creationPaused = true;
    await moveAttempted;
    releaseResolve();
    [createResponse, moveResponse] = await Promise.all([createPromise, movePromise]);
  } finally {
    releaseResolve();
    User.prototype.save = originalSave;
    User.updateOne = originalUpdateOne;
  }
  assert.equal(createResponse.status, 201, JSON.stringify(createResponse.body));
  assert.equal(moveResponse.status, 200, JSON.stringify(moveResponse.body));
  const created = await User.findOne({ phone: "08055500101" }).lean();
  assert.equal(String(created.stateManagerId), String(state._id));
  assert.equal(String(created.zonalManagerId), String(zonalB._id));
});

test("customer creation serializes with a concurrent Aggregator move", async () => {
  const zonal = await createUser("ZONAL_MANAGER", { zone: "North" });
  const [sourceState, destinationState] = await Promise.all([
    createUser("STATE_MANAGER", { zone: "North", state: "Lagos", zonalManagerId: zonal._id }),
    createUser("STATE_MANAGER", { zone: "North", state: "Lagos", zonalManagerId: zonal._id }),
  ]);
  const agent = await createUser("AGENT", {
    zone: "North", state: "Lagos", zonalManagerId: zonal._id, stateManagerId: sourceState._id,
  });
  const headOffice = await createUser("HEAD_OFFICE");
  let enteredResolve;
  let releaseResolve;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  let moveAttemptResolve;
  const moveAttempted = new Promise((resolve) => { moveAttemptResolve = resolve; });
  const hold = new Promise((resolve) => { releaseResolve = resolve; });
  const originalSave = User.prototype.save;
  const originalUpdateOne = User.updateOne;
  User.prototype.save = async function (...args) {
    if (this.role === "CUSTOMER" && this.fullName === "Racing Customer") {
      enteredResolve();
      await hold;
    }
    return originalSave.apply(this, args);
  };
  let creationPaused = false;
  User.updateOne = function (filter, update, ...args) {
    if (creationPaused && update?.$inc?.hierarchyVersion === 1) moveAttemptResolve();
    return originalUpdateOne.call(this, filter, update, ...args);
  };
  let createResponse;
  let moveResponse;
  try {
    const createPromise = request({
      method: "POST",
      path: "/api/management/customers",
      actor: agent,
      body: { fullName: "Racing Customer", phone: "08055500102", password: "password123" },
    });
    await entered;
    const movePromise = request({
      method: "PATCH",
      path: "/api/admin/role-users/hierarchy-assignments",
      actor: headOffice,
      body: {
        userId: String(agent._id), parentId: String(destinationState._id),
        requestId: "management-race-agent-move", reason: "Concurrent Aggregator move fence test.",
      },
    });
    creationPaused = true;
    await moveAttempted;
    releaseResolve();
    [createResponse, moveResponse] = await Promise.all([createPromise, movePromise]);
  } finally {
    releaseResolve();
    User.prototype.save = originalSave;
    User.updateOne = originalUpdateOne;
  }
  assert.equal(createResponse.status, 201, JSON.stringify(createResponse.body));
  assert.equal(moveResponse.status, 200, JSON.stringify(moveResponse.body));
  const created = await User.findOne({ phone: "08055500102" }).lean();
  assert.equal(String(created.agentId), String(agent._id));
  assert.equal(String(created.stateManagerId), String(destinationState._id));
});

test("transaction snapshot markers block customer reassignment until save completes", async () => {
  const zonal = await createUser("ZONAL_MANAGER", { zone: "North" });
  const state = await createUser("STATE_MANAGER", {
    zone: "North", state: "Lagos", zonalManagerId: zonal._id,
  });
  const [sourceAgent, destinationAgent] = await Promise.all([
    createUser("AGENT", { zone: "North", state: "Lagos", zonalManagerId: zonal._id, stateManagerId: state._id }),
    createUser("AGENT", { zone: "North", state: "Lagos", zonalManagerId: zonal._id, stateManagerId: state._id }),
  ]);
  const customer = await createUser("CUSTOMER", {
    zone: "North", state: "Lagos", zonalManagerId: zonal._id,
    stateManagerId: state._id, agentId: sourceAgent._id,
  });
  const headOffice = await createUser("HEAD_OFFICE");
  let capturedResolve;
  let releaseResolve;
  const captured = new Promise((resolve) => { capturedResolve = resolve; });
  const hold = new Promise((resolve) => { releaseResolve = resolve; });
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  User.findOneAndUpdate = function (...args) {
    const query = originalFindOneAndUpdate.apply(this, args);
    if (
      String(args[0]?._id) === String(customer._id) &&
      args[1]?.$addToSet?.hierarchyCapturePending
    ) {
      const originalExec = query.exec.bind(query);
      query.exec = async (...execArgs) => {
        const result = await originalExec(...execArgs);
        capturedResolve();
        await hold;
        return result;
      };
    }
    return query;
  };
  let transaction;
  try {
    const txPromise = Transaction.create({
      reference: "MANAGEMENT-SNAPSHOT-RACE",
      customerId: customer._id,
      serviceType: "AIRTIME",
      amount: 400,
    });
    await captured;
    const blockedMove = await request({
      method: "PATCH",
      path: "/api/admin/role-users/hierarchy-assignments",
      actor: headOffice,
      body: {
        userId: String(customer._id), parentId: String(destinationAgent._id),
        requestId: "management-snapshot-race", reason: "Snapshot fence test.",
      },
    });
    assert.equal(blockedMove.status, 409);
    assert.equal(blockedMove.body.code, "HIERARCHY_TRANSACTION_IN_PROGRESS");
    releaseResolve();
    transaction = await txPromise;
  } finally {
    releaseResolve();
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }
  const moved = await request({
    method: "PATCH",
    path: "/api/admin/role-users/hierarchy-assignments",
    actor: headOffice,
    body: {
      userId: String(customer._id), parentId: String(destinationAgent._id),
      requestId: "management-snapshot-race-retry", reason: "Retry after snapshot.",
    },
  });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  const savedTransaction = await Transaction.findById(transaction._id).lean();
  assert.equal(String(savedTransaction.agentId), String(sourceAgent._id));
  assert.equal(String((await User.findById(customer._id)).agentId), String(destinationAgent._id));
});