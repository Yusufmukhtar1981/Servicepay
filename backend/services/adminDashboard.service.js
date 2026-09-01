const mongoose = require("mongoose");
const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const Delivery = require("../models/delivery.model");
const IdVerification = require("../models/idVerification.model");
const DashboardTarget = require("../models/dashboardTarget.model");
const AdminAuditLog = require("../models/adminAuditLog.model");

const FULL_ACCESS_ROLES = new Set(["HEAD_OFFICE", "ADMIN", "SUPER_ADMIN", "HEAD_OFFICE_ADMIN"]);
const SUCCESS_STATUSES = ["SUCCESS", "SUCCESSFUL", "COMPLETED", "APPROVED"];
const PENDING_STATUSES = ["PENDING", "PROCESSING"];
const FAILED_STATUSES = ["FAILED", "CANCELLED", "REJECTED"];
const INVALID_STATUSES = ["REVERSED", "REFUNDED"];
const RANGE_DAYS = Object.freeze({ today: 1, "7d": 7, "30d": 30 });
const MAX_CUSTOM_RANGE_DAYS = 90;
const LAGOS_OFFSET_MS = 60 * 60 * 1000;

const normalizeRange = (value) => {
  const range = String(value || "today").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(RANGE_DAYS, range) ? range : "today";
};
const getDateWindow = (range, now = new Date()) => {
  const end = new Date(now);
  const normalizedRange = normalizeRange(range);
  const days = RANGE_DAYS[normalizedRange];
  if (normalizedRange === "today") {
    const local = new Date(end.getTime() + LAGOS_OFFSET_MS);
    const start = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - LAGOS_OFFSET_MS);
    const previousStart = new Date(start.getTime() - 86400000);
    return { start, end, previousStart, previousEnd: new Date(previousStart.getTime() + end.getTime() - start.getTime()), days };
  }
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days);
  const previousStart = new Date(start);
  previousStart.setUTCDate(previousStart.getUTCDate() - days);
  return { start, end, previousStart, previousEnd: start, days };
};
const getRequestedDateWindow = (query = {}, now = new Date()) => {
  if (!query.startDate && !query.endDate) return { ...getDateWindow(query.range, now), range: normalizeRange(query.range), custom: false };
  if (!query.startDate || !query.endDate) throw new Error("Both startDate and endDate are required.");
  const start = new Date(query.startDate);
  const end = new Date(query.endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) throw new Error("Date range is invalid.");
  const days = Math.ceil((end - start) / 86400000);
  if (days > MAX_CUSTOM_RANGE_DAYS) throw new Error(`Custom date ranges cannot exceed ${MAX_CUSTOM_RANGE_DAYS} days.`);
  const previousStart = new Date(start.getTime() - (end - start));
  return { start, end, previousStart, previousEnd: start, days, range: "custom", custom: true };
};
const readPermissions = (user = {}) => new Set(
  [...(Array.isArray(user.permissions) ? user.permissions : []), ...(Array.isArray(user.staffRole?.permissions) ? user.staffRole.permissions : [])]
    .map((item) => String(item).trim().toLowerCase()).filter(Boolean),
);
const hasPermission = (user = {}, permission) => FULL_ACCESS_ROLES.has(String(user.role || "").toUpperCase())
  || readPermissions(user).has("*") || readPermissions(user).has(String(permission).toLowerCase());
