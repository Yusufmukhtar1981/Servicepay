const crypto = require("crypto");

const User = require("../models/user.model");
const PaymentLink = require("../models/paymentLink.model");
const MoneyRequest = require("../models/moneyRequest.model");
const BusinessWallet = require("../models/businessWallet.model");
const GroupWallet = require("../models/groupWallet.model");
const GroupContribution = require("../models/groupContribution.model");
const GroupWalletLedger = require("../models/groupWalletLedger.model");
const GroupWalletActivity = require("../models/groupWalletActivity.model");
const FeaturePayment = require("../models/featurePayment.model");
const Notification = require("../models/notification.model");
const mongoose = require("mongoose");
const {
  verifyTransactionPin: verifyCanonicalTransactionPin,
} = require("../services/transactionPin.service");

const userId = (req) =>
  req.user?._id || req.user?.id;

const shortCode = () =>
  crypto
    .randomBytes(5)
    .toString("hex")
    .toUpperCase();

const objectId = (value) => String(value?._id || value || "");

const activeMembership = (member) =>
  String(member?.membershipStatus || member?.status || "ACTIVE").toUpperCase() ===
  "ACTIVE";

const contributionDueDate = (frequency, date = new Date()) => {
  const next = new Date(date);
  const normalized = String(frequency || "MONTHLY").toUpperCase();
  if (normalized === "DAILY") next.setDate(next.getDate() + 1);
  else if (normalized === "WEEKLY") next.setDate(next.getDate() + 7);
  else next.setMonth(next.getMonth() + 1);
  return next;
};

const currentScheduledDate = (group, now = new Date()) => {
  let scheduled = group.nextContributionDate ? new Date(group.nextContributionDate) : contributionDueDate(group.frequency, group.createdAt || now);
  while (scheduled <= now) {
    scheduled = contributionDueDate(group.frequency, scheduled);
  }
  return scheduled;
};

const contributionCycle = (frequency, date = new Date()) => {
  const value = new Date(date);
  const normalized = String(frequency || "MONTHLY").toUpperCase();
  if (normalized === "MONTHLY") return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
  if (normalized === "DAILY") return value.toISOString().slice(0, 10);
  const weekStart = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7));
  return weekStart.toISOString().slice(0, 10);
};

const memberUserId = (member) => objectId(member?.userId || member?.user);

const normalizeGroup = (group, { persist = false } = {}) => {
  const leaderId = objectId(group.leaderUserId || group.owner);
  const legacyName = String(group.groupName || group.name || "Ajo Group").trim();
  if (persist) {
    if (!group.leaderUserId) group.leaderUserId = group.owner;
    if (!group.groupName) group.groupName = legacyName;
    if (!group.groupId) group.groupId = `AJO-${String(group._id).slice(-10).toUpperCase()}`;
    if (!group.nextContributionDate && String(group.status || "ACTIVE").toUpperCase() === "ACTIVE") {
      group.nextContributionDate = contributionDueDate(group.frequency, group.createdAt || new Date());
    }
  }

  const sourceMembers = Array.isArray(group.members) ? group.members : [];
  const members = sourceMembers.map((member) => {
    const userId = memberUserId(member);
    const isLeader = userId === leaderId;
    return {
      _id: member._id,
      userId,
      fullName: String(member.fullName || member.userId?.fullName || member.user?.fullName || "").trim(),
      phone: String(member.phone || member.userId?.phone || member.user?.phone || "").trim(),
      role: String(member.role || (isLeader ? "LEADER" : "MEMBER")).toUpperCase(),
      membershipStatus: String(member.membershipStatus || member.status || "ACTIVE").toUpperCase(),
      joinedAt: member.joinedAt || group.createdAt || null,
      totalContributed: Number(member.totalContributed || 0),
      contributionCount: Number(member.contributionCount || 0),
      nextContributionStatus: String(member.nextContributionStatus || "DUE").toUpperCase(),
      lastContributionDate: member.lastContributionDate || null,
    };
  });

  if (leaderId && !members.some((member) => member.userId === leaderId)) {
    members.unshift({
      userId: leaderId,
      fullName: String(group.leaderUserId?.fullName || group.owner?.fullName || "").trim(),
      phone: String(group.leaderUserId?.phone || group.owner?.phone || "").trim(),
      role: "LEADER",
      membershipStatus: "ACTIVE",
      joinedAt: group.createdAt || null,
      totalContributed: 0,
      contributionCount: 0,
      nextContributionStatus: "DUE",
      lastContributionDate: null,
    });
  }

  if (persist) {
    group.members = members.map((member) => ({
      user: member.userId,
      userId: member.userId,
      fullName: member.fullName,
      phone: member.phone,
      role: member.role,
      status: member.membershipStatus,
      membershipStatus: member.membershipStatus,
      joinedAt: member.joinedAt,
      totalContributed: member.totalContributed,
      contributionCount: member.contributionCount,
      nextContributionStatus: member.nextContributionStatus,
      lastContributionDate: member.lastContributionDate,
    }));
    group.markModified("members");
  }

  return { leaderId, groupName: legacyName, members };
};

