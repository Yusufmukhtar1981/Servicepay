const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const User = require("../models/user.model");
const Audit = require("../models/adminAuditLog.model");
const assignment = require("../controllers/hierarchyAssignment.controller");
const admin = require("../controllers/admin.controller");
const promotions = require("../controllers/adminRoleUsers.controller");
const auth = require("../controllers/auth.controller");

let sequence = 0;
const makeUser = (role, fields = {}) => ({
  fullName: `${role} concurrency ${sequence}`,
  phone: `081${String(Date.now()).slice(-7)}${String(sequence++).padStart(2, "0")}`,
  email: `${role.toLowerCase()}-${sequence}@hierarchy.invalid`,
  password: "Password123!",
  role, status: "ACTIVE", ...fields,
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
const request = (body = {}) => ({
  user: { _id: new mongoose.Types.ObjectId(), role: "HEAD_OFFICE", fullName: "Test Head Office" },
  body, method: "POST", originalUrl: "/test",
});

const fixture = async () => {
  const [zonalA, zonalB, stateA, stateB, agent] = await User.create([
    makeUser("ZONAL_MANAGER", { zone: "NORTH" }),
    makeUser("ZONAL_MANAGER", { zone: "NORTH" }),
    makeUser("STATE_MANAGER", { zone: "NORTH", state: "KANO" }),
    makeUser("STATE_MANAGER", { zone: "NORTH", state: "KADUNA" }),
    makeUser("AGENT", { zone: "NORTH", state: "KANO" }),
  ]);
  await User.updateOne({ _id: stateA._id }, { $set: { zonalManagerId: zonalA._id } });
  await User.updateOne({ _id: stateB._id }, { $set: { zonalManagerId: zonalB._id } });
  await User.updateOne({ _id: agent._id }, { $set: { zonalManagerId: zonalA._id, stateManagerId: stateA._id } });
  return { zonalA, zonalB, stateA, stateB, agent };
};

const startDb = async () => {
  const mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ args: ["--nounixsocket"] }],
  });
  await mongoose.connect(mongo.getUri(), { dbName: `hierarchy_concurrency_${Date.now()}` });
  await Promise.all([User, Audit].map((model) => model.init()));
  return mongo;
};

test("create and reassignment serialize in either winner order", async (t) => {
  const mongo = await startDb();
  t.after(async () => { await mongoose.disconnect(); await mongo.stop(); });
  for (const createFirst of [true, false]) {
    await User.deleteMany({});
    const { zonalA, zonalB, stateA } = await fixture();
    const create = () => invoke(admin.createAdminUser, {
      user: { role: "HEAD_OFFICE", _id: new mongoose.Types.ObjectId() },
      body: {
        fullName: `Created state ${createFirst}`, phone: `080${Date.now()}${createFirst ? "1" : "2"}`,
        email: `created-${createFirst}@hierarchy.invalid`, password: "Password123!",
        role: "STATE_MANAGER", status: "ACTIVE", zonalManagerId: zonalA._id,
        state: "PLATEAU",
      }, method: "POST", originalUrl: "/api/admin/users",
    });
    const move = () => invoke(assignment.assign, {
      ...request({ userId: stateA._id, parentId: zonalB._id, requestId: `race-${createFirst}`, reason: "Race test." }),
    });
    const responses = createFirst ? await Promise.all([create(), move()]) : await Promise.all([move(), create()]);
    assert.ok(responses.some((response) => response.body?.success === true || response.body?.data?.user));
    const created = await User.findOne({ email: `created-${createFirst}@hierarchy.invalid` }).lean();
    const moved = await User.findById(stateA._id).lean();
    assert.equal(String(created.zonalManagerId), String(zonalA._id));
    assert.equal(String(moved.zonalManagerId), String(zonalB._id));
    assert.equal(moved.role, "STATE_MANAGER");
  }
});

test("promotion and reassignment serialize in either winner order", async (t) => {
  const mongo = await startDb();
  t.after(async () => { await mongoose.disconnect(); await mongo.stop(); });
  for (const promoteFirst of [true, false]) {
    await User.deleteMany({});
    const { zonalA, stateA, stateB, agent } = await fixture();
    const promote = () => invoke(promotions.promoteRoleUser, {
      ...request({ promotionKey: `promotion-race-${promoteFirst}`, targetRole: "STATE_MANAGER" }),
      params: { userId: agent._id },
    });
    const move = () => invoke(assignment.assign, {
      ...request({ userId: agent._id, parentId: stateB._id, requestId: `move-agent-${promoteFirst}`, reason: "Race test." }),
    });
    const responses = promoteFirst ? await Promise.all([promote(), move()]) : await Promise.all([move(), promote()]);
    assert.ok(responses.every((response) => response.status === undefined || response.status === 400 || response.status === 409));
    const result = await User.findById(agent._id).lean();
    assert.ok(["AGENT", "STATE_MANAGER"].includes(result.role));
    if (result.role === "AGENT") assert.equal(String(result.stateManagerId), String(stateB._id));
    if (result.role === "STATE_MANAGER") assert.equal(String(result.zonalManagerId), String(zonalA._id));
  }
});

test("public registration rejects spoofed and stale hierarchy parent IDs", async (t) => {
  const mongo = await startDb();
  t.after(async () => { await mongoose.disconnect(); await mongo.stop(); });
  const { zonalA, stateA, agent } = await fixture();
  const base = {
    fullName: "Spoofed Customer", phone: `080${Date.now()}99`, email: "spoof@hierarchy.invalid",
    password: "Password123!", acceptTerms: true, nin: "12345678901",
    confirmTransactionPin: "7391", transactionPin: "7391",
  };
  const spoof = await invoke(auth.registerUser, {
    body: { ...base, agentId: new mongoose.Types.ObjectId(), stateManagerId: stateA._id, zonalManagerId: zonalA._id },
  });
  assert.equal(spoof.status, 409);
  assert.equal(await User.countDocuments({ email: base.email }), 0);
  const stale = await invoke(auth.registerUser, {
    body: { ...base, email: "stale@hierarchy.invalid", phone: `080${Date.now()}98`, agentId: agent._id, stateManagerId: new mongoose.Types.ObjectId(), zonalManagerId: zonalA._id },
  });
  assert.equal(stale.status, 409, JSON.stringify(stale));
  assert.equal(await User.countDocuments({ email: "stale@hierarchy.invalid" }), 0);
});