const buildScopeFilter = (user = {}, domain = "user") => {
  const role = String(user.role || "").toUpperCase();
  if (FULL_ACCESS_ROLES.has(role)) return {};
  if (role === "ZONAL_MANAGER" && user._id && ["user", "transaction"].includes(domain)) return { zonalManagerId: user._id };
  if (role === "STATE_MANAGER" && user._id && ["user", "transaction"].includes(domain)) return { stateManagerId: user._id };
  return { _id: { $exists: false } };
};
const scopedTransactionMatch = (scope) => !Object.keys(scope).length ? {} : scope.zonalManagerId ? { zonalManagerId: scope.zonalManagerId } : scope.stateManagerId ? { stateManagerId: scope.stateManagerId } : { _id: { $exists: false } };
const metric = (value, available = true, reason = "") => ({ available, value: available ? value : null, ...(available ? {} : { reason }) });
const unavailable = (reason) => metric(null, false, reason);
const permissionMetric = (user, permission, value) => hasPermission(user, permission) ? metric(value) : unavailable("Not available for this staff role.");
const transactionMatch = (start, end, scope) => ({ createdAt: { $gte: start, $lt: end }, status: { $nin: INVALID_STATUSES }, ...scopedTransactionMatch(scope) });
const amount = (field = "$amount") => ({ $convert: { input: field, to: "double", onError: 0, onNull: 0 } });
const statusCount = (statuses) => ({ $sum: { $cond: [{ $in: ["$status", statuses] }, 1, 0] } });
const aggregateSummary = (match) => Transaction.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: 1 }, value: { $sum: { $cond: [{ $in: ["$status", SUCCESS_STATUSES] }, amount(), 0] } }, successful: statusCount(SUCCESS_STATUSES), pending: statusCount(PENDING_STATUSES), failed: statusCount(FAILED_STATUSES) } }]);
const aggregateSeries = (match) => Transaction.aggregate([{ $match: match }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "+01:00" } }, total: { $sum: 1 }, successful: statusCount(SUCCESS_STATUSES), pending: statusCount(PENDING_STATUSES), failed: statusCount(FAILED_STATUSES), value: { $sum: { $cond: [{ $in: ["$status", SUCCESS_STATUSES] }, amount(), 0] } } } }, { $sort: { _id: 1 } }]);
const aggregateProducts = (match) => Transaction.aggregate([{ $match: match }, { $group: { _id: "$serviceType", count: { $sum: 1 }, value: { $sum: { $cond: [{ $in: ["$status", SUCCESS_STATUSES] }, amount(), 0] } }, successful: statusCount(SUCCESS_STATUSES), pending: statusCount(PENDING_STATUSES), failed: statusCount(FAILED_STATUSES) } }, { $sort: { count: -1, _id: 1 } }, { $limit: 50 }]);
const summaryFrom = (rows) => ({ total: 0, value: 0, successful: 0, pending: 0, failed: 0, ...(rows[0] || {}) });
const percentChange = (current, previous) => !previous ? null : Math.round(((current - previous) / previous) * 1000) / 10;
const isScopedManager = (user) => ["ZONAL_MANAGER", "STATE_MANAGER"].includes(String(user?.role || "").toUpperCase());
const targetAccess = (user) => String(user?.role || "").toUpperCase() === "HEAD_OFFICE";
const csvCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
const targetRows = (target, current) => {
  const values = target?.values instanceof Map
    ? Object.fromEntries(target.values)
    : (target?.values || {});
  const actuals = {
    transactionCount: current.total,
    transactionValue: current.value,
    successfulTransactions: current.successful,
  };
  return Object.entries(values).map(([name, value]) => {
    const actual = Object.prototype.hasOwnProperty.call(actuals, name) ? actuals[name] : null;
    return {
      name,
      target: value,
      actual,
      progress: actual !== null && value > 0 ? actual / value : null,
    };
  });
};

