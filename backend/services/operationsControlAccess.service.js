const User = require("../models/user.model");

const CAPABILITIES = Object.freeze({
  virtualAccountsView: "operations.virtual_accounts.view",
  virtualAccountsGenerate: "operations.virtual_accounts.generate",
  virtualAccountsBulk: "operations.virtual_accounts.bulk",
  staffManage: "operations.staff.manage",
  executiveView: "operations.executive.view",
});

const permitted = (req, permission) => req.staffAccess?.isHeadOffice === true ||
  (req.user?.role === "STAFF" && req.user?.isStaff === true &&
    req.staffAccess?.roleName === "OPERATIONS_MANAGER" &&
    req.staffAccess?.scope?.type === "GLOBAL" &&
    req.staffAccess?.permissions?.includes("operations.workspace.view") &&
    req.staffAccess?.permissions?.includes(permission));

async function assertActor(req, permission) {
  if (!req.user?._id) throw Object.assign(new Error("Authentication is required."), { statusCode: 401 });
  const headOffice = req.user.role === "HEAD_OFFICE";
  if (!headOffice && !permitted(req, permission)) {
    throw Object.assign(new Error("An explicitly authorized Operations Manager is required."), { statusCode: 403 });
  }
  const actor = await User.findOne({
    _id: req.user._id, role: req.user.role, status: "ACTIVE",
    isDeleted: { $ne: true }, deletedAt: null,
    ...(!headOffice ? { isStaff: true, staffRoleId: req.staffRole?._id || req.staffAccess?.roleId } : {}),
  }).select("_id");
  if (!actor) throw Object.assign(new Error("An active authorized staff account is required."), { statusCode: 403 });
}

module.exports = { CAPABILITIES, permitted, assertActor };
