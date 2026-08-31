const Branch = require("../models/branch.model");
const BranchTarget = require("../models/branchTarget.model");
const BranchApprovalRequest = require("../models/branchApprovalRequest.model");
const BranchOperationalRequest = require("../models/branchOperationalRequest.model");
const User = require("../models/user.model");
const AdminAuditLog = require("../models/adminAuditLog.model");
const BranchAuditLog = require("../models/branchAuditLog.model");
const Transaction = require("../models/transaction.model");
const Delivery = require("../models/delivery.model");
const SolarApplication = require("../models/solarApplication.model");
const SolarFinance = require("../models/solarFinance.model");
const SolarPayment = require("../models/solarPayment.model");
const MarketplaceOrder = require("../models/marketplaceOrder.model");
const PhoneApplication = require("../models/phoneApplication.model");
const PhoneFinance = require("../models/phoneFinance.model");
const PhonePayment = require("../models/phonePayment.model");
const EmpowermentOrganization = require("../models/empowermentOrganization.model");
const EmpowermentProgram = require("../models/empowermentProgram.model");
const EmpowermentBeneficiary = require("../models/empowermentBeneficiary.model");
const EmpowermentDisbursement = require("../models/empowermentDisbursement.model");
const mongoose = require("mongoose");

const id = (req) => req.user._id || req.user.id;
const same = (a, b) => String(a) === String(b);
const branchScope = (req, requested) => {
  if (req.staffAccess.isHeadOffice) return requested || null;
  const own = req.staffAccess?.scope?.branchId;
  if (!own || (requested && !same(own, requested))) return false;
  return own;
};
const deny = (res) => res.status(403).json({ success: false, code: "BRANCH_SCOPE_DENIED", message: "This branch is outside your authorized scope." });
const moduleAllowed = (req, module) => {
  if (req.staffAccess.isHeadOffice || !module) return true;
  return (req.branchScope?.assignedModules || []).includes(String(module).trim().toUpperCase());
};
const audit = async (req, action, reason, metadata = {}, before = null, after = null) => {
  const branchId = metadata.branchId || req.branchScope?._id || req.user.branchId;
  if (branchId) await BranchAuditLog.create({ branchId, actorId: id(req), action, reason, metadata, before, after });
};
const page = (req) => Math.max(1, Number(req.query.page) || 1);
const headOffice = (req, res) => req.staffAccess.isHeadOffice || (res.status(403).json({ success: false, message: "Head Office access only." }), false);
const dateFilter = (req) => {
  const range = {};
  if (req.query.startDate) { const date = new Date(req.query.startDate); if (!Number.isNaN(+date)) range.$gte = date; }
  if (req.query.endDate) { const date = new Date(req.query.endDate); if (!Number.isNaN(+date)) { date.setHours(23, 59, 59, 999); range.$lte = date; } }
  return Object.keys(range).length ? { createdAt: range } : {};
};
const scoped = (branchId, req, extra = {}) => ({ branchId, ...dateFilter(req), ...extra });
const groupedStatuses = async (Model, filter) => Object.fromEntries((await Model.aggregate([
  { $match: filter }, { $group: { _id: "$status", count: { $sum: 1 } } },
])).map((row) => [row._id || "UNKNOWN", row.count]));
const countAndSum = async (Model, filter, amount) => {
  const [row] = await Model.aggregate([{ $match: filter }, { $group: { _id: null, count: { $sum: 1 }, value: { $sum: `$${amount}` } } }]);
  return { count: row?.count || 0, value: row?.value || 0 };
};
const safeStatus = (req) => req.query.status ? String(req.query.status).trim().toUpperCase() : null;
const metricsForBranch = async (branchId, req) => {
  // Every query explicitly requires branchId. Legacy null-stamped data is Head
  // Office global history and is intentionally excluded from every branch row.
  const status = safeStatus(req);
  const module = String(req.query.module || "").trim().toUpperCase();
  const include = (name) => !module || module === name;
  const usersFilter = scoped(branchId, req, { ...(status ? { status } : {}), ...(req.query.staffId ? { createdByStaffId: req.query.staffId } : {}) });
  const txFilter = scoped(branchId, req, { ...(status ? { status } : {}), ...(module && !["TRANSACTION", "TRANSACTIONS"].includes(module) ? { serviceType: module } : {}), ...(req.query.staffId ? { agentId: req.query.staffId } : {}) });
  const plain = (extra = {}) => scoped(branchId, req, { ...(status ? { status } : {}), ...extra });
  const result = {
    users: include("USERS") || include("CUSTOMERS") ? await User.countDocuments(usersFilter) : 0,
    staff: await User.countDocuments({ branchId, isStaff: true, ...(status ? { status } : {}) }),
    transactions: include("TRANSACTION") || include("TRANSACTIONS") || (!module) ? await countAndSum(Transaction, txFilter, "amount") : { count: 0, value: 0 },
    deliveries: include("DELIVERY") || include("DELIVERIES") || (!module) ? { ...(await countAndSum(Delivery, plain(req.query.staffId ? { assignedRiderId: req.query.staffId } : {}), "deliveryFee")), statuses: await groupedStatuses(Delivery, plain(req.query.staffId ? { assignedRiderId: req.query.staffId } : {})) } : { count: 0, value: 0, statuses: {} },
    solar: include("SOLAR") || !module ? { applications: await SolarApplication.countDocuments(plain(req.query.staffId ? { assignedOfficer: req.query.staffId } : {})), statuses: await groupedStatuses(SolarApplication, plain(req.query.staffId ? { assignedOfficer: req.query.staffId } : {})), finance: await countAndSum(SolarFinance, plain(), "amountPaid"), payments: await countAndSum(SolarPayment, scoped(branchId, req), "amount") } : { applications: 0, statuses: {}, finance: { count: 0, value: 0 }, payments: { count: 0, value: 0 } },
    marketplace: include("MARKETPLACE") || !module ? { ...(await countAndSum(MarketplaceOrder, plain(), "totalAmount")), statuses: await groupedStatuses(MarketplaceOrder, plain()) } : { count: 0, value: 0, statuses: {} },
    phoneFinancing: include("PHONE") || include("PHONE_FINANCING") || !module ? { applications: await PhoneApplication.countDocuments(plain(req.query.staffId ? { assignedOfficer: req.query.staffId } : {})), statuses: await groupedStatuses(PhoneApplication, plain(req.query.staffId ? { assignedOfficer: req.query.staffId } : {})), finance: await countAndSum(PhoneFinance, plain(), "amountPaid"), payments: await countAndSum(PhonePayment, scoped(branchId, req), "amount") } : { applications: 0, statuses: {}, finance: { count: 0, value: 0 }, payments: { count: 0, value: 0 } },
    empowerment: include("EMPOWERMENT") || !module ? { organizations: await EmpowermentOrganization.countDocuments(plain()), programs: await EmpowermentProgram.countDocuments(plain()), beneficiaries: await EmpowermentBeneficiary.countDocuments(plain()), disbursements: await countAndSum(EmpowermentDisbursement, plain(), "totalAmount"), statuses: await groupedStatuses(EmpowermentDisbursement, plain()) } : { organizations: 0, programs: 0, beneficiaries: 0, disbursements: { count: 0, value: 0 }, statuses: {} },
  };
  result.revenue = result.transactions.value + result.deliveries.value + result.marketplace.value + result.solar.payments.value + result.phoneFinancing.payments.value;
  return result;
};

