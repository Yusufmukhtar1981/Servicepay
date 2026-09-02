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
const PhoneApplication = require("../models/phoneApplication.model");
const PhoneFinance = require("../models/phoneFinance.model");
const PhonePayment = require("../models/phonePayment.model");
const EmpowermentProgram = require("../models/empowermentProgram.model");
const EmpowermentFunding = require("../models/empowermentFunding.model");
const EmpowermentDisbursement = require("../models/empowermentDisbursement.model");
const AmanaOrder = require("../models/amanaOrder.model");

const TRANSACTION_STATUS_TAXONOMY = Object.freeze({
  successful: Object.freeze(["SUCCESSFUL"]),
  pending: Object.freeze(["PENDING"]),
  failed: Object.freeze(["FAILED"]),
  refunded: Object.freeze(["REFUNDED"]),
});
const classifyTransactionStatus = (value) =>
  Object.keys(TRANSACTION_STATUS_TAXONOMY).find((bucket) =>
    TRANSACTION_STATUS_TAXONOMY[bucket].includes(value)) || "other";
exports.TRANSACTION_STATUS_TAXONOMY = TRANSACTION_STATUS_TAXONOMY;
exports.classifyTransactionStatus = classifyTransactionStatus;
const sensitive = /password|token|secret|pin|accountnumber|sessionreference|authorization|cookie/i;
const pii = /email|phone|ip(address)?|identifier/i;
const escaped = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const actorId = (req) => req.user?._id || req.user?.id;
const ip = (req) => String(req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim();
const mask = (value) => {
  const text = String(value ?? "");
  if (!text) return "";
  return text.length <= 4 ? "****" : `${text.slice(0, 2)}***${text.slice(-2)}`;
};
const clean = (value) => {
  if (Array.isArray(value)) return value.map(clean);
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !sensitive.test(key))
    .map(([key, val]) => [key, pii.test(key) ? mask(val) : clean(val)]));
};
exports.maskSensitiveResponse = clean;
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
  { key: "audit", endpoint: "/audit-logs", permission: "audit.view", live: true, capabilities: ["search", "filter", "safeMetadata"] }, { key: "security", endpoint: "/security-events", permission: "audit.view", live: true, capabilities: ["investigate", "acknowledge", "resolve"] },
  { key: "access", endpoint: "/access-logs", permission: "audit.view", live: true, capabilities: ["filter", "pagination"] }, { key: "exports", endpoint: "/exports/history", permission: "audit.export", live: true, capabilities: ["csv", "history"] },
  { key: "readiness", endpoint: "/readiness", permission: "dashboard.view", live: true, capabilities: ["readOnly", "providerConfiguration"], manualBackupSupported: false }, { key: "privacy", endpoint: "/privacy-requests", permission: "users.update", live: true, capabilities: ["ACCESS", "CORRECTION", "OBJECTION"], erasureExecution: false },
  { key: "executiveAnalytics", endpoint: "/analytics/executive", permission: "dashboard.view", live: true, capabilities: ["liveTotals", "trend"] }, { key: "serviceAnalytics", endpoint: "/analytics/services", permission: "dashboard.view", live: true, capabilities: ["rollups"] },
  { key: "transactionAnalytics", endpoint: "/analytics/transactions", permission: "transactions.view", live: true, capabilities: ["filters", "breakdowns", "pagination"] }, { key: "customerAnalytics", endpoint: "/analytics/customers", permission: "users.view", live: true, capabilities: ["filters", "breakdowns", "pagination"] },
] });

