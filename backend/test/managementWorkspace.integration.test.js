"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
assert.equal(Boolean(process.env.MONGODB_URI), false, "Remove ambient production database credentials before running tests.");
const baseDir = process.env.MANAGEMENT_BACKEND_TEST_ROOT || path.resolve(__dirname, "..");
const mongoose = require(require.resolve("mongoose", { paths: [baseDir] }));
mongoose.set("autoIndex", false); mongoose.set("autoCreate", false);
const load = file => require(path.join(baseDir, file));
const express = require("express"), jwt = require("jsonwebtoken");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const User = load("models/user.model"), Tx = load("models/transaction.model");
const Case = load("models/fintechCase.model"), Audit = load("models/adminAuditLog.model");
const Commission = load("models/commission.model"), Withdrawal = load("models/withdrawalRequest.model");
const policy = load("services/managementWorkspacePolicy.service");
const { period } = load("services/managementPeriod.service");
const a = load("services/managementAnalytics.service");
const w = load("services/managementWorkspace.service");
const complaints = load("services/managementComplaints.service");
const support = load("controllers/support.controller");
const router = load("routes/managementWorkspace.routes");
const { protect } = load("middleware/auth.middleware");
let mongo, server, base, n = 0, f = {}, originalWallets;
const oid = () => new mongoose.Types.ObjectId();
const member = (role, data = {}) => ({
  _id: oid(), fullName: "Synthetic " + role + (++n), phone: "080" + String(n).padStart(8, "0"),
  email: "management-" + n + "@test.invalid", role, status: "ACTIVE", zone: "NORTH", state: "KADUNA",
  createdAt: new Date(), isDeleted: false, walletBalance: 4321, commissionBalance: 23, authTokenVersion: 0, ...data,
});
function tx(customer, actor, age = 2, data = {}) {
  return { _id: oid(), customerId: customer._id, agentId: actor._id, stateManagerId: actor.stateManagerId,
    zonalManagerId: actor.zonalManagerId, hierarchyCapturedAt: new Date(), reference: "SYNTH-" + (++n),
    serviceType: "DATA", status: "SUCCESSFUL", amount: 500, createdAt: new Date(Date.now() - age * policy.DAY), ...data };
}
function token(u) { return jwt.sign({ id: String(u._id), tokenVersion: 0 }, process.env.JWT_SECRET, { expiresIn: "1h" }); }
async function request(route, actor, body, method) {
  const r = await fetch(base + route, { method: method || (body ? "POST" : "GET"),
    headers: { ...(actor ? { Authorization: "Bearer " + token(actor) } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const type = r.headers.get("content-type") || "";
  return { status: r.status, type, body: type.includes("json") ? await r.json() : Buffer.from(await r.arrayBuffer()), headers: r.headers };
}
const newBody = (customer = f.active, transaction = f.txActive, extra = {}) => ({
  customerId: String(customer._id), transactionId: String(transaction._id), issueCategory: "PENDING_TRANSACTION",
  description: "Synthetic test transaction needs investigation.", idempotencyKey: "test-request-" + cryptoId(), ...extra,
});
const cryptoId = () => require("crypto").randomBytes(10).toString("hex");
test.before(async () => {
  process.env.JWT_SECRET = "synthetic-local-workspace-key-not-a-production-secret";
  mongo = await MongoMemoryReplSet.create({ binary: { systemBinary: process.env.MONGOMS_SYSTEM_BINARY },
    replSet: { count: 1, storageEngine: "wiredTiger" }, instanceOpts: [{ args: ["--nounixsocket"] }] });
  assert.match(mongo.getUri(), /^mongodb:\/\/127\.0\.0\.1:/);
  await mongoose.connect(mongo.getUri(), { dbName: "management-workspace-synthetic" });
  assert.equal(mongoose.connection.readyState, 1, "Disposable connection must be open.");
  for (const model of [User, Tx, Case, Audit, Commission, Withdrawal]) {
    assert.equal(model.db === mongoose.connection, true, model.modelName + " must use the disposable connection.");
    await mongoose.connection.db.createCollection(model.collection.name);
  }
  await Case.createIndexes(); await Withdrawal.createIndexes();
  f.z = member("ZONAL_MANAGER");
  f.s = member("STATE_MANAGER", { zonalManagerId: f.z._id });
  f.agent = member("AGENT", { stateManagerId: f.s._id, zonalManagerId: f.z._id });
  f.otherZ = member("ZONAL_MANAGER", { zone: "SOUTH", state: "LAGOS" });
  f.otherS = member("STATE_MANAGER", { zone: "SOUTH", state: "LAGOS", zonalManagerId: f.otherZ._id });
  f.otherAgent = member("AGENT", { zone: "SOUTH", state: "LAGOS", stateManagerId: f.otherS._id, zonalManagerId: f.otherZ._id });
  const links = { agentId: f.agent._id, stateManagerId: f.s._id, zonalManagerId: f.z._id, createdAt: new Date(Date.now() - 90 * policy.DAY) };
  f.active = member("CUSTOMER", { ...links, fullName: "Active Synthetic Customer", walletBalance: 9999 });
  f.declining = member("CUSTOMER", { ...links, fullName: "Declining Synthetic Customer" });
  f.inactive = member("CUSTOMER", { ...links, fullName: "Inactive Synthetic Customer" });
  f.newCustomer = member("CUSTOMER", { ...links, createdAt: new Date() });
  f.restricted = member("CUSTOMER", { ...links, status: "SUSPENDED" });
  f.foreign = member("CUSTOMER", { zone: "SOUTH", state: "LAGOS", agentId: f.otherAgent._id,
    stateManagerId: f.otherS._id, zonalManagerId: f.otherZ._id });
  f.conflict = member("CUSTOMER", { ...links, zone: "SOUTH", state: "LAGOS" });
  f.ho = member("HEAD_OFFICE");
  await User.collection.insertMany(Object.values(f));
  f.txActive = tx(f.active, f.agent); f.txForeign = tx(f.foreign, f.otherAgent);
  f.txOld = tx(f.inactive, f.agent, 75); f.txDeclining = tx(f.declining, f.agent, 45);
  f.txLegacy = tx(f.active, f.agent, 1, { hierarchyCapturedAt: null });
  f.txReversed = tx(f.inactive, f.agent, 1, { reversalReference: "REV-SYNTHETIC" });
  await Tx.collection.insertMany([f.txActive, f.txForeign, f.txOld, f.txDeclining, f.txLegacy, f.txReversed]);
  await Commission.collection.insertMany([
    { beneficiaryId: f.agent._id, beneficiaryRole: "AGENT", commissionAmount: 20, status: "AVAILABLE" },
    { beneficiaryId: f.agent._id, beneficiaryRole: "AGENT", commissionAmount: 3, status: "WITHDRAWN" },
    { beneficiaryId: f.agent._id, beneficiaryRole: "AGENT", commissionAmount: 90, status: "REVERSED" },
    { beneficiaryId: f.otherAgent._id, beneficiaryRole: "AGENT", commissionAmount: 500, status: "AVAILABLE" },
  ]);
  await Withdrawal.collection.insertMany([
    { user: f.agent._id, reference: "SYNTH-LEGACY-OWN", amount: 100, status: "APPROVED", createdAt: new Date() },
    { user: f.otherAgent._id, reference: "SYNTH-LEGACY-OTHER", amount: 500, status: "PENDING", createdAt: new Date() },
  ]);
  originalWallets = await User.find().select("_id walletBalance commissionBalance").sort({ _id: 1 }).lean();
  const app = express(); app.use(express.json({ limit: "800kb" })); app.use(protect);
  app.use("/workspace", router);
  // Existing Support handler behavior is exercised with a synthetic authorized
  // staff identity; its production permission middleware is not weakened.
  app.get("/support/tickets/:id", (req, res) => {
    req.staffAccess = { isHeadOffice: true }; return support.getAdminTicket(req, res);
  });
  app.patch("/support/tickets/:id", support.updateTicket);
  app.post("/support/tickets/:id/replies", support.adminReply);
  server = app.listen(0, "127.0.0.1"); await new Promise(r => server.once("listening", r));
  base = "http://127.0.0.1:" + server.address().port;
});
test.after(async () => {
  if (server) await new Promise(r => server.close(r));
  await mongoose.disconnect(); if (mongo) await mongo.stop();
});
test("existing rolling seven-day period uses seven Lagos calendar days", () => {
  const p = period({ period: "LAST_7_DAYS" }, new Date("2026-11-17T13:00:00Z"));
  assert.equal(p.from.toISOString(), "2026-11-10T23:00:00.000Z");
  assert.equal(p.to - p.from, 7 * policy.DAY);
});
test("activity keeps account status separate and preserves declining/new segments", () => {
  const now = new Date("2026-11-17T12:00:00Z"), ago = days => new Date(+now - days * policy.DAY);
  assert.equal(policy.activity(ago(30), ago(100), "ACTIVE", now), "ACTIVE");
  assert.equal(policy.activity(ago(45), ago(100), "ACTIVE", now), "DECLINING");
  assert.equal(policy.activity(ago(61), ago(100), "ACTIVE", now), "INACTIVE");
  assert.equal(policy.activity(null, ago(1), "ACTIVE", now), "NEW");
  assert.equal(policy.activity(ago(1), ago(100), "SUSPENDED", now), "ACTIVE");
  assert.equal(policy.activity(ago(60.9), ago(100), "ACTIVE", now), "DECLINING");
});
for (const role of ["agent", "s", "z"]) {
  test(role + " sees only its authorized customers and no wallet or legacy financial data", async () => {
    const r = await request("/workspace/customers", f[role]);
    assert.equal(r.status, 200);
    const rows = r.body.data.items, active = rows.find(c => c.id === String(f.active._id));
    assert.ok(active); assert.equal(rows.length, 5);
    assert.equal(active.transactions, 1); assert.equal(active.transactionVolume, 500);
    assert.equal("walletBalance" in active, false);
    assert.ok(!rows.some(c => [String(f.foreign._id), String(f.conflict._id)].includes(c.id)));
    assert.equal((await request("/workspace/customers/" + f.foreign._id, f[role])).status, 404);
    assert.equal((await request("/workspace/customers/" + f.foreign._id + "/transactions", f[role])).status, 404);
  });
}
test("anonymous, Customer and Head Office cannot impersonate the manager workspace", async () => {
  assert.equal((await request("/workspace/customers")).status, 401);
  assert.equal((await request("/workspace/customers", f.active)).status, 403);
  assert.equal((await request("/workspace/customers", f.ho)).status, 403);
  assert.equal((await w.customerList({ _id: f.ho._id, role: "AGENT" }).catch(e => e.status)), 403);
});
test("customer activity, search, registration filters, invalid filters and pagination work", async () => {
  const active = await request("/workspace/customers?activity=ACTIVE", f.agent);
  assert.equal(active.body.data.items.length, 1);
  const declining = await request("/workspace/customers?activity=DECLINING", f.agent);
  assert.equal(declining.body.data.items[0].id, String(f.declining._id));
  const inactive = await request("/workspace/customers?activity=INACTIVE", f.agent);
  assert.equal(inactive.body.data.items.length, 2);
  assert.equal((await request("/workspace/customers?search=" + f.active.phone, f.agent)).body.data.total, 1);
  assert.equal((await request("/workspace/customers?search=%5B.*", f.agent)).body.data.total, 0);
  const paged = await request("/workspace/customers?page=2&limit=2", f.agent);
  assert.equal(paged.body.data.items.length, 2); assert.equal(paged.body.data.total, 5);
  assert.equal((await request("/workspace/customers?registeredFrom=2026-02-31", f.agent)).status, 400);
  assert.equal((await request("/workspace/customers?page=-1", f.agent)).status, 400);
  assert.equal((await request("/workspace/customers?activity=BOGUS", f.agent)).status, 400);
});
test("CSV and Excel contain only approved contact fields and protect formulas", async () => {
  for (const format of ["csv", "xlsx"]) {
    const r = await request("/workspace/customers/export?format=" + format, f.agent);
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-disposition"), /servicepay-my-customers/);
    if (format === "csv") {
      const csv = r.body.toString(); assert.match(csv, /"Full Name","Phone Number","Email Address"/);
      assert.ok(!csv.includes("walletBalance")); assert.ok(!csv.includes(f.foreign.phone));
    } else {
      const workbook = new (require("exceljs").Workbook)(); await workbook.xlsx.load(r.body);
      assert.equal(workbook.worksheets[0].columnCount, 3);
    }
  }
  assert.match(router.csvCell("=HYPERLINK(\"bad\")"), /^"'/);
  assert.equal(await Audit.countDocuments({ action: "MANAGEMENT_CUSTOMERS_EXPORTED" }), 2);
});
test("overview, performance and transaction search return real scoped values", async () => {
  const overview = await request("/workspace/overview?period=LAST_7_DAYS", f.agent);
  assert.equal(overview.status, 200, JSON.stringify(overview.body));
  assert.equal(overview.body.data.kpis.newCustomersToday, 1);
  assert.equal(overview.body.data.kpis.availableCommission, null);
  const performance = await request("/workspace/performance?period=LAST_7_DAYS&sort=transactionVolume", f.agent);
  assert.equal(performance.status, 200, JSON.stringify(performance.body));
  assert.equal(performance.body.data.items[0].id, String(f.active._id));
  assert.equal(performance.body.data.items[0].transactionVolume, 500);
  assert.ok(performance.body.data.stopped.some(r => r.id === String(f.declining._id)));
  const search = await request("/workspace/customers/" + f.active._id + "/transactions?search=" + f.txActive.reference, f.agent);
  assert.equal(search.body.data.total, 1);
  assert.equal((await request("/workspace/customers?search=" + f.active.email, f.agent)).body.data.total, 1);
});
test("withdrawals show recorded earnings but never fabricate withdrawable or paid balances", async () => {
  const r = await request("/workspace/withdrawals?user=" + f.otherAgent._id, f.agent);
  assert.equal(r.status, 200);
  assert.equal(r.body.data.summary.totalCommissionEarned, 23);
  assert.equal(r.body.data.summary.availableCommission, null);
  assert.equal(r.body.data.summary.totalWithdrawn, null);
  assert.equal(r.body.data.readiness.enabled, false);
  assert.equal(r.body.data.legacyWalletWithdrawals.length, 1);
  assert.equal(r.body.data.legacyWalletWithdrawals[0].reference, "SYNTH-LEGACY-OWN");
});
test("simultaneous duplicate or excess commission payout attempts fail closed without debits", async () => {
  const before = await Withdrawal.countDocuments();
  const attempts = await Promise.all(Array.from({ length: 8 }, () => request("/workspace/withdrawals", f.agent,
    { amount: 999999, bankName: "Test", accountNumber: "0000000000", idempotencyKey: "same-request-key" })));
  attempts.forEach(r => { assert.equal(r.status, 503); assert.equal(r.body.code, "WITHDRAWAL_INDEXES_NOT_READY"); });
  assert.equal(await Withdrawal.countDocuments(), before);
});
test("manager complaint creation records actual transaction context, audit and existing Support integration", async () => {
  const payload = newBody(f.active, f.txActive, { amount: 999999, customerName: "FORGED", status: "RESOLVED" });
  const r = await request("/workspace/complaints", f.agent, payload);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  f.caseId = r.body.data.id; f.payload = payload;
  assert.equal(r.body.data.status, "OPEN");
  assert.equal(r.body.data.transactionContext.amount, 500);
  assert.equal(r.body.data.customer.fullName, f.active.fullName);
  assert.equal(await Audit.countDocuments({ action: "FINTECH_CASE_CREATED" }), 1);
  const admin = await request("/support/tickets/" + f.caseId, f.ho);
  assert.equal(admin.status, 200); assert.equal(admin.body.data.managementIssueCategory, "PENDING_TRANSACTION");
});
test("complaint duplicate races, intent conflicts and transaction ownership are enforced", async () => {
  const dup = await Promise.all(Array.from({ length: 5 }, () => request("/workspace/complaints", f.agent, f.payload)));
  dup.forEach(r => assert.equal(r.status, 200));
  const logical = await request("/workspace/complaints", f.agent, { ...f.payload, idempotencyKey: "different-request-" + cryptoId() });
  assert.equal(logical.status, 200);
  assert.equal(await Case.countDocuments(), 1);
  assert.equal((await request("/workspace/complaints", f.agent, { ...f.payload, description: "Different body with an old key." })).status, 409);
  assert.equal((await request("/workspace/complaints", f.s, newBody())).status, 409);
  assert.equal((await request("/workspace/complaints", f.agent, newBody(f.active, f.txForeign))).status, 404);
  assert.equal((await request("/workspace/complaints", f.agent, newBody(f.active, f.txLegacy))).status, 404);
  assert.equal((await request("/workspace/complaints", f.agent, newBody(f.foreign, f.txForeign))).status, 404);
});
test("complaint list/detail and replies are submitter-private, bounded and idempotent", async () => {
  assert.equal((await request("/workspace/complaints", f.agent)).body.data.total, 1);
  assert.equal((await request("/workspace/complaints", f.s)).body.data.total, 0);
  assert.equal((await request("/workspace/complaints/" + f.caseId, f.s)).status, 404);
  const body = { message: "Additional synthetic evidence.", idempotencyKey: "reply-request-" + cryptoId() };
  const r = await request("/workspace/complaints/" + f.caseId + "/replies", f.agent, body);
  assert.equal(r.status, 200); assert.equal(r.body.data.replies.length, 1);
  const again = await request("/workspace/complaints/" + f.caseId + "/replies", f.agent, body);
  assert.equal(again.status, 200); assert.equal(again.body.data.replies.length, 1);
  assert.equal((await request("/workspace/complaints/" + f.caseId + "/replies", f.agent,
    { ...body, message: "Changed payload with the same key." })).status, 409);
});
test("screenshots are private, validated and available to existing Admin Support", async () => {
  const image = { name: "../screenshot.png", dataUrl: "data:image/png;base64," + Buffer.from("89504e470d0a1a0a00000000", "hex").toString("base64") };
  const r = await request("/workspace/complaints", f.agent, newBody(f.declining, f.txDeclining, { attachments: [image] }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const caseId = r.body.data.id;
  assert.equal(r.body.data.attachments.length, 1); assert.ok(!r.body.data.attachments[0].name.includes("/"));
  assert.equal((await request("/workspace/complaints/" + caseId, f.otherAgent)).status, 404);
  assert.equal((await request("/support/tickets/" + caseId, f.ho)).body.data.managementAttachments.length, 1);
  const list = await request("/workspace/complaints", f.agent);
  assert.ok(!JSON.stringify(list.body).includes("data:image"));
  assert.throws(() => policy.attachments([{ name: "bad.svg", dataUrl: "data:image/svg+xml;base64,AAAA" }]));
  assert.throws(() => policy.attachments([{ name: "bad.png", dataUrl: "data:image/png;base64,PHNjcmlwdD4=" }]));
  assert.throws(() => policy.attachments(Array(3).fill(image)));
  assert.throws(() => policy.attachments([{ name: "large.png", dataUrl: "data:image/png;base64," + "A".repeat(349532) }]));
});
test("Support response and resolution are tracked without resolving payments or changing wallets", async () => {
  const response = await request("/support/tickets/" + f.caseId + "/replies", f.ho,
    { message: "We are investigating this synthetic case.", idempotencyKey: "admin-reply-" + cryptoId() });
  assert.equal(response.status, 201);
  const update = await request("/support/tickets/" + f.caseId, f.ho, { status: "RESOLVED", resolution: "Synthetic test closed without funds movement." }, "PATCH");
  assert.equal(update.status, 200, JSON.stringify(update.body));
  const own = await request("/workspace/complaints/" + f.caseId, f.agent);
  assert.equal(own.body.data.status, "RESOLVED"); assert.equal(own.body.data.replies.length, 2);
  assert.equal((await request("/workspace/complaints/" + f.caseId + "/replies", f.agent,
    { message: "Must not reopen a closed case.", idempotencyKey: "closed-reply-" + cryptoId() })).status, 409);
});
test("reassignment immediately revokes the former manager's complaint and customer access", async () => {
  await User.collection.updateOne({ _id: f.declining._id }, { $set: { agentId: f.otherAgent._id,
    stateManagerId: f.otherS._id, zonalManagerId: f.otherZ._id, zone: "SOUTH", state: "LAGOS" } });
  const r = await request("/workspace/complaints", f.agent);
  assert.equal(r.body.data.total, 1);
  assert.equal((await request("/workspace/customers/" + f.declining._id, f.agent)).status, 404);
  assert.equal((await request("/workspace/complaints", f.otherAgent)).body.data.total, 0);
});
test("required existing Support indexes are inspected, never silently created", async () => {
  await Case.collection.dropIndex("idempotencyKey_1");
  const r = await request("/workspace/complaints", f.agent, newBody(f.inactive, f.txOld));
  assert.equal(r.status, 503); assert.equal(r.body.code, "SUPPORT_INDEXES_NOT_READY");
  assert.equal(await Case.countDocuments(), 2);
  await Case.createIndexes(); // Disposable test database only.
});
test("manager workspace exposes only backed future custody and submits through the existing PIN withdrawal flow", async () => {
  const M = load("models/profitSharing.models"), N = load("models/businessNetwork.models");
  const Claim = load("models/withdrawalPayoutClaim.model");
  for (const model of [M.Account, M.Event, N.Audit, Claim]) await model.createCollection();
  await Withdrawal.createIndexes(); await Claim.createIndexes();
  load("services/withdrawalIndexReadiness.service").clearWithdrawalIndexReadinessCache();
  const actor = await User.findById(f.agent._id);
  actor.setTransactionPin("2468"); await actor.save({ validateBeforeSave: false });
  const accountId = `beneficiary:${actor._id}`;
  await M.Account.create({ _id: accountId, earnedKobo: 10000, availableKobo: 10000 });
  await M.Event.create({ _id: `accrual:${f.txActive._id}`, kind: "ACCRUAL", transaction: f.txActive._id,
    data: { source: "ISOLATED_TEST_FIXTURE", plan: { netProfitKobo: 10000, poolKobo: 10000 },
      entries: [{ accountId, role: "AGGREGATOR", amountKobo: 10000 }] } });
  const before = await request("/workspace/withdrawals?limit=1", f.agent);
  assert.equal(before.status, 200); assert.equal(before.body.data.summary.availableCommission, 100);
  assert.equal(before.body.data.summary.totalCommissionEarned, 23);
  assert.equal(before.body.data.summary.futureSettledCommissionEarned, 100);
  assert.equal(before.body.data.readiness.canRequest, true);
  assert.equal(before.body.data.commissionHistory[0].amountKobo, 10000);
  const body = { amount: 100, bankName: "Synthetic Bank", accountNumber: "0000000001",
    accountName: "Synthetic Account", transactionPin: "2468", idempotencyKey: "manager-backed-custody" };
  const submitted = await request("/workspace/withdrawals", f.agent, body);
  assert.equal(submitted.status, 201);
  assert.equal(submitted.body.withdrawal.fundingSource, "COMMISSION_CUSTODY");
  const duplicate = await request("/workspace/withdrawals", f.agent, body);
  assert.equal(duplicate.status, 200); assert.equal(duplicate.body.duplicate, true);
  const after = await request("/workspace/withdrawals?limit=1", f.agent);
  assert.equal(after.body.data.summary.availableCommission, 0);
  assert.equal(after.body.data.summary.pendingWithdrawals, 100);
  assert.equal(after.body.data.items[0].reference, submitted.body.withdrawal.reference);
  assert.equal((await User.findById(actor._id)).walletBalance, 4321);
});
test("all customer balances and financial transaction records remain intact", async () => {
  const after = await User.find().select("_id walletBalance commissionBalance").sort({ _id: 1 }).lean();
  assert.deepEqual(after, originalWallets);
  assert.equal(await Tx.countDocuments(), 6);
  assert.equal((await Tx.findById(f.txActive._id).lean()).status, "SUCCESSFUL");
});
