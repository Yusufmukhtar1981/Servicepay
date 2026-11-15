const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const User = require("../models/user.model");
const AppSettings = require("../models/appSettings.model");
const Transaction = require("../models/transaction.model");
const LedgerEntry = require("../models/ledgerEntry.model");
const Outbox = require("../models/referralRewardReconciliation.model");
const Claim = require("../models/referralRewardClaim.model");
const Clawback = require("../models/referralRewardClawback.model");
const AdminAudit = require("../models/adminAuditLog.model");
const Delivery = require("../models/delivery.model");
const Marketplace = require("../models/marketplaceOrder.model");
const programme = require("../services/referralProgramme.service");
const worker = require("../services/referralReward.service");
const controller = require("../controllers/referralProgramme.controller");
let replica;
let sequence = 0;
const models = [User, AppSettings, Transaction, LedgerEntry, Outbox, Claim, Clawback, AdminAudit, Delivery, Marketplace];
const user = (extra = {}) => {
  sequence += 1;
  return User.create({
    fullName: `Referral Person ${sequence}`, phone: `0809${String(sequence).padStart(7, "0")}`,
    email: `v2-${sequence}@example.invalid`, password: "Test-password-only-42", role: "CUSTOMER",
    status: "ACTIVE", walletBalance: 0, ...extra,
  });
};
const activate = async (extra = {}) => {
  const admin = await user({ role: "HEAD_OFFICE" });
  return programme.configure({
    enabled: true, registrationBonus: 100, transactionCommission: 1,
    eligibleServices: [...programme.SUPPORTED_SERVICES], reason: "Activate isolated test programme", ...extra,
  }, admin);
};
const pair = async () => {
  const referrer = await user();
  const customer = await user({ referredBy: referrer._id, referralCapturedAt: new Date(), emailVerified: true });
  return { referrer, customer };
};
const transaction = async (customer, extra = {}) => {
  sequence += 1;
  return Transaction.create({
    reference: `SOURCE-V2-${sequence}`, customerId: customer._id, serviceType: "DATA",
    amount: 20, status: "SUCCESSFUL", ...extra,
  });
};
const reconcile = (row) => programme.reconcile({ sourceType: "TRANSACTION", sourceId: row._id });
const balance = async (who) => (await User.findById(who._id).lean()).walletBalance;
const invoke = async (fn, req) => {
  const result = { status: 200, headers: {} };
  const res = {
    status(n) { result.status = n; return this; },
    json(body) { result.body = body; return this; },
    set(k, v) { result.headers[k] = v; return this; },
    send(body) { result.body = body; return this; },
  };
  await fn(req, res); return result;
};
test.before(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(replica.getUri(), { dbName: "referral-programme-disposable-test" });
  assert.match(mongoose.connection.host, /^(127\.0\.0\.1|localhost)$/);
  await Promise.all(models.map((model) => model.init()));
});
test.beforeEach(async () => {
  // Only this explicitly allocated local replica, never an ambient URI.
  for (const model of models) await model.collection.deleteMany({});
  await AppSettings.create({ key: "GLOBAL_SETTINGS" });
});
test.after(async () => { await mongoose.disconnect(); await replica?.stop(); });

