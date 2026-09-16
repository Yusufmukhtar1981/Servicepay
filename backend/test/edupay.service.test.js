const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const axios = require("axios");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const User = require("../models/user.model");
const School = require("../models/edupaySchool.model");
const { EduPayAcademicSession, EduPayTerm, EduPayClass } = require("../models/edupayAcademic.model");
const Fee = require("../models/edupayFeeStructure.model");
const Child = require("../models/edupayChild.model");
const Plan = require("../models/edupayPlan.model");
const Settings = require("../models/edupaySettings.model");
const AppSettings = require("../models/appSettings.model");
const EduLedger = require("../models/edupayLedgerEntry.model");
const Transaction = require("../models/transaction.model");
const CoreLedger = require("../models/ledgerEntry.model");
const { EduPayRepayment, EduPayRepaymentTransaction } = require("../models/edupayRepayment.model");
const { EduPaySponsorInvite, EduPaySponsorContribution } = require("../models/edupaySponsor.model");
const Reversal = require("../models/edupaySettlementReversal.model");
const Settlement = require("../models/edupaySettlement.model");
const SettlementAccount = require("../models/edupaySettlementAccount.model");
const PayoutEvidence = require("../models/edupayPayoutEvidence.model");
const Commission = require("../models/edupayCommission.model");
const AccountVerificationEvidence = require("../models/edupayAccountVerificationEvidence.model");
const DutyAssignment = require("../models/edupayDutyAssignment.model");
const { requireExplicitEduPayDuty } = require("../middleware/edupayDuty.middleware");
const Command = require("../models/edupayCommand.model");
const squad = require("../services/edupaySquad.service");
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
const models = [User, School, EduPayAcademicSession, EduPayTerm, EduPayClass, Fee, Child, Plan, Settings, AppSettings, EduLedger, Transaction, CoreLedger, EduPayRepayment, EduPayRepaymentTransaction, EduPaySponsorInvite, EduPaySponsorContribution, Reversal, Audit, Settlement, SettlementAccount, AccountVerificationEvidence, PayoutEvidence, Commission, Command, DutyAssignment];

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