exports.auditLogs = async (req, res, next) => { try {
  const filter = {}; if (req.query.action) filter.action = String(req.query.action).toUpperCase();
  if (req.query.status) filter.status = String(req.query.status).toUpperCase();
  if (req.query.actorId && mongoose.Types.ObjectId.isValid(req.query.actorId)) filter.actorId = req.query.actorId;
  if (req.query.module) filter.requestPath = new RegExp(escaped(req.query.module), "i");
  if (req.query.search) filter.$or = ["action", "actorName", "requestPath", "actorRole"].map((field) => ({ [field]: new RegExp(escaped(req.query.search), "i") }));
  const range = dates(req, res); if (!range) return; Object.assign(filter, range);
  return await list(AdminAuditLog, req, res, filter, "actorId actorRole actorName targetUserId targetUserName action reason requestMethod requestPath status metadata createdAt");
} catch (e) { next(e); } };
exports.securityEvents = async (req, res, next) => { try {
  const filter = {}; if (req.query.outcome) filter.outcome = String(req.query.outcome).toUpperCase();
  if (req.query.eventType) filter.eventType = String(req.query.eventType).toUpperCase();
  if (req.query.severity) filter.severity = String(req.query.severity).toUpperCase();
  if (req.query.status) filter.workflowStatus = String(req.query.status).toUpperCase();
  if (req.query.search) filter.$or = ["identifier", "ipAddress"].map((field) => ({ [field]: new RegExp(escaped(req.query.search), "i") }));
  const range = dates(req, res); if (!range) return; Object.assign(filter, range);
  return await list(LoginSecurityEvent, req, res, filter, "user identifier outcome eventType severity workflowStatus ipAddress userAgent acknowledgedAt acknowledgedBy resolvedAt resolvedBy investigationNote createdAt");
} catch (e) { next(e); } };
exports.updateSecurityEvent = async (req, res, next) => { try {
  const action = String(req.body.action || "").toUpperCase();
  const note = String(req.body.note || "").trim().slice(0, 1000);
  if (!["ACKNOWLEDGE", "RESOLVE", "REOPEN"].includes(action)) return res.status(400).json({ success: false, message: "action must be ACKNOWLEDGE, RESOLVE, or REOPEN." });
  if ((action === "ACKNOWLEDGE" || action === "RESOLVE") && note.length < 10) return res.status(400).json({ success: false, message: "A meaningful investigation note is required." });
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, message: "Security event not found." });
  const now = new Date(); const who = actorId(req);
  const transitions = {
    ACKNOWLEDGE: { from: ["OPEN"], set: { workflowStatus: "ACKNOWLEDGED", acknowledgedAt: now, acknowledgedBy: who, investigationNote: note } },
    RESOLVE: { from: ["ACKNOWLEDGED"], set: { workflowStatus: "RESOLVED", resolvedAt: now, resolvedBy: who, investigationNote: note } },
    REOPEN: { from: ["ACKNOWLEDGED", "RESOLVED"], set: { workflowStatus: "OPEN", resolvedAt: null, resolvedBy: null, ...(note ? { investigationNote: note } : {}) } },
  };
  const transition = transitions[action];
  const event = await LoginSecurityEvent.findOneAndUpdate(
    { _id: req.params.id, workflowStatus: { $in: transition.from } },
    { $set: transition.set }, { new: true, runValidators: true }
  );
  if (!event) {
    if (!await LoginSecurityEvent.exists({ _id: req.params.id })) return res.status(404).json({ success: false, message: "Security event not found." });
    return res.status(409).json({ success: false, message: "This security-event transition is not allowed." });
  }
  await audit(req, "SECURITY_EVENT_UPDATED", `Security event ${action.toLowerCase()}`, { securityEventId: event._id, action, workflowStatus: event.workflowStatus });
  return res.json({ success: true, data: clean(event.toObject()) });
} catch (e) { next(e); } };
exports.accessLogs = async (req, res, next) => { try {
  const filter = {}; if (req.query.statusCode && !Number.isInteger(Number(req.query.statusCode))) return res.status(400).json({ success: false, message: "statusCode must be an integer." });
  if (req.query.statusCode) filter.statusCode = Number(req.query.statusCode);
  if (req.query.method) filter.method = String(req.query.method).toUpperCase();
  if (req.query.actorId && mongoose.Types.ObjectId.isValid(req.query.actorId)) filter.actorId = req.query.actorId;
  if (req.query.userId && mongoose.Types.ObjectId.isValid(req.query.userId)) filter.actorId = req.query.userId;
  if (req.query.ip) filter.ipAddress = new RegExp(escaped(req.query.ip), "i");
  if (req.query.path) filter.path = new RegExp(escaped(req.query.path), "i");
  if (req.query.search) filter.$or = ["path", "ipAddress", "method"].map(field => ({ [field]: new RegExp(escaped(req.query.search), "i") }));
  const range = dates(req, res); if (!range) return; Object.assign(filter, range);
  return await list(AdminAccessLog, req, res, filter);
} catch (e) { next(e); } };

