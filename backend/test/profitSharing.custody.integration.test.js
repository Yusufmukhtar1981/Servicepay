"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
for (const key of ["MONGODB_URI", "MONGO_URI", "MONGO_URL", "DATABASE_URL"]) {
  assert.equal(Boolean(process.env[key]), false, `Remove ambient ${key}: isolated fixtures only.`);
}
const mongoose = require("mongoose");
mongoose.set("autoIndex", false); mongoose.set("autoCreate", false);
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const express = require("express"), jwt = require("jsonwebtoken");
const M = require("../models/profitSharing.models"), N = require("../models/businessNetwork.models");
const User = require("../models/user.model"), Role = require("../models/role.model");
const W = require("../models/withdrawalRequest.model"), Claim = require("../models/withdrawalPayoutClaim.model");
const Restriction = require("../models/accountRestriction.model"), Watchlist = require("../models/fintechWatchlist.model");
const Settings = require("../models/appSettings.model"), Tx = require("../models/transaction.model");
const Ledger = require("../models/ledgerEntry.model");
const custody = require("../services/profitSharing.custody"), reporting = require("../services/profitSharing.reporting");
const { createEngine } = require("../services/profitSharing.engine");
let mongo, server, base, manager, head, wildcard, serial = 0;
const password = "SyntheticLocalPassword123!";
async function person(role, extra = {}) {
  const n = ++serial;
  const user = await User.create({ fullName: `Synthetic custody ${n}`, role, status: "ACTIVE",
    phone: `080${String(n).padStart(8, "0")}`, email: `custody-${n}@test.invalid`,
    password, walletBalance: 1234.004603467313, commissionBalance: 777, ...extra });
  user.setTransactionPin("2468"); await user.save(); return user;
}
async function credit(user, amountKobo) {
  const id = new mongoose.Types.ObjectId(), accountId = `beneficiary:${user._id}`;
  await M.Event.create({ _id: `accrual:${id}`, kind: "ACCRUAL", transaction: id,
    data: { source: "ISOLATED_TEST_FIXTURE", plan: { netProfitKobo: amountKobo, poolKobo: amountKobo },
      entries: [{ accountId, role: "AGGREGATOR", amountKobo }] } });
  await M.Account.create({ _id: accountId, earnedKobo: amountKobo, availableKobo: amountKobo });
  return id;
}
async function call(actor, suffix, body) {
  const token = actor && jwt.sign({ id: String(actor._id), tokenVersion: actor.authTokenVersion || 0 },
    process.env.JWT_SECRET, { expiresIn: "1h" });
  const response = await fetch(base + suffix, { method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
}
const intent = key => ({ amount: 100, bankName: "Synthetic Bank", accountNumber: "0000000001",
  accountName: "Synthetic Manager", transactionPin: "2468", idempotencyKey: key });
const confirm = (reference = "synthetic-bank-payout") => ({
  currentPassword: password, adminNote: "Synthetic bank evidence reviewed", manualPaymentConfirmed: true,
  expectedAmount: 100, expectedAccountNumber: "0000000001", payoutReference: reference,
});
test.before(async () => {
  process.env.JWT_SECRET = "synthetic-local-custody-auth-not-production";
  mongo = await MongoMemoryReplSet.create({ binary: { systemBinary: process.env.MONGOMS_SYSTEM_BINARY },
    replSet: { count: 1, storageEngine: "wiredTiger" }, instanceOpts: [{ args: ["--nounixsocket"] }] });
  assert.match(mongo.getUri(), /^mongodb:\/\/127\.0\.0\.1:/);
  await mongoose.connect(mongo.getUri(), { dbName: "isolated-commission-custody" });
  for (const model of [M.Account, M.Event, M.Admission, N.Audit, N.Settings, User, Role,
    W, Claim, Restriction, Watchlist, Settings, Tx, Ledger]) await model.createCollection();
  await W.createIndexes(); await Claim.createIndexes();
  await Settings.create({ key: "GLOBAL_SETTINGS" });
  const role = await Role.create({ name: "SYNTHETIC_COMMISSION_PERMISSION", displayName: "Synthetic commission test", status: "ACTIVE",
    permissions: ["commissions.manage"], department: "ADMINISTRATION" });
  manager = await person("AGENT"); head = await person("HEAD_OFFICE", { staffRoleId: role._id });
  wildcard = await person("HEAD_OFFICE");
  const app = express(); app.use(express.json());
  app.use("/withdrawals", require("../routes/withdrawal.routes"));
  app.use("/commissions", require("../routes/productCommission.routes"));
  server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await mongoose.disconnect(); await mongo?.stop();
});
test("legacy main-wallet balances and counters cannot fund a commission withdrawal", async () => {
  const response = await call(manager, "/withdrawals/commission/request", intent("no-commission-custody"));
  assert.equal(response.status, 409); assert.equal(response.body.code, "INSUFFICIENT_SETTLED_COMMISSION");
  assert.equal(await W.countDocuments({ user: manager._id }), 0);
  assert.equal((await User.findById(manager._id)).walletBalance, 1234.004603467313);
});
test("a fake custody counter without immutable settled backing cannot fund a withdrawal", async () => {
  const user = await person("STATE_MANAGER");
  await M.Account.create({ _id: `beneficiary:${user._id}`, earnedKobo: 50000, availableKobo: 50000 });
  const response = await call(user, "/withdrawals/commission/request", intent("unbacked-counter"));
  assert.equal(response.status, 409); assert.equal(response.body.code, "CUSTODY_JOURNAL_RECONCILIATION_REQUIRED");
  assert.equal(await W.countDocuments({ user: user._id }), 0);
});
test("PIN-protected reservation is idempotent and never debits the main wallet", async () => {
  await credit(manager, 50000);
  const first = await call(manager, "/withdrawals/commission/request", intent("custody-reservation"));
  assert.equal(first.status, 201);
  const repeat = await call(manager, "/withdrawals/commission/request", intent("custody-reservation"));
  assert.equal(repeat.status, 200); assert.equal(repeat.body.duplicate, true);
  assert.equal(first.body.withdrawal._id, repeat.body.withdrawal._id);
  const account = (await custody.backedAccount(`beneficiary:${manager._id}`, null)).value;
  assert.equal(account.availableKobo, 40000); assert.equal(account.reservedKobo, 10000);
  assert.equal((await User.findById(manager._id)).walletBalance, 1234.004603467313);
  assert.equal(await Ledger.countDocuments({ user: manager._id }), 0);
  const otherSource = await call(manager, "/withdrawals/request", intent("custody-reservation"));
  assert.equal(otherSource.status, 409); assert.equal(otherSource.body.code, "IDEMPOTENCY_INTENT_CONFLICT");
});
test("main-wallet administrative routes cannot release commission reservations into customer wallets", async () => {
  const item = await W.findOne({ user: manager._id, idempotencyKey: "custody-reservation" });
  const rejected = await call(head, `/withdrawals/admin/${item._id}/reject`, { adminNote: "Wrong source route" });
  assert.equal(rejected.status, 404);
  assert.equal((await W.findById(item._id)).status, "PENDING");
  assert.equal((await User.findById(manager._id)).walletBalance, 1234.004603467313);
});
test("commission payout requires explicit permission, fresh authentication and bound bank confirmation", async () => {
  const item = await W.findOne({ user: manager._id, idempotencyKey: "custody-reservation" });
  const path = `/withdrawals/commission/admin/${item._id}/approve`;
  assert.equal((await call(manager, path, confirm())).status, 403);
  assert.equal((await call(wildcard, path, confirm())).status, 403);
  assert.equal((await call(head, path, { ...confirm(), currentPassword: "incorrect-password" })).status, 401);
  assert.equal((await call(head, path, { ...confirm(), manualPaymentConfirmed: false })).status, 409);
  const paid = await call(head, path, confirm());
  assert.equal(paid.status, 200); assert.equal(paid.body.withdrawal.status, "APPROVED");
  const repeated = await call(head, path, confirm());
  assert.equal(repeated.status, 200); assert.equal(repeated.body.duplicate, true);
  const account = (await custody.backedAccount(`beneficiary:${manager._id}`, null)).value;
  assert.equal(account.reservedKobo, 0); assert.equal(account.withdrawnKobo, 10000);
  assert.equal(await Claim.countDocuments({ withdrawalId: item._id }), 1);
  assert.equal((await User.findById(manager._id)).walletBalance, 1234.004603467313);
});
test("concurrent reservations cannot overdraw settled commission custody", async () => {
  const user = await person("ZONAL_MANAGER"); await credit(user, 15000);
  const responses = await Promise.all(["a", "b"].map(key =>
    call(user, "/withdrawals/commission/request", intent(`concurrent-${key}`))));
  assert.deepEqual(responses.map(row => row.status).sort(), [201, 409]);
  const account = (await custody.backedAccount(`beneficiary:${user._id}`, null)).value;
  assert.equal(account.availableKobo, 5000); assert.equal(account.reservedKobo, 10000);
});
test("rejection releases only custody once and a paid reference cannot finalize another request", async () => {
  const user = await person("STATE_MANAGER"); await credit(user, 30000);
  const first = await call(user, "/withdrawals/commission/request", intent("release-test"));
  const path = `/withdrawals/commission/admin/${first.body.withdrawal._id}`;
  const collision = await call(head, `${path}/approve`, confirm());
  assert.equal(collision.status, 409);
  const rejection = { currentPassword: password, adminNote: "Synthetic reservation cancellation" };
  assert.equal((await call(head, `${path}/reject`, rejection)).status, 200);
  const repeated = await call(head, `${path}/reject`, rejection);
  assert.equal(repeated.status, 200); assert.equal(repeated.body.duplicate, true);
  const value = (await custody.backedAccount(`beneficiary:${user._id}`, null)).value;
  assert.equal(value.availableKobo, 30000); assert.equal(value.reservedKobo, 0);
  assert.equal(await Ledger.countDocuments({ user: user._id }), 0);
});
test("canonical refund reverses reserved commission; rejection offsets debt instead of paying twice", async () => {
  const user = await person("AGENT"), customer = await person("CUSTOMER");
  const txid = await credit(user, 20000);
  const reservation = await call(user, "/withdrawals/commission/request", { ...intent("refund-reservation"), amount: 200 });
  assert.equal(reservation.status, 201);
  const debit = await Ledger.create({ user: customer._id, direction: "DEBIT", amount: 1000,
    openingBalance: 2000, closingBalance: 1000, service: "DATA", reference: `synthetic-${txid}`,
    transactionId: txid, idempotencyKey: `synthetic-debit-${txid}`, status: "POSTED" });
  const refund = await Ledger.create({ user: customer._id, direction: "CREDIT", amount: 1000,
    openingBalance: 1000, closingBalance: 2000, service: "REFUND", reference: `synthetic-refund-${txid}`,
    reversalOf: debit._id, idempotencyKey: `synthetic-refund-${txid}`, status: "POSTED" });
  await Tx.create({ _id: txid, customerId: customer._id, reference: `synthetic-${txid}`,
    serviceType: "DATA", status: "REFUNDED", amount: 1000,
    debitLedgerEntryId: debit._id, reversalLedgerEntryId: refund._id });
  assert.equal((await createEngine().reverse(txid)).status, "REVERSED");
  assert.equal((await Tx.findById(txid).lean()).providerResponse.profitSharingFence, 1);
  const path = `/withdrawals/commission/admin/${reservation.body.withdrawal._id}`;
  const attemptedPayout = await call(head, `${path}/approve`, { ...confirm("synthetic-refunded-payout"), expectedAmount: 200 });
  assert.equal(attemptedPayout.status, 409); assert.equal(attemptedPayout.body.code, "COMMISSION_RECOVERY_DEBT_OUTSTANDING");
  assert.equal((await call(head, `${path}/reject`, { currentPassword: password,
    adminNote: "Release reversed commission reservation" })).status, 200);
  const value = (await custody.backedAccount(`beneficiary:${user._id}`, null)).value;
  assert.equal(value.availableKobo, 0); assert.equal(value.reservedKobo, 0); assert.equal(value.recoveryDebtKobo, 0);
});
test("history is manager-private and Head Office reporting requires explicit permission", async () => {
  assert.equal((await call(manager, "/commissions/profit-sharing/settlements")).status, 403);
  assert.equal((await call(wildcard, "/commissions/profit-sharing/settlements")).status, 403);
  const company = await call(head, "/commissions/profit-sharing/settlements");
  assert.equal(company.status, 200); assert.equal(company.body.data.source, "FUTURE_PROFIT_SHARING_ONLY");
  const own = await reporting.own(manager, {});
  assert.equal(own.summary.companyProfitKobo, undefined);
  assert.ok(own.items.every(row => row.entries.every(entry => entry.accountId === `beneficiary:${manager._id}`)));
  await assert.rejects(reporting.history({ from: "2000-01-01", to: "2030-01-01" }),
    { code: "SELECT_A_VALID_REPORT_PERIOD_UP_TO_93_DAYS" });
});
test("unallocated custody is reported as held, never as a beneficiary credit", async () => {
  const before = await reporting.headOffice({});
  const id = new mongoose.Types.ObjectId();
  await M.Event.create({ _id: `accrual:${id}`, kind: "ACCRUAL", transaction: id,
    data: { source: "ISOLATED_TEST_FIXTURE", plan: { netProfitKobo: 1000, poolKobo: 1000 },
      entries: [{ accountId: "unallocated-commission", role: "AGGREGATOR", amountKobo: 1000 }] } });
  await M.Account.create({ _id: "unallocated-commission", earnedKobo: 1000, availableKobo: 1000 });
  const after = await reporting.headOffice({});
  assert.equal(after.summary.creditedKobo, before.summary.creditedKobo);
  assert.equal(after.summary.heldKobo, before.summary.heldKobo + 1000);
  assert.equal(after.summary.companyProfitKobo, before.summary.companyProfitKobo + 1000);
});
