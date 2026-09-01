const mongoose = require("mongoose");
const AdminAuditLog = require("../models/adminAuditLog.model");
const LoginSecurityEvent = require("../models/loginSecurityEvent.model");
const AdminAccessLog = require("../models/adminAccessLog.model");
const AdminExportHistory = require("../models/adminExportHistory.model");
const PrivacyRequest = require("../models/privacyRequest.model");
const Transaction = require("../models/transaction.model");
const User = require("../models/user.model");
const Branch = require("../models/branch.model");
const Delivery = require("../models/delivery.model");
const WithdrawalRequest = require("../models/withdrawalRequest.model");
const KycProfile = require("../models/kycProfile.model");
const MarketplaceOrder = require("../models/marketplaceOrder.model");
const SolarApplication = require("../models/solarApplication.model");

const SUCCESS = ["SUCCESS", "SUCCESSFUL", "COMPLETED", "APPROVED"];
const sensitive = /password|token|secret|pin|accountnumber|sessionreference|authorization|cookie/i;
const escaped = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const actorId = (req) => req.user?._id || req.user?.id;
const ip = (req) => String(req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim();
const clean = (value) => {
  if (Array.isArray(value)) return value.map(clean);
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !sensitive.test(key)).map(([key, val]) => [key, clean(val)]));
};
const page = (req, res) => {
  const p = Number(req.query.page || 1), limit = Number(req.query.limit || 25);
  if (!Number.isInteger(p) || p < 1 || p > 100 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    res.status(400).json({ success: false, message: "page and limit must be between 1 and 100." }); return null;
  }
  return { page: p, limit, skip: (p - 1) * limit };
};
const dates = (req, res) => {
  const rawEnd = String(req.query.end || "");
  const end = rawEnd
    ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(rawEnd) ? `${rawEnd}T23:59:59.999Z` : rawEnd)
    : new Date();
  const start = req.query.start ? new Date(req.query.start) : new Date(end.getTime() - 30 * 86400000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end || end - start > 90 * 86400000) {
    res.status(400).json({ success: false, message: "Use valid start/end dates spanning no more than 90 days." }); return null;
  }
  return { createdAt: { $gte: start, $lte: end } };
};
const audit = (req, action, reason, metadata = {}) => AdminAuditLog.create({
  actorId: actorId(req), actorRole: String(req.user?.role || "STAFF"), actorName: req.user?.fullName || "",
  action, reason, metadata: clean(metadata), ipAddress: ip(req), userAgent: String(req.headers["user-agent"] || ""),
  requestMethod: req.method, requestPath: req.baseUrl + req.path,
}).catch(() => null);
const list = async (Model, req, res, filter, projection = null) => {
  const pg = page(req, res); if (!pg) return;
  const [items, total] = await Promise.all([
    Model.find(filter, projection).sort({ createdAt: -1 }).skip(pg.skip).limit(pg.limit).lean(), Model.countDocuments(filter),
  ]);
  return res.json({ success: true, data: { items: items.map(clean), pagination: { page: pg.page, limit: pg.limit, total, totalPages: Math.max(1, Math.ceil(total / pg.limit)) } } });
};

exports.catalog = (req, res) => res.json({ success: true, data: [
  { key: "audit", endpoint: "/audit-logs", permission: "audit.view", available: true }, { key: "security", endpoint: "/security-events", permission: "audit.view", available: true },
  { key: "access", endpoint: "/access-logs", permission: "audit.view", available: true }, { key: "exports", endpoint: "/exports/history", permission: "audit.export", available: true },
  { key: "readiness", endpoint: "/readiness", permission: "dashboard.view", available: true }, { key: "privacy", endpoint: "/privacy-requests", permission: "users.update", available: true },
  { key: "executiveAnalytics", endpoint: "/analytics/executive", permission: "dashboard.view", available: true }, { key: "serviceAnalytics", endpoint: "/analytics/services", permission: "dashboard.view", available: true },
  { key: "transactionAnalytics", endpoint: "/analytics/transactions", permission: "transactions.view", available: true }, { key: "customerAnalytics", endpoint: "/analytics/customers", permission: "users.view", available: true },
] });

