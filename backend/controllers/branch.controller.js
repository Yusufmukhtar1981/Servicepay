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
const KycProfile = require("../models/kycProfile.model");
const SolarAssignment = require("../models/solarAssignment.model");
const SolarOfficer = require("../models/solarOfficer.model");
const EmpowermentOrganization = require("../models/empowermentOrganization.model");
const EmpowermentProgram = require("../models/empowermentProgram.model");
const EmpowermentBeneficiary = require("../models/empowermentBeneficiary.model");
const EmpowermentDisbursement = require("../models/empowermentDisbursement.model");
const mongoose = require("mongoose");
const crypto = require("crypto");
const { validateStaffPermissions, directRolePermissions } = require("../config/staffPermissions");
const { hasPermission } = require("../middleware/staffPermission.middleware");
const BRANCH_STAFF_JOB_TYPES = new Set([
  "GENERAL_STAFF", "KYC_OFFICER", "DELIVERY_OFFICER", "SOLAR_OFFICER",
  "PHONE_FINANCING_OFFICER", "MARKETPLACE_OFFICER", "SUPPORT_OFFICER",
]);
const branchStaffJobType = (value) => {
  const type = String(value || "GENERAL_STAFF").trim().toUpperCase();
  return BRANCH_STAFF_JOB_TYPES.has(type) ? type : null;
};

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
const lagosDayBoundary = (value, nextDay = false) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
  if (!match) return null;
  const boundary = new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]) + (nextDay ? 1 : 0),
    -1,
  ));
  return Number.isNaN(+boundary) ? null : boundary;
};
const requestedDateRange = (req) => {
  const range = {};
  const start = lagosDayBoundary(req.query.startDate);
  const end = lagosDayBoundary(req.query.endDate, true);
  if (start) range.$gte = start;
  if (end) range.$lt = end;
  return range;
};
const dateFilter = (req) => {
  const range = requestedDateRange(req);
  return Object.keys(range).length ? { createdAt: range } : {};
};
const targetDateFilter = (req) => {
  const range = requestedDateRange(req);
  const filter = {};
  if (range.$gte) filter.endDate = { $gte: range.$gte };
  if (range.$lt) filter.startDate = { $lt: range.$lt };
  return filter;
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
const managerPermissions = () => [...(directRolePermissions.BRANCH_MANAGER || [])];
const managerInput = (body = {}) => {
  if (body.manager || body.newManager) return body.manager || body.newManager;
  const supplied = ["managerFullName", "managerPhone", "managerEmail", "managerPassword", "fullName"]
    .some((key) => body[key] !== undefined);
  return supplied ? {
    fullName: body.managerFullName || body.fullName,
    phone: body.managerPhone,
    email: body.managerEmail,
    password: body.managerPassword,
    permissions: body.managerPermissions,
  } : {};
};
const managerView = (user) => user && ({
  _id: user._id, fullName: user.fullName, phone: user.phone, email: user.email,
  status: user.status, branchId: user.branchId,
  permissions: user.branchManagerPermissions?.length
    ? user.branchManagerPermissions : managerPermissions(),
});
const managerError = (res, status, code, message) =>
  res.status(status).json({ success: false, code, message });
const validateNewManager = (input) => {
  const fullName = String(input.fullName || "").trim();
  const phone = String(input.phone || "").trim();
  const password = String(input.password || generateTemporaryPassword());
  const email = String(input.email || "").trim().toLowerCase();
  if (!fullName || !phone) return { error: "Manager fullName and phone are required." };
  if (phone.length < 10) return { error: "Manager phone must be valid." };
  if (password.length < 6) return { error: "Manager password must contain at least 6 characters." };
  return { fullName, phone, password, email };
};
function generateTemporaryPassword() {
  return `Sp!${crypto.randomBytes(12).toString("base64url")}9a`;
}
const assertManager = (user) =>
  user && user.isStaff === true && ["STAFF", "BRANCH_MANAGER"].includes(String(user.role).toUpperCase());
const can = (req, permission) => req.staffAccess?.isHeadOffice || hasPermission(req.staffAccess, permission);
const dashboardAccess = (req, section) => {
  const permissions = {
    users: "branch.customers.view", staff: "branch.staff.view",
    transactions: "branch.finance.view", deliveries: "branch.delivery.view",
    solar: "branch.solar.view", marketplace: "branch.marketplace.view",
    phoneFinancing: "branch.phone.view", empowerment: "branch.empowerment.view",
    targets: "branch.targets.view", approvals: "branch.approvals.view",
    reports: "branch.reports.view",
  };
  const modules = {
    deliveries: "DELIVERY", solar: "SOLAR", marketplace: "MARKETPLACE",
    phoneFinancing: "PHONE_FINANCING", empowerment: "EMPOWERMENT",
  };
  if (!can(req, permissions[section])) return false;
  if (req.staffAccess?.isHeadOffice || !modules[section]) return true;
  return (req.branchScope?.assignedModules || []).map((v) => String(v).toUpperCase())
    .includes(modules[section]);
};
const permittedRevenue = (req, metrics) => {
  const sections = [
    ["transactions", metrics.transactions?.value],
    ["deliveries", metrics.deliveries?.value],
    ["marketplace", metrics.marketplace?.value],
    ["solar", metrics.solar?.payments?.value],
    ["phoneFinancing", metrics.phoneFinancing?.payments?.value],
  ];
  const permitted = sections.filter(([section]) => dashboardAccess(req, section));
  if (!permitted.length) return null;
  return permitted.reduce((total, [, value]) => total + (Number(value) || 0), 0);
};
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
    const existingManagerId = req.body.managerId;
    const newManager = managerInput(req.body);
    if (existingManagerId && Object.keys(newManager).length) return managerError(res, 400, "MANAGER_INPUT_CONFLICT", "Provide either managerId or a new manager, not both.");
    if (!existingManagerId && !Object.keys(newManager).length) return managerError(res, 400, "MANAGER_REQUIRED", "Provide managerId or a new manager when creating a branch.");
    if (Object.keys(newManager).length && newManager.permissions !== undefined) {
      const result = validateStaffPermissions(newManager.permissions);
      if (!result.valid || result.permissions.some((permission) => !managerPermissions().includes(permission))) {
        return managerError(res, 400, "INVALID_MANAGER_PERMISSIONS", result.message || "Manager permissions must be branch-scoped permissions.");
      }
    }
    let branch; let manager = null;
    let temporaryCredentials = null;
    await mongoose.connection.transaction(async (session) => {
      if (existingManagerId) {
        manager = await User.findById(existingManagerId).session(session);
        if (!assertManager(manager)) throw Object.assign(new Error("Manager must be an internal STAFF or BRANCH_MANAGER account."), { branchCode: "INVALID_MANAGER" });
        if (manager.branchId) throw Object.assign(new Error("Manager is already assigned to another branch; use reassignment."), { branchCode: "MANAGER_ALREADY_ASSIGNED" });
      } else if (Object.keys(newManager).length) {
        const clean = validateNewManager(newManager);
        if (clean.error) throw Object.assign(new Error(clean.error), { branchCode: "INVALID_MANAGER" });
        const duplicate = await User.findOne({ $or: [{ phone: clean.phone }, ...(clean.email ? [{ email: clean.email }] : [])] }).session(session);
        if (duplicate) throw Object.assign(new Error("An account already exists with this manager phone or email."), { branchCode: "MANAGER_CONFLICT" });
        manager = new User({ ...clean, email: clean.email || undefined, role: "BRANCH_MANAGER", isStaff: true, department: "OPERATIONS", status: "ACTIVE", mustChangePassword: true, jobTitle: "BRANCH_MANAGER", staffCreatedBy: id(req), createdByStaffId: id(req), branchManagerPermissions: newManager.permissions !== undefined ? newManager.permissions : managerPermissions() });
        temporaryCredentials = {
          identifier: clean.email || clean.phone,
          email: clean.email || null,
          phone: clean.phone,
          temporaryPassword: clean.password,
        };
      }
      branch = (await Branch.create([{ code: req.body.code, name: req.body.name, address: req.body.address, state: req.body.state, lga: req.body.lga, phone: req.body.phone, email: req.body.email, openingDate: req.body.openingDate, notes: req.body.notes, assignedModules, latitude: req.body.latitude, longitude: req.body.longitude, managerId: manager?._id || null, staffIds: manager ? [manager._id] : [], createdBy: id(req), updatedBy: id(req) }], { session }))[0];
      if (manager) {
        if (String(manager.role).toUpperCase() === "STAFF") {
          manager.branchManagerPreviousRole = manager.role;
          manager.branchManagerPreviousStaffRoleId = manager.staffRoleId || null;
        }
        manager.branchId = branch._id; manager.role = "BRANCH_MANAGER"; manager.isStaff = true;
        manager.jobTitle = "BRANCH_MANAGER";
        manager.authTokenVersion = Number(manager.authTokenVersion || 0) + 1;
        await manager.save({ session, validateBeforeSave: false });
      }
    });
    await audit(req, "BRANCH_CREATED", "Branch created.", { branchId: String(branch._id) });
    res.status(201).json({
      success: true,
      branch,
      manager: managerView(manager),
      ...(temporaryCredentials ? { temporaryCredentials } : {}),
    });
  } catch (error) { res.status(error.code === 11000 || error.branchCode === "MANAGER_CONFLICT" ? 409 : 400).json({ success: false, code: error.code === 11000 ? "BRANCH_CODE_CONFLICT" : error.branchCode, message: error.code === 11000 ? "Branch code already exists." : error.message }); }
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
  const managerId = req.body.managerId;
  if (!managerId) return managerError(res, 400, "MANAGER_ID_REQUIRED", "managerId is required; use DELETE to remove a manager.");
  try {
    let branch; let user; let previous;
    await mongoose.connection.transaction(async (session) => {
      branch = await Branch.findById(req.params.branchId).session(session);
      if (!branch) throw Object.assign(new Error("Branch not found."), { branchStatus: 404 });
      user = await User.findById(managerId).select("+authTokenVersion").session(session);
      if (!assertManager(user) || user.status !== "ACTIVE") throw Object.assign(new Error("Manager must be an active internal STAFF or BRANCH_MANAGER account."), { branchCode: "INVALID_MANAGER" });
      previous = branch.managerId;
      const oldBranchId = user.branchId;
      if (oldBranchId && !same(oldBranchId, branch._id)) {
        const oldBranch = await Branch.findById(oldBranchId).session(session);
        if (oldBranch) {
          oldBranch.staffIds.pull(user._id);
          if (same(oldBranch.managerId, user._id)) oldBranch.managerId = null;
          await oldBranch.save({ session });
        }
      }
      if (previous && !same(previous, user._id)) {
        const priorManager = await User.findById(previous).select("+authTokenVersion").session(session);
        if (priorManager) {
          priorManager.role = priorManager.branchManagerPreviousRole || "STAFF";
          priorManager.staffRoleId = priorManager.branchManagerPreviousStaffRoleId || null;
          priorManager.branchManagerPreviousRole = null; priorManager.branchManagerPreviousStaffRoleId = null;
          priorManager.branchId = null; priorManager.jobTitle = "";
          priorManager.authTokenVersion = Number(priorManager.authTokenVersion || 0) + 1;
          await priorManager.save({ session, validateBeforeSave: false });
        }
      }
      branch.managerId = user._id; branch.staffIds.addToSet(user._id); branch.updatedBy = id(req); await branch.save({ session });
      if (String(user.role).toUpperCase() === "STAFF") {
        user.branchManagerPreviousRole = user.role;
        user.branchManagerPreviousStaffRoleId = user.staffRoleId || null;
      }
      user.branchId = branch._id; user.role = "BRANCH_MANAGER"; user.isStaff = true;
      user.jobTitle = String(req.body.jobTitle || "BRANCH_MANAGER").trim(); user.branchManagerPermissions = user.branchManagerPermissions?.length ? user.branchManagerPermissions : managerPermissions();
      user.authTokenVersion = Number(user.authTokenVersion || 0) + 1; await user.save({ session, validateBeforeSave: false });
    });
    await audit(req, "BRANCH_MANAGER_REASSIGNED", "Branch manager assigned or reassigned.", { branchId: String(branch._id), managerId: String(user._id) }, { managerId: previous }, { managerId: user._id });
    res.json({ success: true, branch, manager: managerView(user) });
  } catch (error) { managerError(res, error.branchStatus || (error.code === 11000 ? 409 : 400), error.branchCode || (error.code === 11000 ? "MANAGER_CONFLICT" : "MANAGER_ASSIGNMENT_FAILED"), error.message); }
};
exports.managerStatus = async (req, res) => {
  if (!headOffice(req, res)) return;
  const status = String(req.body.status || "").trim().toUpperCase();
  if (!["ACTIVE", "SUSPENDED", "BLOCKED"].includes(status)) return managerError(res, 400, "INVALID_MANAGER_STATUS", "Status must be ACTIVE, SUSPENDED, or BLOCKED.");
  const branch = await Branch.findById(req.params.branchId); if (!branch) return managerError(res, 404, "BRANCH_NOT_FOUND", "Branch not found.");
  const manager = branch.managerId && await User.findById(branch.managerId).select("+authTokenVersion");
  if (!manager) return managerError(res, 409, "MANAGER_NOT_ASSIGNED", "This branch has no manager.");
  manager.status = status; manager.authTokenVersion = Number(manager.authTokenVersion || 0) + 1; await manager.save({ validateBeforeSave: false });
  await audit(req, "BRANCH_MANAGER_STATUS_CHANGED", `Manager status changed to ${status}.`, { branchId: String(branch._id), managerId: String(manager._id) });
  res.json({ success: true, manager: managerView(manager) });
};
exports.managerPassword = async (req, res) => {
  if (!headOffice(req, res)) return;
  const password = String(req.body.temporaryPassword ?? req.body.password ?? "");
  if (password.length < 6) return managerError(res, 400, "INVALID_MANAGER_PASSWORD", "Temporary password must contain at least 6 characters.");
  const branch = await Branch.findById(req.params.branchId); const manager = branch?.managerId && await User.findById(branch.managerId).select("+authTokenVersion");
  if (!branch) return managerError(res, 404, "BRANCH_NOT_FOUND", "Branch not found.");
  if (!manager) return managerError(res, 409, "MANAGER_NOT_ASSIGNED", "This branch has no manager.");
  manager.password = password; manager.mustChangePassword = true; manager.passwordChangedAt = new Date(); manager.authTokenVersion = Number(manager.authTokenVersion || 0) + 1; await manager.save();
  await audit(req, "BRANCH_MANAGER_PASSWORD_RESET", "Manager temporary password reset and sessions revoked.", { branchId: String(branch._id), managerId: String(manager._id) });
  res.json({ success: true, message: "Temporary password reset successfully.", manager: managerView(manager) });
};
exports.managerPermissions = async (req, res) => {
  if (!headOffice(req, res)) return;
  const result = validateStaffPermissions(req.body.permissions);
  if (!result.valid || result.permissions.some((permission) => !managerPermissions().includes(permission))) return managerError(res, 400, "INVALID_MANAGER_PERMISSIONS", result.message || "Managers may only receive branch-scoped permissions.");
  const branch = await Branch.findById(req.params.branchId); const manager = branch?.managerId && await User.findById(branch.managerId).select("+authTokenVersion");
  if (!branch) return managerError(res, 404, "BRANCH_NOT_FOUND", "Branch not found.");
  if (!manager) return managerError(res, 409, "MANAGER_NOT_ASSIGNED", "This branch has no manager.");
  manager.branchManagerPermissions = result.permissions; manager.authTokenVersion = Number(manager.authTokenVersion || 0) + 1; await manager.save({ validateBeforeSave: false });
  await audit(req, "BRANCH_MANAGER_PERMISSIONS_UPDATED", "Manager permissions updated and sessions revoked.", { branchId: String(branch._id), managerId: String(manager._id) });
  res.json({ success: true, manager: managerView(manager) });
};
exports.removeManager = async (req, res) => {
  if (!headOffice(req, res)) return;
  try {
    let branch; let manager;
    await mongoose.connection.transaction(async (session) => {
      branch = await Branch.findById(req.params.branchId).session(session);
      if (!branch) throw Object.assign(new Error("Branch not found."), { branchStatus: 404 });
      if (!branch.managerId) throw Object.assign(new Error("This branch has no manager."), { branchCode: "MANAGER_NOT_ASSIGNED", branchStatus: 409 });
      manager = await User.findById(branch.managerId).select("+authTokenVersion").session(session);
      branch.staffIds.pull(branch.managerId); branch.managerId = null; branch.updatedBy = id(req); await branch.save({ session });
      if (manager) {
        manager.branchId = null; manager.role = manager.branchManagerPreviousRole || "STAFF";
        manager.staffRoleId = manager.branchManagerPreviousStaffRoleId || null;
        manager.branchManagerPreviousRole = null; manager.branchManagerPreviousStaffRoleId = null;
        manager.jobTitle = ""; manager.authTokenVersion = Number(manager.authTokenVersion || 0) + 1;
        await manager.save({ session, validateBeforeSave: false });
      }
    });
    await audit(req, "BRANCH_MANAGER_REMOVED", "Branch manager removed and sessions revoked.", { branchId: String(branch._id), managerId: String(manager?._id || "") });
    res.json({ success: true, branch });
  } catch (error) { managerError(res, error.branchStatus || 400, error.branchCode || "MANAGER_REMOVAL_FAILED", error.message); }
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
  if (same(user._id, managedBranch?.managerId)) {
    return managerError(res, 409, "MANAGER_REMOVAL_REQUIRES_LIFECYCLE", "Use the branch manager removal endpoint to remove the assigned manager.");
  }
  user.branchId = null; await user.save({ validateBeforeSave: false });
  await Branch.findByIdAndUpdate(scope, { $pull: { staffIds: user._id }, ...(same(user._id, (await Branch.findById(scope).lean())?.managerId) ? { managerId: null } : {}) });
  await audit(req, "BRANCH_MEMBER_ASSIGNED", "Branch member removed.", { branchId: String(scope), userId: String(user._id) });
  res.json({ success: true });
};
const staffView = (user) => ({
  _id: user._id, fullName: user.fullName, phone: user.phone, email: user.email || null,
  department: user.department || null, jobTitle: user.jobTitle || "", status: user.status,
  branchId: user.branchId, staffId: user.staffId || null, createdAt: user.createdAt,
});
const solarOfficerBranch = async (branchId, session) => {
  const branch = await Branch.findById(branchId).select("state lga address")
    .session(session || null).lean();
  if (!branch?.state || !branch?.lga || !branch?.address) {
    throw new Error("The branch must have state, LGA and address before creating a Solar Officer.");
  }
  return branch;
};
const syncSolarOfficerProfile = async (staff, actorId, session, branchLocation) => {
  if (staff.jobTitle !== "SOLAR_OFFICER") return;
  const branch = branchLocation || await solarOfficerBranch(staff.branchId, session);
  await SolarOfficer.findOneAndUpdate(
    { user: staff._id },
    {
      $set: {
        branchId: staff.branchId,
        state: branch.state,
        lga: branch.lga,
        address: branch.address,
        status: staff.status === "ACTIVE" ? "ACTIVE" : "INACTIVE",
      },
      $setOnInsert: {
        officerId: `SOL-${String(staff._id).slice(-8).toUpperCase()}`,
        createdBy: actorId,
      },
    },
    { upsert: true, returnDocument: "after", runValidators: true, session },
  );
};
const branchStaffAccess = async (req, res) => {
  const scope = branchScope(req, req.params.branchId);
  if (scope === false) { deny(res); return null; }
  const branch = await Branch.findById(scope).select("_id managerId status").lean();
  if (!branch) { managerError(res, 404, "BRANCH_NOT_FOUND", "Branch not found."); return null; }
  // A branch manager must still be the manager recorded for this specific branch.
  if (!req.staffAccess.isHeadOffice && (!same(branch.managerId, id(req)) || !same(req.user.branchId, scope))) {
    deny(res); return null;
  }
  return { scope, branch };
};
const managedStaff = async (req, res, scope) => {
  const user = await User.findById(req.params.staffId).select("+authTokenVersion");
  if (!user) { managerError(res, 404, "STAFF_NOT_FOUND", "Staff member not found."); return null; }
  const branch = await Branch.findById(scope).select("managerId").lean();
  if (
    !same(user.branchId, scope) ||
    user.isStaff !== true ||
    same(user._id, branch?.managerId) ||
    ["HEAD_OFFICE", "BRANCH_MANAGER"].includes(String(user.role).toUpperCase())
  ) {
    deny(res); return null;
  }
  return user;
};
exports.staff = async (req, res) => {
  const access = await branchStaffAccess(req, res); if (!access) return;
  if (req.method === "GET") {
    const status = String(req.query.status || "").trim().toUpperCase();
    const search = String(req.query.search || "").trim();
    if (status && !["ACTIVE", "SUSPENDED", "BLOCKED"].includes(status)) return managerError(res, 400, "INVALID_STAFF_STATUS", "Status must be ACTIVE, SUSPENDED, or BLOCKED.");
    const filter = {
      branchId: access.scope,
      isStaff: true,
      _id: { $ne: access.branch.managerId },
      role: { $nin: ["HEAD_OFFICE", "BRANCH_MANAGER"] },
      ...(status ? { status } : {}),
    };
    if (search) filter.$or = ["fullName", "phone", "email", "department", "jobTitle", "staffId"].map((field) => ({ [field]: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } }));
    const staff = await User.find(filter).select("_id fullName phone email department jobTitle status branchId staffId createdAt").sort({ fullName: 1 }).lean();
    return res.json({ success: true, staff });
  }
  const fullName = String(req.body.fullName || "").trim();
  const phone = String(req.body.phone || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const department = String(req.body.department || "").trim().toUpperCase() || null;
  const jobTitle = branchStaffJobType(req.body.jobTitle);
  const password = String(req.body.temporaryPassword ?? req.body.password ?? generateTemporaryPassword());
  if (!fullName || !phone) return managerError(res, 400, "INVALID_STAFF_INPUT", "Staff fullName and phone are required.");
  if (!jobTitle) return managerError(res, 400, "INVALID_STAFF_JOB_TYPE", "Select a supported branch staff job type.");
  if (phone.length < 10 || password.length < 6) return managerError(res, 400, "INVALID_STAFF_INPUT", "Provide a valid phone and a temporary password of at least 6 characters.");
  try {
    const location = jobTitle === "SOLAR_OFFICER" ? await solarOfficerBranch(access.scope) : null;
    const session = await mongoose.startSession();
    let staff;
    try {
      await session.withTransaction(async () => {
        [staff] = await User.create([{ fullName, phone, email: email || undefined, password, department, jobTitle, role: "STAFF", isStaff: true, branchId: access.scope, staffCreatedBy: id(req), createdByStaffId: id(req), mustChangePassword: true, status: "ACTIVE" }], { session });
        await syncSolarOfficerProfile(staff, id(req), session, location);
        await Branch.findByIdAndUpdate(access.scope, { $addToSet: { staffIds: staff._id } }, { session });
      });
    } finally { await session.endSession(); }
    await audit(req, "BRANCH_STAFF_CREATED", "Branch staff account created.", { branchId: String(access.scope), staffId: String(staff._id) });
    return res.status(201).json({ success: true, staff: staffView(staff), temporaryCredentials: { identifier: email || phone, email: email || null, phone, temporaryPassword: password } });
  } catch (error) {
    return managerError(res, error.code === 11000 ? 409 : 400, error.code === 11000 ? "STAFF_CONFLICT" : "INVALID_STAFF_INPUT", error.code === 11000 ? "An account already exists with this staff phone or email." : error.message);
  }
};
exports.updateStaff = async (req, res) => {
  const access = await branchStaffAccess(req, res); if (!access) return;
  const staff = await managedStaff(req, res, access.scope); if (!staff) return;
  const previousJobTitle = staff.jobTitle;
  const allowed = ["fullName", "phone", "email", "department", "jobTitle"];
  if (req.body.jobTitle !== undefined && !branchStaffJobType(req.body.jobTitle)) {
    return managerError(res, 400, "INVALID_STAFF_JOB_TYPE", "Select a supported branch staff job type.");
  }
  const proposedJobTitle = req.body.jobTitle === undefined
    ? previousJobTitle
    : branchStaffJobType(req.body.jobTitle);
  let solarLocation = null;
  if (proposedJobTitle === "SOLAR_OFFICER") {
    try { solarLocation = await solarOfficerBranch(access.scope); }
    catch (error) { return managerError(res, 400, "INVALID_STAFF_INPUT", error.message); }
  }
  if (previousJobTitle === "SOLAR_OFFICER" && proposedJobTitle !== "SOLAR_OFFICER") {
    const profile = await SolarOfficer.findOne({ user: staff._id, branchId: access.scope }).select("_id").lean();
    if (profile && await SolarAssignment.exists({ officer: profile._id, branchId: access.scope, status: "ACTIVE" })) {
      return managerError(res, 409, "SOLAR_OFFICER_HAS_ACTIVE_ASSIGNMENTS", "Reassign or end this officer's active Solar workloads before changing their job type.");
    }
  }
  for (const key of allowed) if (req.body[key] !== undefined) {
    staff[key] = key === "email" ? String(req.body[key] || "").trim().toLowerCase() || undefined
      : key === "department" ? String(req.body[key] || "").trim().toUpperCase() || null
        : key === "jobTitle" ? branchStaffJobType(req.body[key])
          : String(req.body[key] || "").trim();
  }
  if (!String(staff.fullName || "").trim() || !String(staff.phone || "").trim() || String(staff.phone).length < 10) return managerError(res, 400, "INVALID_STAFF_INPUT", "Staff fullName and a valid phone are required.");
  try {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        if (previousJobTitle === "SOLAR_OFFICER" && staff.jobTitle !== "SOLAR_OFFICER") {
          const profile = await SolarOfficer.findOne({
            user: staff._id, branchId: access.scope,
          }).select("_id status authorizationVersion").session(session).lean();
          if (profile && await SolarAssignment.exists({
            officer: profile._id, branchId: access.scope, status: "ACTIVE",
          }).session(session)) {
            const error = new Error("Reassign or end this officer's active Solar workloads before changing their job type.");
            error.statusCode = 409; error.codeName = "SOLAR_OFFICER_HAS_ACTIVE_ASSIGNMENTS";
            throw error;
          }
          if (profile?.status === "ACTIVE") {
            const retired = await SolarOfficer.updateOne({
              _id: profile._id, status: "ACTIVE",
              authorizationVersion: Number(profile.authorizationVersion || 0),
            }, {
              $set: { status: "INACTIVE" },
              $inc: { authorizationVersion: 1 },
            }, { session });
            if (retired.modifiedCount !== 1) {
              const error = new Error("Solar Officer authorization changed; retry the update.");
              error.statusCode = 409; error.codeName = "SOLAR_OFFICER_CONFLICT";
              throw error;
            }
          }
        }
        await staff.save({ session });
        await syncSolarOfficerProfile(staff, id(req), session, solarLocation);
      });
    } finally { await session.endSession(); }
    await audit(req, "BRANCH_STAFF_UPDATED", "Branch staff details updated.", { branchId: String(access.scope), staffId: String(staff._id) });
    return res.json({ success: true, staff: staffView(staff) });
  } catch (error) { return managerError(res, error.statusCode || (error.code === 11000 ? 409 : 400), error.codeName || (error.code === 11000 ? "STAFF_CONFLICT" : "INVALID_STAFF_INPUT"), error.code === 11000 ? "An account already exists with this staff phone or email." : error.message); }
};
exports.staffStatus = async (req, res) => {
  const access = await branchStaffAccess(req, res); if (!access) return;
  const staff = await managedStaff(req, res, access.scope); if (!staff) return;
  const status = String(req.body.status || "").trim().toUpperCase();
  if (!["ACTIVE", "SUSPENDED", "BLOCKED"].includes(status)) return managerError(res, 400, "INVALID_STAFF_STATUS", "Status must be ACTIVE, SUSPENDED, or BLOCKED.");
  staff.status = status; staff.authTokenVersion = Number(staff.authTokenVersion || 0) + 1;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await staff.save({ validateBeforeSave: false, session });
      await SolarOfficer.updateOne(
        { user: staff._id, branchId: access.scope },
        { $set: { status: status === "ACTIVE" ? "ACTIVE" : "INACTIVE" } },
        { session },
      );
    });
  } catch (error) {
    return managerError(res, 400, "STAFF_STATUS_SYNC_FAILED", error.message);
  } finally { await session.endSession(); }
  await audit(req, "BRANCH_STAFF_STATUS_CHANGED", `Staff status changed to ${status}.`, { branchId: String(access.scope), staffId: String(staff._id) });
  return res.json({ success: true, staff: staffView(staff) });
};
exports.staffPasswordReset = async (req, res) => {
  const access = await branchStaffAccess(req, res); if (!access) return;
  const staff = await managedStaff(req, res, access.scope); if (!staff) return;
  const password = String(req.body.temporaryPassword ?? req.body.password ?? generateTemporaryPassword());
  if (password.length < 6) return managerError(res, 400, "INVALID_STAFF_PASSWORD", "Temporary password must contain at least 6 characters.");
  staff.password = password; staff.mustChangePassword = true; staff.passwordChangedAt = new Date(); staff.authTokenVersion = Number(staff.authTokenVersion || 0) + 1; await staff.save();
  await audit(req, "BRANCH_STAFF_PASSWORD_RESET", "Staff temporary password reset and sessions revoked.", { branchId: String(access.scope), staffId: String(staff._id) });
  return res.json({ success: true, staff: staffView(staff), temporaryCredentials: { identifier: staff.email || staff.phone, email: staff.email || null, phone: staff.phone, temporaryPassword: password } });
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
// Customer records are always resolved from the authenticated branch scope,
// never a branch id supplied by the client.
exports.customers = async (req, res) => {
  const scope = branchScope(req); if (!scope) return deny(res);
  const search = String(req.query.search || "").trim();
  const status = safeStatus(req);
  const filter = { branchId: scope, isStaff: { $ne: true }, role: "CUSTOMER", ...(status ? { status } : {}) };
  if (search) {
    const value = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = ["fullName", "phone", "email"].map((field) => ({ [field]: { $regex: value, $options: "i" } }));
  }
  const customers = await User.find(filter)
    .select("_id fullName phone email status kycLevel createdAt updatedAt")
    .sort({ createdAt: -1 }).limit(100).lean();
  res.json({ success: true, customers });
};
exports.customer = async (req, res) => {
  const scope = branchScope(req); if (!scope) return deny(res);
  if (!mongoose.isValidObjectId(req.params.customerId)) {
    return res.status(400).json({ success: false, message: "Invalid customer ID." });
  }
  const customer = await User.findOne({
    _id: req.params.customerId, branchId: scope, isStaff: { $ne: true }, role: "CUSTOMER",
  }).select("_id fullName phone email status kycLevel createdAt updatedAt").lean();
  if (!customer) return res.status(404).json({ success: false, message: "Customer not found." });
  const activity = await Transaction.find({ branchId: scope, customerId: customer._id })
    .select("reference serviceType amount status createdAt").sort({ createdAt: -1 }).limit(30).lean();
  res.json({ success: true, customer, activity });
};
exports.transactions = async (req, res) => {
  const scope = branchScope(req); if (!scope) return deny(res);
  const status = safeStatus(req);
  const search = String(req.query.search || "").trim();
  const serviceType = String(req.query.serviceType || "").trim().toUpperCase();
  const filter = scoped(scope, req, {
    ...(status ? { status } : {}),
    ...(serviceType ? { serviceType } : {}),
  });
  if (search) {
    const value = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = ["reference", "serviceType"].map((field) => ({ [field]: { $regex: value, $options: "i" } }));
  }
  const transactions = await Transaction.find(filter)
    .select("_id reference serviceType amount status createdAt customerId agentId")
    .sort({ createdAt: -1 }).limit(Math.min(100, Math.max(1, Number(req.query.limit) || 50))).lean();
  res.json({ success: true, transactions });
};
exports.officers = async (req, res) => {
  const scope = branchScope(req); if (!scope) return deny(res);
  // Officers remain STAFF accounts. These labels are job assignments only and
  // deliberately cannot turn a branch user into a privileged platform role.
  const officerTitles = [...BRANCH_STAFF_JOB_TYPES].filter((type) => type !== "GENERAL_STAFF");
  const officers = await User.find({
    branchId: scope, isStaff: true, role: "STAFF",
    jobTitle: { $in: officerTitles },
  }).select("_id fullName phone email status department jobTitle staffId createdAt").sort({ fullName: 1 }).lean();
  const rows = await Promise.all(officers.map(async (officer) => {
    const solarProfile = await SolarOfficer.findOne({ user: officer._id, branchId: scope }).select("_id").lean();
    const [kyc, delivery, phone, marketplace, solar] = await Promise.all([
      KycProfile.countDocuments({ assignedOfficer: officer._id, assignmentState: "ACTIVE" }),
      Delivery.countDocuments({ branchId: scope, assignedRiderId: officer._id, status: { $nin: ["DELIVERED", "CANCELLED", "FAILED"] } }),
      PhoneApplication.countDocuments({ branchId: scope, assignedOfficer: officer._id, assignmentState: "ACTIVE" }),
      MarketplaceOrder.countDocuments({ branchId: scope, assignedSupportOfficer: officer._id }),
      solarProfile ? SolarAssignment.countDocuments({ branchId: scope, officer: solarProfile._id, status: "ACTIVE" }) : 0,
    ]);
    return { ...officer, workload: { kyc, delivery, solar, phone, marketplace, total: kyc + delivery + solar + phone + marketplace } };
  }));
  res.json({ success: true, officers: rows, supportedJobTypes: officerTitles });
};
exports.riders = async (req, res) => {
  const scope = branchScope(req); if (!scope) return deny(res);
  const search = String(req.query.search || "").trim();
  const status = safeStatus(req);
  const filter = { branchId: scope, role: "DELIVERY_RIDER", ...(status ? { status } : {}) };
  if (search) {
    const value = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = ["fullName", "phone", "riderId"].map((field) => ({ [field]: { $regex: value, $options: "i" } }));
  }
  const riders = await User.find(filter).select("_id fullName phone riderId status riderVerificationStatus availabilityStatus vehicleType riderRating createdAt").sort({ fullName: 1 }).limit(100).lean();
  res.json({ success: true, riders });
};
exports.rider = async (req, res) => {
  const scope = branchScope(req); if (!scope) return deny(res);
  if (!mongoose.isValidObjectId(req.params.riderId)) return res.status(400).json({ success: false, message: "Invalid rider ID." });
  const rider = await User.findOne({ _id: req.params.riderId, branchId: scope, role: "DELIVERY_RIDER" }).select("_id fullName phone riderId status riderVerificationStatus availabilityStatus vehicleType riderRating").lean();
  if (!rider) return res.status(404).json({ success: false, message: "Rider not found." });
  const activity = await Delivery.find({ branchId: scope, assignedRiderId: rider._id }).select("_id trackingNumber status assignedAt deliveredAt").sort({ updatedAt: -1 }).limit(30).lean();
  res.json({ success: true, rider, activity, withdrawals: [] });
};
exports.availableRiders = async (req, res) => {
  const scope = branchScope(req); if (!scope) return deny(res);
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid delivery ID." });
  const delivery = await Delivery.findOne({ _id: req.params.id, branchId: scope })
    .select("status assignedRiderId riderAcceptedAt").lean();
  if (!delivery) return res.status(404).json({ success: false, message: "Delivery was not found." });
  const assignable = (delivery.status === "PENDING" && !delivery.assignedRiderId) ||
    (delivery.status === "ASSIGNED" && delivery.assignedRiderId && !delivery.riderAcceptedAt);
  if (!assignable) return res.status(409).json({ success: false, message: "This delivery is not available for rider assignment." });
  const riders = await User.find({ branchId: scope, role: "DELIVERY_RIDER", status: "ACTIVE", riderVerificationStatus: "VERIFIED", availabilityStatus: "ONLINE", _id: { $ne: delivery.assignedRiderId || null } })
    .select("_id riderId fullName vehicleType availabilityStatus riderRating").sort({ riderRating: -1 }).limit(100).lean();
  res.json({ success: true, riders });
};
exports.kyc = async (req, res) => {
  const scope = branchScope(req); if (!scope) return deny(res);
  const customers = await User.find({
    branchId: scope, isStaff: { $ne: true }, role: "CUSTOMER",
  }).select("_id fullName phone email").lean();
  const ids = customers.map((customer) => customer._id);
  const profiles = await KycProfile.find({ user: { $in: ids } })
    .select("user level requestedLevel status assignedOfficer assignmentState assignedAt assignmentVersion updatedAt createdAt")
    .populate("assignedOfficer", "fullName jobTitle status").lean();
  const identity = new Map(customers.map((customer) => [String(customer._id), customer]));
  res.json({ success: true, applications: profiles.map((profile) => ({
    _id: profile._id, ...profile, customer: identity.get(String(profile.user)) || null,
  })) });
};
exports.solarApplications = async (req, res) => {
  const scope = branchScope(req); if (!scope) return deny(res);
  const applications = await SolarApplication.find({ branchId: scope })
    .select("_id status customer package branchId depositRequired depositPaid totalPayable amountPaid outstandingBalance installation createdAt updatedAt").populate("customer", "fullName phone").populate("package", "name").sort({ createdAt: -1 }).limit(100).lean();
  const assignments = await SolarAssignment.find({ branchId: scope, application: { $in: applications.map((row) => row._id) }, status: "ACTIVE" })
    .populate({ path: "officer", select: "officerId status user", populate: { path: "user", select: "fullName jobTitle status" } }).lean();
  const byApplication = new Map(assignments.map((row) => [String(row.application), row]));
  res.json({ success: true, applications: applications.map((row) => ({ ...row, activeAssignment: byApplication.get(String(row._id)) || null })) });
};
exports.phoneApplications = async (req, res) => {
  const scope = branchScope(req); if (!scope) return deny(res);
  const applications = await PhoneApplication.find({ branchId: scope })
    .select("_id customer product status assignedOfficer assignmentState assignmentVersion createdAt updatedAt")
    .populate("customer", "fullName phone").populate("product", "name").sort({ createdAt: -1 }).limit(100).lean();
  res.json({ success: true, applications });
};
exports.marketplaceOrders = async (req, res) => {
  const scope = branchScope(req); if (!scope) return deny(res);
  const orders = await MarketplaceOrder.find({ branchId: scope })
    .select("_id orderReference orderStatus totalAmount buyer customerName assignedSupportOfficer supportAssignedAt supportAssignmentVersion createdAt updatedAt")
    .populate("buyer", "fullName phone").populate("assignedSupportOfficer", "fullName jobTitle status").sort({ createdAt: -1 }).limit(100).lean();
  res.json({ success: true, orders });
};
const branchOfficer = (branchId, officerId, jobTypes) => User.findOne({
  _id: officerId, branchId, role: "STAFF", isStaff: true, status: "ACTIVE",
  jobTitle: { $in: jobTypes },
});
exports.assignKycOfficer = async (req, res) => {
  const scope = branchScope(req); if (!scope) return deny(res);
  const profile = await KycProfile.findById(req.params.profileId);
  const customer = profile && await User.findOne({ _id: profile.user, branchId: scope, role: "CUSTOMER" }).select("_id").lean();
  if (!profile || !customer) return res.status(404).json({ success: false, message: "Branch KYC application not found." });
  const officer = await branchOfficer(scope, req.body.officerId, ["KYC_OFFICER"]);
  if (!officer) return res.status(409).json({ success: false, message: "Select an active KYC Officer from this branch." });
  const now = new Date(); const version = Number(profile.assignmentVersion || 0) + 1;
  profile.assignedOfficer = officer._id; profile.assignmentState = "ACTIVE"; profile.assignedAt = now;
  profile.assignedBy = id(req); profile.assignmentVersion = version;
  profile.assignmentHistory.push({ officer: officer._id, assignedBy: id(req), assignedAt: now, version });
  await profile.save();
  res.json({ success: true, application: profile });
};
exports.assignMarketplaceOfficer = async (req, res) => {
  const scope = branchScope(req); if (!scope) return deny(res);
  const officer = await branchOfficer(scope, req.body.officerId, ["MARKETPLACE_OFFICER", "SUPPORT_OFFICER"]);
  if (!officer) return res.status(409).json({ success: false, message: "Select an active Marketplace or Support Officer from this branch." });
  const order = await MarketplaceOrder.findOneAndUpdate(
    { _id: req.params.orderId, branchId: scope },
    { $set: { assignedSupportOfficer: officer._id, supportAssignedAt: new Date(), supportAssignedBy: id(req) }, $inc: { supportAssignmentVersion: 1 } },
    { returnDocument: "after", runValidators: true },
  );
  if (!order) return res.status(404).json({ success: false, message: "Branch order not found." });
  res.json({ success: true, order });
};
exports.assignPhoneOfficer = async (req, res) => {
  const scope = branchScope(req); if (!scope) return deny(res);
  const officer = await branchOfficer(scope, req.body.officerId, ["PHONE_FINANCING_OFFICER"]);
  if (!officer) return res.status(409).json({ success: false, message: "Select an active Phone Financing Officer from this branch." });
  const application = await PhoneApplication.findOneAndUpdate(
    { _id: req.params.applicationId, branchId: scope },
    { $set: { assignedOfficer: officer._id, assignmentState: "ACTIVE", assignmentSnapshot: { officerId: officer._id, assignedBy: id(req), assignedAt: new Date() } }, $inc: { assignmentVersion: 1 } },
    { returnDocument: "after", runValidators: true },
  );
  if (!application) return res.status(404).json({ success: false, message: "Branch phone application not found." });
  res.json({ success: true, application });
};
exports.assignSolarOfficer = async (req, res) => {
  const scope = branchScope(req); if (!scope) return deny(res);
  const session = await mongoose.startSession(); let assignment;
  try {
    await session.withTransaction(async () => {
      const application = await SolarApplication.findOne({ _id: req.params.applicationId, branchId: scope }).select("_id customer").session(session).lean();
      if (!application) throw Object.assign(new Error("Branch Solar application not found."), { statusCode: 404 });
      const officer = await SolarOfficer.findOne({ user: req.body.officerId, branchId: scope, status: "ACTIVE" })
        .select("_id user authorizationVersion").session(session).lean();
      const linked = officer && await User.findOne({
        _id: officer.user, branchId: scope, role: "STAFF", isStaff: true,
        status: "ACTIVE", jobTitle: "SOLAR_OFFICER",
      }).select("_id").session(session).lean();
      if (!officer || !linked) throw Object.assign(new Error("Select an active Solar Officer profile linked to active Solar staff in this branch."), { statusCode: 409 });
      const leased = await SolarOfficer.updateOne({
        _id: officer._id, status: "ACTIVE",
        authorizationVersion: Number(officer.authorizationVersion || 0),
      }, { $inc: { authorizationVersion: 1 } }, { session });
      if (leased.modifiedCount !== 1) throw Object.assign(new Error("Solar Officer authorization changed; retry assignment."), { statusCode: 409 });
      await SolarAssignment.updateMany({ application: application._id, status: "ACTIVE" }, { $set: { status: "REASSIGNED", endedAt: new Date() } }, { session });
      [assignment] = await SolarAssignment.create([{ branchId: scope, application: application._id, customer: application.customer, officer: officer._id, assignedBy: id(req) }], { session });
    });
    return res.status(201).json({ success: true, assignment });
  } catch (error) {
    return res.status(error.statusCode || (error.code === 11000 ? 409 : 500)).json({ success: false, message: error.message || "Unable to assign Solar Officer." });
  } finally { await session.endSession(); }
};
exports.dashboard = async (req, res) => {
  const scope = branchScope(req, req.query.branchId); if (scope === false) return deny(res);
  if (!scope) return exports.overview(req, res);
  const base = scoped(scope, req);
  const [metrics, targets, pendingApprovals, approvalStatuses, openRequests, staff, branch] = await Promise.all([
    metricsForBranch(scope, req), BranchTarget.find({ branchId: scope, ...targetDateFilter(req), ...(req.query.module ? { module: String(req.query.module).toUpperCase() } : {}) }).lean(),
    BranchApprovalRequest.countDocuments({ ...base, status: { $in: ["SUBMITTED", "PENDING_HEAD_OFFICE"] } }),
    groupedStatuses(BranchApprovalRequest, base),
    BranchOperationalRequest.countDocuments({ ...base, status: { $in: ["OPEN", "IN_PROGRESS"] } }),
    User.find({ branchId: scope, isStaff: true }).select("_id fullName staffId jobTitle department status role lastStaffLoginAt").sort({ fullName: 1 }).lean(),
    Branch.findById(scope).select("_id code name status state lga assignedModules managerId openingDate").lean(),
  ]);
  const visibleRevenue = permittedRevenue(req, metrics);
  for (const section of ["users", "staff", "transactions", "deliveries", "solar", "marketplace", "phoneFinancing", "empowerment"]) {
    if (!dashboardAccess(req, section)) delete metrics[section];
  }
  if (visibleRevenue === null) delete metrics.revenue;
  else metrics.revenue = visibleRevenue;
  const approvals = { approved: approvalStatuses.APPROVED || 0, rejected: approvalStatuses.REJECTED || 0, correctionRequested: approvalStatuses.CORRECTION_REQUESTED || 0 };
  const dashboard = {
    branchId: scope,
    branch: branch && { id: branch._id, code: branch.code, name: branch.name, status: branch.status, state: branch.state, lga: branch.lga, assignedModules: branch.assignedModules || [], managerId: branch.managerId, openingDate: branch.openingDate },
    period: { startDate: req.query.startDate || null, endDate: req.query.endDate || null, module: req.query.module || null, status: safeStatus(req) },
    metrics,
  };
  if (dashboardAccess(req, "staff")) { dashboard.members = metrics.staff || 0; dashboard.staff = staff; }
  if (dashboardAccess(req, "targets")) dashboard.targets = targets;
  if (dashboardAccess(req, "approvals")) {
    dashboard.pendingApprovals = pendingApprovals; dashboard.openRequests = openRequests;
    dashboard.approvalStatuses = approvalStatuses; dashboard.approvals = approvals;
  }
  if (dashboardAccess(req, "reports")) dashboard.report = { metrics, period: dashboard.period };
  res.json({ success: true, dashboard });
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
  if (!scope) return res.status(400).json({ success: false, code: "BRANCH_ID_REQUIRED", message: "branchId is required for an approval request." });
  const branch = await Branch.findById(scope).select("_id status").lean();
  if (!branch) return res.status(404).json({ success: false, code: "BRANCH_NOT_FOUND", message: "Branch not found." });
  if (!req.staffAccess.isHeadOffice && branch.status !== "ACTIVE") return res.status(403).json({ success: false, code: "BRANCH_INACTIVE", message: "Approval requests require an active branch." });
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
  const requests = await BranchApprovalRequest.find(scope ? { branchId: scope } : {}).sort({ createdAt: -1 }).skip((page(req) - 1) * 50).limit(50).lean();
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

exports.__dashboardTest = {
  requestedDateRange,
  targetDateFilter,
  permittedRevenue,
};