const getExecutiveDashboard = async (req, res) => {
  let window;
  try { window = getRequestedDateWindow(req.query); } catch (error) { return res.status(400).json({ success: false, message: error.message }); }
  const userScope = buildScopeFilter(req.user, "user");
  const transactionScope = buildScopeFilter(req.user, "transaction");
  const scoped = isScopedManager(req.user);
  const txAllowed = hasPermission(req.user, "transactions.view");
  const usersAllowed = hasPermission(req.user, "users.view");
  const deliveryAllowed = hasPermission(req.user, "delivery.view");
  const kycAllowed = hasPermission(req.user, "kyc.view");
  const customerFilter = { role: "CUSTOMER", ...userScope };
  const currentMatch = transactionMatch(window.start, window.end, transactionScope);
  try {
    const [customers, activeCustomers, agents, aggregators, stateManagers, zonalManagers, branchManagers, walletRows, currentRows, previousRows, series, products, activity, pendingKyc, pendingDeliveries, activeRiders, geography, target] = await Promise.all([
      usersAllowed ? User.countDocuments(customerFilter) : null,
      usersAllowed ? User.countDocuments({ ...customerFilter, status: "ACTIVE" }) : null,
      usersAllowed ? User.countDocuments({ role: "AGENT", ...userScope }) : null,
      usersAllowed ? User.countDocuments({ role: "AGGREGATOR", ...userScope }) : null,
      usersAllowed ? User.countDocuments({ role: "STATE_MANAGER", ...userScope }) : null,
      usersAllowed ? User.countDocuments({ role: "ZONAL_MANAGER", ...userScope }) : null,
      usersAllowed ? User.countDocuments({ role: "BRANCH_MANAGER", ...userScope }) : null,
      hasPermission(req.user, "wallets.view") || hasPermission(req.user, "finance.view") ? User.aggregate([{ $match: customerFilter }, { $group: { _id: null, value: { $sum: amount("$walletBalance") } } }]) : [],
      txAllowed ? aggregateSummary(currentMatch) : [],
      txAllowed ? aggregateSummary(transactionMatch(window.previousStart, window.previousEnd, transactionScope)) : [],
      txAllowed ? aggregateSeries(currentMatch) : [],
      txAllowed ? aggregateProducts(currentMatch) : [],
      txAllowed ? Transaction.find(currentMatch).select("reference serviceType amount status createdAt").sort({ createdAt: -1 }).limit(20).lean() : [],
      kycAllowed && !scoped ? IdVerification.countDocuments({ status: "PENDING" }) : null,
      deliveryAllowed && !scoped ? Delivery.countDocuments({ status: "PENDING" }) : null,
      deliveryAllowed && !scoped ? User.countDocuments({ role: "RIDER", status: "ACTIVE" }) : null,
      usersAllowed ? User.aggregate([{ $match: { ...userScope, role: { $in: ["AGENT", "CUSTOMER"] } } }, { $group: { _id: { zone: "$zone", state: "$state" }, users: { $sum: 1 }, agents: { $sum: { $cond: [{ $eq: ["$role", "AGENT"] }, 1, 0] } } } }, { $sort: { users: -1 } }, { $limit: 50 }]) : [],
      targetAccess(req.user) ? DashboardTarget.findOne({ key: "executive" }).select("values updatedAt").lean() : null,
    ]);
    const current = summaryFrom(currentRows), previous = summaryFrom(previousRows);
    const productMap = Object.fromEntries(products.map((row) => [String(row._id || ""), row]));
    const noSafeScope = "This data cannot be safely scoped for this management role.";
    const withdrawal = hasPermission(req.user, "withdrawals.view") ? unavailable("No withdrawal model is configured.") : unavailable("Not available for this staff role.");
    const solar = hasPermission(req.user, "solar.view") ? unavailable("No solar application model is configured.") : unavailable("Not available for this staff role.");
    return res.json({ success: true, data: {
      range: window.range, startDate: window.start.toISOString(), endDate: window.end.toISOString(), generatedAt: new Date().toISOString(),
      kpis: {
        totalCustomers: permissionMetric(req.user, "users.view", customers), activeCustomers: permissionMetric(req.user, "users.view", activeCustomers),
        totalWalletBalance: hasPermission(req.user, "wallets.view") || hasPermission(req.user, "finance.view") ? metric(walletRows[0]?.value || 0) : unavailable("Not available for this staff role."),
        transactionCount: permissionMetric(req.user, "transactions.view", current.total), transactionValue: permissionMetric(req.user, "transactions.view", current.value), successfulTransactions: permissionMetric(req.user, "transactions.view", current.successful), pendingTransactions: permissionMetric(req.user, "transactions.view", current.pending), failedTransactions: permissionMetric(req.user, "transactions.view", current.failed),
        pendingWithdrawals: withdrawal, pendingKycReviews: kycAllowed && !scoped ? metric(pendingKyc) : unavailable(scoped ? noSafeScope : "Not available for this staff role."), pendingSolarApplications: solar,
        activeRiders: deliveryAllowed && !scoped ? metric(activeRiders) : unavailable(scoped ? noSafeScope : "Not available for this staff role."),
        pendingDeliveries: deliveryAllowed && !scoped ? metric(pendingDeliveries) : unavailable(scoped ? noSafeScope : "Not available for this staff role."),
        totalAgentsAggregators: permissionMetric(req.user, "users.view", (agents || 0) + (aggregators || 0)),
        totalManagers: permissionMetric(req.user, "users.view", (stateManagers || 0) + (zonalManagers || 0)),
        totalBranchManagers: permissionMetric(req.user, "users.view", branchManagers),
        totalBranches: unavailable("No branch model is configured in this release."),
        managers: permissionMetric(req.user, "users.view", (stateManagers || 0) + (zonalManagers || 0)), agents: permissionMetric(req.user, "users.view", agents),
        branches: unavailable("No branch model is configured in this release."),
        todayTransactionVolume: permissionMetric(req.user, "transactions.view", current.total),
        todayTransactionValue: permissionMetric(req.user, "transactions.view", current.value),
      },
      comparisons: { transactionVolume: txAllowed ? percentChange(current.total, previous.total) : null, transactionValue: txAllowed ? percentChange(current.value, previous.value) : null, successfulTransactions: txAllowed ? percentChange(current.successful, previous.successful) : null },
      operations: {
        transactions: permissionMetric(req.user, "transactions.view", current.total),
        transactionsToday: permissionMetric(req.user, "transactions.view", current.total),
        transfers: permissionMetric(req.user, "transactions.view", (productMap.TRANSFER?.count || 0) + (productMap.BANK_TRANSFER?.count || 0)),
        withdrawals: withdrawal,
        airtime: permissionMetric(req.user, "transactions.view", productMap.AIRTIME?.count || 0),
        data: permissionMetric(req.user, "transactions.view", productMap.DATA?.count || 0),
        electricity: permissionMetric(req.user, "transactions.view", productMap.ELECTRICITY?.count || 0),
        delivery: deliveryAllowed && !scoped ? metric(pendingDeliveries) : unavailable(scoped ? noSafeScope : "Not available for this staff role."),
        deliveries: deliveryAllowed && !scoped ? metric(pendingDeliveries) : unavailable(scoped ? noSafeScope : "Not available for this staff role."),
        marketplace: unavailable("No marketplace model is configured."),
        solar,
      },
      performance: { series: series.map((row) => ({ date: row._id, total: row.total || 0, successful: row.successful || 0, pending: row.pending || 0, failed: row.failed || 0, value: row.value || 0 })), products: products.map((row) => ({ product: row._id || "UNKNOWN", count: row.count || 0, value: row.value || 0, successful: row.successful || 0, pending: row.pending || 0, failed: row.failed || 0 })), branches: { available: false, reason: "No branch model is configured.", geography } },
      products: products.map((row) => ({ product: row._id || "UNKNOWN", count: row.count || 0, value: row.value || 0, successful: row.successful || 0, pending: row.pending || 0, failed: row.failed || 0 })),
      branches: [],
      branchPerformance: { available: false, reason: "No branch model is configured in this release.", geography },
      attention: { pendingKyc: kycAllowed && !scoped ? pendingKyc : null, pendingWithdrawals: null, failedTransactions: txAllowed ? current.failed : null, pendingDeliveries: deliveryAllowed && !scoped ? pendingDeliveries : null, pendingSolar: null },
      activity: activity.map((row) => ({ action: "Transaction recorded", target: row.reference, service: row.serviceType, amount: row.amount, status: row.status, time: row.createdAt })),
      health: { backend: metric({ status: "ok", uptimeSeconds: Math.floor(process.uptime()) }), database: metric({ status: mongoose.connection.readyState === 1 ? "connected" : "disconnected" }), authentication: unavailable("No independent authentication probe is configured."), email: unavailable("Email provider health is not checked."), providers: unavailable("External provider health is not checked.") },
      targets: targetAccess(req.user) ? targetRows(target, current) : [],
      targetConfiguration: targetAccess(req.user) ? { available: true, values: target?.values || {}, updatedAt: target?.updatedAt || null } : unavailable("Targets are Head Office-only."),
      configuration: targetAccess(req.user) ? { status: "Head Office target configuration is available." } : {},
      exports: hasPermission(req.user, "reports.export") ? [
        { label: "CSV executive report", format: "csv", available: true },
        { label: "PDF executive report", format: "pdf", available: false, message: "PDF export is not safely configured." },
      ] : [],
    } });
  } catch (error) {
    console.error("Executive admin dashboard error:", error);
    return res.status(500).json({ success: false, message: "Failed to load executive dashboard." });
  }
};

