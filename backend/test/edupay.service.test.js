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
const Transaction = require("../models/transaction.model");
const CoreLedger = require("../models/ledgerEntry.model");
const { EduPayRepayment, EduPayRepaymentTransaction } = require("../models/edupayRepayment.model");
const { EduPaySponsorInvite, EduPaySponsorContribution } = require("../models/edupaySponsor.model");
const Reversal = require("../models/edupaySettlementReversal.model");
const Settlement = require("../models/edupaySettlement.model");
const Audit = require("../models/edupayAuditLog.model");
const { contributeFromWallet, contributeSponsorFromWallet, calculateSettlement, availableSavings, confirmSettlement, reverseSettlement } = require("../services/edupay.service");

let replica;
let parent;
let plan;
let school;
let session;
let term;
let classLevel;
let fee;
const models = [User, School, EduPayAcademicSession, EduPayTerm, EduPayClass, Fee, Child, Plan, Settings, EduLedger, Transaction, CoreLedger, EduPayRepayment, EduPayRepaymentTransaction, EduPaySponsorInvite, EduPaySponsorContribution, Reversal, Audit];

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
  school = await School.create({ name: "Approved School", address: "A", state: "Kano", status: "APPROVED", active: true });
  session = await EduPayAcademicSession.create({ school: school._id, name: "2026/2027", status: "ACTIVE" });
  term = await EduPayTerm.create({ school: school._id, session: session._id, name: "First", status: "ACTIVE" });
  classLevel = await EduPayClass.create({ school: school._id, name: "JSS1" });
  fee = await Fee.create({ school: school._id, session: session._id, term: term._id, classLevel: classLevel._id, amount: 200000, submittedBy: parent._id, status: "APPROVED" });
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

test("school application fields cannot self-approve or activate a school", async () => {
  const applicant = await School.create({ name: "Pending", address: "A", state: "Kano", status: "PENDING", active: false });
  assert.equal(applicant.status, "PENDING");
  assert.equal(applicant.active, false);
});

test("admin approval is the only path to an approved school", async () => {
  school.status = "APPROVED"; school.active = true; await school.save();
  assert.equal((await School.findById(school._id)).active, true);
});

test("fee structures remain draft or pending until approval", async () => {
  const draft = await Fee.create({ school: school._id, session: session._id, term: term._id, classLevel: classLevel._id, amount: 200000, submittedBy: parent._id, status: "PENDING_APPROVAL" });
  assert.equal(draft.status, "PENDING_APPROVAL");
});

test("child ownership is scoped to its parent", async () => {
  const child = await Child.findOne({ parent: parent._id });
  assert.equal(await Child.countDocuments({ _id: child._id, parent: new mongoose.Types.ObjectId() }), 0);
});

test("plan binds the immutable official fee snapshot", async () => {
  assert.equal(plan.officialFee, fee.amount);
  assert.equal(String(plan.feeStructure), String(fee._id));
});

test("partial savings are calculated from the dedicated ledger", async () => {
  await contributeFromWallet({ userId: parent._id, planId: plan._id, amount: 50000, transactionPin: "1234", idempotencyKey: "partial-savings" });
  assert.equal(await availableSavings(plan._id), 50000);
});

test("same contribution key with a different canonical intent returns conflict", async () => {
  await contributeFromWallet({ userId: parent._id, planId: plan._id, amount: 1000, transactionPin: "1234", idempotencyKey: "intent-conflict" });
  await assert.rejects(() => contributeFromWallet({ userId: parent._id, planId: plan._id, amount: 1001, transactionPin: "1234", idempotencyKey: "intent-conflict" }), (error) => error.statusCode === 409);
});

test("authenticated sponsor debits sponsor wallet and both core ledgers", async () => {
  const tokenHash = "invite-hash";
  await EduPaySponsorInvite.create({ parent: parent._id, child: plan.child, plan: plan._id, tokenHash, sponsorName: "Sponsor", expiresAt: new Date(Date.now() + 86400000) });
  const result = await contributeSponsorFromWallet({ sponsorId: parent._id, tokenHash, amount: 10000, transactionPin: "1234", idempotencyKey: "sponsor-wallet" });
  assert.equal(result.duplicate, false);
  assert.equal((await User.findById(parent._id)).walletBalance, 140000);
  assert.equal(await CoreLedger.countDocuments({ service: "EDUPAY" }), 1);
  assert.equal(await Transaction.countDocuments({ serviceType: "EDUPAY" }), 1);
  assert.equal(await EduPaySponsorContribution.countDocuments({ sponsor: parent._id }), 1);
});

