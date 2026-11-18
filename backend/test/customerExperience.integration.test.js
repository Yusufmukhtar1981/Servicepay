"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const User = require("../models/user.model");
const Ledger = require("../models/ledgerEntry.model");
const Notification = require("../models/notification.model");
const Transaction = require("../models/transaction.model");
const { createCustomerExperience } = require("../services/customerExperience.service");
const controller = require("../controllers/customerExperience.controller");
const id = () => new mongoose.Types.ObjectId();
let mongo, user, other, now, service;
const tick = () => { now = new Date(now.getTime() + 21000); };
async function next() { tick(); return service.nextAlert(user); }
async function credit(overrides = {}) {
  const _id = id();
  const doc = {
    _id, user, direction: "CREDIT", status: "POSTED", amount: 100,
    openingBalance: 400, closingBalance: 500, currency: "NGN",
    reference: `credit-${_id}`, idempotencyKey: `credit-${_id}`,
    transactionId: null, reversalOf: null, metadata: {},
    service: "WALLET_FUNDING", createdAt: new Date(now.getTime() + 1),
    updatedAt: now, ...overrides,
  };
  await Ledger.collection.insertOne(doc);
  return doc;
}
async function call(handler, body, role = "CUSTOMER") {
  const result = { status: 200 };
  await handler({ user: { _id: user, role }, body }, {
    status(value) { result.status = value; return this; },
    json(value) { result.body = value; return this; },
  });
  return result;
}
async function withNotificationApi(run) {
  const express = require("express");
  const jwt = require("jsonwebtoken");
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "local-notification-deletion-regression-only";
  const app = express();
  app.use(express.json());
  app.use("/api/notifications", require("../routes/notification.routes"));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/notifications`;
  const headers = { Authorization: `Bearer ${jwt.sign(
    { id: String(user) }, process.env.JWT_SECRET, { expiresIn: "5m" }
  )}` };
  try {
    await run((path = "", method = "GET") => fetch(base + path, { method, headers }));
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (previous === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previous;
  }
}
test.before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(mongo.getUri(), { dbName: "customer-experience-isolated" });
  await Promise.all([User.init(), Ledger.init(), Notification.init(), Transaction.init()]);
});
test.after(async () => { await mongoose.disconnect(); await mongo.stop(); });
test.beforeEach(async () => {
  await Promise.all(["users", "ledgerentries", "notifications", "transactions"].map(
    (name) => mongoose.connection.db.collection(name).deleteMany({})));
  user = id(); other = id(); now = new Date("2026-11-18T17:00:00.000Z");
  await User.collection.insertMany([
    { _id: user, fullName: "Local test", phone: String(user), role: "CUSTOMER", status: "ACTIVE", walletBalance: 500 },
    { _id: other, fullName: "Other local test", phone: String(other), role: "CUSTOMER", status: "ACTIVE", walletBalance: 900 },
  ]);
  service = createCustomerExperience({ clock: () => now });
});
test("legacy settings preserve green branding and both audio choices default off", async () => {
  assert.deepEqual(await service.getSettings(user), {
    dashboardBackground: "green", soundNotifications: false, voiceAnnouncements: false,
  });
  assert.equal((await User.collection.findOne({ _id: user })).customerDashboardSettings, undefined);
});
test("each preference persists separately across service instances and does not change another user", async () => {
  await service.updateSettings(user, { dashboardBackground: "default" });
  await service.updateSettings(user, { soundNotifications: true });
  await service.updateSettings(user, { voiceAnnouncements: true });
  const fresh = createCustomerExperience();
  assert.deepEqual(await fresh.getSettings(user), {
    dashboardBackground: "default", soundNotifications: true, voiceAnnouncements: true,
  });
  await fresh.updateSettings(user, { soundNotifications: false });
  assert.equal((await fresh.getSettings(user)).voiceAnnouncements, true);
  assert.equal((await fresh.getSettings(other)).soundNotifications, false);
  assert.equal((await fresh.getSettings(other)).dashboardBackground, "green");
});
test("preference validation refuses financial fields, identities, nulls and coercion", async () => {
  for (const input of [{ walletBalance: 999 }, { user: other }, { soundNotifications: "true" },
    { voiceAnnouncements: 1 }, { dashboardBackground: "red" }, {}, [], null,
    { "customerDashboardSettings.soundNotifications": true }]) {
    await assert.rejects(() => service.updateSettings(user, input));
  }
  assert.equal((await User.collection.findOne({ _id: user })).walletBalance, 500);
});
test("normal model serialization does not expose private settings or delivery state", async () => {
  await service.updateSettings(user, { voiceAnnouncements: true });
  await service.nextAlert(user);
  const value = await User.findById(user).lean();
  assert.equal(value.customerDashboardSettings, undefined);
  assert.equal(value.walletCreditAlertsStartedAt, undefined);
  assert.equal(value.walletCreditAlertsLastPollAt, undefined);
});
test("inactive and non-customer accounts cannot use settings or claim credits", async () => {
  for (const changes of [{ role: "HEAD_OFFICE" }, { role: "STATE_MANAGER" }, { role: "CUSTOMER", status: "SUSPENDED" }]) {
    await User.collection.updateOne({ _id: user }, { $set: changes });
    await assert.rejects(() => service.getSettings(user), { status: 403 });
    await assert.rejects(() => service.updateSettings(user, { soundNotifications: true }), { status: 403 });
    await assert.rejects(() => next(), { status: 403 });
  }
});
test("first use establishes one baseline without announcing historical ledger credits", async () => {
  await credit({ createdAt: new Date(now.getTime() - 10000) });
  const attempts = await Promise.all(Array.from({ length: 6 }, () => service.nextAlert(user)));
  assert.ok(attempts.every((r) => r.alert === null));
  tick();
  assert.equal((await service.nextAlert(user)).alert, null);
  assert.equal(await Notification.countDocuments(), 0);
});
test("a posted credit returns amount, original date/reference and current authoritative balance", async () => {
  await service.nextAlert(user);
  const row = await credit();
  const result = await next();
  assert.equal(result.alert.id, String(row._id));
  assert.equal(result.alert.amount, 100);
  assert.equal(result.alert.balance, 500);
  assert.equal(result.alert.creditBalance, 500);
  assert.equal(result.alert.reference, row.reference);
  assert.equal(+result.alert.createdAt, +row.createdAt);
  const notification = await Notification.findOne().lean();
  assert.equal(notification.userId.toString(), user.toString());
  assert.equal(notification.isRead, false);
  assert.equal(notification.referenceType, "WALLET_CREDIT_ALERT");
});
test("refresh, a fresh login/device service and parallel claims never repeat a ledger credit", async () => {
  await service.nextAlert(user); await credit(); tick();
  const results = await Promise.all(Array.from({ length: 8 }, () => service.nextAlert(user)));
  assert.equal(results.filter((r) => r.alert).length, 1);
  tick();
  assert.equal((await createCustomerExperience({ clock: () => now }).nextAlert(user)).alert, null);
  assert.equal(await Notification.countDocuments(), 1);
});
test("server throttles repeated cross-tab polls before ledger discovery", async () => {
  await service.nextAlert(user); await credit();
  assert.equal((await service.nextAlert(user)).alert, null);
  assert.ok((await next()).alert);
});
test("received transfer and manual funding credits use their own ledger identity", async () => {
  await service.nextAlert(user);
  const transactionId = id();
  await Transaction.collection.insertOne({ _id: transactionId, user: other, status: "SUCCESSFUL" });
  const a = await credit({ service: "TRANSFER", transactionId });
  const b = await credit({ service: "MANUAL_FUNDING" });
  const results = [await next(), await next()];
  assert.deepEqual(new Set(results.map((r) => r.alert.id)), new Set([String(a._id), String(b._id)]));
});
test("pending, failed, unknown, refunded and missing associated transactions are never announced", async () => {
  await service.nextAlert(user);
  for (const status of ["PENDING", "FAILED", "UNKNOWN", "REVERSED"]) {
    const transactionId = id();
    await Transaction.collection.insertOne({ _id: transactionId, status, reference: `local-${transactionId}` });
    await credit({ transactionId });
  }
  const refunded = id();
  await Transaction.collection.insertOne({ _id: refunded, status: "SUCCESSFUL", refundedAt: now, reference: `local-${refunded}` });
  await credit({ transactionId: refunded });
  await credit({ transactionId: id() });
  const outcome = await next();
  const unexpectedLedger = outcome.alert
    ? await Ledger.collection.findOne({ _id: new mongoose.Types.ObjectId(outcome.alert.id) }) : null;
  const unexpectedTransaction = unexpectedLedger?.transactionId
    ? await Transaction.collection.findOne({ _id: unexpectedLedger.transactionId }) : null;
  assert.equal(outcome.alert, null, JSON.stringify({ unexpectedTransaction }));
  assert.equal(await Notification.countDocuments(), 0);
});
test("late confirmed transactions can be discovered without replaying already announced credits", async () => {
  await service.nextAlert(user);
  const transactionId = id();
  await Transaction.collection.insertOne({ _id: transactionId, status: "PENDING" });
  const pending = await credit({ transactionId });
  const successful = await credit();
  assert.equal((await next()).alert.id, String(successful._id));
  await Transaction.collection.updateOne({ _id: transactionId }, { $set: { status: "SUCCESSFUL" } });
  assert.equal((await next()).alert.id, String(pending._id));
});
test("immutable reversal counterentry excludes the original posted credit", async () => {
  await service.nextAlert(user);
  const row = await credit();
  await credit({ direction: "DEBIT", amount: 100, openingBalance: 500, closingBalance: 400, reversalOf: row._id });
  await credit({ status: "REVERSED" });
  assert.equal((await next()).alert, null);
  assert.equal((await Ledger.collection.findOne({ _id: row._id })).status, "POSTED");
});
test("debits, refund reversal rows and non-main-wallet credits are excluded", async () => {
  await service.nextAlert(user);
  await credit({ direction: "DEBIT" });
  await credit({ reversalOf: id() });
  await credit({ metadata: { walletType: "CASHBACK" } });
  await credit({ metadata: { walletType: "COMMISSION" } });
  assert.equal((await next()).alert, null);
});
test("customer isolation prevents claiming another customer's credit", async () => {
  await service.nextAlert(user); await service.nextAlert(other);
  await credit({ user: other });
  assert.equal((await next()).alert, null);
  assert.ok((await service.nextAlert(other)).alert);
});
test("provider response or transaction SUCCESSFUL alone never creates an alert", async () => {
  await service.nextAlert(user);
  await Transaction.collection.insertOne({ _id: id(), user, status: "SUCCESSFUL", amount: 100 });
  assert.equal((await next()).alert, null);
  assert.equal(await Notification.countDocuments(), 0);
});
test("reconnecting discovers late-committed older credits without a cursor gap", async () => {
  await service.nextAlert(user);
  const oldDate = new Date(now.getTime() + 1);
  const recent = await credit({ createdAt: new Date(now.getTime() + 100) });
  assert.equal((await next()).alert.id, String(recent._id));
  const late = await credit({ createdAt: oldDate });
  assert.equal((await next()).alert.id, String(late._id));
});
test("existing activity read states, wallets, transaction records and ledger bytes stay unchanged", async () => {
  await service.nextAlert(user);
  await Notification.create({ userId: user, title: "Existing", message: "Existing", isRead: false });
  await credit();
  const before = await Ledger.collection.find({}).toArray();
  await next();
  assert.deepEqual(await Ledger.collection.find({}).toArray(), before);
  assert.equal((await User.collection.findOne({ _id: user })).walletBalance, 500);
  assert.equal((await User.collection.findOne({ _id: other })).walletBalance, 900);
  assert.equal((await Notification.findOne({ title: "Existing" })).isRead, false);
});
test("a missing unique notification safeguard fails closed without creating an index or receipt", async () => {
  await service.nextAlert(user); await credit(); tick();
  await Notification.collection.dropIndex("dedupeKey_1");
  try {
    await assert.rejects(() => service.nextAlert(user), { code: "CREDIT_ALERT_DEDUPLICATION_UNAVAILABLE", status: 503 });
    assert.equal(await Notification.countDocuments(), 0);
  } finally {
    await Notification.collection.createIndex({ dedupeKey: 1 }, { unique: true, sparse: true });
  }
});
test("controllers deny staff and forged poll payloads instead of accepting client balances", async () => {
  assert.equal((await call(controller.getSettings, {}, "HEAD_OFFICE")).status, 403);
  assert.equal((await call(controller.updateSettings, { walletBalance: 9999 })).status, 400);
  assert.equal((await call(controller.nextAlert, { amount: 100, userId: String(other) })).status, 400);
  assert.equal((await call(controller.getSettings, {})).status, 200);
  assert.equal((await call(controller.updateSettings, { soundNotifications: true })).body.settings.soundNotifications, true);
});
test("a malformed historical ledger row cannot block a later valid new credit", async () => {
  await service.nextAlert(user);
  await credit({ closingBalance: 400 });
  await credit({ reference: "" });
  const good = await credit();
  assert.equal((await next()).alert.id, String(good._id));
});
test("atomic delivery deduplicates concurrent sessions even when poll throttling is removed", async () => {
  service = createCustomerExperience({ clock: () => now, pollMs: 0 });
  await service.nextAlert(user); await credit(); tick();
  const results = await Promise.all(Array.from({ length: 6 }, () => service.nextAlert(user)));
  assert.equal(results.filter((r) => r.alert).length, 1);
  assert.equal(await Notification.countDocuments({ referenceType: "WALLET_CREDIT_ALERT" }), 1);
});
for (const scope of ["individual", "all"]) {
  test(`${scope} HTTP notification deletion retains credit receipts without replaying old money`, async () => {
    await service.nextAlert(user);
    const receipts = [];
    for (let i = 0; i < (scope === "all" ? 2 : 1); i++) {
      const posted = await credit();
      assert.equal((await next()).alert.id, String(posted._id));
      receipts.push(await Notification.findOne({ referenceId: posted._id }).lean());
    }
    const oldLedger = await Ledger.collection.find({ user }).toArray();
    const ordinary = await Notification.create({ userId: user, title: "Local ordinary notice", message: "Disposable fixture" });
    const otherNotice = await Notification.create({ userId: other, title: "Other customer", message: "Unchanged" });
    await withNotificationApi(async request => {
      const path = scope === "all" ? "" : `/${receipts[0]._id}`;
      assert.equal((await request(path, "DELETE")).status, 200);
      const listed = await (await request()).json();
      assert.equal(listed.count, scope === "all" ? 0 : 1);
      assert.equal(listed.unreadCount, scope === "all" ? 0 : 1);
      for (const receipt of receipts) {
        assert.ok(!listed.notifications.some(n => n._id === String(receipt._id)));
        assert.equal((await request(`/${receipt._id}`)).status, 404);
        assert.equal((await request(`/read/${receipt._id}`, "PUT")).status, 404);
        const retained = await Notification.collection.findOne({ _id: receipt._id });
        assert.equal(retained.dedupeKey, receipt.dedupeKey);
        assert.ok(retained.walletCreditAlertDeletedAt instanceof Date);
        assert.equal(retained.isRead, true);
      }
      assert.equal((await (await request("/unread-count")).json()).unreadCount, scope === "all" ? 0 : 1);
      assert.equal(Boolean(await Notification.findById(ordinary._id)), scope !== "all");
      assert.ok(await Notification.findById(otherNotice._id));
      // Advancing several poll periods must not replay any cleared credit.
      assert.equal((await next()).alert, null);
      assert.equal((await next()).alert, null);
      const fresh = await credit();
      assert.equal((await next()).alert.id, String(fresh._id));
    });
    assert.equal((await User.collection.findOne({ _id: user })).walletBalance, 500);
    for (const row of oldLedger) {
      assert.deepEqual(await Ledger.collection.findOne({ _id: row._id }), row);
    }
  });
}
test("HTTP deletion still removes ordinary notices and never deletes another customer's receipt", async () => {
  const own = await Notification.create({ userId: user, title: "Ordinary", message: "Disposable" });
  const protectedReceipt = await Notification.create({
    userId: other, title: "Money Received", message: "Other customer receipt",
    referenceType: "WALLET_CREDIT_ALERT", dedupeKey: `wallet-credit:${other}:${id()}`,
  });
  await withNotificationApi(async request => {
    assert.equal((await request(`/${protectedReceipt._id}`, "DELETE")).status, 404);
    assert.equal((await request(`/${own._id}`, "DELETE")).status, 200);
    assert.equal(await Notification.findById(own._id), null);
    const retained = await Notification.collection.findOne({ _id: protectedReceipt._id });
    assert.equal(retained.walletCreditAlertDeletedAt, undefined);
    assert.equal(retained.isRead, false);
  });
});
test("real notification router requires valid access tokens and binds both features to the signed-in customer", async () => {
  const express = require("express");
  const jwt = require("jsonwebtoken");
  // Disposable local server only. Never use an ambient production JWT key.
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "local-customer-experience-integration-test-only";
  const app = express();
  app.use(express.json());
  app.use("/api/notifications", require("../routes/notification.routes"));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/notifications`;
  const token = (who) => jwt.sign({ id: String(who) }, process.env.JWT_SECRET, { expiresIn: "5m" });
  try {
    assert.equal((await fetch(base + "/customer-settings")).status, 401);
    assert.equal((await fetch(base + "/wallet-credit-alerts/next", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    })).status, 401);
    const headers = { Authorization: `Bearer ${token(user)}`, "Content-Type": "application/json" };
    const saved = await fetch(base + "/customer-settings", {
      method: "PATCH", headers, body: JSON.stringify({ dashboardBackground: "default", soundNotifications: true }),
    });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).settings.dashboardBackground, "default");
    const another = await fetch(base + "/customer-settings", {
      headers: { Authorization: `Bearer ${token(other)}` },
    });
    assert.equal((await another.json()).settings.dashboardBackground, "green");
    await User.collection.updateOne({ _id: other }, { $set: { role: "HEAD_OFFICE" } });
    const forbidden = await fetch(base + "/customer-settings", {
      headers: { Authorization: `Bearer ${token(other)}` },
    });
    assert.equal(forbidden.status, 403);
    const refreshed = await fetch(base + "/customer-settings", {
      headers: { Authorization: `Bearer ${token(user)}` },
    });
    assert.equal((await refreshed.json()).settings.soundNotifications, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previous === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previous;
  }
});
