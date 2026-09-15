const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const Delivery = require("../models/delivery.model");
const MarketplaceOrder = require("../models/marketplaceOrder.model");
const LedgerEntry = require("../models/ledgerEntry.model");
const ReferralRewardClaim = require("../models/referralRewardClaim.model");
const ReferralRewardClawback = require("../models/referralRewardClawback.model");
const ReferralRewardReconciliation = require("../models/referralRewardReconciliation.model");
const { evaluateReferralReward } = require("../services/referralReward.service");
const {
  reconcileReferralReward,
  enqueueReferralRewardEvent,
  processReferralRewardReconciliation,
  getReferralProgress,
} = require("../services/referralReward.service");

let replica;
let sequence = 0;

const createUser = async (overrides = {}) => {
  sequence += 1;
  return User.create({
    fullName: `Referral Test ${sequence}`,
    phone: `081900${String(sequence).padStart(5, "0")}`,
    email: `referral-${sequence}@test.invalid`,
    password: "Password123!",
    role: "CUSTOMER",
    status: "ACTIVE",
    walletBalance: 0,
    ...overrides,
  });
};

const models = [User, Transaction, Delivery, MarketplaceOrder, LedgerEntry, ReferralRewardClaim, ReferralRewardClawback, ReferralRewardReconciliation];

test.before(async () => {
  replica = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  await mongoose.connect(replica.getUri(), { dbName: "referral-reward-tests" });
  await Promise.all(models.map((model) => model.init()));
});

test.after(async () => {
  await mongoose.disconnect();
  await replica.stop();
});

test.beforeEach(async () => {
  await Promise.all(models.map((model) => model.collection.deleteMany({})));
});

test("requires ten qualifying records in one category and never combines categories", async () => {
  const referrer = await createUser({ walletBalance: 5 });
  const customer = await createUser({ referredBy: referrer._id });
  await Transaction.insertMany(
    Array.from({ length: 9 }, (_, index) => ({
      reference: `DATA-BELOW-${index}`,
      customerId: customer._id,
      serviceType: "DATA",
      amount: 500,
      status: "SUCCESSFUL",
    }))
  );
  await Delivery.insertMany(
    Array.from({ length: 9 }, (_, index) => ({
      customerId: customer._id,
      trackingNumber: `DELIVERY-BELOW-${index}`,
      pickupAddress: "A",
      deliveryAddress: "B",
      senderName: "Sender",
      senderPhone: "08000000000",
      receiverName: "Receiver",
      receiverPhone: "08000000001",
      packageName: "Package",
      deliveryFee: 1500,
      paymentStatus: "PAID",
      status: "DELIVERED",
    }))
  );
  const result = await evaluateReferralReward({ referredCustomerId: customer._id });
  assert.equal(result.awarded, false);
  assert.equal(await ReferralRewardClaim.countDocuments(), 0);
});

test("awards exactly once at the data threshold with deterministic evidence", async () => {
  const referrer = await createUser({ walletBalance: 10 });
  const customer = await createUser({ referredBy: referrer._id });
  await Transaction.insertMany(
    Array.from({ length: 10 }, (_, index) => ({
      reference: `DATA-QUALIFIED-${index}`,
      customerId: customer._id,
      serviceType: "DATA",
      amount: index === 0 ? 500 : 700,
      status: "SUCCESSFUL",
    }))
  );
  const attempts = await Promise.all(
    Array.from({ length: 20 }, () =>
      evaluateReferralReward({ referredCustomerId: customer._id })
    )
  );
  assert.equal(await ReferralRewardClaim.countDocuments(), 1);
  assert.equal(await Transaction.countDocuments({ serviceType: "REFERRAL_BONUS" }), 1);
  assert.equal(await LedgerEntry.countDocuments({ service: "REFERRAL_BONUS" }), 1);
  const stored = await User.findById(referrer._id);
  assert.equal(stored.walletBalance, 2010);
  assert.equal(attempts.some((result) => result.awarded), true);
  const claim = await ReferralRewardClaim.findOne();
  assert.equal(claim.evidence.length, 10);
  assert.equal(claim.evidence[0].reference, "DATA-QUALIFIED-0");
});

