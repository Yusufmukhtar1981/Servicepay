const crypto = require("crypto");
const mongoose = require("mongoose");
const axios = require("axios");
const models = require("../models/organizations.models");
const { verifyTransactionPin } = require("./transactionPin.service");
const base = require("./organizations.service");

const { Organization, OrganizationRole, OrganizationWallet, OrganizationLedger,
  OrganizationSettlementAccount, OrganizationWithdrawal, OrganizationTreasuryConfig,
  OrganizationWithdrawalSnapshot } = models;
const money = (v) => base.normalizeMoney(v);
const error = (message, status = 400, code) => Object.assign(new Error(message), { status, code });
const ref = () => `ORGWD-${Date.now()}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
const idempotency = (req) => String(req.get("X-Idempotency-Key") || req.get("Idempotency-Key") || req.body?.idempotencyKey || "").trim();

async function config(org, session) {
  let q = OrganizationTreasuryConfig.findOne({ organization: org._id });
  if (session) q = q.session(session);
  return (await q) || new OrganizationTreasuryConfig({ organization: org._id });
}
async function role(req, org, permission) {
  const rows = await OrganizationRole.find({ organization: org._id, user: req.user._id, active: true });
  return rows.length === 1 && base.roleAllows(rows[0].role, permission, rows[0].permissions) ? rows[0] : null;
}
async function assertMode(req, org, mode, action) {
  const own = await role(req, org, action === "approve" ? "treasury.approve" : "wallet.withdraw");
  if (!own) throw error("Treasury permission is required.", 403);
  if (action === "approve" && !(await role(req, org, "treasury.approve"))) throw error("Treasury approval permission is required.", 403);
  if (action === "approve" && mode === "ADMIN_REVIEW") throw error("This withdrawal requires Head Office review.", 403);
  if (mode === "OWNER_ONLY" && own.role !== "OWNER") throw error("Only the organization owner may authorize this withdrawal.", 403);
  if (mode === "OWNER_AND_TREASURER" && !["OWNER", "TREASURER"].includes(String(own.role))) throw error("Owner or treasurer authorization is required.", 403);
  return own;
}
async function snapshot(withdrawal, event, fromStatus, toStatus, actor, metadata = {}, session) {
  await OrganizationWithdrawalSnapshot.create([{ withdrawal: withdrawal._id, organization: withdrawal.organization, event, fromStatus, toStatus, actor, metadata }], session ? { session } : undefined);
}
async function notify(req, withdrawal, title, message) {
  try {
    const { createInAppNotification } = require("./inAppNotification.service");
    const users = await OrganizationRole.find({ organization: withdrawal.organization, active: true, role: { $in: ["OWNER", "TREASURER", "ADMIN"] } }).distinct("user");
    await Promise.allSettled(users.map((userId) => createInAppNotification({ userId, title, message, type: "WITHDRAWAL", referenceId: withdrawal._id, referenceType: "ORGANIZATION_WITHDRAWAL", dedupeKey: `org-withdrawal:${withdrawal._id}:${title}` })));
  } catch (_) { /* notification failure must not alter a financial state */ }
}

// Dedicated adapter: no customer transfer records or customer wallet are touched.
async function resolveAccount({ bankCode, accountNumber }) {
  const secret = String(process.env.SQUAD_SECRET_KEY || "").trim();
  const baseUrl = String(process.env.SQUAD_BASE_URL || "https://api-d.squadco.com").replace(/\/+$/, "");
  if (!secret || !String(process.env.SQUAD_MERCHANT_ID || "").trim()) throw error("Settlement provider configuration is required.", 503, "CONFIGURATION_REQUIRED");
  const response = await axios.post(`${baseUrl}/payout/account/lookup`, { bank_code: String(bankCode).trim(), account_number: String(accountNumber).replace(/\D/g, "") }, { timeout: 45000, headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${secret}` }, validateStatus: () => true });
  const data = response.data?.data || {};
  if (response.status < 200 || response.status >= 300 || response.data?.success !== true || !data.account_name) throw error("Unable to verify the settlement account.", 400);
  return { accountName: String(data.account_name).trim(), accountNumber: String(data.account_number || accountNumber).replace(/\D/g, "") };
}

