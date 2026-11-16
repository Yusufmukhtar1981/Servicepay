const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const express = require("express");
const jwt = require("jsonwebtoken");
const policy = require("../services/customerExperiencePolicy");
const statements = require("../services/accountStatement.service");
const User = require("../models/user.model");
const Settings = require("../models/appSettings.model");
const Ledger = require("../models/ledgerEntry.model");
const Transaction = require("../models/transaction.model");
const Entry = require("../models/cashbackEntry.model");
const { provision } = require("../scripts/provisionCashbackStorage");
test("explicit cashback authority requires active global Head Office and never a wildcard", () => {
  const ctx = {
    user: { role: "HEAD_OFFICE", email: "rbac-admin@example.invalid" },
    staffAccess: { isHeadOffice: true, scope: { type: "GLOBAL" } },
    staffRole: { status: "ACTIVE", permissions: ["cashback.credit"] },
  };
  assert.equal(policy.isConfiguredAdmin(ctx, ""), true);
  for (const role of ["CUSTOMER", "STAFF", "CUSTOMER_SUPPORT"]) {
    assert.equal(policy.isConfiguredAdmin({ ...ctx, user: { ...ctx.user, role } }, ""), false);
  }
  assert.equal(policy.isConfiguredAdmin({ ...ctx, staffRole: { ...ctx.staffRole, status: "INACTIVE" } }, ""), false);
  assert.equal(policy.isConfiguredAdmin({ ...ctx, staffRole: { status: "ACTIVE", permissions: ["*"] } }, ""), false);
  assert.equal(policy.isConfiguredAdmin({ ...ctx, staffAccess: { isHeadOffice: true, scope: { type: "BRANCH" } } }, ""), false);
  assert.equal(policy.isConfiguredAdmin({ ...ctx, staffAccess: { isHeadOffice: false, scope: { type: "GLOBAL" } } }, ""), false);
  const registry = require("../config/staffPermissions");
  assert.equal(registry.normalizeStaffPermission("settings.edit"), "settings.update");
  assert.equal(registry.validateStaffPermissions(["settings.edit", "settings.update", "cashback.credit"]).valid, true);
});
let replica, server, base, customer, second, admin, otherAdmin, support;
const token = user => jwt.sign({ id: String(user._id), authTokenVersion: 0 }, process.env.JWT_SECRET);
const request = async (user, route, options = {}) => {
  const response = await fetch(base + route, { ...options, headers: {
    "Content-Type": "application/json", ...(user ? { Authorization: `Bearer ${token(user)}` } : {}),
    ...options.headers,
  } });
  if (response.headers.get("content-type")?.includes("application/json")) {
    return { status: response.status, body: await response.json(), response };
  }
  return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()), response };
};
before(async () => {
  assert.ok(!process.env.MONGODB_URI, "Ambient database connection must be removed before testing.");
  process.env.JWT_SECRET = "isolated-customer-experience-test-only-not-a-live-key";
  process.env.SERVICEPAY_PRODUCTION_ADMIN_EMAIL = "configured-admin@example.invalid";
  mongoose.set("autoIndex", false); mongoose.set("autoCreate", false);
  replica = await MongoMemoryReplSet.create({ binary: { version: "7.0.14" },
    replSet: { count: 1, storageEngine: "wiredTiger", args: ["--nounixsocket"] } });
  await mongoose.connect(replica.getUri(), { dbName: "customer_experience_isolated" });
  await Promise.all([User, Settings, Ledger, Transaction].map(m => m.createCollection()));
  let n = 0;
  const person = async (role, email) => {
    n++;
    const value = { _id: new mongoose.Types.ObjectId(), role, email, fullName: `Fixture ${n}`,
      phone: `0809000000${n}`, status: "ACTIVE", authTokenVersion: 0, walletBalance: 0, createdAt: new Date() };
    await User.collection.insertOne(value); return value;
  };
  customer = await person("CUSTOMER", "first@example.invalid");
  second = await person("CUSTOMER", "second@example.invalid");
  admin = await person("HEAD_OFFICE", process.env.SERVICEPAY_PRODUCTION_ADMIN_EMAIL);
  otherAdmin = await person("HEAD_OFFICE", "other-admin@example.invalid");
  support = await person("CUSTOMER_SUPPORT", "support@example.invalid");
  await Settings.collection.insertOne({ key: "GLOBAL_SETTINGS", appVersion: { latestVersion: "1.0.0" } });
  const app = express(); app.use(express.json({ limit: "32kb" }));
  app.use("/experience", require("../routes/customerExperience.routes"));
  server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/experience`;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await mongoose.disconnect(); if (replica) await replica.stop();
});
test("cashback provisioning is explicit; missing storage rejects credits without wallet changes", async () => {
  assert.equal((await provision(mongoose.connection.db)).approvalRequired, true);
  assert.equal((await mongoose.connection.db.listCollections({ name: Entry.collection.name }).toArray()).length, 0);
  const r = await request(admin, `/admin/customers/${customer._id}/cashback`, { method: "POST",
    headers: { "X-Idempotency-Key": "safe-first-request-0001" },
    body: JSON.stringify({ amountMinor: 12000, description: "Manual appreciation" }) });
  assert.equal(r.status, 503);
  assert.equal((await User.findById(customer._id).lean()).walletBalance, 0);
  assert.equal((await provision(mongoose.connection.db, { apply: true })).created, true);
});
test("only the configured Head Office administrator may credit, never Customer or Support", async () => {
  for (const actor of [customer, second, support, otherAdmin]) {
    const r = await request(actor, `/admin/customers/${customer._id}/cashback`, { method: "POST",
      headers: { "X-Idempotency-Key": "no-access-request-0001" },
      body: JSON.stringify({ amountMinor: 100, description: "Denied" }) });
    assert.equal(r.status, 403);
  }
  assert.equal((await request(null, "/cashback")).status, 401);
  assert.equal((await request(admin, "/admin/access")).body.canCreditCashback, true);
  assert.equal((await request(otherAdmin, "/admin/access")).body.canCreditCashback, false);
});
test("concurrent duplicate credit requests post exactly once with one immutable audit entry", async () => {
  const call = () => request(admin, `/admin/customers/${customer._id}/cashback`, { method: "POST",
    headers: { "X-Idempotency-Key": "concurrent-request-0001" },
    body: JSON.stringify({ amountMinor: 12345, description: "Manual appreciation" }) });
  const results = await Promise.all(Array.from({ length: 8 }, call));
  assert.equal(results.filter(r => r.status === 201).length, 1);
  assert.equal(results.filter(r => r.status === 200).length, 7);
  assert.equal(await Entry.countDocuments(), 1);
  const row = await Entry.findOne().lean();
  assert.equal(String(row.actor), String(admin._id)); assert.equal(row.actorRole, "HEAD_OFFICE");
  await assert.rejects(Entry.updateOne({ _id: row._id }, { amountMinor: 1 }), /immutable/);
  await assert.rejects(Entry.deleteMany({}), /immutable/);
});
test("same request key with altered payload is rejected, including after a lost response", async () => {
  const r = await request(admin, `/admin/customers/${customer._id}/cashback`, { method: "POST",
    headers: { "X-Idempotency-Key": "concurrent-request-0001" },
    body: JSON.stringify({ amountMinor: 12346, description: "Manual appreciation" }) });
  assert.equal(r.status, 409); assert.equal(await Entry.countDocuments(), 1);
});
test("cashback summaries, monthly/yearly totals and customer ownership are authoritative", async () => {
  const r = await request(customer, "/cashback?page=1&limit=1");
  assert.equal(r.status, 200); assert.equal(r.body.balanceMinor, 12345);
  assert.equal(r.body.monthMinor, 12345); assert.equal(r.body.yearMinor, 12345);
  assert.equal(r.body.history.length, 1); assert.equal(r.body.history[0].actorId, undefined);
  const other = await request(second, `/cashback?customerId=${customer._id}`);
  assert.equal(other.body.balanceMinor, 0);
  assert.equal((await User.findById(customer._id).lean()).walletBalance, 0);
  assert.equal(await Ledger.countDocuments(), 0); assert.equal(await Transaction.countDocuments(), 0);
});
test("negative/fractional credits, missing keys, NoSQL queries and invalid amount filters are rejected", async () => {
  for (const value of [-1, 0, 1.5, "100", 1000000001]) {
    const r = await request(admin, `/admin/customers/${customer._id}/cashback`, { method: "POST",
      headers: { "X-Idempotency-Key": "invalid-request-0001" },
      body: JSON.stringify({ amountMinor: value, description: "Invalid" }) });
    assert.equal(r.status, 400);
  }
  assert.equal((await request(customer, "/cashback?page=-1")).status, 400);
  assert.equal((await request(admin, "/admin/cashback?minMinor[$ne]=0")).status, 400);
  assert.equal((await request(admin, "/admin/cashback?minMinor=abc")).status, 400);
  assert.equal((await request(admin, "/admin/customers?q[$ne]=x")).status, 400);
});
test("reports filter by customer/amount and CSV prevents spreadsheet formula injection", async () => {
  const r = await request(admin, `/admin/cashback?customerId=${customer._id}&minMinor=12000&maxMinor=13000`);
  assert.equal(r.status, 200); assert.equal(r.body.total, 1);
  const csv = await request(admin, "/admin/cashback?format=csv");
  assert.equal(csv.status, 200); assert.match(csv.bytes.toString(), /amountMinor/);
  assert.equal(policy.csvCell("=HYPERLINK(\"bad\")").startsWith("\"'="), true);
});
test("date validation uses Lagos day boundaries and rejects invalid or reversed ranges", () => {
  const r = policy.dates("2025-01-01", "2025-01-02");
  assert.equal(r.from.toISOString(), "2024-12-31T23:00:00.000Z");
  assert.equal(r.to.toISOString(), "2025-01-02T23:00:00.000Z");
  for (const pair of [["2025-02-30", "2025-03-01"], ["2025-02-02", "2025-01-01"],
    ["2020-01-01", "2025-01-01"], ["x", "2025-01-01"]]) assert.throws(() => policy.dates(...pair));
});
test("statements reconcile immutable posted movements, preserve pending/failed status, and reject gaps", () => {
  const t = new Date("2025-01-02T12:00:00Z");
  const row = { createdAt: t, reference: "IN-1", narration: "Funding", direction: "CREDIT", amount: 100,
    openingBalance: 0, closingBalance: 100, status: "POSTED" };
  const result = statements.reconcileRows({ entries: [row], previous: null, currentPeriod: true,
    customer: { walletBalance: 100 }, transactions: [
      { reference: "IN-1", status: "SUCCESS", serviceType: "WALLET_FUNDING", createdAt: t },
      { reference: "P-1", status: "PENDING", serviceType: "DATA", createdAt: t },
      { reference: "F-1", status: "FAILED", serviceType: "AIRTIME", createdAt: t },
    ] });
  assert.equal(result.openingMinor, 0); assert.equal(result.closingMinor, 10000);
  assert.equal(result.creditsMinor, 10000); assert.equal(result.debitsMinor, 0);
  assert.equal(result.rows.find(r => r.reference === "P-1").debitMinor, 0);
  assert.equal(result.rows.find(r => r.reference === "F-1").status, "FAILED");
  assert.throws(() => statements.reconcileRows({ entries: [{ ...row, openingBalance: 1 }],
    previous: null, customer: { walletBalance: 100 }, transactions: [] }), /anchor/);
  assert.throws(() => statements.reconcileRows({ entries: [row], previous: null,
    currentPeriod: true, customer: { walletBalance: 99 }, transactions: [] }), /reconcile/);
  assert.throws(() => statements.reconcileRows({ entries: [], previous: null,
    customer: { walletBalance: 0 }, transactions: [{ reference: "OLD", status: "SUCCESS" }] }), /opening/);
});
test("PDF endpoint returns an actual branded PDF; customers cannot request another customer's statement", async () => {
  const today = new Date(Date.now() + 3600000).toISOString().slice(0, 10);
  const r = await request(customer, `/statement?start=${today}&end=${today}`);
  assert.equal(r.status, 200); assert.equal(r.bytes.subarray(0, 5).toString(), "%PDF-");
  assert.match(r.response.headers.get("content-disposition"), /\.pdf/);
  assert.equal((await request(customer, `/admin/customers/${second._id}/statement?start=${today}&end=${today}`)).status, 403);
  assert.equal((await request(admin, `/admin/customers/${second._id}/statement?start=${today}&end=${today}`)).status, 200);
});
test("legacy app-version settings remain inactive and disclose only customer-safe update fields", async () => {
  const r = await request(customer, "/app-update");
  assert.equal(r.status, 200); assert.equal(r.body.update.active, false);
  assert.equal(r.body.update.latestVersionCode, 0); assert.equal(r.body.update.playStoreUrl, policy.PLAY_URL);
  assert.equal(r.body.update.managementHistory, undefined);
});
test("cashback reporting respects Lagos month and year boundaries without moving money", async () => {
  const service = require("../services/cashback.service");
  const fixture = (suffix, createdAt, amountMinor) => ({
    _id: `boundary-${suffix}`, user: second._id, actor: admin._id,
    actorRole: "HEAD_OFFICE", reference: `CB-BOUNDARY-${suffix}`, description: "Boundary fixture",
    status: "POSTED", amountMinor, createdAt: new Date(createdAt),
  });
  await Entry.collection.insertMany([
    fixture("before-year", "2024-12-31T22:59:59Z", 100),
    fixture("new-year", "2024-12-31T23:00:00Z", 200),
    fixture("before-month", "2025-01-31T22:59:59Z", 300),
    fixture("new-month", "2025-01-31T23:00:00Z", 400),
  ]);
  const result = await service.totals({ user: second._id }, new Date("2025-02-01T12:00:00Z"));
  assert.equal(result.totalMinor, 1000); assert.equal(result.yearMinor, 900); assert.equal(result.monthMinor, 400);
  assert.equal((await User.findById(second._id).lean()).walletBalance, 0);
});
test("Head Office manages integer-code update policy; unauthorized roles and false URLs are rejected", async () => {
  const body = { active: true, latestVersion: "1.0.19", latestVersionCode: 19, minimumVersionCode: 18,
    releaseTitle: "Customer experience", releaseNotes: "New optional customer tools", forceUpdate: false,
    playStoreUrl: policy.PLAY_URL };
  assert.equal((await request(customer, "/admin/app-update", { method: "PUT", body: JSON.stringify(body) })).status, 403);
  assert.equal((await request(support, "/admin/app-update", { method: "PUT", body: JSON.stringify(body) })).status, 403);
  assert.equal((await request(admin, "/admin/app-update", { method: "PUT", body: JSON.stringify({ ...body,
    playStoreUrl: "https://example.invalid/app" }) })).status, 400);
  assert.equal((await request(admin, "/admin/app-update", { method: "PUT", body: JSON.stringify({ ...body,
    minimumVersionCode: 20 }) })).status, 400);
  const saved = await request(admin, "/admin/app-update", { method: "PUT", body: JSON.stringify(body) });
  assert.equal(saved.status, 200); assert.equal(saved.body.update.latestVersionCode, 19);
  assert.equal((await request(customer, "/app-update")).body.update.active, true);
  const settings = await Settings.findOne({ key: "GLOBAL_SETTINGS" }).lean();
  assert.equal(settings.appVersion.managementHistory.length, 1);
});
test("assigned cashback permission enables audited idempotent fixture credits and revokes when inactive", async () => {
  const Role = require("../models/role.model");
  await Role.createCollection();
  const roleId = new mongoose.Types.ObjectId();
  await Role.collection.insertOne({ _id: roleId, name: "CASHBACK_FIXTURE",
    status: "ACTIVE", department: "ADMINISTRATION", permissions: ["cashback.credit"] });
  await User.updateOne({ _id: otherAdmin._id }, { $set: { staffRoleId: roleId } });
  assert.equal((await request(otherAdmin, "/admin/access")).body.canCreditCashback, true);
  const before = (await User.findById(customer._id).lean()).walletBalance;
  const route = `/admin/customers/${customer._id}/cashback`;
  const options = { method: "POST", headers: { "X-Idempotency-Key": "rbac-fixture-credit-0001" },
    body: JSON.stringify({ amountMinor: 321, description: "Isolated RBAC fixture credit" }) };
  const first = await request(otherAdmin, route, options);
  const duplicate = await request(otherAdmin, route, options);
  assert.equal(first.status, 201);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.duplicate, true);
  assert.equal(first.body.entry.reference, duplicate.body.entry.reference);
  assert.equal(await Entry.countDocuments({ reference: first.body.entry.reference }), 1);
  const entry = await Entry.findOne({ reference: first.body.entry.reference }).lean();
  assert.equal(String(entry.actor), String(otherAdmin._id));
  assert.equal(entry.actorRole, "HEAD_OFFICE");
  assert.equal((await User.findById(customer._id).lean()).walletBalance, before);
  await Role.collection.updateOne({ _id: roleId }, { $set: { status: "INACTIVE" } });
  assert.equal((await request(otherAdmin, "/admin/access")).body.canCreditCashback, false);
  assert.equal((await request(otherAdmin, route, options)).status, 403);
});