test("excludes failed, unpaid, refunded, and under-value records", async () => {
  const referrer = await createUser();
  const customer = await createUser({ referredBy: referrer._id });
  await Transaction.insertMany(
    Array.from({ length: 10 }, (_, index) => ({
      reference: `DATA-INVALID-${index}`,
      customerId: customer._id,
      serviceType: "DATA",
      amount: index === 0 ? 499 : 500,
      status: index === 1 ? "FAILED" : "SUCCESSFUL",
    }))
  );
  await MarketplaceOrder.insertMany(
    Array.from({ length: 10 }, (_, index) => ({
      orderReference: `ORDER-INVALID-${index}`,
      buyer: customer._id,
      items: [{ product: new mongoose.Types.ObjectId(), merchant: referrer._id, title: "Item", unitPrice: 1000, quantity: 1, lineTotal: 1000 }],
      customerName: "Customer",
      customerPhone: "08000000000",
      deliveryAddress: "Address",
      subtotal: 1000,
      totalAmount: 1000,
      paymentStatus: "REFUNDED",
      orderStatus: "DELIVERED",
      fundsStatus: "REFUNDED",
    }))
  );
  const result = await evaluateReferralReward({ referredCustomerId: customer._id });
  assert.equal(result.awarded, false);
});

test("rejects self attribution and rolls back a failed award", async () => {
  const self = await createUser();
  await User.updateOne({ _id: self._id }, { $set: { referredBy: self._id } });
  const result = await evaluateReferralReward({ referredCustomerId: self._id });
  assert.equal(result.reason, "SELF_REFERRAL");
  assert.equal(await ReferralRewardClaim.countDocuments(), 0);
});

test("awards for ten paid delivered deliveries", async () => {
  const referrer = await createUser();
  const customer = await createUser({ referredBy: referrer._id });
  await Delivery.insertMany(Array.from({ length: 10 }, (_, index) => ({
    customerId: customer._id,
    trackingNumber: `DELIVERY-QUALIFIED-${index}`,
    pickupAddress: "A",
    deliveryAddress: "B",
    senderName: "Sender",
    senderPhone: "08000000000",
    receiverName: "Receiver",
    receiverPhone: "08000000001",
    packageName: "Package",
    deliveryFee: 1500,
    paymentStatus: "PAID",
    status: "DELIVERED",
  })));
  const result = await evaluateReferralReward({ referredCustomerId: customer._id });
  assert.equal(result.awarded, true);
  assert.equal((await ReferralRewardClaim.findOne()).category, "DELIVERY");
});

test("awards Marketplace orders only at the paid delivered threshold", async () => {
  const referrer = await createUser();
  const customer = await createUser({ referredBy: referrer._id });
  await MarketplaceOrder.insertMany(Array.from({ length: 10 }, (_, index) => ({
    orderReference: `ORDER-QUALIFIED-${index}`,
    buyer: customer._id,
    items: [{ product: new mongoose.Types.ObjectId(), merchant: referrer._id, title: "Item", unitPrice: 1000, quantity: 1, lineTotal: 1000 }],
    customerName: "Customer",
    customerPhone: "08000000000",
    deliveryAddress: "Address",
    subtotal: 1000,
    totalAmount: 1000,
    paymentStatus: "PAID",
    orderStatus: "DELIVERED",
    fundsStatus: "SETTLED",
  })));
  const result = await evaluateReferralReward({ referredCustomerId: customer._id });
  assert.equal(result.awarded, true);
  assert.equal((await ReferralRewardClaim.findOne()).category, "MARKETPLACE");
});

test("does not qualify Marketplace orders below NGN 1000", async () => {
  const referrer = await createUser();
  const customer = await createUser({ referredBy: referrer._id });
  await MarketplaceOrder.insertMany(Array.from({ length: 10 }, (_, index) => ({
    orderReference: `ORDER-BELOW-${index}`,
    buyer: customer._id,
    items: [{ product: new mongoose.Types.ObjectId(), merchant: referrer._id, title: "Item", unitPrice: 999, quantity: 1, lineTotal: 999 }],
    customerName: "Customer",
    customerPhone: "08000000000",
    deliveryAddress: "Address",
    subtotal: 999,
    totalAmount: 999,
    paymentStatus: "PAID",
    orderStatus: "DELIVERED",
    fundsStatus: "SETTLED",
  })));
  const result = await evaluateReferralReward({ referredCustomerId: customer._id });
  assert.equal(result.awarded, false);
});

