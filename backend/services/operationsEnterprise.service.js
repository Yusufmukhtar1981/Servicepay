const User = require("../models/user.model");
const Role = require("../models/role.model");
const Transaction = require("../models/transaction.model");
const Case = require("../models/fintechCase.model");
const Audit = require("../models/adminAuditLog.model");
const safe = require("./supportWorkspace.service");

const DAYS = { day: 1, week: 7, month: 30 };
const SERVICES = ["DATA", "AIRTIME", "ELECTRICITY", "VIRTUAL_ACCOUNT", "WALLET_FUNDING",
  "TRANSFER", "MARKETPLACE", "DELIVERY", "ID_VERIFICATION"];
const SUCCESS = ["SUCCESS", "SUCCESSFUL", "COMPLETED"];
const FAILED = ["FAILED", "FAILURE"];
const PENDING = ["PENDING", "PROCESSING", "UNDER_REVIEW", "UNKNOWN", "PENDING_VERIFICATION", "CREATED"];
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const amount = field => ({ $convert: { input: `$${field}`, to: "double", onError: 0, onNull: 0 } });
const sumStatus = statuses => ({ $sum: { $cond: [{ $in: ["$status", statuses] }, 1, 0] } });
const countedAmount = (statuses, field) =>
  ({ $sum: { $cond: [{ $in: ["$status", statuses] }, amount(field), 0] } });
const group = _id => ({ $group: {
  _id, total: { $sum: 1 }, successful: sumStatus(SUCCESS), failed: sumStatus(FAILED),
  pending: sumStatus(PENDING), refunded: sumStatus(["REFUNDED"]),
  volume: { $sum: { $cond: [{ $in: ["$serviceType",
    ["REFUND", "REFERRAL_BONUS", "REFERRAL_BONUS_REVERSAL", "PHONE_FINANCING_REFUND"]] }, 0, amount("amount")] } },
  recordedEarnings: countedAmount(SUCCESS, "servicepayProfit"),
  refundAmount: countedAmount(["REFUNDED"], "amount"),
  charges: countedAmount(SUCCESS, "serviceCharge"),
  chargeSamples: { $sum: { $cond: [{ $and: [{ $in: ["$status", SUCCESS] },
    { $isNumber: "$serviceCharge" }] }, 1, 0] } },
  recordedHttpSamples: { $sum: { $cond: [{ $isNumber: "$providerResponse.httpStatus" }, 1, 0] } },
  recordedHttpErrors: { $sum: { $cond: [{ $and: [
    { $isNumber: "$providerResponse.httpStatus" }, { $gte: ["$providerResponse.httpStatus", 400] },
  ] }, 1, 0] } },
} });
const counters = row => {
  const value = { total: 0, successful: 0, failed: 0, pending: 0, refunded: 0, volume: 0,
    recordedEarnings: 0, refundAmount: 0, charges: 0, chargeSamples: 0, recordedHttpSamples: 0, recordedHttpErrors: 0,
    ...(row || {}) };
  value.other = value.total - value.successful - value.failed - value.pending - value.refunded;
  if (!value.chargeSamples) value.charges = null;
  return value;
};
const operational = req => req.staffAccess?.scope?.type === "GLOBAL" &&
  (req.staffAccess.isHeadOffice || (req.staffAccess.roleName === "OPERATIONS_MANAGER" &&
    req.staffAccess.permissions?.includes("operations.workspace.view")));
const permitted = (req, permission, explicit = false) => operational(req) &&
  ((!explicit && req.staffAccess.isHeadOffice) || req.staffRole?.permissions?.includes(permission) ||
    (!explicit && req.staffAccess.permissions?.includes(permission)));
const permissions = req => ({
  refund: req.staffAccess?.isHeadOffice
    ? permitted(req, "transactions.refund", true)
    : req.staffAccess?.roleName === "OPERATIONS_MANAGER" && permitted(req, "operations.refund", true),
  customerManage: permitted(req, "operations.customers.manage"),
  serviceControl: permitted(req, "operations.services.control"),
  supportManage: permitted(req, "support.assign"),
  reportExport: permitted(req, "operations.reports.export") || permitted(req, "reports.export"),
  staffManage: req.staffAccess?.isHeadOffice === true,
});
const windowFor = (period = "day", now = new Date()) => {
  if (!Object.hasOwn(DAYS, period)) throw fail(400, "Period must be day, week or month.");
  return { period, from: new Date(now.getTime() - DAYS[period] * 86400000), to: now };
};
const normalizeService = service => ({ BANK_TRANSFER: "TRANSFER", INTERSTATE_LOGISTICS: "DELIVERY",
  NIN: "ID_VERIFICATION" }[service] || service || "OTHER");
