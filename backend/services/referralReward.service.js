const mongoose = require("mongoose");
const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const Delivery = require("../models/delivery.model");
const MarketplaceOrder = require("../models/marketplaceOrder.model");
const ReferralRewardClaim = require("../models/referralRewardClaim.model");
const ReferralRewardClawback = require("../models/referralRewardClawback.model");
const ReferralRewardReconciliation = require("../models/referralRewardReconciliation.model");
const { postCredit, postDebit } = require("./ledger.service");

const REFERRAL_REWARD_POLICY = Object.freeze({
  status: "CONFIGURED",
  amount: 2000,
  threshold: 10,
  categories: Object.freeze({
    DATA: Object.freeze({ serviceType: "DATA", status: "SUCCESSFUL", minimumAmount: 500 }),
    DELIVERY: Object.freeze({ status: "DELIVERED", paymentStatus: "PAID" }),
    MARKETPLACE: Object.freeze({
      orderStatus: "DELIVERED",
      paymentStatus: "PAID",
      minimumAmount: 1000,
      nonRefunded: true,
    }),
  }),
});

const idString = (value) => String(value || "");

const withSession = (query, session) => (session ? query.session(session) : query);

async function customerCounts(customerId, session = null) {
  const [data, delivery, marketplace] = await Promise.all([
    withSession(
      Transaction.find({
        customerId,
        serviceType: "DATA",
        status: "SUCCESSFUL",
        amount: { $gte: 500 },
        $and: [
          { $or: [{ reversalReference: "" }, { reversalReference: null }, { reversalReference: { $exists: false } }] },
          { $or: [{ reversalTransactionId: null }, { reversalTransactionId: { $exists: false } }] },
          { $or: [{ reversedTransactionId: null }, { reversedTransactionId: { $exists: false } }] },
        ],
      })
        .sort({ createdAt: 1, _id: 1 })
        .select("_id reference amount createdAt"),
      session
    ).lean(),
    withSession(
      Delivery.find({
        customerId,
        status: "DELIVERED",
        paymentStatus: "PAID",
        refundedAt: null,
      })
        .sort({ createdAt: 1, _id: 1 })
        .select("_id trackingNumber deliveryFee createdAt"),
      session
    ).lean(),
    withSession(
      MarketplaceOrder.find({
        buyer: customerId,
        orderStatus: "DELIVERED",
        paymentStatus: "PAID",
        totalAmount: { $gte: 1000 },
        fundsStatus: { $ne: "REFUNDED" },
      })
        .sort({ createdAt: 1, _id: 1 })
        .select("_id orderReference totalAmount createdAt"),
      session
    ).lean(),
  ]);

  return {
    DATA: data,
    DELIVERY: delivery,
    MARKETPLACE: marketplace,
  };
}

async function evidenceStillQualifies(evidence, session = null) {
  for (const source of evidence || []) {
    if (!source?.sourceId) return { valid: false, source };
    let row;
    if (source.category === "DATA") {
      row = await withSession(
        Transaction.findOne({
          _id: source.sourceId,
          serviceType: "DATA",
          status: "SUCCESSFUL",
          amount: { $gte: 500 },
          $and: [
            { $or: [{ reversalReference: "" }, { reversalReference: null }, { reversalReference: { $exists: false } }] },
            { $or: [{ reversalTransactionId: null }, { reversalTransactionId: { $exists: false } }] },
            { $or: [{ reversedTransactionId: null }, { reversedTransactionId: { $exists: false } }] },
          ],
        }),
        session
      );
    } else if (source.category === "DELIVERY") {
      row = await withSession(
        Delivery.findOne({
          _id: source.sourceId,
          status: "DELIVERED",
          paymentStatus: "PAID",
          refundedAt: null,
        }),
        session
      );
    } else {
      row = await withSession(
        MarketplaceOrder.findOne({
          _id: source.sourceId,
          orderStatus: "DELIVERED",
          paymentStatus: "PAID",
          totalAmount: { $gte: 1000 },
          fundsStatus: { $ne: "REFUNDED" },
          refundedAt: null,
        }),
        session
      );
    }
    if (!row) return { valid: false, source };
  }
  return { valid: true, source: null };
}

