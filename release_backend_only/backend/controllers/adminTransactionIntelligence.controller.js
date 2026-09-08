const mongoose = require("mongoose");

const Transaction = require("../models/transaction.model");
const BankTransfer = require("../models/bankTransfer.model");
const User = require("../models/user.model");
const AdminAuditLog = require("../models/adminAuditLog.model");
const TransactionIntelligenceCommand = require("../models/transactionIntelligenceCommand.model");
const bankTransferController = require("./bankTransfer.controller");

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const QUEUE_THRESHOLD_MS = Math.max(
  5 * 60 * 1000,
  Number(process.env.TRANSACTION_RECONCILIATION_THRESHOLD_MINUTES || 30) * 60 * 1000
);
const SENSITIVE_KEYS = /password|passcode|pin|otp|token|secret|authorization|bearer|credential|api.?key|signature|hash|nin|bvn|accountnumber|cardnumber|cvv/i;
const PROVIDER_STATUS_KEYS = [
  "providerStatus", "provider_status", "transactionStatus", "transaction_status",
  "orderStatus", "order_status",
];
const PROVIDER_REFERENCE_KEYS = [
  "providerReference", "provider_reference", "providerTransactionId",
  "provider_transaction_id", "orderId", "order_id", "requestId", "request_id",
  "transactionId", "transaction_id",
];

const text = (value) => String(value ?? "").trim();
const upper = (value) => text(value).toUpperCase().replace(/[\s-]+/g, "_");
const escapeRegex = (value) => text(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const finiteNumber = (value) => {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
};
const pageOptions = (query) => {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(query.limit, 10) || DEFAULT_LIMIT));
  return { page, limit, skip: (page - 1) * limit };
};
const encodeCursor = (transaction) => Buffer.from(JSON.stringify({
  createdAt: transaction.createdAt,
  id: String(transaction._id),
})).toString("base64url");
const decodeCursor = (value) => {
  if (!text(value)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(text(value), "base64url").toString("utf8"));
    const createdAt = new Date(parsed.createdAt);
    if (Number.isNaN(createdAt.getTime()) || !mongoose.Types.ObjectId.isValid(parsed.id)) return null;
    return { createdAt, id: new mongoose.Types.ObjectId(parsed.id) };
  } catch (_) {
    return null;
  }
};
const withCursor = (query, cursor) => {
  if (!cursor) return query;
  return {
    $and: [
      query,
      {
        $or: [
          { createdAt: { $lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
        ],
      },
    ],
  };
};
const lagosDate = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
};
const lagosRange = (dateText) => {
  const value = /^\d{4}-\d{2}-\d{2}$/.test(text(dateText)) ? text(dateText) : lagosDate();
  const start = new Date(`${value}T00:00:00+01:00`);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
};
const parseDate = (value, endOfDay = false) => {
  if (!text(value)) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text(value))) {
    const range = lagosRange(text(value));
    return endOfDay ? range.end : range.start;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};
