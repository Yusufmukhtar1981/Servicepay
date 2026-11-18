"use strict";
const mongoose = require("mongoose");
const M = require("../models/profitSharing.models");
const N = require("../models/businessNetwork.models");
const User = require("../models/user.model");
const Withdrawal = require("../models/withdrawalRequest.model");
const PayoutClaim = require("../models/withdrawalPayoutClaim.model");
const Restriction = require("../models/accountRestriction.model");
const Watchlist = require("../models/fintechWatchlist.model");
const { getWithdrawalIndexReadiness } = require("./withdrawalIndexReadiness.service");
const roles = ["AGENT", "STATE_MANAGER", "ZONAL_MANAGER"];
const fields = ["availableKobo", "reservedKobo", "withdrawnKobo", "earnedKobo", "reversedKobo", "recoveryDebtKobo"];
const fail = (code, statusCode = 409) => { throw Object.assign(Error(code), { code, statusCode }); };
function balances(account) {
  const result = Object.fromEntries(fields.map(key => [key, account?.[key] ?? 0]));
  if (Object.values(result).some(value => !Number.isSafeInteger(value) || value < 0)) fail("INVALID_CUSTODY_BALANCE");
  if (BigInt(result.availableKobo) + BigInt(result.reservedKobo) + BigInt(result.withdrawnKobo) -
      BigInt(result.recoveryDebtKobo) !== BigInt(result.earnedKobo) - BigInt(result.reversedKobo)) {
    fail("CUSTODY_JOURNAL_RECONCILIATION_REQUIRED");
  }
  return result;
}
async function actorFor(userId, session) {
  const actor = await User.findById(userId).session(session).lean();
  if (!actor || actor.status !== "ACTIVE" || actor.isDeleted === true || !roles.includes(actor.role)) {
    fail("ACTIVE_MANAGEMENT_BENEFICIARY_REQUIRED", 403);
  }
  const restriction = await Restriction.findOne({ user: actor._id, status: "ACTIVE",
    type: { $in: ["FULL_FREEZE", "BLOCK_LOGIN", "BLOCK_WITHDRAWALS", "BLOCK_WALLET_DEBIT"] },
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  }).session(session).select("_id").lean();
  if (restriction) fail("ACCOUNT_RESTRICTED", 403);
  const blacklist = await Watchlist.findOne({ status: "BLACKLISTED",
    identifierValue: { $in: [String(actor._id), actor.phone, actor.email].filter(Boolean).map(value => String(value).toLowerCase()) },
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  }).session(session).select("_id").lean();
  if (blacklist) fail("ACCOUNT_RESTRICTED", 403);
  return actor;
}
async function backedAccount(accountId, session) {
  if (!session) {
    const snapshot = await mongoose.startSession();
    try {
      let result;
      await snapshot.withTransaction(async () => {
        result = await backedAccount(accountId, snapshot);
      }, { readConcern: { level: "snapshot" } });
      return result;
    } finally { await snapshot.endSession(); }
  }
  const names = [M.Account.collection.name, M.Event.collection.name, N.Audit.collection.name];
  const collections = await M.Account.db.db.listCollections({ name: { $in: names } }).toArray();
  if (names.some(name => !collections.some(collection => collection.name === name && collection.type === "collection"))) {
    fail("COMMISSION_CUSTODY_STORAGE_NOT_READY", 503);
  }
  const account = await M.Account.findById(accountId).session(session).lean();
  const value = balances(account);
  const events = await M.Event.aggregate([
      { $match: { kind: { $in: ["ACCRUAL", "REVERSAL"] }, "data.entries.accountId": accountId } },
      { $unwind: "$data.entries" }, { $match: { "data.entries.accountId": accountId } },
      { $group: { _id: "$kind", amountKobo: { $sum: "$data.entries.amountKobo" } } },
    ]).session(session).option({ maxTimeMS: 5000 });
  const requests = await Withdrawal.aggregate([
      { $match: { fundingSource: "COMMISSION_CUSTODY", commissionAccountId: accountId,
        status: { $in: ["PENDING", "APPROVED"] } } },
      { $group: { _id: "$status", amountKobo: { $sum: "$commissionAmountKobo" } } },
    ]).session(session).option({ maxTimeMS: 5000 });
  const sum = (rows, kind) => rows.find(row => row._id === kind)?.amountKobo || 0;
  if (value.earnedKobo !== sum(events, "ACCRUAL") || value.reversedKobo !== sum(events, "REVERSAL") ||
      value.reservedKobo !== sum(requests, "PENDING") || value.withdrawnKobo !== sum(requests, "APPROVED")) {
    fail("CUSTODY_JOURNAL_RECONCILIATION_REQUIRED");
  }
  return { account, value };
}
async function event(id, kind, data, session) {
  await M.Event.create([{ _id: id, kind, data }], { session });
}
async function change(account, increments, session) {
  if (!account) fail("SETTLED_COMMISSION_FUNDS_REQUIRED");
  const next = balances({ ...account, ...Object.fromEntries(fields.map(key =>
    [key, (account[key] ?? 0) + (increments[key] || 0)])) });
  const result = await M.Account.updateOne({ _id: account._id, revision: account.revision },
    { $set: next, $inc: { revision: 1 } }, { session, runValidators: true });
  if (result.modifiedCount !== 1) fail("CUSTODY_ACCOUNT_CHANGED");
  return next;
}
async function reserve({ userId, amountKobo, bankName, accountNumber, accountName, idempotencyKey, session }) {
  if (!session?.inTransaction()) fail("ACTIVE_DATABASE_TRANSACTION_REQUIRED");
  if (!Number.isSafeInteger(amountKobo) || amountKobo <= 0) fail("EXACT_KOBO_AMOUNT_REQUIRED", 400);
  const actor = await actorFor(userId, session), accountId = `beneficiary:${actor._id}`;
  const { account, value } = await backedAccount(accountId, session);
  if (value.recoveryDebtKobo > 0) fail("COMMISSION_RECOVERY_DEBT_OUTSTANDING");
  if (!account || value.availableKobo < amountKobo) fail("INSUFFICIENT_SETTLED_COMMISSION");
  const next = await change(account, { availableKobo: -amountKobo, reservedKobo: amountKobo }, session);
  const id = new mongoose.Types.ObjectId();
  const [withdrawal] = await Withdrawal.create([{
    _id: id, user: actor._id, reference: `CWDR-${id}`, idempotencyKey,
    amount: amountKobo / 100, bankName, accountNumber, accountName, status: "PENDING",
    fundingSource: "COMMISSION_CUSTODY", commissionAccountId: accountId,
    commissionAmountKobo: amountKobo, balanceAfter: next.availableKobo / 100,
  }], { session });
  await event(`withdrawal-reserved:${id}`, "WITHDRAWAL_RESERVED",
    { accountId, withdrawalId: String(id), amountKobo, actorId: String(actor._id) }, session);
  await N.Audit.create([{ actor: actor._id, action: "COMMISSION_WITHDRAWAL_RESERVED",
    metadata: { withdrawalId: String(id), accountId, amountKobo } }], { session });
  return { withdrawal, custodyBalance: next, fundingSource: "COMMISSION_CUSTODY", duplicate: false };
}
async function finalize(actor, withdrawalId, body, approve) {
  if (actor?.role !== "HEAD_OFFICE") fail("HEAD_OFFICE_REQUIRED", 403);
  if (!mongoose.isValidObjectId(withdrawalId)) fail("INVALID_WITHDRAWAL_ID", 400);
  const note = String(body?.adminNote || "").trim();
  if (note.length < 10 || note.length > 500) fail("WITHDRAWAL_REASON_REQUIRED", 400);
  if (!(await getWithdrawalIndexReadiness()).ready) fail("WITHDRAWAL_INDEXES_NOT_READY", 503);
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const item = await Withdrawal.findOne({ _id: withdrawalId, fundingSource: "COMMISSION_CUSTODY" }).session(session);
      if (!item) fail("COMMISSION_WITHDRAWAL_NOT_FOUND", 404);
      const amountKobo = item.commissionAmountKobo;
      const accountNumber = String(body.expectedAccountNumber || "").trim();
      const payoutReference = String(body.payoutReference || "").trim();
      const amount = Number(body.expectedAmount);
      if (approve && (body.manualPaymentConfirmed !== true || !payoutReference || payoutReference.length > 120 ||
          !Number.isFinite(amount) || Math.abs(amount * 100 - amountKobo) > 1e-8 ||
          accountNumber !== item.accountNumber ||
          [body.providerStatus, body.payoutStatus].filter(Boolean)
            .some(value => !["SUCCESS", "SUCCESSFUL"].includes(String(value).toUpperCase())))) {
        fail("PAYOUT_DETAILS_NOT_CONFIRMED");
      }
      const desired = approve ? "APPROVED" : "REJECTED";
      if (item.status === desired) {
        if (approve && item.payoutReference !== payoutReference) fail("PAYOUT_REFERENCE_CONFLICT");
        result = { withdrawal: item, duplicate: true }; return;
      }
      if (item.status !== "PENDING") fail("WITHDRAWAL_ALREADY_FINALIZED");
      if (item.commissionAccountId !== `beneficiary:${item.user}` ||
          !Number.isSafeInteger(amountKobo) || amountKobo <= 0 ||
          !Number.isFinite(item.amount) || Math.abs(item.amount * 100 - amountKobo) > 1e-8) fail("INVALID_COMMISSION_RESERVATION");
      if (approve) await actorFor(item.user, session);
      const { account, value } = await backedAccount(item.commissionAccountId, session);
      if (value.reservedKobo < amountKobo) fail("COMMISSION_RESERVATION_MISSING");
      if (approve && value.recoveryDebtKobo > 0) fail("COMMISSION_RECOVERY_DEBT_OUTSTANDING");
      if (approve) {
        if (await Withdrawal.exists({ _id: { $ne: item._id }, status: "APPROVED", payoutReference }).session(session)) {
          fail("DUPLICATE_PAYOUT_REFERENCE");
        }
        await PayoutClaim.create([{ payoutReference, withdrawalId: item._id }], { session });
      }
      const offset = approve ? 0 : Math.min(value.recoveryDebtKobo, amountKobo);
      const next = await change(account, approve
        ? { reservedKobo: -amountKobo, withdrawnKobo: amountKobo }
        : { reservedKobo: -amountKobo, recoveryDebtKobo: -offset, availableKobo: amountKobo - offset }, session);
      item.status = desired; item.adminNote = note;
      if (approve) {
        item.approvedAt = new Date(); item.approvedBy = actor._id; item.payoutReference = payoutReference;
        const evidence = { method: "MANUAL_BANK_TRANSFER", confirmed: true, actor: actor._id,
          confirmedAt: item.approvedAt, amount: item.amount, bankName: item.bankName,
          accountNumber: item.accountNumber, accountName: item.accountName, payoutReference };
        for (const [key, value] of Object.entries(evidence)) item.set(`manualPayoutEvidence.${key}`, value, { overwriteImmutable: true });
      } else { item.rejectedAt = new Date(); item.rejectedBy = actor._id; }
      item.balanceAfter = next.availableKobo / 100;
      await item.save({ session });
      await event(`withdrawal-final:${item._id}`, approve ? "WITHDRAWAL_PAID" : "WITHDRAWAL_RELEASED",
        { withdrawalId: String(item._id), accountId: item.commissionAccountId, amountKobo,
          actorId: String(actor._id), recoveryDebtOffsetKobo: offset }, session);
      await N.Audit.create([{ actor: actor._id, action: approve ? "COMMISSION_WITHDRAWAL_PAID" : "COMMISSION_WITHDRAWAL_RELEASED",
        reason: note, metadata: { withdrawalId: String(item._id), amountKobo, recoveryDebtOffsetKobo: offset,
          payoutEvidence: approve ? "STAFF_CONFIRMED_MANUAL_BANK_TRANSFER" : undefined } }], { session });
      result = { withdrawal: item, custodyBalance: next, duplicate: false };
    });
    return result;
  } catch (error) {
    if (error.code === 11000) fail("DUPLICATE_PAYOUT_REFERENCE");
    throw error;
  } finally { await session.endSession(); }
}
module.exports = { balances, backedAccount, reserve, finalize, roles };
