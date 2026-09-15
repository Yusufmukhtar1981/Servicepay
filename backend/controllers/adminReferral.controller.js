const mongoose = require("mongoose");
const User = require("../models/user.model");
const ReferralRewardClaim = require("../models/referralRewardClaim.model");
const ReferralRewardClawback = require("../models/referralRewardClawback.model");
const ReferralRewardReconciliation = require("../models/referralRewardReconciliation.model");
const Transaction = require("../models/transaction.model");
const Delivery = require("../models/delivery.model");
const MarketplaceOrder = require("../models/marketplaceOrder.model");
const {
  REFERRAL_REWARD_POLICY,
  customerCounts,
} = require("../services/referralReward.service");

const firstName = (value) =>
  String(value || "").trim().split(/\s+/).filter(Boolean)[0] || "";
const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const globalHeadOfficeOnly = (req, res) => {
  if (req.staffAccess?.isHeadOffice !== true || req.staffAccess?.scope?.type !== "GLOBAL") {
    res.status(403).json({
      success: false,
      message: "Referral reporting is restricted to global Head Office scope.",
    });
    return false;
  }
  return true;
};

const safeCustomer = (user) => ({
  id: user._id,
  firstName: firstName(user.fullName),
  status: user.status || "ACTIVE",
  joinedAt: user.createdAt,
});

const progressFor = async (user) => {
  const counts = await customerCounts(user._id);
  return Object.fromEntries(
    Object.entries(counts).map(([category, rows]) => [
      category,
      Math.min(rows.length, REFERRAL_REWARD_POLICY.threshold),
    ])
  );
};

const qualificationStatus = (progress) =>
  Object.values(progress).some((value) => value >= REFERRAL_REWARD_POLICY.threshold)
    ? "QUALIFIED"
    : "PENDING";

const rewardStatusExpression = () => ({
  $switch: {
    branches: [
      {
        case: { $ne: [{ $ifNull: ["$clawbackRows._id", null] }, null] },
        then: "CLAWED_BACK",
      },
      {
        case: { $gt: [{ $size: "$pendingRows" }, 0] },
        then: "PENDING_CLAWBACK",
      },
      {
        case: { $ne: [{ $ifNull: ["$claimRows._id", null] }, null] },
        then: "AWARDED",
      },
    ],
    default: "NOT_ISSUED",
  },
});

