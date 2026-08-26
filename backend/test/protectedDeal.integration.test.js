const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const User = require("../models/user.model");
const ProtectedDeal = require("../models/protectedDeal.model");
const TrustDispute = require("../models/trustDispute.model");
const WalletHold = require("../models/walletHold.model");
const Transaction = require("../models/transaction.model");
const LedgerEntry = require("../models/ledgerEntry.model");
const Notification = require("../models/notification.model");
const AdminAuditLog = require("../models/adminAuditLog.model");
const TrustProfile = require("../models/trustProfile.model");
const AccountRestriction = require("../models/accountRestriction.model");
const {
  createDeal, fundDeal, transition, openDispute, resolveDispute,
} = require("../services/protectedDeal.service");

let mongo;
let serial = 0;
const models = [User, ProtectedDeal, TrustDispute, WalletHold, Transaction, LedgerEntry,
  Notification, AdminAuditLog, TrustProfile, AccountRestriction];

const customer = async (balance) => {
  serial += 1;
  return User.create({
    fullName: `Protected Deal User ${serial}`,
    phone: `080${String(20000000 + serial).slice(-8)}`,
    email: `protected-${serial}@servicepay.test`,
    password: "Passw0rd!",
    status: "ACTIVE",
    walletBalance: balance,
    walletHeldBalance: 0,
  });
};
const deal = async (buyer, seller, amount = 100, suffix = "a") =>
  (await createDeal({
    buyerId: buyer._id, sellerId: seller._id, amount, title: "Verified goods",
    description: "A real protected-deal test.", idempotencyKey: `create-${serial}-${suffix}-key`,
  })).deal;
const funded = async (buyer, seller, amount = 100, suffix = "a") => {
  const created = await deal(buyer, seller, amount, suffix);
  return (await fundDeal({ dealId: created._id, buyerId: buyer._id, idempotencyKey: `fund-${serial}-${suffix}-key` })).deal;
};

test.before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(mongo.getUri(), { dbName: "protected-deal-integration" });
  await Promise.all(models.map((model) => model.init()));
});
test.after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
test.beforeEach(async () => {
  serial += 1;
  await Promise.all(models.map((model) => model.collection.deleteMany({})));
});

test("create, fund, start, deliver and release settle exactly once", async () => {
  const buyer = await customer(500);
  const seller = await customer(20);
  const created = await deal(buyer, seller, 125, "life");
  const fundedDeal = await fundDeal({ dealId: created._id, buyerId: buyer._id, idempotencyKey: "fund-life-key" });
  assert.equal(fundedDeal.deal.status, "FUNDED");
  assert.equal((await User.findById(buyer._id)).walletHeldBalance, 125);
  await transition({ dealId: created._id, actorId: seller._id, idempotencyKey: "start-life-key", from: ["FUNDED"], to: "IN_PROGRESS", requiredParticipant: "SELLER" });
  await transition({ dealId: created._id, actorId: seller._id, idempotencyKey: "deliver-life-key", from: ["IN_PROGRESS"], to: "DELIVERED", requiredParticipant: "SELLER" });
  const released = await transition({ dealId: created._id, actorId: buyer._id, idempotencyKey: "release-life-key", from: ["DELIVERED"], to: "COMPLETED", settlement: "RELEASE", requiredParticipant: "BUYER" });
  assert.equal(released.deal.status, "COMPLETED");
  assert.equal((await User.findById(buyer._id)).walletBalance, 375);
  assert.equal((await User.findById(buyer._id)).walletHeldBalance, 0);
  assert.equal((await User.findById(seller._id)).walletBalance, 145);
  assert.equal((await WalletHold.findById(released.deal.walletHold)).status, "RELEASED");
  assert.equal((await Transaction.findById(released.deal.transaction)).status, "SUCCESSFUL");
  assert.equal(await LedgerEntry.countDocuments({ reference: created.reference }), 2);
  await transition({ dealId: created._id, actorId: buyer._id, idempotencyKey: "release-life-key", from: ["DELIVERED"], to: "COMPLETED", settlement: "RELEASE", requiredParticipant: "BUYER" });
  assert.equal((await User.findById(buyer._id)).walletBalance, 375);
  assert.equal(await LedgerEntry.countDocuments({ reference: created.reference }), 2);
});

