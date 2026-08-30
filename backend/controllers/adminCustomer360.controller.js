const mongoose = require("mongoose");

const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const WithdrawalRequest = require("../models/withdrawalRequest.model");
const KycProfile = require("../models/kycProfile.model");
const IdVerification = require("../models/idVerification.model");
const FintechCase = require("../models/fintechCase.model");
const LoginSecurityEvent = require("../models/loginSecurityEvent.model");
const AdminAuditLog = require("../models/adminAuditLog.model");
const {
  STAFF_PERMISSIONS: P,
} = require("../config/staffPermissions");

const SUCCESS_STATUSES = ["SUCCESS", "SUCCESSFUL", "COMPLETED", "APPROVED"];
const PENDING_STATUSES = ["PENDING", "PROCESSING", "IN_PROGRESS"];
const FAILED_STATUSES = ["FAILED", "CANCELLED", "REJECTED"];
const SAFE_PROFILE_FIELDS = [
  "_id",
  "fullName",
  "phone",
  "email",
  "profilePhotoUrl",
  "accountNumber",
  "status",
  "kycVerified",
  "createdAt",
  "updatedAt",
  "zone",
  "state",
  "lga",
  "walletBalance",
  "walletHeldBalance",
  "referralCode",
].join(" ");

const clean = (value, maximum = 200) =>
  String(value || "").trim().slice(0, maximum);

const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const pageValues = (query, maximum = 50) => {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(
    maximum,
    Math.max(1, Number.parseInt(query.limit, 10) || 20)
  );
  return { page, limit, skip: (page - 1) * limit };
};

const maskIdentifier = (value) => {
  const raw = clean(value, 50);
  if (!raw) return "";
  if (raw.length <= 4) return "*".repeat(raw.length);
  return `${raw.slice(0, 3)}${"*".repeat(Math.max(3, raw.length - 5))}${raw.slice(-2)}`;
};

const maskPhone = (value) => {
  const raw = clean(value, 30);
  if (raw.length < 7) return maskIdentifier(raw);
  return `${raw.slice(0, 4)}${"*".repeat(Math.max(3, raw.length - 7))}${raw.slice(-3)}`;
};

const maskEmail = (value) => {
  const raw = clean(value, 200);
  const at = raw.indexOf("@");
  if (at < 1) return raw ? "***" : "";
  const local = raw.slice(0, at);
  return `${local.slice(0, 1)}${"*".repeat(Math.max(2, local.length - 1))}${raw.slice(at)}`;
};

const can = (req, permission) =>
  req.staffAccess?.isHeadOffice === true ||
  (req.staffAccess?.permissions || []).includes("*") ||
  (req.staffAccess?.permissions || []).includes(permission);

const customerScopeFilter = (req) => {
  const scope = req.staffAccess?.scope || {};
  const type = String(scope.type || "GLOBAL").toUpperCase();
  if (type === "ZONE") return { zone: scope.zone };
  if (type === "STATE") return { zone: scope.zone, state: scope.state };
  if (type === "SELF" && scope.userId) return { _id: scope.userId };
  return {};
};

const transactionStatusGroup = (status) => {
  const value = clean(status, 50).toUpperCase();
  if (SUCCESS_STATUSES.includes(value)) return "SUCCESSFUL";
  if (FAILED_STATUSES.includes(value)) return "FAILED";
  if (PENDING_STATUSES.includes(value)) return "PENDING";
  return value || "UNKNOWN";
};

const safeTransaction = (item) => ({
  id: String(item._id),
  reference: clean(item.reference),
  serviceType: clean(item.serviceType, 80),
  provider: clean(item.provider, 100),
  phone: maskPhone(item.phone),
  amount: Number(item.amount || 0),
  status: transactionStatusGroup(item.status),
  createdAt: item.createdAt || null,
  updatedAt: item.updatedAt || null,
});

const findCustomer = async (req, res) => {
  const customerId = clean(req.params.customerId, 80);
  if (!mongoose.Types.ObjectId.isValid(customerId)) {
    res.status(400).json({ success: false, message: "Invalid customer ID." });
    return null;
  }
  const customer = await User.findOne({
    _id: customerId,
    role: "CUSTOMER",
    ...customerScopeFilter(req),
  })
    .select(SAFE_PROFILE_FIELDS)
    .lean();
  if (!customer) {
    res.status(404).json({
      success: false,
      message: "Customer was not found within your authorized data scope.",
    });
    return null;
  }
  return customer;
};

