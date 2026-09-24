const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const User = require("../models/user.model");
const Audit = require("../models/adminAuditLog.model");
const controller = require("../controllers/zonalHierarchy.controller");
const management = require("../controllers/management.controller");

process.env.TMPDIR = process.env.TMPDIR || `${process.cwd()}/.tmp-mongodb`;
let mongo;

const invoke = (handler, request) => new Promise((resolve, reject) => {
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { resolve({ status: this.statusCode, body }); } };
  Promise.resolve(handler(request, response)).catch(reject);
});
const req = (user, id, body, key) => ({
  user: user.toObject ? user.toObject() : user,
  params: { id: String(id) },
  body,
  originalUrl: `/api/management/zonal/aggregators/${id}/promote`,
  method: "POST",
  get(name) { return name === "Idempotency-Key" ? key : undefined; },
});
let sequence = 0;
const account = (zone, role, parent = {}) => ({
  fullName: `${role}-${zone}-${sequence}`,
  phone: `09${String(++sequence).padStart(9, "0")}`,
  email: `${role}.${zone}.${sequence}@test.invalid`,
  password: "Password123!",
  role, zone, status: "ACTIVE", isDeleted: false, ...parent,
});

test.before(async () => {
  mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ args: ["--nounixsocket"] }],
  });
  await mongoose.connect(mongo.getUri(), { dbName: "zonal-promotion-integration" });
  await Promise.all([User, Audit].map((model) => model.init()));
});
test.after(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});
test.beforeEach(async () => {
  await User.collection.deleteMany({});
  await Audit.collection.deleteMany({});
  sequence = 0;
});

test("two-zone promotion is transactional, idempotent, and preserves identity/wallet", async () => {
  const north = await User.create(account("NORTH", "ZONAL_MANAGER"));
  const south = await User.create(account("SOUTH", "ZONAL_MANAGER"));
  const parent = await User.create(account("NORTH", "STATE_MANAGER", { state: "KADUNA", zonalManagerId: north._id }));
  const foreignParent = await User.create(account("SOUTH", "STATE_MANAGER", { state: "KADUNA", zonalManagerId: south._id }));
  const target = await User.create(account("NORTH", "AGENT", { state: "KADUNA", zonalManagerId: north._id, stateManagerId: parent._id, walletBalance: 321 }));
  const child = await User.create(account("NORTH", "CUSTOMER", { state: "KADUNA", zonalManagerId: north._id, stateManagerId: parent._id, agentId: target._id }));
  const foreign = await User.create(account("SOUTH", "AGENT", { state: "KADUNA", zonalManagerId: south._id, stateManagerId: foreignParent._id }));
  const foreignChild = await User.create(account("SOUTH", "CUSTOMER", { state: "KADUNA", zonalManagerId: south._id, stateManagerId: foreignParent._id, agentId: foreign._id }));
  const key = "zonal-integration-1";
  const first = await invoke(controller.promote, req(north, target._id, { state: "KADUNA" }, key));
  assert.equal(first.status, 200);
  const after = await User.findById(target._id).lean();
  const childAfter = await User.findById(child._id).lean();
  assert.equal(after.role, "STATE_MANAGER");
  assert.equal(after.walletBalance, 321);
  assert.equal(String(after._id), String(target._id));
  assert.equal(String(childAfter.stateManagerId), String(target._id));
  assert.equal(childAfter.agentId, null);
  assert.equal(String((await User.findById(foreignChild._id)).agentId), String(foreign._id));
  const audit = await Audit.findOne({ "metadata.promotionKey": key }).lean();
  assert.equal(audit.metadata.childCount, 1);
  assert.equal(audit.previousData.role, "AGENT");
  assert.equal(audit.newData.role, "STATE_MANAGER");
  await assert.rejects(() => Audit.updateOne({ _id: audit._id }, { $set: { reason: "tampered" } }));
  const replay = await invoke(controller.promote, req(north, target._id, { state: "KADUNA" }, key));
  assert.equal(replay.status, 200);
  assert.equal(replay.body.duplicate, undefined);
  assert.equal(await Audit.countDocuments({ "metadata.promotionKey": key }), 1);
  const concurrentTarget = await User.create(account("NORTH", "AGENT", { state: "KADUNA", zonalManagerId: north._id, stateManagerId: parent._id }));
  const concurrent = await Promise.all([
    invoke(controller.promote, req(north, concurrentTarget._id, { state: "KADUNA" }, "same-concurrent-key")),
    invoke(controller.promote, req(north, concurrentTarget._id, { state: "KADUNA" }, "same-concurrent-key")),
  ]);
  assert.equal(concurrent.filter((x) => x.status === 200).length, 2);
  assert.equal(await Audit.countDocuments({ "metadata.promotionKey": "same-concurrent-key" }), 1);
  // A foreign actor must not be able to replay a key by guessing the target id.
  const guessed = await invoke(controller.promote, req(south, target._id, { state: "KADUNA" }, key));
  assert.equal(guessed.status, 403);
});