const groupAccess = (group, id) => {
  const normalized = normalizeGroup(group);
  const isLeader = normalized.leaderId === objectId(id);
  const membership = normalized.members.find((member) => member.userId === objectId(id));
  return {
    ...normalized,
    isLeader,
    membership,
    canAccess: isLeader || Boolean(membership && membership.membershipStatus === "ACTIVE"),
  };
};

const serializeGroup = (group, currentUserId, contributionStats = new Map()) => {
  const access = groupAccess(group, currentUserId);
  const key = (memberId) => `${objectId(group._id)}:${memberId}`;
  const members = access.members.map((member) => {
    const stats = contributionStats.get(key(member.userId));
    const totalContributed = member.totalContributed || Number(stats?.total || 0);
    const contributionCount = member.contributionCount || Number(stats?.count || 0);
    const lastContributionDate = member.lastContributionDate || stats?.lastContributionDate || null;
    const isPaidThisCycle = Boolean(stats?.cycles?.includes(contributionCycle(group.frequency)));
    return {
      ...member,
      totalContributed,
      contributionCount,
      lastContributionDate,
      nextContributionStatus: member.membershipStatus !== "ACTIVE" || String(group.status).toUpperCase() !== "ACTIVE"
          ? "NOT_DUE"
          : isPaidThisCycle ? "PAID" : "DUE",
    };
  });
  const myMembership = members.find((member) => member.userId === objectId(currentUserId)) || null;
  const leader = members.find((member) => member.role === "LEADER") || null;
  return {
    _id: group._id,
    groupId: group.groupId || String(group._id),
    groupName: access.groupName,
    name: access.groupName,
    description: String(group.description || ""),
    contributionAmount: Number(group.contributionAmount || 0),
    frequency: String(group.frequency || "MONTHLY").toUpperCase(),
    leaderUserId: access.leaderId,
    leader,
    members,
    memberCount: members.filter((member) => member.membershipStatus === "ACTIVE").length,
    status: String(group.status || "ACTIVE").toUpperCase() === "CLOSED" ? "COMPLETED" : String(group.status || "ACTIVE").toUpperCase(),
    totalCollected: Number(group.totalCollected || 0),
    groupBalance: Number(group.totalCollected || 0),
    createdAt: group.createdAt,
    nextContributionDate: currentScheduledDate(group),
    isLeader: access.isLeader,
    myMembership,
    myTotalContribution: Number(myMembership?.totalContributed || 0),
    myCurrentContributionStatus: myMembership?.nextContributionStatus || "DUE",
  };
};

const contributionStatsForGroups = async (groupIds) => {
  if (!groupIds.length) return new Map();
  const rows = await GroupContribution.aggregate([
    { $match: { group: { $in: groupIds }, status: "SUCCESSFUL" } },
    {
      $group: {
        _id: { group: "$group", member: "$member" },
        total: { $sum: "$amount" },
        count: { $sum: 1 },
        lastContributionDate: { $max: "$createdAt" },
        cycles: { $addToSet: "$cycle" },
      },
    },
  ]);
  return new Map(rows.map((row) => [
    `${objectId(row._id.group)}:${objectId(row._id.member)}`,
    { total: row.total, count: row.count, lastContributionDate: row.lastContributionDate, cycles: row.cycles || [] },
  ]));
};

const createGroupActivity = async ({ group, type, actor, member = null, contribution = null, message, session = null }) =>
  GroupWalletActivity.create(
    [{ group, type, actor, member, contribution, message }],
    session ? { session } : undefined
  );

const notifyGroupUsers = async ({ userIds, title, message, group, session = null }) => {
  const recipients = [...new Set((userIds || []).map(objectId).filter(Boolean))];
  if (!recipients.length) return;
  return Notification.create(
    recipients.map((userId) => ({
      userId,
      title,
      message,
      type: "GROUP_WALLET",
      referenceId: group,
      referenceType: "GROUP_WALLET",
    })),
    session ? { session, ordered: true } : undefined
  );
};

const notifyDueContribution = async (group, memberId) => {
  const access = groupAccess(group, memberId);
  if (
    !access.canAccess ||
    !access.membership ||
    String(group.status).toUpperCase() !== "ACTIVE" ||
    !group.nextContributionDate ||
    new Date(group.nextContributionDate) > new Date()
  ) {
    return;
  }
  const cycle = contributionCycle(group.frequency);
  if (access.membership.dueNotificationCycle === cycle) return;
  const paid = await GroupContribution.exists({
    group: group._id,
    member: memberId,
    cycle,
    status: "SUCCESSFUL",
  });
  if (paid) return;

  normalizeGroup(group, { persist: true });
  const member = group.members.find((item) => memberUserId(item) === objectId(memberId));
  if (!member || member.dueNotificationCycle === cycle) return;
  member.dueNotificationCycle = cycle;
  group.markModified("members");
  await group.save();
  await notifyGroupUsers({
    userIds: [memberId],
    title: "Ajo contribution due",
    message: `Your ${group.frequency.toLowerCase()} contribution of ₦${Number(group.contributionAmount).toLocaleString()} is due for ${group.groupName || group.name}.`,
    group: group._id,
  });
};