test("20-way award and clawback remain exactly once", async () => {
  const referrer = await createUser({ walletBalance: 0 });
  const customer = await createUser({ referredBy: referrer._id });
  const records = await Transaction.insertMany(Array.from({ length: 10 }, (_, index) => ({
    reference: `DATA-CLAWBACK-${index}`,
    customerId: customer._id,
    serviceType: "DATA",
    amount: 500,
    status: "SUCCESSFUL",
  })));
  const awards = await Promise.all(
    Array.from({ length: 20 }, () => evaluateReferralReward({ referredCustomerId: customer._id }))
  );
  assert.equal(awards.filter((result) => result.awarded && !result.duplicate).length, 1);
  assert.equal((await User.findById(referrer._id)).walletBalance, 2000);
  await Transaction.updateOne({ _id: records[0]._id }, { $set: { status: "REFUNDED" } });
  const clawbacks = await Promise.all(
    Array.from({ length: 20 }, () =>
      reconcileReferralReward({ referredCustomerId: customer._id, sourceType: "DATA", sourceId: records[0]._id })
    )
  );
  assert.equal(clawbacks.some((result) => result.clawedBack), true);
  assert.equal(await ReferralRewardClawback.countDocuments(), 1);
  assert.equal(await Transaction.countDocuments({ serviceType: "REFERRAL_BONUS_REVERSAL" }), 1);
  assert.equal(await LedgerEntry.countDocuments({ service: "REFERRAL_BONUS_REVERSAL" }), 1);
  assert.equal((await User.findById(referrer._id)).walletBalance, 0);
  const progress = await getReferralProgress(referrer._id);
  assert.equal(progress[0].qualificationStatus, "PENDING");
  assert.equal(progress[0].rewardStatus, "CLAWED_BACK");
  assert.equal(progress[0].categoryProgress.DATA, 9);
  const retry = await evaluateReferralReward({ referredCustomerId: customer._id });
  assert.equal(retry.duplicate, true);
  assert.equal(await Transaction.countDocuments({ serviceType: "REFERRAL_BONUS" }), 1);
});

test("replacement evidence preserves a reward after one source is reversed", async () => {
  const referrer = await createUser();
  const customer = await createUser({ referredBy: referrer._id });
  const records = await Transaction.insertMany(Array.from({ length: 11 }, (_, index) => ({
    reference: `DATA-REPLACEMENT-${index}`,
    customerId: customer._id,
    serviceType: "DATA",
    amount: 500,
    status: "SUCCESSFUL",
  })));
  await evaluateReferralReward({ referredCustomerId: customer._id });
  await Transaction.updateOne({ _id: records[0]._id }, { $set: { status: "REFUNDED" } });
  const result = await reconcileReferralReward({
    referredCustomerId: customer._id,
    sourceType: "DATA",
    sourceId: records[0]._id,
  });
  assert.equal(result.preserved, true);
  assert.equal(await ReferralRewardClawback.countDocuments(), 0);
});

test("insufficient clawback funds remain pending and retry after funds arrive", async () => {
  const referrer = await createUser();
  const customer = await createUser({ referredBy: referrer._id });
  const records = await Transaction.insertMany(Array.from({ length: 10 }, (_, index) => ({
    reference: `DATA-PENDING-CLAWBACK-${index}`,
    customerId: customer._id,
    serviceType: "DATA",
    amount: 500,
    status: "SUCCESSFUL",
  })));
  await evaluateReferralReward({ referredCustomerId: customer._id });
  await User.updateOne({ _id: referrer._id }, { $set: { walletBalance: 0 } });
  await Transaction.updateOne({ _id: records[0]._id }, { $set: { status: "REFUNDED" } });
  const result = await reconcileReferralReward({
    referredCustomerId: customer._id,
    sourceType: "DATA",
    sourceId: records[0]._id,
  });
  assert.equal(result.queued, true);
  assert.equal(await ReferralRewardReconciliation.countDocuments({ operation: "CLAWBACK", status: "PENDING" }), 1);
  await User.updateOne({ _id: referrer._id }, { $set: { walletBalance: 2000 } });
  await processReferralRewardReconciliation(20);
  assert.equal(await ReferralRewardClawback.countDocuments(), 1);
  assert.equal((await User.findById(referrer._id)).walletBalance, 0);
});

