const crypto = require("crypto");
const mongoose = require("mongoose");
const User = require("../models/user.model");
const LedgerEntry = require("../models/ledgerEntry.model");
const Transaction = require("../models/transaction.model");
const Notification = require("../models/notification.model");
const { postDebit } = require("./ledger.service");
const { verifyTransactionPin } = require("./transactionPin.service");
const Settings = require("../models/edupaySettings.model");
const School = require("../models/edupaySchool.model");
const Child = require("../models/edupayChild.model");
const Plan = require("../models/edupayPlan.model");
const Contribution = require("../models/edupayContribution.model");
const EduLedger = require("../models/edupayLedgerEntry.model");
const Fee = require("../models/edupayFeeStructure.model");
const Settlement = require("../models/edupaySettlement.model");
const { EduPayRepayment, EduPayRepaymentTransaction } = require("../models/edupayRepayment.model");
const { EduPaySponsorInvite, EduPaySponsorContribution } = require("../models/edupaySponsor.model");
const Audit = require("../models/edupayAuditLog.model");
const Command = require("../models/edupayCommand.model");

const round = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const reference = (prefix) => `${prefix}-${Date.now()}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
const hash = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");

async function getSettings(session = null) {
  let query = Settings.findOneAndUpdate({ key: "GLOBAL" }, { $setOnInsert: { key: "GLOBAL" } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  if (session) query = query.session(session);
  return query;
}
async function audit({ actor, action, entityType, entityId = null, school = null, metadata = {}, req, session = null }) {
  const options = session ? { session } : undefined;
  return (await Audit.create([{ actor, action, entityType, entityId, school, metadata, ip: req?.ip || null }], options))[0];
}
async function notify(userId, title, message, referenceId = null) {
  try { await Notification.create({ userId, title, message, type: "GENERAL", category: "OTHER", referenceId, referenceType: "EDUPAY" }); } catch (error) { console.warn("EduPay notification skipped:", error.message); }
}
function ensureObjectId(value, label) {
  if (!mongoose.isValidObjectId(value)) { const error = new Error(`${label} is invalid.`); error.statusCode = 400; throw error; }
  return value;
}
function calculateSettlement({ officialFee, saved, settings, settlementDate = new Date() }) {
  const fee = round(officialFee); const parentSavedAmount = Math.min(round(saved), fee);
  const servicepayFundedPrincipal = round(fee - parentSavedAmount);
  if (servicepayFundedPrincipal > round(settings.maximumEduPayCover || 0) && Number(settings.maximumEduPayCover || 0) > 0) {
    const error = new Error("This plan exceeds the configured maximum EduPay cover."); error.statusCode = 400; throw error;
  }
  const maxPercentage = Number(settings.maximumCoverPercentage || 100);
  if (fee && servicepayFundedPrincipal / fee * 100 > maxPercentage) {
    const error = new Error("This plan exceeds the configured maximum cover percentage."); error.statusCode = 400; throw error;
  }
  const schoolCommissionRate = Number(settings.schoolCommissionRate);
  const parentChargeRate = Number(settings.parentShortfallChargeRate);
  const schoolCommissionAmount = round(fee * schoolCommissionRate / 100);
  const parentChargeAmount = round(servicepayFundedPrincipal * parentChargeRate / 100);
  const parentTotalRepayment = round(servicepayFundedPrincipal + parentChargeAmount);
  const schoolGrossSettlement = fee;
  const schoolNetSettlement = settings.settlementMethod === "DEDUCT_COMMISSION" ? round(fee - schoolCommissionAmount) : fee;
  return { officialFee: fee, parentSavedAmount, servicepayFundedPrincipal, schoolCommissionRate, schoolCommissionAmount, parentChargeRate, parentChargeAmount, parentTotalRepayment, schoolGrossSettlement, schoolNetSettlement, commissionMethod: settings.settlementMethod, settlementDate };
}
async function availableSavings(planId, session = null) {
  const pipeline = [
    { $match: { plan: new mongoose.Types.ObjectId(planId) } },
    { $group: { _id: null, credits: { $sum: { $cond: [{ $eq: ["$direction", "CREDIT"] }, "$amount", 0] } }, debits: { $sum: { $cond: [{ $eq: ["$direction", "DEBIT"] }, "$amount", 0] } } } },
  ];
  let query = EduLedger.aggregate(pipeline); if (session) query = query.session(session);
  const row = (await query)[0];
  return round(Number(row?.credits || 0) - Number(row?.debits || 0));
}
async function createEduLedger({ parent, child, plan, direction, type, amount, openingBalance, reference: ref, idempotencyKey, source, metadata = {}, session }) {
  const closingBalance = round(direction === "CREDIT" ? openingBalance + amount : openingBalance - amount);
  if (closingBalance < 0) { const error = new Error("EduPay savings cannot become negative."); error.statusCode = 409; throw error; }
  let existingQuery = EduLedger.findOne({ idempotencyKey });
  if (session) existingQuery = existingQuery.session(session);
  const existing = await existingQuery;
  if (existing) return { entry: existing, duplicate: true };
  if (session) {
    const account = await Plan.findById(plan).select("ledgerVersion").session(session);
    const version = Number(account?.ledgerVersion || 0);
    const cas = await Plan.updateOne({ _id: plan, ledgerVersion: version }, { $inc: { ledgerVersion: 1 } }, { session });
    if (!cas.modifiedCount) {
      const error = new Error("EduPay ledger account changed concurrently; retry the command.");
      error.errorLabels = ["TransientTransactionError"];
      throw error;
    }
  }
  const [entry] = await EduLedger.create([{ parent, child, plan, direction, type, amount, openingBalance, closingBalance, reference: ref, idempotencyKey, source, metadata }], { session });
  return { entry, duplicate: false };
}
function assertIntent(existing, intentHash) {
  if (existing && existing.intentHash !== intentHash) {
    const error = new Error("Idempotency-Key was already used for a different EduPay operation.");
    error.statusCode = 409;
    throw error;
  }
}

async function contributeFromWallet({ userId, planId, amount, transactionPin, idempotencyKey }) {
  ensureObjectId(planId, "Plan");
  const value = round(amount); if (!(value > 0)) { const error = new Error("Contribution amount must be greater than zero."); error.statusCode = 400; throw error; }
  if (!idempotencyKey) { const error = new Error("Idempotency-Key is required."); error.statusCode = 400; throw error; }
  const intentHash = hash(JSON.stringify({ operation: "CONTRIBUTION", actor: String(userId), resource: String(planId), amount: value }));
  const existing = await Contribution.findOne({ idempotencyKey }).populate("plan child");
  assertIntent(existing, intentHash);
  if (existing) return { contribution: existing, duplicate: true };
  await verifyTransactionPin(userId, transactionPin);
  const session = await mongoose.startSession(); let output;
  try {
    await session.withTransaction(async () => {
      const plan = await Plan.findOne({ _id: planId, parent: userId }).session(session);
      if (!plan) { const error = new Error("EduPay plan not found."); error.statusCode = 404; throw error; }
      if (["SETTLED", "CANCELLED", "REVERSED"].includes(plan.status)) { const error = new Error("This plan cannot receive contributions."); error.statusCode = 409; throw error; }
      const before = await User.findById(userId).select("walletBalance").session(session);
      const updated = await User.findOneAndUpdate({ _id: userId, status: "ACTIVE", walletBalance: { $gte: value } }, { $inc: { walletBalance: -value } }, { new: true, session });
      if (!updated) { const error = new Error("Your wallet balance is insufficient."); error.statusCode = 400; throw error; }
      const ref = reference("EDU-CON");
      const [transaction] = await Transaction.create([{ reference: ref, customerId: userId, serviceType: "EDUPAY", amount: value, status: "SUCCESSFUL", provider: "SERVICEPAY_WALLET", providerResponse: { product: "EDUPAY", plan: String(plan._id) } }], { session });
      const ledger = await postDebit({ userId, amount: value, openingBalance: round(before.walletBalance), closingBalance: round(updated.walletBalance), service: "EDUPAY", reference: ref, idempotencyKey: `edupay-wallet-${idempotencyKey}`, transactionId: transaction._id, narration: "EduPay savings contribution", session });
      const saved = await availableSavings(plan._id, session);
      const [contribution] = await Contribution.create([{ parent: userId, child: plan.child, plan: plan._id, amount: value, type: "CONTRIBUTION", status: "SUCCESS", reference: ref, idempotencyKey, intentHash, walletLedgerEntry: ledger.entry._id, transaction: transaction._id }], { session });
      await createEduLedger({ parent: userId, child: plan.child, plan: plan._id, direction: "CREDIT", type: "CONTRIBUTION", amount: value, openingBalance: saved, reference: `${ref}-SAVINGS`, idempotencyKey: `${idempotencyKey}-savings`, source: "WALLET", session });
      output = contribution;
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const replay = await Contribution.findOne({ idempotencyKey });
    assertIntent(replay, intentHash);
    if (replay) return { contribution: replay, duplicate: true };
    throw error;
  } finally { await session.endSession(); }
  await notify(userId, "EduPay savings received", "Your EduPay school-fee savings contribution was successful.", output?._id);
  return { contribution: output, duplicate: false };
}

async function contributeSponsorFromWallet({ sponsorId, tokenHash, amount, transactionPin, idempotencyKey }) {
  const value = round(amount);
  if (!(value > 0) || !idempotencyKey) { const error = new Error("A valid amount and Idempotency-Key are required."); error.statusCode = 400; throw error; }
  await verifyTransactionPin(sponsorId, transactionPin);
  const invite = await EduPaySponsorInvite.findOne({ tokenHash, status: "ACTIVE", expiresAt: { $gt: new Date() } });
  if (!invite) { const error = new Error("Sponsor link is invalid or expired."); error.statusCode = 404; throw error; }
  const intentHash = hash(JSON.stringify({ operation: "SPONSOR_CONTRIBUTION", actor: String(sponsorId), resource: String(invite._id), amount: value }));
  const existing = await EduPaySponsorContribution.findOne({ idempotencyKey });
  assertIntent(existing, intentHash);
  if (existing) return { contribution: existing, duplicate: true };
  const session = await mongoose.startSession(); let result;
  try {
    await session.withTransaction(async () => {
      const [before] = await User.find({ _id: sponsorId, status: "ACTIVE" }).select("walletBalance").session(session);
      if (!before || Number(before.walletBalance) < value) { const error = new Error("Your wallet balance is insufficient."); error.statusCode = 400; throw error; }
      const updated = await User.findOneAndUpdate({ _id: sponsorId, status: "ACTIVE", walletBalance: { $gte: value } }, { $inc: { walletBalance: -value } }, { new: true, session });
      if (!updated) { const error = new Error("Your wallet balance is insufficient."); error.statusCode = 400; throw error; }
      const ref = reference("EDU-SPN");
      const [coreTransaction] = await Transaction.create([{ reference: ref, customerId: sponsorId, serviceType: "EDUPAY", amount: value, status: "SUCCESSFUL", provider: "SERVICEPAY_WALLET", providerResponse: { product: "EDUPAY_SPONSOR", invite: String(invite._id) } }], { session });
      const walletLedger = await postDebit({ userId: sponsorId, amount: value, openingBalance: before.walletBalance, closingBalance: updated.walletBalance, service: "EDUPAY", reference: ref, idempotencyKey: `edupay-sponsor-wallet-${idempotencyKey}`, transactionId: coreTransaction._id, narration: "EduPay sponsor contribution", session });
      const saved = await availableSavings(invite.plan, session);
      const savings = await createEduLedger({ parent: invite.parent, child: invite.child, plan: invite.plan, direction: "CREDIT", type: "SPONSOR_CONTRIBUTION", amount: value, openingBalance: saved, reference: `${ref}-SAVINGS`, idempotencyKey: `${idempotencyKey}-savings`, source: "SPONSOR", session });
      [result] = await EduPaySponsorContribution.create([{ sponsor: sponsorId, invite: invite._id, parent: invite.parent, child: invite.child, plan: invite.plan, sponsorName: updated.fullName, amount: value, reference: ref, idempotencyKey, intentHash, walletLedgerEntry: walletLedger.entry._id, transaction: coreTransaction._id }], { session });
      void savings;
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const replay = await EduPaySponsorContribution.findOne({ idempotencyKey });
    assertIntent(replay, intentHash);
    if (replay) return { contribution: replay, duplicate: true };
    throw error;
  } finally { await session.endSession(); }
  await notify(invite.parent, "Sponsor contribution received", "A sponsor contributed to your EduPay plan.", result?._id);
  return { contribution: result, duplicate: false };
}

async function repayFromWallet({ userId, repaymentId, amount, transactionPin, idempotencyKey }) {
  ensureObjectId(repaymentId, "Repayment"); const value = round(amount);
  if (!(value > 0) || !idempotencyKey) { const error = new Error("A valid amount and Idempotency-Key are required."); error.statusCode = 400; throw error; }
  const intentHash = hash(JSON.stringify({ operation: "REPAYMENT", actor: String(userId), resource: String(repaymentId), amount: value }));
  const existing = await EduPayRepaymentTransaction.findOne({ idempotencyKey });
  assertIntent(existing, intentHash);
  if (existing) return { transaction: existing, duplicate: true };
  await verifyTransactionPin(userId, transactionPin);
  const session = await mongoose.startSession(); let result;
  try {
    await session.withTransaction(async () => {
      const repayment = await EduPayRepayment.findOne({ _id: repaymentId, parent: userId }).session(session);
      if (!repayment) { const error = new Error("Repayment not found."); error.statusCode = 404; throw error; }
      if (value > round(repayment.amountRemaining)) { const error = new Error("Repayment amount exceeds the remaining balance."); error.statusCode = 400; throw error; }
      const before = await User.findById(userId).select("walletBalance").session(session);
      const updated = await User.findOneAndUpdate({ _id: userId, status: "ACTIVE", walletBalance: { $gte: value } }, { $inc: { walletBalance: -value } }, { new: true, session });
      if (!updated) { const error = new Error("Your wallet balance is insufficient."); error.statusCode = 400; throw error; }
      const ref = reference("EDU-REP");
      const [walletTransaction] = await Transaction.create([{ reference: ref, customerId: userId, serviceType: "EDUPAY", amount: value, status: "SUCCESSFUL", provider: "SERVICEPAY_WALLET", providerResponse: { product: "EDUPAY_REPAYMENT", repayment: String(repayment._id) } }], { session });
      const ledger = await postDebit({ userId, amount: value, openingBalance: before.walletBalance, closingBalance: updated.walletBalance, service: "EDUPAY", reference: ref, idempotencyKey: `edupay-repayment-wallet-${idempotencyKey}`, transactionId: walletTransaction._id, narration: "EduPay repayment", session });
      const [transaction] = await EduPayRepaymentTransaction.create([{ repayment: repayment._id, parent: userId, amount: value, reference: ref, idempotencyKey, intentHash, walletLedgerEntry: ledger.entry._id }], { session });
      const paid = round(repayment.amountPaid + value);
      await EduPayRepayment.updateOne({ _id: repayment._id }, { $set: { amountPaid: paid, amountRemaining: round(repayment.totalAmount - paid), status: paid >= repayment.totalAmount ? "PAID" : "PARTIALLY_PAID" } }, { session });
      result = transaction;
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const replay = await EduPayRepaymentTransaction.findOne({ idempotencyKey });
    assertIntent(replay, intentHash);
    if (replay) return { transaction: replay, duplicate: true };
    throw error;
  } finally { await session.endSession(); }
  await notify(userId, "EduPay repayment received", "Your EduPay repayment was received.", result?._id);
  return { transaction: result, duplicate: false };
}

async function confirmSettlement({ settlementId, actor, transactionId, providerReference, idempotencyKey, req }) {
  ensureObjectId(settlementId, "Settlement"); ensureObjectId(transactionId, "Payout transaction");
  if (!idempotencyKey) { const error = new Error("Idempotency-Key is required."); error.statusCode = 400; throw error; }
  const intentHash = hash(JSON.stringify({ operation: "SETTLEMENT_CONFIRM", actor: String(actor), resource: String(settlementId), transactionId: String(transactionId), providerReference }));
  const priorCommand = await Command.findOne({ key: idempotencyKey });
  if (priorCommand) {
    if (String(priorCommand.owner) !== String(actor) || priorCommand.intentHash !== intentHash) { const error = new Error("Idempotency-Key was already used for a different settlement command."); error.statusCode = 409; throw error; }
    if (priorCommand.status === "SUCCEEDED") return { settlement: await Settlement.findById(settlementId), duplicate: true };
  }
  const session = await mongoose.startSession(); let result; let duplicate = false;
  try {
    await session.withTransaction(async () => {
      const settlement = await Settlement.findById(settlementId).session(session);
      if (!settlement) { const error = new Error("Settlement not found."); error.statusCode = 404; throw error; }
      if (settlement.status === "SETTLED") { duplicate = true; result = settlement; return; }
      if (settlement.status !== "PROCESSING") { const error = new Error("Settlement must be PROCESSING before confirmation."); error.statusCode = 409; throw error; }
      if (!priorCommand) await Command.create([{ key: idempotencyKey, owner: actor, command: "EDUPAY_SETTLEMENT_CONFIRM", intentHash }], { session });
      const payout = await Transaction.findOne({
        _id: transactionId, reference: providerReference, serviceType: "EDUPAY", status: "SUCCESSFUL",
        amount: settlement.schoolNetSettlement,
        "providerResponse.edupaySettlementId": String(settlement._id),
        "providerResponse.schoolNetSettlement": settlement.schoolNetSettlement,
      }).session(session);
      if (!payout) { const error = new Error("A successful authoritative school payout transaction with the exact settlement amount is required."); error.statusCode = 409; throw error; }
      const cas = await Settlement.updateOne({ _id: settlement._id, status: "PROCESSING" }, { $set: { status: "SETTLED", providerReference: payout.reference, provider: payout.provider, confirmedBy: actor, confirmedAt: new Date() } }, { session });
      if (!cas.modifiedCount) { duplicate = true; result = await Settlement.findById(settlement._id).session(session); return; }
      const saved = await availableSavings(settlement.plan, session);
      if (saved < settlement.parentSavedAmount) { const error = new Error("Eligible EduPay savings are insufficient for settlement."); error.statusCode = 409; throw error; }
      await createEduLedger({ parent: settlement.parent, child: settlement.child, plan: settlement.plan, direction: "DEBIT", type: "SETTLEMENT_DEBIT", amount: settlement.parentSavedAmount, openingBalance: saved, reference: `${settlement.reference}-SAVINGS-DEBIT`, idempotencyKey: `${settlement.idempotencyKey}-savings-debit`, source: "SETTLEMENT", session });
      if (settlement.servicepayFundedPrincipal > 0) { const settings = await getSettings(session); await EduPayRepayment.create([{ parent: settlement.parent, child: settlement.child, plan: settlement.plan, settlement: settlement._id, principal: settlement.servicepayFundedPrincipal, serviceCharge: settlement.parentChargeAmount, totalAmount: settlement.parentTotalRepayment, amountPaid: 0, amountRemaining: settlement.parentTotalRepayment, dueDate: new Date(Date.now() + (settings.defaultRepaymentPeriodDays + settings.gracePeriodDays) * 86400000), status: "ACTIVE" }], { session }); }
      await Plan.updateOne({ _id: settlement.plan }, { $set: { status: "SETTLED" } }, { session });
      await audit({ actor, action: "EDUPAY_SETTLEMENT_CONFIRMED", entityType: "EduPaySettlement", entityId: settlement._id, school: settlement.school, metadata: { payoutTransaction: payout._id, amount: payout.amount }, req, session });
      result = await Settlement.findById(settlement._id).session(session);
      await Command.updateOne({ key: idempotencyKey }, { $set: { status: "SUCCEEDED", result: { settlementId: String(settlement._id) } } }, { session });
    });
  } finally { await session.endSession(); }
  return { settlement: result, duplicate };
}

async function reverseSettlement({ settlementId, actor, transactionId, providerReference, idempotencyKey, req, reason }) {
  ensureObjectId(settlementId, "Settlement"); ensureObjectId(transactionId, "Reversal transaction");
  const Reversal = require("../models/edupaySettlementReversal.model");
  if (!idempotencyKey) { const error = new Error("Idempotency-Key is required."); error.statusCode = 400; throw error; }
  const intentHash = hash(JSON.stringify({ operation: "SETTLEMENT_REVERSE", actor: String(actor), resource: String(settlementId), transactionId: String(transactionId), providerReference, reason: reason || "" }));
  const priorCommand = await Command.findOne({ key: idempotencyKey });
  if (priorCommand) {
    if (String(priorCommand.owner) !== String(actor) || priorCommand.intentHash !== intentHash) { const error = new Error("Idempotency-Key was already used for a different settlement command."); error.statusCode = 409; throw error; }
    if (priorCommand.status === "SUCCEEDED") return { reversal: await Reversal.findOne({ settlement: settlementId }), duplicate: true };
  }
  const session = await mongoose.startSession(); let result; let duplicate = false;
  try {
    await session.withTransaction(async () => {
      const settlement = await Settlement.findById(settlementId).session(session);
      if (!settlement) { const error = new Error("Settlement not found."); error.statusCode = 404; throw error; }
      const existing = await Reversal.findOne({ settlement: settlement._id }).session(session);
      if (existing) { duplicate = true; result = existing; return; }
      if (settlement.status !== "SETTLED") { const error = new Error("Only settled settlements can be reversed."); error.statusCode = 409; throw error; }
      if (!priorCommand) await Command.create([{ key: idempotencyKey, owner: actor, command: "EDUPAY_SETTLEMENT_REVERSE", intentHash }], { session });
      const refund = await Transaction.findOne({ _id: transactionId, reference: providerReference, serviceType: "EDUPAY", status: "SUCCESSFUL", amount: settlement.schoolNetSettlement, "providerResponse.edupaySettlementId": String(settlement._id), "providerResponse.reversal": true }).session(session);
      if (!refund) { const error = new Error("A successful authoritative reversal transaction matching the settled amount is required."); error.statusCode = 409; throw error; }
      const [reversal] = await Reversal.create([{ settlement: settlement._id, plan: settlement.plan, parent: settlement.parent, school: settlement.school, amount: settlement.schoolNetSettlement, reference: `REV-${refund.reference}`, reason: reason || "Settlement reversed", actor }], { session });
      const saved = await availableSavings(settlement.plan, session);
      if (settlement.parentSavedAmount > 0) await createEduLedger({ parent: settlement.parent, child: settlement.child, plan: settlement.plan, direction: "CREDIT", type: "REVERSAL", amount: settlement.parentSavedAmount, openingBalance: saved, reference: `${reversal.reference}-SAVINGS`, idempotencyKey: `${reversal.reference}-savings`, source: "REVERSAL", session });
      const repayment = await EduPayRepayment.findOne({ settlement: settlement._id }).session(session);
      if (repayment) await EduPayRepayment.updateOne({ _id: repayment._id }, { $set: { status: "RESTRUCTURED", reversalSettlement: settlement._id, reversedUnpaidAmount: round(Math.max(0, repayment.amountRemaining)) } }, { session });
      await Settlement.updateOne({ _id: settlement._id, status: "SETTLED" }, { $set: { status: "REVERSED", reversalOf: settlement._id } }, { session });
      await Plan.updateOne({ _id: settlement.plan }, { $set: { status: "REVERSED" } }, { session });
      await audit({ actor, action: "EDUPAY_SETTLEMENT_REVERSED", entityType: "EduPaySettlementReversal", entityId: reversal._id, school: settlement.school, metadata: { refundTransaction: refund._id }, req, session });
      result = reversal;
      await Command.updateOne({ key: idempotencyKey }, { $set: { status: "SUCCEEDED", result: { reversalId: String(reversal._id) } } }, { session });
    });
  } finally { await session.endSession(); }
  return { reversal: result, duplicate };
}

module.exports = {
  getSettings, audit, notify, round, reference, hash, ensureObjectId, calculateSettlement, availableSavings,
  contributeFromWallet, contributeSponsorFromWallet, repayFromWallet, confirmSettlement, reverseSettlement, createEduLedger,
  models: { User, School, Child, Plan, Contribution, EduLedger, Fee, Settlement, EduPayRepayment, EduPayRepaymentTransaction, EduPaySponsorInvite, EduPaySponsorContribution },
};