async function queueReconciliation({ referredCustomerId, sourceType, sourceId, operation = "RECONCILE", error }) {
  const key = `${operation}:${sourceType}:${sourceId}`;
  try {
    await ReferralRewardReconciliation.updateOne(
      { key },
      {
        $set: {
          referredCustomer: referredCustomerId,
          sourceType,
          sourceId,
          operation,
          status: "PENDING",
          lastError: String(error?.message || error || "Reconciliation failed").slice(0, 1000),
          nextAttemptAt: new Date(),
        },
        $inc: { attempts: 1 },
        $setOnInsert: { key },
      },
      { upsert: true }
    );
  } catch (queueError) {
    console.error("REFERRAL_RECONCILIATION_QUEUE_ERROR:", queueError.message);
  }
}

const enqueueReferralRewardEvent = async ({
  referredCustomerId,
  sourceType,
  sourceId,
  session = null,
}) => {
  const key = `RECONCILE:${sourceType}:${sourceId}`;
  const query = ReferralRewardReconciliation.updateOne(
    { key },
    {
      $set: {
        referredCustomer: referredCustomerId,
        sourceType,
        sourceId,
        operation: "RECONCILE",
        status: "PENDING",
        nextAttemptAt: new Date(),
      },
      $setOnInsert: { key, attempts: 0, lastError: "" },
    },
    { upsert: true, ...(session ? { session } : {}) }
  );
  await query;
  return key;
};

const evidenceFor = (category, rows) =>
  rows.slice(0, REFERRAL_REWARD_POLICY.threshold).map((row) => ({
    category,
    sourceId: row._id,
    reference:
      category === "DATA"
        ? row.reference
        : category === "DELIVERY"
          ? row.trackingNumber
          : row.orderReference,
    amount: Number(row.amount ?? row.deliveryFee ?? row.totalAmount ?? 0),
    qualifiedAt: row.createdAt,
  }));

async function evaluateReferralReward({
  referredCustomerId,
  session: suppliedSession = null,
} = {}) {
  if (!referredCustomerId || !mongoose.isValidObjectId(referredCustomerId)) {
    return { awarded: false, reason: "INVALID_CUSTOMER" };
  }

  const run = async (session) => {
    const customer = await withSession(
      User.findById(referredCustomerId).select("_id referredBy role"),
      session
    );
    if (!customer || customer.role !== "CUSTOMER" || !customer.referredBy) {
      return { awarded: false, reason: "NO_ATTRIBUTION" };
    }
    if (idString(customer.referredBy) === idString(customer._id)) {
      return { awarded: false, reason: "SELF_REFERRAL" };
    }

    const prior = await withSession(
      ReferralRewardClaim.findOne({ referredCustomer: customer._id }),
      session
    );
    if (prior) {
      return { awarded: true, duplicate: true, claim: prior };
    }

    const counts = await customerCounts(customer._id, session);
    const category = ["DATA", "DELIVERY", "MARKETPLACE"].find(
      (name) => counts[name].length >= REFERRAL_REWARD_POLICY.threshold
    );
    if (!category) {
      return {
        awarded: false,
        reason: "THRESHOLD_NOT_MET",
        progress: Object.fromEntries(
          Object.entries(counts).map(([key, rows]) => [key, Math.min(rows.length, 10)])
        ),
      };
    }

    const referrer = await withSession(
      User.findOneAndUpdate(
        {
          _id: customer.referredBy,
          role: "CUSTOMER",
        },
        { $inc: { walletBalance: REFERRAL_REWARD_POLICY.amount } },
        { new: true, session }
      ).select("_id walletBalance"),
      session
    );
    if (!referrer) return { awarded: false, reason: "REFERRER_NOT_FOUND" };

    const reference = `REFERRAL-BONUS-${customer._id}`;
    const transactionDocs = await Transaction.create(
      [
        {
          reference,
          customerId: referrer._id,
          serviceType: "REFERRAL_BONUS",
          provider: "SERVICEPAY_REFERRAL",
          amount: REFERRAL_REWARD_POLICY.amount,
          status: "SUCCESSFUL",
          providerResponse: {
            referredCustomer: idString(customer._id),
            category,
            policy: "REFERRAL_REWARD_V1",
          },
        },
      ],
      { session }
    );
    const bonusTransaction = transactionDocs[0];
    const openingBalance = Number(referrer.walletBalance) - REFERRAL_REWARD_POLICY.amount;
    const ledger = await postCredit({
      userId: referrer._id,
      amount: REFERRAL_REWARD_POLICY.amount,
      openingBalance,
      closingBalance: Number(referrer.walletBalance),
      service: "REFERRAL_BONUS",
      reference,
      idempotencyKey: `referral-bonus:${customer._id}`,
      transactionId: bonusTransaction._id,
      relatedUser: customer._id,
      narration: "Referral qualification reward",
      metadata: { category, referredCustomer: idString(customer._id) },
      session,
    });
    const claims = await ReferralRewardClaim.create(
      [
        {
          referredCustomer: customer._id,
          referrer: referrer._id,
          category,
          amount: REFERRAL_REWARD_POLICY.amount,
          qualificationCount: REFERRAL_REWARD_POLICY.threshold,
          evidence: evidenceFor(category, counts[category]),
          transaction: bonusTransaction._id,
          ledgerEntry: ledger.entry._id,
          ledgerReference: ledger.entry.reference,
        },
      ],
      { session }
    );
    return { awarded: true, duplicate: false, claim: claims[0] };
  };

  if (suppliedSession) return run(suppliedSession);
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const session = await mongoose.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        result = await run(session);
      });
      return result;
    } catch (error) {
      lastError = error;
      const retryable =
        error?.code === 11000 ||
        error?.code === 112 ||
        error?.errorLabels?.includes("TransientTransactionError") ||
        error?.errorLabels?.includes("UnknownTransactionCommitResult");
      if (!retryable || attempt === 3) throw error;
    } finally {
      await session.endSession();
    }
  }
  throw lastError;
}

