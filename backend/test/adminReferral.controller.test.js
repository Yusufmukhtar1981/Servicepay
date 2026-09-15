const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const ReferralRewardClaim = require("../models/referralRewardClaim.model");
const ReferralRewardClawback = require("../models/referralRewardClawback.model");
const ReferralRewardReconciliation = require("../models/referralRewardReconciliation.model");
const adminReferral = require("../controllers/adminReferral.controller");
const {
  evaluateReferralReward,
  reconcileReferralReward,
} = require("../services/referralReward.service");

let replica;
let sequence = 0;

const call = (handler, query = {}, access = { isHeadOffice: true, scope: { type: "GLOBAL" } }) => {
  const req = { query, staffAccess: access };
  const result = { statusCode: 200, body: null };
  const res = {
    status(code) { result.statusCode = code; return this; },
    json(body) { result.body = body; return body; },
  };
  return Promise.resolve(handler(req, res)).then(() => result);
};

const createUser = async (overrides = {}) => {
  sequence += 1;
  return User.create({
    fullName: `Admin Referral ${sequence}`,
    phone: `081800${String(sequence).padStart(5, "0")}`,
    email: `admin-referral-${sequence}@test.invalid`,
    password: "Password123!",
    role: "CUSTOMER",
    status: "ACTIVE",
    ...overrides,
  });
};

test.before(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(replica.getUri(), { dbName: "admin-referral-tests" });
  await Promise.all([
    User,
    Transaction,
    ReferralRewardClaim,
    ReferralRewardClawback,
    ReferralRewardReconciliation,
  ].map((model) => model.init()));
});

test.after(async () => {
  await mongoose.disconnect();
  await replica.stop();
});

test.beforeEach(async () => {
  await Promise.all([
    User,
    Transaction,
    ReferralRewardClaim,
    ReferralRewardClawback,
    ReferralRewardReconciliation,
  ].map((model) => model.collection.deleteMany({})));
});

test("global Head Office auth is required and privacy-safe summary works", async () => {
  const denied = await call(adminReferral.summary, {}, { isHeadOffice: false, scope: { type: "BRANCH" } });
  assert.equal(denied.statusCode, 403);
  await createUser();
  const allowed = await call(adminReferral.summary);
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.body.success, true);
  assert.equal(allowed.body.summary.total, 0);
});

test("search uses winning category and real pagination for pending progress", async () => {
  const referrer = await createUser();
  const customer = await createUser({ referredBy: referrer._id });
  await Transaction.insertMany(Array.from({ length: 9 }, (_, index) => ({
    reference: `ADMIN-DATA-${index}`,
    customerId: customer._id,
    serviceType: "DATA",
    amount: 500,
    status: "SUCCESSFUL",
  })));
  const result = await call(adminReferral.search, { category: "DATA", page: 1, limit: 1 });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.total, 1);
  assert.equal(result.body.rows.length, 1);
  assert.equal(result.body.rows[0].category, "DATA");
  assert.equal(result.body.rows[0].progress.DATA, 9);
});

test("readiness validates actual indexes", async () => {
  const result = await call(adminReferral.readiness);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.success, true);
  assert.ok(Array.isArray(result.body.indexes.rewardClaim));
  assert.ok(result.body.required.rewardClaim[0].unique);
});

test("summary classifications use current evidence and match reward filters", async () => {
  const referrer = await createUser();
  const pending = await createUser({ referredBy: referrer._id });
  const waiting = await createUser({ referredBy: referrer._id });
  const paid = await createUser({ referredBy: referrer._id });
  const clawed = await createUser({ referredBy: referrer._id });
  const makeEvidence = (customer, prefix) => Transaction.insertMany(Array.from({ length: 10 }, (_, index) => ({
    reference: `${prefix}-${index}`,
    customerId: customer._id,
    serviceType: "DATA",
    amount: 500,
    status: "SUCCESSFUL",
  })));
  await makeEvidence(waiting, "WAITING");
  await makeEvidence(paid, "PAID");
  const clawedEvidence = await makeEvidence(clawed, "CLAWED");
  await evaluateReferralReward({ referredCustomerId: paid._id });
  await evaluateReferralReward({ referredCustomerId: clawed._id });
  await Transaction.updateOne({ _id: clawedEvidence[0]._id }, { $set: { status: "REFUNDED" } });
  await reconcileReferralReward({ referredCustomerId: clawed._id, sourceType: "DATA", sourceId: clawedEvidence[0]._id });
  const pendingJob = await evaluateReferralReward({ referredCustomerId: waiting._id });
  assert.equal(pendingJob.awarded, true);
  await ReferralRewardReconciliation.updateOne(
    { referredCustomer: waiting._id },
    {
      $set: {
        operation: "CLAWBACK",
        status: "PENDING",
        sourceType: "DATA",
        sourceId: new mongoose.Types.ObjectId(),
        key: `CLAWBACK:DATA:${new mongoose.Types.ObjectId()}`,
      },
      $setOnInsert: { referredCustomer: waiting._id },
    },
    { upsert: true }
  );
  const summary = await call(adminReferral.summary);
  assert.equal(summary.body.summary.total, 4);
  assert.equal(summary.body.summary.pending, 1);
  assert.equal(summary.body.summary.qualifiedWaiting, 0);
  assert.equal(summary.body.summary.paid, 1);
  assert.equal(summary.body.summary.pendingClawbacks, 1);
  assert.equal(summary.body.summary.clawbacks, 1);
  assert.equal(summary.body.summary.totalActiveRewardValue, 2000);
  for (const [status, expected] of [["AWARDED", 1], ["PENDING_CLAWBACK", 1], ["CLAWED_BACK", 1], ["NOT_ISSUED", 1]]) {
    const result = await call(adminReferral.search, { rewardStatus: status, page: 1, limit: 10 });
    assert.equal(result.body.total, expected, status);
    assert.ok(result.body.rows.every((row) => row.rewardStatus === status));
  }
  const qualifiedWaiting = await call(adminReferral.search, { rewardStatus: "QUALIFIED_WAITING", page: 1, limit: 10 });
  assert.equal(qualifiedWaiting.body.total, 0);
  assert.equal(pending.role, "CUSTOMER");
});