const referralReportingStages = ({ userFilter = null } = {}) => {
  const stages = [];
  if (userFilter) stages.push({ $match: userFilter });
  stages.push(
    {
      $lookup: {
        from: Transaction.collection.name,
        let: { customer: "$_id" },
        pipeline: [{
          $match: {
            $expr: {
              $and: [
                { $eq: ["$customerId", "$$customer"] },
                { $eq: ["$serviceType", "DATA"] },
                { $eq: ["$status", "SUCCESSFUL"] },
                { $gte: ["$amount", 500] },
                { $in: [{ $ifNull: ["$reversalReference", null] }, [null, ""]] },
                { $in: [{ $ifNull: ["$reversalTransactionId", null] }, [null, ""]] },
                { $in: [{ $ifNull: ["$reversedTransactionId", null] }, [null, ""]] },
              ],
            },
          },
        }, { $project: { _id: 1 } }],
        as: "dataEvidence",
      },
    },
    {
      $lookup: {
        from: Delivery.collection.name,
        let: { customer: "$_id" },
        pipeline: [{
          $match: {
            $expr: {
              $and: [
                { $eq: ["$customerId", "$$customer"] },
                { $eq: ["$status", "DELIVERED"] },
                { $eq: ["$paymentStatus", "PAID"] },
                { $eq: [{ $ifNull: ["$refundedAt", null] }, null] },
              ],
            },
          },
        }, { $project: { _id: 1 } }],
        as: "deliveryEvidence",
      },
    },
    {
      $lookup: {
        from: MarketplaceOrder.collection.name,
        let: { customer: "$_id" },
        pipeline: [{
          $match: {
            $expr: {
              $and: [
                { $eq: ["$buyer", "$$customer"] },
                { $eq: ["$orderStatus", "DELIVERED"] },
                { $eq: ["$paymentStatus", "PAID"] },
                { $gte: ["$totalAmount", 1000] },
                { $ne: ["$fundsStatus", "REFUNDED"] },
                { $eq: [{ $ifNull: ["$refundedAt", null] }, null] },
              ],
            },
          },
        }, { $project: { _id: 1 } }],
        as: "marketplaceEvidence",
      },
    },
    {
      $lookup: {
        from: ReferralRewardClaim.collection.name,
        localField: "_id",
        foreignField: "referredCustomer",
        as: "claimRows",
      },
    },
    {
      $lookup: {
        from: ReferralRewardClawback.collection.name,
        localField: "_id",
        foreignField: "referredCustomer",
        as: "clawbackRows",
      },
    },
    {
      $lookup: {
        from: ReferralRewardReconciliation.collection.name,
        let: { customer: "$_id" },
        pipeline: [{
          $match: {
            $expr: {
              $and: [
                { $eq: ["$referredCustomer", "$$customer"] },
                { $eq: ["$operation", "CLAWBACK"] },
                { $eq: ["$status", "PENDING"] },
              ],
            },
          },
        }],
        as: "pendingRows",
      },
    },
    { $unwind: { path: "$claimRows", preserveNullAndEmptyArrays: true } },
    { $unwind: { path: "$clawbackRows", preserveNullAndEmptyArrays: true } },
    {
      $set: {
        dataProgress: { $min: [REFERRAL_REWARD_POLICY.threshold, { $size: "$dataEvidence" }] },
        deliveryProgress: { $min: [REFERRAL_REWARD_POLICY.threshold, { $size: "$deliveryEvidence" }] },
        marketplaceProgress: { $min: [REFERRAL_REWARD_POLICY.threshold, { $size: "$marketplaceEvidence" }] },
      },
    },
    {
      $set: {
        winningCategory: {
          $cond: [
            { $ne: [{ $ifNull: ["$claimRows.category", null] }, null] },
            "$claimRows.category",
            {
              $switch: {
                branches: [
                  {
                    case: {
                      $and: [
                        { $gt: ["$dataProgress", 0] },
                        { $gte: ["$dataProgress", "$deliveryProgress"] },
                        { $gte: ["$dataProgress", "$marketplaceProgress"] },
                      ],
                    },
                    then: "DATA",
                  },
                  {
                    case: {
                      $and: [
                        { $gt: ["$deliveryProgress", 0] },
                        { $gte: ["$deliveryProgress", "$marketplaceProgress"] },
                      ],
                    },
                    then: "DELIVERY",
                  },
                  {
                    case: { $gt: ["$marketplaceProgress", 0] },
                    then: "MARKETPLACE",
                  },
                ],
                default: null,
              },
            },
          ],
        },
        currentlyQualified: {
          $or: [
            { $gte: ["$dataProgress", REFERRAL_REWARD_POLICY.threshold] },
            { $gte: ["$deliveryProgress", REFERRAL_REWARD_POLICY.threshold] },
            { $gte: ["$marketplaceProgress", REFERRAL_REWARD_POLICY.threshold] },
          ],
        },
      },
    }
    ,
    { $set: { rewardStatus: rewardStatusExpression() } }
  );
  return stages;
};

