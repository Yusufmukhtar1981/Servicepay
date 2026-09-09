const mongoose = require("mongoose");
const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const Branch = require("../models/branch.model");
const Delivery = require("../models/delivery.model");
const WithdrawalRequest = require("../models/withdrawalRequest.model");
const KycProfile = require("../models/kycProfile.model");
const SolarApplication = require("../models/solarApplication.model");
const PhoneApplication = require("../models/phoneApplication.model");
const MarketplaceOrder = require("../models/marketplaceOrder.model");
const BranchTarget = require("../models/branchTarget.model");
const BranchOperationalRequest = require("../models/branchOperationalRequest.model");
const EmpowermentProgram = require("../models/empowermentProgram.model");
const AdminAuditLog = require("../models/adminAuditLog.model");
const SVPReport = require("../models/svpReport.model");
const { validateSVPPermissions } = require("../services/svpPermission.service");
const { normalizeScope, filterFor } = require("../services/svpScope.service");
const { validateStrongPassword } = require("../utils/passwordPolicy");

const STATUSES = ["ACTIVE", "SUSPENDED", "DISABLED"];
const oid = (value) => mongoose.Types.ObjectId.isValid(value);
const actor = (req) => req.user._id;
const audit = (req, action, reason, targetUserId = null, metadata = {}) => AdminAuditLog.create({
  actorId: actor(req), actorRole: req.user.role, actorName: req.user.fullName || "", targetUserId,
  action, reason, metadata, ipAddress: String(req.ip || ""), userAgent: String(req.headers["user-agent"] || ""),
  requestMethod: req.method, requestPath: req.baseUrl + req.path,
});
const cleanScope = normalizeScope;
const txScope = (scope = {}) => {
  switch (scope.type) {
    case "GLOBAL": return {};
    case "REGION":
    case "STATE": return { _id: { $exists: false } }; // resolved through customer ownership below.
    case "BRANCHES": return { branchId: { $in: scope.branchIds } };
    case "PRODUCTS": return { serviceType: { $in: scope.products } };
    case "CUSTOM": return scope.filters?.branchIds ? { branchId: { $in: scope.filters.branchIds }, ...(scope.filters.serviceType ? { serviceType: scope.filters.serviceType } : {}) } : (scope.filters || {});
    default: return { _id: { $exists: false } }; // department cannot safely be applied to transactions.
  }
};
const scopedTransactions = (scope) => filterFor(scope, "transaction");
const ownScope = (req) => req.user.svpScope || { type: "CUSTOM", filters: {} };
const denied = (filter) => Boolean(filter?._id && filter._id.$exists === false);
const unavailable = (reason) => ({ available: false, value: null, reason });
const available = (value) => ({ available: true, value });
const view = (user) => ({ id: user._id, executiveId: user.executiveId, fullName: user.fullName, email: user.email, phone: user.phone, title: user.executiveTitle, department: user.department, status: user.status, permissions: user.svpPermissions || [], scope: user.svpScope, createdAt: user.createdAt, updatedAt: user.updatedAt });