const maskPhone = (value) => {
  const raw = text(value);
  if (raw.length <= 4) return raw ? "****" : "";
  return `${raw.slice(0, 3)}${"*".repeat(Math.max(3, raw.length - 6))}${raw.slice(-3)}`;
};
const maskEmail = (value) => {
  const raw = text(value);
  const at = raw.indexOf("@");
  if (at < 1) return raw ? "***" : "";
  const local = raw.slice(0, at);
  return `${local.slice(0, 1)}${"*".repeat(Math.max(2, local.length - 1))}${raw.slice(at)}`;
};
const sanitizePayload = (value, depth = 0) => {
  if (depth > 5) return "[TRUNCATED]";
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => sanitizePayload(item, depth + 1));
  if (typeof value !== "object") return text(value);
  const safe = {};
  for (const [key, item] of Object.entries(value).slice(0, 80)) {
    safe[key] = SENSITIVE_KEYS.test(key) ? "[REDACTED]" : sanitizePayload(item, depth + 1);
  }
  return safe;
};
const findPayloadValue = (payload, keys) => {
  if (!payload || typeof payload !== "object") return "";
  for (const key of keys) {
    if (payload[key] != null && typeof payload[key] !== "object") return text(payload[key]);
  }
  for (const value of Object.values(payload).slice(0, 30)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const found = findPayloadValue(value, keys);
      if (found) return found;
    }
  }
  return "";
};
const normalizeProviderStatus = (value) => {
  const status = upper(value);
  if (!status) return "UNKNOWN";
  if (new Set(["SUCCESS", "SUCCESSFUL", "COMPLETED", "COMPLETE", "DELIVERED", "ORDER_COMPLETED"]).has(status)) return "SUCCESSFUL";
  if (new Set(["PROCESSING", "IN_PROGRESS", "INITIATED", "ACCEPTED"]).has(status)) return "PROCESSING";
  if (new Set(["PENDING", "AWAITING", "AWAITING_CONFIRMATION", "QUEUED"]).has(status)) return "PENDING";
  if (new Set(["REVERSE", "REVERSED"]).has(status)) return "REVERSED";
  if (new Set(["REFUND", "REFUNDED"]).has(status)) return "REFUNDED";
  if (new Set(["FAIL", "FAILED", "DECLINED", "CANCELLED", "CANCELED", "ERROR", "REJECTED", "ORDER_CANCELLED"]).has(status)) return "FAILED";
  return "UNKNOWN";
};
const normalizeInternalStatus = (value) => {
  const status = upper(value);
  if (["SUCCESSFUL", "PENDING", "FAILED", "REFUNDED", "PROCESSING", "REVERSED"].includes(status)) return status;
  return "UNKNOWN";
};
const intelligenceFor = (transaction, bankTransfer = null) => {
  const providerPayload = bankTransfer?.providerResponse || transaction.providerResponse || null;
  const rawProviderStatus = findPayloadValue(providerPayload, PROVIDER_STATUS_KEYS);
  const providerStatus = normalizeProviderStatus(rawProviderStatus);
  const internalStatus = normalizeInternalStatus(bankTransfer?.status || transaction.status);
  const providerReference = text(
    bankTransfer?.providerReference ||
    bankTransfer?.providerTransactionId ||
    findPayloadValue(providerPayload, PROVIDER_REFERENCE_KEYS)
  );
  const ageMs = Date.now() - new Date(transaction.createdAt).getTime();
  const signals = [];
  if (["PENDING", "PROCESSING"].includes(internalStatus) && ageMs >= QUEUE_THRESHOLD_MS) {
    signals.push({ code: "STUCK_TRANSACTION", label: "Transaction is pending beyond the safe threshold." });
  }
  if (providerStatus === "SUCCESSFUL" && internalStatus !== "SUCCESSFUL") {
    signals.push({ code: "PROVIDER_SUCCESS_INTERNAL_INCOMPLETE", label: "Provider indicates success while ServicePay is not successful." });
  }
  if (internalStatus === "SUCCESSFUL" && providerStatus === "FAILED") {
    signals.push({ code: "STATUS_MISMATCH", label: "ServicePay success conflicts with the observed provider status." });
  }
  if (internalStatus === "SUCCESSFUL" && !providerReference && text(transaction.provider)) {
    signals.push({ code: "PROVIDER_CONFIRMATION_REQUIRED", label: "Provider-backed success has no confirmed provider reference." });
  }
  if (internalStatus === "REFUNDED" && bankTransfer && bankTransfer.refundProcessed !== true) {
    signals.push({ code: "REFUND_EVIDENCE_INCOMPLETE", label: "Refund status exists without completed refund evidence." });
  }
  const reconciliationStatus = signals.length
    ? "RECONCILIATION_REQUIRED"
    : ["PENDING", "PROCESSING"].includes(internalStatus)
      ? "PROVIDER_CONFIRMATION_REQUIRED"
      : providerStatus === "UNKNOWN" && text(transaction.provider)
        ? "NEEDS_REVIEW"
        : "CLEAR";
  return {
    internalStatus,
    providerStatus,
    rawProviderStatus: rawProviderStatus || null,
    providerReference: providerReference || null,
    reconciliationStatus,
    signals,
    requiresReview: reconciliationStatus !== "CLEAR",
  };
};
const publicCustomer = (customer) => customer ? {
  id: String(customer._id),
  name: customer.fullName || customer.name || "",
  phone: maskPhone(customer.phone),
  email: maskEmail(customer.email),
} : null;
const capabilities = (req) => {
  const granted = new Set(req.staffAccess?.permissions || []);
  const full = req.staffAccess?.isHeadOffice || granted.has("*");
  const has = (permission) => Boolean(full || granted.has(permission));
  return {
    canView: has("transaction_intelligence.view"),
    canRequery: has("transaction_intelligence.requery"),
    canReconcile: has("transaction_intelligence.reconcile"),
    canExport: has("transaction_intelligence.export"),
    canViewProviderHealth: has("transaction_intelligence.provider_health"),
  };
};
const scopedCustomerIds = async (req) => {
  const explicitScope = req.staffAccess?.scope || {};
  const roleName = upper(req.staffAccess?.roleName);
  const scopeType = upper(
    explicitScope.type ||
    (roleName === "ZONAL_MANAGER"
      ? "ZONE"
      : roleName === "STATE_MANAGER"
        ? "STATE"
        : "GLOBAL")
  );
  const zone = explicitScope.zone || req.user?.zone || null;
  const state = explicitScope.state || req.user?.state || null;
  const filter = scopeType === "ZONE"
    ? zone ? { zone } : { _id: null }
    : scopeType === "STATE"
      ? state ? { state, ...(zone ? { zone } : {}) } : { _id: null }
      : scopeType === "SELF"
        ? explicitScope.userId ? { _id: explicitScope.userId } : { _id: null }
        : scopeType === "BUSINESS_PARTNER"
          ? explicitScope.businessPartnerId
            ? { businessPartnerProfile: explicitScope.businessPartnerId }
            : { _id: null }
          : {};
  if (!Object.keys(filter).length) return null;
  const users = await User.find(filter).select("_id").sort({ _id: 1 }).limit(5001).lean();
  if (users.length > 5000) {
    const error = new Error("Your authorized scope is too broad for safe transaction reporting.");
    error.publicMessage = "Your authorized scope is too broad for safe transaction reporting. Ask Head Office to use a narrower role scope.";
    throw error;
  }
  return users.map((user) => user._id);
};
const customerMatches = async (search, scopedIds) => {
  const value = text(search);
  if (!value) return null;
  const regex = new RegExp(escapeRegex(value), "i");
  const query = { $or: [{ fullName: regex }, { name: regex }, { phone: regex }, { email: regex }] };
  if (mongoose.Types.ObjectId.isValid(value)) query.$or.push({ _id: value });
  if (scopedIds) query._id = { $in: scopedIds };
  const users = await User.find(query).select("_id").limit(500).lean();
  return users.map((user) => user._id);
};
const buildQuery = async (req) => {
  const query = {};
  const scopedIds = await scopedCustomerIds(req);
  if (scopedIds) query.customerId = { $in: scopedIds };

  const search = text(req.query.search || req.query.query);
  if (search) {
    const regex = new RegExp(escapeRegex(search), "i");
    const matchedCustomers = await customerMatches(search, scopedIds);
    const clauses = [
      { reference: regex },
      { provider: regex },
      { "providerResponse.providerReference": regex },
      { "providerResponse.provider_reference": regex },
      { "providerResponse.orderId": regex },
      { "providerResponse.requestId": regex },
    ];
    const amount = finiteNumber(search.replace(/,/g, ""));
    if (amount != null) clauses.push({ amount });
    if (matchedCustomers?.length) clauses.push({ customerId: { $in: matchedCustomers } });
    query.$or = clauses;
  }
  const services = text(req.query.serviceType).split(",").map(upper).filter(Boolean);
  if (services.length && !services.includes("ALL")) query.serviceType = { $in: services };
  const statuses = text(req.query.internalStatus || req.query.status).split(",").map(upper).filter(Boolean);
  if (statuses.length && !statuses.includes("ALL")) query.status = { $in: statuses };
  const minAmount = finiteNumber(req.query.minAmount);
  const maxAmount = finiteNumber(req.query.maxAmount);
  if (minAmount != null || maxAmount != null) {
    query.amount = {};
    if (minAmount != null) query.amount.$gte = minAmount;
    if (maxAmount != null) query.amount.$lte = maxAmount;
  }
  const from = parseDate(req.query.from);
  const to = parseDate(req.query.to, true);
  if (from || to) {
    query.createdAt = {};
    if (from) query.createdAt.$gte = from;
    if (to) query.createdAt.$lt = to;
  }
  return query;
};
const serializeTransaction = (transaction, bankTransfer = null) => {
  const intel = intelligenceFor(transaction, bankTransfer);
  return {
    id: String(transaction._id),
    reference: transaction.reference,
    providerReference: intel.providerReference,
    customer: publicCustomer(transaction.customerId),
    serviceType: transaction.serviceType,
    provider: transaction.provider || bankTransfer?.provider || null,
    amount: Number(transaction.amount || 0),
    fees: Number(bankTransfer?.transferFee || 0),
    createdAt: transaction.createdAt,
    updatedAt: transaction.updatedAt,
    internalStatus: intel.internalStatus,
    providerStatus: intel.providerStatus,
    rawProviderStatus: intel.rawProviderStatus,
    reconciliationStatus: intel.reconciliationStatus,
    requiresReview: intel.requiresReview,
    signals: intel.signals,
    lastRequeryAt: bankTransfer?.lastRequeryAt || null,
    safeAction: bankTransfer &&
      ["PENDING", "PROCESSING", "FAILED"].includes(intel.internalStatus)
      ? "REQUERY"
      : "REVIEW_ONLY",
  };
};
const enrichTransactions = async (transactions) => {
  const transactionIds = transactions.map((item) => item._id).filter(Boolean);
  const transfers = transactionIds.length
    ? await BankTransfer.find({ transactionId: { $in: transactionIds } }).lean()
    : [];
  const byTransaction = new Map(transfers.map((item) => [String(item.transactionId), item]));
  return transactions.map((item) => serializeTransaction(item, byTransaction.get(String(item._id))));
};
const audit = async (req, operation, transaction, metadata = {}) => {
  await AdminAuditLog.create({
    actorId: req.user._id,
    actorRole: upper(req.user.role || "STAFF"),
    actorName: req.user.fullName || req.user.name || "",
    targetUserId: transaction?.customerId?._id || transaction?.customerId || null,
    targetUserName: transaction?.customerId?.fullName || transaction?.customerId?.name || "",
    action: "FINTECH_OPERATION",
    reason: operation.replace(/_/g, " ").toLowerCase(),
    previousData: null,
    newData: null,
    metadata: {
      operation,
      transactionId: transaction?._id || null,
      transactionReference: transaction?.reference || null,
      ...sanitizePayload(metadata),
    },
    ipAddress: text(req.headers["x-forwarded-for"]).split(",")[0] || req.ip || "",
    userAgent: text(req.headers["user-agent"]),
    requestMethod: req.method,
    requestPath: req.originalUrl,
  });
};
const findScopedTransaction = async (req) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.transactionId)) return null;
  const scopedIds = await scopedCustomerIds(req);
  const query = { _id: req.params.transactionId };
  if (scopedIds) query.customerId = { $in: scopedIds };
  return Transaction.findOne(query)
    .populate("customerId", "fullName name phone email zone state businessPartnerProfile")
    .lean();
};
const controllerError = (res, error, fallback) =>
  res.status(error?.publicMessage ? 422 : 500).json({
    success: false,
    code: error?.publicMessage ? "SCOPE_TOO_BROAD" : undefined,
    message: error?.publicMessage || fallback,
  });