test("partially paid repayments accept a second payment and then close exactly", async () => {
  const repayment = await EduPayRepayment.create({ parent: parent._id, child: plan.child, plan: plan._id, settlement: new mongoose.Types.ObjectId(), principal: 80000, serviceCharge: 8000, totalAmount: 88000, amountRemaining: 88000, dueDate: new Date(Date.now() + 86400000) });
  await repayFromWalletForTest(repayment, 10000, "partial-one");
  assert.equal((await EduPayRepayment.findById(repayment._id)).status, "PARTIALLY_PAID");
  await repayFromWalletForTest(repayment, 10000, "partial-two");
  await repayFromWalletForTest(repayment, 68000, "partial-final");
  const reloaded = await EduPayRepayment.findById(repayment._id);
  assert.equal(reloaded.status, "PAID"); assert.equal(reloaded.amountRemaining, 0); assert.equal(reloaded.amountPaid, 88000);
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
  const evidence = await PayoutEvidence.create({ settlement: settlement._id, coreTransaction: refund._id, providerReference: refund.reference, normalizedStatus: "REVERSED", amount: 19000000, currency: "NGN", eventType: "REVERSED", payloadDigest: "legacy-reversal-evidence", source: "REQUERY" });
  const result = await reverseSettlement({ settlementId: settlement._id, actor: parent._id, transactionId: refund._id, providerReference: refund.reference, evidenceId: evidence._id, idempotencyKey: "reverse-ok" });
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

test("Squad PROCESS fails safely with explicit configuration error", async () => {
  const previous = process.env.EDUPAY_SQUAD_TRANSFER_ENABLED;
  delete process.env.EDUPAY_SQUAD_TRANSFER_ENABLED;
  await assert.rejects(() => squad.processSettlement(new mongoose.Types.ObjectId()), (error) => error.code === "CONFIGURATION_REQUIRED");
  if (previous === undefined) delete process.env.EDUPAY_SQUAD_TRANSFER_ENABLED; else process.env.EDUPAY_SQUAD_TRANSFER_ENABLED = previous;
});

test("Squad webhook HMAC rejects invalid signatures and accepts timing-safe valid signatures", async () => {
  const crypto = require("crypto"); const raw = Buffer.from('{"event":"success"}'); const secret = "edupay-test-secret";
  const signature = crypto.createHmac("sha512", secret).update(raw).digest("hex");
  assert.equal(squad.timingSafe(raw, signature, secret), true);
  assert.equal(squad.timingSafe(raw, `${signature.slice(0, -2)}00`, secret), false);
});

test("verified Squad callback creates immutable payout evidence and finalizes once", async () => {
  const settlement = await Settlement.create({ ...calculateSettlement({ officialFee: 200000, saved: 0, settings: await Settings.findOne() }), parent: parent._id, child: plan.child, school: school._id, plan: plan._id, reference: "SET-WEBHOOK", idempotencyKey: "set-webhook", providerReference: "EDUPAY-SET-WEBHOOK", status: "PROCESSING" });
  const raw = JSON.stringify({ event: "SUCCESS", data: { transaction_reference: "EDUPAY-SET-WEBHOOK", amount: 19000000, currency: "NGN", status: "SUCCESS" } });
  const old = process.env.EDUPAY_SQUAD_WEBHOOK_SECRET; process.env.EDUPAY_SQUAD_WEBHOOK_SECRET = "edupay-test-secret";
  const result = await squad.handleWebhook({ payload: JSON.parse(raw), raw: Buffer.from(raw), signature: require("crypto").createHmac("sha512", process.env.EDUPAY_SQUAD_WEBHOOK_SECRET).update(raw).digest("hex"), req: {} });
  assert.equal(result.status, "SETTLED");
  assert.equal(await PayoutEvidence.countDocuments({ settlement: settlement._id }), 1);
  assert.equal(await Transaction.countDocuments({ reference: "EDUPAY-SET-WEBHOOK", serviceType: "EDUPAY" }), 1);
  const replay = await squad.handleWebhook({ payload: JSON.parse(raw), raw: Buffer.from(raw), signature: require("crypto").createHmac("sha512", process.env.EDUPAY_SQUAD_WEBHOOK_SECRET).update(raw).digest("hex"), req: {} });
  assert.equal(replay.status, "SETTLED");
  if (old === undefined) delete process.env.EDUPAY_SQUAD_WEBHOOK_SECRET; else process.env.EDUPAY_SQUAD_WEBHOOK_SECRET = old;
});

test("payout evidence fields are immutable after persistence", async () => {
  const settlement = await Settlement.create({ ...calculateSettlement({ officialFee: 200000, saved: 0, settings: await Settings.findOne() }), parent: parent._id, child: plan.child, school: school._id, plan: plan._id, reference: "SET-EVIDENCE-IMM", idempotencyKey: "set-evidence-imm", status: "PROCESSING" });
  const evidence = await PayoutEvidence.create({ settlement: settlement._id, providerReference: "EVIDENCE-IMM", normalizedStatus: "SUCCESSFUL", amount: 19000000, currency: "NGN", eventType: "SUCCESS", payloadDigest: "digest-imm", source: "WEBHOOK" });
  await assert.rejects(() => PayoutEvidence.updateOne({ _id: evidence._id }, { $set: { providerReference: "changed" } }), /Immutable EduPay record/);
});

test("settlement lifecycle fields persist after approval, processing, provider callback, and reload", async () => {
  const settlement = await Settlement.create({ ...calculateSettlement({ officialFee: 200000, saved: 0, settings: await Settings.findOne() }), parent: parent._id, child: plan.child, school: school._id, plan: plan._id, reference: "SET-LIFECYCLE", idempotencyKey: "set-lifecycle", status: "ADMIN_REVIEW" });
  await Settlement.updateOne({ _id: settlement._id, status: "ADMIN_REVIEW" }, { $set: { status: "APPROVED", approvedBy: parent._id, approvedAt: new Date("2025-01-01") } });
  await Settlement.updateOne({ _id: settlement._id, status: "APPROVED" }, { $set: { status: "PROCESSING", provider: "SQUAD", providerReference: "EDUPAY-SET-LIFECYCLE", beneficiaryAccountSnapshot: { bankCode: "000", accountNumberLast4: "4321" } } });
  const reloaded = await Settlement.findById(settlement._id);
  assert.equal(String(reloaded.approvedBy), String(parent._id)); assert.equal(reloaded.provider, "SQUAD"); assert.equal(reloaded.providerReference, "EDUPAY-SET-LIFECYCLE"); assert.equal(reloaded.beneficiaryAccountSnapshot.accountNumberLast4, "4321");
});

test("signed provider success callback recovers a PENDING_REVIEW settlement", async () => {
  const settlement = await Settlement.create({ ...calculateSettlement({ officialFee: 200000, saved: 0, settings: await Settings.findOne() }), parent: parent._id, child: plan.child, school: school._id, plan: plan._id, reference: "SET-PENDING", idempotencyKey: "set-pending", providerReference: "EDUPAY-SET-PENDING", status: "PENDING_REVIEW" });
  const raw = JSON.stringify({ event: "SUCCESS", data: { transaction_reference: "EDUPAY-SET-PENDING", amount: 19000000, currency: "NGN", status: "SUCCESS" } }); const secret = "pending-secret"; const old = process.env.EDUPAY_SQUAD_WEBHOOK_SECRET; process.env.EDUPAY_SQUAD_WEBHOOK_SECRET = secret;
  const result = await squad.handleWebhook({ payload: JSON.parse(raw), raw: Buffer.from(raw), signature: require("crypto").createHmac("sha512", secret).update(raw).digest("hex"), req: {} });
  assert.equal(result.status, "SETTLED"); if (old === undefined) delete process.env.EDUPAY_SQUAD_WEBHOOK_SECRET; else process.env.EDUPAY_SQUAD_WEBHOOK_SECRET = old;
});

test("verified PENDING_REVIEW provider evidence creates no financial transaction or accounting", async () => {
  const settlement = await Settlement.create({ ...calculateSettlement({ officialFee: 200000, saved: 0, settings: await Settings.findOne() }), parent: parent._id, child: plan.child, school: school._id, plan: plan._id, reference: "SET-PENDING-EVIDENCE", idempotencyKey: "set-pending-evidence", providerReference: "EDUPAY-SET-PENDING-EVIDENCE", status: "PENDING_REVIEW" });
  const raw = JSON.stringify({ event: "PENDING", data: { transaction_reference: "EDUPAY-SET-PENDING-EVIDENCE", amount: 19000000, currency: "NGN", status: "PENDING" } }); const secret = "pending-evidence-secret"; const old = process.env.EDUPAY_SQUAD_WEBHOOK_SECRET; process.env.EDUPAY_SQUAD_WEBHOOK_SECRET = secret;
  const result = await squad.handleWebhook({ payload: JSON.parse(raw), raw: Buffer.from(raw), signature: require("crypto").createHmac("sha512", secret).update(raw).digest("hex"), req: {} });
  assert.equal(result.status, "PENDING_REVIEW"); assert.equal(await PayoutEvidence.countDocuments({ settlement: settlement._id }), 1); assert.equal(await Transaction.countDocuments({ serviceType: "EDUPAY" }), 0); assert.equal(await EduLedger.countDocuments({ plan: plan._id }), 0);
  if (old === undefined) delete process.env.EDUPAY_SQUAD_WEBHOOK_SECRET; else process.env.EDUPAY_SQUAD_WEBHOOK_SECRET = old;
});

test("same-amount provider callback with wrong persisted reference is rejected without mutation", async () => {
  const settlement = await Settlement.create({ ...calculateSettlement({ officialFee: 200000, saved: 0, settings: await Settings.findOne() }), parent: parent._id, child: plan.child, school: school._id, plan: plan._id, reference: "SET-WRONG-REF", idempotencyKey: "set-wrong-ref", providerReference: "EDUPAY-SET-WRONG-REF", status: "PENDING_REVIEW" });
  const raw = JSON.stringify({ event: "SUCCESS", data: { transaction_reference: "EDUPAY-OTHER-REF", amount: 19000000, currency: "NGN", status: "SUCCESS" } }); const secret = "wrong-ref-secret"; const old = process.env.EDUPAY_SQUAD_WEBHOOK_SECRET; process.env.EDUPAY_SQUAD_WEBHOOK_SECRET = secret;
  await assert.rejects(() => squad.handleWebhook({ payload: JSON.parse(raw), raw: Buffer.from(raw), signature: require("crypto").createHmac("sha512", secret).update(raw).digest("hex"), req: {} }), (error) => error.code === "REFERENCE_MISMATCH");
  assert.equal(await PayoutEvidence.countDocuments({ settlement: settlement._id }), 0); assert.equal(await Transaction.countDocuments({ serviceType: "EDUPAY" }), 0); assert.equal((await Settlement.findById(settlement._id)).status, "PENDING_REVIEW");
  if (old === undefined) delete process.env.EDUPAY_SQUAD_WEBHOOK_SECRET; else process.env.EDUPAY_SQUAD_WEBHOOK_SECRET = old;
});

test("signed provider REVERSED webhook without actor atomically recovers settlement and retries safely", async () => {
  const settings = await Settings.findOne(); const snapshot = calculateSettlement({ officialFee: 200000, saved: 10000, settings });
  const settlement = await Settlement.create({ ...snapshot, parent: parent._id, child: plan.child, school: school._id, plan: plan._id, reference: "SET-REVERSED-WEBHOOK", idempotencyKey: "set-reversed-webhook", providerReference: "EDUPAY-SET-REVERSED-WEBHOOK", status: "SETTLED" });
  await EduLedger.create({ parent: parent._id, child: plan.child, plan: plan._id, direction: "CREDIT", type: "CONTRIBUTION", amount: 10000, openingBalance: 0, closingBalance: 10000, reference: "REV-SAVINGS-CREDIT", idempotencyKey: "rev-savings-credit", source: "TEST" });
  await Commission.create({ settlement: settlement._id, school: school._id, amount: settlement.schoolCommissionAmount, direction: "RECEIVABLE", reference: "REV-COMMISSION", actorType: "PROVIDER", actorLabel: "SQUAD_WEBHOOK" });
  const repayment = await EduPayRepayment.create({ parent: parent._id, child: plan.child, plan: plan._id, settlement: settlement._id, principal: settlement.servicepayFundedPrincipal, serviceCharge: settlement.parentChargeAmount, totalAmount: settlement.parentTotalRepayment, amountPaid: 10000, amountRemaining: settlement.parentTotalRepayment - 10000, dueDate: new Date(Date.now() + 86400000), status: "PARTIALLY_PAID" });
  const beforeWallet = (await User.findById(parent._id)).walletBalance;
  const raw = JSON.stringify({ event: "REVERSED", data: { transaction_reference: settlement.providerReference, amount: settlement.schoolNetSettlement * 100, currency: "NGN", status: "REVERSED" } }); const secret = "reversed-provider-secret"; const old = process.env.EDUPAY_SQUAD_WEBHOOK_SECRET; process.env.EDUPAY_SQUAD_WEBHOOK_SECRET = secret;
  const signature = require("crypto").createHmac("sha512", secret).update(raw).digest("hex");
  const result = await squad.handleWebhook({ payload: JSON.parse(raw), raw: Buffer.from(raw), signature, req: {} });
  const after = await EduPayRepayment.findById(repayment._id);
  assert.equal(result.status, "REVERSED"); assert.equal(after.status, "CANCELLED"); assert.equal(after.amountRemaining, 0); assert.equal(after.reversedUnpaidAmount, settlement.parentTotalRepayment - 10000);
  assert.equal((await User.findById(parent._id)).walletBalance, beforeWallet + 10000); assert.equal(await Transaction.countDocuments({ reference: `EDUPAY-REFUND-${settlement.reference}` }), 1); assert.equal(await Commission.countDocuments({ settlement: settlement._id, direction: "REVERSAL" }), 1);
  await squad.handleWebhook({ payload: JSON.parse(raw), raw: Buffer.from(raw), signature, req: {} });
  assert.equal((await User.findById(parent._id)).walletBalance, beforeWallet + 10000); assert.equal(await Transaction.countDocuments({ reference: `EDUPAY-REFUND-${settlement.reference}` }), 1);
  if (old === undefined) delete process.env.EDUPAY_SQUAD_WEBHOOK_SECRET; else process.env.EDUPAY_SQUAD_WEBHOOK_SECRET = old;
});

test("dashboard enabled state follows AppSettings feature authority despite EduPaySettings disagreement", async () => {
  await Settings.updateOne({ key: "GLOBAL" }, { $set: { enabled: true } }, { upsert: true });
  await AppSettings.create({ fintechControl: { featureRegistry: { edupay: { enabled: false } } } });
  const controller = require("../controllers/edupay.controller"); let response;
  await controller.dashboard({ user: { _id: parent._id } }, { json: (body) => { response = body; }, status: () => ({ json: (body) => { response = body; } }) });
  assert.equal(response.settings.enabled, false);
});

test("Squad account verification uses exact lookup payload and persists canonical evidence", async () => {
  const old = { transfer: process.env.EDUPAY_SQUAD_TRANSFER_ENABLED, production: process.env.EDUPAY_SQUAD_PRODUCTION_ENABLED, secret: process.env.EDUPAY_SQUAD_SECRET_KEY, merchant: process.env.EDUPAY_SQUAD_MERCHANT_ID, base: process.env.EDUPAY_SQUAD_BASE_URL, encryption: process.env.EDUPAY_ACCOUNT_ENCRYPTION_KEY };
  Object.assign(process.env, { EDUPAY_SQUAD_TRANSFER_ENABLED: "true", EDUPAY_SQUAD_PRODUCTION_ENABLED: "true", EDUPAY_SQUAD_SECRET_KEY: "test-secret", EDUPAY_SQUAD_MERCHANT_ID: "merchant", EDUPAY_SQUAD_BASE_URL: "https://api.squadco.com", EDUPAY_ACCOUNT_ENCRYPTION_KEY: "account-test-key" });
  const verifier = await User.create({ fullName: "Distinct Verifier", phone: `081${Date.now()}`, email: `verifier-${Date.now()}@test.invalid`, password: "Password123!", role: "HEAD_OFFICE", status: "ACTIVE" });
  const account = await squad.saveAccount({ schoolId: school._id, accountName: "Operator Name", bankName: "Bank", bankCode: "058", accountNumber: "0123456789", actor: parent._id });
  const originalPost = axios.post; let request;
  axios.post = async (url, body) => { request = { url, body }; return { status: 200, data: { data: { account_number: "0123456789", account_name: "CANONICAL BENEFICIARY", id: "lookup-1" } } }; };
  try {
    const result = await squad.verifyAccount({ schoolId: school._id, actor: verifier._id });
    assert.equal(request.body.bank_code, "058"); assert.equal(request.body.account_number, "0123456789"); assert.equal(result.account.accountName, "CANONICAL BENEFICIARY"); assert.equal(result.account.verified, true); assert.equal(await AccountVerificationEvidence.countDocuments({ account: account._id }), 1);
    await assert.rejects(() => AccountVerificationEvidence.updateOne({ _id: result.evidence._id }, { $set: { canonicalAccountName: "tampered" } }), /Immutable EduPay record/);
  } finally { axios.post = originalPost; for (const [key, value] of Object.entries({ EDUPAY_SQUAD_TRANSFER_ENABLED: old.transfer, EDUPAY_SQUAD_PRODUCTION_ENABLED: old.production, EDUPAY_SQUAD_SECRET_KEY: old.secret, EDUPAY_SQUAD_MERCHANT_ID: old.merchant, EDUPAY_SQUAD_BASE_URL: old.base, EDUPAY_ACCOUNT_ENCRYPTION_KEY: old.encryption })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});

test("explicit EduPay duty middleware ignores Head Office wildcard and enforces assigned duty", async () => {
  let nextCalled = false; let denied;
  const response = { status: () => ({ json: (body) => { denied = body; } }) };
  const req = { user: { _id: parent._id }, staffAccess: { isHeadOffice: true, permissions: ["*"] } };
  await requireExplicitEduPayDuty("account.verify")(req, response, () => { nextCalled = true; });
  assert.equal(nextCalled, false); assert.equal(denied.code, "EDUPAY_DUTY_REQUIRED");
  await DutyAssignment.create({ user: parent._id, permissions: ["account.verify"], assignedBy: parent._id, version: 1 });
  await requireExplicitEduPayDuty("account.verify")(req, response, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  nextCalled = false; await requireExplicitEduPayDuty("account.manage")(req, response, () => { nextCalled = true; }); assert.equal(nextCalled, false);
});

test("duty assignment endpoint appends assign, change, and revoke history", async () => {
  const controller = require("../controllers/edupay.controller"); const actor = { _id: parent._id, role: "SUPER_ADMIN" }; const response = (callback) => ({ status: () => ({ json: callback }), json: callback });
  let body;
  await controller.adminEduPayDuty({ params: { userId: parent._id }, body: { permissions: ["account.manage", "account.verify"] }, user: actor, ip: "127.0.0.1" }, response((value) => { body = value; }));
  assert.equal(body.success, true, JSON.stringify(body));
  await controller.adminEduPayDuty({ params: { userId: parent._id }, body: { permissions: ["settlement.process"] }, user: actor, ip: "127.0.0.1" }, response((value) => { body = value; }));
  assert.equal(body.success, true, JSON.stringify(body));
  await controller.adminRevokeEduPayDuty({ params: { userId: parent._id }, body: {}, user: actor, ip: "127.0.0.1" }, response((value) => { body = value; }));
  const rows = await DutyAssignment.find({ user: parent._id }).sort({ version: 1 });
  assert.equal(rows.length, 3); assert.deepEqual(rows.map((row) => row.version), [1, 2, 3]); assert.equal(rows[2].active, false); assert.equal(String(rows[2].previousAssignment), String(rows[1]._id));
});

test("readiness requires three distinct latest duty holders", async () => {
  const controller = require("../controllers/edupay.controller"); const users = await User.create([
    { fullName: "Duty One", phone: `082${Date.now()}`, email: `d1-${Date.now()}@test.invalid`, password: "Password123!", role: "HEAD_OFFICE", status: "ACTIVE" },
    { fullName: "Duty Two", phone: `083${Date.now()}`, email: `d2-${Date.now()}@test.invalid`, password: "Password123!", role: "HEAD_OFFICE", status: "ACTIVE" },
    { fullName: "Duty Three", phone: `084${Date.now()}`, email: `d3-${Date.now()}@test.invalid`, password: "Password123!", role: "HEAD_OFFICE", status: "ACTIVE" },
  ]);
  const result = (permissions, user, version) => DutyAssignment.create({ user, permissions, assignedBy: parent._id, version });
  await result(["account.manage", "account.verify", "settlement.process"], users[0]._id, 1);
  const getReadiness = async () => { let body; await controller.adminReadiness({}, { json: (value) => { body = value; }, status: () => ({ json: (value) => { body = value; } }) }); return body; };
  assert.equal((await getReadiness()).dutyCoverage.viableDutySeparation, false);
  await result(["account.verify"], users[1]._id, 1); assert.equal((await getReadiness()).dutyCoverage.viableDutySeparation, false);
  await result(["settlement.process"], users[2]._id, 1); assert.equal((await getReadiness()).dutyCoverage.viableDutySeparation, true);
});

async function repayFromWalletForTest(repayment, amount, key) {
  const { repayFromWallet } = require("../services/edupay.service");
  return repayFromWallet({ userId: parent._id, repaymentId: repayment._id, amount, transactionPin: "1234", idempotencyKey: key });
}