exports.summary = async (req, res) => {
  if (!globalHeadOfficeOnly(req, res)) return;
  try {
    const [stats] = await User.aggregate([
      ...referralReportingStages({
        userFilter: { role: "CUSTOMER", referredBy: { $exists: true, $ne: null } },
      }),
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          qualified: { $sum: { $cond: ["$currentlyQualified", 1, 0] } },
          awardedClaims: { $sum: { $cond: [{ $ne: [{ $ifNull: ["$claimRows._id", null] }, null] }, 1, 0] } },
          paid: { $sum: { $cond: [{ $eq: ["$rewardStatus", "AWARDED"] }, 1, 0] } },
          clawedBack: { $sum: { $cond: [{ $eq: ["$rewardStatus", "CLAWED_BACK"] }, 1, 0] } },
          pendingClawback: { $sum: { $cond: [{ $eq: ["$rewardStatus", "PENDING_CLAWBACK"] }, 1, 0] } },
          currentlyPending: { $sum: { $cond: [{ $and: [{ $eq: ["$rewardStatus", "NOT_ISSUED"] }, { $not: ["$currentlyQualified"] }] }, 1, 0] } },
          qualifiedWaiting: { $sum: { $cond: [{ $and: ["$currentlyQualified", { $eq: ["$rewardStatus", "NOT_ISSUED"] }] }, 1, 0] } },
          value: { $sum: { $cond: [{ $eq: ["$rewardStatus", "AWARDED"] }, REFERRAL_REWARD_POLICY.amount, 0] } },
        },
      },
    ]);
    const categoryRows = await User.aggregate([
      ...referralReportingStages({
        userFilter: { role: "CUSTOMER", referredBy: { $exists: true, $ne: null } },
      }),
      { $match: { winningCategory: { $ne: null } } },
      {
        $group: {
          _id: "$winningCategory",
          total: { $sum: 1 },
          qualified: { $sum: { $cond: ["$currentlyQualified", 1, 0] } },
          paid: { $sum: { $cond: [{ $eq: ["$rewardStatus", "AWARDED"] }, 1, 0] } },
          clawedBack: { $sum: { $cond: [{ $eq: ["$rewardStatus", "CLAWED_BACK"] }, 1, 0] } },
        },
      },
    ]);
    const summary = {
      total: stats?.total || 0,
      attributedReferrals: stats?.total || 0,
      pending: stats?.currentlyPending || 0,
      qualified: stats?.qualified || 0,
      qualifiedWaiting: stats?.qualifiedWaiting || 0,
      paid: stats?.paid || 0,
      clawbacks: stats?.clawedBack || 0,
      pendingClawbacks: stats?.pendingClawback || 0,
      value: stats?.value || 0,
      totalActiveRewardValue: stats?.value || 0,
      awardedClaims: stats?.awardedClaims || 0,
      netAmount: stats?.value || 0,
      awardedAmount: (stats?.paid || 0) * REFERRAL_REWARD_POLICY.amount,
      clawedBackAmount: (stats?.clawedBack || 0) * REFERRAL_REWARD_POLICY.amount,
      byCategory: Object.fromEntries(categoryRows.map((row) => [
        row._id,
        { ...row, value: (row.paid || 0) * REFERRAL_REWARD_POLICY.amount },
      ])),
    };
    return res.json({
      success: true,
      policy: REFERRAL_REWARD_POLICY,
      summary,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to load referral summary." });
  }
};