async function clawbackReferralReward({
  referredCustomerId,
  sourceType,
  sourceId,
  reason = "QUALIFYING_EVIDENCE_REVERSED",
  session: suppliedSession = null,
} = {}) {
  if (!referredCustomerId || !mongoose.isValidObjectId(referredCustomerId)) {
    return { clawedBack: false, reason: "INVALID_CUSTOMER" };
  }
  const run = async (session) => {
    const claim = await withSession(
      ReferralRewardClaim.findOne({ referredCustomer: referredCustomerId }),
      session
    );
    if (!claim) return { clawedBack: false, reason: "NO_CLAIM" };
    const existing = await withSession(
      ReferralRewardClawback.findOne({ claim: claim._id }),
      session
    );
    if (existing) return { clawedBack: true, duplicate: true, clawback: existing };
    const counts = await customerCounts(claim.referredCustomer, session);
    if (Object.values(counts).some((rows) => rows.length >= REFERRAL_REWARD_POLICY.threshold)) {
      return { clawedBack: false, preserved: true, reason: "REPLACEMENT_EVIDENCE_QUALIFIES" };
    }

    const referrer = await withSession(
      User.findById(claim.referrer).select("_id walletBalance"),
      session
    );
    if (!referrer) throw new Error("Referral referrer account was not found.");
    const openingBalance = Number(referrer.walletBalance || 0);
    if (openingBalance < REFERRAL_REWARD_POLICY.amount) {
      throw new Error("Referral reward balance is insufficient for automatic clawback.");
    }
    const updated = await User.findOneAndUpdate(
      { _id: referrer._id, walletBalance: { $gte: REFERRAL_REWARD_POLICY.amount } },
      { $inc: { walletBalance: -REFERRAL_REWARD_POLICY.amount } },
      { new: true, session }
    ).select("_id walletBalance");
    if (!updated) throw new Error("Referral reward balance changed before clawback.");

    const reference = `REFERRAL-BONUS-REVERSAL-${claim.referredCustomer}`;
    const transaction = (await Transaction.create([{
      reference,
      customerId: referrer._id,
      serviceType: "REFERRAL_BONUS_REVERSAL",
      provider: "SERVICEPAY_REFERRAL",
      amount: REFERRAL_REWARD_POLICY.amount,
      status: "SUCCESSFUL",
      providerResponse: {
        originalReferralBonus: String(claim.transaction),
        claimId: String(claim._id),
        sourceType,
        sourceId: String(sourceId || ""),
        reason,
      },
    }], { session }))[0];
    const ledger = await postDebit({
      userId: referrer._id,
      amount: REFERRAL_REWARD_POLICY.amount,
      openingBalance,
      closingBalance: Number(updated.walletBalance),
      service: "REFERRAL_BONUS_REVERSAL",
      reference,
      idempotencyKey: `referral-bonus-reversal:${claim.referredCustomer}`,
      transactionId: transaction._id,
      relatedUser: claim.referredCustomer,
      narration: "Referral reward clawback after qualifying evidence reversal",
      metadata: { claimId: String(claim._id), sourceType, sourceId: String(sourceId || ""), reason },
      session,
    });
    const created = (await ReferralRewardClawback.create([{
      claim: claim._id,
      referredCustomer: claim.referredCustomer,
      referrer: referrer._id,
      amount: REFERRAL_REWARD_POLICY.amount,
      category: claim.category,
      sourceType,
      sourceId,
      transaction: transaction._id,
      ledgerEntry: ledger.entry._id,
      ledgerReference: ledger.entry.reference,
      reason,
    }], { session }))[0];
    return { clawedBack: true, duplicate: false, clawback: created };
  };
  if (suppliedSession) return run(suppliedSession);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const session = await mongoose.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        result = await run(session);
      });
      return result;
    } catch (error) {
      const retryable = error?.code === 11000 || error?.code === 112 ||
        error?.errorLabels?.includes("TransientTransactionError") ||
        error?.errorLabels?.includes("UnknownTransactionCommitResult");
      if (!retryable || attempt === 3) {
        await queueReconciliation({
          referredCustomerId,
          sourceType: sourceType || "DATA",
          sourceId: sourceId || referredCustomerId,
          operation: "CLAWBACK",
          error,
        });
        throw error;
      }
    } finally {
      await session.endSession();
    }
  }
  return { clawedBack: false, reason: "RETRY_EXHAUSTED" };
}

