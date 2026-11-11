"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const express = require("express");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const User = require("../models/user.model");
const Role = require("../models/role.model");
const Audit = require("../models/adminAuditLog.model");
const Transaction = require("../models/transaction.model");
const service = require("../services/marketing.service");
const { Record } = service;
const router = require("../routes/marketing.routes");
const media = require("../services/marketingMedia.service");
const { migrate } = require("../services/marketingMigration.service");
const { STAFF_PERMISSION_VALUES } = require("../config/staffPermissions");
const headPermissions = STAFF_PERMISSION_VALUES.filter(p => p.startsWith("marketing.") &&
  !["marketing.budgets.approve", "marketing.targets.manage"].includes(p));
let mongo, server, base, seq = 0, admin, reviewer, head, officer, outsider, customer;
let campaign, budget, asset;
const storedMedia = new Map();
function key() { return "marketing_test_" + (++seq).toString().padStart(8, "0"); }
async function user(role = "CUSTOMER", extra = {}) {
  const n = ++seq;
  return User.create({ fullName: "Marketing fixture " + n, email: `marketing-${n}@example.test`,
    phone: "080" + String(n).padStart(8, "0"), password: "LocalFixture9!", role,
    status: "ACTIVE", ...extra });
}
function token(u) { return jwt.sign({ id: String(u._id), authTokenVersion: u.authTokenVersion || 0 },
  process.env.JWT_SECRET, { expiresIn: "30m" }); }