const identityMatches = async (req, query) => {
  if (!/^\d{11}$/.test(query) || !can(req, P.CUSTOMER360_KYC)) return [];
  const profiles = await KycProfile.find({
    $or: [{ submittedNin: query }, { submittedBvn: query }],
  })
    .select("user")
    .limit(50)
    .lean();
  const userMatches = await User.find({ nin: query })
    .select("_id")
    .limit(50)
    .lean();
  return [
    ...new Set([
      ...profiles.map((item) => String(item.user)),
      ...userMatches.map((item) => String(item._id)),
    ]),
  ].map((id) => new mongoose.Types.ObjectId(id));
};

exports.searchCustomers = async (req, res) => {
  try {
    const query = clean(req.query.query || req.query.search, 120);
    if (query.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Enter at least 2 characters to search customers.",
      });
    }
    const exact = new RegExp(`^${escapeRegex(query)}$`, "i");
    const name = new RegExp(escapeRegex(query), "i");
    const identityUserIds = await identityMatches(req, query);
    const or = [
      { fullName: name },
      { phone: exact },
      { email: exact },
      { accountNumber: exact },
    ];
    if (mongoose.Types.ObjectId.isValid(query)) or.push({ _id: query });
    if (identityUserIds.length) or.push({ _id: { $in: identityUserIds } });

    const customers = await User.find({
      role: "CUSTOMER",
      ...customerScopeFilter(req),
      $or: or,
    })
      .select(SAFE_PROFILE_FIELDS)
      .sort({ fullName: 1, createdAt: -1 })
      .limit(25)
      .lean();

    return res.json({
      success: true,
      data: {
        query,
        items: customers.map((customer) => ({
          id: String(customer._id),
          servicePayId: clean(customer.accountNumber) || String(customer._id),
          fullName: clean(customer.fullName),
          phone: maskPhone(customer.phone),
          email: maskEmail(customer.email),
          status: clean(customer.status, 40) || "UNKNOWN",
          kycStatus: customer.kycVerified === true ? "VERIFIED" : "PENDING",
          joinedAt: customer.createdAt || null,
          identityMatch: identityUserIds.some(
            (id) => String(id) === String(customer._id)
          ),
        })),
      },
    });
  } catch (error) {
    console.error("Customer 360 search error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to search customers.",
    });
  }
};