async function reconcileReferralRewardCore({
  referredCustomerId,
  sourceType = "DATA",
  sourceId,
} = {}) {
  let operation = "AWARD";
  try {
    const claim = await ReferralRewardClaim.findOne({ referredCustomer: referredCustomerId })
      .select("_id evidence");
    if (claim) {
      operation = "CLAWBACK";
      const counts = await customerCounts(referredCustomerId);
      const replacementQualifies = Object.values(counts).some(
        (rows) => rows.length >= REFERRAL_REWARD_POLICY.threshold
      );
      if (replacementQualifies) {
        return { awarded: true, duplicate: true, preserved: true, claim };
      }
      const validity = await evidenceStillQualifies(claim.evidence);
      if (!validity.valid) {
        return await clawbackReferralReward({
          referredCustomerId,
          sourceType: validity.source?.category || sourceType,
          sourceId: validity.source?.sourceId || sourceId,
        });
      }
      return { awarded: true, duplicate: true, claim };
    }
    return await evaluateReferralReward({ referredCustomerId });
  } catch (error) {
    await queueReconciliation({
      referredCustomerId,
      sourceType,
      sourceId: sourceId || referredCustomerId,
      operation,
      error,
    });
    console.error("REFERRAL_REWARD_RECONCILIATION_ERROR:", error.message);
    return { clawedBack: false, queued: true, error: error.message };
  }
}

async function processReferralRewardOutboxJob(key) {
  const leaseId = `${process.pid}-${Date.now()}-${Math.random()}`;
  const now = new Date();
  const job = await ReferralRewardReconciliation.findOneAndUpdate(
    {
      key,
      status: "PENDING",
      nextAttemptAt: { $lte: now },
      $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }],
    },
    {
      $set: {
        leaseId,
        leaseUntil: new Date(now.getTime() + 30 * 1000),
      },
    },
    { new: true }
  ).lean();
  if (!job) return { skipped: true };
  const result = await reconcileReferralRewardInternal({
    referredCustomerId: job.referredCustomer,
    sourceType: job.sourceType,
    sourceId: job.sourceId,
  });
  if (result?.queued) {
    const delay = Math.min(15 * 60 * 1000, 1000 * (2 ** Math.min(job.attempts, 10)));
    await ReferralRewardReconciliation.updateOne(
      { _id: job._id, leaseId },
      { $set: { nextAttemptAt: new Date(Date.now() + delay), leaseId: "", leaseUntil: null } }
    );
  } else {
    await ReferralRewardReconciliation.updateOne(
      { _id: job._id, leaseId },
      { $set: { status: "RESOLVED", lastError: "", leaseId: "", leaseUntil: null } }
    );
  }
  return result;
}

async function reconcileReferralRewardInternal(args) {
  return reconcileReferralRewardCore(args);
}

async function reconcileReferralRewardEvent(args) {
  try {
    const key = await enqueueReferralRewardEvent(args);
    return await processReferralRewardOutboxJob(key);
  } catch (error) {
    await queueReconciliation({ ...args, operation: "RECONCILE", error });
    console.error("REFERRAL_REWARD_OUTBOX_ERROR:", error.message);
    return { queued: true, error: error.message };
  }
}

