const crypto = require("crypto");
const mongoose = require("mongoose");
const User = require("../models/user.model");
const ProtectedDeal = require("../models/protectedDeal.model");
const TrustDispute = require("../models/trustDispute.model");
const Notification = require("../models/notification.model");
const AdminAuditLog = require("../models/adminAuditLog.model");
const WalletHold = require("../models/walletHold.model");
const Transaction = require("../models/transaction.model");
const AccountRestriction = require("../models/accountRestriction.model");
const TrustProfile = require("../models/trustProfile.model");
const { postDebit, postCredit } = require("./ledger.service");

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const money = (value) => {
  const amount = Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) throw fail("Amount must be greater than zero.");
  return amount;
};
const key = (value) => {
  const result = String(value || "").trim();
  if (result.length < 8 || result.length > 160) throw fail("A valid Idempotency-Key header is required.");
  return result;
};
const reference = () => `TPD-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
const id = (value) => new mongoose.Types.ObjectId(value);
const isParticipant = (deal, userId) => [String(deal.buyer), String(deal.seller)].includes(String(userId));
const dealFilterFor = (userId) => ({ $or: [{ buyer: userId }, { seller: userId }] });

const notify = async (userId, title, message, dealId) =>
  Notification.create({ userId, title, message, type: "TRUST", referenceId: dealId, referenceType: "ProtectedDeal" });

const assertEligible = async (userId, session = null) => {
  const [profile, restriction] = await Promise.all([
    TrustProfile.findOne({ user: userId }).session(session),
    AccountRestriction.findOne({ user: userId, status: "ACTIVE", type: { $in: ["BLOCK_WALLET_DEBIT", "FULL_FREEZE"] }, $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] }).session(session),
  ]);
  if (profile?.restricted) throw fail("Restricted Trust users cannot use protected deals.", 403);
  if (restriction) throw fail("Wallet debit is restricted for this account.", 403);
};

const createDeal = async ({ buyerId, sellerId, recipientServicePayId, amount, title, description = "", deadline = null, idempotencyKey }) => {
  const cleanTitle = String(title || "").trim();
  if (!cleanTitle) throw fail("A deal title is required.");
  const cleanDeadline = deadline ? new Date(deadline) : null;
  if (cleanDeadline && Number.isNaN(cleanDeadline.getTime())) throw fail("Provide a valid deal deadline.");
  if (!sellerId && recipientServicePayId) {
    const recipient = await TrustProfile.findOne({ servicePayId: String(recipientServicePayId).trim().toUpperCase() }).select("user restricted");
    if (!recipient || recipient.restricted) throw fail("Recipient Trust profile is unavailable.", 404);
    sellerId = recipient.user;
  }
  if (!mongoose.isValidObjectId(sellerId) || String(buyerId) === String(sellerId)) throw fail("Select a different valid seller.");
  const requestKey = key(idempotencyKey);
  const duplicate = await ProtectedDeal.findOne({ "events.idempotencyKey": requestKey });
  if (duplicate) {
    if (String(duplicate.buyer) !== String(buyerId)) throw fail("Idempotency key is already in use.", 409);
    return { deal: duplicate, duplicate: true };
  }
  await assertEligible(buyerId);
  const [buyer, seller, sellerProfile] = await Promise.all([
    User.exists({ _id: buyerId, status: "ACTIVE" }),
    User.exists({ _id: sellerId, status: "ACTIVE" }),
    TrustProfile.findOne({ user: sellerId }).select("restricted").lean(),
  ]);
  if (!buyer || !seller) throw fail("Both deal participants must have active accounts.", 404);
  if (sellerProfile?.restricted) throw fail("Recipient Trust profile is unavailable.", 404);
  try {
    const deal = await ProtectedDeal.create({
      reference: reference(), buyer: buyerId, seller: sellerId, amount: money(amount),
      title: cleanTitle, description: String(description || "").trim(), deadline: cleanDeadline,
      events: [{ type: "CREATED", fromStatus: "", toStatus: "CREATED", actor: buyerId, idempotencyKey: requestKey }],
    });
    notify(sellerId, "New protected deal", "A buyer created a protected deal with you.", deal._id).catch(() => {});
    return { deal, duplicate: false };
  } catch (error) {
    if (error.code === 11000) {
      const deal = await ProtectedDeal.findOne({ "events.idempotencyKey": requestKey });
      if (deal && String(deal.buyer) === String(buyerId)) return { deal, duplicate: true };
    }
    throw error;
  }
};

const transition = async ({ dealId, actorId, idempotencyKey, from, to, note = "", settlement = null, isAdmin = false, requiredParticipant = "", onTransition = null }) => {
  const requestKey = key(idempotencyKey);
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const prior = await ProtectedDeal.findOne({ _id: dealId, "events.idempotencyKey": requestKey }).session(session);
      if (prior) {
        if (!isParticipant(prior, actorId) && !isAdmin) throw fail("You are not a participant in this deal.", 403);
        if (requiredParticipant === "BUYER" && String(prior.buyer) !== String(actorId)) throw fail("Only the buyer can perform this action.", 403);
        if (requiredParticipant === "SELLER" && String(prior.seller) !== String(actorId)) throw fail("Only the seller can perform this action.", 403);
        result = { deal: prior, duplicate: true }; return;
      }
      const deal = await ProtectedDeal.findById(dealId).session(session);
      if (!deal) throw fail("Protected deal not found.", 404);
      if (!isParticipant(deal, actorId) && !isAdmin) throw fail("You are not a participant in this deal.", 403);
      if (requiredParticipant === "BUYER" && String(deal.buyer) !== String(actorId)) throw fail("Only the buyer can perform this action.", 403);
      if (requiredParticipant === "SELLER" && String(deal.seller) !== String(actorId)) throw fail("Only the seller can perform this action.", 403);
      if (!from.includes(deal.status)) throw fail(`Deal cannot transition from ${deal.status}.`, 409);
      if (settlement === "RELEASE") {
        await assertEligible(deal.buyer, session);
        const buyer = await User.findOneAndUpdate(
          { _id: deal.buyer, $expr: { $and: [{ $gte: ["$walletHeldBalance", deal.amount] }, { $gte: ["$walletBalance", deal.amount] }] } },
          { $inc: { walletBalance: -deal.amount, walletHeldBalance: -deal.amount } }, { new: false, session }
        );
        if (!buyer) throw fail("Buyer has insufficient spendable wallet balance for release.", 409);
        const seller = await User.findByIdAndUpdate(deal.seller, { $inc: { walletBalance: deal.amount } }, { new: false, session });
        if (!seller) throw fail("Seller account not found.", 409);
        const hold = await WalletHold.findOneAndUpdate({ _id: deal.walletHold, user: deal.buyer, status: { $in: ["ACTIVE", "PARTIALLY_RELEASED"] }, remainingAmount: deal.amount }, { $set: { remainingAmount: 0, status: "RELEASED" }, $push: { releases: { amount: deal.amount, reason: "Protected deal released", releasedBy: actorId, idempotencyKey: `${requestKey}:hold` } } }, { new: true, session });
        if (!hold) throw fail("Protected deal hold is unavailable.", 409);
        await Transaction.updateOne({ _id: deal.transaction, status: "PENDING" }, { $set: { status: "SUCCESSFUL" } }, { session });
        await postDebit({ userId: buyer._id, amount: deal.amount, openingBalance: buyer.walletBalance, closingBalance: buyer.walletBalance - deal.amount, service: "PROTECTED_DEAL_RELEASE", reference: deal.reference, idempotencyKey: `${requestKey}:buyer`, relatedUser: seller._id, narration: "Protected deal release", session });
        await postCredit({ userId: seller._id, amount: deal.amount, openingBalance: seller.walletBalance, closingBalance: seller.walletBalance + deal.amount, service: "PROTECTED_DEAL_RELEASE", reference: deal.reference, idempotencyKey: `${requestKey}:seller`, relatedUser: buyer._id, narration: "Protected deal release", session });
      } else if (settlement === "REFUND") {
        const buyer = await User.findOneAndUpdate({ _id: deal.buyer, walletHeldBalance: { $gte: deal.amount } }, { $inc: { walletHeldBalance: -deal.amount } }, { new: false, session });
        if (!buyer) throw fail("Protected funds are unavailable for refund.", 409);
        const hold = await WalletHold.findOneAndUpdate({ _id: deal.walletHold, user: deal.buyer, status: { $in: ["ACTIVE", "PARTIALLY_RELEASED"] }, remainingAmount: deal.amount }, { $set: { remainingAmount: 0, status: "CANCELLED" } }, { new: true, session });
        if (!hold) throw fail("Protected deal hold is unavailable.", 409);
        await Transaction.updateOne({ _id: deal.transaction, status: "PENDING" }, { $set: { status: "REFUNDED" } }, { session });
      }
      const updated = await ProtectedDeal.findOneAndUpdate(
        { _id: deal._id, status: deal.status },
        { $set: { status: to }, $push: { events: { type: to, fromStatus: deal.status, toStatus: to, actor: actorId, note: String(note || "").trim(), idempotencyKey: requestKey } } },
        { new: true, session }
      );
      if (!updated) throw fail("Deal changed concurrently; retry the request.", 409);
      if (onTransition) await onTransition(updated, session);
      result = { deal: updated, duplicate: false };
    });
  } finally { await session.endSession(); }
  if (!result.duplicate) {
    const recipient = settlement === "REFUND" ? result.deal.seller : result.deal.buyer;
    notify(recipient, "Protected deal updated", `Deal ${result.deal.reference} is now ${result.deal.status}.`, result.deal._id).catch(() => {});
  }
  return result;
};

const fundDeal = async ({ dealId, buyerId, idempotencyKey }) => {
  const requestKey = key(idempotencyKey);
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const existing = await ProtectedDeal.findOne({ _id: dealId, fundingIdempotencyKey: requestKey }).session(session);
      if (existing) {
        if (String(existing.buyer) !== String(buyerId)) throw fail("Only the buyer can fund this deal.", 403);
        result = { deal: existing, duplicate: true }; return;
      }
      const deal = await ProtectedDeal.findById(dealId).session(session);
      if (!deal) throw fail("Protected deal not found.", 404);
      if (String(deal.buyer) !== String(buyerId)) throw fail("Only the buyer can fund this deal.", 403);
      if (deal.status !== "CREATED") throw fail(`Deal cannot transition from ${deal.status}.`, 409);
      await assertEligible(buyerId, session);
      const buyer = await User.findOneAndUpdate({ _id: buyerId, $expr: { $gte: [{ $subtract: ["$walletBalance", "$walletHeldBalance"] }, deal.amount] } }, { $inc: { walletHeldBalance: deal.amount } }, { new: false, session });
      if (!buyer) throw fail("Insufficient spendable wallet balance.", 409);
      const hold = (await WalletHold.create([{ user: buyerId, reference: `${deal.reference}-HOLD`, linkedReference: deal.reference, initialAmount: deal.amount, remainingAmount: deal.amount, reason: "Protected deal funding", createdBy: buyerId }], { session }))[0];
      const transaction = (await Transaction.create([{ reference: `${deal.reference}-FUND`, customerId: buyerId, serviceType: "PROTECTED_DEAL", amount: deal.amount, status: "PENDING", provider: "TRUST", providerResponse: { dealId: String(deal._id), walletHoldId: String(hold._id) } }], { session }))[0];
      const updated = await ProtectedDeal.findOneAndUpdate({ _id: deal._id, status: "CREATED" }, { $set: { status: "FUNDED", fundingIdempotencyKey: requestKey, walletHold: hold._id, transaction: transaction._id }, $push: { events: { type: "FUNDED", fromStatus: "CREATED", toStatus: "FUNDED", actor: buyerId, idempotencyKey: requestKey } } }, { new: true, session });
      if (!updated) throw fail("Deal changed concurrently; retry the request.", 409);
      result = { deal: updated, duplicate: false };
    });
  } finally { await session.endSession(); }
  if (!result.duplicate) notify(result.deal.seller, "Deal funded", "A protected deal is funded and awaiting completion.", result.deal._id).catch(() => {});
  return result;
};

const openDispute = async ({ dealId, userId, reason, description = "", evidenceReferences = [], idempotencyKey }) => {
  const requestKey = key(idempotencyKey);
  const deal = await ProtectedDeal.findById(dealId);
  if (!deal) throw fail("Protected deal not found.", 404);
  if (!isParticipant(deal, userId)) throw fail("You are not a participant in this deal.", 403);
  let created;
  const transitioned = await transition({ dealId, actorId: userId, idempotencyKey: requestKey, from: ["FUNDED", "IN_PROGRESS", "DELIVERED"], to: "DISPUTED", note: reason,
    onTransition: async (_updated, session) => {
      created = (await TrustDispute.create([{ deal: dealId, openedBy: userId, buyer: deal.buyer, seller: deal.seller, reason: String(reason).trim(), description: String(description).trim(), evidenceReferences, idempotencyKey: requestKey }], { session }))[0];
    } });
  if (transitioned.duplicate) return { dispute: await TrustDispute.findOne({ deal: dealId }), duplicate: true };
  notify(String(deal.buyer) === String(userId) ? deal.seller : deal.buyer, "Deal dispute opened", "A dispute was opened for your protected deal.", dealId).catch(() => {});
  return { dispute: created, duplicate: false };
};

const resolveDispute = async ({ disputeId, adminId, resolution, note, idempotencyKey, actor }) => {
  const dispute = await TrustDispute.findById(disputeId);
  if (!dispute) throw fail("Trust dispute not found.", 404);
  const outcome = String(resolution || "").toUpperCase();
  if (!["RELEASE", "REFUND"].includes(outcome)) throw fail("Resolution must be RELEASE or REFUND.");
  const cleanNote = String(note || "").trim();
  if (cleanNote.length < 5) throw fail("An internal resolution note of at least 5 characters is required.");
  if (dispute.status === "RESOLVED") return { dispute, duplicate: true };
  let updated;
  const transitioned = await transition({ dealId: dispute.deal, actorId: adminId, idempotencyKey: key(idempotencyKey), from: ["DISPUTED"], to: outcome === "RELEASE" ? "COMPLETED" : "REFUNDED", note: cleanNote, settlement: outcome, isAdmin: true,
    onTransition: async (_deal, session) => {
      updated = await TrustDispute.findOneAndUpdate({ _id: disputeId, status: "OPEN" }, { $set: { status: "RESOLVED", resolution: outcome, resolutionNote: cleanNote, resolvedBy: adminId, resolvedAt: new Date() } }, { new: true, session });
      if (!updated) throw fail("Dispute changed concurrently; retry the request.", 409);
      await AdminAuditLog.create([{ actorId: adminId, actorRole: actor?.role || "STAFF", actorName: actor?.fullName || "", targetUserId: dispute.openedBy, action: "TRUST_DISPUTE_RESOLVED", reason: cleanNote, metadata: { disputeId: String(dispute._id), resolution: outcome } }], { session });
    } });
  return { dispute: updated || dispute, duplicate: transitioned.duplicate };
};

module.exports = { createDeal, dealFilterFor, fundDeal, openDispute, resolveDispute, transition, fail };