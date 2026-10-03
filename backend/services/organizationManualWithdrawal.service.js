"use strict";
// This module deliberately has no payout adapter or external API dependency.
const crypto = require("crypto");
const mongoose = require("mongoose");
const base = require("./organizations.service");
const { hasPermission } = require("../middleware/staffPermission.middleware");
const { verifyTransactionPin } = require("./transactionPin.service");
const { createInAppNotification } = require("./inAppNotification.service");
const {
  Organization, OrganizationRole, OrganizationWallet, OrganizationWithdrawal,
  OrganizationLedger, OrganizationWithdrawalSnapshot,
} = require("../models/organizations.models");

const error = (message, status = 400) => Object.assign(new Error(message), { status });
const format = (amount) => Number(amount).toLocaleString("en-NG", { maximumFractionDigits: 2 });
const reference = () => `ORGMW-${crypto.randomUUID().toUpperCase()}`;
const ownerId = (req) => req.user?._id;
const amountValue = (value) => {
  if (!["number", "string"].includes(typeof value) || String(value).trim() === "") throw error("Enter a valid withdrawal amount.");
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9 ||
      Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001) {
    throw error("Amount must be greater than ₦0 and have at most two decimal places.");
  }
  return Math.round(amount * 100) / 100;
};
async function owner(req, permission = "wallet.view") {
  const organizationId = req.params.organizationId || req.params.id;
  const org = await base.requireOrganizationAccess(req, organizationId, permission, true);
  if (!org || req.organizationAccess?.role?.role !== "OWNER" || req.organizationAccess.branchScope) {
    throw error("Only this organization's authenticated owner may access manual withdrawals.", 403);
  }
  return org;
}
function safeWithdrawal(row, admin = false) {
  const w = typeof row.toObject === "function" ? row.toObject() : row;
  const d = w.destinationSnapshot || {};
  const last4 = d.accountNumberLast4 || String(d.accountNumber || "").slice(-4);
  return {
    _id: w._id, organization: w.organization, requestedBy: w.requestedBy,
    reference: w.reference, amount: w.amount, status: w.status,
    createdAt: w.createdAt, completedAt: w.completedAt,
    rejectionReason: w.rejectionReason,
    destinationSnapshot: {
      accountName: d.accountName, bankName: d.bankName, accountNumberLast4: last4,
      maskedAccountNumber: `******${last4}`,
      ...(admin ? { accountNumber: d.accountNumber } : {}),
    },
  };
}
const publicBank = (bank) => bank ? {
  accountName: bank.accountName, accountNumber: bank.accountNumber, bankName: bank.bankName,
} : null;
async function bank(req) {
  const org = await owner(req);
  const current = await Organization.findById(org._id).select("+manualWithdrawalBank").lean();
  return publicBank(current.manualWithdrawalBank);
}
async function saveBank(req) {
  const org = await owner(req, "wallet.withdraw");
  const fields = {};
  for (const name of ["accountName", "bankName", "accountNumber"]) {
    if (typeof req.body[name] !== "string") throw error("Account Name, Account Number and Bank Name are required.");
    fields[name] = req.body[name].trim();
  }
  if (!fields.accountName || !fields.bankName || fields.accountName.length > 160 ||
      fields.bankName.length > 160 || !/^\d{10}$/.test(fields.accountNumber)) {
    throw error("Enter an account name, a 10-digit account number and a bank name.");
  }
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await assertCurrentOwner(req, org, session);
      await Organization.updateOne({ _id: org._id }, { $set: {
        manualWithdrawalBank: { ...fields, updatedBy: ownerId(req), updatedAt: new Date() },
      } }, { session, runValidators: true });
      await base.audit(req, org, "MANUAL_WITHDRAWAL_BANK_UPDATED", "Organization", org._id,
        { bankName: fields.bankName, accountNumberLast4: fields.accountNumber.slice(-4) }, session);
    });
  } finally { await session.endSession(); }
  return fields;
}
async function assertCurrentOwner(req, org, session) {
  const activeOrg = await Organization.findOne({ _id: org._id, status: { $in: ["VERIFIED", "APPROVED"] } }).session(session);
  const roles = await OrganizationRole.find({ organization: org._id, user: ownerId(req), active: true }).session(session);
  if (!activeOrg || roles.length !== 1 || roles[0].role !== "OWNER" ||
      !base.roleAllows(roles[0].role, "wallet.withdraw", roles[0].permissions)) {
    throw error("Organization owner access is no longer active.", 403);
  }
}
async function wallet(req) {
  const org = await owner(req);
  const w = await OrganizationWallet.findOne({ organization: org._id }).lean();
  const balance = Number(w?.balance || 0), held = Number(w?.heldBalance || 0);
  const count = await OrganizationWithdrawal.countDocuments({ organization: org._id, provider: "MANUAL", status: "PENDING" });
  return { ledgerBalance: balance, totalBalance: balance, heldBalance: held,
    availableBalance: Math.max(0, Math.round((balance - held) * 100) / 100), pendingWithdrawals: count };
}
function pageQuery(req) {
  const page = Math.max(1, Math.min(100000, parseInt(req.query?.page, 10) || 1));
  const limit = 25;
  const status = String(req.query?.status || "").toUpperCase();
  if (status && !["PENDING", "COMPLETED", "REJECTED"].includes(status)) throw error("Invalid withdrawal status.");
  return { page, limit, ...(status ? { status } : {}) };
}
async function list(req, admin = false) {
  const org = admin ? null : await owner(req);
  const { page, limit, status } = pageQuery(req);
  const filter = { provider: "MANUAL", ...(org ? { organization: org._id } : {}), ...(status ? { status } : {}) };
  let query = OrganizationWithdrawal.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit);
  if (admin) query = query.select("+destinationSnapshot.accountNumber").populate("organization", "name code").populate("requestedBy", "fullName phone");
  const [rows, total] = await Promise.all([query.lean(), OrganizationWithdrawal.countDocuments(filter)]);
  return { withdrawals: rows.map((row) => safeWithdrawal(row, admin)),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}