exports.getCustomerOverview = async (req, res) => {
  try {
    const customer = await findCustomer(req, res);
    if (!customer) return;
    const customerId = customer._id;
    const financialAllowed = can(req, P.CUSTOMER360_FINANCIAL);
    const kycAllowed = can(req, P.CUSTOMER360_KYC);
    const securityAllowed = can(req, P.CUSTOMER360_SECURITY);
    const supportAllowed = can(req, P.SUPPORT_VIEW);
    const auditAllowed = can(req, P.AUDIT_VIEW);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      latestTransaction,
      latestLogin,
      kycProfile,
      identityRecords,
      supportRows,
      financialRows,
      withdrawalRows,
      serviceRows,
      failedLogins,
      failedTransactions,
      recentAdminActions,
    ] = await Promise.all([
      Transaction.findOne({ customerId })
        .select("createdAt")
        .sort({ createdAt: -1 })
        .lean(),
      LoginSecurityEvent.findOne({ user: customerId })
        .select("createdAt")
        .sort({ createdAt: -1 })
        .lean(),
      kycAllowed
        ? KycProfile.findOne({ user: customerId })
            .select(
              "level requestedLevel status ninVerified ninLast4 ninVerifiedAt bvnVerified bvnLast4 bvnVerifiedAt identityMatchStatus documentType selfieAssetId idDocumentAssetId idDocumentBackAssetId proofOfAddressAssetId reviewReason rejectionReason reviewHistory submittedAt reviewedAt verifiedAt createdAt updatedAt"
            )
            .lean()
        : null,
      kycAllowed
        ? IdVerification.find({ userId: customerId })
            .select(
              "idType status ninNumberMasked bvnNumberMasked idNumberMasked failureReason createdAt"
            )
            .sort({ createdAt: -1 })
            .limit(20)
            .lean()
        : [],
      supportAllowed
        ? FintechCase.aggregate([
            { $match: { customer: customerId, type: "COMPLAINT" } },
            {
              $group: {
                _id: "$status",
                count: { $sum: 1 },
                latestAt: { $max: "$updatedAt" },
              },
            },
          ])
        : [],
      financialAllowed
        ? Transaction.aggregate([
            { $match: { customerId } },
            {
              $group: {
                _id: null,
                totalCount: { $sum: 1 },
                successful: {
                  $sum: { $cond: [{ $in: ["$status", SUCCESS_STATUSES] }, 1, 0] },
                },
                pending: {
                  $sum: { $cond: [{ $in: ["$status", PENDING_STATUSES] }, 1, 0] },
                },
                failed: {
                  $sum: { $cond: [{ $in: ["$status", FAILED_STATUSES] }, 1, 0] },
                },
                moneyIn: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $in: ["$status", SUCCESS_STATUSES] },
                          { $eq: ["$serviceType", "WALLET_FUNDING"] },
                        ],
                      },
                      "$amount",
                      0,
                    ],
                  },
                },
                moneyOut: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $in: ["$status", SUCCESS_STATUSES] },
                          { $ne: ["$serviceType", "WALLET_FUNDING"] },
                        ],
                      },
                      "$amount",
                      0,
                    ],
                  },
                },
                servicePayTransfers: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $in: ["$status", SUCCESS_STATUSES] },
                          { $eq: ["$serviceType", "TRANSFER"] },
                        ],
                      },
                      "$amount",
                      0,
                    ],
                  },
                },
              },
            },
          ])
        : [],
      financialAllowed
        ? WithdrawalRequest.aggregate([
            { $match: { user: customerId } },
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                totalApproved: {
                  $sum: {
                    $cond: [{ $eq: ["$status", "APPROVED"] }, "$amount", 0],
                  },
                },
              },
            },
          ])
        : [],
      Transaction.aggregate([
        { $match: { customerId } },
        {
          $group: {
            _id: "$serviceType",
            count: { $sum: 1 },
            successful: {
              $sum: { $cond: [{ $in: ["$status", SUCCESS_STATUSES] }, 1, 0] },
            },
            latestAt: { $max: "$createdAt" },
          },
        },
        { $sort: { count: -1 } },
      ]),
      securityAllowed
        ? LoginSecurityEvent.countDocuments({
            user: customerId,
            outcome: "FAILED",
            createdAt: { $gte: since },
          })
        : 0,
      securityAllowed
        ? Transaction.countDocuments({
            customerId,
            status: { $in: FAILED_STATUSES },
            createdAt: { $gte: since },
          })
        : 0,
      securityAllowed && auditAllowed
        ? AdminAuditLog.find({ targetUserId: customerId })
            .select("action status createdAt")
            .sort({ createdAt: -1 })
            .limit(5)
            .lean()
        : [],
    ]);

    const lastActivity = [
      customer.updatedAt,
      latestTransaction?.createdAt,
      latestLogin?.createdAt,
      kycProfile?.updatedAt,
      ...supportRows.map((item) => item.latestAt),
    ]
      .filter(Boolean)
      .sort((a, b) => new Date(b) - new Date(a))[0] || customer.createdAt;

    const supportCounts = Object.fromEntries(
      supportRows.map((item) => [String(item._id), Number(item.count || 0)])
    );
    const supportTotal = supportRows.reduce(
      (sum, item) => sum + Number(item.count || 0),
      0
    );
    const openSupport = supportRows
      .filter((item) =>
        ["OPEN", "IN_PROGRESS", "IN_REVIEW", "WAITING_ON_CUSTOMER"].includes(
          String(item._id)
        )
      )
      .reduce((sum, item) => sum + Number(item.count || 0), 0);
    const financial = financialRows[0] || {};
    const withdrawals = withdrawalRows[0] || {};

    let riskLabel = "Normal";
    const riskSignals = [];
    if (String(customer.status).toUpperCase() !== "ACTIVE") {
      riskSignals.push(`Account status is ${clean(customer.status, 40) || "not active"}.`);
      riskLabel = "Restricted";
    }
    if (securityAllowed && kycProfile?.identityMatchStatus === "REVIEW_REQUIRED") {
      riskSignals.push("KYC identity match requires review.");
      if (riskLabel === "Normal") riskLabel = "Review Recommended";
    }
    if (securityAllowed && failedLogins >= 3) {
      riskSignals.push(`${failedLogins} failed authentication attempts in 30 days.`);
      if (riskLabel === "Normal") riskLabel = "Review Recommended";
    }
    if (securityAllowed && failedTransactions >= 5) {
      riskSignals.push(`${failedTransactions} failed transactions in 30 days.`);
      if (riskLabel === "Normal") riskLabel = "Review Recommended";
    }

    return res.json({
      success: true,
      data: {
        capabilities: {
          view: true,
          financial: financialAllowed,
          kyc: kycAllowed,
          security: securityAllowed,
          support: supportAllowed,
          audit: auditAllowed,
        },
        profile: {
          id: String(customer._id),
          servicePayId: clean(customer.accountNumber) || String(customer._id),
          fullName: clean(customer.fullName),
          phone: clean(customer.phone),
          email: clean(customer.email),
          avatarUrl: clean(customer.profilePhotoUrl, 1000),
          status: clean(customer.status, 40) || "UNKNOWN",
          kycStatus:
            clean(kycProfile?.status, 40) ||
            (customer.kycVerified === true ? "VERIFIED" : "PENDING"),
          kycTier: clean(kycProfile?.level, 40) || "TIER_1",
          joinedAt: customer.createdAt || null,
          lastActivityAt: lastActivity || null,
          location: {
            zone: clean(customer.zone, 100),
            state: clean(customer.state, 100),
            lga: clean(customer.lga, 100),
          },
        },
        financial: financialAllowed
          ? {
              walletBalance: Number(customer.walletBalance || 0),
              heldBalance: Number(customer.walletHeldBalance || 0),
              totalMoneyIn: Number(financial.moneyIn || 0),
              totalMoneyOut: Number(financial.moneyOut || 0),
              totalTransactionCount: Number(financial.totalCount || 0),
              successfulTransactions: Number(financial.successful || 0),
              pendingTransactions: Number(financial.pending || 0),
              failedTransactions: Number(financial.failed || 0),
              totalWithdrawals: Number(withdrawals.totalApproved || 0),
              withdrawalCount: Number(withdrawals.count || 0),
              totalServicePayTransfers: Number(
                financial.servicePayTransfers || 0
              ),
            }
          : null,
        identity: kycAllowed
          ? {
              tier: clean(kycProfile?.level, 40) || "TIER_1",
              requestedTier: clean(kycProfile?.requestedLevel, 40) || "TIER_1",
              status: clean(kycProfile?.status, 40) || "NOT_STARTED",
              identityMatchStatus:
                clean(kycProfile?.identityMatchStatus, 50) || "NOT_VERIFIED",
              nin: {
                status: kycProfile?.ninVerified === true ? "VERIFIED" : "PENDING",
                masked:
                  kycProfile?.ninLast4
                    ? maskIdentifier(`0000000${kycProfile.ninLast4}`)
                    : "",
                verifiedAt: kycProfile?.ninVerifiedAt || null,
              },
              bvn: {
                status: kycProfile?.bvnVerified === true ? "VERIFIED" : "PENDING",
                masked:
                  kycProfile?.bvnLast4
                    ? maskIdentifier(`0000000${kycProfile.bvnLast4}`)
                    : "",
                verifiedAt: kycProfile?.bvnVerifiedAt || null,
              },
              documents: {
                type: clean(kycProfile?.documentType, 60),
                selfieSubmitted: Boolean(kycProfile?.selfieAssetId),
                idDocumentSubmitted: Boolean(
                  kycProfile?.idDocumentAssetId ||
                    kycProfile?.idDocumentBackAssetId
                ),
                proofOfAddressSubmitted: Boolean(
                  kycProfile?.proofOfAddressAssetId
                ),
              },
              verificationHistory: identityRecords.map((item) => ({
                id: String(item._id),
                type: clean(item.idType, 50),
                status: clean(item.status, 50),
                maskedIdentifier:
                  clean(item.idNumberMasked, 50) ||
                  clean(item.ninNumberMasked, 50) ||
                  clean(item.bvnNumberMasked, 50),
                failureReason:
                  String(item.status).toUpperCase() === "FAILED"
                    ? clean(item.failureReason, 300)
                    : "",
                createdAt: item.createdAt || null,
              })),
              reviewHistory: (kycProfile?.reviewHistory || []).map((item) => ({
                action: clean(item.action, 60),
                reason: clean(item.reason, 300),
                occurredAt: item.occurredAt || null,
              })),
            }
          : null,
        usage: serviceRows.map((item) => ({
          service: clean(item._id, 80),
          count: Number(item.count || 0),
          successful: Number(item.successful || 0),
          latestAt: item.latestAt || null,
        })),
        support: supportAllowed
          ? {
              total: supportTotal,
              open: openSupport,
              resolved:
                Number(supportCounts.RESOLVED || 0) +
                Number(supportCounts.CLOSED || 0),
              byStatus: supportCounts,
              latestAt: supportRows
                .map((item) => item.latestAt)
                .filter(Boolean)
                .sort((a, b) => new Date(b) - new Date(a))[0] || null,
            }
          : null,
        risk: securityAllowed
          ? {
              label: riskLabel,
              signals: riskSignals,
              failedLogins30d: Number(failedLogins || 0),
              failedTransactions30d: Number(failedTransactions || 0),
              recentAdminActions: recentAdminActions.map((item) => ({
                action: clean(item.action, 100),
                status: clean(item.status, 50),
                createdAt: item.createdAt || null,
              })),
            }
          : null,
      },
    });
  } catch (error) {
    console.error("Customer 360 overview error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load the customer profile.",
    });
  }
};

