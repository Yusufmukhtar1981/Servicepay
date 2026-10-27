const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const Transaction = require("../models/transaction.model");
const User = require("../models/user.model");
const Settings = require("../models/appSettings.model");
const Audit = require("../models/adminAuditLog.model");
const svc = require("../services/customerLeaderboard.service");
const express = require("express");
const jwt = require("jsonwebtoken");
let replica, customers, server, base;
const month = "2026-09";
const date = new Date("2026-09-10T12:00:00Z");
const config = { enabled: true, eligibleServices: ["DATA", "AIRTIME", "DELIVERY"], minAmount: 0, revision: 1 };
before(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = replica.getUri();
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:/);
  await mongoose.connect(uri, { dbName: "champions_disposable", autoIndex: false });
  await Audit.createCollection();
  await Transaction.collection.createIndex({ reversedTransactionId: 1 });
  await Transaction.collection.createIndex({ reversalTransactionId: 1 });
  process.env.JWT_SECRET = "local-champions-test-only";
  const app = express();
  app.use(express.json());
  app.use("/api/customer-leaderboard", require("../routes/customerLeaderboard.routes"));
  await new Promise(resolve => {
    server = app.listen(0, "127.0.0.1", () => {
      base = `http://127.0.0.1:${server.address().port}/api/customer-leaderboard`;
      resolve();
    });
  });
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await mongoose.disconnect(); if (replica) await replica.stop();
});
beforeEach(async () => {
  // Only this disposable localhost database is cleared; production audit
  // immutability remains enforced by the unchanged application model.
  await Promise.all([Transaction.collection.deleteMany({}), User.collection.deleteMany({}), Settings.collection.deleteMany({}), Audit.collection.deleteMany({})]);
  svc.clearCache();
  customers = Array.from({ length: 14 }, (_, i) => ({
    _id: new mongoose.Types.ObjectId(), fullName: `Customer Example ${i}`,
    role: "CUSTOMER", status: "ACTIVE", phone: `0800000${String(i).padStart(4, "0")}`,
    email: `person${i}@example.invalid`, walletBalance: 123456,
  }));
  await User.collection.insertMany(customers);
  await Settings.collection.insertOne({ key: "GLOBAL_SETTINGS", customerLeaderboard: config });
});
let sequence = 0;
function tx(customer = customers[0], extra = {}) {
  return { _id: new mongoose.Types.ObjectId(), customerId: customer._id,
    reference: `CHAMPIONS-TEST-${++sequence}`, serviceType: "DATA", provider: "TEST_PROVIDER",
    providerStatus: "SUCCESSFUL", status: "SUCCESSFUL", amount: 100, createdAt: date, ...extra };
}
const report = (extra = {}) => svc.report({ month, customerId: customers[0]._id, ...extra });

