"use strict";
const { before, after, test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const startup = require("../services/startupReadiness.service");
startup.configure();
const c = require("../services/expenseManagement.common");
const a = require("../services/expenseRequests.access");
const service = require("../services/expenseRequests.service");
const policies = require("../services/expenseRequests.policies");
const catalog = require("../services/expenseManagement.catalog");
const documents = require("../services/expenseManagement.documents");
const legacy = require("../services/expenseManagement.service");
const reports = require("../services/expenseManagement.reports");
const jwt = require("jsonwebtoken");
const express = require("express");
let mongo, server, origin, category, vendor, preserved;
const oid = () => new mongoose.Types.ObjectId();
let sequence = 0;
const key = () => `department-test-request-${String(++sequence).padStart(8, "0")}`;
const today = new Date().toISOString().slice(0, 10);
function actor(name, department, permissions, role = "STAFF") {
  return { id: String(oid()), roleId: String(oid()), name, department, permissions,
    role, scope: "GLOBAL", isStaff: true };
}
const owner = actor("Isolated Head Office", "ADMINISTRATION", Object.values(c.r.PERMISSIONS), "HEAD_OFFICE");
const operations = actor("Isolated Operations", "OPERATIONS", [c.r.PERMISSIONS.request]);
const marketing = actor("Isolated Marketing", "MARKETING", [c.r.PERMISSIONS.request]);
const reviewer = actor("Isolated Approver", "FINANCE", [c.r.PERMISSIONS.approve]);
const backup = actor("Isolated Backup", "FINANCE", [c.r.PERMISSIONS.approve]);
const finance = actor("Isolated Finance", "FINANCE", [c.r.PERMISSIONS.view, c.r.PERMISSIONS.pay, c.r.PERMISSIONS.documents]);
const deptLead = actor("Isolated Operations Lead", "OPERATIONS", [c.r.PERMISSIONS.department]);
const unprivileged = actor("Isolated No Authority", "OPERATIONS", ["customers.view"]);
async function http(who, route, method = "GET", body, idempotencyKey = key()) {
  const headers = { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey };
  if (who) headers.Authorization = `Bearer ${jwt.sign({ id: who.id }, process.env.JWT_SECRET, { expiresIn: "5m" })}`;
  const response = await fetch(`${origin}/api/admin/expense-management${route}`, {
    method, headers, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}
async function uploaded(who, label = "quote") {
  const bytes = Buffer.from(`%PDF-1.4\n${label}-${key()}\n%%EOF`);
  return (await documents.upload({ originalname: `${label}.pdf`, mimetype: "application/pdf", buffer: bytes },
    who, key(), { authorize: a.upload, uploadOne: async (_file, _folder, metadata) => ({ assetId: metadata.publicId }) })).document;
}
async function input(who = operations, extra = {}) {
  const document = await uploaded(who);
  return { title: "Isolated office funding request", department: who.department, amount: "1200.25",
    categoryId: category.id, vendorId: vendor.id, businessPurpose: "Disposable workflow verification",
    description: "Synthetic expense with no production data or real external payment.",
    requiredDate: today, documentIds: [document.id], ...extra };
}
const reason = "Isolated workflow verification decision";
const action = (item, value, who, extra = {}, idempotencyKey = key()) => service.act(item.id,
  { action: value, expectedVersion: item.revision, reason, ...extra }, who, idempotencyKey);
const policyInput = (extra = {}) => ({ name: "Isolated departmental approvals", active: true,
  departments: ["OPERATIONS", "MARKETING"], minimumAmount: "0.01", maximumAmount: "10000",
  approvalSteps: [{ label: "Independent finance review", userIds: [reviewer.id], backupUserIds: [backup.id], roleIds: [] }],
  expectedVersion: -1, reason, ...extra });
before(async () => {
  assert.equal(Boolean(process.env.MONGO_URI || process.env.MONGODB_URI), false, "Ambient production URI is prohibited");
  assert.equal(process.env.JWT_SECRET, "expense-test-secret-not-for-production");
  mongo = await MongoMemoryReplSet.create({ binary: { version: "7.0.14", systemBinary: process.env.MONGOMS_SYSTEM_BINARY ||
    path.resolve(__dirname, "../../../../../.cache/mongodb-binaries/mongod-x64-ubuntu-7.0.14") },
    replSet: { count: 1, storageEngine: "wiredTiger", args: ["--nounixsocket"] } });
  const uri = mongo.getUri("department_expenses_disposable");
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:/);
  await mongoose.connect(uri, { autoCreate: false, autoIndex: false });
  const db = mongoose.connection.db;
  for (const name of new Set([...startup.manifest.map(row => row.collection), "organizationmembers",
    "interstateshipments", "organizationwallets", "users", "roles", "wallets", "transactions"])) await db.createCollection(name);
  for (const [index, spec] of startup.manifest.entries()) await db.collection(spec.collection).createIndex(spec.key, {
    name: `isolated_prerequisite_${index}`, unique: true, ...(spec.sparse ? { sparse: true } : {}),
    ...(spec.partial ? { partialFilterExpression: spec.partial } : {}),
  });
  await startup.verify(mongoose.connection);
  await c.storage.provision(db, { apply: true });
  for (const person of [owner, operations, marketing, reviewer, backup, finance, deptLead, unprivileged]) {
    await db.collection("roles").insertOne({ _id: new mongoose.Types.ObjectId(person.roleId), name: person.name.toUpperCase(),
      scopeType: "GLOBAL", status: "ACTIVE", permissions: person.permissions, department: person.department, hierarchyLevel: 20 });
    await db.collection("users").insertOne({ _id: new mongoose.Types.ObjectId(person.id), fullName: person.name,
      role: person.role, isStaff: true, status: "ACTIVE", staffRoleId: new mongoose.Types.ObjectId(person.roleId),
      authTokenVersion: 0, mustChangePassword: false });
  }
  await db.collection("wallets").insertOne({ customer: oid(), balance: 100.123456 });
  await db.collection("transactions").insertOne({ reference: "DO-NOT-TOUCH", amount: 99.95, status: "PENDING" });
  preserved = JSON.stringify({ wallets: await db.collection("wallets").find().toArray(),
    transactions: await db.collection("transactions").find().toArray() });
  category = (await catalog.write("CATEGORY", null, { name: "Isolated operational costs", reason }, owner, key())).item;
  vendor = (await catalog.write("VENDOR", null, { name: "Synthetic approved supplier", reason }, owner, key())).item;
  await policies.write(null, policyInput(), owner, key());
  const app = express(); app.use(express.json());
  app.use("/api/admin/expense-management", require("../routes/expenseManagement.routes"));
  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (mongoose.connection.readyState) {
    assert.equal(JSON.stringify({ wallets: await mongoose.connection.db.collection("wallets").find().toArray(),
      transactions: await mongoose.connection.db.collection("transactions").find().toArray() }), preserved,
    "No customer wallets or transactions may change");
  }
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await mongoose.disconnect(); await mongo?.stop();
});
test("request-only staff access their portal but cannot see global financial data", async () => {
  const result = await http(operations, "/readiness");
  assert.equal(result.status, 200);
  assert.equal(result.body.data.canCreateRequests, true);
  assert.equal(result.body.data.financeAccess, false);
  for (const route of ["/summary", "/policy", "/audit", "/expenses", "/approval-policies"]) {
    assert.equal((await http(operations, route)).status, 403, route);
  }
  assert.equal((await http(null, "/requests")).status, 401);
  assert.equal((await http(unprivileged, "/requests")).status, 403);
});
test("Operations and Marketing each submit via actual authenticated routes and cannot cross-read", async () => {
  const op = await http(operations, "/requests", "POST", { ...await input(), submit: true });
  const mk = await http(marketing, "/requests", "POST", { ...await input(marketing), submit: true });
  assert.equal(op.status, 201, JSON.stringify(op.body)); assert.equal(mk.status, 201, JSON.stringify(mk.body));
  assert.equal(op.body.data.item.status, "SUBMITTED");
  assert.equal((await http(marketing, `/requests/${op.body.data.item.id}`)).status, 404);
  const mine = await http(operations, "/requests?scope=my");
  assert.ok(mine.body.data.items.every(item => item.department === "OPERATIONS"));
  assert.equal((await http(operations, "/requests?scope=department")).status, 403);
  const department = await http(deptLead, "/requests?scope=department");
  assert.ok(department.body.data.items.every(item => item.department === "OPERATIONS"));
});
test("drafts allow incomplete input, persist clearing, and reject incomplete submission", async () => {
  const draft = (await service.create({ department: "OPERATIONS", title: "Draft", amount: "12.50" }, operations, key())).item;
  assert.equal(draft.status, "DRAFT");
  const changed = (await service.update(draft.id, { request: { department: "OPERATIONS", title: "" },
    expectedVersion: draft.revision, reason }, operations, key())).item;
  assert.equal(changed.amountMinor, null);
  assert.equal((await service.find(draft.id, operations)).amountMinor, null);
  await assert.rejects(action(changed, "SUBMIT", operations), /required|active expense category/i);
});
test("server derives requester and prevents spoofed departments and identities", async () => {
  await assert.rejects(service.create(await input(operations, { department: "MARKETING" }), operations, key()), /assigned department/);
  await assert.rejects(service.create({ ...await input(), createdBy: owner.id }, operations, key()), /Unsupported request field/);
  await assert.rejects(service.create({ ...await input(), amount: "1.001", submit: true }, operations, key()), /decimal/);
});
test("policy limits, overlap, active assignments and Head Office authorization are enforced", async () => {
  await assert.rejects(policies.write(null, policyInput(), operations, key()), /Head Office/);
  await assert.rejects(policies.write(null, policyInput({ minimumAmount: "", maximumAmount: "" }), owner, key()), /explicit NGN limits/);
  await assert.rejects(policies.write(null, policyInput({ name: "Overlapping limits" }), owner, key()), /already covers/);
  await assert.rejects(policies.write(null, policyInput({ approvalSteps: [{
    label: "Unauthorized", userIds: [operations.id], backupUserIds: [] }] }), owner, key()), /explicit global approval/);
  await assert.rejects(service.create({ ...await input(operations, { amount: "10000.01" }), submit: true }, operations, key()), /covering this department and amount/);
});
test("requester cannot self-approve even with all Head Office permissions", async () => {
  const own = await policies.write(null, policyInput({ name: "Head Office self-approval check", departments: ["ADMINISTRATION"],
    approvalSteps: [{ label: "Assigned independent", userIds: [owner.id, reviewer.id], backupUserIds: [] }] }), owner, key());
  assert.ok(own.policy.id);
  const item = (await service.create({ ...await input(owner), submit: true }, owner, key())).item;
  await assert.rejects(action(item, "APPROVE", owner), /not assigned or authorized/);
  assert.ok(a.actions(await service.find(item.id, reviewer), reviewer).includes("APPROVE"));
});
test("request changes, revision protection, resubmission, backup approval and history work", async () => {
  let item = (await service.create({ ...await input(), submit: true }, operations, key())).item;
  item = (await action(item, "BEGIN_REVIEW", reviewer)).item; assert.equal(item.status, "UNDER_REVIEW");
  item = (await action(item, "REQUEST_CHANGES", reviewer)).item; assert.equal(item.status, "CHANGES_REQUESTED");
  item = (await service.update(item.id, { request: await input(), expectedVersion: item.revision, reason }, operations, key())).item;
  item = (await action(item, "SUBMIT", operations)).item;
  await assert.rejects(action(item, "APPROVE", finance), /not assigned or authorized/);
  const approveKey = key(), before = item;
  item = (await action(item, "APPROVE", backup, {}, approveKey)).item;
  assert.equal(item.status, "APPROVED");
  assert.equal(item.reviewHistory.at(-1).reviewerKind, "BACKUP");
  assert.equal((await action(before, "APPROVE", backup, {}, approveKey)).idempotent, true);
  await assert.rejects(action(before, "REJECT", reviewer), /changed/);
  const history = await service.audit(item.id, operations);
  assert.ok(history.items.some(row => row.action === "EXPENSE_REQUEST_REQUEST_CHANGES"));
  for (let i = 1; i < history.items.length; i++) assert.equal(history.items[i].previousHash, history.items[i - 1].eventHash);
});
test("parallel reviewers cannot approve twice and rejected requests retain reasons", async () => {
  const item = (await service.create({ ...await input(marketing), submit: true }, marketing, key())).item;
  const result = await Promise.allSettled([action(item, "APPROVE", reviewer), action(item, "APPROVE", backup)]);
  assert.equal(result.filter(row => row.status === "fulfilled").length, 1);
  let rejected = (await service.create({ ...await input(marketing), submit: true }, marketing, key())).item;
  await assert.rejects(action(rejected, "REJECT", reviewer, { reason: "" }), /reason/);
  rejected = (await action(rejected, "REJECT", reviewer)).item;
  assert.equal(rejected.rejection.reason, reason);
  await assert.rejects(action(rejected, "PAY", finance), /not assigned or authorized/);
});
test("manual payment requires approved amount, correct recipient and distinct original proof", async () => {
  let item = (await service.create({ ...await input(marketing), submit: true }, marketing, key())).item;
  item = (await action(item, "APPROVE", reviewer)).item;
  const proof = await uploaded(finance, "payment-proof");
  const payment = { amount: "1000.25", recipient: vendor.name, method: "BANK_TRANSFER", date: today,
    reference: key(), evidenceDocumentIds: [proof.id] };
  await assert.rejects(action(item, "PAY", marketing, { payment, confirmExternalPayment: true }), /authorized/);
  await assert.rejects(action(item, "PAY", finance, { payment }), /Confirm the external/);
  await assert.rejects(action(item, "PAY", finance, { payment: { ...payment, amount: "1200.26" }, confirmExternalPayment: true }), /exceeds/);
  await assert.rejects(action(item, "PAY", finance, { payment: { ...payment, recipient: "Different payee" }, confirmExternalPayment: true }), /recipient/);
  await assert.rejects(action(item, "PAY", finance, { payment: { ...payment, evidenceDocumentIds: item.documentIds }, confirmExternalPayment: true }), /separate payment proof/);
  const paymentKey = key(), before = item;
  item = (await action(item, "PAY", finance, { payment, confirmExternalPayment: true }, paymentKey)).item;
  assert.equal(item.status, "PAID"); assert.equal(item.payment.amountMinor, 100025);
  assert.equal((await action(before, "PAY", finance, { payment, confirmExternalPayment: true }, paymentKey)).idempotent, true);
  await assert.rejects(action(item, "PAY", finance, { payment, confirmExternalPayment: true }), /authorized/);
  const summary = await reports.summary({}, owner);
  assert.equal(summary.totals.paidMinor, 100025, "Reports use actual external amount, not requested principal");
  const other = (await service.create({ ...await input(marketing), submit: true }, marketing, key())).item;
  const approved = (await action(other, "APPROVE", reviewer)).item;
  const proof2 = await uploaded(finance, "other-proof");
  await assert.rejects(action(approved, "PAY", finance, {
    payment: { ...payment, evidenceDocumentIds: [proof2.id] }, confirmExternalPayment: true }), /reference is already recorded/);
});
test("department documents are private, authenticated and scoped to the actual request", async () => {
  const data = await input(), item = (await service.create({ ...data, submit: true }, operations, key())).item;
  const row = await c.Document.findById(data.documentIds[0]).lean();
  await a.document(operations, row, item.id);
  await a.document(reviewer, row, item.id);
  await assert.rejects(a.document(marketing, row, item.id), /not found/);
  assert.equal((await http(marketing, `/requests/${item.id}/documents/${row._id}/download`)).status, 404);
  await assert.rejects(a.document(operations, row), /not found/);
  await assert.rejects(legacy.act(item.id, { action: "APPROVE", expectedVersion: 0, reason }, owner, key()), /legacy expense actions/);
});
test("complete HTTP workflow records Operations payment and Marketing rejection with immutable history", async () => {
  const provider = require("../services/expenseManagement.documentProvider");
  const privateProvider = require("../services/amanaDocument.service");
  const axios = require("axios"), bytesById = new Map();
  const originalUpload = provider.uploadOne, originalUrl = privateProvider.buildSignedUrl, originalGet = axios.get;
  provider.uploadOne = async (file, _folder, metadata) => {
    bytesById.set(metadata.publicId, file.buffer);
    return { assetId: metadata.publicId };
  };
  privateProvider.buildSignedUrl = ({ assetId }) => `https://isolated-evidence.invalid/${encodeURIComponent(assetId)}`;
  axios.get = async url => ({ data: bytesById.get(decodeURIComponent(url.split("/").at(-1))) });
  try {
    async function uploadHttp(who, label) {
      const bytes = Buffer.from(`%PDF-1.4\n${label}-${key()}\n%%EOF`);
      const form = new FormData();
      form.append("file", new Blob([bytes], { type: "application/pdf" }), `${label}.pdf`);
      const result = await fetch(`${origin}/api/admin/expense-management/requests/documents`, {
        method: "POST", headers: { Authorization: `Bearer ${jwt.sign({ id: who.id }, process.env.JWT_SECRET, { expiresIn: "5m" })}`,
          "Idempotency-Key": key() }, body: form,
      });
      const body = await result.json();
      assert.equal(result.status, 201, JSON.stringify(body));
      return { document: body.data.document, bytes };
    }
    const configured = await http(owner, "/approval-policies");
    assert.equal(configured.status, 200);
    const policy = configured.body.data.items.find(row => row.departments.includes("OPERATIONS"));
    const policySaved = await http(owner, `/approval-policies/${policy.id}`, "PATCH",
      policyInput({ expectedVersion: policy.revision }));
    assert.equal(policySaved.status, 200, JSON.stringify(policySaved.body));
    const quote = await uploadHttp(operations, "workflow-quotation");
    const payload = await input(operations, { documentIds: [quote.document.id], beneficiary: "Approved delegated beneficiary" });
    let response = await http(operations, "/requests", "POST", { ...payload, submit: true });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    let item = response.body.data.item;
    response = await http(reviewer, `/requests/${item.id}/actions`, "POST", {
      action: "SEND_FOR_APPROVAL", expectedVersion: item.revision, reason,
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    item = response.body.data.item;
    assert.equal(item.status, "PENDING_APPROVAL");
    response = await http(reviewer, `/requests/${item.id}/actions`, "POST", {
      action: "APPROVE", expectedVersion: item.revision, reason,
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    item = response.body.data.item;
    const proof = await uploadHttp(finance, "workflow-payment-proof");
    response = await http(finance, `/requests/${item.id}/actions`, "POST", {
      action: "PAY", expectedVersion: item.revision, reason, confirmExternalPayment: true,
      payment: { amount: "1100.00", method: "BANK_TRANSFER", date: today, reference: key(),
        recipient: payload.beneficiary, evidenceDocumentIds: [proof.document.id] },
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.data.item.status, "PAID");
    const download = await fetch(`${origin}/api/admin/expense-management/requests/${item.id}/documents/${proof.document.id}/download`, {
      headers: { Authorization: `Bearer ${jwt.sign({ id: operations.id }, process.env.JWT_SECRET, { expiresIn: "5m" })}` },
    });
    assert.equal(download.status, 200);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), proof.bytes);
    const events = await http(operations, `/requests/${item.id}/audit`);
    assert.equal(events.status, 200);
    assert.ok(events.body.data.items.some(row => row.action === "EXPENSE_REQUEST_PAY"));
    assert.equal((await http(finance, "/requests?scope=payments")).status, 200);
    const marketingPayload = await input(marketing);
    response = await http(marketing, "/requests", "POST", { ...marketingPayload, submit: true });
    assert.equal(response.status, 201);
    const marketingItem = response.body.data.item;
    response = await http(reviewer, `/requests/${marketingItem.id}/actions`, "POST", {
      action: "REJECT", expectedVersion: marketingItem.revision, reason,
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.item.status, "REJECTED");
    assert.equal((await http(marketing, `/requests/${marketingItem.id}`)).body.data.item.rejection.reason, reason);
    const notifications = await http(reviewer, "/requests/notifications");
    assert.equal(notifications.status, 200);
    assert.equal(Number.isSafeInteger(notifications.body.data.pendingCount), true);
  } finally {
    provider.uploadOne = originalUpload; privateProvider.buildSignedUrl = originalUrl; axios.get = originalGet;
  }
});
test("person-specific grants preserve canonical shared roles, peers and sessions", async () => {
  const db = mongoose.connection.db, User = require("../models/user.model");
  const beforeRole = await db.collection("roles").findOne({ _id: new mongoose.Types.ObjectId(operations.roleId) });
  const peerId = oid();
  await db.collection("users").insertOne({ _id: peerId, fullName: "Shared role peer", role: "STAFF",
    isStaff: true, status: "ACTIVE", staffRoleId: beforeRole._id, authTokenVersion: 0 });
  await assert.rejects(policies.assignment({ userId: operations.id, expectedRoleId: operations.roleId,
    capabilities: { approver: true }, reason }, operations, key()), /Head Office/);
  await assert.rejects(policies.assignment({ userId: operations.id, expectedRoleId: operations.roleId,
    capabilities: { finance: true }, reason }, { ...owner,
    permissions: [c.r.PERMISSIONS.view, c.r.PERMISSIONS.policy] }, key()), /cannot delegate/);
  const result = await policies.assignment({ userId: operations.id, expectedRoleId: operations.roleId,
    capabilities: { departmentManager: true, requester: true }, reason }, owner, key());
  assert.equal(result.assigned, true);
  const changed = await User.findById(operations.id).lean();
  const role = await db.collection("roles").findOne({ _id: changed.staffRoleId });
  assert.deepEqual(role, beforeRole, "Existing role and every existing permission remain byte-for-byte unchanged");
  assert.equal(String((await User.findById(peerId).lean()).staffRoleId), operations.roleId);
  assert.equal(String(changed.staffRoleId), operations.roleId);
  assert.equal((await db.collection("users").findOne({ _id: new mongoose.Types.ObjectId(operations.id) })).authTokenVersion, 0);
  const grant = await c.Registry.findOne({ staffUserId: operations.id }).lean();
  assert.ok(grant.expenseGrants.includes(c.r.PERMISSIONS.department));
  assert.equal(await c.Event.countDocuments({ action: "EXPENSE_STAFF_CAPABILITIES_GRANTED", subjectId: String(grant._id) }), 1);
  assert.equal((await http(operations, "/readiness")).body.data.canViewDepartmentRequests, true);
  assert.deepEqual(await require("../services/expenseRequests.grants").load(peerId, beforeRole._id), []);
  assert.deepEqual(await require("../services/expenseRequests.grants").load(operations.id, oid()), [],
    "A role change must invalidate the prior expense grants");
});
test("policy deactivation prevents new admissions without rewriting in-flight approvals", async () => {
  const policy = (await policies.list(owner)).items.find(item => item.departments.includes("MARKETING"));
  const prior = (await service.create({ ...await input(marketing), submit: true }, marketing, key())).item;
  await policies.write(policy.id, policyInput({ active: false, expectedVersion: policy.revision }), owner, key());
  await assert.rejects(service.create({ ...await input(marketing), submit: true }, marketing, key()), /covering this department and amount/);
  assert.equal((await action(prior, "APPROVE", reviewer)).item.status, "APPROVED");
});
