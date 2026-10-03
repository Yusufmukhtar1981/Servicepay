"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const axios = require("axios");
const models = require("../models/organizations.models");
const User = require("../models/user.model");
const Notification = require("../models/notification.model");
const service = require("../services/organizationManualWithdrawal.service");
const controller = require("../controllers/organizationManualWithdrawal.controller");
const treasury = require("../services/organizationTreasury.service");
let mongo, sequence = 0;
const bank = { accountName: "Test Organization", accountNumber: "1234567890", bankName: "Test Bank" };
const request = (user, org, body = {}, params = {}) => ({
  user, params: { organizationId: org._id.toString(), ...params }, body, query: {}, get: () => undefined,
});
const admin = { _id: new mongoose.Types.ObjectId(), role: "SUPER_ADMIN" };
async function fixture(balance = 1000) {
  const n = ++sequence;
  const owner = await User.create({ fullName: `Manual Owner ${n}`, phone: `080${String(n).padStart(8, "0")}`,
    password: "Password123!", transactionPin: "1234", transactionPinSet: true, role: "CUSTOMER", status: "ACTIVE", walletBalance: 77 });
  const org = await models.Organization.create({ name: `Manual Org ${n}`, slug: `manual-org-${n}`,
    code: `M${String(n).padStart(5, "0")}`, createdBy: owner._id, status: "VERIFIED" });
  await models.OrganizationRole.create({ organization: org._id, user: owner._id, role: "OWNER" });
  await models.OrganizationWallet.create({ organization: org._id, balance, heldBalance: 0 });
  return { owner, org };
}
async function create(f, amount = 100, key = `manual-key-${++sequence}`) {
  await service.saveBank(request(f.owner, f.org, bank));
  return service.create(request(f.owner, f.org, { amount, idempotencyKey: key, transactionPin: "1234" }));
}
async function state(f) {
  return models.OrganizationWallet.findOne({ organization: f.org._id }).lean();
}
async function action(f, row, target, user = admin) {
  const full = await models.OrganizationWithdrawal.findById(row._id).select("+destinationSnapshot.accountNumber");
  return service.transition(request(user, f.org, {
    confirmed: true, confirmation: { reference: full.reference, amount: full.amount, ...bank,
      ...Object.fromEntries(["accountName", "accountNumber", "bankName"].map((k) => [k, full.destinationSnapshot[k]])) },
    reason: "Test rejection",
  }, { id: row._id.toString() }), target);
}
async function call(handler, req) {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler(req, res); return res;
}
test.before(async () => {
  // Ambient Atlas URI is intentionally never used.
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(mongo.getUri(), { dbName: "manual-org-withdrawals-test" });
  await Promise.all([...Object.values(models), User, Notification].map((m) => m.init()));
});
test.beforeEach(async () => {
  await Promise.all([...Object.values(models), User, Notification].map((m) => m.deleteMany({})));
});
test.after(async () => { await mongoose.disconnect(); await mongo.stop(); });

