const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const User = require("../models/user.model");
const School = require("../models/edupaySchool.model");
const { EduPayAcademicSession, EduPayTerm, EduPayClass } = require("../models/edupayAcademic.model");
const Fee = require("../models/edupayFeeStructure.model");
const Child = require("../models/edupayChild.model");
const Plan = require("../models/edupayPlan.model");
const Settings = require("../models/edupaySettings.model");
const EduLedger = require("../models/edupayLedgerEntry.model");
const { contributeFromWallet, calculateSettlement, availableSavings } = require("../services/edupay.service");

let replica;
let parent;
let plan;
const models = [User, School, EduPayAcademicSession, EduPayTerm, EduPayClass, Fee, Child, Plan, Settings, EduLedger];

test.before(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(replica.getUri(), { dbName: "edupay-tests" });
  await Promise.all(models.map((model) => model.init()));
});
test.after(async () => {
  await mongoose.disconnect();
  await replica.stop();
});
test.beforeEach(async () => {
  await Promise.all(models.map((model) => model.collection.deleteMany({})));
  parent = new User({ fullName: "EduPay Parent", phone: `080${Date.now()}`, email: `edupay-${Date.now()}@test.invalid`, password: "Password123!", role: "CUSTOMER", status: "ACTIVE", walletBalance: 150000 });
  parent.setTransactionPin("1234");
  await parent.save();
  const school = await School.create({ name: "Approved School", address: "A", state: "Kano", status: "APPROVED", active: true });
  const session = await EduPayAcademicSession.create({ school: school._id, name: "2026/2027", status: "ACTIVE" });
  const term = await EduPayTerm.create({ school: school._id, session: session._id, name: "First", status: "ACTIVE" });
  const classLevel = await EduPayClass.create({ school: school._id, name: "JSS1" });
  const fee = await Fee.create({ school: school._id, session: session._id, term: term._id, classLevel: classLevel._id, amount: 200000, submittedBy: parent._id, status: "APPROVED" });
  const child = await Child.create({ parent: parent._id, createdBy: parent._id, fullName: "Child", school: school._id });
  plan = await Plan.create({ parent: parent._id, child: child._id, school: school._id, session: session._id, term: term._id, classLevel: classLevel._id, feeStructure: fee._id, officialFee: 200000, targetDate: new Date(Date.now() + 86400000 * 30) });
  await Settings.create({ key: "GLOBAL", schoolCommissionRate: 5, parentShortfallChargeRate: 10 });
});

test("calculates the approved settlement snapshot exactly", async () => {
  const settings = await Settings.findOne();
  const snapshot = calculateSettlement({ officialFee: 200000, saved: 120000, settings });
  assert.deepEqual({
    servicepayFundedPrincipal: snapshot.servicepayFundedPrincipal,
    schoolCommissionAmount: snapshot.schoolCommissionAmount,
    parentChargeAmount: snapshot.parentChargeAmount,
    parentTotalRepayment: snapshot.parentTotalRepayment,
  }, { servicepayFundedPrincipal: 80000, schoolCommissionAmount: 10000, parentChargeAmount: 8000, parentTotalRepayment: 88000 });
});

test("debits wallet, records immutable EduPay ledger, and is idempotent", async () => {
  const first = await contributeFromWallet({ userId: parent._id, planId: plan._id, amount: 120000, transactionPin: "1234", idempotencyKey: "edupay-contribution-1" });
  const second = await contributeFromWallet({ userId: parent._id, planId: plan._id, amount: 120000, transactionPin: "1234", idempotencyKey: "edupay-contribution-1" });
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(await availableSavings(plan._id), 120000);
  assert.equal((await User.findById(parent._id)).walletBalance, 30000);
  assert.equal(await EduLedger.countDocuments({ plan: plan._id }), 1);
  await assert.rejects(() => EduLedger.updateOne({ plan: plan._id }, { $set: { amount: 1 } }), /Immutable EduPay record/);
});

test("concurrent contributions cannot overspend the wallet", async () => {
  const results = await Promise.allSettled([
    contributeFromWallet({ userId: parent._id, planId: plan._id, amount: 100000, transactionPin: "1234", idempotencyKey: "concurrent-1" }),
    contributeFromWallet({ userId: parent._id, planId: plan._id, amount: 100000, transactionPin: "1234", idempotencyKey: "concurrent-2" }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(await availableSavings(plan._id), 100000);
  assert.equal((await User.findById(parent._id)).walletBalance, 50000);
});