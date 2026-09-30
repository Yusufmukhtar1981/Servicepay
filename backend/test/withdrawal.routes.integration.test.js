const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const User = require("../models/user.model");
const WithdrawalRequest = require("../models/withdrawalRequest.model");
const LedgerEntry = require("../models/ledgerEntry.model");
const AppSettings = require("../models/appSettings.model");
const WithdrawalPayoutClaim = require("../models/withdrawalPayoutClaim.model");
const AccountRestriction = require("../models/accountRestriction.model");
const FintechWatchlist = require("../models/fintechWatchlist.model");
const withdrawalRoutes = require("../routes/withdrawal.routes");
const {
  clearWithdrawalIndexReadinessCache,
} = require("../services/withdrawalIndexReadiness.service");

const models = [
  User,
  WithdrawalRequest,
  LedgerEntry,
  AppSettings,
  WithdrawalPayoutClaim,
  AccountRestriction,
  FintechWatchlist,
];
const jwtSecret = "disposable-withdrawal-route-test-secret";
const originalMongoUri = process.env.MONGODB_URI;
const originalJwtSecret = process.env.JWT_SECRET;
let mongo;
let server;
let baseUrl;
let sequence = 0;

const createUser = async ({
  role = "CUSTOMER",
  walletBalance = 10000,
  walletHeldBalance = 0,
} = {}) => {
  sequence += 1;
  return User.create({
    fullName: `Withdrawal Route Test ${sequence}`,
    phone: `080766${String(sequence).padStart(5, "0")}`,
    email: `withdrawal-route-${sequence}@example.test`,
    password: "Password123!",
    transactionPin: "1234",
    transactionPinSet: true,
    role,
    status: "ACTIVE",
    walletBalance,
    walletHeldBalance,
  });
};

const tokenFor = (user) =>
  jwt.sign(
    { id: String(user._id), authTokenVersion: user.authTokenVersion || 0 },
    jwtSecret,
    { expiresIn: "5m" }
  );

const validBody = (overrides = {}) => ({
  bankName: "ServicePay Test Bank",
  accountNumber: "0123456789",
  accountName: "Withdrawal Customer",
  amount: 300,
  transactionPin: "1234",
  ...overrides,
});