const getDashboardTargets = async (req, res) => {
  if (!targetAccess(req.user)) return res.status(403).json({ success: false, message: "Head Office access is required." });
  const target = await DashboardTarget.findOne({ key: "executive" }).select("values updatedAt").lean();
  return res.json({ success: true, data: target || { values: {}, updatedAt: null } });
};
const updateDashboardTargets = async (req, res) => {
  if (!targetAccess(req.user)) return res.status(403).json({ success: false, message: "Head Office access is required." });
  const values = req.body?.values;
  if (!values || typeof values !== "object" || Array.isArray(values) || Object.keys(values).length > 20) return res.status(400).json({ success: false, message: "values must be an object with at most 20 targets." });
  for (const [key, value] of Object.entries(values)) if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(key) || !Number.isFinite(value) || value < 0 || value > 1e15) return res.status(400).json({ success: false, message: "Target names and values are invalid." });
  const target = await DashboardTarget.findOneAndUpdate({ key: "executive" }, { $set: { values, updatedBy: req.user._id } }, { new: true, upsert: true, setDefaultsOnInsert: true }).select("values updatedAt").lean();
  await AdminAuditLog.create({ actorId: req.user._id, action: "EXECUTIVE_TARGETS_UPDATED", metadata: { keys: Object.keys(values) } });
  return res.json({ success: true, data: target });
};
const getDashboardExport = async (req, res) => {
  if (!hasPermission(req.user, "reports.export")) return res.status(403).json({ success: false, message: "Report export permission is required." });
  if (String(req.query.format || "csv").toLowerCase() !== "csv") return res.status(501).json({ success: false, code: "PDF_EXPORT_UNAVAILABLE", message: "PDF export is not safely configured." });
  let window;
  try { window = getRequestedDateWindow(req.query); } catch (error) { return res.status(400).json({ success: false, message: error.message }); }
  const rows = await aggregateProducts(transactionMatch(window.start, window.end, buildScopeFilter(req.user, "transaction")));
  const csv = [
    ["Product", "Transactions", "Successful", "Pending", "Failed", "Successful value (NGN)"].map(csvCell).join(","),
    ...rows.map((row) => [row._id || "UNKNOWN", row.count || 0, row.successful || 0, row.pending || 0, row.failed || 0, row.value || 0].map(csvCell).join(",")),
  ].join("\r\n");
  res.set("Content-Type", "text/csv; charset=utf-8");
  res.set("Content-Disposition", `attachment; filename="servicepay-executive-${window.range}.csv"`);
  return res.send(`\uFEFF${csv}`);
};
module.exports = { RANGE_DAYS, MAX_CUSTOM_RANGE_DAYS, normalizeRange, getDateWindow, getRequestedDateWindow, readPermissions, hasPermission, buildScopeFilter, getExecutiveDashboard, getDashboardTargets, updateDashboardTargets, getDashboardExport };