exports.searchTransactions = async (req, res) => {
  try {
    const rawSearch = text(req.query.search || req.query.query);
    if (rawSearch && (rawSearch.length < 2 || rawSearch.length > 100)) {
      return res.status(400).json({
        success: false,
        message: "Search must be between 2 and 100 characters.",
      });
    }
    const { page, limit, skip } = pageOptions(req.query);
    const query = await buildQuery(req);
    const providerStatus = upper(req.query.providerStatus);
    const reconciliationStatus = upper(req.query.reconciliationStatus);
    const needsDerivedFilter =
      Boolean(providerStatus && providerStatus !== "ALL") ||
      Boolean(reconciliationStatus && reconciliationStatus !== "ALL");
    let items;
    let total;
    let bounded = false;
    if (needsDerivedFilter) {
      const candidateLimit = Math.min(5000, Math.max(skip + limit * 10, 500));
      const candidates = await Transaction.find(query)
        .populate("customerId", "fullName name phone email")
        .sort({ createdAt: -1, _id: -1 })
        .limit(candidateLimit)
        .lean();
      let filtered = await enrichTransactions(candidates);
      if (providerStatus && providerStatus !== "ALL") {
        filtered = filtered.filter((item) => item.providerStatus === providerStatus);
      }
      if (reconciliationStatus && reconciliationStatus !== "ALL") {
        filtered = filtered.filter((item) => item.reconciliationStatus === reconciliationStatus);
      }
      total = filtered.length;
      items = filtered.slice(skip, skip + limit);
      bounded = candidates.length === candidateLimit;
    } else {
      const [transactions, count] = await Promise.all([
        Transaction.find(query)
          .populate("customerId", "fullName name phone email")
          .sort({ createdAt: -1, _id: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Transaction.countDocuments(query),
      ]);
      items = await enrichTransactions(transactions);
      total = count;
    }
    return res.json({
      success: true,
      transactions: items,
      pagination: {
        page,
        limit,
        total: bounded ? null : total,
        pages: bounded ? null : Math.ceil(total / limit),
        bounded,
      },
      capabilities: capabilities(req),
    });
  } catch (error) {
    console.error("TRANSACTION INTELLIGENCE SEARCH ERROR:", error);
    return controllerError(res, error, "Unable to search transactions.");
  }
};

exports.getSummary = async (req, res) => {
  try {
    const { start, end } = lagosRange(req.query.date);
    const scopedIds = await scopedCustomerIds(req);
    const match = { createdAt: { $gte: start, $lt: end } };
    if (scopedIds) match.customerId = { $in: scopedIds };
    const previousStart = new Date(start.getTime() - 24 * 60 * 60 * 1000);
    const previousMatch = { ...match, createdAt: { $gte: previousStart, $lt: start } };
    const aggregate = (filter) => Transaction.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          value: { $sum: "$amount" },
          successfulCount: { $sum: { $cond: [{ $eq: ["$status", "SUCCESSFUL"] }, 1, 0] } },
          successfulValue: { $sum: { $cond: [{ $eq: ["$status", "SUCCESSFUL"] }, "$amount", 0] } },
          pendingCount: { $sum: { $cond: [{ $in: ["$status", ["PENDING", "PROCESSING"]] }, 1, 0] } },
          pendingValue: { $sum: { $cond: [{ $in: ["$status", ["PENDING", "PROCESSING"]] }, "$amount", 0] } },
          failedCount: { $sum: { $cond: [{ $eq: ["$status", "FAILED"] }, 1, 0] } },
          failedValue: { $sum: { $cond: [{ $eq: ["$status", "FAILED"] }, "$amount", 0] } },
          reversedCount: { $sum: { $cond: [{ $eq: ["$status", "REVERSED"] }, 1, 0] } },
        },
      },
    ]);
    const queueMatch = {
      ...match,
      status: { $in: ["PENDING", "PROCESSING", "FAILED"] },
      createdAt: { $gte: start, $lt: new Date(Date.now() - QUEUE_THRESHOLD_MS) },
    };
    const [currentRows, previousRows, reconciliationQueueCount] = await Promise.all([
      aggregate(match),
      aggregate(previousMatch),
      Transaction.countDocuments(queueMatch),
    ]);
    const empty = {
      count: 0, value: 0, successfulCount: 0, successfulValue: 0,
      pendingCount: 0, pendingValue: 0, failedCount: 0, failedValue: 0, reversedCount: 0,
    };
    const current = { ...empty, ...(currentRows[0] || {}) };
    delete current._id;
    const previous = { ...empty, ...(previousRows[0] || {}) };
    delete previous._id;
    return res.json({
      success: true,
      day: lagosDate(start),
      timezone: "Africa/Lagos",
      metrics: { ...current, reconciliationQueueCount },
      previousDay: previous,
      capabilities: capabilities(req),
    });
  } catch (error) {
    console.error("TRANSACTION INTELLIGENCE SUMMARY ERROR:", error);
    return controllerError(res, error, "Unable to load transaction metrics.");
  }
};

