"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID, randomBytes } = require("node:crypto");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const express = require("express");
const jwt = require("jsonwebtoken");
mongoose.set("autoCreate", false); mongoose.set("autoIndex", false);
process.env.JWT_SECRET = randomBytes(32).toString("hex");
const S = require("../services/businessNetwork.service");
const { M, P, User, Transaction } = S;
const { provision } = require("../scripts/provisionBusinessNetwork");
const { createRouter } = require("../routes/businessNetwork.routes");
let repl, server, origin, users, baseline, api;
const finiteId = () => new mongoose.Types.ObjectId();
const detail = { businessName: "Sandbox Enterprise", businessCategory: "Retail", ownerName: "Sandbox Owner",
  phone: "08070000001", email: "network@example.invalid", state: "Kano", lga: "Nassarawa", address: "Sandbox business address",
  description: "Local test only", preferredServices: ["DATA", "AIRTIME"] };
const token = user => jwt.sign({ id: user._id, authTokenVersion: 0 }, process.env.JWT_SECRET, { expiresIn: "1h" });
async function call(method, path, body, actor = users.customer) {
  const r = await fetch(origin + path, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token(actor)}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = r.headers.get("content-type")?.includes("json") ? await r.json() : await r.text();
  return { status: r.status, data: data?.data, body: data };
}
async function approved(kind = "AGENT", owner = users.customer) {
  let r = await call("PUT", "/applications/" + kind, detail, owner);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const draft = r.data.profile;
  r = await call("POST", `/applications/${kind}/submit`, { revision: draft.revision }, owner);
  assert.equal(r.status, 200);
  r = await call("POST", `/admin/profiles/${draft._id}/review`, { status: "APPROVED", reason: "Verified local sandbox KYC",
    services: ["DATA", "AIRTIME"], group: "STANDARD", revision: r.data.profile.revision }, users.admin);
  assert.equal(r.status, 200, JSON.stringify(r.body)); return r.data.profile;
}
async function source(owner = users.customer, patch = {}) {
  const tx = await Transaction.create({ reference: "TEST-" + randomUUID(), customerId: owner._id, serviceType: "DATA",
    amount: 1000, servicepayProfit: 100, status: "SUCCESSFUL", provider: "TELECOM_ABODE",
    providerStatus: "SUCCESS", dispatchStatus: "SUCCEEDED", debitLedgerEntryId: finiteId(), ...patch });
  return tx;
}
async function rule(patch = {}) {
  return M.Rule.create({ service: "DATA", group: "STANDARD", mode: "FIXED", value: 500, minAmountKobo: 0,
    enabled: true, createdBy: users.admin._id, ...patch });
}
async function link(tx, kind = "AGENT", owner = users.customer) {
  return call("POST", "/transactions/" + kind, { transactionId: String(tx._id), consentAcknowledged: true }, owner);
}
test.before(async () => {
  repl = await MongoMemoryReplSet.create({ binary: { systemBinary: process.env.MONGOMS_SYSTEM_BINARY },
    replSet: { count: 1, storageEngine: "wiredTiger" } });
  const uri = repl.getUri("network_sandbox");
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:/);
  await mongoose.connect(uri, { autoCreate: false, autoIndex: false });
  await User.createCollection(); await Transaction.createCollection();
  await provision({ apply: true });
  const app = express(); app.use(express.json());
  app.use("/network", createRouter({ loadRole(req, _res, next) {
    const ho = req.user.role === "HEAD_OFFICE";
    req.staffAccess = { isHeadOffice: ho, permissions: req.user.role === "STAFF" ? ["business_network.view"] : [] };
    req.staffRole = { permissions: String(req.user._id) === String(users.finance._id) ? ["finance.approve"] : [] }; next();
  } }));
  server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  origin = `http://127.0.0.1:${server.address().port}/network`; api = app;
});
test.beforeEach(async () => {
  for (const Model of Object.values(M)) await Model.collection.deleteMany({});
  await User.deleteMany({}); await Transaction.deleteMany({});
  users = {};
  for (const [i, name, roleName] of [[1, "customer", "CUSTOMER"], [2, "other", "CUSTOMER"], [3, "admin", "HEAD_OFFICE"], [4, "finance", "HEAD_OFFICE"], [5, "staff", "STAFF"]]) {
    users[name] = await User.create({ fullName: `Sandbox ${name}`, phone: "0807000000" + i, email: `${name}@network.example.invalid`,
      password: "OnlyLocalSandbox123!", role: roleName, status: "ACTIVE", kycVerified: true, walletBalance: 4321.12 });
  }
  baseline = (await User.find().select("_id walletBalance role authTokenVersion").sort("_id").lean());
});
test.afterEach(async () => {
  assert.deepEqual(await User.find().select("_id walletBalance role authTokenVersion").sort("_id").lean(), baseline,
    "Network operations must not mutate wallets, authentication or user roles");
});
test.after(async () => { await new Promise(resolve => server?.close(resolve)); await mongoose.disconnect(); await repl?.stop(); });
test("unauthenticated access is rejected by existing JWT middleware", async () => {
  const r = await fetch(origin + "/me"); assert.equal(r.status, 401);
});
test("separate Agent and Merchant applications preserve the Customer identity", async () => {
  await approved("AGENT"); await approved("MERCHANT");
  const r = await call("GET", "/me");
  assert.equal(r.data.applications.length, 2); assert.deepEqual(r.data.features, P.features);
  assert.notEqual(r.data.applications[0].networkId, r.data.applications[1].networkId);
});
test("application cannot self-approve or mass-assign privilege fields", async () => {
  assert.equal((await call("PUT", "/applications/AGENT", { ...detail, status: "APPROVED" })).status, 400);
  const p = await approved();
  assert.equal((await call("POST", `/admin/profiles/${p._id}/review`, { status: "SUSPENDED", reason: "Not authorized", revision: p.revision })).status, 403);
});
test("submission checks required fields and optimistic revision", async () => {
  const r = await call("PUT", "/applications/AGENT", { businessName: "Incomplete" });
  assert.equal((await call("POST", "/applications/AGENT/submit", { revision: r.data.profile.revision })).status, 400);
  assert.equal((await call("PUT", "/applications/AGENT", { ...detail, revision: 999 })).status, 409);
});
test("approval requires existing verified KYC, without triggering identity verification", async () => {
  await User.updateOne({ _id: users.customer._id }, { $set: { kycVerified: false } });
  let r = await call("PUT", "/applications/AGENT", detail);
  r = await call("POST", "/applications/AGENT/submit", { revision: r.data.profile.revision });
  r = await call("POST", `/admin/profiles/${r.data.profile._id}/review`, { status: "APPROVED", revision: r.data.profile.revision, reason: "Review only", services: ["DATA"] }, users.admin);
  assert.equal(r.status, 409); assert.equal(r.body.code, "NETWORK_KYC_REQUIRED");
});
test("suspension blocks access; reactivation does not authorize purchases in the suspension gap", async () => {
  const p = await approved();
  let r = await call("POST", `/admin/profiles/${p._id}/review`, { status: "SUSPENDED", revision: p.revision, reason: "Sandbox suspension" }, users.admin);
  assert.equal(r.status, 200); assert.equal((await call("GET", "/dashboard/AGENT")).status, 403);
  const tx = await source();
  r = await call("POST", `/admin/profiles/${p._id}/review`, { status: "APPROVED", revision: r.data.profile.revision, reason: "Sandbox restoration", services: ["DATA"] }, users.admin);
  assert.equal(r.status, 200); assert.equal((await link(tx)).status, 403);
});
test("other customers cannot inspect or attribute another owner's purchases", async () => {
  const p = await approved(); await approved("AGENT", users.other);
  assert.equal((await call("GET", `/dashboard/AGENT?profileId=${p._id}`, null, users.other)).status, 403);
  assert.equal((await link(await source(users.other))).status, 403);
});
test("non-Head Office explicit read permission never provides global scope or review authority", async () => {
  const p = await approved();
  const list = await call("GET", "/admin/profiles", null, users.staff);
  assert.equal(list.status, 200); assert.equal(list.data.total, 0);
  assert.equal((await call("GET", `/admin/profiles/${p._id}`, null, users.staff)).status, 404);
  assert.equal((await call("POST", `/admin/profiles/${p._id}/review`, { status: "SUSPENDED", revision: p.revision, reason: "Unauthorized" }, users.staff)).status, 403);
});
test("own-wallet attribution requires consent and is idempotent without new payment records", async () => {
  await approved(); const tx = await source();
  assert.equal((await call("POST", "/transactions/AGENT", { transactionId: String(tx._id) })).status, 400);
  assert.equal((await link(tx)).status, 201); assert.equal((await link(tx)).status, 200);
  assert.equal(await M.Activity.countDocuments(), 1); assert.equal(await Transaction.countDocuments(), 1);
});
test("confirmed provider success accrues one margin-bounded commission", async () => {
  await approved(); await rule(); const tx = await source();
  const r = await link(tx); assert.equal(r.status, 201, JSON.stringify(r.body));
  await S.reconcileActivity(r.data.activity._id); await S.reconcileActivity(r.data.activity._id);
  const rows = await M.Ledger.find().lean(); assert.equal(rows.length, 1); assert.equal(rows[0].amountKobo, 500);
  assert.equal((await call("GET", "/commissions/AGENT")).data.totals.pendingKobo, 500);
});
test("pending, failed, timeout and unknown outcomes never accrue or alter the source outcome", async () => {
  await approved(); await rule();
  for (const status of ["PENDING", "FAILED", "SUCCESSFUL"]) {
    const tx = await source(users.customer, { status, providerStatus: "UNKNOWN", dispatchStatus: "UNKNOWN" });
    assert.equal((await link(tx)).status, 201);
    assert.equal((await Transaction.findById(tx._id)).status, status);
  }
  assert.equal(await M.Ledger.countDocuments(), 0);
});
test("a later authenticated-success fixture is reconciled without replaying a purchase", async () => {
  await approved(); await rule(); const tx = await source(users.customer, { status: "PENDING", providerStatus: "UNKNOWN", dispatchStatus: "UNKNOWN" });
  const r = await link(tx); assert.equal(await M.Ledger.countDocuments(), 0);
  await Transaction.updateOne({ _id: tx._id }, { $set: { status: "SUCCESSFUL", providerStatus: "SUCCESS", dispatchStatus: "SUCCEEDED" } });
  await S.reconcileActivity(r.data.activity._id);
  assert.equal(await M.Ledger.countDocuments({ event: "ACCRUAL" }), 1); assert.equal(await Transaction.countDocuments(), 1);
});
test("refund creates one compensating commission row without deleting history", async () => {
  await approved(); await rule(); const tx = await source(); const r = await link(tx);
  await Transaction.updateOne({ _id: tx._id }, { $set: { status: "REFUNDED", reversalLedgerEntryId: finiteId() } });
  await S.reconcileActivity(r.data.activity._id); await S.reconcileActivity(r.data.activity._id);
  assert.equal(await M.Ledger.countDocuments(), 2);
  const totals = (await call("GET", "/commissions/AGENT")).data.totals;
  assert.equal(totals.earnedKobo, 500); assert.equal(totals.reversedKobo, 500); assert.equal(totals.pendingKobo, 0);
});
test("manual settlement requires explicit finance permission, is idempotent and never sends money", async () => {
  const p = await approved(); await rule(); const tx = await source(); await link(tx);
  const entry = await M.Ledger.findOne({ event: "ACCRUAL" });
  const body = { profileId: p._id, commissionIds: [String(entry._id)], reference: "SANDBOX-MANUAL-REFERENCE",
    paidAt: new Date().toISOString(), reason: "Recorded sandbox transfer evidence", confirmation: true };
  assert.equal((await call("POST", "/admin/commissions/settle", body, users.admin)).status, 403);
  let r = await call("POST", "/admin/commissions/settle", body, users.finance);
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.data.moneySent, false); assert.equal(r.data.providerVerified, false);
  r = await call("POST", "/admin/commissions/settle", body, users.finance);
  assert.equal(r.status, 200); assert.equal(await M.Ledger.countDocuments({ event: "SETTLEMENT" }), 1);
});
test("paid commission reversal remains a recovery liability, not a wallet deduction", async () => {
  const p = await approved(); await rule(); const tx = await source(); const result = await link(tx);
  const entry = await M.Ledger.findOne({ event: "ACCRUAL" });
  assert.equal((await call("POST", "/admin/commissions/settle", { profileId: p._id, commissionIds: [String(entry._id)],
    reference: "SANDBOX-PAID", paidAt: new Date().toISOString(), reason: "Sandbox proof", confirmation: true }, users.finance)).status, 200);
  await Transaction.updateOne({ _id: tx._id }, { $set: { status: "REFUNDED" } });
  await S.reconcileActivity(result.data.activity._id);
  assert.equal((await call("GET", "/commissions/AGENT")).data.totals.recoveryKobo, 500);
});
test("a future commission rule cannot rewrite old purchases", async () => {
  await approved(); const tx = await source(); await new Promise(resolve => setTimeout(resolve, 5)); await rule();
  assert.equal((await link(tx)).status, 201); assert.equal(await M.Ledger.countDocuments(), 0);
});
test("disabling a rule preserves eligibility for purchases during its effective period", async () => {
  await approved(); const configured = await rule(); const tx = await source(users.customer, { status: "PENDING", providerStatus: "UNKNOWN", dispatchStatus: "UNKNOWN" });
  const r = await link(tx);
  assert.equal((await call("PATCH", `/admin/rules/${configured._id}`, { enabled: false }, users.finance)).status, 200);
  await Transaction.updateOne({ _id: tx._id }, { $set: { status: "SUCCESSFUL", providerStatus: "SUCCESS", dispatchStatus: "SUCCEEDED" } });
  await S.reconcileActivity(r.data.activity._id); assert.equal(await M.Ledger.countDocuments({ event: "ACCRUAL" }), 1);
});
test("Merchant staff must accept invitations and remain isolated to the assigned branch", async () => {
  const p = await approved("MERCHANT");
  const branch = (await call("POST", `/profiles/${p._id}/branches`, { name: "Test branch", address: "Sandbox address" })).data.branch;
  const staff = (await call("POST", `/profiles/${p._id}/staff`, { userId: String(users.other._id), branchId: branch._id, permissions: ["reports"] })).data.staff;
  assert.equal((await call("GET", `/dashboard/MERCHANT?profileId=${p._id}`, null, users.other)).status, 403);
  assert.equal((await call("POST", `/staff/${staff._id}/accept`, {}, users.other)).status, 200);
  assert.equal((await call("GET", `/dashboard/MERCHANT?profileId=${p._id}`, null, users.other)).status, 200);
  assert.equal((await call("GET", `/commissions/MERCHANT?profileId=${p._id}`, null, users.other)).status, 403);
  assert.equal((await call("GET", `/profiles/${p._id}/branches`, null, users.other)).status, 404);
  assert.equal((await call("PATCH", `/staff/${staff._id}`, { status: "SUSPENDED" })).status, 200);
  assert.equal((await call("GET", `/dashboard/MERCHANT?profileId=${p._id}`, null, users.other)).status, 403);
});
test("search, filtering, real CSV export and complete-period totals use only attributed records", async () => {
  await approved(); await link(await source());
  const list = await call("GET", "/admin/profiles?kind=AGENT&state=Kano&search=Sandbox", null, users.admin);
  assert.equal(list.data.total, 1);
  const summary = await call("GET", "/dashboard/AGENT?period=day");
  assert.equal(summary.data.summary.successful, 1); assert.equal(summary.data.summary.volumeKobo, 100000);
  const csv = await call("GET", "/reports/AGENT?format=csv");
  assert.equal(csv.status, 200); assert.match(csv.body, /amount_kobo/); assert.match(csv.body, /SUCCESSFUL/);
});
test("unsupported QR, Pay-by-Link and payouts cannot be enabled through settings", async () => {
  assert.equal((await call("PUT", "/admin/settings", { merchantQr: true }, users.admin)).status, 400);
  assert.equal((await call("PUT", "/admin/settings", { categories: ["Retail", "Services"] }, users.admin)).status, 200);
  assert.deepEqual((await call("GET", "/admin/settings", null, users.admin)).data.features, P.features);
});
test("policy uses integer basis points, bounds margin, and does not treat a timeout as failure", () => {
  const tx = { serviceType: "DATA", amount: 1000, servicepayProfit: 10, status: "SUCCESSFUL", dispatchStatus: "SUCCEEDED", providerStatus: "SUCCESS", debitLedgerEntryId: "fixture" };
  assert.equal(P.commission(tx, { mode: "PERCENT", value: 500, enabled: true, minAmountKobo: 0 }), 1000);
  assert.equal(P.commission({ ...tx, providerStatus: "UNKNOWN" }, { mode: "FIXED", value: 500, enabled: true }), 0);
  assert.throws(() => P.integer(1.5, "money"));
  assert.match(P.csv([{ reference: "=EVIL()", serviceType: "DATA", status: "PENDING", amountKobo: 100, createdAt: new Date() }]), /'=EVIL/);
});
test("concurrent commission reconciliation creates a single durable accrual", async () => {
  await approved(); await rule(); const tx = await source(); const result = await link(tx);
  await Promise.all([S.reconcileActivity(result.data.activity._id), S.reconcileActivity(result.data.activity._id)]);
  assert.equal(await M.Ledger.countDocuments({ event: "ACCRUAL" }), 1);
});
test("unique profile and activity indexes prevent independent duplicate claims", async () => {
  const p = await approved(); const tx = await source(); await link(tx);
  await assert.rejects(M.Profile.create({ owner: users.customer._id, kind: "AGENT" }), e => e.code === 11000);
  await assert.rejects(M.Activity.create({ profile: p._id, actor: users.customer._id, transaction: tx._id,
    consent: { acknowledged: true, acknowledgedAt: new Date() } }), e => e.code === 11000);
});
test("schema readiness verification never creates missing namespaces", async () => {
  const before = (await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()).map(x => x.name).sort();
  await S.ensureReady({ fresh: true });
  const after = (await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()).map(x => x.name).sort();
  assert.deepEqual(after, before);
});
test("business complaints reuse existing customer support tickets and request idempotency", async () => {
  const body = { kind: "AGENT", subject: "Sandbox network assistance", message: "This is an isolated local support test.", idempotencyKey: randomUUID() };
  const result = await call("POST", "/support", body);
  assert.equal(result.status, 201, JSON.stringify(result.body));
  const duplicate = await call("POST", "/support", body);
  assert.equal(duplicate.status, 200);
  assert.equal(result.data.caseReference, duplicate.data.caseReference);
});
test("a manual bank reference cannot be reused for a different settlement", async () => {
  const p = await approved(); await rule(); await link(await source()); await link(await source());
  const rows = await M.Ledger.find({ event: "ACCRUAL" });
  const body = { profileId: p._id, commissionIds: [String(rows[0]._id)], reference: "UNIQUE-SANDBOX-BANK-REF",
    paidAt: new Date().toISOString(), reason: "Manual sandbox evidence", confirmation: true };
  assert.equal((await call("POST", "/admin/commissions/settle", body, users.finance)).status, 200);
  assert.equal((await call("POST", "/admin/commissions/settle", { ...body, commissionIds: [String(rows[1]._id)] }, users.finance)).status, 409);
  assert.equal(await M.Settlement.countDocuments(), 1);
});
test("network accounting, settlement evidence and audit history are append-only", async () => {
  await approved(); await rule(); await link(await source());
  await assert.rejects(M.Ledger.updateMany({}, { $set: { amountKobo: 123 } }), /append-only/);
  await assert.rejects(M.Audit.deleteMany({}), /append-only/);
  await assert.rejects(M.Settlement.updateMany({}, { $set: { amountKobo: 123 } }), /append-only/);
});
test("branch suspension and changed staff permissions require fresh consent", async () => {
  const p = await approved("MERCHANT");
  const branch = (await call("POST", `/profiles/${p._id}/branches`, { name: "Restricted branch", address: "Sandbox address" })).data.branch;
  const staff = (await call("POST", `/profiles/${p._id}/staff`, { userId: String(users.other._id), branchId: branch._id, permissions: ["reports"] })).data.staff;
  await call("POST", `/staff/${staff._id}/accept`, {}, users.other);
  assert.equal((await call("PATCH", `/profiles/${p._id}/branches/${branch._id}`, { status: "SUSPENDED" })).status, 200);
  assert.equal((await call("GET", `/dashboard/MERCHANT?profileId=${p._id}`, null, users.other)).status, 403);
  await call("PATCH", `/profiles/${p._id}/branches/${branch._id}`, { status: "ACTIVE" });
  assert.equal((await call("GET", `/dashboard/MERCHANT?profileId=${p._id}`, null, users.other)).status, 403);
  assert.equal((await call("PATCH", `/staff/${staff._id}`, { status: "INVITED", branchId: branch._id, permissions: ["payments"] })).status, 200);
  assert.equal((await call("GET", `/dashboard/MERCHANT?profileId=${p._id}`, null, users.other)).status, 403);
  assert.equal((await call("POST", `/staff/${staff._id}/accept`, {}, users.other)).status, 200);
  assert.equal((await call("GET", `/dashboard/MERCHANT?profileId=${p._id}`, null, users.other)).status, 403);
  assert.equal((await call("GET", `/eligible-transactions/MERCHANT?profileId=${p._id}`, null, users.other)).status, 200);
});
test("missing storage prerequisites fail closed without creating a namespace", async () => {
  const db = mongoose.connection.db, original = db.listCollections;
  const missing = M.Settings.collection.name;
  db.listCollections = function (filter, options) {
    if (filter?.name === missing) return { hasNext: async () => false };
    return original.call(this, filter, options);
  };
  try { await assert.rejects(S.ensureReady({ fresh: true }), error => error.code === "NETWORK_NOT_READY" && error.status === 503); }
  finally { db.listCollections = original; }
  assert.equal(await db.listCollections({ name: missing }).hasNext(), true);
  await S.ensureReady({ fresh: true });
});
test("KYC withdrawal blocks new business authority without hiding the owner's history", async () => {
  await approved(); await link(await source());
  await User.updateOne({ _id: users.customer._id }, { $set: { kycVerified: false } });
  assert.equal((await call("GET", "/dashboard/AGENT")).status, 403);
  assert.equal((await call("GET", "/transactions/AGENT")).status, 200);
  assert.equal((await call("GET", "/commissions/AGENT")).status, 200);
});
test("pagination and summaries cover all scoped transactions rather than the displayed page", async () => {
  const p = await approved();
  const txs = await Transaction.insertMany(Array.from({ length: 55 }, () => ({
    reference: "PAGING-" + randomUUID(), customerId: users.customer._id, serviceType: "DATA", amount: 1, status: "PENDING",
  })));
  await M.Activity.insertMany(txs.map(tx => ({ profile: p._id, transaction: tx._id, actor: users.customer._id,
    consent: { acknowledged: true, acknowledgedAt: new Date() } })));
  const first = await call("GET", "/transactions/AGENT?page=1"), second = await call("GET", "/transactions/AGENT?page=2");
  assert.equal(first.data.total, 55); assert.equal(first.data.items.length, 50); assert.equal(second.data.items.length, 5);
  assert.equal((await call("GET", "/dashboard/AGENT")).data.summary.pending, 55);
});
test("paginated commission statements retain complete totals and public transaction references", async () => {
  await approved(); await rule(); await link(await source()); await link(await source());
  const all = await M.Ledger.find({}).lean();
  const first = await call("GET", "/commissions/AGENT?limit=1"), next = await call("GET", "/commissions/AGENT?limit=1&page=2");
  assert.equal(first.data.total, 2); assert.equal(first.data.items.length, 1); assert.equal(next.data.items.length, 1);
  assert.notEqual(first.data.items[0]._id, next.data.items[0]._id);
  assert.ok(first.data.items[0].reference); assert.equal(first.data.items[0].serviceType, "DATA");
  assert.deepEqual(first.data.totals, P.totals(all));
});