exports.readiness = async (req, res) => {
  if (!globalHeadOfficeOnly(req, res)) return;
  try {
    const models = {
      rewardClaim: ReferralRewardClaim,
      rewardClawback: ReferralRewardClawback,
      reconciliationQueue: ReferralRewardReconciliation,
      dataEvidence: Transaction,
      deliveryEvidence: Delivery,
      marketplaceEvidence: MarketplaceOrder,
    };
    const required = {
      rewardClaim: [
        { key: { referredCustomer: 1 }, unique: true },
      ],
      rewardClawback: [
        { key: { claim: 1 }, unique: true },
        { key: { referredCustomer: 1 }, unique: true },
      ],
      reconciliationQueue: [
        { key: { key: 1 }, unique: true },
        { key: { status: 1, nextAttemptAt: 1 } },
      ],
      dataEvidence: [
        { key: { customerId: 1, status: 1, serviceType: 1, createdAt: 1 } },
      ],
      deliveryEvidence: [
        { key: { customerId: 1, status: 1, paymentStatus: 1, createdAt: 1 } },
      ],
      marketplaceEvidence: [
        { key: { buyer: 1, orderStatus: 1, paymentStatus: 1, totalAmount: 1, fundsStatus: 1, createdAt: 1 } },
      ],
    };
    const indexes = {};
    const mismatches = [];
    for (const [name, model] of Object.entries(models)) {
      indexes[name] = await model.collection.indexes();
      for (const expected of required[name]) {
        const actual = indexes[name].find((candidate) =>
          JSON.stringify(candidate.key) === JSON.stringify(expected.key) &&
          (expected.unique === undefined || candidate.unique === expected.unique)
        );
        if (!actual) mismatches.push({ model: name, expected });
      }
    }
    if (mismatches.length) {
      return res.status(503).json({
        success: false,
        message: "Referral readiness indexes are missing or mismatched.",
        mismatches,
        indexes,
      });
    }
    return res.json({
      success: true,
      policyStatus: REFERRAL_REWARD_POLICY.status,
      immutableClaimKey: "referredCustomer",
      immutableClawbackKeys: ["claim", "referredCustomer"],
      indexes,
      required,
    });
  } catch (error) {
    return res.status(503).json({ success: false, message: "Referral readiness indexes are unavailable." });
  }
};

exports.search = async (req, res) => {
  if (!globalHeadOfficeOnly(req, res)) return;
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const category = String(req.query.category || "").trim().toUpperCase();
    const requestedRewardStatus = String(req.query.rewardStatus || "").trim().toUpperCase();
    const rewardReference = String(req.query.rewardReference || "").trim();
    const query = String(req.query.q || "").trim();
    const userFilter = { role: "CUSTOMER", referredBy: { $exists: true, $ne: null } };
    if (req.query.status) userFilter.status = String(req.query.status).trim().toUpperCase();
    if (query) {
      const terms = [{ fullName: { $regex: escapeRegex(query.slice(0, 100)), $options: "i" } }];
      if (mongoose.isValidObjectId(query)) terms.push({ _id: query });
      userFilter.$or = terms;
    }
    const reportingStages = referralReportingStages({ userFilter });
    if (category && ["DATA", "DELIVERY", "MARKETPLACE"].includes(category)) {
      reportingStages.push({ $match: { winningCategory: category } });
    }
    if (requestedRewardStatus === "AWARDED") {
      reportingStages.push({ $match: { rewardStatus: "AWARDED" } });
    } else if (requestedRewardStatus === "CLAWED_BACK") {
      reportingStages.push({ $match: { rewardStatus: "CLAWED_BACK" } });
    } else if (requestedRewardStatus === "PENDING_CLAWBACK") {
      reportingStages.push({ $match: { rewardStatus: "PENDING_CLAWBACK" } });
    } else if (requestedRewardStatus === "NOT_ISSUED") {
      reportingStages.push({ $match: { rewardStatus: "NOT_ISSUED" } });
    } else if (requestedRewardStatus === "QUALIFIED_WAITING") {
      reportingStages.push({ $match: { currentlyQualified: true, rewardStatus: "NOT_ISSUED" } });
    }
    if (rewardReference) {
      reportingStages.push({
        $match: {
          $or: [
            { "claimRows.ledgerReference": rewardReference },
            { "clawbackRows.ledgerReference": rewardReference },
          ],
        },
      });
    }
    reportingStages.push({
      $facet: {
        metadata: [{ $count: "total" }],
        rows: [
          { $sort: { createdAt: -1, _id: -1 } },
          { $skip: (page - 1) * limit },
          { $limit: limit },
          {
            $project: {
              _id: 0,
              customer: {
                id: "$_id",
                firstName: { $arrayElemAt: [{ $split: [{ $trim: { input: "$fullName" } }, " "] }, 0] },
                status: 1,
                joinedAt: "$createdAt",
              },
              referrerId: "$referredBy",
              category: "$winningCategory",
              progress: { DATA: "$dataProgress", DELIVERY: "$deliveryProgress", MARKETPLACE: "$marketplaceProgress" },
              qualificationStatus: { $cond: ["$currentlyQualified", "QUALIFIED", "PENDING"] },
              rewardStatus: "$rewardStatus",
              rewardReference: "$claimRows.ledgerReference",
              clawbackReference: "$clawbackRows.ledgerReference",
              pendingClawback: { $cond: [{ $gt: [{ $size: "$pendingRows" }, 0] }, { $arrayElemAt: ["$pendingRows", 0] }, null] },
              claimId: "$claimRows._id",
            },
          },
        ],
      },
    });
    const [report] = await User.aggregate(reportingStages);
    const total = report?.metadata?.[0]?.total || 0;
    return res.json({
      success: true,
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
      rows: report?.rows || [],
    });

  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to search referral records." });
  }
};