exports.getReconciliationQueue = async (req, res) => {
  try {
    const query = await buildQuery(req);
    const { limit } = pageOptions(req.query);
    const requestedCursor = decodeCursor(req.query.cursor);
    if (text(req.query.cursor) && !requestedCursor) {
      return res.status(400).json({ success: false, message: "Invalid reconciliation cursor." });
    }
    let cursor = requestedCursor;
    let exhausted = false;
    let scanned = 0;
    let lastScanned = null;
    const matches = [];
    while (matches.length <= limit && !exhausted && scanned < 5000) {
      const candidates = await Transaction.find(withCursor(query, cursor))
        .populate("customerId", "fullName name phone email")
        .sort({ createdAt: -1, _id: -1 })
        .limit(250)
        .lean();
      if (!candidates.length) {
        exhausted = true;
        break;
      }
      scanned += candidates.length;
      lastScanned = candidates[candidates.length - 1];
      const enriched = await enrichTransactions(candidates);
      matches.push(...enriched.filter((item) => item.requiresReview));
      cursor = decodeCursor(encodeCursor(lastScanned));
      exhausted = candidates.length < 250;
    }
    const items = matches.slice(0, limit);
    const hasMore = matches.length > limit || !exhausted;
    return res.json({
      success: true,
      transactions: items,
      pagination: {
        limit,
        hasMore,
        nextCursor: hasMore
          ? items.length
            ? encodeCursor({ createdAt: items[items.length - 1].createdAt, _id: items[items.length - 1].id })
            : lastScanned
              ? encodeCursor(lastScanned)
              : null
          : null,
        scanned,
        bounded: scanned >= 5000 && !exhausted,
      },
      thresholdMinutes: Math.round(QUEUE_THRESHOLD_MS / 60000),
      capabilities: capabilities(req),
    });
  } catch (error) {
    console.error("TRANSACTION INTELLIGENCE QUEUE ERROR:", error);
    return controllerError(res, error, "Unable to load the reconciliation queue.");
  }
};