const csv = (rows, columns) => [columns.join(","), ...rows.map(row => columns.map(key => `"${String(row[key] ?? "").replace(/"/g, "\"\"").replace(/^[=+\-@]/, "'$&")}"`).join(","))].join("\r\n");
exports.exportDataset = async (req, res, next) => { try {
  const supplied = String(req.params.dataset || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  const aliases = { AUDIT_LOGS: "AUDIT", AUDIT: "AUDIT", SECURITY_EVENTS: "SECURITY", SECURITY: "SECURITY", TRANSACTION: "TRANSACTIONS", TRANSACTIONS: "TRANSACTIONS", CUSTOMER: "CUSTOMERS", CUSTOMERS: "CUSTOMERS", BRANCH: "BRANCHES", BRANCHES: "BRANCHES", STAFF: "STAFF", DELIVERY: "DELIVERIES", DELIVERIES: "DELIVERIES", WITHDRAWAL: "WITHDRAWALS", WITHDRAWALS: "WITHDRAWALS", KYC: "KYC", MARKETPLACE: "MARKETPLACE", SOLAR: "SOLAR", FINANCING: "FINANCING", PHONE_FINANCING: "FINANCING", EMPOWERMENT: "EMPOWERMENT", AMANA: "AMANA" };
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
    FINANCING: [PhoneFinance, "reference totalPayable amountPaid outstandingBalance status createdAt", ["reference", "totalPayable", "amountPaid", "outstandingBalance", "status", "createdAt"]],
    EMPOWERMENT: [EmpowermentDisbursement, "batchReference beneficiaryCount totalAmount status createdAt", ["batchReference", "beneficiaryCount", "totalAmount", "status", "createdAt"]],
    AMANA: [AmanaOrder, "reference category totalAmount status paymentStatus createdAt", ["reference", "category", "totalAmount", "status", "paymentStatus", "createdAt"]],
  };
  if (!sources[dataset]) return res.status(400).json({ success: false, message: "Unsupported export dataset." });
  const [Model, projection, columns] = sources[dataset]; const filter = dates(req, res); if (!filter) return;
  // Export filters must be explicitly mapped to a persisted field.  In
  // particular, "status" is not a universal field across operational models.
  const exportFilters = {
    MARKETPLACE: { statusField: "orderStatus" },
    SECURITY: { statusField: "workflowStatus", outcomeField: "outcome", workflowStatusField: "workflowStatus" },
    TRANSACTIONS: { statusField: "status", serviceField: "serviceType", providerField: "provider" },
  };
  const allowedFilters = exportFilters[dataset] || {};
  for (const queryKey of ["status", "service", "provider", "outcome", "workflowStatus"]) {
    if (req.query[queryKey] && !allowedFilters[`${queryKey}Field`]) {
      return res.status(400).json({ success: false, message: `${queryKey} filtering is not supported for ${dataset} exports.` });
    }
  }
  if (req.query.status) filter[allowedFilters.statusField] = String(req.query.status).toUpperCase();
  if (req.query.service) filter[allowedFilters.serviceField] = String(req.query.service).toUpperCase();
  if (req.query.provider) filter[allowedFilters.providerField] = String(req.query.provider).toUpperCase();
  if (req.query.outcome) filter[allowedFilters.outcomeField] = String(req.query.outcome).toUpperCase();
  if (req.query.workflowStatus) filter[allowedFilters.workflowStatusField] = String(req.query.workflowStatus).toUpperCase();
  const rows = await Model.find(filter, projection).sort({ createdAt: -1 }).limit(5000).lean();
  await AdminExportHistory.create({ requestedBy: actorId(req), dataset, rowCount: rows.length, filters: { start: req.query.start || null, end: req.query.end || null }, columns, status: "COMPLETED", completedAt: new Date(), contentAvailable: true });
  await audit(req, "DATA_EXPORT_CREATED", `Exported ${dataset} records`, { dataset, rowCount: rows.length });
  res.set("Content-Type", "text/csv; charset=utf-8"); res.set("Content-Disposition", `attachment; filename="${dataset.toLowerCase()}-export.csv"`);
  return res.send(csv(rows.map(clean), columns));
} catch (e) { next(e); } };
exports.exportHistory = (req, res, next) => list(AdminExportHistory, req, res, {}, "requestedBy dataset rowCount filters columns createdAt").catch(next);

