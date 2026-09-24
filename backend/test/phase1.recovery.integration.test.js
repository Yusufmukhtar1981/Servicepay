const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const User = require("../models/user.model");
const LedgerEntry = require("../models/ledgerEntry.model");
const AdminAuditLog = require("../models/adminAuditLog.model");
const Transaction = require("../models/transaction.model");
const { createZonalManager, promoteRoleUser } = require("../controllers/adminRoleUsers.controller");
const { adjustCustomerWallet } = require("../controllers/adminWalletAdjustment.controller");
const { getDownlineTransactions, getDownlineSummary } = require("../controllers/management.controller");

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
  const promotionRequest = { user: admin, params: { userId: agent._id }, body: { targetRole: "STATE_MANAGER" }, get(name) { return name === "Idempotency-Key" ? "PROMOTE-AGENT-1" : undefined; }, method: "POST", originalUrl: "/api/admin/role-users/" + agent._id + "/promote" };
  await promoteRoleUser(promotionRequest, promotion.res);
  assert.equal(promotion.result.status, undefined);
  assert.equal((await User.findById(agent._id)).role, "STATE_MANAGER");
  assert.equal((await User.findById(agent._id)).zonalManagerId.toString(), zonal._id.toString());
  assert.equal((await User.findById(customer._id)).stateManagerId.toString(), agent._id.toString());
  const replay = response();
  await promoteRoleUser(promotionRequest, replay.res);
  assert.equal(replay.result.body.duplicate, true);
  assert.equal((await User.findById(agent._id)).walletBalance, 0);
  const statePromotion = response();
  const statePromotionRequest = {
    user: admin, params: { userId: state._id }, body: { targetRole: "ZONAL_MANAGER" },
    get(name) { return name === "Idempotency-Key" ? "PROMOTE-STATE-1" : undefined; },
    method: "POST", originalUrl: "/api/admin/role-users/" + state._id + "/promote",
  };
  await promoteRoleUser(statePromotionRequest, statePromotion.res);
  assert.equal(statePromotion.result.status, undefined);
  assert.equal((await User.findById(state._id)).role, "ZONAL_MANAGER");
  assert.equal((await User.findById(agent._id)).zonalManagerId.toString(), state._id.toString());
  const stateReplay = response();
  await promoteRoleUser(statePromotionRequest, stateReplay.res);
  assert.equal(stateReplay.result.body.duplicate, true);
  const oldManagerView = response();
  await getDownlineSummary({ user: zonal }, oldManagerView.res);
  assert.equal(oldManagerView.result.body.counts.totalDownline, 0);
  const reusedStageKey = response();
  await promoteRoleUser({
    user: admin, params: { userId: state._id }, body: { targetRole: "ZONAL_MANAGER" },
    get(name) { return name === "Idempotency-Key" ? "PROMOTE-AGENT-1" : undefined; },
  }, reusedStageKey.res);
  assert.equal(reusedStageKey.result.status, 409);
  const otherAgent = await User.create({ fullName: "Other Agent", phone: "08012345689", email: "other-agent@test.local", password: "secret123", role: "AGENT", status: "ACTIVE", stateManagerId: state._id });
  const reusedUserKey = response();
  await promoteRoleUser({
    user: admin, params: { userId: otherAgent._id }, body: { targetRole: "STATE_MANAGER" },
    get(name) { return name === "Idempotency-Key" ? "PROMOTE-AGENT-1" : undefined; },
  }, reusedUserKey.res);
  assert.equal(reusedUserKey.result.status, 409);
});

test("downline transaction totals are full, pages are deterministic, and unrelated detail is denied", async () => {
  const zonal = await User.create({ fullName: "Zonal", phone: "08012345701", email: "zonal2@test.local", password: "secret123", role: "ZONAL_MANAGER", status: "ACTIVE", zone: "WEST" });
  const state = await User.create({ fullName: "State", phone: "08012345702", email: "state2@test.local", password: "secret123", role: "STATE_MANAGER", status: "ACTIVE", zonalManagerId: zonal._id, zone: "WEST" });
  const agent = await User.create({ fullName: "Agent", phone: "08012345703", email: "agent2@test.local", password: "secret123", role: "AGENT", status: "ACTIVE", stateManagerId: state._id, zone: "WEST" });
  const customer = await User.create({ fullName: "Downline", phone: "08012345704", email: "downline@test.local", password: "secret123", role: "CUSTOMER", status: "ACTIVE", agentId: agent._id });
  const unrelated = await User.create({ fullName: "Unrelated", phone: "08012345705", email: "unrelated@test.local", password: "secret123", role: "CUSTOMER", status: "ACTIVE", agentId: new mongoose.Types.ObjectId() });
  const txs = await Transaction.create([
    { reference: "PHASE1-TX-1", customerId: customer._id, serviceType: "AIRTIME", amount: 10, status: "SUCCESSFUL" },
    { reference: "PHASE1-TX-2", customerId: customer._id, serviceType: "DATA", amount: 20, status: "SUCCESSFUL" },
    { reference: "PHASE1-TX-3", customerId: unrelated._id, serviceType: "AIRTIME", amount: 99, status: "SUCCESSFUL" },
  ]);
  const summary = response();
  await getDownlineSummary({ user: zonal }, summary.res);
  assert.equal(summary.result.body.counts.transactions, 2);
  assert.equal(summary.result.body.counts.transactionValue, 30);
  const page = response();
  await getDownlineTransactions({ user: zonal, query: { page: "2", limit: "1" }, params: {} }, page.res);
  assert.equal(page.result.body.total, 2);
  assert.equal(page.result.body.totalPages, 2);
  assert.equal(page.result.body.transactions.length, 1);
  const denied = response();
  await getDownlineTransactions({ user: zonal, query: {}, params: { transactionId: txs[2]._id.toString() } }, denied.res);
  assert.equal(denied.result.status, 404);
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
  const referenceConflict = response();
  await adjustCustomerWallet({
    user: admin,
    body: { ...body, reference: "ADJ-DIFFERENT", idempotencyKey: body.idempotencyKey },
    get(name) { return name === "Idempotency-Key" ? body.idempotencyKey : undefined; },
  }, referenceConflict.res);
  assert.equal(referenceConflict.result.status, 409);
  assert.equal(referenceConflict.result.body.code, "IDEMPOTENCY_INTENT_CONFLICT");
  const reasonConflict = response();
  await adjustCustomerWallet({
    user: admin,
    body: { ...body, reason: "Different reason", idempotencyKey: body.idempotencyKey },
    get(name) { return name === "Idempotency-Key" ? body.idempotencyKey : undefined; },
  }, reasonConflict.res);
  assert.equal(reasonConflict.result.status, 409);
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