exports.getTransactionDetail = async (req, res) => {
  try {
    const transaction = await findScopedTransaction(req);
    if (!transaction) return res.status(404).json({ success: false, message: "Transaction not found in your authorized scope." });
    const bankTransfer = await BankTransfer.findOne({ transactionId: transaction._id }).lean();
    const item = serializeTransaction(transaction, bankTransfer);
    const audits = await AdminAuditLog.find({
      "metadata.transactionReference": transaction.reference,
    }).sort({ createdAt: -1 }).limit(50).lean();
    return res.json({
      success: true,
      transaction: {
        ...item,
        description: transaction.description || null,
        channel: findPayloadValue(transaction.providerResponse, ["channel", "source"]) || null,
        fulfillmentStatus: findPayloadValue(transaction.providerResponse, ["fulfillmentStatus", "deliveryStatus", "fulfilmentStatus"]) || null,
        providerResponse: sanitizePayload(bankTransfer?.providerResponse || transaction.providerResponse),
        requery: {
          lastRequeryAt: bankTransfer?.lastRequeryAt || null,
          inProgress: bankTransfer?.requeryInProgress === true,
          result: bankTransfer?.failureReason || item.rawProviderStatus || null,
        },
        auditHistory: audits.map((entry) => ({
          action: entry.metadata?.operation || entry.action,
          actor: entry.actorName || entry.actorRole,
          reason: entry.reason || null,
          status: entry.status,
          createdAt: entry.createdAt,
        })),
      },
      capabilities: capabilities(req),
    });
  } catch (error) {
    console.error("TRANSACTION INTELLIGENCE DETAIL ERROR:", error);
    return controllerError(res, error, "Unable to load transaction details.");
  }
};

