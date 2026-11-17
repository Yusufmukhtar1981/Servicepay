"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const { period, targetPeriod } = require("../services/managementPeriod.service");
const analytics = require("../services/managementAnalytics.service");
const targets = require("../services/managementTargets.service");
const router = require("../routes/managementAnalytics.routes");
const { protect } = require("../middleware/auth.middleware");
const User = require("../models/user.model");
const Tx = require("../models/transaction.model");
const Commission = require("../models/commission.model");
const Target = require("../models/dashboardTarget.model");
let mongo, server, base, f = {}, sequence = 0;
const oid = () => new mongoose.Types.ObjectId();
const now = () => new Date();
const today = () => period({ period: "TODAY" });
const todayText = () => new Date(+today().from + 3600000).toISOString().slice(0, 10);
const mask = e => e && typeof e === "object" ? e.status : 0;
function user(role, data = {}) {
  return { _id: oid(), fullName: role + (++sequence), phone: "080" + String(sequence).padStart(8, "0"),
    email: `manager-${sequence}@test.invalid`, password: "not-a-real-password", role, status: "ACTIVE",
    isDeleted: false, createdAt: new Date(+today().from + 10000), ...data };
}
function tx(customer, links, data = {}) {
  return { _id: oid(), reference: "safe-" + (++sequence), customerId: customer._id,
    serviceType: "DATA", amount: 100, status: "SUCCESSFUL", provider: "TELECOM_ABODE",
    createdAt: new Date(+today().from + 3600000), hierarchyCapturedAt: new Date(),
    providerResponse: { secret: "PRIVATE_PROVIDER_PAYLOAD" }, reversalReference: "", ...links, ...data };
}
const links = (zone, state, agent) => ({ zonalManagerId: zone._id, stateManagerId: state._id, agentId: agent?._id || null });
async function request(path, actor, body) {
  const response = await fetch(base + path, { method: body ? "POST" : "GET",
    headers: { ...(actor ? { Authorization: "Bearer " + jwt.sign({ id: String(actor._id) }, process.env.JWT_SECRET) } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const type = response.headers.get("content-type") || "";
  return { status: response.status, body: type.includes("json") ? await response.json() : Buffer.from(await response.arrayBuffer()), type };
}
test.before(async () => {
  assert.equal(Boolean(process.env.MONGODB_URI), false, "Ambient database must be masked.");
  process.env.JWT_SECRET = "local-management-test-only";
  mongoose.set("autoIndex", false); mongoose.set("autoCreate", false);
  mongo = await MongoMemoryReplSet.create({
    binary: { systemBinary: process.env.MONGOMS_SYSTEM_BINARY },
    replSet: { count: 1, storageEngine: "wiredTiger" }, instanceOpts: [{ args: ["--nounixsocket"] }],
  });
  const uri = mongo.getUri();
  assert.ok(/^mongodb:\/\/127\.0\.0\.1:/.test(uri), "Disposable local Mongo required.");
  await mongoose.connect(uri, { dbName: "management-analytics-tests" });
  for (const model of [User, Tx, Commission, Target]) await model.createCollection();
  await Target.createIndexes();
  f.z1 = user("ZONAL_MANAGER", { zone: "NORTH" }); f.z2 = user("ZONAL_MANAGER", { zone: "SOUTH" });
  f.s1 = user("STATE_MANAGER", { zone: "NORTH", state: "KADUNA", zonalManagerId: f.z1._id });
  f.s2 = user("STATE_MANAGER", { zone: "NORTH", state: "KANO", zonalManagerId: f.z1._id });
  f.s3 = user("STATE_MANAGER", { zone: "SOUTH", state: "LAGOS", zonalManagerId: f.z2._id });
  f.a1 = user("AGENT", { zone: "NORTH", state: "KADUNA", ...links(f.z1, f.s1) });
  f.a2 = user("AGENT", { zone: "NORTH", state: "KANO", ...links(f.z1, f.s2) });
  f.a3 = user("AGENT", { zone: "SOUTH", state: "LAGOS", ...links(f.z2, f.s3) });
  f.inactive = user("AGENT", { zone: "NORTH", state: "KADUNA", ...links(f.z1, f.s1), status: "SUSPENDED" });
  f.c1 = user("CUSTOMER", { zone: "NORTH", state: "KADUNA", fullName: "Zainab Example", ...links(f.z1, f.s1, f.a1), walletBalance: 5200 });
  f.c2 = user("CUSTOMER", { zone: "NORTH", state: "KANO", ...links(f.z1, f.s2, f.a2), walletBalance: 6200 });
  f.c3 = user("CUSTOMER", { zone: "SOUTH", state: "LAGOS", ...links(f.z2, f.s3, f.a3), walletBalance: 7200 });
  f.conflict = user("CUSTOMER", { zone: "SOUTH", state: "LAGOS", ...links(f.z2, f.s3, f.a1) });
  f.ho = user("HEAD_OFFICE");
  await User.collection.insertMany(Object.values(f));
  f.own = tx(f.c1, links(f.z1, f.s1, f.a1), { reference: "needle-own" });
  f.foreign = tx(f.c3, links(f.z2, f.s3, f.a3), { reference: "needle-foreign", amount: 9000 });
  f.legacy = tx(f.c1, links(f.z2, f.s3, f.a3), { reference: "legacy-own", hierarchyCapturedAt: undefined });
  delete f.legacy.hierarchyCapturedAt;
  f.legacyForeign = tx(f.c3, links(f.z1, f.s1, f.a1), { reference: "legacy-foreign", hierarchyCapturedAt: null });
  await Tx.collection.insertMany([f.own, f.foreign, f.legacy, f.legacyForeign,
    tx(f.c2, links(f.z1, f.s2, f.a2), { amount: 300 }),
    ...["PENDING", "FAILED", "REFUNDED"].map(status => tx(f.c1, links(f.z1, f.s1, f.a1), { status })),
    tx(f.c1, links(f.z1, f.s1, f.a1), { reference: "after-boundary", createdAt: today().to }),
    tx(f.c1, links(f.z1, f.s1, f.a1), { reference: "before-boundary", createdAt: new Date(+today().from - 1) }),
  ]);
  await Commission.collection.insertMany([
    { _id: oid(), transactionId: f.own._id, beneficiaryId: f.a1._id, commissionAmount: 25, status: "AVAILABLE", createdAt: now() },
    { _id: oid(), transactionId: f.foreign._id, beneficiaryId: f.z2._id, commissionAmount: 9999, status: "AVAILABLE", createdAt: now() },
  ]);
  const app = express(); app.use(express.json());
  app.use("/api/management/analytics", protect, router);
  app.use("/api/management", require("../routes/management.routes"));
  server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  base = "http://127.0.0.1:" + server.address().port + "/api/management/analytics";
});
test.after(async () => { if (server) await new Promise(r => server.close(r)); await mongoose.disconnect(); if (mongo) await mongo.stop(); });

for (const preset of ["TODAY", "YESTERDAY", "THIS_WEEK", "LAST_WEEK", "THIS_MONTH", "LAST_MONTH", "LAST_30_DAYS"]) {
  test("date filter " + preset + " uses Lagos inclusive days", () => {
    const p = period({ period: preset }, new Date("2026-01-01T23:15:00Z"));
    assert.equal(p.from.getUTCHours(), 23); assert.equal(p.to.getUTCHours(), 23); assert.ok(p.to > p.from);
    assert.equal(+p.previous.to, +p.from); assert.equal(+p.previous.to - +p.previous.from, +p.to - +p.from);
  });
}
test("dates handle year/month boundaries, Monday weeks and inclusive custom end", () => {
  const p = period({ period: "LAST_MONTH" }, new Date("2026-01-17T12:00:00Z"));
  assert.equal(p.from.toISOString(), "2025-11-30T23:00:00.000Z");
  assert.equal(p.to.toISOString(), "2025-12-31T23:00:00.000Z");
  const w = period({ period: "THIS_WEEK" }, new Date("2026-11-17T12:00:00Z"));
  assert.equal(w.from.toISOString(), "2026-11-15T23:00:00.000Z");
  const c = period({ period: "CUSTOM", from: "2024-02-29", to: "2024-02-29" });
  assert.equal(+c.to - +c.from, 86400000);
  for (const q of [{ period: "CUSTOM", from: "2026-02-30", to: "2026-03-01" },
    { period: "CUSTOM", from: "2026-03-02", to: "2026-03-01" }, { period: "oops" }]) assert.throws(() => period(q));
  assert.equal(targetPeriod({ period: "MONTHLY", startDate: "2026-11-17" }).from.toISOString(), "2026-10-31T23:00:00.000Z");
});
test("all three roles see only their authorized transaction hierarchy", async () => {
  for (const [key, count] of [["z1", 6], ["s1", 5], ["a1", 5]]) {
    const r = await request("/transactions?period=TODAY", f[key]); assert.equal(r.status, 200);
    assert.equal(r.body.data.total, count);
    assert.ok(!r.body.data.items.some(t => t.reference.includes("foreign")));
    assert.ok(!JSON.stringify(r.body).includes("PRIVATE_PROVIDER_PAYLOAD"));
  }
});
test("search composes with scope and finds authorized name, phone and reference", async () => {
  for (const value of ["Zainab", f.c1.phone, "needle"]) {
    const r = await request("/transactions?period=TODAY&search=" + encodeURIComponent(value), f.z1);
    assert.equal(r.status, 200); assert.ok(r.body.data.items.some(t => t.reference === "needle-own"));
    assert.ok(!r.body.data.items.some(t => t.reference === "needle-foreign"));
  }
  const regex = await request("/transactions?period=TODAY&search=" + encodeURIComponent(".*"), f.z1);
  assert.equal(regex.body.data.total, 0);
});
test("legacy Zonal search no longer overwrites organizational scope", async () => {
  const oldBase = base; base = base.replace(/\/analytics$/, "");
  try { const r = await request("/role-transactions?search=needle", f.z1); assert.equal(r.status, 200);
    assert.deepEqual(r.body.transactions.map(t => t.reference), ["needle-own"]); }
  finally { base = oldBase; }
});
test("transaction detail denies foreign IDs and hides provider/private fields", async () => {
  assert.equal((await request("/transactions/" + f.foreign._id, f.a1)).status, 404);
  const r = await request("/transactions/" + f.own._id, f.a1);
  assert.equal(r.status, 200); assert.equal(r.body.data.transaction.customerId.phone, f.c1.phone);
  assert.equal(r.body.data.transaction.providerResponse, undefined);
});
test("filters, pagination, refunded status and exact date boundaries work", async () => {
  const page = await request("/transactions?period=TODAY&limit=2&page=2", f.s1);
  assert.equal(page.body.data.items.length, 2); assert.equal(page.body.data.totalPages, 3);
  const status = await request("/transactions?period=TODAY&status=REFUNDED", f.s1);
  assert.equal(status.body.data.total, 1);
  const custom = await request(`/transactions?period=CUSTOM&from=${todayText()}&to=${todayText()}`, f.s1);
  assert.equal(custom.body.data.total, 5);
  assert.equal((await request("/transactions?status=HACK", f.a1)).status, 400);
  assert.equal((await request("/transactions?page=1.5", f.a1)).status, 400);
});
test("overview uses real status totals, scoped commissions, weekly and monthly series", async () => {
  const r = await request("/overview?period=TODAY", f.a1); assert.equal(r.status, 200);
  const d = r.body.data;
  assert.equal(d.kpis.totalTransactions, 5); assert.equal(d.kpis.successfulTransactions, 2);
  assert.equal(d.kpis.refundedTransactions, 1); assert.equal(d.kpis.ownRecordedCommission, 25);
  assert.equal(d.kpis.totalValue, 500); assert.equal(d.kpis.totalCustomers, 1);
  assert.equal(d.weekly.reduce((s, x) => s + x.transactions, 0), 5);
  assert.equal(d.monthly.reduce((s, x) => s + x.transactions, 0), 5);
  assert.equal(d.legacyTransactions, 1); assert.equal(d.canManageTargets, false);
});
test("rankings use captured custody and do not attribute legacy values", async () => {
  const r = await request("/leaderboard?period=TODAY&sort=successfulValue", f.z1); assert.equal(r.status, 200);
  assert.equal(r.body.data.items[0].id, String(f.a2._id)); assert.equal(r.body.data.items[0].successfulValue, 300);
  const first = r.body.data.items.find(x => x.id === String(f.a1._id));
  assert.equal(first.successfulValue, 100); assert.equal(first.transactions, 4);
  assert.equal(first.achievementPercent, null);
  assert.equal((await request("/leaderboard?dimension=brm", f.z1)).status, 400);
});
test("team drill-down rejects foreign zones, states and customers, preserves inactive oversight", async () => {
  assert.equal((await request("/overview?teamId=" + f.a2._id, f.s1)).status, 404);
  assert.equal((await request("/overview?teamId=" + f.s3._id, f.z1)).status, 404);
  assert.equal((await request("/overview?teamId=" + f.c1._id, f.z1)).status, 404);
  assert.equal((await request("/overview?teamId=" + f.inactive._id, f.s1)).status, 200);
  const r = await request("/teams?period=TODAY", f.s1); assert.equal(r.status, 200);
  assert.ok(r.body.data.items.every(u => u.role === "AGENT"));
  assert.equal(r.body.data.items.find(u => String(u._id) === String(f.inactive._id)).performance.activeInPeriod, false);
});
test("unauthorized, customer and Head Office access cannot inherit this workspace", async () => {
  assert.equal((await request("/overview")).status, 401);
  assert.equal((await request("/overview", f.c1)).status, 403);
  assert.equal((await request("/overview", f.ho)).status, 403);
});
test("CSV and Excel exports keep scope and protect spreadsheet cells", async () => {
  assert.equal(router.csvCell("=SUM(1)"), "\"'=SUM(1)\"");
  const csv = await request("/export?period=TODAY&format=csv&search=needle", f.z1);
  assert.equal(csv.status, 200); assert.ok(csv.body.toString().includes("needle-own")); assert.ok(!csv.body.toString().includes("needle-foreign"));
  const xlsx = await request("/export?period=TODAY&format=xlsx", f.a1);
  assert.equal(xlsx.status, 200); assert.equal(xlsx.body.subarray(0, 2).toString(), "PK");
  const book = new (require("exceljs").Workbook)(); await book.xlsx.load(xlsx.body);
  assert.equal(book.worksheets[0].rowCount, 6);
});
test("targets respect permissions, revisions, isolated executive namespace and immutable audit history", async () => {
  await Target.create({ key: "executive", values: { customers: 123 } });
  const body = { subjectId: String(f.a1._id), period: "DAILY", startDate: todayText(), revision: 0,
    reason: "Controlled local test", values: { transactions: 10, newCustomers: 2, activeAgents: 1 } };
  assert.equal((await request("/targets", f.a1, body)).status, 403);
  assert.equal((await request("/targets", f.s2, body)).status, 404);
  const r = await request("/targets", f.s1, body); assert.equal(r.status, 200);
  assert.equal((await request("/targets", f.s1, body)).status, 409);
  const updated = await request("/targets", f.s1, { ...body, revision: 1, values: { transactions: 20 } });
  assert.equal(updated.status, 200); assert.equal(updated.body.data.revision, 2);
  const list = await request("/targets?period=TODAY", f.a1); assert.equal(list.status, 200);
  const row = list.body.data.items[0];
  assert.equal(row.management.history.length, 2); assert.equal(row.progress.transactions.actual, 5);
  assert.equal(row.progress.transactions.percent, 25);
  assert.equal((await Target.findOne({ key: "executive" }).lean()).values.customers, 123);
  const leader = await request("/leaderboard?period=TODAY&sort=transactions", f.z1);
  // Rankings intentionally exclude the legacy transaction; the denominator is
  // the exact-period target, not a fabricated target for every team.
  assert.equal(leader.body.data.items.find(i => i.id === String(f.a1._id)).achievementPercent, 20);
});
test("target uniqueness prerequisite fails closed without changing indexes", async () => {
  const original = Target.collection.indexes;
  Target.collection.indexes = async () => [{ key: { _id: 1 }, name: "_id_" }];
  try { await assert.rejects(targets.ready(), e => mask(e) === 503); }
  finally { Target.collection.indexes = original; }
});
test("all reporting preserves wallet balances and original transaction count", async () => {
  assert.equal((await User.findById(f.c1._id).lean()).walletBalance, 5200);
  assert.equal((await User.findById(f.c2._id).lean()).walletBalance, 6200);
  assert.equal(await Tx.countDocuments({}), 10);
});
test("historical transaction custody does not expose a customer's current foreign contact", () => {
  const row = { reference: "historical", customerId: { _id: f.c3._id, fullName: f.c3.fullName, phone: f.c3.phone } };
  const visible = analytics.safeCustomer(row, { ids: { customerIds: [String(f.c1._id)] } });
  assert.equal(visible.customerId.phone, "");
  assert.equal(visible.customerId.fullName, "Historical customer");
});
test("state ranking uses actual state totals rather than labelling managers as states", async () => {
  const r = await request("/leaderboard?period=TODAY&dimension=states&sort=successfulValue", f.z1);
  assert.equal(r.status, 200);
  assert.equal(r.body.data.items[0].name, "KANO");
  assert.equal(r.body.data.items[0].role, "STATE");
  assert.equal(r.body.data.items[0].successfulValue, 300);
});