exports.auditLogs = async (req, res, next) => { try {
  const filter = {}; if (req.query.action) filter.action = String(req.query.action).toUpperCase();
  if (req.query.status) filter.status = String(req.query.status).toUpperCase();
  if (req.query.actorId && mongoose.Types.ObjectId.isValid(req.query.actorId)) filter.actorId = req.query.actorId;
  if (req.query.search) filter.$or = ["action", "actorName", "requestPath", "actorRole"].map((field) => ({ [field]: new RegExp(escaped(req.query.search), "i") }));
  const range = dates(req, res); if (!range) return; Object.assign(filter, range);
  return await list(AdminAuditLog, req, res, filter, "actorId actorRole actorName targetUserId targetUserName action reason requestMethod requestPath status createdAt");
} catch (e) { next(e); } };
exports.securityEvents = async (req, res, next) => { try {
  const filter = {}; if (req.query.outcome) filter.outcome = String(req.query.outcome).toUpperCase();
  if (req.query.search) filter.$or = ["identifier", "ipAddress"].map((field) => ({ [field]: new RegExp(escaped(req.query.search), "i") }));
  const range = dates(req, res); if (!range) return; Object.assign(filter, range);
  return await list(LoginSecurityEvent, req, res, filter, "user identifier outcome ipAddress userAgent createdAt");
} catch (e) { next(e); } };
exports.accessLogs = async (req, res, next) => { try {
  const filter = {}; if (req.query.statusCode && !Number.isInteger(Number(req.query.statusCode))) return res.status(400).json({ success: false, message: "statusCode must be an integer." });
  if (req.query.statusCode) filter.statusCode = Number(req.query.statusCode);
  if (req.query.method) filter.method = String(req.query.method).toUpperCase();
  if (req.query.search) filter.path = new RegExp(escaped(req.query.search), "i");
  const range = dates(req, res); if (!range) return; Object.assign(filter, range);
  return await list(AdminAccessLog, req, res, filter);
} catch (e) { next(e); } };

