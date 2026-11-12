"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const express = require("express");
const jwt = require("jsonwebtoken");
const I = require("../services/customerIntelligence.service");
const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const Settings = require("../models/appSettings.model");
const Audit = require("../models/adminAuditLog.model");
const Role = require("../models/role.model");
let replica, server, base, token, customers, staff, originalWallets, originalTransactions, indexes;
const now = new Date(), days = n => new Date(+now - n * I.DAY);
const req = { staffAccess: { scope: { type: "GLOBAL" } } };
const id = () => new mongoose.Types.ObjectId();
const headers = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
const get = async path => {
  const r = await fetch(base + path, { headers: headers() });
  return { status: r.status, body: await r.json() };
};
before(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = replica.getUri();
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:/);
  await mongoose.connect(uri, { dbName: "customer_intelligence_disposable", autoIndex: false, autoCreate: false });
  await Promise.all([User.createCollection(), Transaction.createCollection(), Settings.createCollection(), Audit.createCollection()]);
  // Match the production safeguard, including its partial predicate.
  await Transaction.collection.createIndex({ reversedTransactionId: 1 }, { partialFilterExpression: { reversedTransactionId: { $type: "objectId" } } });
  process.env.JWT_SECRET = "disposable-local-customer-intelligence-only";
  staff = { _id: id(), role: "HEAD_OFFICE", status: "ACTIVE", fullName: "Local Administrator", tokenVersion: 0, sessionVersion: 0 };
  customers = Array.from({ length: 9 }, (_, i) => ({ _id: id(), role: "CUSTOMER", status: "ACTIVE",
    fullName: `Local Person ${i}`, phone: `08000000${100 + i}`, email: `local${i}@example.invalid`,
    state: i === 8 ? "Kano" : "Kaduna", zone: "North", lga: "Local LGA", createdAt: days(i === 6 ? 1 : 120),
    agentId: staff._id, walletBalance: 12345, password: "NEVER_EXPORT", transactionPin: "NEVER_EXPORT" }));
  await User.collection.insertMany([staff, ...customers]);
  await Settings.collection.insertOne({ key: "GLOBAL_SETTINGS", applicationName: "Preserved", unrelated: { preserve: true } });
  const rows = [];
  let serial = 0;
  function tx(customer, age, extra = {}) {
    const result = { _id: id(), reference: `LOCAL-INTELLIGENCE-${++serial}`, customerId: customer._id, status: "SUCCESSFUL",
      amount: 100, serviceType: "DATA", createdAt: days(age), updatedAt: days(age), ...extra };
    rows.push(result); return result;
  }
  for (let i = 0; i < 10; i++) tx(customers[0], 1 + i);
  for (let i = 0; i < 4; i++) tx(customers[1], 1 + i, { serviceType: "AIRTIME" });
  tx(customers[2], 10);
  tx(customers[3], 45);
  tx(customers[4], 70);
  tx(customers[6], 0.5);
  tx(customers[7], 80); tx(customers[7], 1);
  const reversed = tx(customers[8], 1);
  tx(customers[8], 0.5, { serviceType: "REFUND", reversedTransactionId: reversed._id });
  tx(customers[2], 2, { status: "FAILED", amount: 200 });
  tx(customers[2], 1, { status: "PENDING", amount: 300 });
  tx(customers[2], 1, { status: "UNRECOGNIZED_LEGACY", amount: 400 });
  const duplicate = tx(customers[2], 3, { amount: 50 });
  tx(customers[2], 3, { reference: duplicate.reference, amount: 50 });
  tx(customers[2], 1, { reversalReference: "LOCAL-REVERSAL", amount: 999 });
  tx(customers[2], 1, { isTest: true, amount: 999 });
  await Transaction.collection.insertMany(rows);
  originalWallets = await User.find({ role: "CUSTOMER" }).select("_id walletBalance").sort({ _id: 1 }).lean();
  originalTransactions = await Transaction.collection.find({}).sort({ _id: 1 }).toArray();
  indexes = await Transaction.collection.indexes();
  token = jwt.sign({ id: String(staff._id), tokenVersion: 0 }, process.env.JWT_SECRET, { expiresIn: "1h" });
  const app = express(); app.use(express.json());
  app.use("/api/admin/customer-intelligence", require("../routes/customerIntelligence.routes"));
  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/admin/customer-intelligence`;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await mongoose.disconnect(); if (replica) await replica.stop();
});
test("exclusive classification boundaries and configurable thresholds", () => {
  for (const [count, recentCount, age, expected] of [
    [0, 0, null, "NEVER"], [10, 10, 1, "FREQUENT"], [9, 9, 1, "REGULAR"],
    [4, 4, 1, "REGULAR"], [3, 3, 1, "OCCASIONAL"], [1, 1, 30, "OCCASIONAL"],
    [1, 0, 31, "DECLINING"], [1, 0, 60, "DECLINING"], [1, 0, 61, "INACTIVE"],
  ]) assert.equal(I.classify({ count, recentCount, lastSuccess: age === null ? null : days(age) }, I.DEFAULTS, now), expected);
  assert.equal(I.classify({ count: 5, recentCount: 5 }, { ...I.DEFAULTS, frequentMin: 5 }, now), "FREQUENT");
  assert.throws(() => I.settings({ regularMin: 10 }));
  assert.throws(() => I.settings({ activityDays: 60, inactiveDays: 60 }));
});
test("date presets and validation use Lagos and reject invalid/custom ranges", () => {
  for (const range of ["today", "7d", "30d", "90d", "thisMonth", "lastMonth"]) {
    const r = I.range({ range }, now); assert.ok(r.start < r.end); assert.ok(r.end <= now);
  }
  assert.throws(() => I.range({ range: "custom", from: "2026-02-30", to: "2026-03-01" }, now));
  assert.throws(() => I.page({ limit: 101 }));
  assert.throws(() => I.selection({ minValue: 99, maxValue: 1 }));
  assert.throws(() => I.selection({ status: "SUCCESS" }));
});
test("reporting scopes fail closed", () => {
  assert.throws(() => I.scope({}), /scope/);
  assert.throws(() => I.scope({ staffAccess: { scope: { type: "CUSTOM" } } }));
  assert.throws(() => I.scope({ staffAccess: { scope: { type: "STATE", state: "Kaduna" } } }));
  assert.deepEqual(I.scope({ staffAccess: { scope: { type: "ZONE", zone: "North" } } }), { zone: "North" });
});
test("actual Mongo aggregation counts exclusive segments, duplicate references and reversals", async () => {
  const built = I.pipeline(req, { range: "30d" }, I.DEFAULTS, now);
  const [r] = await User.aggregate([...built.stages, I.facets({ limit: 100 })]);
  assert.equal(r.total[0].count, 9);
  const byId = new Map(r.items.map(x => [String(x._id), x]));
  assert.deepEqual(customers.map(x => byId.get(String(x._id)).category),
    ["FREQUENT", "REGULAR", "OCCASIONAL", "DECLINING", "INACTIVE", "NEVER", "OCCASIONAL", "OCCASIONAL", "NEVER"]);
  const c = byId.get(String(customers[2]._id));
  assert.equal(c.successful.count, 2); assert.equal(c.successful.value, 150);
  assert.deepEqual(c.failed, { count: 1, value: 200 });
  assert.deepEqual(c.pending, { count: 1, value: 300 });
  assert.deepEqual(c.other, { count: 1, value: 400 });
  assert.equal(c.refunded.count, 1);
  const s = r.summary[0];
  assert.equal(s.frequent + s.regular + s.occasional + s.declining + s.inactive + s.never, 9);
  assert.equal(s.newCustomers, 1); assert.equal(s.reactivated, 1);
  assert.equal(r.topCount[0].successful.count, 10);
});
test("combined filters, service/customer semantics and server pagination", async () => {
  const result = await get("/customers?category=REGULAR&serviceType=AIRTIME&state=Kaduna&minCount=4&maxCount=9&limit=1");
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.data.pagination.total, 1);
  assert.equal(result.body.data.items[0]._id, String(customers[1]._id));
  const all = await get("/customers?limit=2&page=2");
  assert.equal(all.body.data.items.length, 2); assert.equal(all.body.data.pagination.totalPages, 5);
  const empty = await get("/customers?state=Nonexistent"); assert.equal(empty.body.data.pagination.total, 0);
  const invalid = await get("/customers?agentId=bad"); assert.equal(invalid.status, 400);
});
test("profile history, status totals, services and timeline have safe fields only", async () => {
  const result = await get(`/customers/${customers[2]._id}?limit=2`);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.data.transactions.length, 2);
  assert.ok(result.body.data.pagination.total > 2);
  assert.ok(result.body.data.frequency.length);
  assert.equal(result.body.data.customer.successful.value, 150);
  const text = JSON.stringify(result.body);
  assert.ok(!/NEVER_EXPORT|transactionPin|walletBalance|providerResponse/.test(text));
  assert.equal((await get("/customers/invalid")).status, 400);
});
test("workforce statistics are real grouped customer assignments, not duplicate records", async () => {
  const r = await get("/performance?dimension=agent");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.items[0].registered, 9);
  assert.equal(r.body.data.items[0].transacted, 7);
  assert.equal(r.body.data.items[0].never, 2);
  assert.deepEqual(r.body.data.unavailableDimensions, ["BRM", "CM"]);
  assert.equal((await get("/performance?dimension=brm")).status, 400);
});
test("settings change only optional thresholds, preserves unrelated singleton and records audit", async () => {
  const r = await fetch(base + "/settings", { method: "PUT", headers: headers(),
    body: JSON.stringify({ ...I.DEFAULTS, newDays: 14, reason: "Local reporting configuration test" }) });
  assert.equal(r.status, 200, await r.text());
  const doc = await Settings.collection.findOne({ key: "GLOBAL_SETTINGS" });
  assert.equal(doc.applicationName, "Preserved"); assert.equal(doc.unrelated.preserve, true);
  assert.equal(doc.customerIntelligence.newDays, 14);
  assert.equal(await Audit.countDocuments({ action: "SYSTEM_SETTING_UPDATED" }), 1);
});
test("CSV, Excel and PDF export use selected filters and contact-only original binaries", async () => {
  for (const format of ["csv", "xlsx", "pdf"]) {
    const r = await fetch(base + "/export", { method: "POST", headers: headers(),
      body: JSON.stringify({ filters: { category: "REGULAR" }, allFiltered: true, format, action: "download" }) });
    assert.equal(r.status, 200, r.status === 200 ? "" : await r.text());
    const bytes = Buffer.from(await r.arrayBuffer());
    assert.ok(r.headers.get("content-disposition").includes(`.${format}`));
    if (format === "pdf") assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
    if (format === "xlsx") assert.equal(bytes.subarray(0, 2).toString(), "PK");
    if (format === "csv") {
      const text = bytes.toString("utf8"); assert.match(text, /Full Name/); assert.match(text, /Local Person 1/);
      assert.ok(!text.includes("Local Person 0")); assert.ok(!/NEVER_EXPORT|wallet|reference|12345/.test(text));
    }
  }
  const rejected = await fetch(base + "/export", { method: "POST", headers: headers(),
    body: JSON.stringify({ filters: { category: "REGULAR" }, ids: [String(customers[0]._id)], format: "csv", action: "download" }) });
  assert.equal(rejected.status, 400);
});
test("campaign preparation never dispatches or claims consent", async () => {
  const r = await fetch(base + "/campaign-preview", { method: "POST", headers: headers(),
    body: JSON.stringify({ filters: { category: "INACTIVE" }, allFiltered: true, purpose: "REACTIVATE", message: "Local test campaign draft only." }) });
  assert.equal(r.status, 200);
  const body = await r.json(); assert.equal(body.data.selectedCount, 1);
  assert.equal(body.data.dispatchEnabled, false); assert.equal(body.data.excludedOptOuts, null);
  assert.match(body.data.warning, /Consent and opt-out evidence are unavailable/);
});
test("unauthenticated and customer accounts cannot access analytics", async () => {
  assert.equal((await fetch(base + "/customers")).status, 401);
  const customerToken = jwt.sign({ id: String(customers[0]._id), tokenVersion: 0 }, process.env.JWT_SECRET);
  assert.equal((await fetch(base + "/customers", { headers: { Authorization: `Bearer ${customerToken}` } })).status, 403);
});
test("explicit Marketing reporting permissions preserve scope and do not grant exports or settings", async () => {
  await Role.createCollection();
  const roleId = id(), personId = id();
  await Role.collection.insertOne({ _id: roleId, name: "MARKETING_TEST_LOCAL", displayName: "Local Marketing",
    department: "MARKETING", status: "ACTIVE", scopeType: "STATE", permissions: ["marketing.customer_intelligence.view"] });
  await User.collection.insertOne({ _id: personId, role: "STAFF", isStaff: true, department: "MARKETING",
    status: "ACTIVE", staffRoleId: roleId, zone: "North", state: "Kaduna" });
  const localToken = jwt.sign({ id: String(personId) }, process.env.JWT_SECRET);
  const h = { Authorization: `Bearer ${localToken}`, "Content-Type": "application/json" };
  const r = await fetch(base + "/customers", { headers: h });
  assert.equal(r.status, 200, await r.clone().text());
  const data = (await r.json()).data;
  assert.equal(data.pagination.total, 8); assert.equal(data.capabilities.canExport, false);
  assert.equal((await fetch(base + `/customers/${customers[8]._id}`, { headers: h })).status, 404);
  for (const [route, method, body] of [
    ["/export", "POST", { format: "csv", action: "download", allFiltered: true }],
    ["/settings", "PUT", { ...I.DEFAULTS, reason: "Unauthorized settings attempt" }],
    ["/campaign-preview", "POST", { allFiltered: true, purpose: "WELCOME", message: "Draft only please" }],
  ]) assert.equal((await fetch(base + route, { method, headers: h, body: JSON.stringify(body) })).status, 403);
  await Role.collection.updateOne({ _id: roleId }, { $set: { permissions: [
    "marketing.customer_intelligence.view", "marketing.customer_intelligence.export", "marketing.campaigns.manage",
  ] } });
  const exported = await fetch(base + "/export", { method: "POST", headers: h,
    body: JSON.stringify({ filters: { state: "Kano" }, allFiltered: true, format: "csv", action: "download" }) });
  assert.equal(exported.status, 400);
  const campaign = await fetch(base + "/campaign-preview", { method: "POST", headers: h,
    body: JSON.stringify({ filters: { category: "INACTIVE" }, allFiltered: true, purpose: "REACTIVATE", message: "Draft only please" }) });
  assert.equal(campaign.status, 200);
  assert.equal((await campaign.json()).data.dispatchEnabled, false);
});
test("customer wallets, transactions and indexes are byte-for-byte unchanged", async () => {
  assert.deepEqual(await User.find({ role: "CUSTOMER" }).select("_id walletBalance").sort({ _id: 1 }).lean(), originalWallets);
  assert.deepEqual(await Transaction.collection.find({}).sort({ _id: 1 }).toArray(), originalTransactions);
  assert.deepEqual(await Transaction.collection.indexes(), indexes);
});