exports.getTransactionTimeline = async (req, res) => {
  try {
    const transaction = await findScopedTransaction(req);
    if (!transaction) return res.status(404).json({ success: false, message: "Transaction not found in your authorized scope." });
    const bankTransfer = await BankTransfer.findOne({ transactionId: transaction._id }).lean();
    const audits = await AdminAuditLog.find({ "metadata.transactionReference": transaction.reference })
      .sort({ createdAt: 1 }).limit(100).lean();
    const events = [
      { type: "CREATED", label: "Transaction created", at: transaction.createdAt },
    ];
    if (transaction.providerResponse) events.push({
      type: "PROVIDER_RESPONSE",
      label: "Provider response recorded",
      at: transaction.updatedAt || transaction.createdAt,
      metadata: sanitizePayload(transaction.providerResponse),
    });
    if (transaction.updatedAt && String(transaction.updatedAt) !== String(transaction.createdAt)) {
      events.push({ type: "STATUS_UPDATE", label: `Internal status: ${transaction.status}`, at: transaction.updatedAt });
    }
    if (bankTransfer?.lastRequeryAt) {
      events.push({ type: "REQUERY", label: "Provider status requery recorded", at: bankTransfer.lastRequeryAt });
    }
    if (bankTransfer?.completedAt) events.push({ type: "FULFILLMENT", label: "Transfer completed", at: bankTransfer.completedAt });
    if (bankTransfer?.refundedAt) events.push({ type: "REFUND", label: "Refund recorded", at: bankTransfer.refundedAt });
    for (const entry of audits) {
      events.push({
        type: "ADMIN_REVIEW",
        label: text(entry.metadata?.operation || entry.action).replace(/_/g, " "),
        at: entry.createdAt,
        metadata: { actor: entry.actorName || entry.actorRole, reason: entry.reason || null },
      });
    }
    events.sort((a, b) => new Date(a.at) - new Date(b.at));
    return res.json({ success: true, events });
  } catch (error) {
    console.error("TRANSACTION INTELLIGENCE TIMELINE ERROR:", error);
    return controllerError(res, error, "Unable to load the transaction timeline.");
  }
};