test("Lagos monthly boundaries, including December/year rollover", () => {
  const p = svc.period("2025-12");
  assert.equal(p.startAt.toISOString(), "2025-11-30T23:00:00.000Z");
  assert.equal(p.endAt.toISOString(), "2025-12-31T23:00:00.000Z");
  for (const invalid of ["2026-13", "2009-12", "2999-01", "2026-1", {}, ["2026-09"]]) {
    assert.throws(() => svc.period(invalid));
  }
});
test("exact Lagos start included, exclusive end and pending/fail/refund excluded", async () => {
  const p = svc.period(month);
  await Transaction.collection.insertMany([
    tx(undefined, { createdAt: p.startAt }), tx(undefined, { createdAt: p.endAt }),
    tx(undefined, { status: "PENDING" }), tx(undefined, { status: "FAILED" }),
    tx(undefined, { status: "REFUNDED" }), tx(undefined, { amount: -1 }),
  ]);
  assert.equal((await report()).me.count, 1);
});
test("funding, withdrawals, transfers, bonuses and promotional services cannot qualify", async () => {
  await Transaction.collection.insertMany(["WALLET_FUNDING", "TRANSFER", "BANK_TRANSFER", "REFERRAL_BONUS",
    "PHONE_FINANCING_REFUND", "PROMOTIONAL_CREDIT", "EMPOWERMENT_DISBURSEMENT"].map(serviceType => tx(undefined, { serviceType })));
  assert.equal((await report()).me.count, 0);
  assert.throws(() => svc.validateSettings({ ...config, eligibleServices: ["BANK_TRANSFER"] }));
});
test("confirmed bills only; explicit unknown, pending, negative and nested reversal evidence excluded", async () => {
  await Transaction.collection.insertMany([
    tx(), tx(undefined, { providerStatus: "UNKNOWN" }),
    tx(undefined, { providerStatus: "UNKNOWN", providerResponse: { status: "successful" } }),
    tx(undefined, { providerStatus: "PENDING" }),
    tx(undefined, { dispatchStatus: "UNKNOWN" }),
    tx(undefined, { providerResponse: { data: { refundIssued: true } } }),
    tx(undefined, { providerResponse: { data: { status: "refunded" } } }),
    tx(undefined, { providerResponse: { reversal: false } }),
  ]);
  assert.equal((await report()).me.count, 3);
});
test("linked reversal records outside the month exclude the original purchase", async () => {
  const original = tx();
  await Transaction.collection.insertMany([original, tx(undefined, {
    serviceType: "PHONE_FINANCING_REFUND", reversedTransactionId: original._id,
    createdAt: new Date("2026-10-01T01:00:00Z"),
  }), tx(undefined, { reversalReference: "SAVED-REVERSAL" })]);
  assert.equal((await report()).me.count, 0);
});
test("durable provider request and idempotency identifiers deduplicate purchases", async () => {
  await Transaction.collection.insertMany([
    tx(undefined, { providerRequestId: "provider-one" }), tx(undefined, { providerRequestId: "provider-one" }),
    tx(undefined, { idempotencyKey: "intent-two" }), tx(undefined, { idempotencyKey: "intent-two" }),
    tx(), tx(),
  ]);
  assert.equal((await report()).me.count, 4);
});
test("provider namespaces and different customers do not collapse independent purchases", async () => {
  await Transaction.collection.insertMany([tx(undefined, { providerRequestId: "one" }),
    tx(customers[1], { providerRequestId: "one" }),
    tx(undefined, { providerRequestId: "one", provider: "OTHER_PROVIDER" })]);
  assert.equal((await report()).me.count, 2);
});
test("count/value rankings differ, and personal ranks beyond Top10 remain exact", async () => {
  const docs = [];
  customers.forEach((c, i) => { for (let n = 0; n <= i; n++) docs.push(tx(c, { amount: i === 0 ? 100000 : 100 })); });
  await Transaction.collection.insertMany(docs);
  const result = await report();
  assert.equal(result.countTop.length, 10);
  assert.equal(result.valueTop.length, 10);
  assert.equal(result.me.countRank, 14);
  assert.equal(result.me.valueRank, 1);
  assert.equal(result.me.count, 1);
  assert.equal(result.me.value, 100000);
  assert.equal(result.me.transactionsNeededToTop10, 5);
});
test("ties are deterministic using secondary metric, earliest activity and ID", async () => {
  await Transaction.collection.insertMany([tx(customers[0]), tx(customers[1])]);
  const a = await report(), b = await report();
  assert.deepEqual(a.countTop, b.countTop);
  assert.equal(a.countTop[0].rank, 1);
  assert.equal(a.countTop[1].rank, 2);
  assert.equal(a.me.countRank, customers[0]._id.toString() < customers[1]._id.toString() ? 1 : 2);
});
test("inactive customers, staff, deleted accounts and test records excluded", async () => {
  await User.collection.updateOne({ _id: customers[1]._id }, { $set: { role: "HEAD_OFFICE" } });
  await User.collection.updateOne({ _id: customers[2]._id }, { $set: { status: "SUSPENDED" } });
  await User.collection.updateOne({ _id: customers[3]._id }, { $set: { isDeleted: true } });
  await Transaction.collection.insertMany([tx(), tx(customers[1]), tx(customers[2]), tx(customers[3]),
    tx(undefined, { metadata: { isTest: true } })]);
  assert.equal((await report({ customerId: null, admin: true })).totalCustomers, 1);
  assert.equal((await report()).me.count, 1);
});
test("service selection and minimum amount apply identically to count, value and personal totals", async () => {
  await Settings.collection.updateOne({ key: "GLOBAL_SETTINGS" }, { $set: {
    "customerLeaderboard.eligibleServices": ["AIRTIME"], "customerLeaderboard.minAmount": 200,
  } });
  await Transaction.collection.insertMany([tx(), tx(undefined, { serviceType: "AIRTIME", amount: 199 }),
    tx(undefined, { serviceType: "AIRTIME", amount: 200 })]);
  assert.equal((await report()).me.value, 200);
});
test("privacy projection never leaks identities, contact details, balances or references", async () => {
  await Transaction.collection.insertOne(tx());
  const result = await report({ customerId: null, admin: true });
  const json = JSON.stringify(result);
  for (const secret of [customers[0].fullName, customers[0].phone, customers[0].email,
    customers[0]._id.toString(), "walletBalance", "CHAMPIONS-TEST"]) assert.ok(!json.includes(secret));
  assert.equal(result.rows[0].displayName, "C*** E***");
  assert.equal(svc.maskedName("08012345678"), "Customer ***");
});
test("disabled customer reports expose no stale rankings; admin can preview before activation", async () => {
  await Transaction.collection.insertOne(tx());
  await Settings.collection.updateOne({ key: "GLOBAL_SETTINGS" }, { $set: { "customerLeaderboard.enabled": false } });
  const result = await report();
  assert.equal(result.enabled, false);
  assert.deepEqual(result.countTop, []);
  assert.equal((await report({ customerId: null, admin: true })).totalCustomers, 1);
});
test("settings change is revision protected and audited without changing wallet/history", async () => {
  const user = customers[0];
  await Transaction.collection.insertOne(tx());
  await svc.updateSettings({ ...config, enabled: false }, { _id: user._id, role: "HEAD_OFFICE" });
  assert.equal((await svc.settings()).revision, 2);
  assert.equal(await Audit.countDocuments({ action: "SYSTEM_SETTING_UPDATED" }), 1);
  await assert.rejects(svc.updateSettings(config, { _id: user._id, role: "HEAD_OFFICE" }), /Settings changed/);
  assert.equal(await Transaction.countDocuments(), 1);
  assert.equal((await User.collection.findOne({ _id: user._id })).walletBalance, user.walletBalance);
});
test("cache shared across customers and invalidated by setting changes", async () => {
  await Transaction.collection.insertOne(tx());
  assert.equal((await report()).me.count, 1);
  await Transaction.collection.insertOne(tx());
  assert.equal((await report({ customerId: customers[1]._id })).countTop[0].count, 1);
  await svc.updateSettings(config, { _id: customers[0]._id, role: "HEAD_OFFICE" });
  assert.equal((await report()).me.count, 2);
});
test("settings cannot admit financial movements, unsafe amounts, duplicates or arbitrary keys", () => {
  for (const bad of [{ minAmount: -1 }, { minAmount: Infinity }, { minAmount: 0.001 },
    { eligibleServices: [] }, { eligibleServices: ["DATA", "DATA"] }, { reward: 2000 },
    { enabled: "true" }, { revision: "1" }]) {
    assert.throws(() => svc.validateSettings({ ...config, ...bad }));
  }
});
async function request(path = "", actor = customers[0], options = {}) {
  const token = actor && jwt.sign({ id: String(actor._id), authTokenVersion: 0 }, process.env.JWT_SECRET);
  return fetch(base + path, { ...options, headers: {
    ...(actor ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json", ...options.headers,
  } });
}
test("real middleware requires authentication, Customer role and Head Office permissions", async () => {
  assert.equal((await request("", null)).status, 401);
  assert.equal((await request("/admin")).status, 403);
  assert.equal((await request("/admin/settings")).status, 403);
  const ho = { ...customers[1], role: "HEAD_OFFICE", isStaff: true };
  await User.collection.updateOne({ _id: ho._id }, { $set: { role: ho.role, isStaff: true } });
  assert.equal((await request("", ho)).status, 403);
  assert.equal((await request("/admin/settings", ho)).status, 200);
  assert.equal((await request("/admin/history", ho)).status, 200);
  const branch = { ...customers[2], role: "BRANCH_MANAGER", isStaff: true };
  await User.collection.updateOne({ _id: branch._id }, { $set: { role: branch.role, isStaff: true } });
  assert.equal((await request("/admin", branch)).status, 403);
});
test("HTTP month/limit/sort validation and privacy-safe CSV export", async () => {
  await Transaction.collection.insertOne(tx());
  assert.equal((await request("?month[bad]=2026-09")).status, 400);
  const ho = { ...customers[1], role: "HEAD_OFFICE", isStaff: true };
  await User.collection.updateOne({ _id: ho._id }, { $set: { role: ho.role, isStaff: true } });
  assert.equal((await request("/admin?sort=other", ho)).status, 400);
  assert.equal((await request("/admin?limit=11", ho)).status, 400);
  const response = await request(`/admin/export?month=${month}&sort=value&limit=100`, ho);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/csv/);
  assert.match(response.headers.get("content-disposition"), /attachment.*\.csv/);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const csv = await response.text();
  assert.match(csv, /C\*\*\* E\*\*\*/);
  assert.ok(!csv.includes(customers[0].phone));
  assert.ok(!csv.includes(customers[0]._id.toString()));
});
test("audit failure rolls the configuration change back", async () => {
  const create = Audit.create;
  try {
    Audit.create = async () => { throw new Error("simulated audit outage"); };
    await assert.rejects(svc.updateSettings({ ...config, enabled: false }, {
      _id: customers[0]._id, role: "HEAD_OFFICE",
    }), /simulated audit outage/);
    assert.equal((await svc.settings()).enabled, true);
    assert.equal((await svc.settings()).revision, 1);
  } finally { Audit.create = create; }
});
test("contradictory false success evidence and non-finite amounts cannot inflate rankings", async () => {
  await Transaction.collection.insertMany([tx(), tx(undefined, { providerResponse: { status: false } }),
    tx(undefined, { amount: NaN }), tx(undefined, { amount: Infinity })]);
  assert.equal((await report()).me.count, 1);
});
test("unsafe cumulative kobo values fail closed rather than publish rounded totals", async () => {
  const amount = 80000000000000;
  await Transaction.collection.insertMany([tx(undefined, { amount }), tx(undefined, { amount })]);
  await assert.rejects(report(), /totals need reconciliation/);
});
test("read-only snapshot prevents new records bypassing the provider-evidence scan", async () => {
  await Transaction.collection.insertOne(tx());
  const original = Transaction.aggregate;
  let inserted = false;
  try {
    Transaction.aggregate = function (...args) {
      const aggregate = original.apply(this, args);
      const exec = aggregate.exec.bind(aggregate);
      aggregate.exec = async () => {
        if (!inserted) { inserted = true; await Transaction.collection.insertOne(tx()); }
        return exec();
      };
      return aggregate;
    };
    assert.equal((await report()).me.count, 1);
  } finally { Transaction.aggregate = original; }
  svc.clearCache();
  assert.equal((await report()).me.count, 2);
});

