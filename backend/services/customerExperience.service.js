"use strict";
const mongoose = require("mongoose");
const User = require("../models/user.model");
const Ledger = require("../models/ledgerEntry.model");
const Notification = require("../models/notification.model");
const Transaction = require("../models/transaction.model");

const defaults = Object.freeze({
  dashboardBackground: "green",
  soundNotifications: false,
  voiceAnnouncements: false,
});
const projection = "+customerDashboardSettings +walletCreditAlertsStartedAt +walletCreditAlertsLastPollAt +walletCreditAlertDeliveryVersion walletBalance role status";
const fail = (message, status = 400, code = "INVALID_CUSTOMER_SETTINGS") =>
  Object.assign(new Error(message), { status, code });
const settingsFor = (user) => ({
  dashboardBackground: user?.customerDashboardSettings?.dashboardBackground === "default" ? "default" : "green",
  soundNotifications: user?.customerDashboardSettings?.soundNotifications === true,
  voiceAnnouncements: user?.customerDashboardSettings?.voiceAnnouncements === true,
});

function validateSettings(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).length === 0 ||
      Object.keys(input).some((key) => !Object.hasOwn(defaults, key))) {
    throw fail("Only background, sound and voice preferences may be changed.");
  }
  if (Object.hasOwn(input, "dashboardBackground") &&
      !["green", "default"].includes(input.dashboardBackground)) {
    throw fail("Choose Default Background or ServicePay Green Background.");
  }
  for (const key of ["soundNotifications", "voiceAnnouncements"]) {
    if (Object.hasOwn(input, key) && typeof input[key] !== "boolean") {
      throw fail("Sound and voice preferences must be true or false.");
    }
  }
  return Object.fromEntries(Object.entries(input).map(([key, value]) =>
    [`customerDashboardSettings.${key}`, value]));
}