const times = row => {
  const created = new Date(row.createdAt).getTime();
  const reply = [...(row.publicReplies || [])].filter(v => v.authorRole !== "CUSTOMER" &&
    Number.isFinite(new Date(v.createdAt).getTime())).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0];
  const resolved = [...(row.statusEvents || [])].filter(v => ["RESOLVED", "CLOSED"].includes(v.status))
    .sort((a, b) => new Date(a.at || a.createdAt) - new Date(b.at || b.createdAt))[0];
  const duration = value => {
    const t = new Date(value).getTime() - created;
    return Number.isFinite(t) && t >= 0 ? t : null;
  };
  return { response: reply ? duration(reply.createdAt) : null,
    resolution: resolved ? duration(resolved.at || resolved.createdAt) : null };
};
const average = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const summary = async (req, query = {}, now = new Date()) => {
  if (!operational(req)) throw fail(403, "Operations workspace access required.");
  const window = windowFor(query.period, now);
  const date = { $gte: window.from, $lte: window.to };
  const day = new Date(now.getTime() - 86400000), week = new Date(now.getTime() - 7 * 86400000);
  const month = new Date(now.getTime() - 30 * 86400000);
  const [txRows, customerRows, complaintRows, complaintCounts, staffRows, roles, vaRows, activity] = await Promise.all([
    Transaction.aggregate([{ $match: { createdAt: { $gte: month, $lte: now } } }, { $facet: {
      period: [{ $match: { createdAt: date } }, group(null)],
      services: [{ $match: { createdAt: date } }, group({ $ifNull: ["$serviceType", "$type"] })],
      trends: [{ $match: { createdAt: date } },
        group({ $dateToString: { date: "$createdAt", format: "%Y-%m-%d", timezone: "UTC" } }),
        { $sort: { _id: 1 } }],
      daily: [{ $match: { createdAt: { $gte: day } } }, group(null)],
      weekly: [{ $match: { createdAt: { $gte: week } } }, group(null)],
      monthly: [group(null)],
      recent: [{ $match: { createdAt: date } }, { $sort: { createdAt: -1, _id: -1 } }, { $limit: 12 },
        { $project: { reference: 1, serviceType: 1, status: 1, amount: 1, createdAt: 1 } }],
    } }]).option({ maxTimeMS: 15000 }),
    User.aggregate([{ $match: { role: "CUSTOMER" } },
      { $group: { _id: "$status", count: { $sum: 1 } } }]).option({ maxTimeMS: 10000 }),
    Case.find({ type: "COMPLAINT", createdAt: date }).select("assignedTo status createdAt publicReplies statusEvents")
      .sort({ createdAt: -1 }).limit(5001).maxTimeMS(10000).lean(),
    Case.aggregate([{ $match: { type: "COMPLAINT" } }, { $group: { _id: "$status", count: { $sum: 1 } } }])
      .option({ maxTimeMS: 10000 }),
    User.find({ isStaff: true }).select("_id fullName status staffRoleId role")
      .sort({ _id: 1 }).limit(101).maxTimeMS(10000).lean(),
    Role.find().select("_id name").maxTimeMS(5000).lean(),
    User.aggregate([{ $match: { role: "CUSTOMER", "virtualAccount.status": { $in: ["ACTIVE", "FAILED", "UNKNOWN", "PENDING", "DISABLED"] } } },
      { $group: { _id: "$virtualAccount.status", count: { $sum: 1 } } }]).option({ maxTimeMS: 10000 }),
    Audit.find({ action: { $nin: ["FINANCIAL_REPORT_VIEWED", "FINANCIAL_REPORT_EXPORTED"] } })
      .select("action actorName createdAt").sort({ createdAt: -1 }).limit(15).maxTimeMS(5000).lean(),
  ]);
  const tx = txRows[0] || {}, selected = counters(tx.period?.[0]);
  // Commission cost is separate from the stored platform margin; never silently subtract it twice.
  const commissionRows = await require("../models/commission.model").aggregate([
    { $match: { createdAt: date, status: { $nin: ["REVERSED", "CANCELLED"] } } },
    { $group: { _id: null, amount: { $sum: amount("commissionAmount") }, count: { $sum: 1 } } },
  ]).option({ maxTimeMS: 10000 });
  selected.commission = number(commissionRows[0]?.amount);
  selected.commissionRecords = commissionRows[0]?.count || 0;
  const customers = { total: 0, active: 0, inactive: 0, other: 0 };
  for (const row of customerRows) {
    customers.total += row.count;
    if (row._id === "ACTIVE") customers.active += row.count;
    else if (["INACTIVE", "SUSPENDED", "DEACTIVATED", "LOCKED", "PENDING"].includes(row._id))
      customers.inactive += row.count;
    else customers.other += row.count;
  }
  const mapped = new Map();
  for (const raw of tx.services || []) {
    const service = normalizeService(raw._id), old = mapped.get(service) || counters();
    for (const key of Object.keys(old)) if (typeof old[key] === "number" || key === "charges")
      old[key] = number(old[key]) + number(raw[key]);
    mapped.set(service, old);
  }
  const services = [...new Set([...SERVICES, ...mapped.keys()])].map(service => {
    if (service === "VIRTUAL_ACCOUNT") {
      const pending = vaRows.filter(v => ["PENDING", "UNKNOWN"].includes(v._id)).reduce((n, v) => n + v.count, 0);
      const failed = vaRows.find(v => v._id === "FAILED")?.count || 0;
      const successful = vaRows.find(v => v._id === "ACTIVE")?.count || 0;
      const total = vaRows.reduce((n, v) => n + v.count, 0);
      return { service, ...counters(), failed, pending, successful, total,
        other: total - failed - pending - successful, volume: null, recordedEarnings: null, refundAmount: null,
        availability: failed || pending ? "ISSUES_RECORDED" : successful ? "ACTIVITY_RECORDED" : "NO_ACTIVITY", errorRate: null,
        notice: "All-age provisioning records, not payments, account creations during the selected period or verified provider uptime. Active accounts are successful provisioning records." };
    }
    const row = counters(mapped.get(service));
    return { service, ...row, availability: row.failed || row.pending ? "ISSUES_RECORDED" :
      row.total ? "ACTIVITY_RECORDED" : "NO_ACTIVITY",
      errorRate: row.recordedHttpSamples ? row.recordedHttpErrors / row.recordedHttpSamples : null };
  });
  const complaints = complaintRows.slice(0, 5000), durations = complaints.map(times);
  const sumComplaints = statuses => complaintCounts.filter(v => statuses.includes(v._id)).reduce((n, v) => n + v.count, 0);
  const support = {
    open: sumComplaints(["OPEN", "IN_PROGRESS", "IN_REVIEW", "WAITING_ON_CUSTOMER", "ESCALATED"]),
    escalated: sumComplaints(["ESCALATED"]),
    overdue: await Case.countDocuments({ type: "COMPLAINT", status: { $in: ["OPEN", "IN_PROGRESS", "IN_REVIEW", "WAITING_ON_CUSTOMER", "ESCALATED"] },
      createdAt: { $lt: new Date(now.getTime() - 86400000) } }).maxTimeMS(10000),
    aiEscalated: await Case.countDocuments({ type: "COMPLAINT", aiEscalated: true, createdAt: date }).maxTimeMS(5000),
    averageResponseMs: average(durations.map(v => v.response).filter(v => v !== null)),
    averageResolutionMs: average(durations.map(v => v.resolution).filter(v => v !== null)),
    coverageNotice: "Timing uses recorded staff public replies/status events in up to 5,000 period complaints. Missing evidence is unavailable, not zero.",
  };
  const roleNames = new Map(roles.map(v => [String(v._id), v.name]));
  const staff = staffRows.slice(0, 100).map(v => {
    const tickets = complaints.filter(t => String(t.assignedTo) === String(v._id)), timing = tickets.map(times);
    const resolved = tickets.filter(t => ["RESOLVED", "CLOSED"].includes(t.status)).length;
    return { id: String(v._id), name: v.fullName, role: roleNames.get(String(v.staffRoleId)) || v.role,
      status: v.status, assigned: tickets.length, resolved,
      resolutionRate: tickets.length ? resolved / tickets.length : null,
      averageResponseMs: average(timing.map(t => t.response).filter(t => t !== null)),
      averageResolutionMs: average(timing.map(t => t.resolution).filter(t => t !== null)) };
  }).sort((a, b) => b.resolved - a.resolved || b.assigned - a.assigned);
  const alerts = [];
  const alert = (code, severity, message, count) => alerts.push({ code, severity, message, count, observedAt: now });
  if (selected.total >= 20 && selected.failed / selected.total >= .2)
    alert("HIGH_FAILURE_RATE", "HIGH", "At least 20% of selected transaction records failed.", selected.failed);
  if (selected.pending) alert("PENDING_TRANSACTIONS", "WARNING", "Recorded pending outcomes need investigation; no retry or refund is implied.", selected.pending);
  const vaIssues = vaRows.filter(v => ["FAILED", "PENDING", "UNKNOWN"].includes(v._id)).reduce((n, v) => n + v.count, 0);
  if (vaIssues) alert("VIRTUAL_ACCOUNT_ISSUES", "WARNING", "Unresolved virtual-account provisioning records.", vaIssues);
  if (support.overdue) alert("OVERDUE_COMPLAINTS", "HIGH", "Unresolved complaints older than 24 hours.", support.overdue);
  if (selected.recordedHttpErrors) alert("PROVIDER_HTTP_ERRORS", "WARNING", "Recorded provider HTTP errors; not an active connectivity test.", selected.recordedHttpErrors);
  const [overduePending, patterns] = await Promise.all([
    Transaction.countDocuments({ status: { $in: PENDING }, createdAt: { $lt: new Date(now.getTime() - 30 * 60000) } }).maxTimeMS(10000),
    Transaction.aggregate([{ $match: { createdAt: { $gte: new Date(now.getTime() - 10 * 60000), $lte: now } } },
      { $group: { _id: "$customerId", count: { $sum: 1 } } },
      { $match: { count: { $gte: 10 } } }, { $count: "customers" }]).option({ maxTimeMS: 10000 }),
  ]);
  if (overduePending) alert("LONG_PROCESSING", "HIGH", "Pending records older than 30 minutes (all ages); investigate without resubmitting.", overduePending);
  if (patterns[0]?.customers) alert("UNUSUAL_ACTIVITY", "WARNING", "Customers with at least 10 transaction records in 10 minutes; review signal only, not a fraud verdict.", patterns[0].customers);
  let serviceControls = [];
  // Do not call getGlobalSettings() here: a read-only dashboard must not create settings.
  const settings = await require("../models/appSettings.model").findOne({ key: "GLOBAL_SETTINGS" }).lean();
  if (settings) serviceControls = require("../controllers/featureControl.controller").currentRegistry(settings)
    .filter(v => !v.protected).map(v => ({ key: v.key, enabled: v.enabled }));
  return {
    generatedAt: now, ...window, coverageNotice:
      "Transaction collection only; other service lifecycle collections are not additive. Activity is not verified provider uptime. All timestamps UTC.",
    permissions: permissions(req), customers, summary: selected,
    trends: (tx.trends || []).map(v => ({ ...counters(v), date: v._id, count: v.total })),
    services, financial: {
      dailyEarnings: number(tx.daily?.[0]?.recordedEarnings), weeklyEarnings: number(tx.weekly?.[0]?.recordedEarnings),
      monthlyEarnings: number(tx.monthly?.[0]?.recordedEarnings),
      notice: "Rolling 24h/7d/30d recorded ServicePay profit on completed transactions only. Not gross custody, provider cost or reconciled company net income. Commissions are separate non-reversed period commission records, not additional revenue and not subtracted twice.",
    }, staff, staffCoverage: { limit: 100, truncated: staffRows.length > 100 },
    support, alerts, serviceControls, recentTransactions: (tx.recent || []).map(v => ({
      id: String(v._id), reference: v.reference, service: v.serviceType, status: v.status, amount: v.amount, createdAt: v.createdAt,
    })), activity: activity.map(v => ({ action: v.action, actorName: v.actorName, createdAt: v.createdAt })),
    coverage: { transactions: "Complete bounded period aggregate (maximum 30 days)", complaintSample: complaints.length,
      complaintTruncated: complaintRows.length > 5000, staffAttribution: "Current assignment; timing evidence is period sampled",
      financialStatusBuckets: "Mutually exclusive; other includes unrecognized legacy states",
      refundVolume: "REFUNDED original transactions only, not separately counted refund-credit transactions",
      volume: "Recorded original transaction amounts, excluding refund/bonus credit records; includes non-final records, not settled sales",
      charges: "Only explicit serviceCharge snapshots; null when none recorded. Never inferred from transferred or funded principal." },
  };
};
module.exports = { summary, operational, permitted, permissions, windowFor, counters, times, normalizeService, SERVICES, fail };
