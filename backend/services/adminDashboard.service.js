const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const Delivery = require("../models/delivery.model");
const IdVerification = require("../models/idVerification.model");

const FULL_ACCESS_ROLES = new Set([
  "HEAD_OFFICE",
  "ADMIN",
  "SUPER_ADMIN",
  "HEAD_OFFICE_ADMIN",
]);

const SUCCESS_STATUSES = ["SUCCESS", "SUCCESSFUL", "COMPLETED", "APPROVED"];
const PENDING_STATUSES = ["PENDING", "PROCESSING"];
const FAILED_STATUSES = ["FAILED", "CANCELLED", "REJECTED"];
const INVALID_STATUSES = ["REVERSED", "REFUNDED"];

const RANGE_DAYS = Object.freeze({
  today: 1,
  "7d": 7,
  "30d": 30,
});
const LAGOS_OFFSET_MS = 60 * 60 * 1000;

const toMap = (value) =>
  value && typeof value === "object" ? value : {};

const normalizeRange = (value) => {
  const normalized = String(value || "today").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(RANGE_DAYS, normalized)
    ? normalized
    : "today";
};

const getDateWindow = (range, now = new Date()) => {
  const end = new Date(now);
  const normalizedRange = normalizeRange(range);
  const days = RANGE_DAYS[normalizedRange];
  if (normalizedRange === "today") {
    const lagosNow = new Date(end.getTime() + LAGOS_OFFSET_MS);
    const start = new Date(
      Date.UTC(
        lagosNow.getUTCFullYear(),
        lagosNow.getUTCMonth(),
        lagosNow.getUTCDate(),
      ) - LAGOS_OFFSET_MS,
    );
    const elapsed = end.getTime() - start.getTime();
    const previousStart = new Date(start.getTime() - 24 * 60 * 60 * 1000);
    const previousEnd = new Date(previousStart.getTime() + elapsed);
    return { start, end, previousStart, previousEnd, days };
  }
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days);
  const previousStart = new Date(start);
  previousStart.setUTCDate(previousStart.getUTCDate() - days);
  return { start, end, previousStart, previousEnd: start, days };
};

const readPermissions = (user = {}) => {
  const direct = Array.isArray(user.permissions) ? user.permissions : [];
  const staffRole = toMap(user.staffRole);
  const nested = Array.isArray(staffRole.permissions)
    ? staffRole.permissions
    : [];
  return new Set(
    [...direct, ...nested]
      .map((permission) => String(permission).trim().toLowerCase())
      .filter(Boolean),
  );
};

const hasPermission = (user = {}, permission) => {
  const role = String(user.role || "").toUpperCase();
  return (
    FULL_ACCESS_ROLES.has(role) ||
    readPermissions(user).has("*") ||
    readPermissions(user).has(String(permission).toLowerCase())
  );
};

const buildScopeFilter = (user = {}, domain = "user") => {
  const role = String(user.role || "").toUpperCase();
  if (FULL_ACCESS_ROLES.has(role)) return {};

  const id = user._id;
  if (role === "ZONAL_MANAGER") {
    return id && ["user", "transaction"].includes(domain)
      ? { zonalManagerId: id }
      : { _id: { $exists: false } };
  }

  if (role === "STATE_MANAGER") {
    return id && ["user", "transaction"].includes(domain)
      ? { stateManagerId: id }
      : { _id: { $exists: false } };
  }

  return {};
};

const scopedTransactionMatch = (scopeFilter) => {
  if (!Object.keys(scopeFilter).length) return {};
  if (scopeFilter.zone) return { zone: scopeFilter.zone };
  if (scopeFilter.state) return { state: scopeFilter.state };
  if (scopeFilter.zonalManagerId) {
    return { zonalManagerId: scopeFilter.zonalManagerId };
  }
  if (scopeFilter.stateManagerId) {
    return { stateManagerId: scopeFilter.stateManagerId };
  }
  return { _id: { $exists: false } };
};