exports.progress = async (req, res) => {
  if (!globalHeadOfficeOnly(req, res)) return;
  try {
    if (!mongoose.isValidObjectId(req.params.customerId)) {
      return res.status(400).json({ success: false, message: "Invalid customer ID." });
    }
    const customer = await User.findOne({
      _id: req.params.customerId,
      role: "CUSTOMER",
      referredBy: { $exists: true, $ne: null },
    }).select("_id fullName status createdAt referredBy").lean();
    if (!customer) return res.status(404).json({ success: false, message: "Referral customer not found." });
    const progress = await progressFor(customer);
    const [claim, clawback, pending] = await Promise.all([
      ReferralRewardClaim.findOne({ referredCustomer: customer._id }).select("category status amount ledgerReference awardedAt").lean(),
      ReferralRewardClawback.findOne({ referredCustomer: customer._id }).select("ledgerReference reversedAt").lean(),
      ReferralRewardReconciliation.findOne({ referredCustomer: customer._id, operation: "CLAWBACK", status: "PENDING" }).select("attempts nextAttemptAt lastError").lean(),
    ]);
    return res.json({
      success: true,
      customer: safeCustomer(customer),
      referrerId: customer.referredBy,
      progress,
      qualificationStatus: qualificationStatus(progress, claim),
      rewardStatus: clawback ? "CLAWED_BACK" : pending ? "PENDING_CLAWBACK" : claim?.status || "NOT_ISSUED",
      rewardReference: claim?.ledgerReference || null,
      clawbackReference: clawback?.ledgerReference || null,
      pendingClawback: pending || null,
      claim: claim ? { id: claim._id, category: claim.category, amount: claim.amount, awardedAt: claim.awardedAt } : null,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to load referral progress." });
  }
};

exports.audit = async (req, res) => {
  if (!globalHeadOfficeOnly(req, res)) return;
  try {
    if (!mongoose.isValidObjectId(req.params.customerId)) {
      return res.status(400).json({ success: false, message: "Invalid customer ID." });
    }
    const [claim, clawback] = await Promise.all([
      ReferralRewardClaim.findOne({ referredCustomer: req.params.customerId })
        .select("_id category amount status ledgerReference awardedAt createdAt")
        .lean(),
      ReferralRewardClawback.findOne({ referredCustomer: req.params.customerId })
        .select("_id category amount reason ledgerReference reversedAt createdAt")
        .lean(),
    ]);
    const auditHistory = [];
    if (claim) auditHistory.push({
      event: "REWARD_AWARDED",
      claimId: claim._id,
      category: claim.category,
      amount: claim.amount,
      status: claim.status,
      rewardReference: claim.ledgerReference,
      occurredAt: claim.awardedAt || claim.createdAt,
    });
    if (clawback) auditHistory.push({
      event: "REWARD_CLAWED_BACK",
      clawbackId: clawback._id,
      category: clawback.category,
      amount: clawback.amount,
      reason: clawback.reason,
      reversalReference: clawback.ledgerReference,
      occurredAt: clawback.reversedAt || clawback.createdAt,
    });
    return res.json({ success: true, auditHistory });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to load referral audit history." });
  }
};