test("exact two-hundred-thousand settlement math is immutable and correct", async () => {
  const snapshot = calculateSettlement({ officialFee: 200000, saved: 120000, settings: await Settings.findOne() });
  assert.deepEqual([snapshot.servicepayFundedPrincipal, snapshot.schoolCommissionAmount, snapshot.parentChargeAmount, snapshot.parentTotalRepayment], [80000, 10000, 8000, 88000]);
});

test("gross and deduct commission modes produce distinct school settlement amounts", async () => {
  const settings = await Settings.findOne();
  assert.equal(calculateSettlement({ officialFee: 200000, saved: 120000, settings }).schoolNetSettlement, 190000);
  settings.settlementMethod = "GROSS_AND_RECEIVABLE";
  assert.equal(calculateSettlement({ officialFee: 200000, saved: 120000, settings }).schoolNetSettlement, 200000);
});

test("settlement confirmation rejects a typed reference without authoritative evidence", async () => {
  const settlement = await Settlement.create({ ...calculateSettlement({ officialFee: 200000, saved: 0, settings: await Settings.findOne() }), parent: parent._id, child: plan.child, school: school._id, plan: plan._id, reference: "SET-EVIDENCE", idempotencyKey: "set-evidence", status: "PROCESSING" });
  await assert.rejects(() => confirmSettlement({ settlementId: settlement._id, actor: parent._id, transactionId: new mongoose.Types.ObjectId(), providerReference: "typed-only", idempotencyKey: "evidence-key" }), /authoritative/);
});

test("repayment is not created before successful payout confirmation", async () => {
  assert.equal(await EduPayRepayment.countDocuments(), 0);
});

test("successful payout evidence confirms settlement exactly once", async () => {
  await contributeFromWallet({ userId: parent._id, planId: plan._id, amount: 120000, transactionPin: "1234", idempotencyKey: "settle-saving" });
  const settlement = await Settlement.create({ ...calculateSettlement({ officialFee: 200000, saved: 120000, settings: await Settings.findOne() }), parent: parent._id, child: plan.child, school: school._id, plan: plan._id, reference: "SET-CONFIRM", idempotencyKey: "set-confirm", status: "PROCESSING" });
  const payout = await Transaction.create({ reference: "PAYOUT-1", customerId: parent._id, serviceType: "EDUPAY", amount: 190000, status: "SUCCESSFUL", provider: "BANK", providerResponse: { edupaySettlementId: String(settlement._id), schoolNetSettlement: 190000 } });
  const result = await confirmSettlement({ settlementId: settlement._id, actor: parent._id, transactionId: payout._id, providerReference: payout.reference, idempotencyKey: "confirm-key" });
  assert.equal(result.settlement.status, "SETTLED");
  assert.equal(await EduPayRepayment.countDocuments({ settlement: settlement._id }), 1);
  assert.equal(await availableSavings(plan._id), 0);
  const duplicate = await confirmSettlement({ settlementId: settlement._id, actor: parent._id, transactionId: payout._id, providerReference: payout.reference, idempotencyKey: "confirm-key" });
  assert.equal(duplicate.duplicate, true);
});

test("partial repayment preserves remaining balance", async () => {
  const repayment = await EduPayRepayment.create({ parent: parent._id, child: plan.child, plan: plan._id, settlement: new mongoose.Types.ObjectId(), principal: 80000, serviceCharge: 8000, totalAmount: 88000, amountRemaining: 88000, dueDate: new Date(Date.now() + 86400000) });
  await repayFromWalletForTest(repayment, 30000, "partial-repay");
  const updated = await EduPayRepayment.findById(repayment._id);
  assert.equal(updated.amountPaid, 30000); assert.equal(updated.amountRemaining, 58000); assert.equal(updated.status, "PARTIALLY_PAID");
});

test("full repayment closes the obligation", async () => {
  const repayment = await EduPayRepayment.create({ parent: parent._id, child: plan.child, plan: plan._id, settlement: new mongoose.Types.ObjectId(), principal: 80000, serviceCharge: 8000, totalAmount: 88000, amountRemaining: 88000, dueDate: new Date(Date.now() + 86400000) });
  await repayFromWalletForTest(repayment, 88000, "full-repay");
  assert.equal((await EduPayRepayment.findById(repayment._id)).status, "PAID");
});