async function createWithdrawal(req, org) {
  const key = idempotency(req);
  if (!key || key.length > 180) throw error("Idempotency-Key is required.", 400);
  const existing = await OrganizationWithdrawal.findOne({ organization: org._id, idempotencyKey: key });
  if (existing) return { withdrawal: existing, duplicate: true };
  const amount = money(req.body.amount);
  const account = await OrganizationSettlementAccount.findOne({ _id: req.body.settlementAccountId || req.body.accountId, organization: org._id, status: "VERIFIED", $or: [{ coolingOffUntil: null }, { coolingOffUntil: { $exists: false } }, { coolingOffUntil: { $lte: new Date() } }] }).select("+accountNumber");
  if (!account) throw error("An approved settlement account is required.", 409);
  const cfg = await config(org);
  if (amount < cfg.minimumWithdrawal || amount > cfg.maximumWithdrawal) throw error("Withdrawal amount is outside the configured limits.", 400);
  await verifyTransactionPin(req.user._id, req.body.transactionPin ?? req.body.pin);
  const actor = await assertMode(req, org, cfg.authorizationMode, "initiate");
  const total = amount + Number(cfg.fee || 0);
  const status = cfg.authorizationMode === "OWNER_ONLY" ? "APPROVED" : "PENDING_APPROVAL";
  const session = await mongoose.startSession();
  let withdrawal;
  try {
    await session.withTransaction(async () => {
      const now = new Date(); const day = now.toISOString().slice(0, 10); const month = now.toISOString().slice(0, 7);
      let currentConfig = await OrganizationTreasuryConfig.findOne({ organization: org._id }).session(session);
      if (!currentConfig) currentConfig = (await OrganizationTreasuryConfig.create([{ organization: org._id, dailyPeriod: day, monthlyPeriod: month }], { session }))[0];
      if (currentConfig && (currentConfig.dailyPeriod !== day || currentConfig.monthlyPeriod !== month)) {
        const monthChanged = currentConfig.monthlyPeriod !== month;
        currentConfig.dailyPeriod = day; if (monthChanged) { currentConfig.monthlyPeriod = month; currentConfig.monthlyReserved = 0; }
        currentConfig.dailyReserved = 0; await currentConfig.save({ session });
      }
      if (currentConfig && (Number(currentConfig.dailyReserved || 0) + total > Number(currentConfig.dailyLimit || 0) || Number(currentConfig.monthlyReserved || 0) + total > Number(currentConfig.monthlyLimit || 0))) throw error("Withdrawal limit exceeded.", 409, "LIMIT_EXCEEDED");
      if (currentConfig) { currentConfig.dailyReserved = Number(currentConfig.dailyReserved || 0) + total; currentConfig.monthlyReserved = Number(currentConfig.monthlyReserved || 0) + total; await currentConfig.save({ session }); }
      const wallet = await OrganizationWallet.findOneAndUpdate({ organization: org._id, status: "ACTIVE", $expr: { $gte: [{ $subtract: ["$balance", "$heldBalance"] }, total] } }, { $inc: { heldBalance: total } }, { new: true, session });
      if (!wallet) throw error("Insufficient available organization balance.", 409, "INSUFFICIENT_BALANCE");
      const initiationApproval = cfg.authorizationMode === "OWNER_AND_TREASURER" && ["OWNER", "TREASURER"].includes(actor.role) ? [{ user: req.user._id, role: actor.role, decision: "APPROVE" }] : [];
      withdrawal = (await OrganizationWithdrawal.create([{ organization: org._id, requestedBy: req.user._id, approvals: initiationApproval, settlementAccount: account._id, amount, fee: cfg.fee, totalDebit: total, reference: ref(), idempotencyKey: key, narration: String(req.body.narration ?? req.body.purpose ?? "").trim().slice(0, 200), destinationSnapshot: { bankCode: account.bankCode, bankName: account.bankName, accountName: account.accountName, accountNumberLast4: account.accountNumberLast4 }, status, snapshot: { amount, fee: cfg.fee, totalDebit: total, authorizationMode: cfg.authorizationMode } }], { session }))[0];
      await OrganizationLedger.create([{ organization: org._id, type: "HOLD", amount: total, balanceAfter: wallet.balance, reference: `${withdrawal.reference}:HOLD`, withdrawal: withdrawal._id, narration: "Organization withdrawal hold", createdBy: req.user._id }], { session });
      await snapshot(withdrawal, "WITHDRAWAL_INITIATED", "INITIATED", status, actor.user, {}, session);
      await base.audit(req, org, "WITHDRAWAL_INITIATED", "OrganizationWithdrawal", withdrawal._id, { reference: withdrawal.reference, amount, totalDebit: total }, session);
    });
  } finally { await session.endSession(); }
  await notify(req, withdrawal, "Organization withdrawal initiated", `Withdrawal ${withdrawal.reference} is ${status.toLowerCase()}.`);
  return { withdrawal, duplicate: false };
}

