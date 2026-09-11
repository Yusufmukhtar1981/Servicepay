const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const axios = require("axios");
const models = require("../models/organizations.models");
const User = require("../models/user.model");
const treasury = require("../services/organizationTreasury.service");
const migration = require("../services/organizationTreasuryMigration.service");
const organizationController = require("../controllers/organizations.controller");

let mongo; let seq = 0;
const all = [...Object.values(models), User];
const uid = () => new mongoose.Types.ObjectId();
const req = (user, body = {}, key = `key-${++seq}`) => ({ user, body, get: (h) => h.toLowerCase().includes("idempotency") ? key : undefined });
async function fixture({ balance = 1000, mode = "OWNER_ONLY" } = {}) {
  const owner = await User.create({ fullName: `Treasury owner ${++seq}`, phone: `080${String(seq).padStart(8, "0")}`, password: "password", transactionPin: "1234", transactionPinSet: true, status: "ACTIVE" });
  const org = await models.Organization.create({ name: `Treasury ${seq}`, slug: `treasury-${seq}`, code: `T${String(seq).padStart(5, "0")}`, createdBy: owner._id, status: "VERIFIED" });
  await models.OrganizationRole.create({ organization: org._id, user: owner._id, role: "OWNER" });
  await models.OrganizationWallet.create({ organization: org._id, balance, heldBalance: 0 });
  await models.OrganizationTreasuryConfig.create({ organization: org._id, authorizationMode: mode, minimumWithdrawal: 1, maximumWithdrawal: 100000, dailyLimit: 100000, monthlyLimit: 1000000 });
  const account = await models.OrganizationSettlementAccount.create({ organization: org._id, bankCode: "000001", bankName: "Bank", accountNumber: "1234567890", accountNumberLast4: "7890", accountName: "Resolved", status: "VERIFIED", coolingOffUntil: new Date(Date.now() - 1000) });
  return { owner, org, account };
}
const withdrawalBody = (account, amount = 100) => ({ amount, settlementAccountId: account._id, transactionPin: "1234", narration: "Treasury test" });

test.before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(mongo.getUri(), { dbName: "organization-treasury-behavior" });
  await Promise.all(all.map((m) => m.init()));
});
test.after(async () => { await mongoose.disconnect(); await mongo.stop(); });
test.beforeEach(async () => { await Promise.all(all.map((m) => m.deleteMany({}))); });