test("one bank account saves, reloads and updates without bank code or provider API", async () => {
  const f = await fixture();
  assert.equal(await service.bank(request(f.owner, f.org)), null);
  const oldPost = axios.post; axios.post = () => { throw new Error("EXTERNAL_API_FORBIDDEN"); };
  try {
    assert.deepEqual(await service.saveBank(request(f.owner, f.org, bank)), bank);
    assert.deepEqual(await service.bank(request(f.owner, f.org)), bank);
    const changed = { ...bank, accountName: "Updated", accountNumber: "0123456789" };
    await service.saveBank(request(f.owner, f.org, changed));
    assert.deepEqual(await service.bank(request(f.owner, f.org)), changed);
    assert.equal(await models.OrganizationSettlementAccount.countDocuments(), 0);
    const generic = await models.Organization.findById(f.org._id).lean();
    assert.equal(generic.manualWithdrawalBank, undefined);
  } finally { axios.post = oldPost; }
});
test("missing or malformed bank account cannot create a withdrawal", async () => {
  const f = await fixture();
  for (const body of [{}, { ...bank, accountNumber: "123" }, { ...bank, bankName: "" }, { ...bank, accountNumber: 1234567890 }]) {
    await assert.rejects(service.saveBank(request(f.owner, f.org, body)));
  }
  await assert.rejects(service.create(request(f.owner, f.org, { amount: 10, idempotencyKey: "no-bank", transactionPin: "1234" })), /Add a withdrawal bank account/);
  assert.equal((await state(f)).heldBalance, 0);
});
test("amount validation rejects zero, negative, nonfinite, excess precision and balance spoofing", async () => {
  const f = await fixture(100);
  await service.saveBank(request(f.owner, f.org, bank));
  for (const amount of [0, -1, "NaN", Infinity, "0.001", {}, "", null, 1000000001]) {
    await assert.rejects(service.create(request(f.owner, f.org, { amount, idempotencyKey: `bad-${++sequence}`, transactionPin: "1234", balance: 999999 })));
  }
  await assert.rejects(service.create(request(f.owner, f.org, { amount: 101, idempotencyKey: "over", transactionPin: "1234", balance: 999999 })), /available balance/);
  assert.equal(await models.OrganizationWithdrawal.countDocuments(), 0);
});
test("PENDING request holds immediately, charges no fee and creates atomic audit plus notification", async () => {
  const f = await fixture(500);
  const oldPost = axios.post; axios.post = () => { throw new Error("EXTERNAL_API_FORBIDDEN"); };
  try {
    const r = await create(f, 120.25);
    assert.equal(r.withdrawal.status, "PENDING"); assert.ok(r.withdrawal.reference.startsWith("ORGMW-"));
    const w = await state(f); assert.equal(w.balance, 500); assert.equal(w.heldBalance, 120.25);
    assert.equal((await service.wallet(request(f.owner, f.org))).availableBalance, 379.75);
    const stored = await models.OrganizationWithdrawal.findById(r.withdrawal._id).select("+destinationSnapshot.accountNumber");
    assert.equal(stored.destinationSnapshot.accountNumber, bank.accountNumber);
    assert.equal(stored.fee, 0); assert.equal(stored.settlementAccount, undefined);
    assert.equal(await models.OrganizationLedger.countDocuments({ type: "HOLD" }), 1);
    assert.equal(await models.OrganizationWithdrawalSnapshot.countDocuments({ event: "MANUAL_PENDING" }), 1);
    const notification = await Notification.findOne({ userId: f.owner._id }).lean();
    assert.ok(notification.message.includes("awaiting processing"));
    assert.equal((await User.findById(f.owner._id)).walletBalance, 77);
  } finally { axios.post = oldPost; }
});
test("double-click and repeated same-key submissions create exactly one record and hold", async () => {
  const f = await fixture();
  await service.saveBank(request(f.owner, f.org, bank));
  const body = { amount: 100, transactionPin: "1234", idempotencyKey: "double-click" };
  const results = await Promise.all([service.create(request(f.owner, f.org, body)), service.create(request(f.owner, f.org, body))]);
  assert.equal(String(results[0].withdrawal._id), String(results[1].withdrawal._id));
  await service.create(request(f.owner, f.org, body));
  assert.equal(await models.OrganizationWithdrawal.countDocuments(), 1);
  assert.equal((await state(f)).heldBalance, 100);
  assert.equal(await models.OrganizationLedger.countDocuments({ type: "HOLD" }), 1);
  await assert.rejects(service.create(request(f.owner, f.org, { ...body, amount: 101 })), /different details/);
});
test("different concurrent withdrawals cannot reserve the same available money", async () => {
  const f = await fixture(100);
  await service.saveBank(request(f.owner, f.org, bank));
  const results = await Promise.allSettled([1, 2].map((i) =>
    service.create(request(f.owner, f.org, { amount: 80, transactionPin: "1234", idempotencyKey: `compete-${i}` }))));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await state(f)).heldBalance, 80);
  assert.equal(await models.OrganizationWithdrawal.countDocuments(), 1);
});
test("editing bank account preserves immutable full withdrawal destination", async () => {
  const f = await fixture(), r = await create(f);
  await service.saveBank(request(f.owner, f.org, { ...bank, accountNumber: "0123456789", bankName: "Other Bank" }));
  const stored = await models.OrganizationWithdrawal.findById(r.withdrawal._id).select("+destinationSnapshot.accountNumber");
  assert.equal(stored.destinationSnapshot.accountNumber, bank.accountNumber);
  const req = request(admin, f.org); const listed = await service.list(req, true);
  assert.equal(listed.withdrawals[0].destinationSnapshot.accountNumber, bank.accountNumber);
  assert.equal(listed.withdrawals[0].organization.name, f.org.name);
  assert.equal(listed.withdrawals[0].requestedBy.fullName, f.owner.fullName);
});
test("paid action requires exact explicit destination and amount confirmation", async () => {
  const f = await fixture(), r = await create(f);
  const req = request(admin, f.org, {}, { id: r.withdrawal._id.toString() });
  await assert.rejects(service.transition(req, "COMPLETED"), /Confirm the exact/);
  req.body = { confirmed: true, confirmation: { reference: r.withdrawal.reference, amount: 101, ...bank } };
  await assert.rejects(service.transition(req, "COMPLETED"), /Confirm the exact/);
  assert.equal((await state(f)).heldBalance, 100);
});
test("Mark as Paid finalizes the debit exactly once even on concurrent retries", async () => {
  const f = await fixture(500), r = await create(f, 100);
  await Promise.all([action(f, r.withdrawal, "COMPLETED"), action(f, r.withdrawal, "COMPLETED")]);
  await action(f, r.withdrawal, "COMPLETED");
  const w = await state(f); assert.equal(w.balance, 400); assert.equal(w.heldBalance, 0); assert.equal(w.totalWithdrawn, 100);
  assert.equal(await models.OrganizationLedger.countDocuments({ type: "DEBIT" }), 1);
  assert.equal(await models.OrganizationWithdrawalSnapshot.countDocuments({ toStatus: "COMPLETED" }), 1);
  await assert.rejects(action(f, r.withdrawal, "REJECTED"), /already been resolved/);
  assert.ok((await Notification.findOne({ dedupeKey: `manual-org-withdrawal:${r.withdrawal._id}:COMPLETED` })).message.includes("completed successfully"));
});
test("Reject releases the hold once, preserves total balance and cannot later become paid", async () => {
  const f = await fixture(500), r = await create(f, 100);
  await Promise.all([action(f, r.withdrawal, "REJECTED"), action(f, r.withdrawal, "REJECTED")]);
  const w = await state(f); assert.equal(w.balance, 500); assert.equal(w.heldBalance, 0); assert.equal(w.totalWithdrawn, 0);
  assert.equal(await models.OrganizationLedger.countDocuments({ type: "RELEASE" }), 1);
  assert.equal((await service.wallet(request(f.owner, f.org))).availableBalance, 500);
  await assert.rejects(action(f, r.withdrawal, "COMPLETED"), /already been resolved/);
});
test("competing Paid/Reject decisions resolve once without double accounting", async () => {
  const f = await fixture(500), r = await create(f, 100);
  const results = await Promise.allSettled([action(f, r.withdrawal, "COMPLETED"), action(f, r.withdrawal, "REJECTED")]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const w = await state(f); assert.equal(w.heldBalance, 0); assert.ok([400, 500].includes(w.balance));
  assert.equal(await models.OrganizationLedger.countDocuments({ type: { $in: ["DEBIT", "RELEASE"] } }), 1);
});
test("owner history masks bank numbers and hides provider/internal fields", async () => {
  const f = await fixture(), r = await create(f);
  const result = await service.list(request(f.owner, f.org));
  const row = result.withdrawals[0]; assert.equal(row.reference, r.withdrawal.reference);
  assert.equal(row.destinationSnapshot.maskedAccountNumber, "******7890");
  for (const key of ["provider", "providerReference", "snapshot", "idempotencyKey", "manualPaymentConfirmation"]) assert.equal(row[key], undefined);
  assert.equal(row.destinationSnapshot.accountNumber, undefined);
});
test("Organization A cannot access Organization B bank, wallet or history, and treasurers are denied", async () => {
  const a = await fixture(), b = await fixture();
  for (const fn of [service.bank, service.wallet, service.list]) {
    await assert.rejects(fn(request(a.owner, b.org)), /authenticated owner/);
  }
  await assert.rejects(service.saveBank(request(a.owner, b.org, bank)), /authenticated owner/);
  await models.OrganizationRole.create({ organization: b.org._id, user: a.owner._id, role: "TREASURER" });
  await assert.rejects(service.bank(request(a.owner, b.org)), /authenticated owner/);
  await assert.rejects(service.create(request(a.owner, b.org, { amount: 1, transactionPin: "1234", idempotencyKey: "spoof" })), /authenticated owner/);
});
test("owners, hierarchy managers and unprivileged staff cannot settle withdrawals", async () => {
  const f = await fixture(), r = await create(f);
  for (const user of [f.owner, { _id: admin._id, role: "AGENT" }, { _id: admin._id, role: "STATE_MANAGER" }, { _id: admin._id, role: "STAFF" }]) {
    await assert.rejects(action(f, r.withdrawal, "COMPLETED", user), /Authorized ServicePay Admin/);
  }
  const response = await call(controller.adminList, request(f.owner, f.org));
  assert.equal(response.statusCode, 403);
});
test("wrong existing transaction PIN and frozen wallet prevent any hold", async () => {
  const f = await fixture(); await service.saveBank(request(f.owner, f.org, bank));
  await assert.rejects(service.create(request(f.owner, f.org, { amount: 100, transactionPin: "4321", idempotencyKey: "wrong-pin" })));
  await models.OrganizationWallet.updateOne({ organization: f.org._id }, { $set: { status: "FROZEN" } });
  await assert.rejects(service.create(request(f.owner, f.org, { amount: 100, transactionPin: "1234", idempotencyKey: "frozen" })));
  assert.equal((await state(f)).heldBalance, 0);
});
test("decimal holds/debits round safely and exact available balance remains withdrawable", async () => {
  const f = await fixture(0.3);
  const first = await create(f, 0.1);
  const second = await service.create(request(f.owner, f.org, { amount: 0.2, transactionPin: "1234", idempotencyKey: "last-pennies" }));
  assert.equal((await state(f)).heldBalance, 0.3);
  await action(f, first.withdrawal, "COMPLETED"); await action(f, second.withdrawal, "COMPLETED");
  const w = await state(f); assert.equal(w.balance, 0); assert.equal(w.heldBalance, 0); assert.equal(w.totalWithdrawn, 0.3);
});
test("legacy provider recovery paths refuse manual records and never dispatch them", async () => {
  const f = await fixture(), r = await create(f);
  const w = await models.OrganizationWithdrawal.findById(r.withdrawal._id);
  for (const run of [() => treasury.dispatch(w._id), () => treasury.requery(w._id), () => treasury.finalize(w, "SUCCESS"),
    () => treasury.transition(request(admin, f.org), w._id, "REJECTED", true)]) {
    await assert.rejects(run, /Manual withdrawals/);
  }
  assert.equal((await state(f)).heldBalance, 100);
});
test("wallet mismatch aborts paid status, audit, notification and debit together", async () => {
  const f = await fixture(), r = await create(f);
  await models.OrganizationWallet.updateOne({ organization: f.org._id }, { $set: { heldBalance: 0 } });
  await assert.rejects(action(f, r.withdrawal, "COMPLETED"), /hold mismatch/);
  assert.equal((await models.OrganizationWithdrawal.findById(r.withdrawal._id)).status, "PENDING");
  assert.equal(await models.OrganizationLedger.countDocuments({ type: "DEBIT" }), 0);
  assert.equal(await models.OrganizationWithdrawalSnapshot.countDocuments({ toStatus: "COMPLETED" }), 0);
});