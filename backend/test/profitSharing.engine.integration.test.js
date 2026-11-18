"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), path = require("node:path");
for (const key of ["MONGODB_URI", "MONGO_URI", "MONGO_URL", "DATABASE_URL"]) {
  assert.equal(Boolean(process.env[key]), false, `Remove ambient ${key}: isolated database only.`);
}
const mongoose = require(require.resolve("mongoose", { paths: [path.resolve(__dirname, "..")] }));
mongoose.set("autoIndex", false); mongoose.set("autoCreate", false);
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const M = require("../models/profitSharing.models"), N = require("../models/businessNetwork.models");
const Tx = require("../models/transaction.model"), User = require("../models/user.model");
const Commission = require("../models/commission.model"), Ledger = require("../models/ledgerEntry.model");
const { createEngine, ruleAt, kobo } = require("../services/profitSharing.engine");
const { createWorker } = require("../services/profitSharing.worker");
const { percentageBasisPoints } = require("../services/profitSharing.policy");
let mongo, engine, actor, people, usersBefore;
const clock = () => new Date("2030-06-01T12:00:00Z");
const rates = { HEAD_OFFICE: 38, ZONAL_MANAGER: 27, STATE_MANAGER: 21, AGGREGATOR: 14 };
const dataRule = { id: "synthetic-data-rule", serviceType: "DATA", enabled: true,
  effectiveAt: "2030-01-01T00:00:00Z", createdAt: "2029-12-01T00:00:00Z",
  policyVersion: 3, percentages: rates };