async function transition(req, id, target, admin = false) {
  const query = { _id: id, status: { $in: target === "REJECTED" ? ["INITIATED", "PENDING_APPROVAL", "APPROVED"] : ["PENDING_APPROVAL", "APPROVED"] } };
  const w = await OrganizationWithdrawal.findOne(query);
  if (!w) throw error("Withdrawal is not awaiting this action.", 409);
  const org = await Organization.findOne({ _id: w.organization, status: "VERIFIED" });
  if (!org) throw error("Organization is not operational.", 409);
  const cfg = await config(org); const actorRole = await role(req, org, "treasury.approve");
  if (!admin) await assertMode(req, org, cfg.authorizationMode, "approve");
  if (admin && cfg.authorizationMode !== "ADMIN_REVIEW") throw error("Head Office review is not enabled for this organization.", 403);
  if (!admin && cfg.authorizationMode !== "OWNER_ONLY" && String(w.requestedBy) === String(req.user._id)) throw error("The requester cannot approve their own withdrawal.", 403);
  if (target === "APPROVED" && w.approvals?.some((a) => String(a.user) === String(req.user._id))) throw error("This approver has already acted on the withdrawal.", 409);
  if (!admin && target === "APPROVED" && cfg.authorizationMode === "OWNER_AND_TREASURER" && !["OWNER", "TREASURER"].includes(actorRole.role)) throw error("Owner and treasurer approval is required.", 403);
  if (!admin && target === "APPROVED" && cfg.authorizationMode === "TWO_AUTHORIZED_OFFICERS" && !["OWNER", "TREASURER", "ADMIN"].includes(actorRole.role)) throw error("Two authorized officer approvals are required.", 403);
  const session = await mongoose.startSession(); let updated;
  try { await session.withTransaction(async () => {
    const approvals = [...(w.approvals || []), { user: req.user._id, role: admin ? "HEAD_OFFICE" : actorRole.role, decision: target === "APPROVED" ? "APPROVE" : "REJECT", reason: String(req.body.reason || "").slice(0, 500) }];
    const approvalsNeeded = admin || target === "REJECTED" ? 1 : (cfg.authorizationMode === "OWNER_AND_TREASURER" || cfg.authorizationMode === "TWO_AUTHORIZED_OFFICERS" ? 2 : 1);
    const approvedRows = approvals.filter((a) => a.decision === "APPROVE");
    const approvedCount = approvedRows.length;
    const roleComplete = cfg.authorizationMode === "OWNER_AND_TREASURER"
      ? approvedRows.some((a) => a.role === "OWNER") && approvedRows.some((a) => a.role === "TREASURER")
      : cfg.authorizationMode === "TWO_AUTHORIZED_OFFICERS"
        ? new Set(approvedRows.map((a) => String(a.user))).size >= 2
        : approvedCount >= approvalsNeeded;
    const nextStatus = target === "REJECTED" ? "REJECTED" : (roleComplete ? "APPROVED" : "PENDING_APPROVAL");
    updated = await OrganizationWithdrawal.findOneAndUpdate(query, { $set: { status: nextStatus, approvals, ...(nextStatus === "APPROVED" ? { approvedBy: req.user._id } : target === "REJECTED" ? { rejectionReason: String(req.body.reason || "").slice(0, 500), holdReleasedAt: new Date() } : {}) } }, { new: true, session });
    if (!updated) throw error("Withdrawal was already processed.", 409);
    if (nextStatus === "REJECTED") {
      const wallet = await OrganizationWallet.findOneAndUpdate({ organization: org._id, heldBalance: { $gte: updated.totalDebit } }, { $inc: { heldBalance: -updated.totalDebit } }, { new: true, session });
      if (!wallet) throw error("Withdrawal hold is inconsistent.", 500);
      await OrganizationLedger.create([{ organization: org._id, type: "RELEASE", amount: updated.totalDebit, balanceAfter: wallet.balance, reference: `${updated.reference}:RELEASE`, withdrawal: updated._id, narration: "Rejected withdrawal hold release", createdBy: req.user._id }], { session });
      const period = new Date().toISOString().slice(0, 10); const month = new Date().toISOString().slice(0, 7);
      await OrganizationTreasuryConfig.updateOne({ organization: org._id, dailyPeriod: period, monthlyPeriod: month }, { $inc: { dailyReserved: -updated.totalDebit, monthlyReserved: -updated.totalDebit } }, { session });
    }
    await snapshot(updated, `WITHDRAWAL_${target}`, w.status, nextStatus, req.user._id, {}, session);
    await base.audit(req, org, `WITHDRAWAL_${target}`, "OrganizationWithdrawal", updated._id, { reference: updated.reference }, session);
  }); } finally { await session.endSession(); }
  await notify(req, updated, `Organization withdrawal ${target.toLowerCase()}`, `Withdrawal ${updated.reference} was ${target.toLowerCase()}.`);
  return updated;
}