test("migration backfills only absent wallet fields and installs partial legacy-safe indexes", async () => {
  const owner = await User.create({ fullName: "Legacy", phone: "08000000001", password: "password", status: "ACTIVE" });
  const collection = models.OrganizationWithdrawal.collection;
  for (const index of await collection.indexes()) {
    if (JSON.stringify(index.key) === JSON.stringify({ organization: 1, idempotencyKey: 1 }) || JSON.stringify(index.key) === JSON.stringify({ organization: 1, reference: 1 })) await collection.dropIndex(index.name);
  }
  await collection.createIndex({ organization: 1, idempotencyKey: 1 }, { name: "legacy_org_idem", unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" }, status: "SUCCESS" } });
  await collection.createIndex({ organization: 1, reference: 1 }, { name: "legacy_org_ref" });
  await collection.createIndex({ "snapshot.marker": 1 }, { name: "sentinel_treasury_test" });
  await collection.insertMany([{ organization: uid() }, { organization: uid() }]);
  await models.OrganizationWallet.collection.insertOne({ organization: uid(), balance: 50, totalMoneyIn: 99 });
  await migration.backfill();
  const wallet = await models.OrganizationWallet.findOne();
  assert.equal(wallet.totalMoneyIn, 99); assert.equal(wallet.heldBalance, 0); assert.equal(wallet.totalWithdrawn, 0);
  const indexes = await collection.indexes();
  for (const [field, name] of [["idempotencyKey", "organization_1_idempotencyKey_1"], ["reference", "organization_1_reference_1"]]) {
    const index = indexes.find((item) => item.name === name); assert.equal(index.unique, true); assert.deepEqual(index.partialFilterExpression, { [field]: { $type: "string" } });
  }
  assert.ok(indexes.some((item) => item.name === "sentinel_treasury_test"));
  void owner;
});

test("legacy absent heldBalance remains withdrawable and duplicate idempotency creates one hold", async () => {
  const f = await fixture({ balance: 300 });
  await models.OrganizationWallet.updateOne({ organization: f.org._id }, { $unset: { heldBalance: 1 } });
  await migration.backfill();
  const a = await treasury.createWithdrawal(req(f.owner, withdrawalBody(f.account, 100), "same"), f.org);
  const b = await treasury.createWithdrawal(req(f.owner, withdrawalBody(f.account, 100), "same"), f.org);
  assert.equal(a.duplicate, false); assert.equal(b.duplicate, true);
  const wallet = await models.OrganizationWallet.findOne({ organization: f.org._id }); assert.equal(wallet.heldBalance, 100);
  assert.equal(await models.OrganizationWithdrawal.countDocuments({ organization: f.org._id }), 1);
});

test("owner and treasurer approvals are distinct; requester cannot self-approve", async () => {
  const f = await fixture({ mode: "OWNER_AND_TREASURER" });
  const treasurer = await User.create({ fullName: "Treasurer", phone: `080${String(++seq).padStart(8, "0")}`, password: "password", transactionPin: "1234", transactionPinSet: true, status: "ACTIVE" });
  await models.OrganizationRole.create({ organization: f.org._id, user: treasurer._id, role: "TREASURER" });
  const created = await treasury.createWithdrawal(req(f.owner, withdrawalBody(f.account)), f.org);
  assert.equal(created.withdrawal.approvals[0].role, "OWNER");
  await assert.rejects(() => treasury.transition(req(f.owner), created.withdrawal._id, "APPROVED"), /already acted|requester|authorization/i);
  const completed = await treasury.transition(req(treasurer), created.withdrawal._id, "APPROVED");
  assert.equal(completed.status, "APPROVED");
  const treasurerInitiated = await treasury.createWithdrawal(req(treasurer, withdrawalBody(f.account, 10), "treasurer-init"), f.org);
  assert.equal(treasurerInitiated.withdrawal.approvals[0].role, "TREASURER");
});

test("two authorized officers require two distinct eligible non-requester approvals", async () => {
  const f = await fixture({ mode: "TWO_AUTHORIZED_OFFICERS" });
  const second = await User.create({ fullName: "Officer 2", phone: `080${String(++seq).padStart(8, "0")}`, password: "password", transactionPin: "1234", transactionPinSet: true, status: "ACTIVE" });
  const third = await User.create({ fullName: "Officer 3", phone: `080${String(++seq).padStart(8, "0")}`, password: "password", transactionPin: "1234", transactionPinSet: true, status: "ACTIVE" });
  await models.OrganizationRole.create([{ organization: f.org._id, user: second._id, role: "TREASURER" }, { organization: f.org._id, user: third._id, role: "ADMIN" }]);
  const created = await treasury.createWithdrawal(req(f.owner, withdrawalBody(f.account)), f.org);
  await assert.rejects(() => treasury.transition(req(f.owner), created.withdrawal._id, "APPROVED"));
  const pending = await treasury.transition(req(second), created.withdrawal._id, "APPROVED"); assert.equal(pending.status, "PENDING_APPROVAL");
  const complete = await treasury.transition(req(third), created.withdrawal._id, "APPROVED"); assert.equal(complete.status, "APPROVED");
});

test("settlement account serializer never exposes full account number", () => {
  const safe = organizationController.safeSettlementAccount({ toObject: () => ({ accountNumber: "1234567890", accountNumberLast4: "7890", accountName: "Resolved" }) });
  assert.equal(safe.accountNumber, undefined); assert.equal(safe.accountNumberLast4, "7890");
});

const containsAccountNumber = (value) => {
  if (!value || typeof value !== "object") return false;
  if (Object.prototype.hasOwnProperty.call(value, "accountNumber")) return true;
  return Object.values(value).some(containsAccountNumber);
};
const responseRecorder = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.value = value; return this; } });

test("resolve, create, and configuration-disabled controller responses are redacted", async () => {
  const f = await fixture();
  const originalResolve = treasury.resolveAccount;
  treasury.resolveAccount = async () => ({ accountName: "Provider Name", accountNumber: "1234567890" });
  const resolvedRes = responseRecorder();
  await organizationController.resolveSettlementAccount({ body: { bankCode: "000001", accountNumber: "1234567890" } }, resolvedRes);
  assert.equal(containsAccountNumber(resolvedRes.value), false);
  treasury.resolveAccount = originalResolve;
  const createRes = responseRecorder();
  const createRequest = { params: { organizationId: f.org._id.toString() }, user: f.owner, body: withdrawalBody(f.account, 10), get: () => "controller-redaction" };
  await organizationController.withdraw(createRequest, createRes);
  assert.equal(containsAccountNumber(createRes.value), false);
});