test("name consent defaults off, records an explicit boolean and never changes money or history", async () => {
  const id = customers[0]._id;
  const before = await User.collection.findOne({ _id: id });
  assert.equal(before.championsShowFullName, undefined);
  assert.deepEqual(await svc.privacy(id), { showFullName: false });
  assert.deepEqual(await svc.updatePrivacy(id, { showFullName: true }), { showFullName: true });
  let saved = await User.collection.findOne({ _id: id });
  assert.ok(saved.championsNameConsentUpdatedAt instanceof Date);
  assert.equal(saved.walletBalance, before.walletBalance);
  assert.equal(await Transaction.countDocuments({}), 0);
  assert.deepEqual(await svc.updatePrivacy(id, { showFullName: false }), { showFullName: false });
  assert.deepEqual(await svc.privacy(id), { showFullName: false });
});

test("opt-in and opt-out use fresh consent even with cached rankings; metrics and ranks stay identical", async () => {
  const owner = customers[13];
  await User.collection.updateOne({ _id: owner._id }, { $set: { fullName: "Aisha Mariam Bello" } });
  const purchases = customers.flatMap((customer, i) =>
    Array.from({ length: i + 1 }, () => tx(customer, { amount: i + 10 })));
  await Transaction.collection.insertMany(purchases);
  const options = { month, admin: true, sort: "value", limit: 100 };
  const before = await svc.report(options);
  const metrics = data => JSON.stringify({
    rows: data.rows.map(({ displayName, ...rest }) => rest),
    count: data.countTop.map(({ displayName, ...rest }) => rest),
    value: data.valueTop.map(({ displayName, ...rest }) => rest),
    total: data.totalCustomers,
  });
  const expected = metrics(before);
  assert.equal(before.rows[0].displayName, "A*** M***");
  await svc.updatePrivacy(owner._id, { showFullName: true });
  const consented = await svc.report(options);
  assert.equal(consented.calculatedAt, before.calculatedAt);
  assert.equal(consented.rows[0].displayName, "Aisha Mariam Bello");
  assert.equal(consented.countTop[0].displayName, "Aisha Mariam Bello");
  assert.equal(consented.valueTop[0].displayName, "Aisha Mariam Bello");
  assert.equal(metrics(consented), expected);
  const publicReport = await report();
  assert.equal(publicReport.countTop[0].displayName, "Aisha Mariam Bello");
  await svc.updatePrivacy(owner._id, { showFullName: false });
  const optedOut = await svc.report(options);
  assert.equal(optedOut.calculatedAt, before.calculatedAt);
  assert.equal(optedOut.rows[0].displayName, "A*** M***");
  assert.equal(metrics(optedOut), expected);
  assert.ok(!JSON.stringify(optedOut).includes("Aisha Mariam Bello"));
  assert.equal(await Transaction.countDocuments({}), purchases.length);
});