exports.readiness = (req, res) => res.json({ success: true, data: {
  database: { state: mongoose.connection.readyState, hostConfigured: Boolean(mongoose.connection.host), host: mongoose.connection.host ? "configured" : "not configured" },
  service: { timestamp: new Date(), uptimeSeconds: process.uptime(), nodeVersion: process.version },
  backup: { available: true, status: "PROVIDER_MANAGED", manualBackupSupported: false, dependency: "Managed database provider backup configuration", message: "Backups are not application-triggerable." },
  providers: {
    paystack: { configured: Boolean(process.env.PAYSTACK_SECRET_KEY), status: "NOT_LIVE_CHECKED" },
    clubkonnect: { configured: Boolean(process.env.CLUBKONNECT_USER_ID || process.env.CLUBKONNECT_API_KEY), status: "NOT_LIVE_CHECKED" },
    securewave: { configured: Boolean(process.env.SECUREWAVE_API_KEY), status: "NOT_LIVE_CHECKED" },
  },
} });

exports.listPrivacy = async (req, res, next) => { try {
  const filter = {};
  if (req.query.status) filter.status = String(req.query.status).toUpperCase();
  if (req.query.type) filter.type = String(req.query.type).toUpperCase();
  if (req.query.subjectUser && mongoose.Types.ObjectId.isValid(req.query.subjectUser)) filter.subjectUser = req.query.subjectUser;
  const range = dates(req, res); if (!range) return; Object.assign(filter, range);
  if (req.query.search) {
    const users = await User.find({ fullName: new RegExp(escaped(req.query.search), "i") }, "_id").limit(100).lean();
    filter.subjectUser = { $in: users.map(user => user._id) };
  }
  const pg = page(req, res); if (!pg) return;
  const [items, total] = await Promise.all([PrivacyRequest.find(filter).populate("subjectUser", "fullName role status state kycVerified").sort({ createdAt: -1 }).skip(pg.skip).limit(pg.limit).lean(), PrivacyRequest.countDocuments(filter)]);
  return res.json({ success: true, data: { items: items.map(clean), pagination: { page: pg.page, limit: pg.limit, total, totalPages: Math.max(1, Math.ceil(total / pg.limit)) } } });
} catch (e) { next(e); } };
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
  const allowed = { OPEN: ["IN_REVIEW", "REJECTED"], IN_REVIEW: ["OPEN", "COMPLETED", "REJECTED"], COMPLETED: [], REJECTED: ["OPEN"] };
  if (request.status !== status && !allowed[request.status].includes(status)) return res.status(409).json({ success: false, message: "This privacy status transition is not allowed." });
  request.status = status; request.history.push({ status, note, changedBy: actorId(req) }); await request.save();
  await audit(req, "PRIVACY_REQUEST_UPDATED", "Updated privacy request status", { privacyRequestId: request._id, status });
  return res.json({ success: true, data: clean(request.toObject()) });
} catch (e) { next(e); } };