test("activation uses existing unique safeguards, preserves existing settings, and audits changes", async () => {
  assert.deepEqual(await programme.readiness(), { ready: true, blockers: [] });
  await activate();
  assert.equal((await programme.policy()).registrationBonus, 100);
  assert.equal(await AdminAudit.countDocuments({ action: "SYSTEM_SETTING_UPDATED" }), 1);
  assert.equal(await AppSettings.countDocuments(), 1);
});
test("A/I: verified registration pays NGN100 once, including concurrent duplicate processing", async () => {
  await activate();
  const { referrer, customer } = await pair();
  await Promise.all(Array.from({ length: 8 }, () =>
    programme.reconcile({ sourceType: "REGISTRATION", sourceId: customer._id })));
  assert.equal(await balance(referrer), 100);
  assert.equal(await balance(customer), 0);
  assert.equal(await LedgerEntry.countDocuments({ "metadata.rewardType": "REGISTRATION" }), 1);
});
test("verification is mandatory; either securely verified phone or email qualifies", async () => {
  await activate();
  const referrer = await user();
  const customer = await user({ referredBy: referrer._id, referralCapturedAt: new Date() });
  await programme.reconcile({ sourceType: "REGISTRATION", sourceId: customer._id });
  assert.equal(await balance(referrer), 0);
  await User.updateOne({ _id: customer._id }, { $set: { phoneVerified: true } });
  await worker.processReferralRewardReconciliation();
  assert.equal(await balance(referrer), 100);
});
test("B: each successful paid transaction pays NGN1 irrespective of purchase amount", async () => {
  await activate(); const { referrer, customer } = await pair();
  const row = await transaction(customer, { amount: 0.01 });
  const before = await Transaction.findById(row._id).lean();
  await reconcile(row);
  assert.equal(await balance(referrer), 1);
  assert.equal(await balance(customer), 0);
  assert.deepEqual(await Transaction.findById(row._id).lean(), before);
});
test("C: 100 distinct successful purchases pay exactly NGN100", async () => {
  await activate(); const { referrer, customer } = await pair();
  for (let i = 0; i < 100; i += 1) await reconcile(await transaction(customer));
  assert.equal(await balance(referrer), 100);
  assert.equal(await LedgerEntry.countDocuments({ "metadata.rewardType": "TRANSACTION" }), 100);
});
test("D/E: failed, pending, refunded, reversed and zero-value purchases cannot earn", async () => {
  await activate(); const { referrer, customer } = await pair();
  for (const extra of [
    { status: "FAILED" }, { status: "PENDING" }, { status: "REFUNDED" },
    { reversalReference: "REVERSAL" }, { reversalLedgerEntryId: new mongoose.Types.ObjectId() },
    { dispatchStatus: "REFUNDED" }, { amount: 0 },
  ]) await reconcile(await transaction(customer, extra));
  assert.equal(await balance(referrer), 0);
});
test("funding, transfers, refunds, financing deposits and reward transactions cannot compound rewards", async () => {
  await activate(); const { referrer, customer } = await pair();
  for (const serviceType of ["WALLET_FUNDING", "TRANSFER", "BANK_TRANSFER", "REFUND", "REFERRAL_BONUS", "SOLAR_DEPOSIT"]) {
    await reconcile(await transaction(customer, { serviceType }));
  }
  assert.equal(await balance(referrer), 0);
});
test("F: refund creates one compensating debit and immutable audit history", async () => {
  await activate(); const { referrer, customer } = await pair();
  const row = await transaction(customer); await reconcile(row);
  await Transaction.updateOne({ _id: row._id }, { $set: { status: "REFUNDED" } });
  await Promise.all([reconcile(row), reconcile(row)]);
  assert.equal(await balance(referrer), 0);
  assert.equal(await LedgerEntry.countDocuments(), 2);
  assert.equal(await Transaction.countDocuments({ serviceType: "REFERRAL_BONUS" }), 1);
  assert.equal(await Transaction.countDocuments({ serviceType: "REFERRAL_BONUS_REVERSAL" }), 1);
  await assert.rejects(LedgerEntry.updateOne({}, { $set: { amount: 1000 } }), /immutable/i);
});
test("insufficient balance keeps clawback pending and retries safely without a negative wallet", async () => {
  await activate(); const { referrer, customer } = await pair();
  await programme.reconcile({ sourceType: "REGISTRATION", sourceId: customer._id });
  const row = await transaction(customer); await reconcile(row);
  await User.updateOne({ _id: referrer._id }, { $set: { walletBalance: 0 } });
  await Transaction.updateOne({ _id: row._id }, { $set: { status: "REFUNDED" } });
  await worker.processReferralRewardReconciliation();
  assert.equal(await balance(referrer), 0);
  assert.ok(await Outbox.exists({ sourceId: row._id, status: "PENDING" }));
  await User.updateOne({ _id: referrer._id }, { $set: { walletBalance: 1 } });
  await Outbox.updateMany({}, { $set: { nextAttemptAt: new Date(0), leaseUntil: null } });
  await worker.processReferralRewardReconciliation();
  assert.equal(await balance(referrer), 0);
  assert.equal(await LedgerEntry.countDocuments({ direction: "DEBIT" }), 1);
});
test("G: duplicate notifications and concurrent success reconciliation cannot credit twice", async () => {
  await activate(); const { referrer, customer } = await pair();
  const row = await transaction(customer);
  await Promise.all(Array.from({ length: 10 }, () => worker.reconcileReferralReward({
    referredCustomerId: customer._id, sourceType: "TRANSACTION", sourceId: row._id,
  })));
  assert.equal(await balance(referrer), 1);
  assert.equal(await LedgerEntry.countDocuments(), 1);
});
test("H: self-referrals and changed ownership cannot obtain rewards", async () => {
  await activate(); const self = await user();
  // Simulate a corrupt historical record on this disposable test DB only.
  await User.collection.updateOne({ _id: self._id }, { $set: { referredBy: self._id, referralCapturedAt: new Date(), emailVerified: true } });
  await reconcile(await transaction(self));
  assert.equal(await balance(self), 0);
  const { referrer, customer } = await pair();
  await User.updateOne({ _id: customer._id }, { $set: { referredBy: self._id } });
  assert.equal(String((await User.findById(customer._id)).referredBy), String(referrer._id));
});
test("future-only activation excludes old registrations and old transactions", async () => {
  const referrer = await user();
  const customer = await user({ referredBy: referrer._id, emailVerified: true, referralCapturedAt: new Date(0) });
  const old = await transaction(customer);
  await new Promise((resolve) => setTimeout(resolve, 10));
  await activate();
  await programme.reconcile({ sourceType: "REGISTRATION", sourceId: customer._id });
  await reconcile(old);
  assert.equal(await balance(referrer), 0);
  await reconcile(await transaction(customer));
  assert.equal(await balance(referrer), 1);
});
test("disable stops new credits but does not prevent reversals or change the activation boundary", async () => {
  await activate(); const initial = await programme.policy();
  const { referrer, customer } = await pair();
  const row = await transaction(customer); await reconcile(row);
  await activate({ enabled: false });
  assert.equal(String((await programme.policy()).activatedAt), String(initial.activatedAt));
  await reconcile(await transaction(customer));
  assert.equal(await balance(referrer), 1);
  await Transaction.updateOne({ _id: row._id }, { $set: { status: "REFUNDED" } });
  await reconcile(row); assert.equal(await balance(referrer), 0);
});
test("service config can restrict future rewards without clawing back valid old earnings", async () => {
  await activate(); const { referrer, customer } = await pair();
  const row = await transaction(customer); await reconcile(row);
  await activate({ eligibleServices: ["AIRTIME"] });
  await reconcile(row); await reconcile(await transaction(customer));
  assert.equal(await balance(referrer), 1);
});
test("legacy threshold awards stop after activation; historical claims and indexes remain untouched", async () => {
  await activate(); const { referrer, customer } = await pair();
  for (let n = 0; n < 10; n += 1) await transaction(customer, { amount: 500 });
  const result = await worker.evaluateReferralReward({ referredCustomerId: customer._id });
  assert.equal(result.reason, "LEGACY_POLICY_RETIRED");
  assert.equal(await balance(referrer), 0);
  assert.equal(await Claim.countDocuments(), 0);
});
test("canonical state update captures a durable event in the same transaction and rolls back atomically", async () => {
  await activate(); const { customer } = await pair();
  const row = await transaction(customer, { status: "PENDING" });
  await Outbox.collection.deleteMany({});
  const session = await mongoose.startSession();
  await assert.rejects(session.withTransaction(async () => {
    await Transaction.updateOne({ _id: row._id }, { $set: { status: "SUCCESSFUL" } }, { session });
    assert.ok(await Outbox.exists({ sourceId: row._id }).session(session));
    throw new Error("Simulated source rollback");
  }), /Simulated/);
  await session.endSession();
  assert.equal(await Outbox.countDocuments(), 0);
  assert.equal((await Transaction.findById(row._id)).status, "PENDING");
});
test("customer report is privacy safe and sums registration and transaction earnings separately", async () => {
  await activate(); const { referrer, customer } = await pair();
  await programme.reconcile({ sourceType: "REGISTRATION", sourceId: customer._id });
  await reconcile(await transaction(customer));
  const report = await programme.customerSummary(referrer._id);
  assert.equal(report.registrationBonusesEarned, 100);
  assert.equal(report.transactionCommissionsEarned, 1);
  assert.equal(report.totalReferralEarnings, 101);
  assert.equal(report.referrals[0].successfulTransactions, 1);
  assert.equal(JSON.stringify(report).includes(customer.phone), false);
  assert.equal(JSON.stringify(report).includes(customer.email), false);
});
test("Head Office with explicit settings permission can configure; other roles and wildcard-only users cannot", async () => {
  const staff = await user({ role: "HEAD_OFFICE" });
  const req = { user: staff, staffAccess: { isHeadOffice: true, scope: { type: "GLOBAL" }, permissions: ["*"] },
    staffRole: { permissions: [] }, body: { enabled: true, registrationBonus: 100, transactionCommission: 1,
      eligibleServices: ["DATA"], reason: "Controlled programme activation" } };
  assert.equal((await invoke(controller.updateProgramme, req)).status, 403);
  req.staffRole.permissions = ["settings.update"];
  assert.equal((await invoke(controller.updateProgramme, req)).status, 200);
  for (const role of ["CUSTOMER", "OPERATIONS_MANAGER", "CUSTOMER_SUPPORT", "STATE_MANAGER"]) {
    assert.equal((await invoke(controller.updateProgramme, { ...req, user: { ...staff.toObject(), role } })).status, 403);
    assert.equal((await invoke(controller.commissions, { ...req, user: { ...staff.toObject(), role }, query: {} })).status, 403);
  }
});
test("financial report search, export and formula injection protection use real ledger records", async () => {
  await activate(); const { referrer, customer } = await pair();
  await User.updateOne({ _id: referrer._id }, { $set: { fullName: "=UNTRUSTED", referralCode: "TESTREFCODE" } });
  await reconcile(await transaction(customer));
  const admin = await user({ role: "HEAD_OFFICE" });
  const req = { user: admin, staffAccess: { isHeadOffice: true, scope: { type: "GLOBAL" } }, query: { q: "TESTREFCODE" } };
  const report = await invoke(controller.commissions, req);
  assert.equal(report.body.total, 1);
  assert.equal(report.body.items[0].rewardType, "TRANSACTION");
  const exported = await invoke(controller.exportCommissions, req);
  assert.equal(exported.status, 200);
  assert.match(exported.headers["Content-Type"], /text\/csv/);
  assert.ok(exported.body.includes("'=UNTRUSTED"));
});
test("configuration rejects funding services, missing reason and invalid amounts", () => {
  const valid = { enabled: true, registrationBonus: 100, transactionCommission: 1, eligibleServices: ["DATA"], reason: "Valid admin reason" };
  for (const extra of [{ eligibleServices: ["WALLET_FUNDING"] }, { reason: "" }, { transactionCommission: -1 }, { registrationBonus: 0.001 }, { enabled: "true" }]) {
    assert.throws(() => programme.validateConfiguration({ ...valid, ...extra }));
  }
});