const metric = (value, available = true, reason = "") => ({
  available,
  value: available ? value : null,
  ...(available ? {} : { reason }),
});

const permissionMetric = (user, permission, value) =>
  hasPermission(user, permission)
    ? metric(value)
    : metric(null, false, "Not available for this staff role.");

const transactionMatch = (start, end, scopeFilter) => ({
  createdAt: { $gte: start, $lt: end },
  status: { $nin: INVALID_STATUSES },
  ...scopedTransactionMatch(scopeFilter),
});

const aggregateTransactionSummary = (match) =>
  Transaction.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        value: {
          $sum: {
            $cond: [
              { $in: ["$status", SUCCESS_STATUSES] },
              {
                $convert: {
                  input: "$amount",
                  to: "double",
                  onError: 0,
                  onNull: 0,
                },
              },
              0,
            ],
          },
        },
        successful: {
          $sum: { $cond: [{ $in: ["$status", SUCCESS_STATUSES] }, 1, 0] },
        },
        pending: {
          $sum: { $cond: [{ $in: ["$status", PENDING_STATUSES] }, 1, 0] },
        },
        failed: {
          $sum: { $cond: [{ $in: ["$status", FAILED_STATUSES] }, 1, 0] },
        },
      },
    },
  ]);

const aggregateTransactionSeries = (match) =>
  Transaction.aggregate([
    { $match: match },
    {
      $group: {
        _id: {
          $dateToString: {
            format: "%Y-%m-%d",
            date: "$createdAt",
            timezone: "+01:00",
          },
        },
        successful: {
          $sum: { $cond: [{ $in: ["$status", SUCCESS_STATUSES] }, 1, 0] },
        },
        pending: {
          $sum: { $cond: [{ $in: ["$status", PENDING_STATUSES] }, 1, 0] },
        },
        failed: {
          $sum: { $cond: [{ $in: ["$status", FAILED_STATUSES] }, 1, 0] },
        },
        value: {
          $sum: {
            $cond: [
              { $in: ["$status", SUCCESS_STATUSES] },
              {
                $convert: {
                  input: "$amount",
                  to: "double",
                  onError: 0,
                  onNull: 0,
                },
              },
              0,
            ],
          },
        },
      },
    },
    { $sort: { _id: 1 } },
  ]);

const aggregateServices = (match) =>
  Transaction.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$serviceType",
        count: { $sum: 1 },
        value: {
          $sum: {
            $convert: {
              input: "$amount",
              to: "double",
              onError: 0,
              onNull: 0,
            },
          },
        },
      },
    },
  ]);

const safeActivity = (user, match) =>
  hasPermission(user, "transactions.view")
    ? Transaction.find(match)
        .select("reference serviceType amount status createdAt")
        .sort({ createdAt: -1 })
        .limit(8)
        .lean()
    : Promise.resolve([]);

const emptySummary = () => ({
  total: 0,
  value: 0,
  successful: 0,
  pending: 0,
  failed: 0,
});

const summaryFrom = (rows) => ({ ...emptySummary(), ...(rows[0] || {}) });

const percentChange = (current, previous) => {
  if (!previous || !Number.isFinite(Number(previous))) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
};