const providerReady = () => String(process.env.ORG_SQUAD_TRANSFER_ENABLED || "").toLowerCase() === "true" &&
  String(process.env.SQUAD_TRANSFER_ENABLED || "").toLowerCase() === "true" &&
  String(process.env.SQUAD_SECRET_KEY || "").trim() && String(process.env.SQUAD_MERCHANT_ID || "").trim() &&
  /^https:\/\/(?!.*(?:sandbox|api-d\.))/i.test(String(process.env.SQUAD_BASE_URL || ""));
const providerStatus = (payload, code) => {
  const s = String(payload?.data?.status || payload?.status || payload?.event || "").toUpperCase();
  if (s.includes("SUCCESS") || s.includes("COMPLET")) return "SUCCESS";
  if (s.includes("FAIL") || s.includes("DECLIN") || s.includes("REJECT")) return "FAILED";
  if ([400, 401, 403, 404].includes(code) && ![401, 403].includes(code)) return "FAILED";
  return "PROCESSING";
};
async function finalize(withdrawal, status, reason) {
  const session = await mongoose.startSession(); let updated;
  try { await session.withTransaction(async () => {
    const current = await OrganizationWithdrawal.findOne({ _id: withdrawal._id }).session(session);
    if (!current || ["SUCCESS", "REVERSED"].includes(current.status)) return;
    if (status === "SUCCESS" && current.holdReleasedAt) {
      const wallet = await OrganizationWallet.findOneAndUpdate({ organization: current.organization, status: "ACTIVE", $expr: { $gte: [{ $subtract: ["$balance", "$heldBalance"] }, current.totalDebit] } }, { $inc: { balance: -current.totalDebit, totalWithdrawn: current.amount, totalFees: current.fee } }, { new: true, session });
      if (wallet) {
        updated = await OrganizationWithdrawal.findOneAndUpdate({ _id: current._id, status: current.status }, { $set: { status: "SUCCESS", debitFinalizedAt: new Date(), recoveryDebt: null } }, { new: true, session });
        if (updated) {
          await OrganizationLedger.create([{ organization: current.organization, type: "DEBIT", amount: current.amount, balanceAfter: wallet.balance, reference: `${current.reference}:LATE-DEBIT`, withdrawal: current._id, narration: "Late authoritative payout debit", createdBy: current.requestedBy }, ...(current.fee > 0 ? [{ organization: current.organization, type: "FEE", amount: current.fee, balanceAfter: wallet.balance, reference: `${current.reference}:LATE-FEE`, withdrawal: current._id, narration: "Late payout fee", createdBy: current.requestedBy }] : [])], { session });
          await snapshot(updated, "LATE_PAYOUT_COLLECTED", current.status, "SUCCESS", current.requestedBy, {}, session);
        }
      } else {
        await OrganizationWallet.updateOne({ organization: current.organization }, { $set: { status: "FROZEN" } }, { session });
        updated = await OrganizationWithdrawal.findOneAndUpdate({ _id: current._id, status: current.status }, { $set: { status: "PENDING_REVIEW", failureReason: "Late provider success; wallet cannot collect total debit", recoveryDebt: { amount: current.totalDebit, reason: "INSUFFICIENT_AVAILABLE_BALANCE", detectedAt: new Date() } } }, { new: true, session });
        if (updated) await snapshot(updated, "LATE_PAYOUT_UNCOLLECTIBLE", current.status, "PENDING_REVIEW", current.requestedBy, { recoveryDebt: current.totalDebit }, session);
      }
      return;
    }
    const wallet = await OrganizationWallet.findOne({ organization: current.organization }).session(session);
    if (!wallet) throw error("Organization wallet is unavailable.", 500);
    if (status === "SUCCESS") {
      updated = await OrganizationWithdrawal.findOneAndUpdate({ _id: current._id, debitFinalizedAt: null }, { $set: { status: "SUCCESS", debitFinalizedAt: new Date() }, $inc: {} }, { new: true, session });
      if (!updated) return;
      if (Number(wallet.heldBalance) < Number(current.totalDebit) || Number(wallet.balance) < Number(current.totalDebit)) throw error("Wallet accounting invariant failed.", 500, "WALLET_INCONSISTENT");
      wallet.heldBalance -= Number(current.totalDebit); wallet.totalWithdrawn = Number(wallet.totalWithdrawn || 0) + Number(current.amount); wallet.totalFees = Number(wallet.totalFees || 0) + Number(current.fee || 0); wallet.balance -= Number(current.totalDebit); await wallet.save({ session });
      await OrganizationLedger.create([{ organization: current.organization, type: "DEBIT", amount: current.amount, balanceAfter: wallet.balance, reference: `${current.reference}:DEBIT`, withdrawal: current._id, narration: "Organization withdrawal", createdBy: current.requestedBy }, { organization: current.organization, type: "FEE", amount: current.fee, balanceAfter: wallet.balance, reference: `${current.reference}:FEE`, withdrawal: current._id, narration: "Organization withdrawal fee", createdBy: current.requestedBy }].filter((x) => x.amount > 0), { session });
    } else {
      updated = await OrganizationWithdrawal.findOneAndUpdate({ _id: current._id, holdReleasedAt: null, status: { $in: ["PROCESSING", "APPROVED", "PENDING_REVIEW"] } }, { $set: { status, failureReason: reason, holdReleasedAt: new Date() } }, { new: true, session });
      if (!updated) return;
      const next = await OrganizationWallet.findOneAndUpdate({ organization: current.organization, heldBalance: { $gte: current.totalDebit } }, { $inc: { heldBalance: -current.totalDebit } }, { new: true, session }); if (!next) throw error("Withdrawal hold is inconsistent.", 500);
      await OrganizationLedger.create([{ organization: current.organization, type: "RELEASE", amount: current.totalDebit, balanceAfter: next.balance, reference: `${current.reference}:RELEASE`, withdrawal: current._id, narration: "Withdrawal hold release", createdBy: current.requestedBy }], { session });
      const now = new Date(); await OrganizationTreasuryConfig.updateOne({ organization: current.organization, dailyPeriod: now.toISOString().slice(0, 10), monthlyPeriod: now.toISOString().slice(0, 7) }, { $inc: { dailyReserved: -current.totalDebit, monthlyReserved: -current.totalDebit } }, { session });
    }
    await snapshot(updated, `PAYOUT_${status}`, current.status, status, current.requestedBy, { reason }, session);
  }); } finally { await session.endSession(); } return updated || await OrganizationWithdrawal.findById(withdrawal._id);
}
async function reverseSuccessful(withdrawalId, reason = "Provider reversal") {
  const session = await mongoose.startSession(); let updated;
  try { await session.withTransaction(async () => {
    const current = await OrganizationWithdrawal.findOne({ _id: withdrawalId, status: "SUCCESS" }).session(session);
    if (!current) return;
    updated = await OrganizationWithdrawal.findOneAndUpdate({ _id: withdrawalId, status: "SUCCESS" }, { $set: { status: "REVERSED", failureReason: reason } }, { new: true, session });
    if (!updated) return;
    const wallet = await OrganizationWallet.findOneAndUpdate({ organization: current.organization, balance: { $gte: 0 } }, { $inc: { balance: current.totalDebit, totalWithdrawn: -current.amount, totalFees: -current.fee } }, { new: true, session });
    if (!wallet) throw error("Organization wallet is unavailable.", 500);
    await OrganizationLedger.create([{ organization: current.organization, type: "CREDIT", amount: current.totalDebit, balanceAfter: wallet.balance, reference: `${current.reference}:REVERSAL`, withdrawal: current._id, narration: "Compensating credit for payout reversal", createdBy: current.requestedBy }], { session });
    await snapshot(updated, "PAYOUT_REVERSED", "SUCCESS", "REVERSED", current.requestedBy, { reason }, session);
  }); } finally { await session.endSession(); } return updated || await OrganizationWithdrawal.findById(withdrawalId);
}
async function dispatch(withdrawalId) {
  if (!providerReady()) return { withdrawal: await OrganizationWithdrawal.findById(withdrawalId), configurationRequired: true };
  const withdrawal = await OrganizationWithdrawal.findById(withdrawalId).populate({ path: "settlementAccount", select: "+accountNumber" });
  if (!withdrawal) throw error("Withdrawal not found.", 404);
  const providerReference = withdrawal.providerReference || `SQUAD-${withdrawal.reference}`;
  const claimed = await OrganizationWithdrawal.findOneAndUpdate({ _id: withdrawal._id, status: "APPROVED", providerReference: { $in: [null, ""] } }, { $set: { status: "PROCESSING", providerReference } }, { new: true });
  if (!claimed) return { withdrawal: await OrganizationWithdrawal.findById(withdrawal._id), configurationRequired: false };
  try {
    const response = await axios.post(`${process.env.SQUAD_BASE_URL.replace(/\/+$/, "")}/payout/transfer`, { remark: withdrawal.narration || "Organization withdrawal", bank_code: withdrawal.settlementAccount.bankCode, currency_id: "NGN", amount: String(Math.round(Number(withdrawal.amount) * 100)), account_number: withdrawal.settlementAccount.accountNumber, transaction_reference: providerReference, account_name: withdrawal.settlementAccount.accountName }, { timeout: 45000, headers: { Authorization: `Bearer ${process.env.SQUAD_SECRET_KEY}`, "Content-Type": "application/json" }, validateStatus: () => true });
    const mapped = providerStatus(response.data, response.status); await OrganizationWithdrawal.updateOne({ _id: withdrawal._id }, { $set: { providerTransactionId: String(response.data?.data?.id || response.data?.data?.transaction_id || "") } });
    if (mapped === "SUCCESS") return { withdrawal: await finalize(claimed, "SUCCESS"), configurationRequired: false };
    if (mapped === "FAILED") return { withdrawal: await finalize(claimed, "FAILED", "Provider rejected payout"), configurationRequired: false };
    return { withdrawal: await OrganizationWithdrawal.findById(withdrawal._id), configurationRequired: false };
  } catch (_) { return { withdrawal: await OrganizationWithdrawal.findById(withdrawal._id), configurationRequired: false, ambiguous: true }; }
}
async function requery(withdrawalId) {
  const now = new Date();
  const w = await OrganizationWithdrawal.findOneAndUpdate({ _id: withdrawalId, status: { $in: ["PROCESSING", "PENDING_REVIEW"] }, providerReference: { $nin: [null, ""] }, $or: [{ requeryLeaseUntil: null }, { requeryLeaseUntil: { $exists: false } }, { requeryLeaseUntil: { $lte: now } }] }, { $set: { requeryLeaseUntil: new Date(now.getTime() + 60000), lastRequeryAt: now }, $inc: { requeryAttempts: 1 } }, { new: true });
  if (!w) return { withdrawal: await OrganizationWithdrawal.findById(withdrawalId), alreadyRunning: true };
  try {
    const response = await axios.post(`${String(process.env.SQUAD_BASE_URL || "").replace(/\/+$/, "")}/payout/requery`, { transaction_reference: w.providerReference }, { timeout: 45000, headers: { Authorization: `Bearer ${process.env.SQUAD_SECRET_KEY}` }, validateStatus: () => true });
    const text = JSON.stringify(response.data).toUpperCase(); const result = text.includes("REVER") ? "REVERSED" : providerStatus(response.data, response.status);
    const updated = result === "SUCCESS" ? await finalize(w, "SUCCESS") : result === "REVERSED" ? await reverseSuccessful(w._id) : result === "FAILED" ? await finalize(w, "FAILED", "Provider requery failure") : await OrganizationWithdrawal.findById(w._id);
    await OrganizationWithdrawal.updateOne({ _id: w._id }, { $set: { requeryLeaseUntil: null } }); return { withdrawal: updated, ambiguous: result === "PROCESSING" };
  } catch (_) { await OrganizationWithdrawal.updateOne({ _id: w._id }, { $set: { requeryLeaseUntil: null, status: "PENDING_REVIEW" } }); return { withdrawal: await OrganizationWithdrawal.findById(w._id), ambiguous: true };
  }
}
async function handleWebhook(payload, signature, rawBody) {
  const secret = String(process.env.ORG_SQUAD_WEBHOOK_SECRET || process.env.SQUAD_WEBHOOK_SECRET || "").trim(); if (!secret || !signature) throw error("Webhook authentication failed.", 401);
  if (!rawBody) throw error("Raw webhook body is required.", 400);
  const reference = payload?.data?.transaction_reference || payload?.data?.reference || payload?.reference; const w = await OrganizationWithdrawal.findOne({ providerReference: reference }); if (!w) return null; const text = JSON.stringify(payload).toUpperCase(); if (text.includes("REVERS")) return reverseSuccessful(w._id); const mapped = providerStatus(payload, 200); return mapped === "SUCCESS" ? finalize(w, "SUCCESS") : mapped === "FAILED" ? finalize(w, "FAILED", "Provider webhook failure") : w;
}
module.exports = { resolveAccount, createWithdrawal, transition, config, idempotency, dispatch, requery, handleWebhook, finalize, reverseSuccessful, providerReady };