exports.getCustomerTransactions = async (req, res) => {
  try {
    const customer = await findCustomer(req, res);
    if (!customer) return;
    const { page, limit, skip } = pageValues(req.query);
    const status = clean(req.query.status, 50).toUpperCase();
    const serviceType = clean(req.query.serviceType, 80).toUpperCase();
    const search = clean(req.query.search, 120);
    const from = clean(req.query.from, 40);
    const to = clean(req.query.to, 40);
    const filter = { customerId: customer._id };
    if (status && status !== "ALL") {
      filter.status =
        status === "SUCCESSFUL"
          ? { $in: SUCCESS_STATUSES }
          : status === "FAILED"
            ? { $in: FAILED_STATUSES }
            : status === "PENDING"
              ? { $in: PENDING_STATUSES }
              : status;
    }
    if (serviceType && serviceType !== "ALL") filter.serviceType = serviceType;
    if (search) {
      filter.reference = new RegExp(escapeRegex(search), "i");
    }
    if (from || to) {
      filter.createdAt = {};
      if (from) {
        const value = new Date(from);
        if (!Number.isNaN(value.getTime())) filter.createdAt.$gte = value;
      }
      if (to) {
        const value = new Date(to);
        if (!Number.isNaN(value.getTime())) {
          value.setUTCHours(23, 59, 59, 999);
          filter.createdAt.$lte = value;
        }
      }
      if (!Object.keys(filter.createdAt).length) delete filter.createdAt;
    }

    const [items, total] = await Promise.all([
      Transaction.find(filter)
        .select(
          "_id reference serviceType provider phone amount status createdAt updatedAt"
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Transaction.countDocuments(filter),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    return res.json({
      success: true,
      data: {
        items: items.map(safeTransaction),
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
      },
    });
  } catch (error) {
    console.error("Customer 360 transactions error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load customer transactions.",
    });
  }
};

exports.getCustomerTimeline = async (req, res) => {
  try {
    const customer = await findCustomer(req, res);
    if (!customer) return;
    const { page, limit } = pageValues(req.query, 25);
    const sourceLimit = Math.min(page * limit + 1, 150);
    const includeSecurity = can(req, P.CUSTOMER360_SECURITY);
    const includeKyc = can(req, P.CUSTOMER360_KYC);
    const includeSupport = can(req, P.SUPPORT_VIEW);
    const includeAudit = includeSecurity && can(req, P.AUDIT_VIEW);

    const [transactions, cases, securityEvents, profile, adminActions] =
      await Promise.all([
        Transaction.find({ customerId: customer._id })
          .select(
            "_id reference serviceType amount status provider createdAt updatedAt"
          )
          .sort({ createdAt: -1 })
          .limit(sourceLimit)
          .lean(),
        includeSupport
          ? FintechCase.find({ customer: customer._id, type: "COMPLAINT" })
              .select("_id caseReference subject status createdAt updatedAt")
              .sort({ createdAt: -1 })
              .limit(sourceLimit)
              .lean()
          : [],
        includeSecurity
          ? LoginSecurityEvent.find({ user: customer._id })
              .select("_id outcome createdAt")
              .sort({ createdAt: -1 })
              .limit(sourceLimit)
              .lean()
          : [],
        includeKyc
          ? KycProfile.findOne({ user: customer._id })
              .select("status reviewHistory submittedAt reviewedAt verifiedAt createdAt")
              .lean()
          : null,
        includeAudit
          ? AdminAuditLog.find({ targetUserId: customer._id })
              .select("_id action status createdAt")
              .sort({ createdAt: -1 })
              .limit(sourceLimit)
              .lean()
          : [],
      ]);

    const events = [
      {
        id: `registration:${customer._id}`,
        type: "REGISTRATION",
        event: "Customer registration",
        status: "COMPLETED",
        amount: null,
        reference: String(customer._id),
        occurredAt: customer.createdAt,
      },
      ...transactions.map((item) => ({
        id: `transaction:${item._id}`,
        type: "TRANSACTION",
        event: clean(item.serviceType, 80).replaceAll("_", " "),
        status: transactionStatusGroup(item.status),
        amount: Number(item.amount || 0),
        reference: clean(item.reference),
        occurredAt: item.createdAt,
      })),
      ...cases.map((item) => ({
        id: `support:${item._id}`,
        type: "SUPPORT",
        event: clean(item.subject, 200) || "Support ticket",
        status: clean(item.status, 50),
        amount: null,
        reference: clean(item.caseReference),
        occurredAt: item.createdAt,
      })),
      ...securityEvents.map((item) => ({
        id: `security:${item._id}`,
        type: "SECURITY",
        event:
          item.outcome === "SUCCESS"
            ? "Successful authentication"
            : "Authentication attempt",
        status: clean(item.outcome, 50),
        amount: null,
        reference: "",
        occurredAt: item.createdAt,
      })),
      ...adminActions.map((item) => ({
        id: `admin:${item._id}`,
        type: "ADMIN",
        event: clean(item.action, 100).replaceAll("_", " "),
        status: clean(item.status, 50),
        amount: null,
        reference: "",
        occurredAt: item.createdAt,
      })),
    ];
    if (profile) {
      events.push({
        id: `kyc:${profile._id}:submitted`,
        type: "KYC",
        event: "KYC submission",
        status: clean(profile.status, 50),
        amount: null,
        reference: String(profile._id),
        occurredAt: profile.submittedAt || profile.createdAt,
      });
      for (const [index, item] of (profile.reviewHistory || []).entries()) {
        events.push({
          id: `kyc:${profile._id}:review:${index}`,
          type: "KYC",
          event: clean(item.action, 80).replaceAll("_", " "),
          status: clean(item.action, 50),
          amount: null,
          reference: String(profile._id),
          occurredAt: item.occurredAt,
        });
      }
    }
    events.sort(
      (a, b) => new Date(b.occurredAt || 0) - new Date(a.occurredAt || 0)
    );
    const start = (page - 1) * limit;
    const items = events.slice(start, start + limit);
    return res.json({
      success: true,
      data: {
        items,
        pagination: {
          page,
          limit,
          hasNextPage: events.length > start + limit,
          hasPreviousPage: page > 1,
        },
      },
    });
  } catch (error) {
    console.error("Customer 360 timeline error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load customer activity.",
    });
  }
};