function createCustomerExperience({ clock = () => new Date(), pollMs = 20000 } = {}) {
  // Cache only a successful check. Never create/repair indexes at request time.
  let dedupeReady = false;
  async function requireDedupeIndex() {
    if (dedupeReady) return;
    const indexes = await Notification.collection.listIndexes().toArray();
    if (!indexes.some((i) => i.unique === true &&
        Object.keys(i.key).length === 1 && i.key.dedupeKey === 1 &&
        !i.partialFilterExpression)) {
      throw fail("Wallet credit alerts are temporarily unavailable.", 503,
        "CREDIT_ALERT_DEDUPLICATION_UNAVAILABLE");
    }
    dedupeReady = true;
  }
  async function customer(userId, session) {
    const q = User.findOne({ _id: userId, role: "CUSTOMER", status: "ACTIVE" }).select(projection);
    if (session) q.session(session);
    const user = await q.lean();
    if (!user) throw fail("An active Customer account is required.", 403, "CUSTOMER_ONLY");
    return user;
  }
  async function getSettings(userId) {
    return settingsFor(await customer(userId));
  }
  async function updateSettings(userId, input) {
    const fields = validateSettings(input);
    const user = await User.findOneAndUpdate(
      { _id: userId, role: "CUSTOMER", status: "ACTIVE" },
      { $set: fields },
      { new: true, runValidators: true, timestamps: false },
    ).select(projection).lean();
    if (!user) throw fail("An active Customer account is required.", 403, "CUSTOMER_ONLY");
    return settingsFor(user);
  }

  async function nextAlert(userId) {
    const now = clock();
    const user = await customer(userId);
    const empty = { settings: settingsFor(user), alert: null, retryAfterSeconds: 20 };
    if (!user.walletCreditAlertsStartedAt) {
      // First use establishes a prospective baseline. Concurrent first opens
      // cannot overwrite it. Preference changes do not reset this baseline.
      await User.updateOne({
        _id: user._id,
        $or: [
          { walletCreditAlertsStartedAt: { $exists: false } },
          { walletCreditAlertsStartedAt: null },
        ],
      }, { $set: {
        walletCreditAlertsStartedAt: now,
        walletCreditAlertsLastPollAt: now,
      } }, { timestamps: false });
      return empty;
    }
    const admitted = await User.findOneAndUpdate({
      _id: user._id,
      $or: [
        { walletCreditAlertsLastPollAt: { $lte: new Date(now.getTime() - pollMs) } },
        { walletCreditAlertsLastPollAt: { $exists: false } },
      ],
    }, { $set: { walletCreditAlertsLastPollAt: now } }, { timestamps: false }).lean();
    if (!admitted) return empty;
    await requireDedupeIndex();

    const session = await mongoose.startSession();
    let result = empty;
    try {
      await session.withTransaction(async () => {
        // The private User write below fences concurrent canonical wallet
        // changes; a snapshot conflict retries instead of announcing stale data.
        const current = await customer(userId, session);
        result = { ...empty, settings: settingsFor(current) };
        if (typeof current.walletBalance !== "number" ||
            !Number.isFinite(current.walletBalance) || current.walletBalance < 0) return;
        const rows = await Ledger.aggregate([
          { $match: {
            user: current._id, direction: "CREDIT", status: "POSTED",
            reversalOf: null, currency: "NGN",
            amount: { $type: "number", $gt: 0, $lte: Number.MAX_SAFE_INTEGER / 100 },
            openingBalance: { $type: "number", $gte: 0, $lte: Number.MAX_SAFE_INTEGER / 100 },
            closingBalance: { $type: "number", $gte: 0, $lte: Number.MAX_SAFE_INTEGER / 100 },
            reference: { $type: "string", $regex: /\S/ },
            createdAt: { $gte: current.walletCreditAlertsStartedAt },
            $or: [
              { "metadata.walletType": { $exists: false } },
              { "metadata.walletType": "MAIN" },
            ],
          } },
          { $match: { $expr: { $eq: [
            { $add: [
              { $round: [{ $multiply: ["$openingBalance", 100] }, 0] },
              { $round: [{ $multiply: ["$amount", 100] }, 0] },
            ] },
            { $round: [{ $multiply: ["$closingBalance", 100] }, 0] },
          ] } } },
          { $sort: { createdAt: 1, _id: 1 } },
          { $lookup: {
            from: Ledger.collection.name, localField: "_id",
            foreignField: "reversalOf", as: "reversals",
          } },
          { $match: { reversals: { $size: 0 } } },
          { $lookup: {
            from: Transaction.collection.name, localField: "transactionId",
            foreignField: "_id", as: "transactions",
          } },
          { $unwind: { path: "$transactions", preserveNullAndEmptyArrays: true } },
          { $match: { $or: [
            { transactionId: null },
            { "transactions.status": "SUCCESSFUL",
              "transactions.refunded": { $ne: true },
              "transactions.reversed": { $ne: true },
              "transactions.refundedAt": null,
              "transactions.reversedAt": null },
          ] } },
          { $addFields: { alertKey: { $concat: [
            "wallet-credit:", { $toString: "$user" }, ":", { $toString: "$_id" },
          ] } } },
          { $lookup: {
            from: Notification.collection.name, localField: "alertKey",
            foreignField: "dedupeKey", as: "receipts",
          } },
          { $match: { receipts: { $size: 0 } } },
          // No timestamp high-water mark: a late-committing older credit is
          // still discovered. Durable ledger-keyed receipts prevent replay.
          { $limit: 1 },
          { $project: {
            _id: 1, amount: 1, openingBalance: 1, closingBalance: 1,
            currency: 1, reference: 1, createdAt: 1, alertKey: 1,
          } },
        ]).session(session).option({ maxTimeMS: 4000 });
        const entry = rows[0];
        if (!entry || ![entry.amount, entry.openingBalance, entry.closingBalance]
          .every((value) => typeof value === "number" && Number.isFinite(value)) ||
          entry.openingBalance < 0 || entry.closingBalance < 0 ||
          Math.round(entry.amount * 100) + Math.round(entry.openingBalance * 100) !==
            Math.round(entry.closingBalance * 100) ||
          typeof entry.reference !== "string" || !entry.reference.trim()) return;

        // Existing Notification is the durable, unread fallback when a browser
        // disconnects after claiming. Popup handoff is at-most-once, not a claim
        // that an offline/closed browser necessarily displayed or spoke it.
        await Notification.create([{
          userId: current._id, title: "Money Received",
          message: `Your wallet was credited with NGN ${entry.amount.toFixed(2)}. Reference: ${entry.reference}`,
          type: "WALLET", category: "TRANSACTION",
          referenceId: entry._id, referenceType: "WALLET_CREDIT_ALERT",
          reference: entry.reference, relatedStatus: "SUCCESSFUL",
          action: "TRANSACTION", dedupeKey: entry.alertKey, isRead: false,
        }], { session });
        await User.updateOne({ _id: current._id }, {
          $inc: { walletCreditAlertDeliveryVersion: 1 },
        }, { session, timestamps: false });
        result.alert = {
          id: String(entry._id), amount: entry.amount, currency: entry.currency,
          reference: entry.reference, createdAt: entry.createdAt,
          balance: current.walletBalance, creditBalance: entry.closingBalance,
        };
      }, {
        readConcern: { level: "snapshot" }, writeConcern: { w: "majority" },
        maxCommitTimeMS: 5000,
      });
      return result;
    } catch (error) {
      if (error.code === 11000) return empty;
      throw error;
    } finally {
      await session.endSession();
    }
  }
  return { getSettings, updateSettings, nextAlert };
}

module.exports = { createCustomerExperience, settingsFor, validateSettings };
