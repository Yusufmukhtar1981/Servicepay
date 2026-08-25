const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const LedgerEntry = require("../models/ledgerEntry.model");
const AdminAuditLog = require("../models/adminAuditLog.model");
const AccountRestriction = require("../models/accountRestriction.model");
const WalletHold = require("../models/walletHold.model");
const FintechWatchlist = require("../models/fintechWatchlist.model");
const FintechFraudAlert = require("../models/fintechFraudAlert.model");
const FintechFinancialAction = require("../models/fintechFinancialAction.model");
const LoginSecurityEvent = require("../models/loginSecurityEvent.model");
const {
  searchCustomers,
  createRestriction,
  removeRestriction,
  createWalletHold,
  releaseWalletHold,
  listFailedTransactions,
  listVirtualAccounts,
  listFraudAlerts,
  updateFraudAlert,
  createWatchlistEntry,
  clearWatchlistEntry,
  listLoginRisk,
  executeFinancialAction,
} = require("../controllers/adminFintechOperations.controller");
const { requireNoRestriction } = require("../middleware/accountRestriction.middleware");

let mongo;
let sequence = 0;
const models = [
  User, Transaction, LedgerEntry, AdminAuditLog, AccountRestriction, WalletHold,
  FintechWatchlist, FintechFraudAlert, FintechFinancialAction, LoginSecurityEvent,
];

const headOffice = () => ({
  _id: new mongoose.Types.ObjectId(),
  role: "HEAD_OFFICE",
  fullName: "Operations Test Head Office",
});

const request = ({
  user = headOffice(),
  body = {},
  query = {},
  params = {},
  headers = {},
  method = "POST",
  originalUrl = "/api/admin/fintech-operations/test",
} = {}) => ({
  user, body, query, params, method, originalUrl, ip: "127.0.0.1",
  headers: { "user-agent": "fintech-operations-test", ...headers },
});

const call = async (handler, options) => {
  const result = { status: 200 };
  const res = {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; return this; },
  };
  await handler(request(options), res);
  return result;
};

const createCustomer = (overrides = {}) => User.create({
  fullName: `Customer ${sequence}`,
  phone: `0800${String(sequence).padStart(7, "0")}`,
  email: `customer${sequence}@servicepay.test`,
  password: "Passw0rd!",
  walletBalance: 1000,
  ...overrides,
});

const createTransaction = async (customer, overrides = {}) => Transaction.create({
  reference: `OPS-${sequence}-${new mongoose.Types.ObjectId().toString().slice(-5)}`,
  customerId: customer._id,
  serviceType: "AIRTIME",
  amount: 150,
  status: "FAILED",
  providerResponse: { walletDebited: true },
  ...overrides,
});

test.before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(mongo.getUri(), { dbName: "fintech-operations-tests" });
  await Promise.all(models.map((model) => model.init()));
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

test.beforeEach(async () => {
  sequence += 1;
  await Promise.all(models.map((model) => model.collection.deleteMany({})));
});

test("Account Restrictions are audited and block the restricted transfer operation", async () => {
  const customer = await createCustomer();
  const created = await call(createRestriction, {
    body: { userId: customer._id.toString(), type: "BLOCK_OUTGOING_TRANSFERS", reason: "Confirmed account takeover review." },
  });
  assert.equal(created.status, 201);
  const restriction = created.body.restriction;
  let next = false;
  const req = request({ user: customer, method: "POST" });
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await requireNoRestriction("BLOCK_OUTGOING_TRANSFERS")(req, res, () => { next = true; });
  assert.equal(next, false);
  assert.equal(res.statusCode, 403);
  const removed = await call(removeRestriction, { params: { restrictionId: restriction._id.toString() }, body: { reason: "Identity review completed." } });
  assert.equal(removed.status, 200);
  let restored = false;
  await requireNoRestriction("BLOCK_OUTGOING_TRANSFERS")(request({ user: customer, method: "POST" }), res, () => { restored = true; });
  assert.equal(restored, true);
  const audit = await AdminAuditLog.findOne({ action: "FINTECH_OPERATION" });
  assert.ok(audit);
});

test("Wallet holds atomically reserve spendable balance and release once", async () => {
  const customer = await createCustomer({ walletBalance: 500 });
  const held = await call(createWalletHold, {
    body: { userId: customer._id.toString(), amount: 300, reason: "Chargeback investigation." },
    headers: { "x-idempotency-key": "hold-key-1234" },
  });
  assert.equal(held.status, 201);
  const afterHold = await User.findById(customer._id);
  assert.equal(afterHold.walletHeldBalance, 300);
  const released = await call(releaseWalletHold, {
    params: { holdId: held.body.hold._id.toString() },
    body: { amount: 300, reason: "Investigation cleared." },
    headers: { "x-idempotency-key": "release-key-1234" },
  });
  assert.equal(released.status, 200);
  assert.equal(released.body.hold.status, "RELEASED");
  const afterRelease = await User.findById(customer._id);
  assert.equal(afterRelease.walletHeldBalance, 0);
  assert.equal(await LedgerEntry.countDocuments({ service: { $in: ["WALLET_HOLD", "WALLET_HOLD_RELEASE"] } }), 2);
});