test("privacy HTTP controls are self-only, strict, authenticated and work while Champions is disabled", async () => {
  await Settings.collection.updateOne({ key: "GLOBAL_SETTINGS" },
    { $set: { "customerLeaderboard.enabled": false } });
  assert.equal((await request("/privacy", null)).status, 401);
  const get = await request("/privacy");
  assert.equal(get.status, 200);
  assert.equal(get.headers.get("cache-control"), "private, no-store");
  assert.deepEqual((await get.json()).data, { showFullName: false });
  for (const body of [null, [], {}, { showFullName: "true" }, { showFullName: 1 },
    { showFullName: true, customerId: String(customers[1]._id) }]) {
    assert.equal((await request("/privacy", customers[0], {
      method: "PATCH", body: JSON.stringify(body),
    })).status, 400);
  }
  assert.equal((await request("/privacy?customerId=other")).status, 400);
  assert.equal((await request("/privacy", customers[0], {
    method: "PATCH", body: '{"showFullName":true}',
  })).status, 200);
  assert.deepEqual(await svc.privacy(customers[1]._id), { showFullName: false });
  const ho = { ...customers[2], role: "HEAD_OFFICE", isStaff: true };
  await User.collection.updateOne({ _id: ho._id }, { $set: { role: ho.role, isStaff: true } });
  assert.equal((await request("/privacy", ho)).status, 403);
  assert.equal((await request("/privacy", ho, {
    method: "PATCH", body: '{"showFullName":true}',
  })).status, 403);
});

