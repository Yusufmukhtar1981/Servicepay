const Branch = require("../models/branch.model");
const BranchTarget = require("../models/branchTarget.model");
const BranchApprovalRequest = require("../models/branchApprovalRequest.model");
const BranchOperationalRequest = require("../models/branchOperationalRequest.model");
const User = require("../models/user.model");
const AdminAuditLog = require("../models/adminAuditLog.model");
const BranchAuditLog = require("../models/branchAuditLog.model");
const Transaction = require("../models/transaction.model");
const Delivery = require("../models/delivery.model");

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
  const filter = scope ? { branchId: scope } : {};
  const [members, pendingApprovals, openRequests, targets, transactions, deliveries] = await Promise.all([
    User.countDocuments(filter), BranchApprovalRequest.countDocuments({ ...filter, status: { $in: ["SUBMITTED", "PENDING_HEAD_OFFICE"] } }),
    BranchOperationalRequest.countDocuments({ ...filter, status: { $in: ["OPEN", "IN_PROGRESS"] } }), BranchTarget.find(filter).lean(),
    Transaction.countDocuments(filter), Delivery.countDocuments(filter),
  ]);
  res.json({ success: true, dashboard: { branchId: scope, members, pendingApprovals, openRequests, targets, metrics: {
    transactions, users: members, deliveries, solar: null, marketplace: null, phoneFinancing: null, empowerment: null,
  }, unavailableMetrics: ["solar", "marketplace", "phoneFinancing", "empowerment"] } });
};
exports.overview = async (req, res) => {
  const scope = branchScope(req, req.query.branchId); if (scope === false) return deny(res);
  if (scope) return exports.dashboard(req, res);
  const branches = await Branch.find({}).select("_id name code status").lean();
  const rows = await Promise.all(branches.map(async (branch) => ({
    ...branch,
    weight: 1,
    transactions: await Transaction.countDocuments({ branchId: branch._id }),
    members: await User.countDocuments({ branchId: branch._id }),
  })));
  rows.sort((a, b) => (b.transactions * b.weight) - (a.transactions * a.weight));
  res.json({ success: true, overview: { rankings: rows, unavailableMetrics: ["solar", "marketplace", "phoneFinancing", "empowerment"] } });
};
exports.reports = async (req, res) => {
  const scope = branchScope(req, req.query.branchId); if (scope === false) return deny(res);
  // Reporting is read-only and only returns records actually stamped with branchId.
  const filter = scope ? { branchId: scope } : {};
  if (req.query.status) filter.status = String(req.query.status).toUpperCase();
  if (req.query.module) filter.serviceType = String(req.query.module).toUpperCase();
  if (req.query.startDate || req.query.endDate) filter.createdAt = { ...(req.query.startDate ? { $gte: new Date(req.query.startDate) } : {}), ...(req.query.endDate ? { $lte: new Date(req.query.endDate) } : {}) };
  const transactions = await Transaction.find(filter).sort({ createdAt: -1 }).limit(100).lean();
  res.json({ success: true, branchId: scope, count: transactions.length, transactions });
};
exports.targets = async (req, res) => {
  const scope = branchScope(req, req.query.branchId || req.params.branchId); if (scope === false) return deny(res);
  if (req.method === "GET") return res.json({ success: true, targets: await BranchTarget.find({ branchId: scope }).sort({ period: -1 }).lean() });
  if (!moduleAllowed(req, req.body.module)) return res.status(403).json({ success: false, message: "This module is not assigned to your branch." });
  if (!req.staffAccess.isHeadOffice) {
    req.body = { ...req.body, branchId: scope, type: "TARGET_CHANGE", title: `Target change: ${req.body.metric || ""}`, details: req.body };
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
  // Conditional write makes terminal processing idempotent and concurrency-safe.
  const changed = await BranchApprovalRequest.findOneAndUpdate({ _id: request._id, status: { $in: ["SUBMITTED", "PENDING_HEAD_OFFICE"] } }, { status, reviewedBy: id(req), reviewedAt: new Date(), reviewNote: req.body.reviewNote || "" }, { new: true });
  if (!changed) return res.json({ success: true, idempotent: true, request: await BranchApprovalRequest.findById(request._id).lean() });
  await audit(req, "BRANCH_APPROVAL_REVIEWED", `Branch approval ${status.toLowerCase()}.`, { branchId: String(request.branchId), requestId: String(request._id) });
  res.json({ success: true, request: changed });
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