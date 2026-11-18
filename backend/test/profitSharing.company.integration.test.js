"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
for (const key of ["MONGODB_URI", "MONGO_URI", "MONGO_URL", "DATABASE_URL"]) {
  assert.equal(Boolean(process.env[key]), false, "Disposable local database only");
}
const mongoose = require("mongoose");
mongoose.set("autoIndex", false); mongoose.set("autoCreate", false);
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const M = require("../models/profitSharing.models"), N = require("../models/businessNetwork.models");
const Tx = require("../models/transaction.model"), User = require("../models/user.model");
const Commission = require("../models/commission.model"), Ledger = require("../models/ledgerEntry.model");
const { createEngine } = require("../services/profitSharing.engine");
const { createCompany, ownsTransaction, ID } = require("../services/profitSharing.company");
const { createWorker } = require("../services/profitSharing.companyWorker");
let mongo, company, engine, people, actor, snapshot;
let instant = new Date("2030-06-01T12:00:00Z");
const now = () => new Date(instant);
const tick = () => { instant = new Date(+instant + 1000); return now(); };
const rates = { HEAD_OFFICE: 37, ZONAL_MANAGER: 29, STATE_MANAGER: 23, AGGREGATOR: 11 };
const base = revision => ({ revision, reason: "Isolated company configuration test", confirmation: true });
async function save(percentages = rates, key = `rule-${+now()}`) {
  const state = await company.read();
  return company.save(actor, { ...base(state.revision), idempotencyKey: key, percentages });
}
async function activate(enabled) {
  const state = await company.read();
  return company.activate(actor, { ...base(state.revision), enabled });
}
async function transaction(extra = {}) {
  const _id = new mongoose.Types.ObjectId();
  const row = { _id, reference: `isolated-company-${_id}`, serviceType: "DATA",
    providerRequestId: `isolated-provider-${_id}`,
    provider: "SYNTHETIC", customerId: people.customer, amount: 100,
    status: "SUCCESSFUL", createdAt: tick(), updatedAt: now(), hierarchyCapturedAt: now(),
    agentId: people.aggregator, stateManagerId: people.state, zonalManagerId: people.zone,
    providerResponse: {}, ...extra };
  await Tx.collection.insertOne(row); return row;
}
async function evidence(row, patch = {}) {
  // Isolated synthetic accounting-close record, never a production producer.
  const revenueId = new mongoose.Types.ObjectId();
  await Ledger.collection.insertOne({ _id: revenueId, user: row.customerId, transactionId: row._id,
    reference: row.reference, amount: row.amount, direction: "DEBIT", status: "POSTED", reversalOf: null });
  await M.Event.create({ _id: `provider-debit:${row._id}`, kind: "PROVIDER_DEBIT_EVIDENCE",
    transaction: row._id, data: { provider: row.provider, serviceType: row.serviceType,
      requestReference: row.providerRequestId, source: "AUTHENTICATED_PURCHASE_BALANCE_DELTA",
      supplierDebitKobo: 8000 } });
  await M.Event.create({ _id: `verified-company-profit:${row._id}`, kind: "VERIFIED_COMPANY_PROFIT",
    transaction: row._id, data: { reference: row.reference, provider: row.provider, serviceType: row.serviceType,
      settlementVerified: true, revenueVerified: true, expensesVerified: true,
      revenueEvidenceReference: String(revenueId), expenseEvidenceReference: "isolated-expense-proof",
      costs: { verified: true, customerAmountKobo: 10000, revenueKobo: 10000,
        providerCostKobo: 8000, directCostsKobo: 100, otherApprovedCostsKobo: 100,
        evidenceReference: `provider-debit:${row._id}`, otherCostsApprovalReference: "isolated-approved-cost" },
      ...patch } });
}
test.before(async () => {
  mongo = await MongoMemoryReplSet.create({ binary: { systemBinary: process.env.MONGOMS_SYSTEM_BINARY },
    replSet: { count: 1, storageEngine: "wiredTiger" }, instanceOpts: [{ args: ["--nounixsocket"] }] });
  assert.match(mongo.getUri(), /^mongodb:\/\/127\.0\.0\.1:/);
  await mongoose.connect(mongo.getUri(), { dbName: "isolated-company-profit" });
  for (const model of [...Object.values(M), N.Settings, N.Audit, N.Ledger, Tx, User, Commission, Ledger]) {
    await mongoose.connection.db.createCollection(model.collection.name);
  }
  people = Object.fromEntries(["customer", "aggregator", "state", "zone", "head"].map(key =>
    [key, new mongoose.Types.ObjectId()]));
  actor = { _id: people.head, role: "HEAD_OFFICE" };
  await User.collection.insertMany([["customer", "CUSTOMER"], ["aggregator", "AGENT"],
    ["state", "STATE_MANAGER"], ["zone", "ZONAL_MANAGER"], ["head", "HEAD_OFFICE"]].map(([key, role]) => ({
    _id: people[key], role, status: "ACTIVE", isDeleted: false, walletBalance: 1234.004603467313,
    commissionBalance: 77, referralCode: `preserve-${key}`,
  })));
  snapshot = await User.collection.find().sort({ _id: 1 }).toArray();
  engine = createEngine({ now, withdrawalReadiness: async () => ({ ready: true }) });
  company = createCompany({ engine, now, withdrawalReadiness: async () => ({ ready: true }) });
});
test.after(async () => { await mongoose.disconnect(); await mongo?.stop(); });
test("company starts blank, cannot enable without explicit 100% rates, and never adopts legacy policy", async () => {
  await N.Settings.create({ _id: "profit-sharing", revision: 7,
    profitSharing: { services: { DATA: { versions: [{ policyVersion: 1, poolPercentage: 40 }] } } } });
  const state = await company.read();
  assert.equal(state.enabled, false); assert.equal(state.currentRule, null);
  await assert.rejects(activate(true), { code: "INVALID_PERCENTAGE_ROLES" });
  await assert.rejects(save({ ...rates, AGGREGATOR: 12 }), { code: "PERCENTAGES_MUST_TOTAL_100" });
  assert.equal(await N.Settings.findById(ID).lean(), null);
});
test("company saves immediate policy, enables without any service adapters and preserves legacy settings", async () => {
  const legacy = await N.Settings.findById("profit-sharing").lean();
  const saved = await save();
  assert.deepEqual(saved.currentRule.percentages, rates); assert.equal(saved.enabled, false);
  assert.equal(saved.currentRule.createdAt, now().toISOString());
  const enabled = await activate(true);
  assert.equal(enabled.enabled, true);
  assert.deepEqual(enabled.storageBlockers, []);
  assert.equal((await engine.status()).distributionLive, false, "Legacy service engine remains independent");
  assert.deepEqual(await N.Settings.findById("profit-sharing").lean(), legacy);
});
test("company rule saves are idempotent and revision-fenced, with exactly four beneficiaries", async () => {
  tick();
  const before = await company.read(), body = { ...base(before.revision), percentages: rates, idempotencyKey: "company-replay-001" };
  const first = await company.save(actor, body), audits = await N.Audit.countDocuments({});
  const replay = await company.save(actor, body);
  assert.equal(replay.revision, first.revision);
  assert.equal(await N.Audit.countDocuments({}), audits);
  await assert.rejects(company.save(actor, { ...body, reason: "Different request using same key" }), { code: "IDEMPOTENCY_CONFLICT" });
  await assert.rejects(company.activate(actor, { ...base(before.revision), enabled: false }), { code: "COMPANY_CONFIGURATION_CHANGED" });
  await assert.rejects(company.save(actor, { ...base(first.revision), idempotencyKey: "bad-five-roles",
    percentages: { ...rates, BRM: 0 } }), { code: "INVALID_PERCENTAGE_ROLES" });
});
test("company ownership excludes legacy writers only within prospective activation windows", async () => {
  const row = await transaction();
  assert.equal(await ownsTransaction(row), true);
  const old = await transaction({ createdAt: new Date("2029-01-01") });
  assert.equal(await ownsTransaction(old), false);
  const service = require("../services/commission.service");
  assert.equal((await service.buildTelecomAbodeDataCommissionRecords({ transaction: row })).custody, "PROFIT_SHARING");
  assert.equal((await service.distributeCommission({ transaction: row })).custody, "PROFIT_SHARING");
  assert.equal(await Commission.countDocuments({}), 0);
});
test("company missing or caller-forged profit stays pending without altering customer balances", async () => {
  const row = await transaction({ providerResponse: { verified: true, profit: 9999999, expensesVerified: true } });
  assert.equal((await company.settle(row._id)).status, "PENDING_VERIFICATION");
  assert.equal((await company.settle(row._id)).status, "PENDING_VERIFICATION");
  assert.equal(await M.Event.countDocuments({ _id: `company-pending:${row._id}` }), 1);
  assert.equal(await M.Account.countDocuments({}), 0);
  assert.equal((await company.read()).pendingAmountKobo, null);
  assert.deepEqual(await User.collection.find().sort({ _id: 1 }).toArray(), snapshot);
});
test("company verified profitable transaction allocates all four rates and immutable ledgers exactly once concurrently", async () => {
  const row = await transaction(); await evidence(row);
  const outcomes = await Promise.all(Array.from({ length: 8 }, () => company.settle(row._id)));
  assert.equal(outcomes.filter(item => item.status === "SETTLED").length, 1);
  assert.equal(await M.Event.countDocuments({ _id: `accrual:${row._id}` }), 1);
  const event = await M.Event.findById(`accrual:${row._id}`).lean();
  assert.equal(event.data.plan.netProfitKobo, 1800);
  assert.equal(event.data.entries.length, 4);
  assert.equal(event.data.entries.reduce((sum, item) => sum + item.amountKobo, 0), 1800);
  for (const [role, rate] of Object.entries(rates)) {
    assert.equal(event.data.entries.find(item => item.role === role).amountKobo, 1800 * rate / 100);
  }
  assert.equal((await M.Account.findById("head-office").lean()).availableKobo, 666);
  await assert.rejects(M.Event.updateOne({ _id: event._id }, { $set: { data: {} } }), /append-only/);
  assert.deepEqual(await User.collection.find().sort({ _id: 1 }).toArray(), snapshot);
});
test("company incomplete cost, expense or transaction evidence never authorizes credits", async () => {
  for (const patch of [
    { expensesVerified: false }, { revenueVerified: false }, { settlementVerified: false },
    { reference: "wrong-reference" }, { expenseEvidenceReference: "" },
    { costs: { verified: true, revenueKobo: 10000, providerCostKobo: 8000, customerAmountKobo: 10000,
      evidenceReference: "isolated" } },
  ]) {
    const row = await transaction(); await evidence(row, patch);
    assert.equal((await company.settle(row._id)).status, "PENDING_VERIFICATION");
    assert.equal(await M.Event.findById(`accrual:${row._id}`).lean(), null);
  }
});
test("company pause prevents new ownership and credits, while preserving old windows and future-only rules", async () => {
  const old = await transaction(); await evidence(old);
  tick(); await activate(false);
  assert.equal(await ownsTransaction(old), true);
  const paused = await transaction(); await evidence(paused);
  assert.equal(await ownsTransaction(paused), false);
  assert.equal((await company.settle(old._id)).status, "DISABLED");
  tick(); await save({ HEAD_OFFICE: 40, ZONAL_MANAGER: 30, STATE_MANAGER: 20, AGGREGATOR: 10 });
  await activate(true);
  assert.equal((await company.settle(paused._id)).status, "OUTSIDE_ACTIVATION_WINDOW");
  await company.settle(old._id);
  assert.deepEqual((await M.Event.findById(`accrual:${old._id}`).lean()).data.plan.allocations.map(row => row.basisPoints),
    [3700, 2900, 2300, 1100]);
  const fresh = await transaction(); await evidence(fresh); await company.settle(fresh._id);
  assert.deepEqual((await M.Event.findById(`accrual:${fresh._id}`).lean()).data.plan.allocations.map(row => row.basisPoints),
    [4000, 3000, 2000, 1000]);
});
test("company no-positive-profit, missing hierarchy and legacy conflicts fail closed", async () => {
  const negative = await transaction();
  await evidence(negative, { costs: { verified: true, customerAmountKobo: 10000, revenueKobo: 10000,
    providerCostKobo: 8000, directCostsKobo: 2000, otherApprovedCostsKobo: 100,
    evidenceReference: `provider-debit:${negative._id}`, otherCostsApprovalReference: "isolated" } });
  assert.equal((await company.settle(negative._id)).status, "NO_POSITIVE_NET_PROFIT");
  const missing = await transaction({ hierarchyCapturedAt: null }); await evidence(missing);
  assert.equal((await company.settle(missing._id)).code, "VERIFIED_HIERARCHY_REQUIRED");
  const prior = await transaction(); await evidence(prior);
  await Commission.collection.insertOne({ _id: new mongoose.Types.ObjectId(), transactionId: prior._id });
  assert.equal((await company.settle(prior._id)).code, "LEGACY_COMMISSION_CONFLICT");
});
test("company reversals use canonical refund ledger, remain idempotent and work while paused", async () => {
  const row = await transaction(); await evidence(row); await company.settle(row._id);
  const before = await M.Account.findById("head-office").lean();
  const debitId = new mongoose.Types.ObjectId(), creditId = new mongoose.Types.ObjectId();
  await Ledger.collection.insertMany([
    { _id: debitId, user: row.customerId, transactionId: row._id, reference: row.reference,
      amount: row.amount, direction: "DEBIT", status: "POSTED", reversalOf: null },
    { _id: creditId, user: row.customerId, transactionId: new mongoose.Types.ObjectId(),
      amount: row.amount, direction: "CREDIT", status: "POSTED", reversalOf: debitId },
  ]);
  await Tx.collection.updateOne({ _id: row._id }, { $set: { status: "REFUNDED",
    debitLedgerEntryId: debitId, reversalLedgerEntryId: creditId } });
  tick(); await activate(false);
  assert.equal((await engine.reverse(row._id)).status, "REVERSED");
  assert.equal((await engine.reverse(row._id)).status, "ALREADY_REVERSED");
  const after = await M.Account.findById("head-office").lean();
  assert.equal(before.availableKobo - after.availableKobo, 720);
  assert.deepEqual(await User.collection.find().sort({ _id: 1 }).toArray(), snapshot);
});
test("company activation checks storage and actor permission independently of providers", async () => {
  const unsafe = createCompany({ engine, now, withdrawalReadiness: async () => ({ ready: false }) });
  await assert.rejects(unsafe.activate(actor, { ...base((await company.read()).revision), enabled: true }), { code: "STORAGE_NOT_READY" });
  for (const role of ["CUSTOMER_SUPPORT", "OPERATIONS_MANAGER", "STATE_MANAGER"]) {
    await assert.rejects(company.activate({ _id: actor._id, role },
      { ...base((await company.read()).revision), enabled: true }), { code: "HEAD_OFFICE_REQUIRED" });
  }
});
test("company automatic worker independently discovers transactions and retries late evidence", async () => {
  tick(); await activate(true);
  const row = await transaction();
  const worker = createWorker({ company, engine });
  const first = await worker.runBatch();
  assert.equal(first.status, "PROCESSED");
  // Discovery is deliberately bounded; earlier fixtures occupy the first page.
  for (let count = 0; count < 4 && !await M.Event.findById(`company-pending:${row._id}`).lean(); count++) {
    await worker.runBatch();
  }
  assert.ok(await M.Event.findById(`company-pending:${row._id}`).lean());
  await evidence(row);
  for (let count = 0; count < 4 && !await M.Event.findById(`accrual:${row._id}`).lean(); count++) {
    await worker.runBatch();
  }
  assert.ok(await M.Event.findById(`accrual:${row._id}`).lean());
  assert.deepEqual(await User.collection.find().sort({ _id: 1 }).toArray(), snapshot);
});
test("company partial credit failure rolls back every allocation and settlement event", async () => {
  const row = await transaction(); await evidence(row);
  const before = await M.Account.find().sort({ _id: 1 }).lean();
  let writes = 0;
  const broken = createCompany({ engine: { ...engine, updateAccount: async (...args) => {
    if (++writes === 2) throw Error("Isolated storage failure");
    return engine.updateAccount(...args);
  } }, now, withdrawalReadiness: async () => ({ ready: true }) });
  await assert.rejects(broken.settle(row._id), /Isolated storage failure/);
  assert.deepEqual(await M.Account.find().sort({ _id: 1 }).lean(), before);
  assert.equal(await M.Event.findById(`accrual:${row._id}`).lean(), null);
  assert.equal((await Tx.findById(row._id).lean()).providerResponse.profitSharingFence, undefined);
});
test("company financial-close flags cannot replace actual revenue, supplier debit or fee evidence", async () => {
  const missingRevenue = await transaction();
  await evidence(missingRevenue, { revenueEvidenceReference: String(new mongoose.Types.ObjectId()) });
  assert.equal((await company.settle(missingRevenue._id)).code, "POSTED_REVENUE_EVIDENCE_REQUIRED");
  const wrongCost = await transaction();
  await evidence(wrongCost, { costs: { verified: true, customerAmountKobo: 10000, revenueKobo: 10000,
    providerCostKobo: 7999, directCostsKobo: 100, otherApprovedCostsKobo: 100,
    evidenceReference: `provider-debit:${wrongCost._id}`, otherCostsApprovalReference: "isolated" } });
  assert.equal((await company.settle(wrongCost._id)).code, "AUTHENTICATED_SUPPLIER_DEBIT_REQUIRED");
  const principal = await transaction({ serviceType: "TRANSFER" }); await evidence(principal);
  assert.equal((await company.settle(principal._id)).code, "INDEPENDENT_FEE_REVENUE_EVIDENCE_REQUIRED");
  for (const row of [missingRevenue, wrongCost, principal]) {
    assert.equal(await M.Event.findById(`accrual:${row._id}`).lean(), null);
  }
});
test("company definitive zero-profit closes pending verification without manufacturing earnings", async () => {
  const row = await transaction();
  await company.settle(row._id);
  const before = (await company.read()).pendingVerificationCount;
  await evidence(row, { costs: { verified: true, customerAmountKobo: 10000, revenueKobo: 10000,
    providerCostKobo: 8000, directCostsKobo: 2000, otherApprovedCostsKobo: 100,
    evidenceReference: `provider-debit:${row._id}`, otherCostsApprovalReference: "isolated" } });
  assert.equal((await company.settle(row._id)).status, "NO_POSITIVE_NET_PROFIT");
  assert.equal((await company.read()).pendingVerificationCount, before - 1);
  assert.equal(await M.Event.findById(`accrual:${row._id}`).lean(), null);
  assert.equal((await company.settle(row._id)).status, "NO_POSITIVE_NET_PROFIT");
  assert.deepEqual(await User.collection.find().sort({ _id: 1 }).toArray(), snapshot);
});
