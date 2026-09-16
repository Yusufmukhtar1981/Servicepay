const crypto = require("crypto");
const axios = require("axios");
const mongoose = require("mongoose");
const Settlement = require("../models/edupaySettlement.model");
const Account = require("../models/edupaySettlementAccount.model");
const Evidence = require("../models/edupayPayoutEvidence.model");
const Transaction = require("../models/transaction.model");
const Plan = require("../models/edupayPlan.model");
const { EduPayRepayment } = require("../models/edupayRepayment.model");
const { createEduLedger, availableSavings, getSettings, audit, reverseSettlement, reference, round } = require("./edupay.service");
const Commission = require("../models/edupayCommission.model");

const fail = (message, status = 400, code) => Object.assign(new Error(message), { statusCode: status, code });
const providerConfig = () => {
  const enabled = String(process.env.EDUPAY_SQUAD_TRANSFER_ENABLED || "").toLowerCase() === "true";
  const production = String(process.env.EDUPAY_SQUAD_PRODUCTION_ENABLED || "").toLowerCase() === "true";
  const secret = String(process.env.EDUPAY_SQUAD_SECRET_KEY || process.env.SQUAD_SECRET_KEY || "").trim();
  const merchant = String(process.env.EDUPAY_SQUAD_MERCHANT_ID || process.env.SQUAD_MERCHANT_ID || "").trim();
  const baseUrl = String(process.env.EDUPAY_SQUAD_BASE_URL || process.env.SQUAD_BASE_URL || "").replace(/\/+$/, "");
  if (!enabled || !production || !secret || !merchant || !/^https:\/\/(?!.*(?:sandbox|api-d\.))/i.test(baseUrl)) throw fail("EduPay Squad payout configuration is not production-ready.", 503, "CONFIGURATION_REQUIRED");
  return { secret, merchant, baseUrl };
};
const encryptionKey = () => crypto.createHash("sha256").update(String(process.env.EDUPAY_ACCOUNT_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY || "").trim()).digest();
const encryptAccount = (value) => {
  if (!String(process.env.EDUPAY_ACCOUNT_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY || "").trim()) throw fail("EduPay account encryption configuration is required.", 503, "CONFIGURATION_REQUIRED");
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv); const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return `${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${encrypted.toString("base64")}`;
};
const decryptAccount = (value) => { const [iv, tag, encrypted] = String(value).split("."); const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64")); decipher.setAuthTag(Buffer.from(tag, "base64")); return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64")), decipher.final()]).toString("utf8"); };
const digest = (raw) => crypto.createHash("sha256").update(raw).digest("hex");
const timingSafe = (raw, signature, secret) => {
  const expected = crypto.createHmac("sha512", secret).update(raw).digest("hex");
  const actual = String(signature || "").trim().toLowerCase();
  return /^[a-f0-9]{128}$/.test(actual) && crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex"));
};
const normalized = (payload) => {
  const data = payload?.data || payload;
  const status = String(data?.status || data?.event || payload?.event || "").toUpperCase();
  return { reference: String(data?.transaction_reference || data?.reference || payload?.reference || "").trim(), providerId: String(data?.id || data?.transaction_id || "").trim() || null, status: status.includes("REVER") ? "REVERSED" : status.includes("SUCCESS") || status.includes("COMPLET") ? "SUCCESSFUL" : "PENDING_REVIEW", amount: Number(data?.amount ?? payload?.amount), currency: String(data?.currency || data?.currency_id || payload?.currency || "NGN").toUpperCase(), eventType: String(payload?.event || data?.event || status || "PAYOUT_UPDATE").toUpperCase() };
};
async function saveAccount({ schoolId, accountName, bankName, bankCode, accountNumber, actor, verified = false }) {
  if (!/^\d{10}$/.test(String(accountNumber))) throw fail("A valid ten-digit settlement account is required.", 400);
  return Account.findOneAndUpdate({ school: schoolId }, { $set: { accountName, bankName, bankCode, encryptedAccountNumber: encryptAccount(accountNumber), accountNumberLast4: String(accountNumber).slice(-4), verified, active: verified, verifiedBy: verified ? actor : null, verifiedAt: verified ? new Date() : null, updatedBy: actor } }, { upsert: true, new: true, runValidators: true });
}
async function finalizeEvidence(evidenceId, actor, req, session) {
  const evidence = await Evidence.findById(evidenceId).session(session); const settlement = await Settlement.findById(evidence.settlement).session(session);
  if (!settlement || settlement.status === "SETTLED") return settlement;
  if (evidence.normalizedStatus !== "SUCCESSFUL" || evidence.amount !== Math.round(settlement.schoolNetSettlement * 100) || evidence.currency !== "NGN") throw fail("Payout evidence does not match the frozen settlement.", 409);
  const [transaction] = await Transaction.create([{ reference: evidence.providerReference, customerId: settlement.parent, serviceType: "EDUPAY", amount: settlement.schoolNetSettlement, status: "SUCCESSFUL", provider: "SQUAD", providerResponse: { edupaySettlementId: String(settlement._id), evidenceId: String(evidence._id), schoolNetSettlement: settlement.schoolNetSettlement } }], { session });
  await Evidence.updateOne({ _id: evidence._id }, { $set: { coreTransaction: transaction._id } }, { session });
  const saved = await availableSavings(settlement.plan, session); if (saved < settlement.parentSavedAmount) throw fail("Eligible savings are insufficient for payout finalization.", 409);
  if (settlement.parentSavedAmount > 0) await createEduLedger({ parent: settlement.parent, child: settlement.child, plan: settlement.plan, direction: "DEBIT", type: "SETTLEMENT_DEBIT", amount: settlement.parentSavedAmount, openingBalance: saved, reference: `${settlement.reference}-SAVINGS-DEBIT`, idempotencyKey: `${settlement.idempotencyKey}-savings-debit`, source: "SETTLEMENT", session });
  if (settlement.schoolCommissionAmount > 0) await Commission.create([{ settlement: settlement._id, school: settlement.school, amount: settlement.schoolCommissionAmount, direction: settlement.commissionMethod === "GROSS_AND_RECEIVABLE" ? "RECEIVABLE" : "WITHHELD", reference: `${settlement.reference}-COMMISSION`, createdBy: actor }], { session });
  const settings = await getSettings(session);
  if (settlement.servicepayFundedPrincipal > 0) await EduPayRepayment.create([{ parent: settlement.parent, child: settlement.child, plan: settlement.plan, settlement: settlement._id, principal: settlement.servicepayFundedPrincipal, serviceCharge: settlement.parentChargeAmount, totalAmount: settlement.parentTotalRepayment, amountRemaining: settlement.parentTotalRepayment, dueDate: new Date(Date.now() + (settings.defaultRepaymentPeriodDays + settings.gracePeriodDays) * 86400000) }], { session });
  await Settlement.updateOne({ _id: settlement._id, status: { $in: ["PROCESSING", "PENDING_REVIEW"] } }, { $set: { status: "SETTLED", providerReference: evidence.providerReference, provider: "SQUAD", confirmedBy: actor, confirmedAt: new Date() } }, { session });
  await Plan.updateOne({ _id: settlement.plan }, { $set: { status: "SETTLED" } }, { session });
  await audit({ actor: actor || settlement.parent, action: "EDUPAY_SQUAD_PAYOUT_SUCCESS", entityType: "EduPayPayoutEvidence", entityId: evidence._id, school: settlement.school, metadata: { source: "SQUAD_VERIFIED_PROVIDER" }, req, session });
  return Settlement.findById(settlement._id).session(session);
}
async function recordProviderEvidence({ settlement, payload, source, raw, actor, req }) {
  const data = normalized(payload); if (!data.reference || !["SUCCESSFUL", "REVERSED", "PENDING_REVIEW"].includes(data.status)) throw fail("Provider evidence is incomplete or not final.", 409);
  if (String(data.reference) !== String(settlement.providerReference)) throw fail("Provider reference does not match the persisted settlement reference.", 409, "REFERENCE_MISMATCH");
  if (data.amount !== Math.round(settlement.schoolNetSettlement * 100) || data.currency !== "NGN") throw fail("Provider evidence amount/currency does not match settlement.", 409);
  const eventDigest = digest(raw); const prior = await Evidence.findOne({ settlement: settlement._id, payloadDigest: eventDigest }); if (prior) return Settlement.findById(settlement._id);
  const session = await mongoose.startSession(); let output; let reversalTransaction; let reversalEvidence;
  try { await session.withTransaction(async () => {
    const current = await Settlement.findById(settlement._id).session(session); if (!current || !["PROCESSING", "PENDING_REVIEW", "SETTLED"].includes(current.status)) throw fail("Settlement is not awaiting provider evidence.", 409);
    const [evidence] = await Evidence.create([{ settlement: current._id, providerReference: data.reference, providerId: data.providerId, normalizedStatus: data.status, amount: data.amount, currency: data.currency, eventType: data.eventType, payloadDigest: eventDigest, source }], { session });
    reversalEvidence = evidence;
    if (data.status === "SUCCESSFUL") output = await finalizeEvidence(evidence._id, actor, req, session);
    else if (data.status === "REVERSED") {
      [reversalTransaction] = await Transaction.create([{ reference: `REV-${data.reference}`, customerId: current.parent, serviceType: "EDUPAY", amount: current.schoolNetSettlement, status: "SUCCESSFUL", provider: "SQUAD", providerResponse: { edupaySettlementId: String(current._id), reversal: true, evidenceId: String(evidence._id) } }], { session });
      await Evidence.updateOne({ _id: evidence._id }, { $set: { coreTransaction: reversalTransaction._id } }, { session });
    }
  }); } finally { await session.endSession(); }
  if (data.status === "REVERSED" && reversalTransaction) await reverseSettlement({ settlementId: settlement._id, actor, transactionId: reversalTransaction._id, providerReference: reversalTransaction.reference, evidenceId: reversalEvidence._id, idempotencyKey: `squad-reversal-${eventDigest}`, req });
  return output || Settlement.findById(settlement._id);
}
async function processSettlement({ settlementId, actor, req }) {
  const cfg = providerConfig(); const account = await Account.findOne({ school: (await Settlement.findById(settlementId)).school, active: true, verified: true }).select("+encryptedAccountNumber");
  if (!account) throw fail("A verified EduPay settlement account is required.", 409);
  const session = await mongoose.startSession(); let settlement;
  try { await session.withTransaction(async () => {
    const current = await Settlement.findOne({ _id: settlementId, status: "APPROVED" }).session(session); if (!current) throw fail("Settlement must be APPROVED before PROCESS.", 409);
    if (new Date(current.settlementDate) > new Date()) throw fail("Settlement date has not arrived.", 409);
    const providerReference = `EDUPAY-${current.reference}`;
    const cas = await Settlement.updateOne({ _id: current._id, status: "APPROVED" }, { $set: { status: "PROCESSING", provider: "SQUAD", providerReference, beneficiaryAccountSnapshot: { accountName: account.accountName, bankName: account.bankName, bankCode: account.bankCode, accountNumberLast4: account.accountNumberLast4 } } }, { session }); if (!cas.modifiedCount) throw fail("Settlement is already being processed.", 409);
    settlement = { ...current.toObject(), providerReference };
  }); } finally { await session.endSession(); }
  try {
    const response = await axios.post(`${cfg.baseUrl}/payout/transfer`, { remark: "EduPay school settlement", bank_code: account.bankCode, currency_id: "NGN", amount: String(Math.round(settlement.schoolNetSettlement * 100)), account_number: decryptAccount(account.encryptedAccountNumber), account_name: account.accountName, transaction_reference: settlement.providerReference }, { timeout: 45000, headers: { Authorization: `Bearer ${cfg.secret}`, "Content-Type": "application/json" }, validateStatus: () => true });
    const data = normalized(response.data); if (data.status === "SUCCESSFUL") return recordProviderEvidence({ settlement: await Settlement.findById(settlementId), payload: response.data, source: "REQUERY", raw: JSON.stringify(response.data), actor, req });
    await Settlement.updateOne({ _id: settlementId, status: "PROCESSING" }, { $set: { status: "PENDING_REVIEW" } }); return Settlement.findById(settlementId);
  } catch (error) { if (error.code === "CONFIGURATION_REQUIRED" || error.code === "REFERENCE_MISMATCH") throw error; await Settlement.updateOne({ _id: settlementId, status: "PROCESSING" }, { $set: { status: "PENDING_REVIEW" } }); return Settlement.findById(settlementId); }
}
async function requerySettlement({ settlementId, actor, req }) {
  const cfg = providerConfig(); const settlement = await Settlement.findOneAndUpdate({ _id: settlementId, status: { $in: ["PROCESSING", "PENDING_REVIEW"] } }, { $set: { requeryLeaseUntil: new Date(Date.now() + 60000) } }, { new: true }); if (!settlement) throw fail("Settlement is not eligible for requery.", 409);
  try { const response = await axios.post(`${cfg.baseUrl}/payout/requery`, { transaction_reference: settlement.providerReference }, { timeout: 45000, headers: { Authorization: `Bearer ${cfg.secret}` }, validateStatus: () => true }); const state = normalized(response.data); if (state.status === "PENDING_REVIEW") { await Settlement.updateOne({ _id: settlementId }, { $set: { status: "PENDING_REVIEW" } }); return Settlement.findById(settlementId); } return recordProviderEvidence({ settlement, payload: response.data, source: "REQUERY", raw: JSON.stringify(response.data), actor, req }); } finally { await Settlement.updateOne({ _id: settlementId }, { $unset: { requeryLeaseUntil: 1 } }); }
}
async function handleWebhook({ payload, raw, signature, actor, req }) {
  const secret = String(process.env.EDUPAY_SQUAD_WEBHOOK_SECRET || process.env.ORG_SQUAD_WEBHOOK_SECRET || process.env.SQUAD_WEBHOOK_SECRET || "").trim(); if (!secret || !timingSafe(raw, signature, secret)) throw fail("Invalid EduPay Squad webhook signature.", 401);
  const data = normalized(payload); const settlement = await Settlement.findOne({ providerReference: data.reference }); if (!settlement) throw fail("Provider reference does not match a persisted EduPay settlement.", 409, "REFERENCE_MISMATCH");
  return recordProviderEvidence({ settlement, payload, source: "WEBHOOK", raw, actor, req });
}
module.exports = { providerConfig, encryptAccount, saveAccount, processSettlement, requerySettlement, handleWebhook, recordProviderEvidence, timingSafe, normalized };