const csv = (rows, columns) => [columns.join(","), ...rows.map(row => columns.map(key => `"${String(row[key] ?? "").replace(/"/g, "\"\"").replace(/^[=+\-@]/, "'$&")}"`).join(","))].join("\r\n");
exports.exportDataset = async (req, res, next) => { try {
  const supplied = String(req.params.dataset || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  const aliases = { AUDIT_LOGS: "AUDIT", AUDIT: "AUDIT", SECURITY_EVENTS: "SECURITY", SECURITY: "SECURITY", TRANSACTION: "TRANSACTIONS", TRANSACTIONS: "TRANSACTIONS", CUSTOMER: "CUSTOMERS", CUSTOMERS: "CUSTOMERS", BRANCH: "BRANCHES", BRANCHES: "BRANCHES", STAFF: "STAFF", DELIVERY: "DELIVERIES", DELIVERIES: "DELIVERIES", WITHDRAWAL: "WITHDRAWALS", WITHDRAWALS: "WITHDRAWALS", KYC: "KYC", MARKETPLACE: "MARKETPLACE", SOLAR: "SOLAR" };
  const dataset = aliases[supplied];
  const sources = {
    AUDIT: [AdminAuditLog, "action actorRole actorName status requestMethod requestPath createdAt", ["action", "actorRole", "actorName", "status", "requestMethod", "requestPath", "createdAt"]],
    SECURITY: [LoginSecurityEvent, "outcome createdAt", ["outcome", "createdAt"]],
    TRANSACTIONS: [Transaction, "reference serviceType provider amount status createdAt", ["reference", "serviceType", "provider", "amount", "status", "createdAt"]],
    CUSTOMERS: [User, "fullName role status state kycVerified createdAt", ["fullName", "role", "status", "state", "kycVerified", "createdAt"]],
    STAFF: [User, "fullName role status department state createdAt", ["fullName", "role", "status", "department", "state", "createdAt"]],
    BRANCHES: [Branch, "name code status state createdAt", ["name", "code", "status", "state", "createdAt"]],
    DELIVERIES: [Delivery, "trackingNumber status paymentStatus deliveryFee createdAt", ["trackingNumber", "status", "paymentStatus", "deliveryFee", "createdAt"]],
    WITHDRAWALS: [WithdrawalRequest, "reference amount status createdAt", ["reference", "amount", "status", "createdAt"]],
    KYC: [KycProfile, "level requestedLevel status createdAt", ["level", "requestedLevel", "status", "createdAt"]],
    MARKETPLACE: [MarketplaceOrder, "orderReference orderStatus totalAmount createdAt", ["orderReference", "orderStatus", "totalAmount", "createdAt"]],
    SOLAR: [SolarApplication, "status depositRequired depositPaid outstandingBalance createdAt", ["status", "depositRequired", "depositPaid", "outstandingBalance", "createdAt"]],
  };
  if (!sources[dataset]) return res.status(400).json({ success: false, message: "Unsupported export dataset." });
  const [Model, projection, columns] = sources[dataset]; const filter = dates(req, res); if (!filter) return;
  const rows = await Model.find(filter, projection).sort({ createdAt: -1 }).limit(5000).lean();
  await AdminExportHistory.create({ requestedBy: actorId(req), dataset, rowCount: rows.length, filters: { start: req.query.start || null, end: req.query.end || null }, columns, status: "COMPLETED", completedAt: new Date(), contentAvailable: true });
  await audit(req, "DATA_EXPORT_CREATED", `Exported ${dataset} records`, { dataset, rowCount: rows.length });
  res.set("Content-Type", "text/csv; charset=utf-8"); res.set("Content-Disposition", `attachment; filename="${dataset.toLowerCase()}-export.csv"`);
  return res.send(csv(rows.map(clean), columns));
} catch (e) { next(e); } };
exports.exportHistory = (req, res, next) => list(AdminExportHistory, req, res, {}, "requestedBy dataset rowCount filters columns createdAt").catch(next);

exports.readiness = (req, res) => res.json({ success: true, data: {
  backup: { available: false, status: "UNAVAILABLE", message: "No verified backup integration is exposed by this application." },
  providers: {
    paystack: { status: "PROVIDER_MANAGED", message: "Live readiness is not checked by this endpoint." },
    clubkonnect: { status: "PROVIDER_MANAGED", message: "Live readiness is not checked by this endpoint." },
    securewave: { status: "PROVIDER_MANAGED", message: "Live readiness is not checked by this endpoint." },
  },
} });

exports.listPrivacy = (req, res, next) => list(PrivacyRequest, req, res, req.query.status ? { status: String(req.query.status).toUpperCase() } : {}).catch(next);
exports.createPrivacy = async (req, res, next) => { try {
  const { subjectUser, type, description = "" } = req.body;
  if (!mongoose.Types.ObjectId.isValid(subjectUser) || !["ACCESS", "ERASURE", "CORRECTION", "OBJECTION"].includes(String(type).toUpperCase())) return res.status(400).json({ success: false, message: "Valid subjectUser and privacy request type are required." });
  if (!await User.exists({ _id: subjectUser })) return res.status(404).json({ success: false, message: "Privacy request subject user was not found." });
  const request = await PrivacyRequest.create({ subjectUser, type: String(type).toUpperCase(), description: String(description).slice(0, 2000), createdBy: actorId(req), history: [{ status: "OPEN", changedBy: actorId(req), note: "Created" }] });
  await audit(req, "PRIVACY_REQUEST_CREATED", "Created privacy request", { privacyRequestId: request._id, type: request.type });
  return res.status(201).json({ success: true, data: clean(request.toObject()) });
} catch (e) { next(e); } };
exports.updatePrivacy = async (req, res, next) => { try {
  const status = String(req.body.status || "").toUpperCase();
  const note = String(req.body.note ?? req.body.resolutionNote ?? "").slice(0, 1000);
  if (!["OPEN", "IN_REVIEW", "COMPLETED", "REJECTED"].includes(status)) return res.status(400).json({ success: false, message: "Invalid privacy request status." });
  const request = await PrivacyRequest.findById(req.params.id); if (!request) return res.status(404).json({ success: false, message: "Privacy request not found." });
  if (status === "COMPLETED" && request.type === "ERASURE") return res.status(409).json({ success: false, message: "ERASURE requests cannot be completed because no approved anonymization and retention pipeline is available." });
  if (status === "COMPLETED" && note.trim().length < 10) return res.status(400).json({ success: false, message: "A meaningful resolution note of at least 10 characters is required to complete this privacy request." });
  request.status = status; request.history.push({ status, note, changedBy: actorId(req) }); await request.save();
  await audit(req, "PRIVACY_REQUEST_UPDATED", "Updated privacy request status", { privacyRequestId: request._id, status });
  return res.json({ success: true, data: clean(request.toObject()) });
} catch (e) { next(e); } };

const amount = (field) => ({ $convert: { input: `$${field}`, to: "double", onError: 0, onNull: 0 } });
exports.executiveAnalytics = async (req, res, next) => { try {
  const range = dates(req, res); if (!range) return;
  const [transactionTotals, pendingWithdrawals, pendingKyc, pendingSolar, pendingDeliveries] = await Promise.all([
    Transaction.aggregate([{ $match: range }, { $group: { _id: null, count: { $sum: 1 }, value: { $sum: amount("amount") }, successful: { $sum: { $cond: [{ $in: ["$status", SUCCESS] }, 1, 0] } } } }]),
    WithdrawalRequest.countDocuments({ status: "PENDING" }), KycProfile.countDocuments({ status: { $in: ["PENDING", "UNDER_REVIEW"] } }),
    SolarApplication.countDocuments({ status: { $in: ["SUBMITTED", "UNDER_REVIEW", "MORE_INFORMATION_REQUIRED"] } }), Delivery.countDocuments({ status: { $in: ["PENDING", "ASSIGNED"] } }),
  ]);
  return res.json({ success: true, data: { transactions: transactionTotals[0] || { count: 0, value: 0, successful: 0 }, pendingOperations: { withdrawals: pendingWithdrawals, kyc: pendingKyc, solar: pendingSolar, deliveries: pendingDeliveries } } });
} catch (e) { next(e); } };
exports.serviceAnalytics = async (req, res, next) => { try {
  const range = dates(req, res); if (!range) return;
  const data = await Transaction.aggregate([{ $match: range }, { $group: { _id: "$serviceType", count: { $sum: 1 }, value: { $sum: amount("amount") }, successful: { $sum: { $cond: [{ $in: ["$status", SUCCESS] }, 1, 0] } }, lastActivity: { $max: "$createdAt" } } }, { $project: { service: "$_id", count: 1, value: 1, lastActivity: 1, successRate: { $cond: [{ $eq: ["$count", 0] }, 0, { $multiply: [{ $divide: ["$successful", "$count"] }, 100] }] } } }, { $sort: { value: -1 } }]);
  res.json({ success: true, data });
} catch (e) { next(e); } };
exports.transactionAnalytics = async (req, res, next) => { try {
  const range = dates(req, res); if (!range) return;
  const [statuses, daily] = await Promise.all([
    Transaction.aggregate([{ $match: range }, { $group: { _id: "$status", count: { $sum: 1 }, value: { $sum: amount("amount") } } }]),
    Transaction.aggregate([{ $match: range }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 }, value: { $sum: amount("amount") } } }, { $sort: { _id: 1 } }]),
  ]); res.json({ success: true, data: { statuses, daily } });
} catch (e) { next(e); } };
exports.customerAnalytics = async (req, res, next) => { try {
  const range = dates(req, res); if (!range) return;
  const [growth, states, tiers, active, top, recent, wallet] = await Promise.all([
    User.aggregate([{ $match: range }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, registrations: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    User.aggregate([{ $match: range }, { $group: { _id: "$state", count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    KycProfile.aggregate([{ $match: range }, { $group: { _id: { level: "$level", status: "$status" }, count: { $sum: 1 } } }]),
    Transaction.aggregate([{ $match: range }, { $group: { _id: "$customerId" } }, { $limit: 10001 }]),
    Transaction.aggregate([{ $match: range }, { $group: { _id: "$customerId", transactions: { $sum: 1 }, value: { $sum: amount("amount") } } }, { $sort: { value: -1 } }, { $limit: 10 }]),
    User.find(range, "fullName role status state createdAt").sort({ createdAt: -1 }).limit(10).lean(),
    User.aggregate([{ $match: range }, { $group: { _id: null, total: { $sum: amount("walletBalance") } } }]),
  ]);
  const activeCapped = active.length > 10000;
  res.json({ success: true, data: { growth, states, kycTiers: tiers, walletBalance: wallet[0]?.total || 0, transactionActiveCustomers: Math.min(active.length, 10000), transactionActiveCustomersCapped: activeCapped, topActivity: top, recentRegistrations: recent.map(clean) } });
} catch (e) { next(e); } };