exports.createPaymentLink = async (req, res) => {
  try {
    const amount = Number(req.body?.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid amount.",
      });
    }

    const item = await PaymentLink.create({
      owner: userId(req),
      code: shortCode(),
      title:
        String(req.body?.title || "Payment").trim(),
      amount,
      description:
        String(req.body?.description || "").trim(),
    });

    return res.status(201).json({
      success: true,
      message: "Payment link created.",
      paymentLink: item,
      url:
        `https://servicepay.ng/?pay=${item.code}`,
    });
  } catch (error) {
    console.error("CREATE PAYMENT LINK:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to create payment link.",
    });
  }
};

exports.myPaymentLinks = async (req, res) => {
  const items = await PaymentLink.find({
    owner: userId(req),
  }).sort({
    createdAt: -1,
  });

  return res.json({
    success: true,
    paymentLinks: items,
  });
};

exports.createMoneyRequest = async (req, res) => {
  try {
    const phone =
      String(req.body?.phone || "").trim();

    const amount = Number(req.body?.amount);

    if (!phone || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Phone and valid amount are required.",
      });
    }

    const receiver = await User.findOne({
      phone,
    });

    if (!receiver) {
      return res.status(404).json({
        success: false,
        message: "ServicePay user not found.",
      });
    }

    if (
      String(receiver._id) ===
      String(userId(req))
    ) {
      return res.status(400).json({
        success: false,
        message:
          "You cannot request money from yourself.",
      });
    }

    const item = await MoneyRequest.create({
      requester: userId(req),
      requestedFrom: receiver._id,
      reference:
        `REQ-${Date.now()}-${shortCode()}`,
      amount,
      note:
        String(req.body?.note || "").trim(),
    });

    return res.status(201).json({
      success: true,
      message: "Money request sent.",
      request: item,
    });
  } catch (error) {
    console.error("CREATE MONEY REQUEST:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to create request.",
    });
  }
};

exports.moneyRequests = async (req, res) => {
  const id = userId(req);

  const items = await MoneyRequest.find({
    $or: [
      {
        requester: id,
      },
      {
        requestedFrom: id,
      },
    ],
  })
    .populate(
      "requester requestedFrom",
      "fullName phone"
    )
    .sort({
      createdAt: -1,
    });

  return res.json({
    success: true,
    requests: items,
  });
};

exports.createBusinessProfile = async (req, res) => {
  try {
    const owner = userId(req);

    const item =
      await BusinessWallet.findOneAndUpdate(
        {
          owner,
        },
        {
          owner,
          businessName:
            String(req.body?.businessName || "")
              .trim(),
          businessPhone:
            String(req.body?.businessPhone || "")
              .trim(),
          category:
            String(req.body?.category || "")
              .trim(),
          description:
            String(req.body?.description || "")
              .trim(),
        },
        {
          new: true,
          upsert: true,
          runValidators: true,
        }
      );

    return res.json({
      success: true,
      message: "Business profile saved.",
      business: item,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message:
        error.message ||
        "Unable to save business profile.",
    });
  }
};

exports.getBusinessProfile = async (req, res) => {
  const item = await BusinessWallet.findOne({
    owner: userId(req),
  });

  return res.json({
    success: true,
    business: item,
  });
};

exports.agentLocator = async (req, res) => {
  const state =
    String(req.query?.state || "").trim();

  const lga =
    String(req.query?.lga || "").trim();

  const filter = {
    role: {
      $in: [
        "AGGREGATOR",
        "AGENT",
        "STATE_MANAGER",
      ],
    },
    status: "ACTIVE",
  };

  if (state) {
    filter.state = new RegExp(
      `^${state}$`,
      "i"
    );
  }

  if (lga) {
    filter.lga = new RegExp(
      `^${lga}$`,
      "i"
    );
  }

  const agents = await User.find(filter)
    .select(
      "fullName phone role state lga status"
    )
    .limit(200);

  return res.json({
    success: true,
    agents,
  });
};

exports.createGroup = async (req, res) => {
  try {
    const leader = await User.findById(userId(req))
      .select("fullName phone");
    const amount = Number(req.body?.contributionAmount);
    const name = String(req.body?.name || req.body?.groupName || "").trim();
    const frequency = String(req.body?.frequency || "MONTHLY").toUpperCase();

    if (!leader) {
      return res.status(401).json({ success: false, message: "Customer account not found." });
    }

    if (!name || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Enter a group name and valid contribution amount.",
      });
    }

    if (!["DAILY", "WEEKLY", "MONTHLY"].includes(frequency)) {
      return res.status(400).json({ success: false, message: "Choose a valid contribution frequency." });
    }

    const now = new Date();
    const group = await GroupWallet.create({
      groupId: `AJO-${shortCode()}`,
      owner: leader._id,
      leaderUserId: leader._id,
      name,
      groupName: name,
      description: String(req.body?.description || "").trim(),
      contributionAmount: amount,
      frequency,
      status: "ACTIVE",
      totalCollected: 0,
      nextContributionDate: contributionDueDate(frequency, now),
      members: [{
        user: leader._id,
        userId: leader._id,
        fullName: leader.fullName,
        phone: leader.phone,
        role: "LEADER",
        status: "ACTIVE",
        membershipStatus: "ACTIVE",
        joinedAt: now,
        totalContributed: 0,
        contributionCount: 0,
        nextContributionStatus: "DUE",
      }],
    });

    await createGroupActivity({
      group: group._id,
      type: "GROUP_CREATED",
      actor: leader._id,
      message: `${leader.fullName} created ${name}.`,
    });

    return res.status(201).json({
      success: true,
      message: "Group created successfully.",
      group: serializeGroup(group, leader._id),
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message:
        error.message ||
        "Unable to create group.",
    });
  }
};