const getExecutiveDashboard = async (req, res) => {
  const range = normalizeRange(req.query.range);
  const { start, end, previousStart, previousEnd } = getDateWindow(range);
  const role = String(req.user?.role || "").toUpperCase();
  const scopedManager = ["ZONAL_MANAGER", "STATE_MANAGER"].includes(role);
  const userScope = buildScopeFilter(req.user, "user");
  const transactionScope = buildScopeFilter(req.user, "transaction");
  const currentMatch = transactionMatch(start, end, transactionScope);
  const previousMatch = transactionMatch(
    previousStart,
    previousEnd,
    transactionScope,
  );
  const customerFilter = { role: "CUSTOMER", ...userScope };
  const transactionAccess = hasPermission(req.user, "transactions.view");
  const deliveryAccess = hasPermission(req.user, "delivery.view");
  const kycAccess = hasPermission(req.user, "kyc.view");

  try {
    const [
      totalCustomers,
      activeCustomers,
      walletBalance,
      currentSummaryRows,
      previousSummaryRows,
      series,
      services,
      pendingDeliveries,
      activeRiders,
      pendingKyc,
      activity,
    ] = await Promise.all([
      hasPermission(req.user, "users.view")
        ? User.countDocuments(customerFilter)
        : Promise.resolve(null),
      hasPermission(req.user, "users.view")
        ? User.countDocuments({ ...customerFilter, status: "ACTIVE" })
        : Promise.resolve(null),
      hasPermission(req.user, "wallets.view") ||
      hasPermission(req.user, "finance.view")
        ? User.aggregate([
            { $match: customerFilter },
            {
              $group: {
                _id: null,
                value: {
                  $sum: {
                    $convert: {
                      input: "$walletBalance",
                      to: "double",
                      onError: 0,
                      onNull: 0,
                    },
                  },
                },
              },
            },
          ])
        : Promise.resolve([]),
      transactionAccess
        ? aggregateTransactionSummary(currentMatch)
        : Promise.resolve([]),
      transactionAccess
        ? aggregateTransactionSummary(previousMatch)
        : Promise.resolve([]),
      transactionAccess
        ? aggregateTransactionSeries(currentMatch)
        : Promise.resolve([]),
      transactionAccess
        ? aggregateServices(currentMatch)
        : Promise.resolve([]),
      deliveryAccess && !scopedManager
        ? Delivery.countDocuments({
            status: "PENDING",
          })
        : Promise.resolve(null),
      hasPermission(req.user, "delivery.view")
        ? User.countDocuments({
            role: "RIDER",
            status: "ACTIVE",
            ...userScope,
          })
        : Promise.resolve(null),
      kycAccess && !scopedManager
        ? IdVerification.countDocuments({ status: "PENDING" })
        : Promise.resolve(null),
      safeActivity(req.user, currentMatch),
    ]);

    const current = summaryFrom(currentSummaryRows);
    const previous = summaryFrom(previousSummaryRows);
    const serviceMap = Object.fromEntries(
      services.map((item) => [
        String(item._id || "OTHER"),
        { count: item.count || 0, value: item.value || 0 },
      ]),
    );
    const walletValue = walletBalance[0]?.value || 0;
    const unavailable = (reason) => metric(null, false, reason);

    return res.status(200).json({
      success: true,
      data: {
        range,
        generatedAt: new Date().toISOString(),
        kpis: {
          totalCustomers: permissionMetric(req.user, "users.view", totalCustomers),
          activeCustomers: permissionMetric(req.user, "users.view", activeCustomers),
          totalWalletBalance:
            hasPermission(req.user, "wallets.view") ||
            hasPermission(req.user, "finance.view")
              ? metric(walletValue)
              : unavailable("Not available for this staff role."),
          todayTransactionVolume: permissionMetric(
            req.user,
            "transactions.view",
            current.total,
          ),
          todayTransactionValue: permissionMetric(
            req.user,
            "transactions.view",
            current.value || 0,
          ),
          successfulTransactions: permissionMetric(
            req.user,
            "transactions.view",
            current.successful,
          ),
          pendingTransactions: permissionMetric(
            req.user,
            "transactions.view",
            current.pending,
          ),
          failedTransactions: permissionMetric(
            req.user,
            "transactions.view",
            current.failed,
          ),
          pendingWithdrawals: hasPermission(req.user, "withdrawals.view")
            ? unavailable("No withdrawal aggregate is available in this API.")
            : unavailable("Not available for this staff role."),
          pendingKycReviews:
            kycAccess && !scopedManager
              ? metric(pendingKyc)
              : unavailable(
                  scopedManager
                    ? "KYC scope cannot be safely verified for this management role."
                    : "Not available for this staff role.",
                ),
          activeRiders: permissionMetric(
            req.user,
            "delivery.view",
            activeRiders,
          ),
          pendingSolarApplications: hasPermission(req.user, "solar.view")
            ? unavailable("Solar application aggregate is not available here.")
            : unavailable("Not available for this staff role."),
        },
        comparisons: {
          transactionVolume: percentChange(current.total, previous.total),
          transactionValue: percentChange(current.value, previous.value),
          successfulTransactions: percentChange(
            current.successful,
            previous.successful,
          ),
        },
        operations: {
          transactionsToday: permissionMetric(
            req.user,
            "transactions.view",
            current.total,
          ),
          transfers: permissionMetric(
            req.user,
            "transactions.view",
            (serviceMap.TRANSFER?.count || 0) +
              (serviceMap.BANK_TRANSFER?.count || 0),
          ),
          withdrawals: hasPermission(req.user, "withdrawals.view")
            ? unavailable("Withdrawal records are not exposed by this API.")
            : unavailable("Not available for this staff role."),
          airtime: permissionMetric(
            req.user,
            "transactions.view",
            serviceMap.AIRTIME?.count || 0,
          ),
          data: permissionMetric(
            req.user,
            "transactions.view",
            serviceMap.DATA?.count || 0,
          ),
          electricity: permissionMetric(
            req.user,
            "transactions.view",
            serviceMap.ELECTRICITY?.count || 0,
          ),
          delivery:
            deliveryAccess && !scopedManager
              ? metric(
                  await Delivery.countDocuments({
                    createdAt: { $gte: start, $lt: end },
                  }),
                )
              : unavailable(
                  scopedManager
                    ? "Delivery scope cannot be safely verified for this management role."
                    : "Not available for this staff role.",
                ),
          marketplace: unavailable("Marketplace aggregate is not available here."),
          solar: hasPermission(req.user, "solar.view")
            ? unavailable("Solar aggregate is not available here.")
            : unavailable("Not available for this staff role."),
        },
        performance: {
          series: series.map((item) => ({
            date: item._id,
            successful: item.successful || 0,
            pending: item.pending || 0,
            failed: item.failed || 0,
            value: item.value || 0,
          })),
        },
        attention: {
          pendingKyc: kycAccess && !scopedManager ? pendingKyc : null,
          pendingWithdrawals: null,
          failedTransactions: transactionAccess ? current.failed : null,
          pendingDeliveries:
            deliveryAccess && !scopedManager ? pendingDeliveries : null,
          unresolvedSupport: null,
          pendingSolar: null,
        },
        activity: activity.map((item) => ({
          actor: "ServicePay system",
          action: "Transaction recorded",
          target: item.reference,
          service: item.serviceType,
          amount: item.amount,
          status: item.status,
          time: item.createdAt,
        })),
        health: {
          backend: unavailable("No bounded backend health probe is configured."),
          database: unavailable(
            "No bounded database health probe is configured.",
          ),
          authentication: unavailable(
            "No independent authentication health probe is configured.",
          ),
          email: unavailable("Email health is not checked by this endpoint."),
          providers: unavailable(
            "Provider health is not checked by this endpoint.",
          ),
        },
        unavailable: [
          "Withdrawal aggregate",
          "Solar application aggregate",
          "Support ticket aggregate",
          "Admin audit log feed",
          "Email provider health",
          "External provider health",
        ],
      },
    });
  } catch (error) {
    console.error("Executive admin dashboard error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load executive dashboard.",
    });
  }
};

module.exports = {
  RANGE_DAYS,
  normalizeRange,
  getDateWindow,
  readPermissions,
  hasPermission,
  buildScopeFilter,
  getExecutiveDashboard,
};