exports.create = async (req, res, next) => { try {
  const { fullName, email, phone, executiveId, password, title, department } = req.body;
  if (![fullName, email, phone, executiveId, password, title, department].every((v) => String(v || "").trim())) return res.status(400).json({ success: false, message: "fullName, executiveId, email, phone, password, title and department are required." });
  const passwordCheck = validateStrongPassword(password); if (!passwordCheck.valid) return res.status(400).json({ success: false, message: passwordCheck.message });
  const permissions = validateSVPPermissions(req.body.permissions || []);
  if (!permissions.valid) return res.status(400).json({ success: false, message: permissions.message });
  let scope; try { scope = cleanScope(req.body.scope); } catch (error) { return res.status(400).json({ success: false, message: error.message }); }
  const normalized = { executiveId: String(executiveId).trim().toUpperCase(), email: String(email).trim().toLowerCase(), phone: String(phone).trim() };
  if (await User.exists({ $or: [{ executiveId: normalized.executiveId }, { email: normalized.email }, { phone: normalized.phone }] })) return res.status(409).json({ success: false, message: "executiveId, email, and phone must each be unique." });
  const requestedStatus = String(req.body.status || "ACTIVE").toUpperCase();
  if (!STATUSES.includes(requestedStatus)) return res.status(400).json({ success: false, message: "status must be ACTIVE, SUSPENDED, or DISABLED." });
  const user = await User.create({ fullName: String(fullName).trim(), ...normalized, password, role: "SVP", isStaff: true, executiveTitle: String(title).trim(), department: String(department).trim().toUpperCase(), status: requestedStatus, svpPermissions: permissions.permissions, svpScope: scope, staffCreatedBy: actor(req) });
  await audit(req, "SVP_CREATED", "Created SVP account", user._id, { executiveId: user.executiveId, scopeType: scope.type });
  res.status(201).json({ success: true, data: view(user) });
} catch (error) { if (error.code === 11000) return res.status(409).json({ success: false, message: "executiveId, email, and phone must each be unique." }); next(error); } };
exports.list = async (req, res, next) => { try {
  const filter = { role: "SVP" }; if (req.query.status) filter.status = String(req.query.status).toUpperCase();
  const users = await User.find(filter).select("+authTokenVersion").sort({ createdAt: -1 }).lean(); res.json({ success: true, data: users.map(view) });
} catch (error) { next(error); } };
exports.detail = async (req, res, next) => { try {
  const user = await User.findOne({ _id: req.params.id, role: "SVP" }).lean(); if (!user) return res.status(404).json({ success: false, message: "SVP not found." }); res.json({ success: true, data: view(user) });
} catch (error) { next(error); } };
exports.update = async (req, res, next) => { try {
  const user = await User.findOne({ _id: req.params.id, role: "SVP" }); if (!user) return res.status(404).json({ success: false, message: "SVP not found." });
  const allowed = ["fullName", "email", "phone", "executiveTitle", "department"]; for (const key of allowed) if (req.body[key] !== undefined) user[key] = key === "email" ? String(req.body[key]).trim().toLowerCase() : String(req.body[key]).trim();
  if (req.body.title !== undefined) user.executiveTitle = String(req.body.title).trim();
  if (req.body.permissions !== undefined) { const result = validateSVPPermissions(req.body.permissions); if (!result.valid) return res.status(400).json({ success: false, message: result.message }); user.svpPermissions = result.permissions; }
  if (req.body.scope !== undefined) { try { user.svpScope = cleanScope(req.body.scope); } catch (error) { return res.status(400).json({ success: false, message: error.message }); } }
  await user.save(); await audit(req, "SVP_UPDATED", "Updated SVP account", user._id); res.json({ success: true, data: view(user) });
} catch (error) { if (error.code === 11000) return res.status(409).json({ success: false, message: "executiveId, email, and phone must each be unique." }); next(error); } };
exports.status = async (req, res, next) => { try {
  const status = String(req.body.status || "").toUpperCase(); if (!STATUSES.includes(status)) return res.status(400).json({ success: false, message: "status must be ACTIVE, SUSPENDED, or DISABLED." });
  const user = await User.findOne({ _id: req.params.id, role: "SVP" }); if (!user) return res.status(404).json({ success: false, message: "SVP not found." });
  user.status = status; if (status !== "ACTIVE") user.authTokenVersion = Number(user.authTokenVersion || 0) + 1; await user.save({ validateBeforeSave: false });
  await audit(req, "SVP_STATUS_UPDATED", `Set SVP status to ${status}`, user._id, { status }); res.json({ success: true, data: view(user) });
} catch (error) { next(error); } };
exports.resetPassword = async (req, res, next) => { try {
  const check = validateStrongPassword(req.body.password); if (!check.valid) return res.status(400).json({ success: false, message: check.message });
  const user = await User.findOne({ _id: req.params.id, role: "SVP" }).select("+authTokenVersion"); if (!user) return res.status(404).json({ success: false, message: "SVP not found." });
  user.password = req.body.password; user.passwordChangedAt = new Date(); user.mustChangePassword = true; user.authTokenVersion = Number(user.authTokenVersion || 0) + 1; await user.save();
  await audit(req, "SVP_PASSWORD_RESET", "Reset SVP password and revoked sessions", user._id); res.json({ success: true, message: "Password reset; existing sessions were revoked." });
} catch (error) { next(error); } };
exports.revokeSessions = async (req, res, next) => { try {
  const user = await User.findOneAndUpdate({ _id: req.params.id, role: "SVP" }, { $inc: { authTokenVersion: 1 } }, { new: true }).select("+authTokenVersion"); if (!user) return res.status(404).json({ success: false, message: "SVP not found." });
  await audit(req, "SVP_SESSIONS_REVOKED", "Revoked SVP sessions", user._id); res.json({ success: true, message: "Sessions revoked." });
} catch (error) { next(error); } };
exports.metrics = async (req, res, next) => { try {
  const scope = ownScope(req), match = await scopedTransactions(scope), userFilter = await filterFor(scope, "user"), branchFilter = await filterFor(scope, "branch");
  const userMetric = (extra = {}) => denied(userFilter) ? Promise.resolve(unavailable("This scope cannot be safely mapped to users.")) : User.countDocuments({ ...userFilter, ...extra }).then(available);
  const branchMetric = denied(branchFilter) ? Promise.resolve(unavailable("This scope cannot be safely mapped to branches.")) : Branch.countDocuments(branchFilter).then(available);
  const [transactions, users, branches, customers, activeCustomers, staff, activeStaff, riders, managers, agents, partners, officers, customerWallet, riderWallet] = await Promise.all([
    Transaction.aggregate([{ $match: match }, { $group: { _id: "$status", volume: { $sum: 1 }, value: { $sum: "$amount" }, revenue: { $sum: "$servicepayProfit" }, commissions: { $sum: { $add: ["$agentCommission", "$stateManagerCommission", "$zonalManagerCommission"] } } } }]),
    userMetric(), branchMetric, userMetric({ role: "CUSTOMER" }), userMetric({ role: "CUSTOMER", status: "ACTIVE" }), userMetric({ isStaff: true }), userMetric({ isStaff: true, status: "ACTIVE" }), userMetric({ role: "DELIVERY_RIDER" }),
    userMetric({ role: { $in: ["ZONAL_MANAGER", "STATE_MANAGER", "BRANCH_MANAGER"] } }), userMetric({ role: "AGENT" }), userMetric({ role: "BUSINESS_PARTNER" }),
    userMetric({ role: { $in: ["SOLAR_OFFICER", "PHONE_FINANCING_OFFICER"] } }),
    denied(userFilter) ? null : User.aggregate([{ $match: { ...userFilter, role: "CUSTOMER" } }, { $group: { _id: null, value: { $sum: "$walletBalance" } } }]),
    denied(userFilter) ? null : User.aggregate([{ $match: { ...userFilter, role: "DELIVERY_RIDER" } }, { $group: { _id: null, value: { $sum: "$walletBalance" } } }]),
  ]);
  res.json({ success: true, data: { scope, transactions, entities: { users, branches, customers, activeCustomers, staff, activeStaff, riders, managers, agents, businessPartners: partners, officers, customerWalletBalance: denied(userFilter) ? unavailable("This scope cannot be safely mapped to customer wallets.") : available(customerWallet[0]?.value || 0), riderWalletBalance: denied(userFilter) ? unavailable("This scope cannot be safely mapped to rider wallets.") : available(riderWallet[0]?.value || 0) } } });
} catch (error) { next(error); } };
exports.transactions = async (req, res, next) => { try {
  const scopeFilter = await scopedTransactions(ownScope(req));
  const requestedFilter = {};
  if (req.query.customer && req.query.rider) {
    return res.status(400).json({
      success: false,
      message: "customer and rider filters cannot be combined.",
    });
  }
  ["status", "serviceType", "provider"].forEach((key) => { if (req.query[key]) requestedFilter[key] = String(req.query[key]).toUpperCase(); });
  if (req.query.reference) requestedFilter.reference = new RegExp(`^${String(req.query.reference).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
  for (const [query, field] of [["branch", "branchId"], ["staff", "agentId"], ["customer", "customerId"]]) {
    if (!req.query[query]) continue;
    if (!oid(req.query[query])) return res.status(400).json({ success: false, message: `${query} must be a valid id.` });
    requestedFilter[field] = req.query[query];
  }
  if (req.query.rider) {
    if (!oid(req.query.rider)) return res.status(400).json({ success: false, message: "rider must be a valid id." });
    const rider = await User.exists({ _id: req.query.rider, role: { $in: ["RIDER", "DELIVERY_RIDER"] } });
    if (!rider) return res.status(400).json({ success: false, message: "rider must identify a Rider account." });
    // This schema records the party on customerId and has no riderId.  Keep
    // the canonical scope in a separate $and clause so this can only narrow.
    requestedFilter.customerId = req.query.rider;
  }
  if (req.query.from || req.query.to) { const from = req.query.from ? new Date(req.query.from) : null, to = req.query.to ? new Date(req.query.to) : null; if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime())) || (from && to && from > to)) return res.status(400).json({ success: false, message: "Invalid date range." }); requestedFilter.createdAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) }; }
  const blocks = [scopeFilter, requestedFilter].filter((block) => block && Object.keys(block).length);
  const filter = blocks.length === 1 ? blocks[0] : { $and: blocks };
  const page = Number(req.query.page || 1), limit = Number(req.query.limit || 50); if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) return res.status(400).json({ success: false, message: "page must be positive and limit must be 1-100." });
  const [rows, total] = await Promise.all([Transaction.find(filter).select("reference serviceType provider amount servicepayProfit status branchId agentId customerId createdAt").sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(), Transaction.countDocuments(filter)]);
  res.json({ success: true, data: { items: rows, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } } });
} catch (error) { next(error); } };
exports.staffPerformance = async (req, res, next) => { try { const users = await filterFor(ownScope(req), "user"); const staff = await User.find({ ...users, isStaff: true }).select("_id fullName role department state status").lean(); const ids = staff.map((x) => x._id); const rows = await Transaction.aggregate([{ $match: { ...(await scopedTransactions(ownScope(req))), agentId: { $in: ids } } }, { $group: { _id: "$agentId", volume: { $sum: 1 }, value: { $sum: "$amount" }, revenue: { $sum: "$servicepayProfit" }, pending: { $sum: { $cond: [{ $eq: ["$status", "PENDING"] }, 1, 0] } }, lastActivity: { $max: "$createdAt" } } }]); const map = new Map(rows.map((x) => [String(x._id), x])); const data = staff.map((x) => ({ ...x, ...(map.get(String(x._id)) || { volume: 0, value: 0, revenue: 0, pending: 0, lastActivity: null }), target: unavailable("No individual staff target model is configured.") })).sort((a, b) => b.value - a.value).map((row, index) => ({ ...row, rank: index + 1 })); res.json({ success: true, data }); } catch (error) { next(error); } };
exports.branchPerformance = async (req, res, next) => { try { const branches = await Branch.find(await filterFor(ownScope(req), "branch")).select("_id name code state status").lean(); const ids = branches.map((x) => x._id); const [rows, targets] = await Promise.all([Transaction.aggregate([{ $match: { ...(await scopedTransactions(ownScope(req))), branchId: { $in: ids } } }, { $group: { _id: "$branchId", volume: { $sum: 1 }, value: { $sum: "$amount" }, revenue: { $sum: "$servicepayProfit" }, pending: { $sum: { $cond: [{ $eq: ["$status", "PENDING"] }, 1, 0] } }, lastActivity: { $max: "$createdAt" } } }]), BranchTarget.find({ branchId: { $in: ids }, startDate: { $lte: new Date() }, endDate: { $gte: new Date() } }).select("branchId target actual status metric").lean()]); const map = new Map(rows.map((x) => [String(x._id), x])), targetMap = new Map(targets.map((x) => [String(x.branchId), x])); const data = branches.map((x) => { const target = targetMap.get(String(x._id)); return { ...x, ...(map.get(String(x._id)) || { volume: 0, value: 0, revenue: 0, pending: 0, lastActivity: null }), target: target ? { available: true, target: target.target, actual: target.actual, achievement: target.target ? target.actual / target.target : null, status: target.status, metric: target.metric } : unavailable("No current branch target is configured.") }; }).sort((a, b) => b.value - a.value).map((row, index) => ({ ...row, rank: index + 1 })); res.json({ success: true, data }); } catch (error) { next(error); } };
const REPORT_TYPES = ["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "INCIDENT", "OPERATIONAL", "FINANCIAL_PERFORMANCE", "BRANCH_PERFORMANCE", "STAFF_PERFORMANCE"];
exports.createReport = async (req, res, next) => { try { const type = String(req.body.type || "").toUpperCase(); if (!REPORT_TYPES.includes(type) || !String(req.body.title || "").trim()) return res.status(400).json({ success: false, message: "Valid report type and title are required." }); const report = await SVPReport.create({ type, title: req.body.title, summary: req.body.summary || "", createdBy: actor(req), scope: ownScope(req), history: [{ status: "DRAFT", note: "Created", actorId: actor(req) }] }); await audit(req, "SVP_REPORT_CREATED", "Created SVP report", null, { reportId: report._id }); res.status(201).json({ success: true, data: report }); } catch (error) { next(error); } };
exports.listReports = async (req, res, next) => { try { const filter = { createdBy: actor(req) }; if (req.query.status) filter.status = String(req.query.status).toUpperCase(); res.json({ success: true, data: await SVPReport.find(filter).sort({ createdAt: -1 }).lean() }); } catch (error) { next(error); } };
exports.updateReport = async (req, res, next) => { try { const report = await SVPReport.findOne({ _id: req.params.id, createdBy: actor(req), status: "DRAFT" }); if (!report) return res.status(404).json({ success: false, message: "Draft report not found." }); if (req.body.title !== undefined) report.title = String(req.body.title).trim(); if (req.body.summary !== undefined) report.summary = String(req.body.summary); await report.save(); res.json({ success: true, data: report }); } catch (error) { next(error); } };
exports.submitReport = async (req, res, next) => { try { const report = await SVPReport.findOne({ _id: req.params.id, createdBy: actor(req), status: "DRAFT" }); if (!report) return res.status(409).json({ success: false, message: "Only an owned draft can be submitted." }); report.status = "SUBMITTED"; report.history.push({ status: "SUBMITTED", note: "Submitted", actorId: actor(req) }); await report.save(); res.json({ success: true, data: report }); } catch (error) { next(error); } };
exports.audit = async (req, res, next) => { try { res.json({ success: true, data: await AdminAuditLog.find({ $or: [{ actorId: actor(req) }, { targetUserId: actor(req) }] }).sort({ createdAt: -1 }).lean() }); } catch (error) { next(error); } };
exports.liveOperations = async (req, res, next) => { try {
  const scope = ownScope(req), tx = await scopedTransactions(scope), user = await filterFor(scope, "user"), branch = await filterFor(scope, "branch");
  const userCount = denied(user) ? unavailable("This scope cannot be safely mapped to users.") : available(await User.countDocuments(user));
  const branchCount = denied(branch) ? unavailable("This scope cannot be safely mapped to branches.") : available(await Branch.countDocuments(branch));
  // Delivery, withdrawal, KYC, solar, financing, and marketplace schemas do
  // not share a universal scoped ownership key.  They are intentionally
  // unavailable rather than leaking global operational queues.
  const branchIds = denied(branch) ? null : await Branch.find(branch).distinct("_id");
  const branchQueue = async (Model, filter, name) => branchIds
    ? available(await Model.countDocuments({ ...filter, branchId: { $in: branchIds } }))
    : unavailable(`${name} cannot be safely mapped to this SVP scope.`);
  const queue = async (Model, filter, name) => scope.type === "GLOBAL"
    ? available(await Model.countDocuments(filter))
    : unavailable(`${name} cannot be safely mapped to this SVP scope.`);
  res.json({ success: true, data: {
    transactions: { pending: available(await Transaction.countDocuments({ ...tx, status: "PENDING" })), failed: available(await Transaction.countDocuments({ ...tx, status: "FAILED" })) },
    users: userCount, branches: branchCount,
    pendingRiders: denied(user) ? unavailable("Rider queue cannot be safely mapped to this SVP scope.") : available(await User.countDocuments({ ...user, role: { $in: ["RIDER", "DELIVERY_RIDER"] }, status: { $in: ["SUSPENDED", "BLOCKED"] } })),
    unassignedDeliveries: await branchQueue(Delivery, { status: { $in: ["PENDING", "ASSIGNED"] }, assignedRiderId: null }, "Delivery queue"),
    deliveries: await branchQueue(Delivery, { status: { $in: ["PENDING", "ASSIGNED"] } }, "Delivery queue"),
    withdrawals: await queue(WithdrawalRequest, { status: "PENDING" }, "Withdrawal queue"),
    kyc: await queue(KycProfile, { status: { $in: ["PENDING", "UNDER_REVIEW"] } }, "KYC queue"),
    solar: await queue(SolarApplication, { status: { $in: ["SUBMITTED", "UNDER_REVIEW"] } }, "Solar queue"),
    financing: await queue(PhoneApplication, { status: { $in: ["SUBMITTED", "UNDER_REVIEW"] } }, "Financing queue"),
    marketplace: await queue(MarketplaceOrder, { orderStatus: { $in: ["PENDING", "PROCESSING"] } }, "Marketplace queue"),
    pendingEmpowerment: branchIds ? available(await EmpowermentProgram.countDocuments({ branchId: { $in: branchIds }, status: { $in: ["DRAFT", "OPEN", "UNDER_REVIEW", "APPROVED", "DISBURSING"] } })) : unavailable("Empowerment queue cannot be safely mapped to this SVP scope."),
    branchIssues: await branchQueue(BranchOperationalRequest, { status: { $in: ["OPEN", "IN_PROGRESS"] } }, "Branch issues"),
    staffIssues: denied(user) ? unavailable("Staff issues cannot be safely mapped to this SVP scope.") : available(await User.countDocuments({ ...user, isStaff: true, status: { $in: ["SUSPENDED", "BLOCKED", "DISABLED"] } })),
  } });
} catch (error) { next(error); } };
exports.headOfficeReports = async (req, res, next) => { try { res.json({ success: true, data: await SVPReport.find({}).populate("createdBy", "fullName executiveId").sort({ createdAt: -1 }).lean() }); } catch (error) { next(error); } };
exports.headOfficeReport = async (req, res, next) => { try { const report = await SVPReport.findById(req.params.id).populate("createdBy", "fullName executiveId").lean(); if (!report) return res.status(404).json({ success: false, message: "Report not found." }); res.json({ success: true, data: report }); } catch (error) { next(error); } };
exports.headOfficeAudit = async (req, res, next) => { try { const filter = { $or: [{ actorRole: "SVP" }] }; if (req.query.svpId && oid(req.query.svpId)) filter.$or.push({ targetUserId: req.query.svpId }); res.json({ success: true, data: await AdminAuditLog.find(filter).sort({ createdAt: -1 }).lean() }); } catch (error) { next(error); } };
exports.reviewReport = async (req, res, next) => { try { const status = String(req.body.status || "").toUpperCase(), comment = String(req.body.comment || "").trim(); const allowed = { SUBMITTED: ["UNDER_REVIEW"], UNDER_REVIEW: ["ACKNOWLEDGED", "ACTION_REQUIRED", "RESOLVED"], ACKNOWLEDGED: ["ACTION_REQUIRED", "RESOLVED", "CLOSED"], ACTION_REQUIRED: ["UNDER_REVIEW", "RESOLVED"], RESOLVED: ["CLOSED", "UNDER_REVIEW"] }; const report = await SVPReport.findById(req.params.id); if (!report) return res.status(404).json({ success: false, message: "Report not found." }); if (!comment || !allowed[report.status]?.includes(status)) return res.status(409).json({ success: false, message: "A comment and valid report transition are required." }); report.status = status; report.headOfficeComments.push({ comment, authorId: actor(req) }); report.history.push({ status, note: comment, actorId: actor(req) }); await report.save(); await audit(req, "SVP_REPORT_REVIEWED", "Reviewed SVP report", report.createdBy, { reportId: report._id, status }); res.json({ success: true, data: report }); } catch (error) { next(error); } };