async function api(path, { actor = admin, method = "GET", body, requestKey, raw = false } = {}) {
  const headers = {};
  if (actor) headers.Authorization = "Bearer " + token(actor);
  if (body) headers["Content-Type"] = "application/json";
  if (method === "POST") headers["Idempotency-Key"] = requestKey || key();
  const response = await fetch(base + path, {
    method, headers, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (raw) return response;
  const data = await response.json();
  return { status: response.status, ...data };
}
const record = (kind, body, actor = head) => api("/records/" + kind, { method: "POST", body, actor });
const transition = (kind, row, status, actor = reviewer) => api(`/records/${kind}/${row._id}/transition`, {
  method: "POST", actor, body: { revision: row.revision, status, reason: "Reviewed fixture evidence." },
});
test.before(async () => {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.MONGODB_URI, undefined, "Tests must not inherit production connection strings.");
  media.store = async (bytes, publicId) => {
    if (!storedMedia.has(publicId)) storedMedia.set(publicId, Buffer.from(bytes));
    return { provider: "cloudinary", publicId, version: 1 };
  };
  media.retrieve = async storage => storedMedia.get(storage.publicId);
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(mongo.getUri(), { dbName: "marketing-disposable-only" });
  await Promise.all([User.init(), Role.init(), Audit.init(), Transaction.init()]);
  await Record.createCollection(); await Record.createIndexes();
  admin = await user("HEAD_OFFICE"); reviewer = await user("HEAD_OFFICE");
  const hr = await Role.create({ name: "HEAD_OF_MARKETING", displayName: "Head of Marketing",
    department: "MARKETING", permissions: headPermissions, hierarchyLevel: 60 });
  const or = await Role.create({ name: "MARKETING_OFFICER", displayName: "Marketing Officer",
    department: "MARKETING", permissions: ["marketing.view", "marketing.reports.manage",
      "marketing.content.manage", "marketing.budgets.submit"], hierarchyLevel: 20 });
  head = await user("STAFF", { staffRoleId: hr._id, isStaff: true, department: "MARKETING" });
  officer = await user("STAFF", { staffRoleId: or._id, isStaff: true, department: "MARKETING" });
  outsider = await user("BRANCH_MANAGER");
  customer = await user("CUSTOMER", { state: "Kano", lga: "Nassarawa" });
  const app = express(); app.use(express.json()); app.use("/marketing", router);
  app.post("/local-fixture-login", require("../controllers/auth.controller").loginUser);
  app.use("/staff", require("../routes/staffManagement.routes"));
  server = app.listen(0, "127.0.0.1"); await new Promise(r => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}/marketing`;
});
test.after(async () => {
  if (server) await new Promise(r => server.close(r));
  await mongoose.disconnect(); if (mongo) await mongo.stop();
});
test("authorization rejects anonymous, customer and operational staff", async () => {
  assert.equal((await api("/schema", { actor: null })).status, 401);
  assert.equal((await api("/schema", { actor: customer })).status, 403);
  assert.equal((await api("/schema", { actor: outsider })).status, 403);
});
test("Head of Marketing authenticates through existing staff role and receives marketing-only permissions", async () => {
  const r = await api("/schema", { actor: head });
  assert.equal(r.status, 200); assert.equal(r.data.headOffice, false);
  assert(r.data.permissions.every(p => p.startsWith("marketing.")));
  assert(!r.data.permissions.includes("marketing.budgets.approve"));
});
test("marketing role cannot reach existing Head Office staff administration", async () => {
  const r = await fetch(base.replace(/marketing$/, "staff/staff"), { headers: { Authorization: "Bearer " + token(head) } });
  assert.equal(r.status, 403);
});
test("even a misconfigured marketing role cannot project financial or Head Office permissions", async () => {
  const r = await Role.create({ name: "MISCONFIGURED_MARKETING", displayName: "Fixture",
    department: "MARKETING", permissions: ["marketing.view", "wallets.fund", "staff.create"], hierarchyLevel: 20 });
  const u = await user("STAFF", { isStaff: true, department: "MARKETING", staffRoleId: r._id });
  const response = await api("/schema", { actor: u });
  assert.equal(response.status, 200);
  assert.deepEqual(response.data.permissions, ["marketing.view"]);
  const forbidden = await fetch(base.replace(/marketing$/, "staff/staff"), {
    headers: { Authorization: "Bearer " + token(u) },
  });
  assert.equal(forbidden.status, 403);
});
test("schema is read-only and Head Office sees all marketing capabilities", async () => {
  const before = await Record.countDocuments();
  const r = await api("/schema");
  assert.equal(r.status, 200); assert(r.data.permissions.includes("marketing.budgets.approve"));
  assert.equal(await Record.countDocuments(), before);
});
test("campaign validates required fields, blocks unexpected fields and numeric abuse", async () => {
  assert.equal((await record("campaign", { title: "Incomplete" })).status, 400);
  assert.equal((await record("campaign", { title: "Injection", status: "ACTIVE" })).status, 400);
  assert.equal((await record("budget", { title: "Bad", data: { amountNaira: -1 } })).status, 400);
  assert.equal((await record("budget", { title: "Bad", data: { amountNaira: "100" } })).status, 400);
});
test("create campaign and same-key retries return the same record, not duplicate campaigns or audits", async () => {
  const body = { title: "Verified campaign", data: { objective: "Customer acquisition",
    channel: "OFFLINE", startsAt: new Date(Date.now() - 86400000).toISOString(),
    endsAt: new Date(Date.now() + 86400000).toISOString(), budgetNaira: 5000 } };
  const k = key();
  const first = await api("/records/campaign", { method: "POST", actor: head, body, requestKey: k });
  assert.equal(first.status, 201, JSON.stringify(first)); campaign = first.data;
  const retry = await api("/records/campaign", { method: "POST", actor: head, body, requestKey: k });
  assert.equal(retry.data._id, campaign._id);
  const conflict = await api("/records/campaign", { method: "POST", actor: head,
    body: { ...body, title: "Different campaign" }, requestKey: k });
  assert.equal(conflict.status, 409);
  assert.equal(await Record.countDocuments({ kind: "activity", "data.recordId": campaign._id }), 1);
});
test("officer cannot create campaigns or set performance targets", async () => {
  assert.equal((await record("campaign", { title: "No" }, officer)).status, 403);
  assert.equal((await record("target", { title: "No" }, officer)).status, 403);
});
test("campaign lifecycle handles activation, pause, resume and completion with optimistic revision checks", async () => {
  let r = await transition("campaign", campaign, "SUBMITTED", head); assert.equal(r.status, 200);
  assert.equal((await transition("campaign", r.data, "APPROVED", head)).status, 403);
  r = await transition("campaign", r.data, "APPROVED", reviewer); assert.equal(r.status, 200);
  r = await transition("campaign", r.data, "ACTIVE", head); assert.equal(r.status, 200);
  const stale = await transition("campaign", campaign, "ACTIVE", head); assert.equal(stale.status, 409);
  campaign = r.data;
  for (const status of ["PAUSED", "ACTIVE"]) {
    r = await transition("campaign", campaign, status, head); assert.equal(r.status, 200); campaign = r.data;
  }
});
test("manual campaign attribution requires evidence and a qualifying real customer", async () => {
  assert.equal((await record("attribution", { title: "No evidence", customerId: customer.id,
    campaignId: campaign._id, data: { source: "CAMPAIGN" } })).status, 400);
  const r = await record("attribution", { title: "Confirmed offline source", customerId: customer.id,
    campaignId: campaign._id, officerId: officer.id,
    data: { source: "CAMPAIGN", evidence: "Verified test registration interview", utmCampaign: "fixture" } });
  assert.equal(r.status, 201, JSON.stringify(r));
  const duplicate = await record("attribution", { title: "Duplicate", customerId: customer.id,
    campaignId: campaign._id, data: { source: "CAMPAIGN", evidence: "Duplicate evidence" } });
  assert.equal(duplicate.status, 409);
  const edit = await api(`/records/attribution/${r.data._id}`, { method: "PATCH", actor: head,
    body: { revision: 0, title: "Rewrite attribution" } });
  assert.equal(edit.status, 409);
});
test("referral attribution does not invent a referrer relationship", async () => {
  const c = await user();
  assert.equal((await record("attribution", { title: "No referral", customerId: c.id,
    data: { source: "REFERRAL", evidence: "Unsubstantiated" } })).status, 400);
});
test("social records require actual report evidence and reject fabricated integrations", async () => {
  assert.equal((await record("social", { title: "No evidence", data: { reach: 1000 } })).status, 400);
  const r = await record("social", { title: "Verified manual report",
    data: { channel: "FACEBOOK", reach: 50, impressions: 70, engagements: 4,
      reportedAt: new Date().toISOString(), evidence: "Signed platform export fixture" } });
  assert.equal(r.status, 201);
});
test("private asset upload validates file signatures and returns no binary in JSON", async () => {
  const f = new FormData(); f.append("file", new Blob([Buffer.from("%PDF-1.7\nfixture")], { type: "application/pdf" }), "receipt.pdf");
  const r = await fetch(base + "/assets", { method: "POST", headers: {
    Authorization: "Bearer " + token(head), "Idempotency-Key": key(),
  }, body: f });
  const body = await r.json(); assert.equal(r.status, 201, JSON.stringify(body));
  asset = body.data; assert.equal(asset.binary, undefined); assert.equal(asset.data.mime, "application/pdf");
  const download = await api("/assets/" + asset._id, { actor: head, raw: true });
  assert.equal(download.status, 200); assert.match(download.headers.get("content-disposition"), /attachment/);
  assert.equal(await download.text(), "%PDF-1.7\nfixture");
  assert.equal((await api("/assets/" + asset._id, { actor: customer, raw: true })).status, 403);
  assert.throws(() => router.mime(Buffer.from("<script>bad</script>")), /supported/);
});
test("budget can be submitted but not self-approved or approved by marketing head", async () => {
  const r = await record("budget", { title: "Campaign allocation", campaignId: campaign._id,
    data: { amountNaira: 1000, category: "Field marketing" } });
  assert.equal(r.status, 201); budget = r.data;
  assert.equal((await transition("budget", budget, "APPROVED", head)).status, 403);
  const self = await record("budget", { title: "Own request", data: { amountNaira: 100 } }, admin);
  assert.equal((await transition("budget", self.data, "APPROVED", admin)).status, 403);
  const approved = await transition("budget", budget, "APPROVED");
  assert.equal(approved.status, 200, JSON.stringify(approved)); budget = approved.data;
});
test("expense requires receipt and correct campaign-approved budget", async () => {
  assert.equal((await record("expense", { title: "Missing receipt", campaignId: campaign._id,
    data: { amountNaira: 600, budgetId: budget._id } })).status, 400);
  const r = await record("expense", { title: "Receipt expense", campaignId: campaign._id,
    data: { amountNaira: 600, budgetId: budget._id, assetId: asset._id, category: "Travel" } });
  assert.equal(r.status, 201);
  assert.equal((await transition("expense", r.data, "APPROVED")).status, 200);
  const second = await record("expense", { title: "Exceeds allocation", campaignId: campaign._id,
    data: { amountNaira: 600, budgetId: budget._id, assetId: asset._id, category: "Travel" } });
  assert.equal((await transition("expense", second.data, "APPROVED")).status, 409);
  assert.equal((await Record.findById(budget._id)).data.committedNaira, 600);
});
test("concurrent expense approvals cannot over-allocate one marketing budget", async () => {
  const a = await record("expense", { title: "Concurrent expense A", campaignId: campaign._id,
    data: { amountNaira: 300, budgetId: budget._id, assetId: asset._id } });
  const b = await record("expense", { title: "Concurrent expense B", campaignId: campaign._id,
    data: { amountNaira: 300, budgetId: budget._id, assetId: asset._id } });
  const results = await Promise.all([transition("expense", a.data, "APPROVED"),
    transition("expense", b.data, "APPROVED")]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal((await Record.findById(budget._id)).data.committedNaira, 900);
});
test("completed approval cannot be edited and audit history cannot be modified through record endpoints", async () => {
  assert.equal((await api(`/records/budget/${budget._id}`, { method: "PATCH", actor: head,
    body: { revision: budget.revision, data: { amountNaira: 2000 } } })).status, 409);
  assert.equal((await record("activity", { title: "Forged log" }, admin)).status, 404);
});
test("content approval requires reviewer and publishing requires real URL/time evidence", async () => {
  let r = await record("content", { title: "Poster", data: { assetId: asset._id, channel: "WHATSAPP" } }, officer);
  assert.equal(r.status, 201); let content = r.data;
  r = await transition("content", content, "SUBMITTED", officer); content = r.data;
  assert.equal(r.status, 200);
  assert.equal((await transition("content", content, "APPROVED", officer)).status, 403);
  r = await transition("content", content, "APPROVED", head); content = r.data;
  assert.equal(r.status, 200);
  assert.equal((await transition("content", content, "PUBLISHED", head)).status, 400);
  r = await api(`/records/content/${content._id}`, { method: "PATCH", actor: head,
    body: { revision: content.revision, data: { publishedUrl: "https://example.test/post/1",
      publishedAt: new Date().toISOString() } } });
  assert.equal(r.status, 200); content = r.data;
  assert.equal((await transition("content", content, "PUBLISHED", head)).status, 200);
});
test("reports, strategy, proposals, announcements, attendance, tasks and targets persist through real APIs", async () => {
  for (const kind of ["report", "strategy", "proposal", "announcement", "attendance", "task"]) {
    const r = await record(kind, { title: "Fixture " + kind, officerId: kind === "report" ? head.id : officer.id,
      data: kind === "report" ? { period: "DAILY", evidence: "Verified report fixture",
        startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 86400000).toISOString() } : {} });
    assert.equal(r.status, 201, kind + " " + JSON.stringify(r));
  }
  const r = await record("target", { title: "Acquisition target", officerId: officer.id,
    data: { metric: "ACQUISITIONS", value: 5, period: "MONTHLY",
      startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 86400000).toISOString() } }, admin);
  assert.equal(r.status, 201);
});
test("search is literal, pagination bounded, status/date filters validated and audit access explicit", async () => {
  assert.equal((await api("/records/campaign?page=-1")).status, 400);
  assert.equal((await api("/records/campaign?limit=1000")).status, 400);
  assert.equal((await api("/records/campaign?status=FORGED")).status, 400);
  assert.equal((await api("/records/campaign?search=%5B")).status, 200);
  assert.equal((await api("/overview?preset=custom&from=bad&to=bad")).status, 400);
  assert.equal((await api("/records/activity", { actor: officer })).status, 403);
  assert((await api("/records/activity", { actor: head })).data.total > 0);
});
test("analytics count only confirmed acquisition and qualifying SUCCESSFUL purchases without writing finances", async () => {
  await Transaction.create([
    { reference: key(), customerId: customer._id, serviceType: "DATA", status: "SUCCESSFUL", amount: 100 },
    { reference: key(), customerId: customer._id, serviceType: "AIRTIME", status: "PENDING", amount: 100 },
    { reference: key(), customerId: customer._id, serviceType: "WALLET_FUNDING", status: "SUCCESSFUL", amount: 100 },
  ]);
  const before = await Transaction.find({}).lean(), wallets = await User.find({}).select("_id walletBalance").lean();
  const r = await api("/overview?preset=today", { actor: head });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.data.metrics.totalCustomersAcquired, 1);
  assert.equal(r.data.metrics.firstTimeTransactingCustomers, 1);
  assert.equal(r.data.metrics.conversionRate, 100);
  assert.equal(r.data.metrics.expenditureNaira, 900);
  assert.equal(r.data.metrics.roi, null);
  assert.equal(r.data.geography[0].state, "Kano");
  assert.deepEqual(await Transaction.find({}).lean(), before);
  assert.deepEqual(await User.find({}).select("_id walletBalance").lean(), wallets);
});
test("PDF and Excel exports contain actual records and valid binary signatures", async () => {
  const pdf = await api("/export/campaign?format=pdf", { actor: head, raw: true });
  assert.equal(pdf.status, 200); assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
  const excel = await api("/export/campaign?format=xlsx", { actor: head, raw: true });
  assert.equal(excel.status, 200); assert.equal(Buffer.from(await excel.arrayBuffer()).subarray(0, 2).toString(), "PK");
  assert.equal((await api("/export/campaign?format=xlsx", { actor: officer, raw: true })).status, 403);
});
test("marketing team management rejects non-marketing and elevated roles", async () => {
  const other = await Role.create({ name: "NON_MARKETING_FIXTURE", displayName: "Other",
    department: "OPERATIONS", permissions: ["wallets.view"] });
  const r = await api("/team", { actor: head });
  assert.equal(r.status, 200); assert(r.data.items.every(s => s.department === "MARKETING"));
  const denied = await api("/team", { method: "POST", actor: head,
    body: { fullName: "No privilege", phone: "08012345678", email: "deny@example.test",
      password: "LocalFixture9!", roleId: other.id } });
  assert.equal(denied.status, 400);
  const promoted = await api("/team", { method: "POST", actor: head,
    body: { roleId: String(head.staffRoleId) } });
  assert.equal(promoted.status, 403);
});
test("officer account creation reuses secure password hashing and mandatory password change", async () => {
  const role = await Role.findOne({ name: "MARKETING_OFFICER" });
  const r = await api("/team", { method: "POST", actor: head, body: {
    fullName: "Created marketing officer", phone: "08012345679", email: "created-marketing@example.test",
    password: "LocalFixture9!", roleId: role.id,
  } });
  assert.equal(r.status, 201, JSON.stringify(r));
  const created = await User.findOne({ email: "created-marketing@example.test" }).select("+password");
  assert(created.password !== "LocalFixture9!"); assert.equal(created.mustChangePassword, true);
  const restricted = await api("/schema", { actor: created }); assert.equal(restricted.status, 403);
});
test("all date presets are bounded and explicitly UTC", () => {
  for (const preset of ["today", "yesterday", "7days", "30days", "month", "lastMonth"]) {
    const r = service.range({ preset }, new Date("2026-11-10T10:00:00Z"));
    assert(r.$gte < r.$lt); assert.equal(r.$gte.getUTCHours(), 0);
  }
  assert.throws(() => service.range({ preset: "custom", from: "2020-01-01", to: "2026-01-01" }), /366/);
});
test("a missing marketing namespace fails closed without creating it", async () => {
  const connection = await mongoose.createConnection(mongo.getUri(), { dbName: "marketing-unprovisioned-fixture" }).asPromise();
  try {
    assert.equal(await service.ready(connection.db), false);
    assert.equal(await connection.db.listCollections().hasNext(), false);
  } finally { await connection.close(); }
});
test("team lifecycle: real local login, staff editing, suspension, token revocation and reactivation", async () => {
  for (const person of [head, officer]) {
    const response = await fetch(base.replace(/marketing$/, "local-fixture-login"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: person.email, password: "LocalFixture9!" }),
    });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(typeof body.token, "string");
    const access = await fetch(base + "/schema", { headers: { Authorization: "Bearer " + body.token } });
    assert.equal(access.status, 200);
  }
  const edit = await api("/team/" + officer.id, { actor: head, method: "PATCH",
    body: { fullName: "Updated marketing officer fixture" } });
  assert.equal(edit.status, 200);
  const oldToken = token(officer);
  const suspended = await api("/team/" + officer.id + "/status", { actor: head, method: "POST",
    body: { status: "SUSPENDED" } });
  assert.equal(suspended.status, 200);
  const rejected = await fetch(base + "/schema", { headers: { Authorization: "Bearer " + oldToken } });
  assert([401, 403].includes(rejected.status));
  assert.equal((await api("/team/" + officer.id + "/status", { actor: head, method: "POST",
    body: { status: "ACTIVE" } })).status, 200);
  const restored = await User.findById(officer._id).select("+authTokenVersion");
  assert.equal((await api("/schema", { actor: restored })).status, 200);
});
test("explicit marketing migration provisions only its namespace and roles, and is idempotent", async () => {
  const connection = await mongoose.createConnection(mongo.getUri(), {
    dbName: "marketing-migration-fixture", autoCreate: false, autoIndex: false,
  }).asPromise();
  try {
    const first = await migrate(connection.db);
    assert.equal(first.createdCollection, true);
    assert(first.indexes.length >= 6);
    assert.equal(await service.ready(connection.db), true);
    const roles = await connection.db.collection("roles").find({ department: "MARKETING" }).toArray();
    assert.deepEqual(roles.map(r => r.name).sort(), ["HEAD_OF_MARKETING", "MARKETING_OFFICER"]);
    const second = await migrate(connection.db);
    assert.equal(second.createdCollection, false);
    assert.equal(await connection.db.collection("roles").countDocuments({ department: "MARKETING" }), 2);
    assert.equal(await connection.db.collection("marketingrecords").countDocuments({}), 0);
    assert.deepEqual(await connection.db.listCollections({}, { nameOnly: true }).toArray().then(rows => rows.map(r => r.name).sort()),
      ["marketingrecords", "roles"]);
  } finally { await connection.close(); }
});
test("existing binary materials remain downloadable after storage provider migration", async () => {
  const bytes = Buffer.from("%PDF-1.7\nold material");
  const legacy = await Record.create({
    kind: "asset", title: "legacy.pdf", status: "STORED", createdBy: head._id, updatedBy: head._id,
    requestKey: key(), binary: bytes, data: { filename: "legacy.pdf", mime: "application/pdf",
      bytes: bytes.length, sha256: require("node:crypto").createHash("sha256").update(bytes).digest("hex") },
  });
  const result = await api("/assets/" + legacy._id, { actor: head, raw: true });
  assert.equal(result.status, 200);
  assert.deepEqual(Buffer.from(await result.arrayBuffer()), bytes);
});
test("partnership and contribution decisions cannot bypass independent Head Office approval", async () => {
  let partner = await record("partnership", { title: "Verified institution", campaignId: campaign._id,
    data: { organization: "Fixture Organization", evidence: "Written fixture agreement" } });
  assert.equal(partner.status, 201); partner = partner.data;
  assert.equal((await transition("partnership", partner, "APPROVED", head)).status, 403);
  assert.equal((await transition("partnership", partner, "APPROVED", reviewer)).status, 200);
  const transaction = await Transaction.create({ reference: key(), customerId: customer._id,
    serviceType: "DATA", status: "SUCCESSFUL", amount: 1000, servicepayProfit: 20 });
  const forged = await record("contribution", { title: "Unsupported revenue", campaignId: campaign._id,
    data: { transactionId: String(new mongoose.Types.ObjectId()), evidence: "Fixture finance review" } });
  assert.equal(forged.status, 400);
  const r = await record("contribution", { title: "Verified recorded contribution", campaignId: campaign._id,
    data: { transactionId: String(transaction._id), evidence: "Fixture accounting review" } });
  assert.equal(r.status, 201, JSON.stringify(r));
  assert.equal(r.data.data.observedContributionNaira, 20);
  assert.equal((await transition("contribution", r.data, "APPROVED", head)).status, 403);
  assert.equal((await transition("contribution", r.data, "APPROVED", reviewer)).status, 200);
  const duplicate = await record("contribution", { title: "Duplicate transaction", campaignId: campaign._id,
    data: { transactionId: String(transaction._id), evidence: "Different request" } });
  assert.equal(duplicate.status, 409);
  assert.equal((await Transaction.findById(transaction._id)).servicepayProfit, 20);
});
test("ROI stays unavailable until independently evidenced spend is marked paid", async () => {
  const expense = await Record.findOne({ kind: "expense", status: "APPROVED", campaignId: campaign._id });
  assert(expense);
  const before = await api("/overview?preset=today");
  assert.equal(before.data.metrics.roi, null);
  const withoutEvidence = await api(`/records/expense/${expense._id}/transition`, {
    method: "POST", actor: reviewer,
    body: { revision: expense.revision, status: "PAID", reason: "Fixture review" },
  });
  assert.equal(withoutEvidence.status, 400);
  const paid = await api(`/records/expense/${expense._id}/transition`, {
    method: "POST", actor: reviewer,
    body: { revision: expense.revision, status: "PAID",
      reason: "Fixture review", paymentEvidence: "External bank payment confirmed by fixture statement" },
  });
  assert.equal(paid.status, 200, JSON.stringify(paid));
  const report = await api("/overview?preset=today");
  assert.equal(report.status, 200);
  assert.equal(report.data.metrics.verifiedContributionNaira, 20);
  assert.equal(report.data.metrics.verifiedSpendNaira, expense.data.amountNaira);
  assert(Math.abs(report.data.metrics.roi - ((20 - expense.data.amountNaira) / expense.data.amountNaira * 100)) < 0.0001);
  assert(report.data.series.length >= 1);
  const exported = await api("/export/overview?format=pdf&preset=today", { actor: head, raw: true });
  assert.equal(exported.status, 200);
  assert.equal(Buffer.from(await exported.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
});
test("registration referrals appear once without changing Customer or referral history", async () => {
  const before = await api("/overview?preset=today");
  const referred = await user("CUSTOMER", { referredBy: customer._id, state: "Kano", lga: "Nassarawa" });
  const added = await api("/overview?preset=today");
  assert.equal(added.data.metrics.totalCustomersAcquired, before.data.metrics.totalCustomersAcquired + 1);
  assert.equal(added.data.metrics.newRegistrations, before.data.metrics.newRegistrations + 1);
  assert.equal(added.data.referrals.registrations, before.data.referrals.registrations + 1);
  const evidence = await record("attribution", { title: "Existing referral fixture", customerId: String(referred._id),
    data: { source: "REFERRAL", evidence: "Registration relationship independently verified." } });
  assert.equal(evidence.status, 201, JSON.stringify(evidence));
  const after = await api("/overview?preset=today");
  assert.equal(after.data.metrics.totalCustomersAcquired, added.data.metrics.totalCustomersAcquired);
  assert.equal(String((await User.findById(referred._id)).referredBy), String(customer._id));
});
test("changed or refunded provider transactions invalidate previously approved ROI evidence", async () => {
  const record = await Record.findOne({ kind: "contribution", status: "APPROVED" });
  const id = record.data.transactionId;
  assert((await api("/overview?preset=today")).data.metrics.roi != null);
  await Transaction.updateOne({ _id: id }, { $set: { status: "REFUNDED" } });
  const report = await api("/overview?preset=today");
  assert.equal(report.data.metrics.verifiedContributionNaira, null);
  assert.equal(report.data.metrics.roi, null);
});