exports.getProviderHealth = async (req, res) => {
  try {
    const days = Math.min(30, Math.max(1, Number.parseInt(req.query.days, 10) || 7));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const scopedIds = await scopedCustomerIds(req);
    const match = { createdAt: { $gte: since }, provider: { $nin: [null, ""] } };
    if (scopedIds) match.customerId = { $in: scopedIds };
    const rows = await Transaction.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$provider",
          total: { $sum: 1 },
          successful: { $sum: { $cond: [{ $eq: ["$status", "SUCCESSFUL"] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $eq: ["$status", "PENDING"] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ["$status", "FAILED"] }, 1, 0] } },
          lastSuccessfulTransaction: { $max: { $cond: [{ $eq: ["$status", "SUCCESSFUL"] }, "$createdAt", null] } },
        },
      },
      { $sort: { total: -1 } },
      { $limit: 50 },
    ]);
    const providers = rows.map((row) => ({
      provider: row._id,
      sampleSize: row.total,
      successRate: row.total ? Number(((row.successful / row.total) * 100).toFixed(2)) : null,
      pendingRate: row.total ? Number(((row.pending / row.total) * 100).toFixed(2)) : null,
      failureRate: row.total ? Number(((row.failed / row.total) * 100).toFixed(2)) : null,
      averageResponseTimeMs: null,
      lastSuccessfulTransaction: row.lastSuccessfulTransaction,
      recentErrorCount: row.failed,
      assessment: row.total >= 10 ? "OBSERVED_DATA" : "INSUFFICIENT_DATA",
    }));
    return res.json({ success: true, days, providers });
  } catch (error) {
    console.error("TRANSACTION INTELLIGENCE PROVIDER HEALTH ERROR:", error);
    return controllerError(res, error, "Unable to load provider health.");
  }
};

exports.getAlerts = async (req, res) => {
  try {
    const scopedIds = await scopedCustomerIds(req);
    const query = {
      status: { $in: ["PENDING", "PROCESSING", "FAILED", "REFUNDED"] },
      createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    };
    if (scopedIds) query.customerId = { $in: scopedIds };
    const candidates = await Transaction.find(query)
      .populate("customerId", "fullName name phone email")
      .sort({ createdAt: -1 }).limit(250).lean();
    const items = (await enrichTransactions(candidates))
      .filter((item) => item.requiresReview)
      .slice(0, 50);
    const alerts = items.map((item) => ({
      transactionId: item.id,
      reference: item.reference,
      severity: item.reconciliationStatus === "RECONCILIATION_REQUIRED" ? "HIGH" : "MEDIUM",
      title: item.signals[0]?.label || "Provider confirmation required",
      reconciliationStatus: item.reconciliationStatus,
      createdAt: item.createdAt,
    }));
    return res.json({ success: true, alerts });
  } catch (error) {
    console.error("TRANSACTION INTELLIGENCE ALERTS ERROR:", error);
    return controllerError(res, error, "Unable to load transaction alerts.");
  }
};