test("consent never exposes contact-like registered fields or unrelated personal information", async () => {
  for (const name of ["Customer user@example.invalid", "Customer 08033226766",
    "Customer +234 (803) 322-6766", "Customer 1234 5678 90", "Customer ٠٨٠٣٣٢٢٦٧٦٦", "https://example.invalid"]) {
    assert.equal(svc.consentedName(name, true), svc.maskedName(name));
  }
  assert.equal(svc.consentedName("Aisha Mariam Bello", "true"), "A*** M***");
  assert.equal(svc.consentedName("Aisha Mariam Bello", true), "Aisha Mariam Bello");
  await Transaction.collection.insertOne(tx());
  await svc.updatePrivacy(customers[0]._id, { showFullName: true });
  const json = JSON.stringify(await report());
  for (const secret of [customers[0].email, customers[0].phone,
    String(customers[0]._id), "walletBalance", "championsShowFullName", "championsNameConsentUpdatedAt"]) {
    assert.ok(!json.includes(secret));
  }
});

test("CSV respects current name consent and neutralizes formula-like full names", async () => {
  const ho = { ...customers[1], role: "HEAD_OFFICE", isStaff: true };
  await User.collection.updateOne({ _id: ho._id }, { $set: { role: ho.role, isStaff: true } });
  await User.collection.updateOne({ _id: customers[0]._id }, { $set: { fullName: "=SUM(1,2)" } });
  await Transaction.collection.insertOne(tx());
  await svc.updatePrivacy(customers[0]._id, { showFullName: true });
  let csv = await (await request(`/admin/export?month=${month}&limit=100`, ho)).text();
  assert.ok(csv.includes(`"'=SUM(1,2)"`));
  await svc.updatePrivacy(customers[0]._id, { showFullName: false });
  csv = await (await request(`/admin/export?month=${month}&limit=100`, ho)).text();
  assert.ok(!csv.includes("=SUM"));
  assert.match(csv, /S\*\*\*/);
});
