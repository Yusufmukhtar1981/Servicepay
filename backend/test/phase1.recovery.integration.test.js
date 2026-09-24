const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const User = require("../models/user.model");
const LedgerEntry = require("../models/ledgerEntry.model");
const AdminAuditLog = require("../models/adminAuditLog.model");
const { createZonalManager, promoteRoleUser } = require("../controllers/adminRoleUsers.controller");
const { adjustCustomerWallet } = require("../controllers/adminWalletAdjustment.controller");

let mongo;
const admin = { _id: new mongoose.Types.ObjectId(), role: "HEAD_OFFICE", fullName: "Test Head Office" };
const response = () => {
  const result = {};
  return {
    result,
    res: { status(code) { result.status = code; return this; }, json(body) { result.body = body; return this; } },
  };
};

test.before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(mongo.getUri(), { dbName: "phase1-recovery" });
  await Promise.all([User.init(), LedgerEntry.init(), AdminAuditLog.init()]);
});
test.after(async () => { await mongoose.disconnect(); await mongo.stop(); });
test.beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    LedgerEntry.collection.deleteMany({}),
    AdminAuditLog.collection.deleteMany({}),
  ]);
});

test("Head Office creates a canonical Zonal Manager and promotion preserves identity", async () => {
  const out = response();
  await createZonalManager({
    user: admin, body: { fullName: "Zone One", phone: "08012345678", email: "zone@test.local", password: "secret123", zone: "NORTH" },
    method: "POST", originalUrl: "/api/admin/role-users/zonal-managers",
  }, out.res);
  assert.equal(out.result.status, 201);
  const zonal = await User.findOne({ phone: "08012345678" });
  assert.equal(zonal.role, "ZONAL_MANAGER");
  const state = await User.create({ fullName: "State", phone: "08012345679", email: "state@test.local", password: "secret123", role: "STATE_MANAGER", status: "ACTIVE", zonalManagerId: zonal._id, zone: "NORTH" });
  const agent = await User.create({ fullName: "Agent", phone: "08012345680", email: "agent@test.local", password: "secret123", role: "AGENT", status: "ACTIVE", stateManagerId: state._id, zone: "NORTH" });
  const customer = await User.create({ fullName: "Customer", phone: "08012345681", email: "customer@test.local", password: "secret123", role: "CUSTOMER", status: "ACTIVE", agentId: agent._id, walletBalance: 50 });
  const promotion = response();
  await promoteRoleUser({ user: admin, params: { userId: agent._id }, body: { targetRole: "STATE_MANAGER" }, method: "POST", originalUrl: "/api/admin/role-users/" + agent._id + "/promote" }, promotion.res);
  assert.equal(promotion.result.status, undefined);
  assert.equal((await User.findById(agent._id)).role, "STATE_MANAGER");
  assert.equal((await User.findById(customer._id)).stateManagerId.toString(), agent._id.toString());
});

test("wallet adjustment posts immutable ledger, audit, and idempotent replay", async () => {
  const customer = await User.create({ fullName: "Wallet Customer", phone: "08012345682", email: "wallet@test.local", password: "secret123", role: "CUSTOMER", status: "ACTIVE", walletBalance: 100 });
  const body = { identifier: customer.phone, action: "DEBIT", amount: 40, reason: "Correction", reference: "ADJ-PHASE1-1", idempotencyKey: "ADJ-KEY-PHASE1-1" };
  const first = response();
  await adjustCustomerWallet({ user: admin, body, get(name) { return name === "Idempotency-Key" ? body.idempotencyKey : undefined; }, method: "POST", originalUrl: "/api/admin/wallet-adjustment" }, first.res);
  assert.equal(first.result.status, 200);
  assert.equal((await User.findById(customer._id)).walletBalance, 60);
  assert.equal(await LedgerEntry.countDocuments({ idempotencyKey: body.idempotencyKey }), 1);
  const replay = response();
  await adjustCustomerWallet({ user: admin, body, get(name) { return name === "Idempotency-Key" ? body.idempotencyKey : undefined; }, method: "POST", originalUrl: "/api/admin/wallet-adjustment" }, replay.res);
  assert.equal(replay.result.status, 200);
  assert.equal(replay.result.body.duplicate, true);
  assert.equal((await User.findById(customer._id)).walletBalance, 60);
  assert.equal(await AdminAuditLog.countDocuments({ action: "WALLET_DEBITED" }), 1);
  const insufficient = response();
  await adjustCustomerWallet({
    user: admin,
    body: { ...body, amount: 1000, reference: "ADJ-PHASE1-2", idempotencyKey: "ADJ-KEY-PHASE1-2" },
    get(name) { return name === "Idempotency-Key" ? "ADJ-KEY-PHASE1-2" : undefined; },
    method: "POST", originalUrl: "/api/admin/wallet-adjustment",
  }, insufficient.res);
  assert.equal(insufficient.result.status, 400);
  assert.equal((await User.findById(customer._id)).walletBalance, 60);
});