test("admin refund cancels held funds without crediting buyer and is idempotent", async () => {
  const buyer = await customer(300);
  const seller = await customer(40);
  const protectedDeal = await funded(buyer, seller, 100, "refund");
  const dispute = await openDispute({ dealId: protectedDeal._id, userId: buyer._id, reason: "Goods were not supplied.", idempotencyKey: "dispute-refund-key" });
  const admin = new mongoose.Types.ObjectId();
  await resolveDispute({ disputeId: dispute.dispute._id, adminId: admin, actor: { role: "HEAD_OFFICE", fullName: "Admin" }, resolution: "REFUND", note: "Evidence supports a refund.", idempotencyKey: "resolve-refund-key" });
  assert.equal((await User.findById(buyer._id)).walletBalance, 300);
  assert.equal((await User.findById(buyer._id)).walletHeldBalance, 0);
  assert.equal((await User.findById(seller._id)).walletBalance, 40);
  assert.equal((await WalletHold.findById(protectedDeal.walletHold)).status, "CANCELLED");
  assert.equal((await Transaction.findById(protectedDeal.transaction)).status, "REFUNDED");
  await resolveDispute({ disputeId: dispute.dispute._id, adminId: admin, actor: { role: "HEAD_OFFICE" }, resolution: "REFUND", note: "retry", idempotencyKey: "resolve-refund-key" });
  assert.equal((await User.findById(buyer._id)).walletBalance, 300);
});

test("admin release settles a disputed funded deal exactly once", async () => {
  const buyer = await customer(300);
  const seller = await customer(40);
  const protectedDeal = await funded(buyer, seller, 100, "admin-release");
  const dispute = await openDispute({ dealId: protectedDeal._id, userId: seller._id, reason: "Buyer accepted delivery.", idempotencyKey: "dispute-release-key" });
  await resolveDispute({ disputeId: dispute.dispute._id, adminId: new mongoose.Types.ObjectId(), actor: { role: "HEAD_OFFICE" }, resolution: "RELEASE", note: "Evidence supports release.", idempotencyKey: "resolve-release-key" });
  assert.equal((await User.findById(buyer._id)).walletBalance, 200);
  assert.equal((await User.findById(seller._id)).walletBalance, 140);
  assert.equal(await LedgerEntry.countDocuments({ reference: protectedDeal.reference }), 2);
});

test("rejects insufficient spendable funds, unauthorized actors, and invalid transitions", async () => {
  const buyer = await customer(100);
  const seller = await customer(0);
  const outsider = await customer(0);
  const insufficient = await deal(buyer, seller, 101, "insufficient");
  await assert.rejects(() => fundDeal({ dealId: insufficient._id, buyerId: buyer._id, idempotencyKey: "fund-insufficient-key" }), /Insufficient spendable/);
  const protectedDeal = await funded(buyer, seller, 50, "authorization");
  await assert.rejects(() => transition({ dealId: protectedDeal._id, actorId: outsider._id, idempotencyKey: "outsider-start-key", from: ["FUNDED"], to: "IN_PROGRESS", requiredParticipant: "SELLER" }), /not a participant/);
  await assert.rejects(() => transition({ dealId: protectedDeal._id, actorId: buyer._id, idempotencyKey: "buyer-deliver-key", from: ["FUNDED"], to: "DELIVERED", requiredParticipant: "SELLER" }), /Only the seller/);
  await assert.rejects(() => transition({ dealId: protectedDeal._id, actorId: seller._id, idempotencyKey: "bad-deliver-key", from: ["IN_PROGRESS"], to: "DELIVERED", requiredParticipant: "SELLER" }), /cannot transition/);
});