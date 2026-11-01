const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const Transaction = require("../models/transaction.model");
const Commission = require("../models/commission.model");
const Audit = require("../models/adminAuditLog.model");
const s = require("../services/financialControl.service");
const c = require("../controllers/financialControl.controller");
const guards = require("../routes/financialControl.routes");
let mongo;
const actor = { _id: new mongoose.Types.ObjectId(), role: "HEAD_OFFICE" };
const branch = new mongoose.Types.ObjectId();
const expense = (extra = {}) => ({ amount: 25, category: "HOSTING", date: "2026-10-02",
  description: "Separate controlled test expense", reference: "TEST-INVOICE", costNotAlreadyDeducted: true, ...extra });
const query = { from: "2026-10-01", to: "2026-10-31" };
before(async () => {
  // Never use MONGODB_URI, a Render URI or another ambient production database.
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  const uri = mongo.getUri();
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:/);
  await mongoose.connect(uri, { dbName: "financial-control-disposable" });
  await Promise.all([Transaction, Commission, Audit].map(Model => Model.init()));
  // Historical report fixture: bypass new-purchase admission deliberately.
  // The reporting service must read preserved records without recapturing custody.
  await Transaction.collection.insertOne({ _id: new mongoose.Types.ObjectId(),
    reference: "FCC-HISTORICAL", customerId: actor._id, branchId: branch,
    hierarchyCapturedAt: new Date("2026-10-02"), serviceType: "DATA", provider: "TELECOM_ABODE",
    amount: 150, agentCommission: 0, stateManagerCommission: 0, zonalManagerCommission: 0,
    status: "SUCCESSFUL", createdAt: new Date("2026-10-02T10:00:00Z"),
    providerResponse: { networkName: "MTN", planName: "Historical plan",
      telecomAbodeSettlement: { outcome: "SUCCESS", requestIdMatches: true },
      financialAccounting: { providerCost: 100, status: "VERIFIED", providerFee: 0, processingFee: 0, otherDirectCosts: 0 } } });
});
after(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });
test("read-only summary does not create namespaces or mutate transactions", async () => {
  const collections = async () => (await mongoose.connection.db.listCollections().toArray()).map(x => x.name).sort();
  const beforeCollections = await collections();
  const beforeTransaction = await Transaction.findOne({ reference: "FCC-HISTORICAL" }).lean();
  const result = await s.summary(query);
  assert.equal(result.totals.recordedRevenue, 50);
  assert.equal(result.totals.transactionValue, 150);
  assert.equal(result.totals.grossProfit, 50);
  assert.equal(result.totals.netProfit, null);
  assert.equal(result.reconciliation.status, "PARTIALLY RECONCILED");
  assert.equal(result.plans[0].providerCost, 100);
  assert.deepEqual(await collections(), beforeCollections);
  assert.deepEqual(await Transaction.findOne({ reference: "FCC-HISTORICAL" }).lean(), beforeTransaction);
});
test("six concurrent exact expense retries persist only one expense and one dedup claim", async () => {
  const results = await Promise.all(Array.from({ length: 6 }, () => s.recordExpense(expense(), actor)));
  assert.equal(new Set(results.map(x => x.item.id)).size, 1);
  assert.equal(await Audit.countDocuments({ action: s.EXPENSE }), 1);
  assert.equal(await Audit.countDocuments({ action: s.CLAIM }), 1);
});
test("duplicate invoice reference with changed details is rejected", async () => {
  await assert.rejects(s.recordExpense(expense({ amount: 26 }), actor), e => e.statusCode === 409);
});
test("different reference cannot double-record the same independently incurred expense", async () => {
  await assert.rejects(s.recordExpense(expense({ reference: "DUPLICATE-ALIAS" }), actor), e => e.statusCode === 409);
  assert.equal(await Audit.countDocuments({ action: s.EXPENSE }), 1);
});
test("failure writing the expense audit rolls back its claim", async () => {
  await assert.rejects(s.recordExpense(expense({ reference: "BAD-ACTOR", description: "Rollback evidence fixture" }),
    { _id: null, role: "HEAD_OFFICE" }));
  assert.equal(await Audit.countDocuments({ action: s.CLAIM }), 1);
});
test("expenses are summed once without claiming complete period coverage or net profit", async () => {
  const result = await s.summary(query);
  assert.equal(result.totals.operatingExpenses, 25);
  assert.equal(result.totals.netProfit, null);
  assert.equal((await s.expenses(query)).items.length, 1);
  assert.equal((await s.expenses({ from: "2026-11-01", to: "2026-11-02" })).items.length, 0);
});
test("filtered profit never subtracts unrelated company-wide expenses", async () => {
  const result = await s.summary({ ...query, service: "DATA", network: "MTN" });
  assert.equal(result.totals.operatingExpenses, null);
});
test("supporting evidence is private in list responses and preserved in the immutable audit", async () => {
  const created = await s.recordExpense(expense({ reference: "PDF-PROOF", description: "Different invoice with private proof",
    supportingDocument: { name: "proof.pdf", type: "application/pdf",
      dataBase64: Buffer.from("%PDF-1.4\n%%EOF").toString("base64") } }), actor);
  assert.equal(created.item.supportingDocument.dataBase64, undefined);
  assert.equal((await s.document(created.item.id)).type, "application/pdf");
  await assert.rejects(Audit.updateOne({ _id: created.item.id }, { reason: "edit" }), /immutable/);
});
for (const role of ["CUSTOMER_SUPPORT", "OPERATIONS_MANAGER", "BRANCH_MANAGER", "BRANCH_STAFF", "STAFF", "CUSTOMER", "SUPER_ADMIN"]) {
  test(role + " cannot access Head Office financial control even with wildcard", () => {
    let continued = false, status;
    guards.headOffice({ user: { role }, staffAccess: { isHeadOffice: role === "SUPER_ADMIN",
      scope: { type: "GLOBAL" }, permissions: ["*"] } },
    { status(value) { status = value; return this; }, json() {} }, () => { continued = true; });
    assert.equal(status, 403);
    assert.equal(continued, false);
  });
}
test("authorized Head Office can access financial reporting", () => {
  let passed = false;
  guards.headOffice({ user: actor, staffAccess: { isHeadOffice: true, scope: { type: "GLOBAL" } } },
    {}, () => { passed = true; });
  assert.equal(passed, true);
});
test("limited Operations and assigned Branch summaries cannot leak company profit/expense", async () => {
  for (const roleName of ["OPERATIONS_MANAGER", "BRANCH_MANAGER"]) {
    let body;
    const req = { query, user: { branchId: branch }, staffAccess: { roleName, scope: { branchId: branch } } };
    const res = { headersSent: false, json(value) { body = value; }, status() { return this; } };
    await c.operational(req, res);
    assert.equal(body.success, true);
    for (const key of ["netProfit", "grossProfit", "recordedRevenue", "operatingExpenses", "providerCosts"]) {
      assert.equal(body.data[key], undefined);
    }
  }
});
test("branch summary cannot select another branch", async () => {
  let status;
  await c.operational({ query: { ...query, branch: String(new mongoose.Types.ObjectId()) },
    user: { branchId: branch }, staffAccess: { roleName: "BRANCH_MANAGER", scope: { branchId: branch } } },
  { headersSent: false, status(value) { status = value; return this; }, json() {} });
  assert.equal(status, 403);
});
test("CSV/PDF exports contain period, reconciliation and unknown-profit notice", async () => {
  for (const format of ["csv", "pdf"]) {
    const req = { query: { ...query, format }, user: actor };
    const { PassThrough } = require("node:stream");
    const res = new PassThrough();
    let bytes = [], done;
    const ended = new Promise(resolve => { done = resolve; });
    res.on("data", x => bytes.push(x)); res.on("end", done);
    res.set = () => res; res.type = () => res;
    res.send = value => res.end(value); res.json = () => assert.fail("Export failed"); res.status = () => res;
    await c.report(req, res); await ended;
    const data = Buffer.concat(bytes);
    if (format === "pdf") assert.equal(data.subarray(0, 5).toString(), "%PDF-");
    else {
      assert.match(data.toString(), /2026-10-01/);
      assert.match(data.toString(), /PARTIALLY RECONCILED/);
      assert.match(data.toString(), /DATA UNAVAILABLE/);
    }
  }
});