test("outbox events deduplicate by source and worker resolves them", async () => {
  const referrer = await createUser();
  const customer = await createUser({ referredBy: referrer._id });
  const sourceId = new mongoose.Types.ObjectId();
  await enqueueReferralRewardEvent({ referredCustomerId: customer._id, sourceType: "DATA", sourceId });
  await enqueueReferralRewardEvent({ referredCustomerId: customer._id, sourceType: "DATA", sourceId });
  assert.equal(await ReferralRewardReconciliation.countDocuments(), 1);
  await processReferralRewardReconciliation(20);
  assert.equal(await ReferralRewardReconciliation.countDocuments({ status: "RESOLVED" }), 1);
  assert.equal(referrer.role, "CUSTOMER");
});

test("duplicate outbox enqueue preserves an active lease", async () => {
  const referrer = await createUser();
  const customer = await createUser({ referredBy: referrer._id });
  const sourceId = new mongoose.Types.ObjectId();
  await enqueueReferralRewardEvent({ referredCustomerId: customer._id, sourceType: "DATA", sourceId });
  const leaseUntil = new Date(Date.now() + 60_000);
  await ReferralRewardReconciliation.updateOne(
    {},
    { $set: { leaseId: "active-worker", leaseUntil } }
  );
  await enqueueReferralRewardEvent({ referredCustomerId: customer._id, sourceType: "DATA", sourceId });
  const job = await ReferralRewardReconciliation.findOne().lean();
  assert.equal(job.leaseId, "active-worker");
  assert.equal(job.leaseUntil.getTime(), leaseUntil.getTime());
});

test("claim, reward transactions, and reward ledgers reject mutation", async () => {
  const referrer = await createUser();
  const customer = await createUser({ referredBy: referrer._id });
  await Transaction.insertMany(Array.from({ length: 10 }, (_, index) => ({
    reference: `DATA-IMMUTABLE-${index}`,
    customerId: customer._id,
    serviceType: "DATA",
    amount: 500,
    status: "SUCCESSFUL",
  })));
  await evaluateReferralReward({ referredCustomerId: customer._id });
  const claim = await ReferralRewardClaim.findOne();
  claim.amount = 1;
  await assert.rejects(() => claim.save(), /immutable/i);
  const reward = await Transaction.findOne({ serviceType: "REFERRAL_BONUS" });
  await assert.rejects(
    () => Transaction.updateOne({ _id: reward._id }, { $set: { amount: 1 } }),
    /immutable/i
  );
  await assert.rejects(
    () => Transaction.updateMany({}, { $set: { amount: 1 } }),
    /immutable/i
  );
  await assert.rejects(
    () => Transaction.deleteOne({}),
    /immutable/i
  );
  await assert.rejects(
    () => Transaction.deleteMany({}),
    /immutable/i
  );
  await assert.rejects(
    () => Transaction.findOneAndUpdate({}, { $set: { amount: 1 } }),
    /immutable/i
  );
  await assert.rejects(
    () => Transaction.findOneAndDelete({}),
    /immutable/i
  );
  await assert.rejects(
    () => Transaction.bulkWrite([
      { updateMany: { filter: {}, update: { $set: { amount: 1 } } } },
    ]),
    /immutable/i
  );
  const ledger = await LedgerEntry.findOne({ service: "REFERRAL_BONUS" });
  await assert.rejects(
    () => LedgerEntry.updateOne({ _id: ledger._id }, { $set: { amount: 1 } }),
    /immutable/i
  );
});