exports.create = async (req, res) => {
  if (!headOffice(req, res)) return;
  try {
    const required = ["code", "name", "address", "state", "lga", "phone", "email", "openingDate"];
    if (required.some((key) => !String(req.body[key] || "").trim()) || !/^[A-Z0-9_-]{2,32}$/i.test(String(req.body.code || "")) || !Array.isArray(req.body.assignedModules)) {
      return res.status(400).json({ success: false, message: "Code, name, address, state, LGA, phone, email, opening date, and assignedModules are required." });
    }
    const assignedModules = [...new Set(req.body.assignedModules.map((value) => String(value).trim().toUpperCase()).filter(Boolean))];
    const branch = await Branch.create({ code: req.body.code, name: req.body.name, address: req.body.address, state: req.body.state, lga: req.body.lga, phone: req.body.phone, email: req.body.email, openingDate: req.body.openingDate, notes: req.body.notes, assignedModules, latitude: req.body.latitude, longitude: req.body.longitude, createdBy: id(req), updatedBy: id(req) });
    await audit(req, "BRANCH_CREATED", "Branch created.", { branchId: String(branch._id) });
    res.status(201).json({ success: true, branch });
  } catch (error) { res.status(error.code === 11000 ? 409 : 400).json({ success: false, message: error.code === 11000 ? "Branch code already exists." : error.message }); }
};
exports.list = async (req, res) => {
  const scope = branchScope(req, req.query.branchId); if (scope === false) return deny(res);
  const filter = scope ? { _id: scope } : {};
  const branches = await Branch.find(filter).sort({ name: 1 }).lean();
  res.json({ success: true, branches });
};
exports.get = async (req, res) => {
  const scope = branchScope(req, req.params.branchId); if (scope === false) return deny(res);
  const branch = await Branch.findById(req.params.branchId).lean();
  if (!branch) return res.status(404).json({ success: false, message: "Branch not found." });
  const [members, targets, recentApprovals] = await Promise.all([
    User.find({ branchId: branch._id }).select("_id fullName staffId jobTitle department status").lean(),
    BranchTarget.find({ branchId: branch._id }).sort({ endDate: -1 }).limit(20).lean(),
    BranchApprovalRequest.find({ branchId: branch._id }).sort({ createdAt: -1 }).limit(10).lean(),
  ]);
  res.json({ success: true, branch: { ...branch, members, targets, recentApprovals } });
};
exports.update = async (req, res) => {
  if (!headOffice(req, res)) return;
  const allowed = ["name", "address", "state", "lga", "phone", "email", "openingDate", "notes", "assignedModules", "latitude", "longitude"];
  const update = Object.fromEntries(allowed.filter((key) => req.body[key] !== undefined).map((key) => [key, req.body[key]]));
  update.updatedBy = id(req);
  const branch = await Branch.findByIdAndUpdate(req.params.branchId, update, { new: true, runValidators: true });
  if (!branch) return res.status(404).json({ success: false, message: "Branch not found." });
  await audit(req, "BRANCH_UPDATED", "Branch updated.", { branchId: String(branch._id) });
  res.json({ success: true, branch });
};
exports.activate = async (req, res) => {
  if (!headOffice(req, res)) return;
  const requested = String(req.body.status || "ACTIVE").toUpperCase();
  const active = requested === "ACTIVE";
  const branch = await Branch.findByIdAndUpdate(req.params.branchId, { status: active ? "ACTIVE" : requested === "SUSPENDED" ? "SUSPENDED" : "INACTIVE", updatedBy: id(req), ...(active ? { "lifecycle.activatedAt": new Date(), "lifecycle.activatedBy": id(req) } : requested === "SUSPENDED" ? { "lifecycle.suspendedAt": new Date(), "lifecycle.suspendedBy": id(req), "lifecycle.suspensionReason": String(req.body.reason || "").trim() } : { "lifecycle.deactivatedAt": new Date(), "lifecycle.deactivatedBy": id(req) }) }, { new: true });
  if (!branch) return res.status(404).json({ success: false, message: "Branch not found." });
  await audit(req, "BRANCH_ACTIVATED", `Branch ${branch.status.toLowerCase()}.`, { branchId: String(branch._id) });
  res.json({ success: true, branch });
};
exports.assignManager = async (req, res) => {
  if (!headOffice(req, res)) return;
  const branchBefore = await Branch.findById(req.params.branchId); if (!branchBefore) return res.status(404).json({ success: false, message: "Branch not found." });
  if (!req.body.managerId) {
    const previous = branchBefore.managerId;
    branchBefore.managerId = null; await branchBefore.save();
    if (previous) await User.findByIdAndUpdate(previous, { $inc: { authTokenVersion: 1 } });
    await audit(req, "BRANCH_MANAGER_ASSIGNED", "Branch manager removed.", { branchId: String(branchBefore._id) }, { managerId: previous }, { managerId: null });
    return res.json({ success: true, branch: branchBefore });
  }
  const user = await User.findById(req.body.managerId);
  if (!user || user.status !== "ACTIVE" || user.isStaff !== true || String(user.role).toUpperCase() !== "STAFF") return res.status(400).json({ success: false, message: "Manager must be an active STAFF account." });
  const oldBranchId = user.branchId;
  if (oldBranchId && !same(oldBranchId, branchBefore._id)) await Branch.findByIdAndUpdate(oldBranchId, { $pull: { staffIds: user._id }, $set: { managerId: null } });
  if (branchBefore.managerId && !same(branchBefore.managerId, user._id)) await User.findByIdAndUpdate(branchBefore.managerId, { $inc: { authTokenVersion: 1 } });
  const branch = await Branch.findByIdAndUpdate(req.params.branchId, { managerId: user._id, $addToSet: { staffIds: user._id } }, { new: true });
  if (!branch) return res.status(404).json({ success: false, message: "Branch not found." });
  user.branchId = branch._id; user.jobTitle = String(req.body.jobTitle || "BRANCH_MANAGER").trim(); user.authTokenVersion = Number(user.authTokenVersion || 0) + 1; await user.save({ validateBeforeSave: false });
  await audit(req, "BRANCH_MANAGER_ASSIGNED", "Branch manager assigned.", { branchId: String(branch._id), managerId: String(user._id) }, { managerId: branchBefore.managerId, oldBranchId }, { managerId: user._id, jobTitle: user.jobTitle });
  res.json({ success: true, branch });
};
exports.members = async (req, res) => {
  const scope = branchScope(req, req.params.branchId); if (scope === false) return deny(res);
  if (req.method === "GET") return res.json({ success: true, members: await User.find({ branchId: scope }).select("_id fullName staffId jobTitle department status").lean() });
  const managedBranch = await Branch.findById(scope).select("managerId").lean();
  if (!req.staffAccess.isHeadOffice && (!same(req.user.branchId, scope) || !same(managedBranch?.managerId, id(req)))) return deny(res);
  const user = await User.findById(req.body.userId); if (!user) return res.status(404).json({ success: false, message: "User not found." });
  if (!req.staffAccess.isHeadOffice && (!same(user.branchId, scope) || String(user.role).toUpperCase() === "HEAD_OFFICE")) return deny(res);
  if (!req.staffAccess.isHeadOffice && req.body.branchId && !same(req.body.branchId, scope)) return deny(res);
  user.branchId = scope; user.jobTitle = req.body.jobTitle || user.jobTitle; user.createdByStaffId = user.createdByStaffId || id(req); await user.save({ validateBeforeSave: false });
  await Branch.findByIdAndUpdate(scope, { $addToSet: { staffIds: user._id } });
  await audit(req, "BRANCH_MEMBER_ASSIGNED", "Branch member assigned.", { branchId: String(scope), userId: String(user._id) });
  res.json({ success: true, member: user });
};
exports.removeMember = async (req, res) => {
  const scope = branchScope(req, req.params.branchId); if (scope === false) return deny(res);
  const managedBranch = await Branch.findById(scope).select("managerId").lean();
  if (!req.staffAccess.isHeadOffice && !same(managedBranch?.managerId, id(req))) return deny(res);
  const user = await User.findById(req.params.userId); if (!user) return res.status(404).json({ success: false, message: "User not found." });
  if (!same(user.branchId, scope) || (!req.staffAccess.isHeadOffice && String(user.role).toUpperCase() === "HEAD_OFFICE")) return deny(res);
  user.branchId = null; await user.save({ validateBeforeSave: false });
  await Branch.findByIdAndUpdate(scope, { $pull: { staffIds: user._id }, ...(same(user._id, (await Branch.findById(scope).lean())?.managerId) ? { managerId: null } : {}) });
  await audit(req, "BRANCH_MEMBER_ASSIGNED", "Branch member removed.", { branchId: String(scope), userId: String(user._id) });
  res.json({ success: true });
};
exports.createCustomer = async (req, res) => {
  const scope = branchScope(req, req.params.branchId); if (scope === false) return deny(res);
  const fullName = String(req.body.fullName || "").trim();
  const phone = String(req.body.phone || "").trim();
  const password = String(req.body.password || "");
  if (!fullName || !phone || !password) return res.status(400).json({ success: false, message: "Full name, phone and password are required." });
  try {
    // The path-derived authenticated scope is the only accepted branch stamp.
    const customer = await User.create({ fullName, phone, email: req.body.email || undefined, password, role: "CUSTOMER", branchId: scope, onboardingSource: "BRANCH", createdByStaffId: id(req) });
    await audit(req, "BRANCH_MEMBER_ASSIGNED", "Branch customer created.", { branchId: String(scope), customerId: String(customer._id) });
    res.status(201).json({ success: true, customer: { _id: customer._id, fullName: customer.fullName, phone: customer.phone, branchId: customer.branchId } });
  } catch (error) { res.status(error.code === 11000 ? 409 : 400).json({ success: false, message: error.code === 11000 ? "Customer already exists." : error.message }); }
};
exports.dashboard = async (req, res) => {
  const scope = branchScope(req, req.query.branchId); if (scope === false) return deny(res);
  if (!scope) return exports.overview(req, res);
  const base = scoped(scope, req);
  const [metrics, targets, pendingApprovals, approvalStatuses, openRequests] = await Promise.all([
    metricsForBranch(scope, req), BranchTarget.find({ branchId: scope, ...(req.query.module ? { module: String(req.query.module).toUpperCase() } : {}) }).lean(),
    BranchApprovalRequest.countDocuments({ ...base, status: { $in: ["SUBMITTED", "PENDING_HEAD_OFFICE"] } }),
    groupedStatuses(BranchApprovalRequest, base),
    BranchOperationalRequest.countDocuments({ ...base, status: { $in: ["OPEN", "IN_PROGRESS"] } }),
  ]);
  const approvals = { approved: approvalStatuses.APPROVED || 0, rejected: approvalStatuses.REJECTED || 0, correctionRequested: approvalStatuses.CORRECTION_REQUESTED || 0 };
  res.json({ success: true, dashboard: { branchId: scope, members: metrics.staff, pendingApprovals, openRequests, targets, approvalStatuses, approvals, metrics } });
};
exports.overview = async (req, res) => {
  const scope = branchScope(req, req.query.branchId); if (scope === false) return deny(res);
  if (scope) return exports.dashboard(req, res);
  const branches = await Branch.find({}).select("_id name code status").lean();
  const rows = await Promise.all(branches.map(async (branch) => {
    const [metrics, targets, operations] = await Promise.all([
      metricsForBranch(branch._id, req), BranchTarget.find({ branchId: branch._id, ...dateFilter(req) }).lean(),
      BranchOperationalRequest.countDocuments(scoped(branch._id, req, { status: "COMPLETED" })),
    ]);
    const targetAchievement = targets.length ? targets.reduce((total, target) => total + (target.target ? target.actual / target.target : 0), 0) / targets.length : 0;
    // Ranking is transparent: 60% normalized target achievement (not capped,
    // so 120% is credited), 25% completed operations, 15% transaction volume.
    const operationsScore = operations / Math.max(1, metrics.staff);
    const transactionScore = metrics.transactions.count / Math.max(1, metrics.staff);
    return { ...branch, metrics, targets: targets.length, targetAchievement, operations, ranking: { weights: { targetAchievement: .60, operations: .25, transactions: .15 }, score: (.60 * targetAchievement) + (.25 * operationsScore) + (.15 * transactionScore) } };
  }));
  rows.sort((a, b) => b.ranking.score - a.ranking.score);
  res.json({ success: true, overview: { rankings: rows } });
};
exports.reports = async (req, res) => {
  const scope = branchScope(req, req.query.branchId); if (scope === false) return deny(res);
  if (!scope) return res.status(400).json({ success: false, message: "branchId is required for reports." });
  const filter = scoped(scope, req, { ...(safeStatus(req) ? { status: safeStatus(req) } : {}), ...(req.query.module ? { serviceType: String(req.query.module).toUpperCase() } : {}), ...(req.query.staffId ? { agentId: req.query.staffId } : {}) });
  const [transactions, metrics, targets, approvals] = await Promise.all([
    Transaction.find(filter).select("reference serviceType amount status agentId createdAt").sort({ createdAt: -1 }).limit(100).lean(),
    metricsForBranch(scope, req), BranchTarget.find({ branchId: scope, ...dateFilter(req), ...(req.query.module ? { module: String(req.query.module).toUpperCase() } : {}) }).lean(),
    groupedStatuses(BranchApprovalRequest, scoped(scope, req)),
  ]);
  const report = { branchId: scope, count: transactions.length, transactions, metrics, targets, approvals };
  if (["csv", "json"].includes(String(req.query.export || "").toLowerCase())) {
    // Only aggregate/statistical fields and masked transaction references leave
    // the report endpoint; customer, phone, address and provider payloads do not.
    const rows = transactions.map((t) => ({ reference: `${String(t.reference).slice(0, 4)}***`, serviceType: t.serviceType, amount: t.amount, status: t.status, createdAt: t.createdAt }));
    if (String(req.query.export).toLowerCase() === "csv") {
      const csv = ["reference,serviceType,amount,status,createdAt", ...rows.map((r) => [r.reference, r.serviceType, r.amount, r.status, r.createdAt.toISOString()].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
      res.type("text/csv").attachment("branch-report.csv"); return res.send(csv);
    }
    return res.json({ success: true, export: true, report: { ...report, transactions: rows } });
  }
  res.json({ success: true, ...report });
};
exports.targets = async (req, res) => {
  const scope = branchScope(req, req.query.branchId || req.params.branchId); if (scope === false) return deny(res);
  if (req.method === "GET") return res.json({ success: true, targets: await BranchTarget.find({ branchId: scope }).sort({ period: -1 }).lean() });
  if (!moduleAllowed(req, req.body.module)) return res.status(403).json({ success: false, message: "This module is not assigned to your branch." });
  if (!req.staffAccess.isHeadOffice) {
    req.body = { ...req.body, branchId: scope, type: "TARGET_CREATE", title: `Target change: ${req.body.metric || ""}`, details: req.body };
    return exports.submitApproval(req, res);
  }
  const target = await BranchTarget.create({ branchId: scope, module: req.body.module, metric: req.body.metric, period: req.body.period, periodType: req.body.periodType, startDate: req.body.startDate, endDate: req.body.endDate, category: req.body.category, target: req.body.target, actual: req.body.actual || 0, createdBy: id(req) });
  await audit(req, "BRANCH_TARGET_UPDATED", "Branch target created.", { branchId: String(scope), targetId: String(target._id) });
  res.status(201).json({ success: true, target });
};
exports.progress = async (req, res) => {
  const target = await BranchTarget.findById(req.params.targetId); if (!target) return res.status(404).json({ success: false, message: "Target not found." });
  if (branchScope(req, target.branchId) === false) return deny(res);
  if (!req.staffAccess.isHeadOffice) {
    req.body = { ...req.body, branchId: target.branchId, type: "TARGET_PROGRESS_CHANGE", title: `Target progress change: ${target.metric}`, details: { targetId: String(target._id), actual: req.body.actual } };
    return exports.submitApproval(req, res);
  }
  target.actual = Number(req.body.actual); target.updatedBy = id(req); await target.save();
  await audit(req, "BRANCH_TARGET_UPDATED", "Branch target progress updated.", { branchId: String(target.branchId), targetId: String(target._id), status: target.status });
  res.json({ success: true, target, percentage: target.target ? (target.actual / target.target) * 100 : 0 });
};
exports.submitApproval = async (req, res) => {
  const scope = branchScope(req, req.body.branchId); if (scope === false) return deny(res);
  const requestKey = String(req.get("Idempotency-Key") || req.body.requestKey || "").trim();
  if (!requestKey) return res.status(400).json({ success: false, message: "Idempotency-Key is required." });
  const existing = await BranchApprovalRequest.findOne({ branchId: scope, requestKey });
  if (existing) return res.status(200).json({ success: true, idempotent: true, request: existing });
  const request = await BranchApprovalRequest.create({ branchId: scope, requestKey, type: req.body.type, title: req.body.title, details: req.body.details || {}, status: req.body.status === "DRAFT" ? "DRAFT" : "SUBMITTED", requestedBy: id(req) });
  await audit(req, "BRANCH_APPROVAL_SUBMITTED", "Branch approval submitted.", { branchId: String(scope), requestId: String(request._id) });
  res.status(201).json({ success: true, request });
};
exports.approvals = async (req, res) => {
  const scope = branchScope(req, req.query.branchId); if (scope === false) return deny(res);
  const requests = await BranchApprovalRequest.find({ branchId: scope }).sort({ createdAt: -1 }).skip((page(req) - 1) * 50).limit(50).lean();
  res.json({ success: true, requests });
};
exports.reviewApproval = async (req, res) => {
  const request = await BranchApprovalRequest.findById(req.params.requestId); if (!request) return res.status(404).json({ success: false, message: "Approval request not found." });
  if (!req.staffAccess.isHeadOffice) return res.status(403).json({ success: false, message: "Head Office access only." });
  if (branchScope(req, request.branchId) === false) return deny(res);
  if (same(request.requestedBy, id(req))) return res.status(403).json({ success: false, message: "You cannot approve or reject your own request." });
  const status = String(req.body.status || "").toUpperCase(); if (!["APPROVED", "REJECTED", "CORRECTION_REQUESTED"].includes(status)) return res.status(400).json({ success: false, message: "Invalid review status." });
  if (["REJECTED", "CORRECTION_REQUESTED"].includes(status) && !String(req.body.reviewNote || "").trim()) return res.status(400).json({ success: false, message: "A review note is required." });
  const executable = new Set(["TARGET_CREATE", "TARGET_PROGRESS_CHANGE", "BRANCH_CONFIGURATION", "OPERATIONAL_REQUEST"]);
  const execute = async (session, approval) => {
    const details = approval.details || {};
    if (!executable.has(approval.type)) return { executionStatus: "AWAITING_DOMAIN_EXECUTION", executionMetadata: { reason: "Financial or domain action; no funds were moved." } };
    if (details.branchId && !same(details.branchId, approval.branchId)) throw new Error("Approval branch does not match its requested change.");
    if (approval.type === "TARGET_CREATE") {
      const keys = ["module", "metric", "period", "periodType", "startDate", "endDate", "category", "target"];
      if (keys.some((key) => details[key] === undefined || details[key] === "") || !Number.isFinite(Number(details.target)) || Number(details.target) < 0) throw new Error("Invalid target creation details.");
      const branch = await Branch.findById(approval.branchId).select("assignedModules").session(session);
      const module = String(details.module).trim().toUpperCase();
      if (!branch || !(branch.assignedModules || []).includes(module)) throw new Error("Target module is not assigned to this branch.");
      const target = await BranchTarget.create([{ branchId: approval.branchId, module, metric: details.metric, period: details.period, periodType: details.periodType, startDate: details.startDate, endDate: details.endDate, category: details.category, target: Number(details.target), actual: Number(details.actual || 0), createdBy: approval.requestedBy, updatedBy: id(req) }], { session });
      return { executionStatus: "EXECUTED", executionMetadata: { action: approval.type, targetId: String(target[0]._id), before: null, after: target[0].toObject() } };
    }
    if (approval.type === "TARGET_PROGRESS_CHANGE") {
      if (!mongoose.isValidObjectId(details.targetId) || !Number.isFinite(Number(details.actual)) || Number(details.actual) < 0) throw new Error("Invalid target progress details.");
      const target = await BranchTarget.findOne({ _id: details.targetId, branchId: approval.branchId }).session(session);
      if (!target) throw new Error("Target does not belong to this branch.");
      const branch = await Branch.findById(approval.branchId).select("assignedModules").session(session);
      if (!branch || !(branch.assignedModules || []).includes(target.module)) throw new Error("Target module is not assigned to this branch.");
      const before = { actual: target.actual, status: target.status };
      target.actual = Number(details.actual); target.updatedBy = id(req); await target.save({ session });
      return { executionStatus: "EXECUTED", executionMetadata: { action: approval.type, targetId: String(target._id), before, after: { actual: target.actual, status: target.status } } };
    }
    if (approval.type === "BRANCH_CONFIGURATION") {
      const changes = details.changes || details;
      const allowed = ["name", "address", "state", "lga", "phone", "email", "notes", "assignedModules", "latitude", "longitude"];
      const update = Object.fromEntries(allowed.filter((key) => changes[key] !== undefined).map((key) => [key, changes[key]]));
      if (!Object.keys(update).length) throw new Error("No allowed branch configuration changes were supplied.");
      const branch = await Branch.findById(approval.branchId).session(session);
      if (!branch) throw new Error("Branch not found.");
      const before = Object.fromEntries(Object.keys(update).map((key) => [key, branch[key]]));
      Object.assign(branch, update, { updatedBy: id(req) }); await branch.save({ session });
      return { executionStatus: "EXECUTED", executionMetadata: { action: approval.type, before, after: Object.fromEntries(Object.keys(update).map((key) => [key, branch[key]])) } };
    }
    if (/MONEY|PAYMENT|TRANSFER|WITHDRAW|FUND|WALLET/.test(String(details.type || "").toUpperCase())) throw new Error("Financial operational actions must be executed by their owning domain.");
    const created = await BranchOperationalRequest.create([{ branchId: approval.branchId, type: details.type || "APPROVED_OPERATION", title: details.title || approval.title, description: details.description || "", metadata: details.metadata || {}, requestedBy: approval.requestedBy }], { session });
    return { executionStatus: "EXECUTED", executionMetadata: { action: approval.type, operationalRequestId: String(created[0]._id) } };
  };
  try {
    let changed;
    await mongoose.connection.transaction(async (session) => {
      const next = status === "APPROVED" ? (executable.has(request.type) ? "EXECUTING" : "AWAITING_DOMAIN_EXECUTION") : "NOT_APPLICABLE";
      changed = await BranchApprovalRequest.findOneAndUpdate(
        { _id: request._id, status: { $in: ["SUBMITTED", "PENDING_HEAD_OFFICE"] }, executionStatus: "PENDING" },
        { status, reviewedBy: id(req), reviewedAt: new Date(), reviewNote: req.body.reviewNote || "", executionStatus: next },
        { new: true, session }
      );
      if (!changed) return;
      if (status === "APPROVED") {
        const executed = await execute(session, changed);
        changed.executionStatus = executed.executionStatus; changed.executionMetadata = executed.executionMetadata;
        changed.executedAt = executed.executionStatus === "EXECUTED" ? new Date() : null;
        changed.executedBy = executed.executionStatus === "EXECUTED" ? id(req) : null;
        // A successfully applied non-financial action is complete. Financial
        // and other domain-owned approvals deliberately remain APPROVED.
        if (executed.executionStatus === "EXECUTED") changed.status = "COMPLETED";
        await changed.save({ session });
      }
    });
    if (!changed) return res.json({ success: true, idempotent: true, request: await BranchApprovalRequest.findById(request._id).lean() });
    await audit(req, "BRANCH_APPROVAL_REVIEWED", `Branch approval ${status.toLowerCase()}.`, { branchId: String(request.branchId), requestId: String(request._id), executionStatus: changed.executionStatus });
    res.json({ success: true, request: changed });
  } catch (error) { res.status(400).json({ success: false, message: error.message }); }
};
exports.operational = async (req, res) => {
  const scope = branchScope(req, req.body.branchId || req.query.branchId); if (scope === false) return deny(res);
  if (req.method === "GET") return res.json({ success: true, requests: await BranchOperationalRequest.find({ branchId: scope }).sort({ createdAt: -1 }).lean() });
  const sensitive = /MONEY|PAYMENT|TRANSFER|WITHDRAW|FUND|WALLET/.test(String(req.body.type || "").toUpperCase());
  if (sensitive) return exports.submitApproval(req, res); // deliberately creates approval evidence, never a money movement.
  const request = await BranchOperationalRequest.create({ branchId: scope, type: req.body.type, title: req.body.title, description: req.body.description, metadata: req.body.metadata || {}, requestedBy: id(req) });
  await audit(req, "BRANCH_OPERATIONAL_REQUEST_CREATED", "Operational request created.", { branchId: String(scope), requestId: String(request._id) });
  res.status(201).json({ success: true, request });
};
exports.audit = async (req, res) => {
  const scope = branchScope(req, req.query.branchId); if (scope === false) return deny(res);
  const logs = await BranchAuditLog.find(scope ? { branchId: scope } : {}).sort({ createdAt: -1 }).limit(100).lean();
  res.json({ success: true, logs });
};