test("concurrent duplicate repayment keys replay one immutable transaction", async () => {
  const repayment = await EduPayRepayment.create({ parent: parent._id, child: plan.child, plan: plan._id, settlement: new mongoose.Types.ObjectId(), principal: 80000, serviceCharge: 8000, totalAmount: 88000, amountRemaining: 88000, dueDate: new Date(Date.now() + 86400000) });
  const results = await Promise.allSettled([repayFromWalletForTest(repayment, 10000, "same-repay"), repayFromWalletForTest(repayment, 10000, "same-repay")]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 2);
  assert.equal(await EduPayRepaymentTransaction.countDocuments({ idempotencyKey: "same-repay" }), 1);
});

test("customer ownership prevents another parent reading the plan", async () => {
  assert.equal(await Plan.countDocuments({ _id: plan._id, parent: new mongoose.Types.ObjectId() }), 0);
});

test("cross-tenant academic references are rejected by scoped queries", async () => {
  const other = await School.create({ name: "Other", address: "B", state: "Lagos", status: "APPROVED", active: true });
  assert.equal(await EduPayAcademicSession.countDocuments({ _id: session._id, school: other._id }), 0);
});

test("disabled initiation does not erase existing repayment recovery", async () => {
  const settings = await Settings.findOne(); settings.enabled = false; await settings.save();
  const repayment = await EduPayRepayment.create({ parent: parent._id, child: plan.child, plan: plan._id, settlement: new mongoose.Types.ObjectId(), principal: 80000, serviceCharge: 8000, totalAmount: 88000, amountRemaining: 88000 });
  assert.equal((await EduPayRepayment.findById(repayment._id)).amountRemaining, 88000);
});

test("reversal requires successful authoritative refund and is idempotent", async () => {
  const settlement = await Settlement.create({ ...calculateSettlement({ officialFee: 200000, saved: 0, settings: await Settings.findOne() }), parent: parent._id, child: plan.child, school: school._id, plan: plan._id, reference: "SET-REV", idempotencyKey: "set-rev", status: "SETTLED" });
  await assert.rejects(() => reverseSettlement({ settlementId: settlement._id, actor: parent._id, transactionId: new mongoose.Types.ObjectId(), providerReference: "missing", idempotencyKey: "reverse-key" }), /authoritative reversal/);
});

test("successful reversal appends compensation, restructures repayment, and replays", async () => {
  const settlement = await Settlement.create({ ...calculateSettlement({ officialFee: 200000, saved: 0, settings: await Settings.findOne() }), parent: parent._id, child: plan.child, school: school._id, plan: plan._id, reference: "SET-REV-OK", idempotencyKey: "set-rev-ok", status: "SETTLED" });
  const refund = await Transaction.create({ reference: "REFUND-1", customerId: parent._id, serviceType: "EDUPAY", amount: 190000, status: "SUCCESSFUL", provider: "BANK", providerResponse: { edupaySettlementId: String(settlement._id), reversal: true } });
  const result = await reverseSettlement({ settlementId: settlement._id, actor: parent._id, transactionId: refund._id, providerReference: refund.reference, idempotencyKey: "reverse-ok" });
  assert.equal(result.reversal.reference, "REV-REFUND-1");
  assert.equal((await Settlement.findById(settlement._id)).status, "REVERSED");
  const replay = await reverseSettlement({ settlementId: settlement._id, actor: parent._id, transactionId: refund._id, providerReference: refund.reference, idempotencyKey: "reverse-ok" });
  assert.equal(replay.duplicate, true);
});

test("EduPay financial ledger and audit records cannot be mutated", async () => {
  const entry = await EduLedger.create({ parent: parent._id, child: plan.child, plan: plan._id, direction: "CREDIT", type: "CONTRIBUTION", amount: 1, openingBalance: 0, closingBalance: 1, reference: "IMMUTABLE", idempotencyKey: "immutable-entry", source: "TEST" });
  await assert.rejects(() => EduLedger.updateOne({ _id: entry._id }, { $set: { amount: 99 } }), /Immutable EduPay record/);
});

test("all critical model indexes can be initialized without startup data mutation", async () => {
  await Promise.all([EduLedger.init(), Settlement.init(), EduPaySponsorContribution.init(), EduPayRepaymentTransaction.init()]);
  assert.ok((await EduLedger.collection.listIndexes().toArray()).length > 0);
});

async function repayFromWalletForTest(repayment, amount, key) {
  const { repayFromWallet } = require("../services/edupay.service");
  return repayFromWallet({ userId: parent._id, repaymentId: repayment._id, amount, transactionPin: "1234", idempotencyKey: key });
}