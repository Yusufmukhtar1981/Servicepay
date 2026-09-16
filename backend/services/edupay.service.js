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

const round = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const reference = (prefix) => `${prefix}-${Date.now()}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
const hash = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");

async function getSettings(session = null) {
  let query = Settings.findOneAndUpdate({ key: "GLOBAL" }, { $setOnInsert: { key: "GLOBAL" } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  if (session) query = query.session(session);
  return query;
}
async function audit({ actor, action, entityType, entityId = null, school = null, metadata = {}, req }) {
  return Audit.create({ actor, action, entityType, entityId, school, metadata, ip: req?.ip || null });
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
  const existing = await EduLedger.findOne({ idempotencyKey }).session(session);
  if (existing) return { entry: existing, duplicate: true };
  const [entry] = await EduLedger.create([{ parent, child, plan, direction, type, amount, openingBalance, closingBalance, reference: ref, idempotencyKey, source, metadata }], { session });
  return { entry, duplicate: false };
}

async function contributeFromWallet({ userId, planId, amount, transactionPin, idempotencyKey }) {
  ensureObjectId(planId, "Plan");
  const value = round(amount); if (!(value > 0)) { const error = new Error("Contribution amount must be greater than zero."); error.statusCode = 400; throw error; }
  if (!idempotencyKey) { const error = new Error("Idempotency-Key is required."); error.statusCode = 400; throw error; }
  const existing = await Contribution.findOne({ parent: userId, idempotencyKey }).populate("plan child");
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
      const [contribution] = await Contribution.create([{ parent: userId, child: plan.child, plan: plan._id, amount: value, type: "CONTRIBUTION", status: "SUCCESS", reference: ref, idempotencyKey, walletLedgerEntry: ledger.entry._id, transaction: transaction._id }], { session });
      await createEduLedger({ parent: userId, child: plan.child, plan: plan._id, direction: "CREDIT", type: "CONTRIBUTION", amount: value, openingBalance: saved, reference: `${ref}-SAVINGS`, idempotencyKey: `${idempotencyKey}-savings`, source: "WALLET", session });
      output = contribution;
    });
  } finally { await session.endSession(); }
  await notify(userId, "EduPay savings received", "Your EduPay school-fee savings contribution was successful.", output?._id);
  return { contribution: output, duplicate: false };
}

async function repayFromWallet({ userId, repaymentId, amount, transactionPin, idempotencyKey }) {
  ensureObjectId(repaymentId, "Repayment"); const value = round(amount);
  if (!(value > 0) || !idempotencyKey) { const error = new Error("A valid amount and Idempotency-Key are required."); error.statusCode = 400; throw error; }
  const existing = await EduPayRepaymentTransaction.findOne({ parent: userId, idempotencyKey });
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
      const [transaction] = await EduPayRepaymentTransaction.create([{ repayment: repayment._id, parent: userId, amount: value, reference: ref, idempotencyKey, walletLedgerEntry: ledger.entry._id }], { session });
      const paid = round(repayment.amountPaid + value);
      await EduPayRepayment.updateOne({ _id: repayment._id }, { $set: { amountPaid: paid, amountRemaining: round(repayment.totalAmount - paid), status: paid >= repayment.totalAmount ? "PAID" : "PARTIALLY_PAID" } }, { session });
      result = transaction;
    });
  } finally { await session.endSession(); }
  await notify(userId, "EduPay repayment received", "Your EduPay repayment was received.", result?._id);
  return { transaction: result, duplicate: false };
}

module.exports = {
  getSettings, audit, notify, round, reference, hash, ensureObjectId, calculateSettlement, availableSavings,
  contributeFromWallet, repayFromWallet, createEduLedger,
  models: { User, School, Child, Plan, Contribution, EduLedger, Fee, Settlement, EduPayRepayment, EduPayRepaymentTransaction, EduPaySponsorInvite, EduPaySponsorContribution },
};