test("audit failure rolls promotion and child reparent back", async () => {
  const north = await User.create(account("NORTH", "ZONAL_MANAGER"));
  const parent = await User.create(account("NORTH", "STATE_MANAGER", { state: "KADUNA", zonalManagerId: north._id }));
  const target = await User.create(account("NORTH", "AGENT", { state: "KADUNA", zonalManagerId: north._id, stateManagerId: parent._id, walletBalance: 777 }));
  const child = await User.create(account("NORTH", "CUSTOMER", { state: "KADUNA", zonalManagerId: north._id, stateManagerId: parent._id, agentId: target._id }));
  const originalCreate = Audit.create;
  Audit.create = async () => { throw new Error("injected audit failure"); };
  try {
    const response = await invoke(controller.promote, req(north, target._id, { state: "KADUNA" }, "rollback-key"));
    assert.equal(response.status, 500);
  } finally { Audit.create = originalCreate; }
  const unchanged = await User.findById(target._id).lean();
  const childUnchanged = await User.findById(child._id).lean();
  assert.equal(unchanged.role, "AGENT");
  assert.equal(unchanged.walletBalance, 777);
  assert.equal(String(childUnchanged.agentId), String(target._id));
  assert.equal(await Audit.countDocuments({ "metadata.promotionKey": "rollback-key" }), 0);
});

test("non-zonal actors cannot promote", async () => {
  const agent = await User.create(account("NORTH", "AGENT", { state: "KADUNA" }));
  const response = await invoke(controller.promote, req(agent, new mongoose.Types.ObjectId(), { state: "KADUNA" }, "deny-key"));
  assert.equal(response.status, 403);
});

test("concurrent customer registration and promotion never leaves an orphan", async () => {
  const north = await User.create(account("NORTH", "ZONAL_MANAGER"));
  const parent = await User.create(account("NORTH", "STATE_MANAGER", { state: "KADUNA", zonalManagerId: north._id }));
  const target = await User.create(account("NORTH", "AGENT", { state: "KADUNA", zonalManagerId: north._id, stateManagerId: parent._id }));
  const body = { fullName: "Concurrent Customer", phone: "09123456789", email: "concurrent@test.invalid", password: "Password123!", lga: "Kaduna" };
  const registration = invoke(management.createCustomer, {
    user: target.toObject(), body,
  });
  const promotion = invoke(controller.promote, req(north, target._id, { state: "KADUNA" }, "registration-race"));
  const [registered, promoted] = await Promise.all([registration, promotion]);
  assert.ok([201, 409].includes(registered.status));
  assert.equal(promoted.status, 200);
  const customer = await User.findOne({ email: body.email }).lean();
  if (customer) {
    const currentTarget = await User.findById(target._id).lean();
    assert.equal(customer.role, "CUSTOMER");
    assert.equal(String(customer.agentId || ""), "");
    assert.equal(String(customer.stateManagerId), String(currentTarget._id));
  }
});