exports.requeryTransaction = async (req, res) => {
  try {
    const transaction = await findScopedTransaction(req);
    if (!transaction) return res.status(404).json({ success: false, message: "Transaction not found in your authorized scope." });
    const requestKey = text(req.headers["x-idempotency-key"] || req.body?.idempotencyKey);
    if (requestKey.length < 8 || requestKey.length > 160) {
      return res.status(400).json({
        success: false,
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: "A valid idempotency key is required for transaction requery.",
      });
    }
    let command;
    try {
      command = await TransactionIntelligenceCommand.create({
        transaction: transaction._id,
        actor: req.user._id,
        operation: "REQUERY",
        idempotencyKey: requestKey,
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      const prior = await TransactionIntelligenceCommand.findOne({
        transaction: transaction._id,
        operation: "REQUERY",
        idempotencyKey: requestKey,
      }).lean();
      if (prior?.state === "COMPLETED" || prior?.state === "FAILED") {
        return res.status(prior.httpStatus || 200).json(prior.safeResponse || {
          success: prior.state === "COMPLETED",
          code: "REQUERY_REPLAYED",
          message: "The recorded result for this requery is no longer available.",
        });
      }
      return res.status(202).json({
        success: false,
        code: "REQUERY_ALREADY_PROCESSING",
        message: "This requery is already processing. No duplicate provider request was made.",
      });
    }
    const bankTransfer = await BankTransfer.findOne({
      transactionId: transaction._id,
      sender: transaction.customerId._id || transaction.customerId,
    }).lean();
    if (!bankTransfer) {
      const safeResponse = {
        success: false,
        manualReviewRequired: true,
        code: "PROVIDER_REQUERY_UNSUPPORTED",
        message: "Provider requery is not supported for this transaction type. Review is required; no debit, credit, purchase, or provider request was made.",
        transaction: serializeTransaction(transaction),
      };
      await TransactionIntelligenceCommand.updateOne(
        { _id: command._id },
        { $set: { state: "COMPLETED", httpStatus: 202, safeResponse, completedAt: new Date() } }
      );
      await audit(req, "TRANSACTION_REQUERY_UNSUPPORTED", transaction, { idempotencyKey: requestKey });
      return res.status(202).json(safeResponse);
    }
    if (
      bankTransfer.lastRequeryAt &&
      Date.now() - new Date(bankTransfer.lastRequeryAt).getTime() < 15 * 1000 &&
      !["SUCCESSFUL", "REFUNDED"].includes(bankTransfer.status)
    ) {
      const safeResponse = {
        success: false,
        code: "REQUERY_RATE_LIMITED",
        message: "This transaction was queried recently. Wait before trying again.",
      };
      await TransactionIntelligenceCommand.updateOne(
        { _id: command._id },
        { $set: { state: "FAILED", httpStatus: 429, safeResponse, completedAt: new Date() } }
      );
      return res.status(429).json({
        ...safeResponse,
      });
    }
    await audit(req, "TRANSACTION_REQUERY_REQUESTED", transaction, {
      idempotencyKey: requestKey,
    });
    const captured = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        return body;
      },
    };
    const originalUser = req.user;
    req.body = { ...(req.body || {}), reference: bankTransfer.reference };
    await bankTransferController.adminRequeryBankTransfer(req, captured);
    req.user = originalUser;
    const refreshed = await BankTransfer.findById(bankTransfer._id).lean();
    const safeResponse = {
      success: captured.statusCode >= 200 && captured.statusCode < 300 && captured.body?.success === true,
      code: captured.body?.code || null,
      message: text(captured.body?.message) || "Transaction requery completed.",
      manualReviewRequired: captured.body?.manualReviewRequired === true,
      liveProviderRequery: captured.body?.liveProviderRequery === true,
      transaction: serializeTransaction(transaction, refreshed || bankTransfer),
    };
    const finalState = captured.statusCode >= 500 ? "FAILED" : "COMPLETED";
    await TransactionIntelligenceCommand.updateOne(
      { _id: command._id },
      {
        $set: {
          state: finalState,
          httpStatus: captured.statusCode,
          safeResponse,
          completedAt: new Date(),
        },
      }
    );
    await audit(
      req,
      finalState === "COMPLETED" ? "TRANSACTION_REQUERY_COMPLETED" : "TRANSACTION_REQUERY_FAILED",
      transaction,
      { idempotencyKey: requestKey, httpStatus: captured.statusCode }
    );
    return res.status(captured.statusCode).json(safeResponse);
  } catch (error) {
    console.error("TRANSACTION INTELLIGENCE REQUERY ERROR:", error);
    return controllerError(res, error, "Unable to requery this transaction.");
  }
};

const csvCell = (value) => {
  const string = text(value).replace(/\r?\n/g, " ");
  return `"${string.replace(/"/g, '""')}"`;
};
exports.exportTransactions = async (req, res) => {
  try {
    const query = await buildQuery(req);
    const transactions = await Transaction.find(query)
      .populate("customerId", "fullName name phone email")
      .sort({ createdAt: -1 })
      .limit(5000)
      .lean();
    const items = await enrichTransactions(transactions);
    await audit(req, "TRANSACTION_INTELLIGENCE_EXPORTED", null, {
      recordCount: items.length,
      filters: sanitizePayload(req.query),
    });
    const headers = [
      "Reference", "Provider Reference", "Customer", "Phone", "Email", "Service",
      "Provider", "Amount", "Internal Status", "Provider Status",
      "Reconciliation Status", "Created At",
    ];
    const rows = items.map((item) => [
      item.reference, item.providerReference, item.customer?.name, item.customer?.phone,
      item.customer?.email, item.serviceType, item.provider, item.amount,
      item.internalStatus, item.providerStatus, item.reconciliationStatus, item.createdAt,
    ]);
    const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
    res.type("text/csv");
    res.set("Content-Disposition", `attachment; filename="transaction-intelligence-${lagosDate()}.csv"`);
    return res.send(csv);
  } catch (error) {
    console.error("TRANSACTION INTELLIGENCE EXPORT ERROR:", error);
    return controllerError(res, error, "Unable to export transactions.");
  }
};

exports.__test = Object.freeze({
  lagosRange,
  maskPhone,
  maskEmail,
  sanitizePayload,
  normalizeProviderStatus,
  normalizeInternalStatus,
  intelligenceFor,
});