"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose"), express = require("express"), jwt = require("jsonwebtoken");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const S = require("../services/executiveControl.service");
const User = require("../models/user.model"), Transaction = require("../models/transaction.model");
const Settings = require("../models/appSettings.model"), Audit = require("../models/adminAuditLog.model");
const Role = require("../models/role.model");
let replica, server, base, token, actor, customer, beforeRecords, beforeIndexes;
const id = () => new mongoose.Types.ObjectId(), now = new Date();
const req = { user: { role: "HEAD_OFFICE" }, staffAccess: { isHeadOffice: true, scope: { type: "GLOBAL" }, permissions: ["*"] } };
const call = async (path, bearer = token) => {
  const response = await fetch(base + path, { headers: bearer ? { Authorization: `Bearer ${bearer}` } : {} });
  return { status: response.status, headers: response.headers, bytes: Buffer.from(await response.arrayBuffer()) };
};
const json = result => JSON.parse(result.bytes.toString());
before(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = replica.getUri(); assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:/);
  await mongoose.connect(uri, { dbName: "executive_disposable", autoIndex: false, autoCreate: false });
  await Promise.all([User.createCollection(), Transaction.createCollection(), Settings.createCollection(), Audit.createCollection(), Role.createCollection()]);
  await Transaction.collection.createIndex({ reversedTransactionId: 1 }, { partialFilterExpression: { reversedTransactionId: { $type: "objectId" } } });
  process.env.JWT_SECRET = "local-executive-control-only";
  actor = { _id: id(), role: "HEAD_OFFICE", status: "ACTIVE", fullName: "Local Executive", tokenVersion: 0 };
  customer = { _id: id(), role: "CUSTOMER", status: "ACTIVE", fullName: "Local Customer", createdAt: now, agentId: actor._id, walletBalance: 10000 };
  await User.collection.insertMany([actor, customer]);
  await Settings.collection.insertOne({ key: "GLOBAL_SETTINGS" });
  const rows = [
    { reference: "DUP", amount: 100, status: "SUCCESSFUL", serviceType: "DATA" },
    { reference: "DUP", amount: 100, status: "SUCCESSFUL", serviceType: "DATA" },
    { reference: "FAILED", amount: 50, status: "FAILED", serviceType: "AIRTIME" },
    { reference: "PENDING", amount: 60, status: "UNKNOWN", serviceType: "ELECTRICITY" },
    { reference: "LEGACY", amount: 70, status: "ODD_STATUS", serviceType: "CABLE" },
    { reference: "FUNDING", amount: 200, status: "SUCCESSFUL", serviceType: "WALLET_FUNDING" },
    { reference: "TRANSFER", amount: 300, status: "SUCCESSFUL", serviceType: "TRANSFER" },
    { reference: "TEST", amount: 999, status: "SUCCESSFUL", serviceType: "DATA", isTest: true },
  ].map(row => ({ _id: id(), customerId: customer._id, createdAt: new Date(+now - 1000), updatedAt: now, provider: "LOCAL", ...row }));
  const original = { _id: id(), customerId: customer._id, createdAt: new Date(+now - 1000), amount: 400,
    provider: "LOCAL", reference: "ORIGINAL", serviceType: "DATA", status: "SUCCESSFUL" };
  rows.push(original, { _id: id(), customerId: customer._id, createdAt: now, amount: 400,
    reversedTransactionId: original._id, reference: "REFUND", serviceType: "REFUND", status: "SUCCESSFUL" });
  await Transaction.collection.insertMany(rows);
  beforeRecords = { users: await User.collection.find({}).sort({ _id: 1 }).toArray(), tx: await Transaction.collection.find({}).sort({ _id: 1 }).toArray() };
  beforeIndexes = await Transaction.collection.indexes();
  token = jwt.sign({ id: String(actor._id), tokenVersion: 0 }, process.env.JWT_SECRET);
  const app = express(); app.use("/executive", require("../routes/executiveControl.routes"));
  server = app.listen(0, "127.0.0.1"); await new Promise(r => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}/executive`;
});
after(async () => { if (server) await new Promise(r => server.close(r)); await mongoose.disconnect(); if (replica) await replica.stop(); });
test("all executive date presets use bounded Lagos calendar windows", () => {
  const fixed = new Date("2026-11-12T12:00:00Z");
  for (const range of ["today", "yesterday", "7d", "30d", "thisMonth", "lastMonth", "thisYear"]) {
    const p = S.period({ range }, fixed); assert(p.start < p.end && p.end <= fixed); assert.equal(p.public.timezone, "Africa/Lagos");
  }
  assert.equal(S.period({ range: "today" }, fixed).start.toISOString(), "2026-11-11T23:00:00.000Z");
  assert.equal(S.period({ range: "yesterday" }, fixed).public.to, "2026-11-11");
  for (const q of [{ range: "bad" }, { range: "custom", from: "2020-01-01", to: "2026-01-01" },
    { range: "custom", from: "2026-02-30", to: "2026-03-01" }]) assert.throws(() => S.period(q, fixed));
});
test("canonical totals deduplicate references and exclude reversals and tests", async () => {
  const tx = await S.transactions(req, { range: "today", limit: 2 });
  assert.deepEqual(tx.summary, { total: 7, successful: 3, failed: 1, pending: 1, refunded: 1, other: 1, successfulVolume: 600 });
  assert.equal(tx.items.length, 2); assert.equal(tx.pagination.total, 7);
  assert.equal(tx.services.reduce((n, r) => n + r.total, 0), 7);
  assert.equal(tx.trend.reduce((n, r) => n + r.successfulVolume, 0), 600);
});
test("server-side status/provider/service filters and pagination preserve canonicalization", async () => {
  const tx = await S.transactions(req, { serviceType: "DATA", status: "SUCCESSFUL", provider: "LOCAL" });
  assert.equal(tx.summary.successful, 1); assert.equal(tx.summary.successfulVolume, 100);
  assert.equal((await S.transactions(req, { status: "REFUNDED" })).summary.refunded, 1);
  assert.throws(() => S.filters({ provider: { $ne: null } })); assert.throws(() => S.filters({ status: "MADE_UP" }));
});
test("overview integrates exclusive customer intelligence with separate transaction volume", async () => {
  const data = json(await call("/overview?range=today&limit=1")).data;
  assert.equal(data.overview.registeredCustomers, 1); assert.equal(data.overview.successfulVolume, 600);
  assert.equal(data.customers.summary.customers, 1);
  assert.equal(data.overview.newCustomers, 1); assert(data.capabilities.export && data.capabilities.finance);
  assert.equal(data.overview.revenue, undefined); assert.equal(data.overview.profit, undefined);
  assert(data.definitions.some(x => x.includes("not earned revenue")));
});
test("anonymous/customer/ordinary operations users cannot enter executive routes", async () => {
  assert.equal((await call("/overview", null)).status, 401);
  const customerToken = jwt.sign({ id: String(customer._id), tokenVersion: 0 }, process.env.JWT_SECRET);
  assert.equal((await call("/overview", customerToken)).status, 403);
  const middleware = require("../routes/executiveControl.routes").executive;
  for (const a of [{ roleName: "OPERATIONS_MANAGER", scope: { type: "GLOBAL" }, permissions: ["operations.workspace.view"] },
    { roleName: "CUSTOMER_SUPPORT", scope: { type: "GLOBAL" }, permissions: ["users.view"] },
    { isHeadOffice: true, scope: { type: "STATE" }, permissions: ["*"] }]) {
    let denied; middleware({ user: { isStaff: true }, staffAccess: a }, { status: n => ({ json: () => { denied = n; } }) }, () => assert.fail("Denied role admitted"));
    assert.equal(denied, 403);
  }
});
test("explicit global administrators can view but cannot infer finance/export grants", async () => {
  const permissions = ["executive.control_center.view", "users.view", "transactions.view"];
  const a = { scope: { type: "GLOBAL" }, permissions }, request = { user: { isStaff: true }, staffAccess: a };
  let passed = false;
  require("../routes/executiveControl.routes").executive(request, {}, () => { passed = true; }); assert(passed);
  assert.deepEqual(S.capabilities(request), { finance: false, export: false });
  await assert.rejects(S.finance(request), /Head Office finance/);
});
test("field reporting reuses current assigned-agent records without inventing BRM/CM", async () => {
  const result = await call("/field?dimension=agent&range=today"); assert.equal(result.status, 200);
  const bad = await call("/field?dimension=BRM"); assert.equal(bad.status, 400);
});
test("finance reuses actual accounting and explicitly labels missing custody and net profit", async () => {
  const data = await S.finance(req, { range: "today" });
  assert.equal(data.walletLiabilities, null); assert.equal(data.settlementLiabilities, null);
  assert.equal(data.transactionRows, undefined); assert(data.methodology.length > 0);
  await assert.rejects(S.finance(req, { provider: "LOCAL" }), /clear provider\/status/);
});
test("health observes database and recorded evidence without provider calls or raw metadata", async () => {
  const data = json(await call("/health")).data;
  assert.equal(data.database.status, "CONNECTED"); assert.equal(data.backend.status, "AVAILABLE");
  assert(data.providers.every(p => p.responseTimeMs === null && p.status === "NOT_ACTIVELY_PROBED"));
  assert.equal(data.webhooks.status, "UNAVAILABLE");
  assert(!JSON.stringify(data).includes("tokenVersion"));
});
test("marketing fails closed on missing permission or unprovisioned existing storage", async () => {
  await assert.rejects(S.marketing({ staffAccess: { permissions: [] } }), /Marketing reporting permission/);
  const before = (await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name).sort();
  const response = await call("/marketing");
  assert.equal(response.status, 503);
  assert.match(json(response).message, /not provisioned/);
  assert.deepEqual((await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name).sort(), before);
});
test("CSV/XLSX/PDF exports are actual audited binaries with no customer contacts", async () => {
  for (const [format, magic] of [["csv", "\uFEFF"], ["xlsx", "PK"], ["pdf", "%PDF"]]) {
    const result = await call("/report?kind=business&format=" + format);
    assert.equal(result.status, 200); assert(result.bytes.toString().startsWith(magic));
    assert(result.headers.get("content-disposition").endsWith(`.${format}"`));
    assert(!result.bytes.includes(Buffer.from("walletBalance")));
  }
  assert.equal(await Audit.countDocuments({ action: "EXECUTIVE_REPORT_EXPORTED" }), 3);
  assert.equal((await call("/report?format=exe")).status, 400);
});
test("read-only reporting preserves all customer/wallet/transaction records and indexes", async () => {
  assert.deepEqual(await User.collection.find({}).sort({ _id: 1 }).toArray(), beforeRecords.users);
  assert.deepEqual(await Transaction.collection.find({}).sort({ _id: 1 }).toArray(), beforeRecords.tx);
  assert.deepEqual(await Transaction.collection.indexes(), beforeIndexes);
});