const amount = (field) => ({ $convert: { input: `$${field}`, to: "double", onError: 0, onNull: 0 } });
const transactionStatusAccumulators = (field = "$status") => {
  const classified = Object.values(TRANSACTION_STATUS_TAXONOMY).flat();
  return {
    successful: { $sum: { $cond: [{ $in: [field, TRANSACTION_STATUS_TAXONOMY.successful] }, 1, 0] } },
    pending: { $sum: { $cond: [{ $in: [field, TRANSACTION_STATUS_TAXONOMY.pending] }, 1, 0] } },
    failed: { $sum: { $cond: [{ $in: [field, TRANSACTION_STATUS_TAXONOMY.failed] }, 1, 0] } },
    refunded: { $sum: { $cond: [{ $in: [field, TRANSACTION_STATUS_TAXONOMY.refunded] }, 1, 0] } },
    other: { $sum: { $cond: [{ $not: [{ $in: [field, classified] }] }, 1, 0] } },
  };
};
// Every model has its own lifecycle vocabulary.  These sets intentionally do
// not inherit a generic "success" list: a state appears in exactly one class.
const OPERATIONAL_TAXONOMIES = Object.freeze({
  MarketplaceOrder: { statusField: "orderStatus", success: ["DELIVERED"], pending: ["PENDING", "PAID", "ACCEPTED", "PENDING_PAYMENT", "PLACED", "CONFIRMED", "PROCESSING", "READY", "SHIPPED", "READY_FOR_DELIVERY", "OUT_FOR_DELIVERY"], failed: ["CANCELLED", "REFUNDED"] },
  Delivery: { statusField: "status", success: ["DELIVERED"], pending: ["PENDING", "ASSIGNED", "ACCEPTED", "PICKED_UP", "IN_TRANSIT"], failed: ["CANCELLED", "FAILED"] },
  SolarApplication: { statusField: "status", success: ["COMPLETED", "RECOVERED"], pending: ["SUBMITTED", "UNDER_REVIEW", "MORE_INFORMATION_REQUIRED", "APPROVED", "AWAITING_DEPOSIT", "DEPOSIT_PAID", "READY_FOR_INSTALLATION", "INSTALLED", "FINANCE_ACTIVE", "ACTIVE", "DEFAULT_REVIEW", "RECOVERY_REQUIRED", "RECOVERY"], failed: ["REJECTED", "OVERDUE", "CANCELLED"] },
  PhoneApplication: { statusField: "status", success: ["COMPLETED"], pending: ["SUBMITTED", "UNDER_REVIEW", "MORE_INFORMATION_REQUIRED", "AWAITING_DEPOSIT", "DEPOSIT_PAID", "DEVICE_ASSIGNED", "ACTIVE"], failed: ["REJECTED", "OVERDUE", "CANCELLED", "REFUNDED"] },
  PhoneFinance: { statusField: "status", success: ["COMPLETED"], pending: ["ACTIVE"], failed: ["OVERDUE"] },
  PhonePayment: { statusField: "type", success: ["DEPOSIT", "INSTALLMENT"], pending: [], failed: ["REFUND"] },
  EmpowermentProgram: { statusField: "status", success: ["COMPLETED"], pending: ["DRAFT", "OPEN", "UNDER_REVIEW", "APPROVED", "DISBURSING", "SUSPENDED"], failed: ["CANCELLED"] },
  EmpowermentFunding: { statusField: "status", success: ["SUCCESSFUL"], pending: [], failed: ["FAILED"] },
  EmpowermentDisbursement: { statusField: "status", success: ["COMPLETED"], pending: ["PREVIEW", "READY", "PROCESSING", "PARTIAL"], failed: ["FAILED", "CANCELLED"] },
  AmanaOrder: { statusField: "status", success: ["FULFILLED", "COMPLETED"], pending: ["SUBMITTED", "MORE_INFORMATION_REQUIRED", "UNDER_REVIEW", "APPROVED", "FUNDING_IN_PROGRESS", "FULLY_FUNDED", "PAID_TO_PROVIDER", "PENDING_PAYMENT", "PAID", "PROCESSING", "ASSIGNED"], failed: ["REJECTED", "CANCELLED", "REFUNDED"] },
  WithdrawalRequest: { statusField: "status", success: ["APPROVED"], pending: ["PENDING"], failed: ["REJECTED"] },
});
const classifyOperationalStatus = (taxonomy, value) => ["success", "pending", "failed"].find((bucket) => taxonomy[bucket].includes(value)) || "other";
exports.OPERATIONAL_TAXONOMIES = OPERATIONAL_TAXONOMIES;
exports.classifyOperationalStatus = classifyOperationalStatus;
const operationalRollup = async (Model, service, range, valueField, { additive = false, valueMeaning }) => {
  const taxonomy = OPERATIONAL_TAXONOMIES[Model.modelName];
  if (!taxonomy) throw new Error(`No operational taxonomy declared for ${Model.modelName}.`);
  const { statusField, success, pending, failed } = taxonomy;
  const [rows, trend] = await Promise.all([Model.aggregate([{ $match: range }, { $group: {
    _id: null, count: { $sum: 1 }, value: { $sum: amount(valueField) }, lastActivity: { $max: "$createdAt" },
    successful: { $sum: { $cond: [{ $in: [`$${statusField}`, success] }, 1, 0] } },
    pending: { $sum: { $cond: [{ $in: [`$${statusField}`, pending] }, 1, 0] } },
    failed: { $sum: { $cond: [{ $in: [`$${statusField}`, failed] }, 1, 0] } },
  } }]), Model.aggregate([{ $match: range }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 }, value: { $sum: amount(valueField) } } }, { $sort: { _id: 1 } }])]);
  const row = rows[0] || { count: 0, value: 0, successful: 0, pending: 0, failed: 0, lastActivity: null };
  row.other = row.count - row.successful - row.pending - row.failed;
  return { service, source: Model.modelName, operationalStatus: statusField, additive, valueMeaning, ...row, trend, successRate: row.count ? row.successful * 100 / row.count : 0 };
};
exports.executiveAnalytics = async (req, res, next) => { try {
  const range = dates(req, res); if (!range) return;
  const [transactionTotals, pendingWithdrawals, pendingKyc, pendingSolar, pendingDeliveries, customers, workforce, branches, wallet, activeRiders, transactionTrend, recentActivity, operations] = await Promise.all([
    Transaction.aggregate([{ $match: range }, { $group: { _id: null, count: { $sum: 1 }, value: { $sum: amount("amount") }, ...transactionStatusAccumulators() } }]),
    WithdrawalRequest.countDocuments({ status: "PENDING" }), KycProfile.countDocuments({ status: { $in: ["PENDING", "UNDER_REVIEW"] } }),
    SolarApplication.countDocuments({ status: { $in: ["SUBMITTED", "UNDER_REVIEW", "MORE_INFORMATION_REQUIRED"] } }), Delivery.countDocuments({ status: { $in: ["PENDING", "ASSIGNED"] } }),
    User.aggregate([{ $group: { _id: null, total: { $sum: 1 }, active: { $sum: { $cond: [{ $eq: ["$status", "ACTIVE"] }, 1, 0] } }, verified: { $sum: { $cond: ["$kycVerified", 1, 0] } }, new: { $sum: { $cond: [{ $and: [{ $gte: ["$createdAt", range.createdAt.$gte] }, { $lte: ["$createdAt", range.createdAt.$lte] }] }, 1, 0] } } } }]),
    User.aggregate([{ $match: { role: { $in: ["AGENT", "AGGREGATOR", "STATE_MANAGER", "ZONAL_MANAGER", "BRANCH_MANAGER"] } } }, { $group: { _id: "$role", count: { $sum: 1 } } }]),
    Branch.countDocuments(), User.aggregate([{ $group: { _id: null, value: { $sum: amount("walletBalance") } } }]),
    User.countDocuments({ role: "RIDER", status: "ACTIVE" }),
    Transaction.aggregate([{ $match: range }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 }, value: { $sum: amount("amount") } } }, { $sort: { _id: 1 } }]),
    AdminAuditLog.find({}, "actorId actorRole actorName action reason requestPath status createdAt").sort({ createdAt: -1 }).limit(15).lean(),
    Promise.all([
      operationalRollup(MarketplaceOrder, "MARKETPLACE", range, "totalAmount", { additive: true, valueMeaning: "Marketplace order totalAmount" }),
      operationalRollup(Delivery, "DELIVERY", range, "deliveryFee", { additive: true, valueMeaning: "Delivery deliveryFee" }),
      operationalRollup(SolarApplication, "SOLAR", range, "depositPaid", { additive: true, valueMeaning: "Solar application depositPaid; excludes financed balance" }),
      operationalRollup(PhonePayment, "FINANCING_PAYMENTS", range, "amount", { additive: true, valueMeaning: "PhonePayment amount; financing application and finance rows are lifecycle counts only" }),
      operationalRollup(EmpowermentDisbursement, "EMPOWERMENT", range, "totalAmount", { additive: true, valueMeaning: "Empowerment disbursement totalAmount" }),
      operationalRollup(AmanaOrder, "AMANA", range, "totalAmount", { additive: true, valueMeaning: "Amana order totalAmount" }),
      operationalRollup(WithdrawalRequest, "WITHDRAWAL", range, "amount", { additive: true, valueMeaning: "Withdrawal amount" }),
    ]),
  ]);
  const tx = transactionTotals[0] || { count: 0, value: 0, successful: 0, pending: 0, failed: 0, refunded: 0, other: 0 }; tx.successRate = tx.count ? tx.successful * 100 / tx.count : 0;
  const customer = customers[0] || { total: 0, active: 0, verified: 0, new: 0 }; customer.inactive = customer.total - customer.active; customer.unverified = customer.total - customer.verified;
  const workforceSummary = {
    agents: 0,
    aggregators: 0,
    stateManagers: 0,
    zonalManagers: 0,
    branchManagers: 0,
  };
  const workforceFields = {
    AGENT: "agents",
    AGGREGATOR: "aggregators",
    STATE_MANAGER: "stateManagers",
    ZONAL_MANAGER: "zonalManagers",
    BRANCH_MANAGER: "branchManagers",
  };
  workforce.forEach((row) => {
    const field = workforceFields[row._id];
    if (field) workforceSummary[field] = row.count;
  });
  return res.json({ success: true, data: { customers: customer, workforce: workforceSummary, branches, activeRiders, walletBalance: wallet[0]?.value || 0, transactions: tx, transactionTrend, operations, recentActivity: recentActivity.map(clean), pendingOperations: { withdrawals: pendingWithdrawals, kyc: pendingKyc, solar: pendingSolar, deliveries: pendingDeliveries } } });
} catch (e) { next(e); } };
exports.serviceAnalytics = async (req, res, next) => { try {
  const range = dates(req, res); if (!range) return;
  const [transactionData, operations] = await Promise.all([
    Transaction.aggregate([{ $match: range }, { $group: { _id: "$serviceType", count: { $sum: 1 }, value: { $sum: amount("amount") }, ...transactionStatusAccumulators(), lastActivity: { $max: "$createdAt" } } }, { $sort: { value: -1 } }]),
    Promise.all([
      operationalRollup(MarketplaceOrder, "MARKETPLACE", range, "totalAmount", { additive: false, valueMeaning: "Lifecycle order totalAmount; do not add across services" }),
      operationalRollup(Delivery, "DELIVERY", range, "deliveryFee", { additive: false, valueMeaning: "Lifecycle deliveryFee; do not add across services" }),
      operationalRollup(SolarApplication, "SOLAR", range, "depositPaid", { additive: false, valueMeaning: "Lifecycle depositPaid; excludes financed balance and is not a unified total" }),
      operationalRollup(PhoneApplication, "PHONE_APPLICATIONS", range, "depositPaid", { additive: false, valueMeaning: "Application lifecycle count; displayed depositPaid is not financing value" }),
      operationalRollup(PhoneFinance, "FINANCING", range, "amountPaid", { additive: false, valueMeaning: "Finance lifecycle count; value is amountPaid and not additive" }),
      operationalRollup(PhonePayment, "PHONE_PAYMENTS", range, "amount", { additive: false, valueMeaning: "Payment lifecycle amount; canonical financing value is this row only" }),
      operationalRollup(EmpowermentProgram, "EMPOWERMENT_PROGRAMS", range, "totalBudget", { additive: false, valueMeaning: "Program lifecycle budget; not disbursed value and not additive" }),
      operationalRollup(EmpowermentFunding, "EMPOWERMENT_FUNDING", range, "amount", { additive: false, valueMeaning: "Funding lifecycle amount; not disbursement value and not additive" }),
      operationalRollup(EmpowermentDisbursement, "EMPOWERMENT", range, "totalAmount", { additive: false, valueMeaning: "Disbursement lifecycle totalAmount; do not add across services" }),
      operationalRollup(AmanaOrder, "AMANA", range, "totalAmount", { additive: false, valueMeaning: "Lifecycle order totalAmount; do not add across services" }),
      operationalRollup(WithdrawalRequest, "WITHDRAWAL", range, "amount", { additive: false, valueMeaning: "Lifecycle withdrawal amount; do not add across services" }),
    ]),
  ]);
  const data = [...transactionData.map(row => ({ service: row._id || "UNKNOWN", source: "Transaction", operationalStatus: "status", ...row, successRate: row.count ? row.successful * 100 / row.count : 0 })), ...operations];
  res.json({ success: true, data: { unifiedTotalAvailable: false, message: "Service lifecycle rows are not additive across services.", rows: data } });
} catch (e) { next(e); } };
exports.transactionAnalytics = async (req, res, next) => { try {
  const range = dates(req, res); if (!range) return; const filter = { ...range };
  ["serviceType", "status", "provider"].forEach(field => { if (req.query[field]) filter[field] = String(req.query[field]).toUpperCase(); });
  ["branchId", "customerId"].forEach(field => { if (req.query[field] && mongoose.Types.ObjectId.isValid(req.query[field])) filter[field] = req.query[field]; });
  if (req.query.search) filter.$or = ["reference", "provider", "serviceType"].map(field => ({ [field]: new RegExp(escaped(req.query.search), "i") }));
  const pg = page(req, res); if (!pg) return;
  const group = (field) => Transaction.aggregate([{ $match: filter }, { $group: { _id: `$${field}`, count: { $sum: 1 }, value: { $sum: amount("amount") } } }, { $sort: { count: -1 } }]);
  const [summary, statuses, services, providers, daily, items, total] = await Promise.all([
    Transaction.aggregate([{ $match: filter }, { $group: { _id: null, count: { $sum: 1 }, value: { $sum: amount("amount") }, ...transactionStatusAccumulators() } }]),
    group("status"), group("serviceType"), group("provider"),
    Transaction.aggregate([{ $match: filter }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 }, value: { $sum: amount("amount") } } }, { $sort: { _id: 1 } }]),
    Transaction.find(filter, "reference customerId branchId serviceType provider amount status createdAt").sort({ createdAt: -1 }).skip(pg.skip).limit(pg.limit).lean(), Transaction.countDocuments(filter),
  ]);
  const s = summary[0] || { count: 0, value: 0, successful: 0, pending: 0, failed: 0, refunded: 0, other: 0 };
  s.success = s.successful; // Backward-compatible alias; successful is canonical.
  s.successRate = s.count ? s.successful * 100 / s.count : 0;
  res.json({ success: true, data: { summary: s, statuses, services, providers, daily, items: items.map(clean), pagination: { page: pg.page, limit: pg.limit, total, totalPages: Math.max(1, Math.ceil(total / pg.limit)) } } });
} catch (e) { next(e); } };
exports.customerAnalytics = async (req, res, next) => { try {
  const range = dates(req, res); if (!range) return;
  const customerFilter = {};
  ["status", "state", "role"].forEach(field => { if (req.query[field]) customerFilter[field] = String(req.query[field]).toUpperCase(); });
  if (req.query.kycStatus !== undefined) customerFilter.kycVerified = ["true", "verified", "yes"].includes(String(req.query.kycStatus).toLowerCase());
  if (req.query.search) customerFilter.fullName = new RegExp(escaped(req.query.search), "i");
  const pg = page(req, res); if (!pg) return;
  const [growth, states, tiers, active, top, recent, wallet, allTime, statuses, customers, total] = await Promise.all([
    User.aggregate([{ $match: range }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, registrations: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    User.aggregate([{ $match: customerFilter }, { $group: { _id: "$state", count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    KycProfile.aggregate([{ $match: range }, { $group: { _id: { level: "$level", status: "$status" }, count: { $sum: 1 } } }]),
    Transaction.aggregate([{ $match: range }, { $group: { _id: "$customerId" } }, { $count: "count" }]),
    Transaction.aggregate([{ $match: range }, { $group: { _id: "$customerId", transactions: { $sum: 1 }, value: { $sum: amount("amount") } } }, { $sort: { value: -1 } }, { $limit: 10 }]),
    User.find({ ...customerFilter, ...range }, "fullName role status state kycVerified createdAt").sort({ createdAt: -1 }).limit(10).lean(),
    User.aggregate([{ $match: customerFilter }, { $group: { _id: null, total: { $sum: amount("walletBalance") } } }]),
    User.aggregate([{ $match: customerFilter }, { $group: { _id: null, total: { $sum: 1 }, active: { $sum: { $cond: [{ $eq: ["$status", "ACTIVE"] }, 1, 0] } }, inactive: { $sum: { $cond: [{ $ne: ["$status", "ACTIVE"] }, 1, 0] } }, verified: { $sum: { $cond: ["$kycVerified", 1, 0] } } } }]),
    User.aggregate([{ $match: customerFilter }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    User.find(customerFilter, "fullName role status state kycVerified createdAt").sort({ createdAt: -1 }).skip(pg.skip).limit(pg.limit).lean(),
    User.countDocuments(customerFilter),
  ]);
  const summary = allTime[0] || { total: 0, active: 0, inactive: 0, verified: 0 }; summary.unverified = summary.total - summary.verified; summary.walletBalance = wallet[0]?.total || 0;
  res.json({ success: true, data: { summary, growth, periodRegistrations: growth.reduce((n, item) => n + item.registrations, 0), states, statuses, kycTiers: tiers, transactionActiveCustomers: active[0]?.count || 0, topActivity: top, recentRegistrations: recent.map(clean), items: customers.map(clean), pagination: { page: pg.page, limit: pg.limit, total, totalPages: Math.max(1, Math.ceil(total / pg.limit)) } } });
} catch (e) { next(e); } };