test("Failed Transactions returns real failed and pending records with pagination", async () => {
  const customer = await createCustomer();
  await createTransaction(customer);
  await createTransaction(customer, { status: "PENDING" });
  const result = await call(listFailedTransactions, { query: { limit: "1", page: "1" }, method: "GET" });
  assert.equal(result.status, 200);
  assert.equal(result.body.pagination.total, 2);
  assert.equal(result.body.transactions.length, 1);
});

test("Virtual Accounts exposes only provisioned customer account data", async () => {
  await createCustomer({
    virtualAccount: {
      provider: "SECUREWAVE",
      accountNumber: `001${sequence}12345`,
      accountName: "Customer Account",
      bankName: "Test Bank",
      status: "ACTIVE",
    },
  });
  const result = await call(listVirtualAccounts, { method: "GET" });
  assert.equal(result.status, 200);
  assert.equal(result.body.accounts.length, 1);
  assert.equal(result.body.providerActions.deactivate, false);
});

test("Fraud Monitoring records and audits a reviewer decision", async () => {
  const customer = await createCustomer();
  const transaction = await createTransaction(customer);
  const alert = await FintechFraudAlert.create({ user: customer._id, transaction: transaction._id, riskLevel: "HIGH", rule: "FAILED_TRANSACTION_VELOCITY", details: "Multiple failed payments detected." });
  const updated = await call(updateFraudAlert, {
    params: { alertId: alert._id.toString() },
    body: { status: "REVIEWING", note: "Compliance analyst reviewing provider evidence." },
  });
  assert.equal(updated.status, 200);
  const listed = await call(listFraudAlerts, { method: "GET" });
  assert.equal(listed.body.alerts.length, 1);
  assert.equal(listed.body.alerts[0].status, "REVIEWING");
});

test("Blacklist / Watchlist enforces unique active identifiers and supports audited clearing", async () => {
  const created = await call(createWatchlistEntry, {
    body: { identifierType: "PHONE", identifierValue: "08030000000", status: "BLACKLISTED", severity: "HIGH", reason: "Confirmed fraudulent payment attempt." },
  });
  assert.equal(created.status, 201);
  const duplicate = await call(createWatchlistEntry, {
    body: { identifierType: "PHONE", identifierValue: "08030000000", status: "WATCHLIST", severity: "LOW", reason: "Duplicate risk record." },
  });
  assert.equal(duplicate.status, 409);
  const cleared = await call(clearWatchlistEntry, { params: { entryId: created.body.entry._id.toString() }, body: { reason: "False positive resolved by compliance." } });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.entry.status, "CLEARED");
});

test("Device & Login Risk returns persisted security events only", async () => {
  const customer = await createCustomer();
  await LoginSecurityEvent.create({ user: customer._id, identifier: customer.phone, outcome: "FAILED", ipAddress: "127.0.0.1", userAgent: "test-device" });
  const result = await call(listLoginRisk, { method: "GET", query: { search: customer.phone } });
  assert.equal(result.status, 200);
  assert.equal(result.body.events.length, 1);
  assert.equal(result.body.events[0].outcome, "FAILED");
});

test("Refund and reversal credit an eligible failed debit exactly once each", async () => {
  const customer = await createCustomer({ walletBalance: 100 });
  const refundTx = await createTransaction(customer, { amount: 75 });
  const refund = await call(executeFinancialAction, {
    params: { type: "REFUND" },
    body: { transactionId: refundTx._id.toString(), reason: "Provider confirmed service failure." },
    headers: { "x-idempotency-key": "refund-key-1234" },
  });
  assert.equal(refund.status, 201);
  const duplicate = await call(executeFinancialAction, {
    params: { type: "REFUND" },
    body: { transactionId: refundTx._id.toString(), reason: "Provider confirmed service failure." },
    headers: { "x-idempotency-key": "refund-key-5678" },
  });
  assert.equal(duplicate.status, 409);
  const reversalTx = await createTransaction(customer, { amount: 25 });
  const reversal = await call(executeFinancialAction, {
    params: { type: "REVERSAL" },
    body: { transactionId: reversalTx._id.toString(), reason: "Correcting failed wallet debit." },
    headers: { "x-idempotency-key": "reversal-key-1234" },
  });
  assert.equal(reversal.status, 201);
  const balance = await User.findById(customer._id);
  assert.equal(balance.walletBalance, 200);
  assert.equal(await FintechFinancialAction.countDocuments({ status: "COMPLETED" }), 2);
});