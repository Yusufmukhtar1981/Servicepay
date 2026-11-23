"use strict";
const { before, after, test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const startup = require("../services/startupReadiness.service");
startup.configure();
const c = require("../services/expenseManagement.common");
const service = require("../services/expenseManagement.service");
const catalog = require("../services/expenseManagement.catalog");
const docs = require("../services/expenseManagement.documents");
const reports = require("../services/expenseManagement.reports");
const jwt = require("jsonwebtoken");
const express = require("express");
let mongo, server, origin, category, vendor, receipt, protectedBefore;
let sequence = 0;
const nextKey = () => `expense-isolated-request-${String(++sequence).padStart(8, "0")}`;
const objectId = () => new mongoose.Types.ObjectId();
const owner = { id: String(objectId()), name: "Isolated finance owner", role: "HEAD_OFFICE",
  roleId: String(objectId()), scope: "GLOBAL", permissions: Object.values(c.r.PERMISSIONS) };
const reviewer = { ...owner, id: String(objectId()), name: "Isolated independent reviewer",
  roleId: String(objectId()), role: "STAFF" };
const third = { ...owner, id: String(objectId()), name: "Isolated second reviewer",
  roleId: String(objectId()), role: "STAFF" };
const wildcard = { ...owner, id: String(objectId()), name: "No explicit expense authority",
  roleId: String(objectId()), permissions: ["*"] };
const pdf = Buffer.from("%PDF-1.4\nIsolated supporting evidence\n%%EOF\n");
const file = { originalname: "test-invoice.pdf", mimetype: "application/pdf", buffer: pdf, size: pdf.length };
const uploadOne = async (_file, _folder, metadata) => ({ assetId: metadata.publicId });
function input(overrides = {}) {
  return { title: "Isolated office operating expense", categoryId: category.id,
    description: "Synthetic fixture; not a production financial record.",
    businessPurpose: "Exercise the isolated expense approval workflow",
    amount: "1250.25", expenseDate: new Date().toISOString().slice(0, 10),
    paymentMethod: "BANK_TRANSFER", vendorId: vendor.id, reference: nextKey(),
    department: "Finance test", documentIds: receipt ? [receipt.id] : [],
    ...overrides };
}
async function create(overrides = {}) {
  return service.create(input(overrides), owner, nextKey());
}
async function action(item, action, actor = owner, extra = {}, key = nextKey()) {
  return service.act(item.id, { action, expectedVersion: item.revision,
    reason: "Verified isolated test decision only", ...extra }, actor, key);
}
async function request(actor, route, options = {}) {
  const headers = { "Content-Type": "application/json", ...options.headers };
  if (actor) headers.Authorization = `Bearer ${jwt.sign({ id: actor.id }, process.env.JWT_SECRET, { expiresIn: "5m" })}`;
  return fetch(`${origin}/api/admin/expense-management${route}`, { ...options, headers });
}
before(async () => {
  assert.equal(Boolean(process.env.MONGODB_URI || process.env.MONGO_URI), false,
    "Integration tests must not receive ambient database credentials");
  assert.equal(process.env.JWT_SECRET, "expense-test-secret-not-for-production");
  mongo = await MongoMemoryReplSet.create({
    binary: { version: "7.0.14", systemBinary: process.env.MONGOMS_SYSTEM_BINARY ||
      path.resolve(__dirname, "../../../../../.cache/mongodb-binaries/mongod-x64-ubuntu-7.0.14") },
    replSet: { count: 1, storageEngine: "wiredTiger", args: ["--nounixsocket"] },
  });
  const uri = mongo.getUri("expense_management_isolated_test");
  assert.equal(/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri), true, "Only a disposable loopback MongoDB is permitted");
  await mongoose.connect(uri, { autoCreate: false, autoIndex: false });
  const db = mongoose.connection.db;
  for (const name of new Set([...startup.manifest.map(row => row.collection),
    "organizationmembers", "interstateshipments", "organizationwallets", "users", "roles", "wallets", "transactions"])) {
    await db.createCollection(name);
  }
  for (const [number, spec] of startup.manifest.entries()) {
    await db.collection(spec.collection).createIndex(spec.key, {
      name: `isolated_prerequisite_${number}`, unique: true,
      ...(spec.sparse ? { sparse: true } : {}),
      ...(spec.partial ? { partialFilterExpression: spec.partial } : {}),
    });
  }
  await startup.verify(mongoose.connection);
  assert.equal((await c.storage.readiness()).ready, false);
  const namesBefore = (await db.listCollections({}, { nameOnly: true }).toArray()).map(row => row.name);
  assert.equal(namesBefore.includes("companyexpenses"), false, "Import must not auto-provision expense storage");
  const proposed = await c.storage.provision(db);
  assert.equal(proposed.applied, false);
  assert.equal(proposed.plan.length, 4);
  assert.equal((await c.storage.provision(db, { apply: true })).ready, true);
  assert.equal((await c.storage.provision(db, { apply: true })).plan.every(row => !row.create && !row.indexes.length), true);
  for (const actor of [owner, reviewer, third, wildcard]) {
    await db.collection("roles").insertOne({ _id: new mongoose.Types.ObjectId(actor.roleId),
      name: `EXPENSE_TEST_${actor.id}`, status: "ACTIVE", scopeType: "GLOBAL",
      department: "FINANCE", permissions: actor.permissions, hierarchyLevel: 20 });
    await db.collection("users").insertOne({ _id: new mongoose.Types.ObjectId(actor.id), fullName: actor.name,
      role: actor.role, status: "ACTIVE", isStaff: true,
      staffRoleId: new mongoose.Types.ObjectId(actor.roleId), authTokenVersion: 0, mustChangePassword: false });
  }
  await db.collection("wallets").insertOne({ customer: objectId(), balance: 123.4567, heldBalance: 0.03 });
  await db.collection("transactions").insertOne({ reference: "PROTECTED-ISOLATED-CUSTOMER-TX",
    status: "PENDING", amount: 246.91 });
  protectedBefore = JSON.stringify({
    wallets: await db.collection("wallets").find().toArray(),
    transactions: await db.collection("transactions").find().toArray(),
  });
  category = (await catalog.write("CATEGORY", null, { name: "Test operating costs",
    description: "Isolated tests", reason: "Create isolated category for regression" }, owner, nextKey())).item;
  vendor = (await catalog.write("VENDOR", null, { name: "Isolated test vendor",
    description: "Not a real supplier", reason: "Create isolated supplier for regression" }, owner, nextKey())).item;
  await catalog.write("POLICY", null, { expectedVersion: -1,
    approvalSteps: [{ label: "Independent finance review", userIds: [reviewer.id], roleIds: [] }],
    reason: "Configure isolated approval test policy" }, owner, nextKey());
  receipt = (await docs.upload(file, owner, nextKey(), { uploadOne })).document;
  const app = express();
  app.use(express.json());
  app.use("/api/admin/expense-management", require("../routes/expenseManagement.routes"));
  server = await new Promise(resolve => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});
test("authenticated HTTP routes reject anonymous and wildcard-only Head Office access", async () => {
  assert.equal((await request(null, "/readiness")).status, 401);
  assert.equal((await request(wildcard, "/readiness")).status, 403);
  const response = await request(owner, "/readiness");
  assert.equal(response.status, 200);
  const result = (await response.json()).data;
  assert.equal(result.ready, true);
  assert.equal(result.workflowConfigured, true);
  assert.equal(result.permissions.includes("expenses.approve"), true);
});
test("create retries and duplicate invoice references cannot create duplicate expenses", async () => {
  const payload = input(), key = nextKey();
  const results = await Promise.all(Array.from({ length: 5 }, () => service.create(payload, owner, key)));
  assert.equal(new Set(results.map(row => row.item.id)).size, 1);
  assert.equal(await c.Expense.countDocuments({ reference: payload.reference }), 1);
  await assert.rejects(service.create({ ...payload, amount: "1500.00" }, owner, key), error => error.statusCode === 409);
  await assert.rejects(service.create(payload, owner, nextKey()), error => error.statusCode === 409);
});
test("receipt ownership prevents another submitter stealing an unattached upload", async () => {
  const uploaded = (await docs.upload({ ...file, originalname: "unattached.pdf" }, owner, nextKey(), { uploadOne })).document;
  await assert.rejects(service.create(input({ documentIds: [uploaded.id] }), reviewer, nextKey()),
    error => error.code === "EXPENSE_DOCUMENT_CONFLICT");
});
test("create rollback leaves no expense or audit event when its audit cannot be stored", async () => {
  const payload = input({ documentIds: [], evidenceExceptionReason: "Evidence exception solely for isolated failure test" });
  const countBefore = await c.Expense.countDocuments();
  const original = c.Event.create;
  c.Event.create = async () => { throw new Error("Isolated audit outage"); };
  try { await assert.rejects(service.create(payload, owner, nextKey())); }
  finally { c.Event.create = original; }
  assert.equal(await c.Expense.countDocuments(), countBefore);
});
test("no self approval, stale updates or premature payment can bypass independent review", async () => {
  const original = await create({ documentIds: [], evidenceExceptionReason: "Isolated approved evidence exception" });
  const submitted = await action(original.item, "SUBMIT");
  assert.equal(submitted.item.status, "PENDING_APPROVAL");
  await assert.rejects(action(submitted.item, "APPROVE"), error => error.statusCode === 403);
  await assert.rejects(action(submitted.item, "PAY", owner, { confirmExternalPayment: true }), error => error.statusCode === 409);
  await assert.rejects(action(original.item, "CANCEL"), error => error.code === "EXPENSE_STALE_REVISION");
  const approved = await action(submitted.item, "APPROVE", reviewer);
  assert.equal(approved.item.status, "APPROVED");
  const paymentKey = nextKey();
  const paid = await action(approved.item, "PAY", owner, { confirmExternalPayment: true,
    payment: { date: input().expenseDate, method: "BANK_TRANSFER", reference: "EXTERNAL-TEST-ONLY", evidenceDocumentIds: [] } }, paymentKey);
  assert.equal(paid.item.status, "PAID");
  assert.equal(paid.item.payment.attestation, "MANUAL_COMPANY_PAYMENT_RECORD");
  assert.equal(paid.item.amountMinor, 125025);
  const duplicate = await action(approved.item, "PAY", owner, { confirmExternalPayment: true,
    payment: { date: input().expenseDate, method: "BANK_TRANSFER", reference: "EXTERNAL-TEST-ONLY", evidenceDocumentIds: [] } }, paymentKey);
  assert.equal(duplicate.idempotent, true);
  assert.equal(await c.Event.countDocuments({ subjectId: paid.item.id, action: "EXPENSE_PAY" }), 1);
  await assert.rejects(action(paid.item, "REVERSE", owner, { confirmExternalReversal: true,
    reversal: { date: input().expenseDate, reference: "MISSING-EVIDENCE", evidenceDocumentIds: [] } }),
  error => error.statusCode === 400);
  const reversalDoc = (await docs.upload({ ...file, originalname: "external-return.pdf" }, owner, nextKey(), { uploadOne })).document;
  const reversed = await action(paid.item, "REVERSE", owner, { confirmExternalReversal: true,
    reversal: { date: input().expenseDate, reference: "RETURN-RECORDED-ONLY", evidenceDocumentIds: [reversalDoc.id] } });
  assert.equal(reversed.item.status, "REVERSED");
  assert.equal(reversed.item.payment.reference, "EXTERNAL-TEST-ONLY");
});
test("concurrent review attempts persist exactly one decision and audit revision", async () => {
  const created = await create({ documentIds: [], evidenceExceptionReason: "Explicit isolated evidence exception" });
  const submitted = await action(created.item, "SUBMIT");
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => action(submitted.item, "APPROVE", reviewer)));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(await c.Event.countDocuments({ subjectId: created.item.id, action: "EXPENSE_APPROVE" }), 1);
  assert.equal((await service.get(created.item.id, owner)).item.approvals.length, 1);
});
test("rejection/edit/resubmission records old and new values without altering previous evidence", async () => {
  const created = await create({ documentIds: [], evidenceExceptionReason: "Explicit isolated evidence exception" });
  const submitted = await action(created.item, "SUBMIT");
  const rejected = await action(submitted.item, "REJECT", reviewer);
  const details = input({ reference: created.item.reference, documentIds: [],
    evidenceExceptionReason: "Corrected record with an approved evidence exception", amount: "1400.75" });
  const edited = await service.update(created.item.id, { expense: details,
    expectedVersion: rejected.item.revision, reason: "Correct synthetic expense invoice amount" }, owner, nextKey());
  assert.equal(edited.item.status, "REJECTED");
  const history = await reports.audit({}, owner, created.item.id);
  const edit = history.items.find(row => row.action === "EXPENSE_EDITED");
  assert.equal(edit.before.amountMinor, 125025);
  assert.equal(edit.after.amountMinor, 140075);
  assert.equal((await action(edited.item, "SUBMIT")).item.status, "PENDING_APPROVAL");
});
test("private evidence download verifies original hash and refuses altered bytes or unauthenticated access", async () => {
  const result = await docs.download(receipt.id, owner, { providerBytes: async () => pdf });
  assert.deepEqual(result.buffer, pdf);
  assert.equal(result.mimeType, "application/pdf");
  await assert.rejects(docs.download(receipt.id, owner, {
    providerBytes: async () => Buffer.from("%PDF-1.4\naltered\n%%EOF"),
  }), error => error.code === "EXPENSE_DOCUMENT_INTEGRITY_FAILED");
  assert.equal((await request(null, `/documents/${receipt.id}/download`)).status, 401);
  await assert.rejects(docs.download(receipt.id, { ...owner, permissions: ["expenses.view"] }),
    error => error.statusCode === 403);
});
test("uncertain document uploads cannot be silently replayed or leak provider credentials", async () => {
  const key = nextKey();
  let calls = 0;
  const failedUpload = async () => { calls++; throw new Error("synthetic private provider failure"); };
  await assert.rejects(docs.upload({ ...file, originalname: "uncertain.pdf" }, owner, key,
    { uploadOne: failedUpload }), error => error.code === "EXPENSE_DOCUMENT_UPLOAD_UNCONFIRMED");
  await assert.rejects(docs.upload({ ...file, originalname: "uncertain.pdf" }, owner, key,
    { uploadOne: failedUpload }), error => error.code === "EXPENSE_DOCUMENT_UNCONFIRMED");
  assert.equal(calls, 1);
});
test("audit history and financial expense records cannot be permanently removed", async () => {
  await assert.rejects(c.Event.updateOne({}, { $set: { reason: "altered" } }), /immutable/i);
  await assert.rejects(c.Event.deleteMany({}), /immutable/i);
  await assert.rejects(c.Expense.deleteMany({}), /cannot be permanently deleted/i);
  await assert.rejects(c.Registry.deleteMany({}), /cannot be permanently deleted/i);
  await assert.rejects(c.Document.deleteMany({}), /cannot be permanently deleted/i);
});
test("all seven report types export genuine PDF and XLSX files with scoped totals", async () => {
  const ExcelJS = require("exceljs");
  for (const type of reports.TYPES) {
    const pdfReport = await reports.exportReport({ type, format: "pdf" }, owner);
    assert.equal(pdfReport.buffer.subarray(0, 5).toString(), "%PDF-");
    const excel = await reports.exportReport({ type, format: "xlsx" }, owner);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(excel.buffer);
    assert.equal(workbook.getWorksheet("Expense records").rowCount > 1, true);
    assert.equal(workbook.getWorksheet("Report scope").getCell("B4").value, "NGN");
  }
  const summary = await reports.summary({}, owner);
  assert.equal(summary.totals.totalMinor, summary.totals.approvedMinor + summary.totals.paidMinor);
  assert.equal(summary.coverageNote.includes("not provider-verified"), true);
});
test("expense and reporting workflows never mutate customer custody or historical transactions", async () => {
  const db = mongoose.connection.db;
  assert.equal(JSON.stringify({
    wallets: await db.collection("wallets").find().toArray(),
    transactions: await db.collection("transactions").find().toArray(),
  }), protectedBefore);
  assert.equal((await startup.inspect(db)).ready, true);
  assert.equal((await c.storage.readiness()).ready, true);
});
test("HTTP lifecycle enforces real staff authorization and returns the frontend contract", async () => {
  const payload = input({ documentIds: [], evidenceExceptionReason: "Explicit HTTP integration test evidence exception" });
  const createdResponse = await request(owner, "/expenses", { method: "POST",
    headers: { "Idempotency-Key": nextKey() }, body: JSON.stringify(payload) });
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json()).data.item;
  assert.equal(created.amountMinor, 125025);
  assert.equal(created.actions.includes("SUBMIT"), true);
  const submitResponse = await request(owner, `/expenses/${created.id}/actions`, { method: "POST",
    headers: { "Idempotency-Key": nextKey() }, body: JSON.stringify({ action: "SUBMIT",
      expectedVersion: created.revision, reason: "Submit via actual isolated HTTP route" }) });
  assert.equal(submitResponse.status, 200);
  const submitted = (await submitResponse.json()).data.item;
  const approvalResponse = await request(reviewer, `/expenses/${created.id}/actions`, { method: "POST",
    headers: { "Idempotency-Key": nextKey() }, body: JSON.stringify({ action: "APPROVE",
      expectedVersion: submitted.revision, reason: "Independent HTTP authorization verification" }) });
  assert.equal(approvalResponse.status, 200);
  assert.equal((await approvalResponse.json()).data.item.status, "APPROVED");
});
test("legacy guard preserves history and closes the old record-only approval bypass", async () => {
  const Audit = require("../models/adminAuditLog.model");
  const legacy = require("../services/financialControl.service");
  const db = mongoose.connection.db;
  const exists = await db.listCollections({ name: Audit.collection.name }, { nameOnly: true }).hasNext();
  if (!exists) await db.createCollection(Audit.collection.name);
  const id = new mongoose.Types.ObjectId(require("../services/financialControl.rules")
    .expenseReferenceId("PRESERVE-LEGACY-EXPENSE")), today = input().expenseDate;
  const historical = { _id: id, actorId: new mongoose.Types.ObjectId(owner.id), actorRole: "HEAD_OFFICE",
    action: legacy.EXPENSE, reason: "Historical isolated fixture", status: "SUCCESSFUL", createdAt: new Date(),
    metadata: { financialExpense: { amount: 25.5, date: today, category: "HOSTING",
      description: "Original historical cost", reference: "PRESERVE-LEGACY-EXPENSE",
      supportingDocument: { name: "old.pdf", type: "application/pdf", size: pdf.length, dataBase64: pdf.toString("base64") } } } };
  await Audit.collection.insertOne(historical);
  const before = JSON.stringify(await Audit.collection.findOne({ _id: id }));
  const response = await request(owner, `/legacy-expenses?from=${today}&to=${today}`);
  assert.equal(response.status, 200);
  const data = (await response.json()).data;
  assert.equal(data.items.find(row => row.id === String(id)).amount, 25.5);
  assert.equal("dataBase64" in data.items[0].supportingDocument, false);
  const document = await request(owner, `/legacy-expenses/${id}/document`);
  assert.equal(document.status, 200);
  assert.deepEqual(Buffer.from(await document.arrayBuffer()), pdf);
  await assert.rejects(legacy.recordExpense({ amount: 25, category: "HOSTING", date: today,
    description: "New legacy submissions must use approvals", reference: "BLOCKED-LEGACY-SUBMISSION",
    costNotAlreadyDeducted: true }, { _id: owner.id, role: "HEAD_OFFICE" }),
    error => error.statusCode === 409 && /Financial Management/.test(error.message));
  await assert.rejects(create({ reference: "PRESERVE-LEGACY-EXPENSE", documentIds: [],
    evidenceExceptionReason: "This must not duplicate the historical expense" }),
  error => error.code === "EXPENSE_LEGACY_DUPLICATE");
  assert.equal(JSON.stringify(await Audit.collection.findOne({ _id: id })), before);
});
test("storage guard rejects hidden, sparse, expiring or non-simple financial safeguards", () => {
  const expected = { key: { requestKey: 1 }, unique: true };
  assert.equal(c.storage.matches({ key: expected.key, unique: true }, expected), true);
  for (const extra of [{ hidden: true }, { sparse: true }, { expireAfterSeconds: 100 },
    { collation: { locale: "en" } }]) {
    assert.equal(c.storage.matches({ key: expected.key, unique: true, ...extra }, expected), false);
  }
});
test("multiple approval steps require distinct eligible people and preserve the policy snapshot", async () => {
  const refs = [{ id: reviewer.id, staffRoleId: reviewer.roleId }, { id: third.id, staffRoleId: third.roleId }];
  assert.equal(catalog.canAllocateReviewers([
    { userIds: [reviewer.id, third.id], roleIds: [] }, { userIds: [reviewer.id], roleIds: [] },
  ], refs, []), true);
  assert.equal(catalog.canAllocateReviewers([
    { userIds: [reviewer.id], roleIds: [] }, { userIds: [reviewer.id], roleIds: [] },
  ], refs, []), false);
  const current = (await catalog.policy(owner)).policy;
  await catalog.write("POLICY", null, { expectedVersion: current.revision, reason: "Configure distinct two step review test",
    approvalSteps: [{ label: "First independent check", userIds: [reviewer.id], roleIds: [] },
      { label: "Second independent check", userIds: [third.id], roleIds: [] }] }, owner, nextKey());
  const created = await create({ documentIds: [], evidenceExceptionReason: "Explicit isolated evidence exception for multistep" });
  const submitted = await action(created.item, "SUBMIT");
  const first = await action(submitted.item, "APPROVE", reviewer);
  assert.equal(first.item.status, "PENDING_APPROVAL");
  await assert.rejects(action(first.item, "APPROVE", reviewer), error => error.statusCode === 403);
  const second = await action(first.item, "APPROVE", third);
  assert.equal(second.item.status, "APPROVED");
  assert.equal(second.item.approvals.length, 2);
});