exports.myGroups = async (req, res) => {
  try {
    const id = userId(req);
    const groups = await GroupWallet.find({
      $or: [
        { owner: id },
        { leaderUserId: id },
        {
          members: {
            $elemMatch: {
              $and: [
                { $or: [{ user: id }, { userId: id }] },
                {
                  $or: [
                    { status: "ACTIVE" },
                    { membershipStatus: "ACTIVE" },
                    { status: { $exists: false }, membershipStatus: { $exists: false } },
                  ],
                },
              ],
            },
          },
        },
      ],
    })
      .populate("owner leaderUserId members.user members.userId", "fullName phone")
      .sort({ createdAt: -1 });

    const stats = await contributionStatsForGroups(groups.map((group) => group._id));
    const serialized = groups
      .map((group) => serializeGroup(group, id, stats))
      .filter((group) => group.isLeader || group.myMembership?.membershipStatus === "ACTIVE");
    await Promise.allSettled(
      groups.map((group) => notifyDueContribution(group, id))
    );

    return res.json({
      success: true,
      groups: serialized,
      groupsILead: serialized.filter((group) => group.isLeader),
      groupsIBelongTo: serialized.filter((group) => !group.isLeader),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to load your groups." });
  }
};

/*
 * ============================================================
 * SECURE FEATURE MONEY MOVEMENT
 * ============================================================
 */

const paymentReference = (prefix) =>
  `${prefix}-${Date.now()}-${shortCode()}`;

const loadPayerForPin = async (
  id,
  session
) => {
  return User.findById(id)
    .select(
      "walletBalance fullName phone"
    )
    .session(session);
};

const debitWallet = async ({
  userId,
  amount,
  session,
}) => {
  const updated =
    await User.findOneAndUpdate(
      {
        _id: userId,
        walletBalance: {
          $gte: amount,
        },
      },
      {
        $inc: {
          walletBalance: -amount,
        },
      },
      {
        new: true,
        session,
      }
    );

  if (!updated) {
    const error = new Error(
      "Insufficient wallet balance."
    );

    error.statusCode = 400;
    error.code =
      "INSUFFICIENT_BALANCE";

    throw error;
  }

  return updated;
};

const creditWallet = async ({
  userId,
  amount,
  session,
}) => {
  const updated =
    await User.findByIdAndUpdate(
      userId,
      {
        $inc: {
          walletBalance: amount,
        },
      },
      {
        new: true,
        session,
      }
    );

  if (!updated) {
    const error = new Error(
      "Beneficiary account not found."
    );

    error.statusCode = 404;

    throw error;
  }

  return updated;
};


/*
 * ------------------------------------------------------------
 * REQUEST MONEY - PAY
 * ------------------------------------------------------------
 */
exports.payMoneyRequest = async (
  req,
  res
) => {
  const session =
    await mongoose.startSession();

  try {
    let result = null;

    await session.withTransaction(
      async () => {
        const request =
          await MoneyRequest.findOne({
            _id: req.params.id,
            requestedFrom: userId(req),
            status: "PENDING",
          }).session(session);

        if (!request) {
          const error = new Error(
            "Pending money request not found."
          );

          error.statusCode = 404;
          throw error;
        }

        const idempotencyKey =
          `MONEY_REQUEST:${request._id}`;

        const alreadyPaid =
          await FeaturePayment.findOne({
            idempotencyKey,
            status: "SUCCESSFUL",
          }).session(session);

        if (alreadyPaid) {
          const error = new Error(
            "This money request has already been paid."
          );

          error.statusCode = 409;
          throw error;
        }

        const amount =
          Number(request.amount);

        const payer =
          await loadPayerForPin(
            userId(req),
            session
          );

        if (!payer) {
          const error = new Error(
            "Payer account not found."
          );

          error.statusCode = 404;
          throw error;
        }

        await verifyCanonicalTransactionPin(
          payer._id,
          req.body?.transactionPin ?? req.body?.pin,
          { session }
        );

        const debited =
          await debitWallet({
            userId: payer._id,
            amount,
            session,
          });

        const credited =
          await creditWallet({
            userId: request.requester,
            amount,
            session,
          });

        const reference =
          paymentReference("REQPAY");

        const payment =
          await FeaturePayment.create(
            [
              {
                reference,
                idempotencyKey,
                featureType:
                  "MONEY_REQUEST",
                sourceId: request._id,
                payer: payer._id,
                beneficiary:
                  request.requester,
                amount,
                status: "SUCCESSFUL",
                description:
                  request.note ||
                  "ServicePay Money Request",
                completedAt:
                  new Date(),
              },
            ],
            {
              session,
            }
          );

        request.status = "PAID";
        request.paidAt = new Date();

        await request.save({
          session,
        });

        result = {
          payment: payment[0],
          payerWalletBalance:
            debited.walletBalance,
          beneficiaryWalletBalance:
            credited.walletBalance,
        };
      }
    );

    return res.status(200).json({
      success: true,
      message:
        "Money request paid successfully.",
      ...result,
    });
  } catch (error) {
    console.error(
      "PAY MONEY REQUEST ERROR:",
      error
    );

    return res
      .status(error.statusCode || 500)
      .json({
        success: false,
        code:
          error.code ||
          "MONEY_REQUEST_PAYMENT_FAILED",
        message:
          error.message ||
          "Unable to pay money request.",
      });
  } finally {
    await session.endSession();
  }
};


/*
 * ------------------------------------------------------------
 * REQUEST MONEY - DECLINE
 * ------------------------------------------------------------
 */
exports.declineMoneyRequest = async (
  req,
  res
) => {
  try {
    const request =
      await MoneyRequest.findOneAndUpdate(
        {
          _id: req.params.id,
          requestedFrom: userId(req),
          status: "PENDING",
        },
        {
          $set: {
            status: "DECLINED",
          },
        },
        {
          new: true,
        }
      );

    if (!request) {
      return res.status(404).json({
        success: false,
        message:
          "Pending money request not found.",
      });
    }

    return res.json({
      success: true,
      message:
        "Money request declined.",
      request,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message:
        "Unable to decline request.",
    });
  }
};


/*
 * ------------------------------------------------------------
 * PAY-BY-LINK DETAILS
 * ------------------------------------------------------------
 */
exports.getPaymentLinkByCode = async (
  req,
  res
) => {
  try {
    const item =
      await PaymentLink.findOne({
        code: String(
          req.params.code || ""
        ).toUpperCase(),
      }).populate(
        "owner",
        "fullName phone"
      );

    if (!item) {
      return res.status(404).json({
        success: false,
        message:
          "Payment link not found.",
      });
    }

    return res.json({
      success: true,
      paymentLink: item,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message:
        "Unable to load payment link.",
    });
  }
};


/*
 * ------------------------------------------------------------
 * PAY-BY-LINK - PAY
 * ------------------------------------------------------------
 */
exports.payPaymentLink = async (
  req,
  res
) => {
  const session =
    await mongoose.startSession();

  try {
    let result = null;

    await session.withTransaction(
      async () => {
        const item =
          await PaymentLink.findOne({
            code: String(
              req.params.code || ""
            ).toUpperCase(),
            status: "ACTIVE",
          }).session(session);

        if (!item) {
          const error = new Error(
            "Active payment link not found."
          );

          error.statusCode = 404;
          throw error;
        }

        const payerId =
          userId(req);

        if (
          String(item.owner) ===
          String(payerId)
        ) {
          const error = new Error(
            "You cannot pay your own payment link."
          );

          error.statusCode = 400;
          throw error;
        }

        const idempotencyKey =
          `PAY_LINK:${item._id}`;

        const existing =
          await FeaturePayment.findOne({
            idempotencyKey,
            status: "SUCCESSFUL",
          }).session(session);

        if (existing) {
          const error = new Error(
            "This payment link has already been paid."
          );

          error.statusCode = 409;
          throw error;
        }

        const amount =
          Number(item.amount);

        const payer =
          await loadPayerForPin(
            payerId,
            session
          );

        if (!payer) {
          const error = new Error(
            "Payer account not found."
          );

          error.statusCode = 404;
          throw error;
        }

        await verifyCanonicalTransactionPin(
          payer._id,
          req.body?.transactionPin ?? req.body?.pin,
          { session }
        );

        const debited =
          await debitWallet({
            userId: payer._id,
            amount,
            session,
          });

        const merchant =
          await creditWallet({
            userId: item.owner,
            amount,
            session,
          });

        const reference =
          paymentReference("PAYLINK");

        const payments =
          await FeaturePayment.create(
            [
              {
                reference,
                idempotencyKey,
                featureType:
                  "PAY_BY_LINK",
                sourceId: item._id,
                payer: payer._id,
                beneficiary:
                  item.owner,
                amount,
                status: "SUCCESSFUL",
                description:
                  item.title,
                completedAt:
                  new Date(),
              },
            ],
            {
              session,
            }
          );

        item.status = "PAID";
        item.paidBy = payer._id;
        item.paidAt = new Date();

        await item.save({
          session,
        });

        result = {
          payment: payments[0],
          payerWalletBalance:
            debited.walletBalance,
          merchantWalletBalance:
            merchant.walletBalance,
        };
      }
    );

    return res.json({
      success: true,
      message:
        "Payment completed successfully.",
      ...result,
    });
  } catch (error) {
    console.error(
      "PAY LINK ERROR:",
      error
    );

    return res
      .status(error.statusCode || 500)
      .json({
        success: false,
        code:
          error.code ||
          "PAY_LINK_FAILED",
        message:
          error.message ||
          "Unable to complete payment.",
      });
  } finally {
    await session.endSession();
  }
};


const findGroupForUser = async (groupId, requesterId) => {
  if (!mongoose.isValidObjectId(groupId)) return null;
  const group = await GroupWallet.findById(groupId)
    .populate("owner leaderUserId members.user members.userId", "fullName phone");
  if (!group || !groupAccess(group, requesterId).canAccess) return null;
  return group;
};

const resolveGroupUser = async ({ phone, userId: requestedId }) => {
  if (requestedId && mongoose.isValidObjectId(requestedId)) {
    return User.findById(requestedId).select("fullName phone status");
  }
  const normalizedPhone = String(phone || "").trim();
  if (!normalizedPhone) return null;
  return User.findOne({ phone: normalizedPhone }).select("fullName phone status");
};

exports.getGroupDetails = async (req, res) => {
  try {
    const group = await findGroupForUser(req.params.id, userId(req));
    if (!group) {
      return res.status(404).json({ success: false, message: "Group not found or you no longer have access." });
    }
    const stats = await contributionStatsForGroups([group._id]);
    const [contributions, ledger, activity] = await Promise.all([
      GroupContribution.find({ group: group._id })
        .populate("member", "fullName phone")
        .sort({ createdAt: -1 })
        .limit(100),
      GroupWalletLedger.find({ group: group._id })
        .populate("actor", "fullName phone")
        .sort({ createdAt: -1 })
        .limit(100),
      GroupWalletActivity.find({ group: group._id })
        .populate("actor member", "fullName phone")
        .sort({ createdAt: -1 })
        .limit(100),
    ]);
    return res.json({
      success: true,
      group: serializeGroup(group, userId(req), stats),
      contributions,
      ledger,
      activity,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to load this group." });
  }
};

exports.addGroupMember = async (
  req,
  res
) => {
  try {
    const group = await findGroupForUser(req.params.id, userId(req));
    if (!group || !groupAccess(group, userId(req)).isLeader) {
      return res.status(404).json({
        success: false,
        message: "Active group not found.",
      });
    }

    if (String(group.status).toUpperCase() !== "ACTIVE") {
      return res.status(409).json({ success: false, message: "Members can only be added while the group is active." });
    }

    normalizeGroup(group, { persist: true });
    const member = await resolveGroupUser(req.body || {});

    if (!member || String(member.status || "ACTIVE").toUpperCase() !== "ACTIVE") {
      return res.status(404).json({
        success: false,
        message: "No active ServicePay account was found for that phone number or member ID.",
      });
    }

    const exists = group.members.some((item) => memberUserId(item) === objectId(member._id));

    if (exists) {
      return res.status(409).json({
        success: false,
        message:
          "This member is already in the group.",
      });
    }

    group.members.push({
      user: member._id,
      userId: member._id,
      fullName: member.fullName,
      phone: member.phone,
      role: "MEMBER",
      status: "ACTIVE",
      membershipStatus: "ACTIVE",
      joinedAt: new Date(),
      totalContributed: 0,
      contributionCount: 0,
      nextContributionStatus: "DUE",
    });

    await group.save();
    await Promise.all([
      createGroupActivity({
        group: group._id,
        type: "MEMBER_ADDED",
        actor: userId(req),
        member: member._id,
        message: `${member.fullName} joined ${group.groupName || group.name}.`,
      }),
      notifyGroupUsers({
        userIds: [member._id],
        title: "You joined an Ajo group",
        message: `You were added to ${group.groupName || group.name}.`,
        group: group._id,
      }),
    ]);

    return res.json({
      success: true,
      message: "Member added successfully.",
      group: serializeGroup(group, userId(req)),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message:
        "Unable to add member.",
    });
  }
};

exports.removeGroupMember = async (req, res) => {
  try {
    const group = await findGroupForUser(req.params.id, userId(req));
    const access = group && groupAccess(group, userId(req));
    if (!group || !access.isLeader) {
      return res.status(404).json({ success: false, message: "Active group not found." });
    }
    normalizeGroup(group, { persist: true });
    const member = group.members.find((item) => memberUserId(item) === String(req.params.memberId));
    if (!member || member.role === "LEADER") {
      return res.status(404).json({ success: false, message: "Group member not found." });
    }
    if (!activeMembership(member)) {
      return res.status(409).json({ success: false, message: "This member is no longer active in the group." });
    }
    member.status = "REMOVED";
    member.membershipStatus = "REMOVED";
    group.markModified("members");
    await group.save();
    await Promise.all([
      createGroupActivity({
        group: group._id,
        type: "MEMBER_REMOVED",
        actor: userId(req),
        member: member.userId || member.user,
        message: `${member.fullName || "A member"} was removed from ${group.groupName || group.name}.`,
      }),
      notifyGroupUsers({
        userIds: [member.userId || member.user],
        title: "Ajo group membership ended",
        message: `You were removed from ${group.groupName || group.name}. Your prior contribution record remains available.`,
        group: group._id,
      }),
    ]);
    return res.json({ success: true, message: "Member removed.", group: serializeGroup(group, userId(req)) });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to remove this member." });
  }
};

exports.leaveGroup = async (req, res) => {
  try {
    const group = await findGroupForUser(req.params.id, userId(req));
    const access = group && groupAccess(group, userId(req));
    if (!group || !access.canAccess || access.isLeader) {
      return res.status(409).json({ success: false, message: "The group leader cannot leave. Transfer leadership is not supported yet." });
    }
    normalizeGroup(group, { persist: true });
    const member = group.members.find((item) => memberUserId(item) === objectId(userId(req)));
    member.status = "LEFT";
    member.membershipStatus = "LEFT";
    group.markModified("members");
    await group.save();
    await Promise.all([
      createGroupActivity({
        group: group._id,
        type: "MEMBER_LEFT",
        actor: userId(req),
        member: userId(req),
        message: `${member.fullName || "A member"} left ${group.groupName || group.name}.`,
      }),
      notifyGroupUsers({
        userIds: groupAccess(group, userId(req)).members.filter(activeMembership).map((item) => item.userId),
        title: "Ajo member left",
        message: `${member.fullName || "A member"} left ${group.groupName || group.name}.`,
        group: group._id,
      }),
    ]);
    return res.json({ success: true, message: "You left the group. Your contribution history remains available." });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to leave this group." });
  }
};

exports.updateGroup = async (req, res) => {
  try {
    const group = await findGroupForUser(req.params.id, userId(req));
    const access = group && groupAccess(group, userId(req));
    if (!group || !access.isLeader) {
      return res.status(404).json({ success: false, message: "Group not found." });
    }

    normalizeGroup(group, { persist: true });
    const action = String(req.body?.action || "").toUpperCase();
    const hasFunds = Number(group.totalCollected || 0) > 0;
    const activeMembers = group.members.filter(activeMembership).map((member) => member.userId || member.user);
    let activityType = null;
    let activityMessage = "";

    if (action) {
      if (action === "PAUSE" && group.status === "ACTIVE") {
        group.status = "PAUSED";
        activityType = "GROUP_PAUSED";
        activityMessage = `${group.groupName || group.name} was paused.`;
      } else if (action === "RESUME" && group.status === "PAUSED") {
        group.status = "ACTIVE";
        group.nextContributionDate = contributionDueDate(group.frequency);
        activityType = "GROUP_RESUMED";
        activityMessage = `${group.groupName || group.name} resumed.`;
      } else if (action === "CANCEL" && !hasFunds) {
        group.status = "CANCELLED";
        activityType = "GROUP_CANCELLED";
        activityMessage = `${group.groupName || group.name} was cancelled before any funds were collected.`;
      } else if (action === "COMPLETE" && !hasFunds) {
        group.status = "COMPLETED";
        activityType = "GROUP_COMPLETED";
        activityMessage = `${group.groupName || group.name} was completed with a zero balance.`;
      } else {
        return res.status(409).json({
          success: false,
          message: "This status change is not allowed. A group with pooled funds cannot be closed or cancelled until a controlled payout flow exists.",
        });
      }
    } else {
      const name = String(req.body?.name || req.body?.groupName || "").trim();
      const description = req.body?.description;
      if (name) {
        group.name = name;
        group.groupName = name;
      }
      if (description !== undefined) group.description = String(description).trim();
      if (req.body?.contributionAmount !== undefined || req.body?.frequency !== undefined) {
        const hasContributions = await GroupContribution.exists({ group: group._id, status: "SUCCESSFUL" });
        if (hasContributions) {
          return res.status(409).json({ success: false, message: "Contribution amount and frequency cannot change after contributions begin." });
        }
        if (req.body?.contributionAmount !== undefined) {
          const amount = Number(req.body.contributionAmount);
          if (!Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({ success: false, message: "Enter a valid contribution amount." });
          }
          group.contributionAmount = amount;
        }
        if (req.body?.frequency !== undefined) {
          const frequency = String(req.body.frequency).toUpperCase();
          if (!["DAILY", "WEEKLY", "MONTHLY"].includes(frequency)) {
            return res.status(400).json({ success: false, message: "Choose a valid contribution frequency." });
          }
          group.frequency = frequency;
          group.nextContributionDate = contributionDueDate(frequency);
        }
      }
    }

    await group.save();
    if (activityType) {
      await Promise.all([
        createGroupActivity({ group: group._id, type: activityType, actor: userId(req), message: activityMessage }),
        notifyGroupUsers({
          userIds: activeMembers,
          title: `Ajo group ${action.toLowerCase()}d`,
          message: activityMessage,
          group: group._id,
        }),
      ]);
    }
    return res.json({ success: true, message: "Group updated successfully.", group: serializeGroup(group, userId(req)) });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to update this group." });
  }
};


/*
 * ------------------------------------------------------------
 * AJO - CONTRIBUTE
 * ------------------------------------------------------------
 */
exports.contributeToGroup = async (
  req,
  res
) => {
  const session = await mongoose.startSession();

  try {
    let result = null;
    const payerId = userId(req);
    const suppliedKey = String(
      req.body?.idempotencyKey ||
      req.get?.("idempotency-key") ||
      ""
    ).trim();

    await session.withTransaction(async () => {
      if (!mongoose.isValidObjectId(req.params.id)) {
        const error = new Error("Active group not found.");
        error.statusCode = 404;
        throw error;
      }
      const group = await GroupWallet.findOne({
        _id: req.params.id,
        status: "ACTIVE",
      }).session(session);

      if (!group) {
        const error = new Error("Active group not found.");
        error.statusCode = 404;
        throw error;
      }

      normalizeGroup(group, { persist: true });
      const access = groupAccess(group, payerId);
      if (!access.canAccess) {
        const error = new Error("You are not an active member of this group.");
        error.statusCode = 403;
        throw error;
      }

      const amount = Number(group.contributionAmount);
      const idempotencyKey = suppliedKey
        ? `AJO:${suppliedKey}`
        : `AJO:${group._id}:${payerId}:${contributionCycle(group.frequency)}`;
      const cycle = contributionCycle(group.frequency);

      if (idempotencyKey.length > 180) {
        const error = new Error("The contribution request key is invalid.");
        error.statusCode = 400;
        throw error;
      }

      const existing = await GroupContribution.findOne({ idempotencyKey }).session(session);
      if (existing) {
        const error = new Error("This contribution request was already completed. Check the group history before trying again.");
        error.statusCode = 409;
        error.code = "DUPLICATE_AJO_CONTRIBUTION";
        throw error;
      }

      const cycleContribution = await GroupContribution.findOne({
        group: group._id,
        member: payerId,
        cycle,
        status: "SUCCESSFUL",
      }).session(session);
      if (cycleContribution) {
        const error = new Error("You have already completed this group's contribution for the current cycle.");
        error.statusCode = 409;
        error.code = "DUPLICATE_AJO_CONTRIBUTION";
        throw error;
      }

      const payer = await loadPayerForPin(payerId, session);
      await verifyCanonicalTransactionPin(
        payer._id,
        req.body?.transactionPin ?? req.body?.pin,
        { session }
      );

      const debited = await debitWallet({ userId: payerId, amount, session });
      const reference = paymentReference("AJO");
      const contribution = await GroupContribution.create(
        [{
          group: group._id,
          member: payerId,
          reference,
          idempotencyKey,
          cycle,
          amount,
          status: "SUCCESSFUL",
          balanceAfter: Number(group.totalCollected || 0) + amount,
        }],
        { session }
      );

      const currentMember = group.members.find((member) => memberUserId(member) === objectId(payerId));
      currentMember.totalContributed = Number(currentMember.totalContributed || 0) + amount;
      currentMember.contributionCount = Number(currentMember.contributionCount || 0) + 1;
      currentMember.lastContributionDate = new Date();
      currentMember.nextContributionStatus = "PAID";
      group.totalCollected = Number(group.totalCollected || 0) + amount;
      group.markModified("members");
      await group.save({ session });

      const ledger = await GroupWalletLedger.create(
        [{
          group: group._id,
          type: "CREDIT",
          amount,
          balanceAfter: group.totalCollected,
          reference,
          idempotencyKey: `LEDGER:${idempotencyKey}`,
          actor: payerId,
          contribution: contribution[0]._id,
          description: `Contribution to ${group.groupName || group.name}`,
        }],
        { session }
      );

      const payment = await FeaturePayment.create(
        [{
          reference,
          idempotencyKey,
          featureType: "AJO_CONTRIBUTION",
          sourceId: group._id,
          payer: payerId,
          beneficiary: null,
          amount,
          status: "SUCCESSFUL",
          description: `Ajo contribution - ${group.groupName || group.name}`,
          completedAt: new Date(),
        }],
        { session }
      );

      await createGroupActivity({
        group: group._id,
        type: "CONTRIBUTION_SUCCESSFUL",
        actor: payerId,
        member: payerId,
        contribution: contribution[0]._id,
        message: `${payer.fullName} contributed ₦${amount.toLocaleString()} to ${group.groupName || group.name}.`,
        session,
      });

      await notifyGroupUsers({
        userIds: group.members
          .filter(activeMembership)
          .map((member) => member.userId || member.user),
        title: "Ajo contribution received",
        message: `${payer.fullName} contributed ₦${amount.toLocaleString()} to ${group.groupName || group.name}.`,
        group: group._id,
        session,
      });

      result = {
        contribution: contribution[0],
        ledger: ledger[0],
        payment: payment[0],
        walletBalance: debited.walletBalance,
        groupBalance: group.totalCollected,
      };
    });

    return res.json({
      success: true,
      message:
        "Contribution completed successfully.",
      ...result,
    });
  } catch (error) {
    console.error(
      "AJO CONTRIBUTION ERROR:",
      error
    );

    const duplicate = error?.code === 11000;
    return res.status(error.statusCode || (duplicate ? 409 : 500))
      .json({
        success: false,
        code: duplicate ? "DUPLICATE_AJO_CONTRIBUTION" : error.code || "AJO_CONTRIBUTION_FAILED",
        message: duplicate ? "This contribution request was already completed." : error.message || "Unable to complete contribution.",
      });
  } finally {
    await session.endSession();
  }
};


/*
 * ------------------------------------------------------------
 * AJO CONTRIBUTION HISTORY
 * ------------------------------------------------------------
 */
exports.groupContributions = async (
  req,
  res
) => {
  try {
    const group = await findGroupForUser(req.params.id, userId(req));
    if (!group) {
      return res.status(404).json({
        success: false,
        message: "Group not found or you no longer have access.",
      });
    }

    const contributions = await GroupContribution.find({
      group: group._id,
    })
        .populate(
          "member",
          "fullName phone"
        )
        .sort({
          createdAt: -1,
        });

    return res.json({
      success: true,
      contributions,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message:
        "Unable to load contribution history.",
    });
  }
};