function replay(existing, req, amount) {
  if (existing.provider !== "MANUAL" || String(existing.requestedBy) !== String(ownerId(req)) || existing.amount !== amount) {
    throw error("This withdrawal request key was already used for different details.", 409);
  }
  return { withdrawal: safeWithdrawal(existing), duplicate: true };
}
async function notify(w, state, session) {
  const messages = {
    PENDING: `Your withdrawal request of ₦${format(w.amount)} has been submitted successfully and is awaiting processing.`,
    COMPLETED: `Your withdrawal of ₦${format(w.amount)} has been completed successfully.`,
    REJECTED: `Your withdrawal request of ₦${format(w.amount)} was not completed. The amount has been returned to your available balance.`,
  };
  await createInAppNotification({ userId: w.requestedBy, type: "WITHDRAWAL",
    title: "Organization withdrawal", message: messages[state], referenceId: w._id,
    referenceType: "ORGANIZATION_WITHDRAWAL", dedupeKey: `manual-org-withdrawal:${w._id}:${state}` }, { session });
}
async function event(req, org, w, fromStatus, toStatus, metadata, session) {
  await OrganizationWithdrawalSnapshot.create([{
    withdrawal: w._id, organization: org._id, event: `MANUAL_${toStatus}`,
    fromStatus, toStatus, actor: ownerId(req), metadata,
  }], { session });
  await base.audit(req, org, `MANUAL_WITHDRAWAL_${toStatus}`, "OrganizationWithdrawal", w._id,
    { reference: w.reference, amount: w.amount, previousStatus: fromStatus, newStatus: toStatus, ...metadata }, session);
}
async function create(req) {
  const org = await owner(req, "wallet.withdraw");
  const amount = amountValue(req.body.amount);
  const key = String(req.get?.("X-Idempotency-Key") || req.get?.("Idempotency-Key") || req.body.idempotencyKey || "").trim();
  if (!key || key.length > 180) throw error("A withdrawal request key is required.");
  const filter = { organization: org._id, idempotencyKey: key };
  const existing = await OrganizationWithdrawal.findOne(filter);
  if (existing) return replay(existing, req, amount);
  // Use ServicePay's existing lockout-aware PIN system before any wallet write.
  await verifyTransactionPin(ownerId(req), req.body.transactionPin ?? req.body.pin);
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const prior = await OrganizationWithdrawal.findOne(filter).session(session);
      if (prior) { result = replay(prior, req, amount); return; }
      await assertCurrentOwner(req, org, session);
      const current = await Organization.findById(org._id).select("+manualWithdrawalBank").session(session);
      const account = publicBank(current.manualWithdrawalBank);
      if (!account) throw error("Add a withdrawal bank account first.", 409);
      const w = await OrganizationWallet.findOneAndUpdate({
        organization: org._id, status: "ACTIVE",
        $expr: { $gte: [{ $round: [{ $subtract: ["$balance", { $ifNull: ["$heldBalance", 0] }] }, 2] }, amount] },
      }, [{ $set: { heldBalance: { $round: [{ $add: [{ $ifNull: ["$heldBalance", 0] }, amount] }, 2] } } }],
      { returnDocument: "after", updatePipeline: true, session });
      if (!w) throw error("Withdrawal exceeds the available balance or this wallet is unavailable.", 409);
      const withdrawal = (await OrganizationWithdrawal.create([{
        organization: org._id, requestedBy: ownerId(req), provider: "MANUAL",
        amount, fee: 0, totalDebit: amount, status: "PENDING", reference: reference(), idempotencyKey: key,
        destinationSnapshot: { ...account, accountNumberLast4: account.accountNumber.slice(-4) },
      }], { session }))[0];
      await OrganizationLedger.create([{ organization: org._id, type: "HOLD", amount,
        balanceAfter: w.balance, reference: `${withdrawal.reference}:HOLD`, withdrawal: withdrawal._id,
        narration: "Manual organization withdrawal hold", createdBy: ownerId(req) }], { session });
      await event(req, org, withdrawal, null, "PENDING", {
        destinationSnapshot: { accountName: account.accountName, bankName: account.bankName,
          accountNumberLast4: account.accountNumber.slice(-4) },
      }, session);
      await notify(withdrawal, "PENDING", session);
      result = { withdrawal: safeWithdrawal(withdrawal), duplicate: false };
    });
  } catch (e) {
    if (e.code === 11000) {
      const prior = await OrganizationWithdrawal.findOne(filter);
      if (prior) return replay(prior, req, amount);
    }
    throw e;
  } finally { await session.endSession(); }
  return result;
}
function confirm(req, w) {
  const d = w.destinationSnapshot, c = req.body.confirmation || {};
  if (req.body.confirmed !== true || c.reference !== w.reference || c.amount !== w.amount ||
      c.accountName !== d.accountName || c.accountNumber !== d.accountNumber || c.bankName !== d.bankName) {
    throw error("Confirm the exact amount and saved destination of the completed manual bank transfer.", 409);
  }
}
async function transition(req, target) {
  if (base.isHierarchyManager(req.user) || !(base.platform(req) || hasPermission(req.staffAccess, "organizations.withdrawals.review"))) {
    throw error("Authorized ServicePay Admin access is required.", 403);
  }
  if (!["COMPLETED", "REJECTED"].includes(target)) throw error("Unsupported manual withdrawal decision.");
  const withdrawalId = req.params.withdrawalId || req.params.id;
  if (!mongoose.isValidObjectId(withdrawalId)) throw error("Withdrawal not found.", 404);
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const w = await OrganizationWithdrawal.findOne({ _id: withdrawalId, provider: "MANUAL" })
        .select("+destinationSnapshot.accountNumber").session(session);
      if (!w) throw error("Manual withdrawal not found.", 404);
      if (target === "COMPLETED") confirm(req, w);
      if (w.status === target) { result = safeWithdrawal(w, true); return; }
      if (w.status !== "PENDING") throw error("This withdrawal has already been resolved.", 409);
      const org = await Organization.findById(w.organization).session(session);
      if (!org) throw error("Organization not found.", 404);
      const paid = target === "COMPLETED";
      const walletFilter = { organization: w.organization,
        $expr: { $and: [
          { $gte: [{ $round: ["$heldBalance", 2] }, w.amount] },
          ...(paid ? [{ $gte: [{ $round: ["$balance", 2] }, w.amount] }] : []),
        ] } };
      const wallet = await OrganizationWallet.findOneAndUpdate(walletFilter,
        [{ $set: {
          heldBalance: { $round: [{ $subtract: ["$heldBalance", w.amount] }, 2] },
          ...(paid ? {
            balance: { $round: [{ $subtract: ["$balance", w.amount] }, 2] },
            totalWithdrawn: { $round: [{ $add: [{ $ifNull: ["$totalWithdrawn", 0] }, w.amount] }, 2] },
          } : {}),
        } }],
        { returnDocument: "after", updatePipeline: true, session });
      if (!wallet) throw error("Wallet hold mismatch; manual reconciliation is required.", 409);
      w.status = target; w.approvedBy = ownerId(req);
      if (paid) {
        w.completedAt = new Date(); w.debitFinalizedAt = w.completedAt;
        w.manualPaymentConfirmation = { ...req.body.confirmation, confirmedBy: ownerId(req), confirmedAt: w.completedAt,
          evidenceType: "STAFF_MANUAL_TRANSFER_ATTESTATION" };
      } else {
        w.holdReleasedAt = new Date(); w.rejectionReason = String(req.body.reason || "Rejected by ServicePay Admin").trim().slice(0, 500);
      }
      await w.save({ session });
      await OrganizationLedger.create([{ organization: w.organization, type: paid ? "DEBIT" : "RELEASE",
        amount: w.amount, balanceAfter: wallet.balance, reference: `${w.reference}:${paid ? "DEBIT" : "RELEASE"}`,
        withdrawal: w._id, createdBy: ownerId(req), narration: paid ? "Staff-confirmed manual payout" : "Manual withdrawal rejected; hold released" }], { session });
      await event(req, org, w, "PENDING", target,
        paid ? { confirmation: { reference: w.reference, amount: w.amount, bankName: w.destinationSnapshot.bankName,
          accountNumberLast4: w.destinationSnapshot.accountNumberLast4, confirmedBy: ownerId(req),
          confirmedAt: w.completedAt, evidenceType: "STAFF_MANUAL_TRANSFER_ATTESTATION" } } : { reason: w.rejectionReason }, session);
      await notify(w, target, session);
      result = safeWithdrawal(w, true);
    });
  } finally { await session.endSession(); }
  return result;
}
module.exports = { owner, bank, saveBank, wallet, list, create, transition, safeWithdrawal, amountValue };