test("treasury configuration validates ordered limits", async () => {
  const f = await fixture();
  const call = async (body) => {
    const res = responseRecorder();
    await organizationController.adminTreasuryConfig({ method: "PATCH", params: { id: f.org._id.toString() }, user: { _id: f.owner._id, role: "SUPER_ADMIN" }, body }, res);
    return res;
  };
  assert.equal((await call({ minimumWithdrawal: 20, maximumWithdrawal: 10 })).statusCode, 400);
  assert.equal((await call({ maximumWithdrawal: 200, dailyLimit: 100 })).statusCode, 400);
  assert.equal((await call({ dailyLimit: 200, monthlyLimit: 100 })).statusCode, 400);
  assert.equal((await call({ minimumWithdrawal: 10, maximumWithdrawal: 50, dailyLimit: 100, monthlyLimit: 200 })).statusCode, 200);
});

test("simultaneous holds cannot exceed balance or daily limit", async () => {
  const f = await fixture({ balance: 100, mode: "OWNER_ONLY" });
  await models.OrganizationTreasuryConfig.updateOne({ organization: f.org._id }, { $set: { dailyLimit: 100, monthlyLimit: 100 } });
  const results = await Promise.allSettled([1, 2, 3].map((n) => treasury.createWithdrawal(req(f.owner, withdrawalBody(f.account, 60), `parallel-${n}`), f.org)));
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
  const wallet = await models.OrganizationWallet.findOne({ organization: f.org._id }); assert.equal(wallet.heldBalance, 60);
});

test("rejection releases once; success finalizes once; late success is review-only; reversal credits once", async () => {
  const f = await fixture();
  const created = await treasury.createWithdrawal(req(f.owner, withdrawalBody(f.account)), f.org);
  const rejected = await treasury.transition(req(f.owner), created.withdrawal._id, "REJECTED");
  assert.equal(rejected.status, "REJECTED");
  const walletAfterReject = await models.OrganizationWallet.findOne({ organization: f.org._id }); assert.equal(walletAfterReject.heldBalance, 0);
  const late = await treasury.finalize(rejected, "SUCCESS"); assert.equal(late.status, "SUCCESS");
  const second = await treasury.finalize(rejected, "SUCCESS"); assert.equal(second.status, "SUCCESS");
  const f2 = await fixture({ balance: 500 }); const w = await treasury.createWithdrawal(req(f2.owner, withdrawalBody(f2.account)), f2.org);
  const success = await treasury.finalize(w.withdrawal, "SUCCESS"); assert.equal(success.status, "SUCCESS");
  await treasury.finalize(w.withdrawal, "SUCCESS");
  await treasury.reverseSuccessful(w.withdrawal._id); await treasury.reverseSuccessful(w.withdrawal._id);
  const wallet = await models.OrganizationWallet.findOne({ organization: f2.org._id }); assert.equal(wallet.balance, 500); assert.equal(wallet.totalWithdrawn, 0);
});

test("provider conflicts remain processing and disabled dispatch never calls HTTP", async () => {
  const f = await fixture(); const created = await treasury.createWithdrawal(req(f.owner, withdrawalBody(f.account)), f.org);
  const original = axios.post; let calls = 0; axios.post = async () => { calls++; return { status: 409, data: { message: "duplicate" } }; };
  process.env.ORG_SQUAD_TRANSFER_ENABLED = "true"; process.env.SQUAD_TRANSFER_ENABLED = "true"; process.env.SQUAD_SECRET_KEY = "secret"; process.env.SQUAD_MERCHANT_ID = "merchant"; process.env.SQUAD_BASE_URL = "https://api.squadco.com";
  const result = await treasury.dispatch(created.withdrawal._id); assert.equal(result.withdrawal.status, "PROCESSING"); assert.equal(calls, 1);
  process.env.ORG_SQUAD_TRANSFER_ENABLED = "false"; const disabled = await treasury.dispatch(created.withdrawal._id); assert.equal(disabled.configurationRequired, true); assert.equal(calls, 1);
  axios.post = original;
});