// TEST-ONLY adapter. No such contract or synthetic evidence reader is
// registered in the production adapter registry.
const adapter = {
  version: "synthetic-contract", contractReference: "isolated-fixture-only",
  verifiedSettlement: true, verifiedRevenue: true, actualProviderCost: true, approvedDirectCosts: true,
  atomicAdmission: true, legacyExclusion: true, refundIntegration: true, durableRecovery: true,
  inspect: async tx => ({
    transactionId: String(tx._id), reference: tx.reference, serviceType: tx.serviceType,
    provider: tx.provider, settlementVerified: tx.providerResponse?.syntheticVerified !== false,
    costs: { verified: true, evidenceReference: `synthetic-cost:${tx._id}`,
      customerAmountKobo: Math.round(tx.amount * 100), revenueKobo: 10000, providerCostKobo: 8000,
      directCostsKobo: 100, otherApprovedCostsKobo: 100,
      otherCostsApprovalReference: "synthetic-cost-approval", ...tx.providerResponse?.syntheticCosts },
  }),
};
function instance(extra = {}) {
  return createEngine({ now: clock, adapters: { DATA: adapter, AIRTIME: adapter }, ...extra });
}
async function tx(extra = {}) {
  const _id = new mongoose.Types.ObjectId();
  const row = { _id, reference: `synthetic-${_id}`, customerId: people.customer,
    serviceType: "DATA", provider: "SYNTHETIC", amount: 100, status: "PENDING",
    createdAt: new Date(clock().getTime() + 1000), updatedAt: clock(),
    hierarchyCapturedAt: clock(), agentId: people.aggregator, stateManagerId: people.state,
    zonalManagerId: people.zone, providerResponse: {}, ...extra };
  await Tx.collection.insertOne(row);
  await N.Activity.collection.insertOne({ _id: new mongoose.Types.ObjectId(), transaction: _id,
    actor: people.customer, profile: people.profile, commissionGroup: "STANDARD" });
  return row;
}
async function admission(row) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await engine.admit(row._id, session); });
    return result;
  } finally { await session.endSession(); }
}
async function successful(row) {
  await Tx.collection.updateOne({ _id: row._id }, { $set: { status: "SUCCESSFUL" } });
}
async function canonicalRefund(row) {
  const debitId = new mongoose.Types.ObjectId(), creditId = new mongoose.Types.ObjectId();
  await Ledger.collection.insertMany([
    { _id: debitId, user: people.customer, transactionId: row._id, reference: row.reference,
      amount: row.amount, direction: "DEBIT", status: "POSTED", reversalOf: null },
    { _id: creditId, user: people.customer, transactionId: new mongoose.Types.ObjectId(),
      amount: row.amount, direction: "CREDIT", status: "POSTED", reversalOf: debitId },
  ]);
  await Tx.collection.updateOne({ _id: row._id }, { $set: {
    status: "REFUNDED", debitLedgerEntryId: debitId, reversalLedgerEntryId: creditId } });
}
test.before(async () => {
  mongo = await MongoMemoryReplSet.create({ binary: { systemBinary: process.env.MONGOMS_SYSTEM_BINARY },
    replSet: { count: 1, storageEngine: "wiredTiger" }, instanceOpts: [{ args: ["--nounixsocket"] }] });
  assert.match(mongo.getUri(), /^mongodb:\/\/127\.0\.0\.1:/);
  await mongoose.connect(mongo.getUri(), { dbName: "profit-sharing-engine-only" });
  for (const model of [...Object.values(M), N.Settings, N.Audit, N.Activity, N.Profile, N.Ledger, Tx, User, Commission, Ledger]) {
    await mongoose.connection.db.createCollection(model.collection.name);
  }
  await N.Activity.collection.createIndex({ transaction: 1 }, { unique: true });
  await N.Profile.collection.createIndex({ owner: 1, kind: 1 }, { unique: true });
  people = Object.fromEntries(["customer", "retail", "aggregator", "state", "zone", "head", "profile"].map(k => [k, new mongoose.Types.ObjectId()]));
  actor = { _id: people.head, role: "HEAD_OFFICE" };
  await User.collection.insertMany([
    ["customer", "CUSTOMER"], ["retail", "CUSTOMER"], ["aggregator", "AGENT"],
    ["state", "STATE_MANAGER"], ["zone", "ZONAL_MANAGER"], ["head", "HEAD_OFFICE"],
  ].map(([key, role]) => ({ _id: people[key], role, status: "ACTIVE", fullName: `Synthetic ${key}`,
    walletBalance: 123.004603467313, commissionBalance: 7, referralCode: `preserve-${key}`, isDeleted: false })));
  usersBefore = await User.collection.find().sort({ _id: 1 }).toArray();
  await N.Profile.collection.insertOne({ _id: people.profile, owner: people.retail, kind: "AGENT",
    status: "APPROVED", approvalWindows: [{ start: new Date("2029-01-01"), services: ["DATA", "AIRTIME"] }] });
  await N.Settings.create({ _id: "profit-sharing", revision: 1,
    profitSharing: { services: { DATA: { revision: 1, versions: [dataRule] } } } });
  await N.Settings.create({ _id: "network", revision: 9, categories: ["Preserved"] });
  engine = instance();
});
test.after(async () => { await mongoose.disconnect(); await mongo?.stop(); });
test("production has no unverified adapters and refuses activation even with valid percentages", async () => {
  const production = createEngine({ now: clock });
  const ready = await production.readiness(["DATA"]);
  assert.equal(ready.ready, false);
  assert.ok(ready.services[0].blockers.includes("VERIFIED_SERVICE_ADAPTER_REQUIRED"));
  const everyService = await production.readiness();
  assert.equal(everyService.services.length, 9);
  assert.ok(everyService.services.every(s => s.blockers.includes("VERIFIED_SERVICE_ADAPTER_REQUIRED")));
  await assert.rejects(production.changeMode(actor, { mode: "LIVE", revision: 0, services: ["DATA"],
    confirmation: true, confirmationText: "ACTIVATE FUTURE PROFIT SHARING", reason: "Synthetic activation denied" }),
  { code: "ACTIVATION_PREREQUISITES_INCOMPLETE" });
  assert.equal(await M.Account.countDocuments(), 0);
});
test("precise money and latest future-effective service versions are enforced", () => {
  assert.equal(kobo(12.34), 1234);
  assert.throws(() => kobo(1.001), /EXACT_KOBO/);
  assert.throws(() => percentageBasisPoints({ ...rates, ZONAL_MANAGER: 26.99 }), /TOTAL_100/);
  const later = { ...dataRule, id: "later", effectiveAt: "2031-01-01" };
  assert.equal(ruleAt({ profitSharing: { services: { DATA: { versions: [dataRule, later] } } } }, "DATA", clock()).id, dataRule.id);
});
test("dry-run saves an auditable receipt but no account or earning", async () => {
  const row = await tx({ status: "SUCCESSFUL", createdAt: new Date("2030-05-01") });
  const result = await engine.dryRun(actor, String(row._id));
  assert.equal(result.plan.poolKobo, 1800); assert.equal(result.financialWrites, 0);
  assert.equal(result.plan.headOfficeKobo, 684);
  assert.deepEqual(result.plan.allocations.map(a => a.role), Object.keys(rates));
  assert.equal(result.plan.allocations.find(a => a.role === "AGGREGATOR").beneficiaryId, String(people.aggregator));
  assert.equal(await M.Account.countDocuments(), 0);
  assert.equal(await M.Event.countDocuments({ kind: "ACCRUAL" }), 0);
  assert.ok(await N.Audit.exists({ action: "PROFIT_SHARING_DRY_RUN" }));
});
test("activation requires matching dry-run evidence, confirmation and optimistic revision", async () => {
  const body = { mode: "LIVE", revision: 0, services: ["DATA"], confirmation: true,
    confirmationText: "ACTIVATE FUTURE PROFIT SHARING", reason: "Synthetic activation fixture" };
  await assert.rejects(engine.changeMode(actor, body), { code: "FRESH_MATCHING_DRY_RUN_REQUIRED" });
  const receipt = await M.Event.findOne({ kind: "DRY_RUN" }).lean();
  await assert.rejects(engine.changeMode(actor, { ...body, confirmationText: "yes" }), { code: "ACTIVATION_PHRASE_REQUIRED" });
  const activated = await engine.changeMode(actor, { ...body, dryRunIds: { DATA: receipt._id } });
  assert.equal(activated.mode, "LIVE"); assert.equal((await engine.status()).distributionLive, true);
  await assert.rejects(engine.changeMode(actor, { mode: "PAUSED", revision: 0,
    confirmation: true, reason: "Synthetic stale control change" }), { code: "ACTIVATION_REVISION_CHANGED" });
});
test("historical transactions are not admitted and missing sessions cannot mutate custody", async () => {
  const old = await tx({ createdAt: new Date("2029-01-01") });
  assert.equal(await admission(old), null);
  await assert.rejects(engine.admit(old._id), { code: "ACTIVE_DATABASE_TRANSACTION_REQUIRED" });
});
test("concurrent duplicate settlement credits exactly once and conserves profit", async () => {
  const row = await tx(); await admission(row); await successful(row);
  const results = await Promise.all(Array.from({ length: 8 }, () => engine.settle(row._id)));
  assert.equal(results.filter(r => r.status === "SETTLED").length, 1);
  assert.equal(await M.Event.countDocuments({ _id: `accrual:${row._id}` }), 1);
  const accounts = await M.Account.find().lean();
  assert.equal(accounts.reduce((n, a) => n + a.availableKobo, 0), 1800);
  assert.equal(await M.Account.findById(`beneficiary:${people.retail}`).lean(), null);
  assert.equal(await M.Account.findById("company").lean(), null);
  assert.equal((await M.Account.findById(`beneficiary:${people.aggregator}`).lean()).availableKobo, 252);
  assert.equal((await M.Account.findById("head-office").lean()).availableKobo, 684);
  assert.equal(await M.Account.findById(`beneficiary:${people.head}`).lean(), null);
});
test("different concurrent transactions sharing new accounts retain every credit", async () => {
  const before = (await M.Account.findById(`beneficiary:${people.aggregator}`).lean()).availableKobo;
  const rows = await Promise.all(Array.from({ length: 6 }, () => tx()));
  for (const row of rows) { await admission(row); await successful(row); }
  const results = await Promise.all(rows.map(row => engine.settle(row._id)));
  assert.ok(results.every(r => r.status === "SETTLED"));
  assert.equal((await M.Account.findById(`beneficiary:${people.aggregator}`).lean()).availableKobo - before, 6 * 252);
});
test("service-specific rules cannot use another service's percentages", async () => {
  const airtimeRates = { HEAD_OFFICE: 10, ZONAL_MANAGER: 70, STATE_MANAGER: 15, AGGREGATOR: 5 };
  const rule = { ...dataRule, id: "synthetic-airtime-rule", serviceType: "AIRTIME",
    percentages: airtimeRates };
  await N.Settings.updateOne({ _id: "profit-sharing" }, { $set: {
    "profitSharing.services.AIRTIME": { revision: 1, versions: [rule] } } });
  const preview = await engine.dryRun(actor, String((await tx({ serviceType: "AIRTIME", status: "SUCCESSFUL" }))._id));
  assert.equal(preview.plan.allocations.find(a => a.role === "AGGREGATOR").amountKobo, 90);
  assert.equal(preview.plan.headOfficeKobo, 180);
  assert.equal(preview.plan.poolKobo, 1800);
  const row = await tx({ serviceType: "AIRTIME" });
  assert.equal(await admission(row), null, "An unactivated service cannot join DATA's activation.");
});
test("admission freezes hierarchy, missing shares remain separate commission custody, and identities cannot stack", async () => {
  const row = await tx(); await admission(row);
  await Tx.collection.updateOne({ _id: row._id }, { $set: { agentId: null, stateManagerId: null } });
  await successful(row);
  await engine.settle(row._id);
  const saved = await M.Event.findById(`accrual:${row._id}`).lean();
  assert.equal(saved.data.plan.allocations.find(a => a.role === "AGGREGATOR").beneficiaryId, String(people.aggregator));
  assert.equal(saved.data.plan.costs.providerCostKobo, 8000);
  const missing = await tx({ agentId: null, stateManagerId: people.customer });
  await admission(missing); await successful(missing); await engine.settle(missing._id);
  const held = await M.Event.findById(`accrual:${missing._id}`).lean();
  assert.equal(held.data.plan.unallocatedKobo, 630);
  assert.equal(held.data.plan.headOfficeKobo, 684);
  assert.equal((await M.Account.findById("unallocated-commission").lean()).availableKobo, 630);
  assert.equal(await M.Account.findById("company").lean(), null);
  const Policy = require("../services/profitSharing.policy");
  const duplicate = Policy.allocate(1800, rates, { AGGREGATOR: { id: String(people.aggregator), eligible: true },
    STATE_MANAGER: { id: String(people.aggregator), eligible: true } });
  assert.equal(duplicate.allocations.filter(a => a.custody === "BENEFICIARY").length, 1);
});
test("legacy manager and retail writers do not create a second commission for admitted transactions", async () => {
  const row = await tx(); await admission(row); await successful(row);
  const current = await Tx.findById(row._id).lean();
  const service = require("../services/commission.service");
  assert.deepEqual(await service.buildTelecomAbodeDataCommissionRecords({ transaction: current }),
    { configured: false, records: [], custody: "PROFIT_SHARING" });
  assert.equal((await service.distributeCommission({ transaction: current })).custody, "PROFIT_SHARING");
  assert.equal(await Commission.countDocuments({ transactionId: row._id }), 0);
});
test("zero/negative profit, unknown settlement, mismatched evidence and missing costs cannot credit", async () => {
  for (const providerResponse of [
    { syntheticVerified: false },
    { syntheticCosts: { verified: false } },
    { syntheticCosts: { revenueKobo: undefined } },
    { syntheticCosts: { providerCostKobo: 11000 } },
    { syntheticCosts: { directCostsKobo: undefined } },
  ]) {
    const row = await tx({ providerResponse }); await admission(row); await successful(row);
    const before = await M.Account.find().sort({ _id: 1 }).lean();
    try { assert.equal((await engine.settle(row._id)).status, "NOT_ELIGIBLE"); }
    catch (error) { assert.match(error.code || "", /VERIFIED_COST|INVALID_DIRECT|INVALID_VERIFIED_REVENUE/); }
    assert.deepEqual(await M.Account.find().sort({ _id: 1 }).lean(), before);
  }
  const row = await tx(); await admission(row); await successful(row);
  const bad = instance({ adapters: { DATA: { ...adapter, inspect: async tx => ({
    ...await adapter.inspect(tx), reference: "wrong-reference" }) } } });
  await assert.rejects(bad.settle(row._id), { code: "UNBOUND_SETTLEMENT_EVIDENCE" });
});
test("old commission conflicts block the new ledger without changing legacy earnings", async () => {
  const row = await tx(); await admission(row); await successful(row);
  await Commission.collection.insertOne({ _id: new mongoose.Types.ObjectId(), transactionId: row._id,
    commissionAmount: 123, status: "AVAILABLE" });
  await assert.rejects(engine.settle(row._id), { code: "LEGACY_COMMISSION_CONFLICT" });
  assert.equal(await M.Event.countDocuments({ _id: `accrual:${row._id}` }), 0);
  assert.equal((await Commission.findOne({ transactionId: row._id }).lean()).commissionAmount, 123);
});
test("refund without canonical ledger proof never reverses commission", async () => {
  const row = await tx(); await admission(row); await successful(row); await engine.settle(row._id);
  await Tx.collection.updateOne({ _id: row._id }, { $set: { status: "REFUNDED" } });
  await assert.rejects(engine.reverse(row._id), { code: "CANONICAL_FULL_REFUND_REQUIRED" });
  assert.equal(await M.Event.countDocuments({ _id: `reversal:${row._id}` }), 0);
});
test("concurrent full refunds append one immutable reversal with matching original amounts", async () => {
  const row = await tx(); await admission(row); await successful(row); await engine.settle(row._id);
  const before = await M.Account.findById(`beneficiary:${people.aggregator}`).lean();
  await canonicalRefund(row);
  const results = await Promise.all(Array.from({ length: 6 }, () => engine.reverse(row._id)));
  assert.equal(results.filter(r => r.status === "REVERSED").length, 1);
  assert.equal((await M.Account.findById(`beneficiary:${people.aggregator}`).lean()).availableKobo, before.availableKobo - 252);
  assert.ok(await M.Event.exists({ _id: `accrual:${row._id}`, kind: "ACCRUAL" }));
  assert.ok(await M.Event.exists({ _id: `reversal:${row._id}`, kind: "REVERSAL" }));
  await assert.rejects(M.Event.updateOne({ _id: `accrual:${row._id}` }, { $set: { kind: "REVERSAL" } }), /append-only/);
  await assert.rejects(M.Admission.deleteOne({ _id: String(row._id) }), /append-only/);
});
test("audit failure rolls back every new ledger/account write", async () => {
  const row = await tx(); await admission(row); await successful(row);
  const before = await M.Account.find().sort({ _id: 1 }).lean();
  const broken = instance({ N: { ...N, Audit: { create: async () => { throw Error("synthetic audit failure"); } } } });
  await assert.rejects(broken.settle(row._id), /synthetic audit failure/);
  assert.deepEqual(await M.Account.find().sort({ _id: 1 }).lean(), before);
  assert.equal(await M.Event.countDocuments({ _id: `accrual:${row._id}` }), 0);
});
test("refund racing settlement cannot leave an unreversed earning", async () => {
  const row = await tx(); await admission(row); await successful(row);
  const results = await Promise.allSettled([engine.settle(row._id), canonicalRefund(row)]);
  assert.ok(results.every(r => r.status === "fulfilled"));
  const result = await engine.reverse(row._id);
  assert.ok(["REVERSED", "NO_ACCRUAL"].includes(result.status));
  const accrued = await M.Event.exists({ _id: `accrual:${row._id}` });
  if (accrued) assert.ok(await M.Event.exists({ _id: `reversal:${row._id}` }));
});
test("reversal records recovery debt instead of debiting a customer's main wallet", async () => {
  const row = await tx(); await admission(row); await successful(row); await engine.settle(row._id);
  const id = `beneficiary:${people.aggregator}`;
  const accountBefore = await M.Account.findById(id).lean();
  // TEST ONLY: emulate custody already reserved/paid by a future reviewed payout
  // component. No real payout endpoint is enabled by this implementation.
  await M.Account.updateOne({ _id: id }, { $set: { availableKobo: 0 } });
  await canonicalRefund(row); await engine.reverse(row._id);
  const debt = await M.Account.findById(id).lean();
  assert.equal(debt.availableKobo, 0); assert.equal(debt.recoveryDebtKobo, 252);
  const next = await tx(); await admission(next); await successful(next); await engine.settle(next._id);
  const recovered = await M.Account.findById(id).lean();
  assert.equal(recovered.recoveryDebtKobo, 0); assert.equal(recovered.availableKobo, 0);
  // Restore the synthetic pre-existing custody that was temporarily reserved.
  await M.Account.updateOne({ _id: id }, { $set: { availableKobo: accountBefore.availableKobo - 252 } });
});
test("a rule change immediately blocks readiness and cannot change an admitted rule", async () => {
  const row = await tx(); await admission(row);
  const changed = { ...dataRule, id: "synthetic-data-edited", createdAt: "2030-06-01T11:59:59Z" };
  await N.Settings.updateOne({ _id: "profit-sharing" }, { $push: { "profitSharing.services.DATA.versions": changed } });
  const current = await engine.status();
  assert.equal(current.distributionLive, false); assert.equal(current.mode, "BLOCKED");
  await assert.rejects(admission(await tx()), { code: "ACTIVATION_RULE_CHANGED" });
  await successful(row); await engine.settle(row._id);
  assert.equal((await M.Event.findById(`accrual:${row._id}`).lean()).data.plan.ruleId, dataRule.id);
  await N.Settings.updateOne({ _id: "profit-sharing" }, { $pull: { "profitSharing.services.DATA.versions": { id: changed.id } } });
});
test("incomplete allocations and legacy policy cannot pass readiness or alter saved rules", async () => {
  for (const patch of [{ percentages: { ...rates, HEAD_OFFICE: undefined } },
    { percentages: {} }, { policyVersion: 2 }, { poolPercentage: 50 }]) {
    const changed = { ...dataRule, ...patch, id: "review-required-rule" };
    await N.Settings.updateOne({ _id: "profit-sharing" }, { $set: {
      "profitSharing.services.DATA.versions": [changed] } });
    const before = await N.Settings.findById("profit-sharing").lean();
    const check = await engine.readiness(["DATA"]);
    assert.equal(check.ready, false);
    assert.ok(check.services[0].blockers.some(b => /POOL|POLICY|PERCENTAGE/.test(b)));
    await assert.rejects(admission(await tx()));
    assert.deepEqual(await N.Settings.findById("profit-sharing").lean(), before);
  }
  await N.Settings.updateOne({ _id: "profit-sharing" }, { $set: {
    "profitSharing.services.DATA.versions": [dataRule] } });
});
test("new admission schema rejects unsupported beneficiaries and legacy rules without rewriting them", async () => {
  const row = await tx();
  const fields = { _id: String(row._id), transaction: row._id, reference: row.reference,
    serviceType: row.serviceType, amountKobo: 10000, adapterVersion: adapter.version,
    admittedAt: clock(), activationId: "synthetic",
    beneficiaries: Object.fromEntries(Object.keys(rates).map(role => [role, null])) };
  await assert.rejects(new M.Admission({ ...fields, rule: { ...dataRule, policyVersion: 1 } }).validate(),
    /FOUR_BENEFICIARY_POLICY_V3_REQUIRED/);
  await assert.rejects(new M.Admission({ ...fields, rule: dataRule,
    beneficiaries: { ...fields.beneficiaries, BUSINESS_NETWORK_AGENT: { id: String(people.retail) } } }).validate(),
    /four configured/);
  await new M.Admission({ ...fields, rule: dataRule }).validate();
  assert.equal(await M.Admission.exists({ _id: fields._id }), null);
});
test("pause stops new admissions but preserves reversal and settlement of already admitted purchases", async () => {
  const row = await tx(); await admission(row);
  await engine.changeMode(actor, { mode: "PAUSED", revision: 1, confirmation: true, reason: "Synthetic stop new admissions" });
  assert.equal((await engine.status()).distributionLive, false);
  assert.equal(await admission(await tx()), null);
  await successful(row); assert.equal((await engine.settle(row._id)).status, "SETTLED");
  await canonicalRefund(row); assert.equal((await engine.reverse(row._id)).status, "REVERSED");
});
test("bounded background worker processes saved admissions only and isolates blocked accounting", async () => {
  const worker = createWorker({ engine });
  const result = await worker.runBatch();
  assert.equal(result.status, "PROCESSED"); assert.ok(result.outcomes.length <= 20);
  assert.ok(result.outcomes.some(r => r.status === "BLOCKED"));
  assert.ok(await M.Event.exists({ kind: "BLOCKED" }));
  const count = await M.Event.countDocuments({ kind: "BLOCKED" });
  const another = createWorker({ engine }); await another.runBatch();
  assert.equal(await M.Event.countDocuments({ kind: "BLOCKED" }), count, "Repeated failures do not duplicate audit events.");
});
test("all customer wallets, legacy commission counters, referral identity and network settings remain unchanged", async () => {
  assert.deepEqual(await User.collection.find().sort({ _id: 1 }).toArray(), usersBefore);
  const legacy = await N.Settings.findById("network").lean();
  assert.equal(legacy.revision, 9); assert.deepEqual(legacy.categories, ["Preserved"]);
});
test("old accrual entries and company custody remain intact and reversible by their original immutable entries", async () => {
  const row = await tx();
  const original = { _id: `accrual:${row._id}`, kind: "ACCRUAL", transaction: row._id,
    data: { plan: { poolKobo: 17 }, entries: [
      { accountId: "company", role: "COMPANY", amountKobo: 17 },
    ] } };
  await M.Event.collection.insertOne(original);
  await M.Account.create({ _id: "company", availableKobo: 17, earnedKobo: 17 });
  await canonicalRefund(row);
  const before = await M.Event.findById(original._id).lean();
  assert.equal((await engine.reverse(row._id)).status, "REVERSED");
  assert.deepEqual(await M.Event.findById(original._id).lean(), before);
  const old = await M.Account.findById("company").lean();
  assert.equal(old.availableKobo, 0); assert.equal(old.reversedKobo, 17);
});
