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
const AccountVerificationEvidence = require("../models/edupayAccountVerificationEvidence.model");
const School = require("../models/edupaySchool.model");

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
  const session = await mongoose.startSession(); let account;
  try { await session.withTransaction(async () => {
    const previous = await Account.findOne({ school: schoolId }).sort({ version: -1 }).session(session);
    [account] = await Account.create([{ school: schoolId, accountName, bankName, bankCode, encryptedAccountNumber: encryptAccount(accountNumber), accountNumberLast4: String(accountNumber).slice(-4), verified: false, active: false, submittedBy: actor, updatedBy: actor, version: Number(previous?.version || 0) + 1, previousVersion: previous?._id || null }], { session });
    const pointer = await School.updateOne({ _id: schoolId, "edupayPayoutLock.settlement": null }, { $set: { currentSettlementAccountId: account._id, currentSettlementAccountVersion: account.version } }, { session });
    if (!pointer.matchedCount) throw fail("A school payout is unresolved; account replacement is locked.", 409, "PAYOUT_LOCKED");
  }); } finally { await session.endSession(); }
  return account;
}
async function verifyAccount({ schoolId, actor, accountId, version }) {
  const cfg = providerConfig(); const filter = { school: schoolId }; if (accountId) filter._id = accountId; else if (version !== undefined) filter.version = Number(version);
  const account = await Account.findOne(filter).sort({ version: -1 }).select("+encryptedAccountNumber");
  if (!account) throw fail("Settlement account not found.", 404);
  const latest = await Account.findOne({ school: schoolId }).sort({ version: -1 }).select("_id version");
  if (!latest || String(latest._id) !== String(account._id)) throw fail("Only the current settlement-account version may be verified.", 409, "STALE_ACCOUNT_VERSION");
  if (String(account.submittedBy) === String(actor)) throw fail("Account verifier must be distinct from the account submitter.", 409, "SEPARATION_OF_DUTIES_REQUIRED");
  const accountNumber = decryptAccount(account.encryptedAccountNumber);
  const response = await axios.post(`${cfg.baseUrl}/payout/account/lookup`, { bank_code: String(account.bankCode), account_number: accountNumber }, { timeout: 45000, headers: { Authorization: `Bearer ${cfg.secret}`, "Content-Type": "application/json" }, validateStatus: () => true });
  const data = response.data?.data || response.data || {};
  const returnedNumber = String(data.account_number || data.accountNumber || "").replace(/\D/g, "");
  const canonicalName = String(data.account_name || data.accountName || data.name || "").trim();
  if (response.status < 200 || response.status >= 300 || !canonicalName || returnedNumber !== accountNumber) throw fail("Squad account verification did not match the submitted account.", 422, "ACCOUNT_VERIFICATION_MISMATCH");
  const raw = JSON.stringify(response.data); const verificationVersion = (await AccountVerificationEvidence.findOne({ account: account._id }).sort({ verificationVersion: -1 }).select("verificationVersion"))?.verificationVersion || 0;
  const session = await mongoose.startSession(); let evidence;
  try { await session.withTransaction(async () => {
    [evidence] = await AccountVerificationEvidence.create([{ account: account._id, provider: "SQUAD", bankCode: account.bankCode, maskedAccount: `****${account.accountNumberLast4}`, canonicalAccountName: canonicalName, responseDigest: digest(raw), providerReference: String(data.id || data.reference || digest(raw)), verificationVersion: verificationVersion + 1, verifiedBy: actor }], { session });
    await Account.updateOne({ _id: account._id }, { $set: { canonicalAccountName: canonicalName, verified: true, active: true, verifiedBy: actor, verifiedAt: new Date(), updatedBy: actor } }, { session });
  }); } finally { await session.endSession(); }
  const verifiedAccount = await Account.findById(account._id); const responseAccount = verifiedAccount.toObject(); responseAccount.accountName = canonicalName;
  return { account: responseAccount, evidence };
}
async function finalizeEvidence(evidenceId, actor, req, session, actorType = "USER") {
  const evidence = await Evidence.findById(evidenceId).session(session); const settlement = await Settlement.findById(evidence.settlement).session(session);
  if (!settlement || settlement.status === "SETTLED") return settlement;
  if (evidence.normalizedStatus !== "SUCCESSFUL" || evidence.amount !== Math.round(settlement.schoolNetSettlement * 100) || evidence.currency !== "NGN") throw fail("Payout evidence does not match the frozen settlement.", 409);
  const [transaction] = await Transaction.create([{ reference: evidence.providerReference, customerId: settlement.parent, serviceType: "EDUPAY", amount: settlement.schoolNetSettlement, status: "SUCCESSFUL", provider: "SQUAD", providerResponse: { edupaySettlementId: String(settlement._id), evidenceId: String(evidence._id), schoolNetSettlement: settlement.schoolNetSettlement } }], { session });
  await Evidence.updateOne({ _id: evidence._id }, { $set: { coreTransaction: transaction._id } }, { session });
  const saved = await availableSavings(settlement.plan, session); if (saved < settlement.parentSavedAmount) throw fail("Eligible savings are insufficient for payout finalization.", 409);
  if (settlement.parentSavedAmount > 0) await createEduLedger({ parent: settlement.parent, child: settlement.child, plan: settlement.plan, direction: "DEBIT", type: "SETTLEMENT_DEBIT", amount: settlement.parentSavedAmount, openingBalance: saved, reference: `${settlement.reference}-SAVINGS-DEBIT`, idempotencyKey: `${settlement.idempotencyKey}-savings-debit`, source: "SETTLEMENT", session });
  if (settlement.schoolCommissionAmount > 0) await Commission.create([{ settlement: settlement._id, school: settlement.school, amount: settlement.schoolCommissionAmount, direction: settlement.commissionMethod === "GROSS_AND_RECEIVABLE" ? "RECEIVABLE" : "WITHHELD", reference: `${settlement.reference}-COMMISSION`, createdBy: actor || null, actor: actor || null, actorType, actorLabel: actorType === "PROVIDER" ? "SQUAD_WEBHOOK" : null }], { session });
  const settings = await getSettings(session);
  if (settlement.servicepayFundedPrincipal > 0) await EduPayRepayment.create([{ parent: settlement.parent, child: settlement.child, plan: settlement.plan, settlement: settlement._id, principal: settlement.servicepayFundedPrincipal, serviceCharge: settlement.parentChargeAmount, totalAmount: settlement.parentTotalRepayment, amountRemaining: settlement.parentTotalRepayment, dueDate: new Date(Date.now() + (settings.defaultRepaymentPeriodDays + settings.gracePeriodDays) * 86400000) }], { session });
  await Settlement.updateOne({ _id: settlement._id, status: { $in: ["PROCESSING", "PENDING_REVIEW"] } }, { $set: { status: "SETTLED", providerReference: evidence.providerReference, provider: "SQUAD", confirmedBy: actor, confirmedAt: new Date() } }, { session });
  await School.updateOne({ _id: settlement.school, "edupayPayoutLock.settlement": settlement._id }, { $set: { "edupayPayoutLock.settlement": null, "edupayPayoutLock.acquiredAt": null } }, { session });
  await Plan.updateOne({ _id: settlement.plan }, { $set: { status: "SETTLED" } }, { session });
  await audit({ actor: actor || null, actorType, actorLabel: actorType === "PROVIDER" ? "SQUAD_WEBHOOK" : null, action: "EDUPAY_SQUAD_PAYOUT_SUCCESS", entityType: "EduPayPayoutEvidence", entityId: evidence._id, school: settlement.school, metadata: { source: "SQUAD_VERIFIED_PROVIDER" }, req, session });
  return Settlement.findById(settlement._id).session(session);
}
async function recordProviderEvidence({ settlement, payload, source, raw, actor, req }) {
  const data = normalized(payload); if (!data.reference || !["SUCCESSFUL", "REVERSED", "PENDING_REVIEW"].includes(data.status)) throw fail("Provider evidence is incomplete or not final.", 409);
  if (String(data.reference) !== String(settlement.providerReference)) throw fail("Provider reference does not match the persisted settlement reference.", 409, "REFERENCE_MISMATCH");
  if (data.amount !== Math.round(settlement.schoolNetSettlement * 100) || data.currency !== "NGN") throw fail("Provider evidence amount/currency does not match settlement.", 409);
  const eventDigest = digest(raw); const prior = await Evidence.findOne({ settlement: settlement._id, payloadDigest: eventDigest });
  const providerActor = actor || null;
  if (prior) {
    const current = await Settlement.findById(settlement._id);
    if (data.status === "REVERSED" && current?.status !== "REVERSED") {
      const transaction = await Transaction.findById(prior.coreTransaction);
      if (transaction) await reverseSettlement({ settlementId: settlement._id, actor: providerActor, actorType: "PROVIDER", transactionId: transaction._id, providerReference: transaction.reference, evidenceId: prior._id, idempotencyKey: `squad-reversal-${eventDigest}`, req });
    }
    return Settlement.findById(settlement._id);
  }
  const session = await mongoose.startSession(); let output; let reversalTransaction; let reversalEvidence;
  try { await session.withTransaction(async () => {
    const current = await Settlement.findById(settlement._id).session(session); if (!current || !["PROCESSING", "PENDING_REVIEW", "SETTLED"].includes(current.status)) throw fail("Settlement is not awaiting provider evidence.", 409);
    const [evidence] = await Evidence.create([{ settlement: current._id, providerReference: data.reference, providerId: data.providerId, normalizedStatus: data.status, amount: data.amount, currency: data.currency, eventType: data.eventType, payloadDigest: eventDigest, source }], { session });
    reversalEvidence = evidence;
    if (data.status === "SUCCESSFUL") output = await finalizeEvidence(evidence._id, actor, req, session, actor ? "USER" : "PROVIDER");
    else if (data.status === "REVERSED") {
      [reversalTransaction] = await Transaction.create([{ reference: `REV-${data.reference}`, customerId: current.parent, serviceType: "EDUPAY", amount: current.schoolNetSettlement, status: "SUCCESSFUL", provider: "SQUAD", providerResponse: { edupaySettlementId: String(current._id), reversal: true, evidenceId: String(evidence._id) } }], { session });
      await Evidence.updateOne({ _id: evidence._id }, { $set: { coreTransaction: reversalTransaction._id } }, { session });
    }
  }); } finally { await session.endSession(); }
  if (data.status === "REVERSED" && reversalTransaction) await reverseSettlement({ settlementId: settlement._id, actor: providerActor, actorType: "PROVIDER", transactionId: reversalTransaction._id, providerReference: reversalTransaction.reference, evidenceId: reversalEvidence._id, idempotencyKey: `squad-reversal-${eventDigest}`, req });
  return output || Settlement.findById(settlement._id);
}
async function processSettlement({ settlementId, actor, req }) {
  const cfg = providerConfig(); const settlementRecord = await Settlement.findById(settlementId); const school = await School.findById(settlementRecord?.school).lean(); const account = school?.currentSettlementAccountId ? await Account.findOne({ _id: school.currentSettlementAccountId, school: settlementRecord?.school }).select("+encryptedAccountNumber") : null;
  if (!settlementRecord) throw fail("Settlement not found.", 404);
  if (String(settlementRecord.approvedBy) === String(actor)) throw fail("Settlement processor must be distinct from the approver.", 409, "SEPARATION_OF_DUTIES_REQUIRED");
  if (!account || !account.active || !account.verified) throw fail("A current verified EduPay settlement account is required.", 409);
  const verification = await AccountVerificationEvidence.findOne({ account: account._id }).sort({ verificationVersion: -1 });
  if (!verification || String(verification.canonicalAccountName) !== String(account.canonicalAccountName)) throw fail("A latest verified Squad settlement-account evidence record is required.", 409, "ACCOUNT_VERIFICATION_REQUIRED");
  if (String(account.submittedBy) === String(actor) || String(verification.verifiedBy) === String(actor)) throw fail("Settlement processor must be distinct from account submitter and verifier.", 409, "SEPARATION_OF_DUTIES_REQUIRED");
  const session = await mongoose.startSession(); let settlement;
  try { await session.withTransaction(async () => {
    const current = await Settlement.findOne({ _id: settlementId, status: "APPROVED" }).session(session); if (!current) throw fail("Settlement must be APPROVED before PROCESS.", 409);
    const currentSchool = await School.findOne({ _id: current.school, currentSettlementAccountId: account._id, currentSettlementAccountVersion: account.version, "edupayPayoutLock.settlement": null }).session(session); if (!currentSchool) throw fail("Settlement account changed or school payout is locked.", 409, "ACCOUNT_BINDING_CONFLICT");
    if (new Date(current.settlementDate) > new Date()) throw fail("Settlement date has not arrived.", 409);
    const providerReference = `EDUPAY-${current.reference}`;
    const cas = await Settlement.updateOne({ _id: current._id, status: "APPROVED", payoutAccountId: null }, { $set: { status: "PROCESSING", provider: "SQUAD", providerReference, payoutAccountId: account._id, payoutAccountVersion: account.version, payoutVerificationEvidenceId: verification._id, beneficiaryAccountSnapshot: { accountName: account.canonicalAccountName, bankName: account.bankName, bankCode: account.bankCode, accountNumberLast4: account.accountNumberLast4 } } }, { session }); if (!cas.modifiedCount) throw fail("Settlement is already being processed.", 409);
    const lock = await School.updateOne({ _id: current.school, currentSettlementAccountId: account._id, currentSettlementAccountVersion: account.version, "edupayPayoutLock.settlement": null }, { $set: { "edupayPayoutLock.settlement": current._id, "edupayPayoutLock.acquiredAt": new Date() } }, { session }); if (!lock.modifiedCount) throw fail("School payout is already locked.", 409, "PAYOUT_LOCKED");
    settlement = { ...current.toObject(), providerReference };
  }); } finally { await session.endSession(); }
  try {
    const response = await axios.post(`${cfg.baseUrl}/payout/transfer`, { remark: "EduPay school settlement", bank_code: account.bankCode, currency_id: "NGN", amount: String(Math.round(settlement.schoolNetSettlement * 100)), account_number: decryptAccount(account.encryptedAccountNumber), account_name: account.canonicalAccountName, transaction_reference: settlement.providerReference }, { timeout: 45000, headers: { Authorization: `Bearer ${cfg.secret}`, "Content-Type": "application/json" }, validateStatus: () => true });
    const data = normalized(response.data); if (data.status === "SUCCESSFUL") return recordProviderEvidence({ settlement: await Settlement.findById(settlementId), payload: response.data, source: "REQUERY", raw: JSON.stringify(response.data), actor, req }); if (data.status === "FAILED") { await Settlement.updateOne({ _id: settlementId, status: "PROCESSING" }, { $set: { status: "FAILED", failureReason: "Squad rejected payout." } }); await School.updateOne({ _id: settlement.school, "edupayPayoutLock.settlement": settlement._id }, { $set: { "edupayPayoutLock.settlement": null, "edupayPayoutLock.acquiredAt": null } }); return Settlement.findById(settlementId); }
    await Settlement.updateOne({ _id: settlementId, status: "PROCESSING" }, { $set: { status: "PENDING_REVIEW" } }); return Settlement.findById(settlementId);
  } catch (error) { if (error.code === "CONFIGURATION_REQUIRED" || error.code === "REFERENCE_MISMATCH") throw error; await Settlement.updateOne({ _id: settlementId, status: "PROCESSING" }, { $set: { status: "PENDING_REVIEW" } }); return Settlement.findById(settlementId); }
}
async function requerySettlement({ settlementId, actor, req }) {
  const cfg = providerConfig(); const settlement = await Settlement.findOneAndUpdate({ _id: settlementId, status: { $in: ["PROCESSING", "PENDING_REVIEW"] } }, { $set: { requeryLeaseUntil: new Date(Date.now() + 60000) } }, { new: true }); if (!settlement) throw fail("Settlement is not eligible for requery.", 409);
  if (!settlement.payoutAccountId || !settlement.payoutAccountVersion || !settlement.payoutVerificationEvidenceId) throw fail("Settlement payout account binding is missing.", 409, "ACCOUNT_BINDING_REQUIRED");
  try { const response = await axios.post(`${cfg.baseUrl}/payout/requery`, { transaction_reference: settlement.providerReference }, { timeout: 45000, headers: { Authorization: `Bearer ${cfg.secret}` }, validateStatus: () => true }); const state = normalized(response.data); if (state.status === "PENDING_REVIEW") { await Settlement.updateOne({ _id: settlementId }, { $set: { status: "PENDING_REVIEW" } }); return Settlement.findById(settlementId); } return recordProviderEvidence({ settlement, payload: response.data, source: "REQUERY", raw: JSON.stringify(response.data), actor, req }); } finally { await Settlement.updateOne({ _id: settlementId }, { $unset: { requeryLeaseUntil: 1 } }); }
}
async function handleWebhook({ payload, raw, signature, actor, req }) {
  const secret = String(process.env.EDUPAY_SQUAD_WEBHOOK_SECRET || process.env.ORG_SQUAD_WEBHOOK_SECRET || process.env.SQUAD_WEBHOOK_SECRET || "").trim(); if (!secret || !timingSafe(raw, signature, secret)) throw fail("Invalid EduPay Squad webhook signature.", 401);
  const data = normalized(payload); const settlement = await Settlement.findOne({ providerReference: data.reference }); if (!settlement) throw fail("Provider reference does not match a persisted EduPay settlement.", 409, "REFERENCE_MISMATCH");
  return recordProviderEvidence({ settlement, payload, source: "WEBHOOK", raw, actor, req });
}
module.exports = { providerConfig, encryptAccount, saveAccount, verifyAccount, processSettlement, requerySettlement, handleWebhook, recordProviderEvidence, timingSafe, normalized };