test("delivery pays only for a paid delivered order and reverses on canonical refund evidence", async () => {
  await activate(); const { referrer, customer } = await pair();
  const order = await Delivery.create({
    customerId: customer._id, trackingNumber: `V2-DELIVERY-${++sequence}`,
    pickupAddress: "Test pickup", deliveryAddress: "Test destination", senderName: "Sender",
    senderPhone: "08000000000", receiverName: "Receiver", receiverPhone: "08000000001",
    packageName: "Test package", deliveryFee: 2000, paymentStatus: "PAID", status: "DELIVERED",
  });
  const args = { sourceType: "DELIVERY", sourceId: order._id };
  await programme.reconcile(args);
  await programme.reconcile(args);
  assert.equal(await balance(referrer), 1);
  await Delivery.updateOne({ _id: order._id }, { $set: { refundedAt: new Date() } });
  await programme.reconcile(args);
  assert.equal(await balance(referrer), 0);
});
test("marketplace order and its financial transaction cannot earn two commissions", async () => {
  await activate(); const { referrer, customer } = await pair();
  const purchase = await transaction(customer, { serviceType: "MARKETPLACE" });
  const order = await Marketplace.create({
    orderReference: `V2-MARKETPLACE-${++sequence}`, buyer: customer._id,
    items: [{ product: new mongoose.Types.ObjectId(), merchant: referrer._id,
      title: "Test item", unitPrice: 1000, quantity: 1, lineTotal: 1000 }],
    customerName: "Customer", customerPhone: "08000000000", deliveryAddress: "Test destination",
    subtotal: 1000, totalAmount: 1000, paymentStatus: "PAID", orderStatus: "DELIVERED",
    fundsStatus: "SETTLED", transaction: purchase._id,
  });
  const args = { sourceType: "MARKETPLACE", sourceId: order._id };
  await reconcile(purchase); await programme.reconcile(args); await programme.reconcile(args);
  assert.equal(await balance(referrer), 1);
  assert.equal(await LedgerEntry.countDocuments(), 1);
  await Marketplace.updateOne({ _id: order._id }, { $set: { paymentStatus: "REFUNDED", fundsStatus: "REFUNDED" } });
  await programme.reconcile(args);
  assert.equal(await balance(referrer), 0);
});
test("a later contact correction does not claw back a legitimately verified registration bonus", async () => {
  await activate(); const { referrer, customer } = await pair();
  const args = { sourceType: "REGISTRATION", sourceId: customer._id };
  await programme.reconcile(args);
  await User.updateOne({ _id: customer._id }, { $set: { emailVerified: false } });
  await programme.reconcile(args);
  assert.equal(await balance(referrer), 100);
  assert.equal(await LedgerEntry.countDocuments(), 1);
});
test("customer history pagination retains totals and never discloses another referrer's rewards", async () => {
  await activate(); const { referrer, customer } = await pair();
  for (let n = 0; n < 3; n += 1) await reconcile(await transaction(customer));
  const other = await pair(); await reconcile(await transaction(other.customer));
  const first = await programme.customerSummary(referrer._id, { historyPage: 1, historyLimit: 2 });
  const second = await programme.customerSummary(referrer._id, { historyPage: 2, historyLimit: 2 });
  assert.equal(first.history.length, 2); assert.equal(second.history.length, 1);
  assert.equal(second.historyTotal, 3); assert.equal(second.historyPages, 2);
  assert.equal(second.totalReferralEarnings, 3);
  assert.equal(first.history.some((row) => String(row.id) === String(second.history[0].id)), false);
});
test("Head Office v2 progress and audit use actual new-policy earnings instead of legacy thresholds", async () => {
  await activate(); const { referrer, customer } = await pair();
  await programme.reconcile({ sourceType: "REGISTRATION", sourceId: customer._id });
  await reconcile(await transaction(customer));
  const admin = await user({ role: "HEAD_OFFICE" });
  const req = { user: admin, staffAccess: { isHeadOffice: true, scope: { type: "GLOBAL" } },
    params: { customerId: String(customer._id) } };
  const handlers = require("../controllers/adminReferral.controller");
  const progress = await invoke(handlers.progress, req);
  assert.equal(progress.body.registrationBonusesEarned, 100);
  assert.equal(progress.body.successfulTransactions, 1);
  const audit = await invoke(handlers.audit, req);
  assert.equal(audit.body.auditHistory.length, 2);
  assert.equal(await balance(referrer), 101);
});
test("a disabled initial draft does not start the activation window or retire the legacy policy", async () => {
  await activate({ enabled: false });
  assert.equal((await programme.policy()).activatedAt, null);
  await activate();
  assert.ok((await programme.policy()).activatedAt instanceof Date);
});