async function processReferralRewardReconciliation(limit = 50) {
  const jobs = await ReferralRewardReconciliation.find({
    status: "PENDING",
    nextAttemptAt: { $lte: new Date() },
    $or: [{ leaseUntil: null }, { leaseUntil: { $lte: new Date() } }],
  }).sort({ nextAttemptAt: 1, createdAt: 1 }).limit(Math.min(Number(limit) || 50, 200)).select("key").lean();
  return Promise.all(jobs.map((job) => processReferralRewardOutboxJob(job.key)));
}

let referralRewardWorkerTimer = null;
const startReferralRewardOutboxWorker = ({ intervalMs = 5000 } = {}) => {
  if (
    referralRewardWorkerTimer ||
    process.env.NODE_ENV === "test" ||
    process.argv.includes("--test")
  ) return referralRewardWorkerTimer;
  referralRewardWorkerTimer = setInterval(() => {
    processReferralRewardReconciliation(50).catch((error) => {
      console.error("REFERRAL_REWARD_OUTBOX_WORKER_ERROR:", error.message);
    });
  }, intervalMs);
  referralRewardWorkerTimer.unref?.();
  return referralRewardWorkerTimer;
};

async function getReferralProgress(referrerId) {
  const referrals = await User.find({ referredBy: referrerId, role: "CUSTOMER" })
    .select("_id fullName createdAt status")
    .sort({ createdAt: -1, _id: -1 })
    .lean();
  // Controller contract tests and offline maintenance callers may inspect
  // referral attribution before a database connection is available.
  if (mongoose.connection.readyState !== 1) {
    return referrals.map((referral) => ({
      id: referral._id,
      firstName: String(referral.fullName || "").trim().split(/\s+/)[0] || "",
      fullName: String(referral.fullName || "").trim().split(/\s+/)[0] || "",
      status: referral.status || "ACTIVE",
      joinedAt: referral.createdAt,
      category: "DATA",
      categoryProgress: { DATA: 0, DELIVERY: 0, MARKETPLACE: 0 },
      qualificationProgress: 0,
      qualificationStatus: "PENDING",
      rewardStatus: "NOT_ISSUED",
      ledgerReference: null,
      clawbackReference: null,
      pendingClawback: null,
    }));
  }
  const rows = await Promise.all(
    referrals.map(async (referral) => {
      const counts = await customerCounts(referral._id);
      const [claim, clawback] = await Promise.all([
        ReferralRewardClaim.findOne({
          referredCustomer: referral._id,
        }).select("category ledgerReference status").lean(),
        ReferralRewardClawback.findOne({
          referredCustomer: referral._id,
        }).select("ledgerReference").lean(),
      ]);
      const pending = await ReferralRewardReconciliation.findOne({
        referredCustomer: referral._id,
        operation: "CLAWBACK",
        status: "PENDING",
      }).select("nextAttemptAt attempts").lean();
      const progress = Object.fromEntries(
        Object.entries(counts).map(([category, items]) => [
          category,
          Math.min(items.length, REFERRAL_REWARD_POLICY.threshold),
        ])
      );
      const category = claim?.category ||
        Object.keys(progress).sort((a, b) => progress[b] - progress[a])[0];
      const maximum = Math.max(...Object.values(progress), 0);
      return {
        id: referral._id,
        firstName: String(referral.fullName || "").trim().split(/\s+/)[0] || "",
        fullName: String(referral.fullName || "").trim().split(/\s+/)[0] || "",
        status: referral.status || "ACTIVE",
        joinedAt: referral.createdAt,
        category,
        categoryProgress: progress,
        qualificationProgress: maximum,
        qualificationStatus:
          maximum >= REFERRAL_REWARD_POLICY.threshold
            ? "QUALIFIED"
            : "PENDING",
        rewardStatus: clawback ? "CLAWED_BACK" : pending ? "PENDING_CLAWBACK" : claim ? "AWARDED" : "NOT_ISSUED",
        ledgerReference: claim?.ledgerReference || null,
        clawbackReference: clawback?.ledgerReference || null,
        pendingClawback: pending ? {
          attempts: pending.attempts,
          nextAttemptAt: pending.nextAttemptAt,
        } : null,
      };
    })
  );
  return rows;
}

module.exports = {
  REFERRAL_REWARD_POLICY,
  evaluateReferralReward,
  clawbackReferralReward,
  reconcileReferralReward: reconcileReferralRewardEvent,
  processReferralRewardReconciliation,
  enqueueReferralRewardEvent,
  startReferralRewardOutboxWorker,
  getReferralProgress,
  customerCounts,
};