const request = async (
  path,
  { user, method = "GET", body, key } = {}
) => {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (user) headers.authorization = `Bearer ${tokenFor(user)}`;
  if (key) headers["idempotency-key"] = key;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

test.before(async () => {
  // Route tests always use their disposable replica set; never inherit an ambient URI.
  delete process.env.MONGODB_URI;
  process.env.JWT_SECRET = jwtSecret;
  mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  await mongoose.connect(mongo.getUri(), {
    dbName: "withdrawal-route-tests",
  });
  await Promise.all(models.map((model) => model.init()));

  const app = express();
  app.use(express.json());
  app.use("/withdrawals", withdrawalRoutes);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
  if (originalMongoUri === undefined) delete process.env.MONGODB_URI;
  else process.env.MONGODB_URI = originalMongoUri;
  if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalJwtSecret;
});

test.beforeEach(async () => {
  await Promise.all(models.map((model) => model.collection.deleteMany({})));
  clearWithdrawalIndexReadinessCache();
  await AppSettings.create({ key: "GLOBAL_SETTINGS" });
});

test("routes authenticate, scope request history, and replay full-balance idempotency keys", async () => {
  const customerA = await createUser({ walletBalance: 300 });
  const customerB = await createUser();

  const unauthenticated = await request("/withdrawals/my");
  assert.equal(unauthenticated.status, 401);
  const unauthenticatedRequest = await request("/withdrawals/request", {
    method: "POST",
    key: "route-unauthenticated",
    body: validBody(),
  });
  assert.equal(unauthenticatedRequest.status, 401);

  const created = await request("/withdrawals/request", {
    user: customerA,
    method: "POST",
    key: "route-full-balance",
    body: validBody({ amount: 300 }),
  });
  assert.equal(created.status, 201);
  const replay = await request("/withdrawals/request", {
    user: customerA,
    method: "POST",
    key: "route-full-balance",
    body: validBody({ amount: 300 }),
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.duplicate, true);
  assert.equal((await User.findById(customerA._id)).walletBalance, 0);
  assert.equal(await WithdrawalRequest.countDocuments({ user: customerA._id }), 1);
  assert.equal(await LedgerEntry.countDocuments({ user: customerA._id }), 1);

  const otherUserSameKey = await request("/withdrawals/request", {
    user: customerB,
    method: "POST",
    key: "route-full-balance",
    body: validBody({ amount: 300 }),
  });
  assert.equal(otherUserSameKey.status, 201);
  const historyA = await request("/withdrawals/my", { user: customerA });
  const historyB = await request("/withdrawals/my", { user: customerB });
  assert.equal(historyA.body.withdrawals.length, 1);
  assert.equal(historyB.body.withdrawals.length, 1);
  assert.ok(historyA.body.withdrawals.every(
    (item) => String(item.user) === String(customerA._id)
  ));
  assert.ok(historyB.body.withdrawals.every(
    (item) => String(item.user) === String(customerB._id)
  ));

  const conflict = await request("/withdrawals/request", {
    user: customerA,
    method: "POST",
    key: "route-full-balance",
    body: validBody({ amount: 300, accountNumber: "9876543210" }),
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, "IDEMPOTENCY_INTENT_CONFLICT");
});

test("route enforces available funds atomically without blocking an allowed held-balance withdrawal", async () => {
  const partiallyHeld = await createUser({
    walletBalance: 10000,
    walletHeldBalance: 4000,
  });
  const allowed = await request("/withdrawals/request", {
    user: partiallyHeld,
    method: "POST",
    key: "route-spendable-6000",
    body: validBody({ amount: 6000 }),
  });
  assert.equal(allowed.status, 201);
  const allowedAfter = await User.findById(partiallyHeld._id);
  assert.equal(allowedAfter.walletBalance, 4000);
  assert.equal(allowedAfter.walletHeldBalance, 4000);
  assert.equal(allowedAfter.withdrawalLockedBalance, 6000);
  assert.equal(
    await LedgerEntry.countDocuments({
      user: partiallyHeld._id,
      service: "WITHDRAWAL_HOLD",
    }),
    1
  );

  const overAvailable = await createUser({
    walletBalance: 10000,
    walletHeldBalance: 4000,
  });
  const denied = await request("/withdrawals/request", {
    user: overAvailable,
    method: "POST",
    key: "route-spendable-6001",
    body: validBody({ amount: 6001 }),
  });
  assert.equal(denied.status, 400);
  assert.equal(denied.body.message, "Insufficient wallet balance.");

  const allHeld = await createUser({
    walletBalance: 10000,
    walletHeldBalance: 10000,
  });
  const heldDenied = await request("/withdrawals/request", {
    user: allHeld,
    method: "POST",
    key: "route-all-held",
    body: validBody({ amount: 100 }),
  });
  assert.equal(heldDenied.status, 400);
  assert.equal(heldDenied.body.message, "Insufficient wallet balance.");

  const insufficient = await createUser({ walletBalance: 150 });
  const tooMuch = await request("/withdrawals/request", {
    user: insufficient,
    method: "POST",
    key: "route-insufficient",
    body: validBody({ amount: 200 }),
  });
  assert.equal(tooMuch.status, 400);
  assert.equal(tooMuch.body.message, "Insufficient wallet balance.");
});

test("concurrent route requests keep same-key idempotency and different-key wallet holds race-safe", async () => {
  const fullBalanceCustomer = await createUser({ walletBalance: 300 });
  const fullBalanceBody = validBody({ amount: 300 });
  const identicalRequests = await Promise.all([
    request("/withdrawals/request", {
      user: fullBalanceCustomer,
      method: "POST",
      key: "route-concurrent-same-key",
      body: fullBalanceBody,
    }),
    request("/withdrawals/request", {
      user: fullBalanceCustomer,
      method: "POST",
      key: "route-concurrent-same-key",
      body: fullBalanceBody,
    }),
  ]);
  assert.deepEqual(identicalRequests.map((response) => response.status).sort(), [200, 201]);
  assert.equal(await WithdrawalRequest.countDocuments({ user: fullBalanceCustomer._id }), 1);
  assert.equal(await LedgerEntry.countDocuments({ user: fullBalanceCustomer._id }), 1);

  const spendableCustomer = await createUser({
    walletBalance: 10000,
    walletHeldBalance: 4000,
  });
  const competingRequests = await Promise.all([
    request("/withdrawals/request", {
      user: spendableCustomer,
      method: "POST",
      key: "route-concurrent-different-a",
      body: validBody({ amount: 4000 }),
    }),
    request("/withdrawals/request", {
      user: spendableCustomer,
      method: "POST",
      key: "route-concurrent-different-b",
      body: validBody({ amount: 4000 }),
    }),
  ]);
  assert.deepEqual(competingRequests.map((response) => response.status).sort(), [201, 400]);
  const stored = await User.findById(spendableCustomer._id);
  assert.equal(stored.walletBalance, 6000);
  assert.equal(stored.walletHeldBalance, 4000);
  assert.equal(stored.withdrawalLockedBalance, 4000);
  assert.equal(
    await WithdrawalRequest.countDocuments({ user: spendableCustomer._id }),
    1
  );
  assert.equal(await LedgerEntry.countDocuments({ user: spendableCustomer._id }), 1);
});

test("Head Office readiness is read-only and withdrawal writes fail closed without required indexes", async () => {
  const customer = await createUser();
  const admin = await createUser({ role: "HEAD_OFFICE", walletBalance: 0 });
  const readiness = await request("/withdrawals/admin/readiness", {
    user: admin,
  });
  assert.equal(readiness.status, 200);
  assert.equal(readiness.body.readiness.ready, true);
  assert.equal(readiness.body.readiness.indexes.withdrawalUserIdempotencyUnique, true);
  assert.equal(readiness.body.readiness.indexes.payoutReferenceUnique, true);

  const originalListIndexes = WithdrawalRequest.collection.listIndexes;
  const existingIndexes = await originalListIndexes.call(
    WithdrawalRequest.collection
  ).toArray();
  WithdrawalRequest.collection.listIndexes = () => ({
    toArray: async () => [],
  });
  clearWithdrawalIndexReadinessCache();
  try {
    const blocked = await request("/withdrawals/request", {
      user: customer,
      method: "POST",
      key: "route-indexes-missing",
      body: validBody(),
    });
    assert.equal(blocked.status, 503);
    assert.equal(blocked.body.code, "WITHDRAWAL_INDEXES_NOT_READY");

    const reported = await request("/withdrawals/admin/readiness", {
      user: admin,
    });
    assert.equal(reported.status, 503);
    assert.equal(reported.body.readiness.ready, false);
  } finally {
    WithdrawalRequest.collection.listIndexes = originalListIndexes;
    clearWithdrawalIndexReadinessCache();
  }
  const afterIndexes = await WithdrawalRequest.collection.listIndexes().toArray();
  assert.deepEqual(afterIndexes, existingIndexes);
});

test("withdrawal restriction and Head Office manual-approval/status routes remain enforced", async () => {
  const customer = await createUser();
  const admin = await createUser({ role: "HEAD_OFFICE", walletBalance: 0 });
  await AccountRestriction.create({
    user: customer._id,
    type: "BLOCK_WITHDRAWALS",
    status: "ACTIVE",
    reason: "Test restriction",
    createdBy: customer._id,
  });
  const restricted = await request("/withdrawals/request", {
    user: customer,
    method: "POST",
    key: "route-restricted",
    body: validBody(),
  });
  assert.equal(restricted.status, 403);
  assert.equal(restricted.body.code, "ACCOUNT_RESTRICTED");
  await AccountRestriction.deleteMany({});

  const pending = await request("/withdrawals/request", {
    user: customer,
    method: "POST",
    key: "route-admin-flow",
    body: validBody(),
  });
  assert.equal(pending.status, 201);
  const deniedAdminView = await request("/withdrawals/admin?status=PENDING", {
    user: customer,
  });
  assert.equal(deniedAdminView.status, 403);

  const queue = await request("/withdrawals/admin?status=PENDING", {
    user: admin,
  });
  assert.equal(queue.status, 200);
  assert.equal(queue.body.withdrawals.length, 1);
  assert.equal(queue.body.withdrawals[0].status, "PENDING");

  const unsupportedApproval = await request(
    `/withdrawals/admin/${pending.body.withdrawal._id}/approve`,
    {
      user: admin,
      method: "POST",
      body: { payoutReference: "MANUAL-ONLY-REFERENCE", providerStatus: "SUCCESS" },
    }
  );
  assert.equal(unsupportedApproval.status, 409);
  assert.equal(unsupportedApproval.body.code, "PAYOUT_NOT_CONFIRMED");

  const approved = await request(
    `/withdrawals/admin/${pending.body.withdrawal._id}/approve`,
    {
      user: admin,
      method: "POST",
      body: {
        payoutReference: "MANUAL-ROUTE-PAYOUT",
        adminNote: "Transfer completed from company bank account.",
        manualPaymentConfirmed: true,
        expectedAmount: pending.body.withdrawal.amount,
        expectedAccountNumber: pending.body.withdrawal.accountNumber,
      },
    }
  );
  assert.equal(approved.status, 200);
  assert.equal(approved.body.withdrawal.status, "APPROVED");
  assert.equal(String(approved.body.withdrawal.manualPayoutEvidence.actor), String(admin._id));

  const approvedQueue = await request("/withdrawals/admin?status=APPROVED", {
    user: admin,
  });
  assert.equal(approvedQueue.status, 200);
  assert.equal(approvedQueue.body.withdrawals.length, 1);
  assert.equal(approvedQueue.body.withdrawals[0].status, "APPROVED");

  const rejectRequest = await request("/withdrawals/request", {
    user: customer,
    method: "POST",
    key: "route-reject-flow",
    body: validBody({ amount: 400 }),
  });
  const rejected = await request(
    `/withdrawals/admin/${rejectRequest.body.withdrawal._id}/reject`,
    {
      user: admin,
      method: "POST",
      body: { adminNote: "Beneficiary details could not be verified." },
    }
  );
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.withdrawal.status, "REJECTED");
  assert.equal((await User.findById(customer._id)).walletBalance, 9700);
  assert.equal((await User.findById(customer._id)).withdrawalLockedBalance, 0);
});