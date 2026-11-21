const User = require("../models/user.model");
const Role = require("../models/role.model");
const mongoose = require("mongoose");
const access = require("../services/operationsControlAccess.service");
const staff = require("./staffManagement.controller");
const managers = require("./adminRoleUsers.controller");
const management = require("./management.controller");
const Audit = require("../models/adminAuditLog.model");
const supportPermissions = new Set(["support.workspace.view", "support.view", "support.assign", "support.resolve"]);
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const wrap = action => async (req, res) => {
  try {
    await access.assertActor(req, access.CAPABILITIES.staffManage);
    res.set("Cache-Control", "no-store");
    return await action(req, res);
  } catch (error) {
    return res.status(error.statusCode || 503).json({ success: false,
      message: error.statusCode ? error.message : "Subordinate staff management is temporarily unavailable." });
  }
};
const confirmation = (req, keys) => {
  const body = req.body || {};
  if (body.confirmed !== true || typeof body.reason !== "string" ||
      body.reason.trim().length < 10 || body.reason.trim().length > 500 ||
      /[\x00-\x1f]/.test(body.reason) ||
      Object.keys(body).some(key => ![...keys, "confirmed", "reason"].includes(key))) {
    throw fail(400, "Confirm the exact staff action and provide a reason of 10 to 500 characters.");
  }
  if (body.password !== undefined && (typeof body.password !== "string" || body.password.length < 12)) {
    throw fail(400, "Use a temporary password of at least 12 characters.");
  }
};
async function supportRole() {
  const role = await Role.findOne({ name: "CUSTOMER_SUPPORT", status: "ACTIVE" });
  if (!role || role.scopeType !== "GLOBAL" || Number(role.hierarchyLevel) >= 60 ||
      !role.permissions.length || role.permissions.some(permission => !supportPermissions.has(permission)) ||
      !role.permissions.includes("support.workspace.view")) {
    throw fail(409, "The existing Customer Support role requires Head Office review before delegated assignment. Its permissions were not changed.");
  }
  return role;
}
async function supportContext(req, target = false) {
  const role = await supportRole();
  if (target) {
    if (!/^[a-f0-9]{24}$/i.test(String(req.params.staffId || ""))) throw fail(404, "Support staff not found.");
    const user = await User.findOne({ _id: req.params.staffId, role: "STAFF", isStaff: true,
      staffRoleId: role._id, isDeleted: { $ne: true }, deletedAt: null }).select("_id")
      .session(req.operationsStaffSession || null);
    if (!user) throw fail(403, "Only staff assigned to the approved Customer Support role can be managed here.");
  }
  req.operationsSupportDelegation = true;
  req.operationsSupportRoleId = role._id;
  return role;
}
exports.options = wrap(async (req, res) => {
  let role;
  try { role = await supportRole(); } catch (error) { if (error.statusCode !== 409) throw error; }
  const zonalManagers = await User.find({ role: "ZONAL_MANAGER", status: "ACTIVE",
    isDeleted: { $ne: true }, deletedAt: null }).select("_id fullName zone").sort({ fullName: 1 }).maxTimeMS(5000).lean();
  return res.json({ success: true, data: {
    supportRole: role ? { id: String(role._id), name: role.name, displayName: role.displayName } : null,
    canCreateSupport: Boolean(role), zonalManagers: zonalManagers.map(user => ({
      id: String(user._id), fullName: user.fullName, zone: user.zone,
    })), managerTypes: ["ZONAL_MANAGER", "STATE_MANAGER"],
    zonalPermissionProfiles: [
      { id: "STANDARD", label: "Standard zone management",
        permissions: [...require("../config/staffPermissions").directRolePermissions.ZONAL_MANAGER] },
      { id: "READ_ONLY", label: "Read-only zone access",
        permissions: require("../config/staffPermissions").directRolePermissions.ZONAL_MANAGER.filter(value => value.endsWith(".view")) },
    ],
  } });
});
exports.managers = wrap(async (req, res) => {
  const role = String(req.query.role || "");
  if (!["ZONAL_MANAGER", "STATE_MANAGER"].includes(role)) throw fail(400, "Choose ZONAL_MANAGER or STATE_MANAGER.");
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
  const q = String(req.query.q || "").trim();
  if (page > 10000 || q.length > 100) throw fail(400, "Narrow the manager search.");
  const filter = { role, isDeleted: { $ne: true }, deletedAt: null };
  if (q) {
    const expression = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = ["fullName", "phone", "email", "zone", "state"].map(key => ({ [key]: expression }));
  }
  const [rows, total] = await Promise.all([
    User.find(filter).select("_id fullName phone email role status zone state zonalManagerId managementAccess")
      .sort({ fullName: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).maxTimeMS(5000).lean(),
    User.countDocuments(filter).maxTimeMS(5000),
  ]);
  return res.json({ success: true, data: { items: rows.map(user => ({ ...user, id: String(user._id),
    permissionProfile: user.managementAccess || "STANDARD" })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
});
exports.list = wrap(async (req, res) => { await supportContext(req); return staff.getStaff(req, res); });
exports.updateManagerAccess = wrap(async (req, res) => {
  confirmation(req, ["permissionProfile", "status"]);
  if (!mongoose.isValidObjectId(req.params.id) ||
      !["STANDARD", "READ_ONLY"].includes(req.body.permissionProfile) ||
      !["ACTIVE", "SUSPENDED"].includes(req.body.status)) throw fail(400, "Select valid zone-manager access and status.");
  const session = await mongoose.startSession();
  let data;
  try {
    await session.withTransaction(async () => {
      const query = { _id: req.params.id, role: "ZONAL_MANAGER", isDeleted: { $ne: true } };
      const previous = await User.findOne(query).select("managementAccess status").session(session).lean();
      if (!previous) throw fail(404, "Zonal Manager not found.");
      const changed = await User.findOneAndUpdate(query, { $set: {
        managementAccess: req.body.permissionProfile, status: req.body.status,
      }, $inc: { authTokenVersion: 1 } }, { session, returnDocument: "after", runValidators: true })
        .select("fullName role zone status managementAccess").lean();
      await Audit.create([{ actorId: req.user._id, actorRole: req.user.role, targetUserId: changed._id,
        action: "USER_ROLE_UPDATED", reason: req.body.reason,
        metadata: { operation: "ZONAL_MANAGEMENT_ACCESS",
          previous: { permissionProfile: previous.managementAccess || "STANDARD", status: previous.status },
          current: { permissionProfile: changed.managementAccess, status: changed.status } } }], { session });
      data = { id: String(changed._id), fullName: changed.fullName, role: changed.role, zone: changed.zone,
        status: changed.status, permissionProfile: changed.managementAccess };
    });
  } finally { await session.endSession(); }
  return res.json({ success: true, data });
});
exports.detail = wrap(async (req, res) => { await supportContext(req, true); return staff.getStaffDetail(req, res); });
exports.create = wrap(async (req, res) => {
  confirmation(req, ["fullName", "phone", "email", "password"]);
  const role = await supportContext(req);
  req.body = { ...req.body, roleId: String(role._id) };
  const session = await mongoose.startSession();
  let code = 200, response;
  try {
    await session.withTransaction(async () => {
      req.operationsStaffSession = session;
      await staff.createStaff(req, {
        status(value) { code = value; return this; },
        json(value) { response = value; return this; },
      });
      if (code >= 400 || !response?.success) throw fail(code >= 400 ? code : 503,
        "Support account creation was not committed. Review the supplied details and retry safely.");
    });
    return res.status(code).json(response);
  } finally { delete req.operationsStaffSession; await session.endSession(); }
});
exports.update = wrap(async (req, res) => {
  confirmation(req, ["fullName", "phone", "email"]);
  return supportMutation(req, res, staff.updateStaff);
});
exports.status = wrap(async (req, res) => {
  confirmation(req, ["status"]);
  if (!["ACTIVE", "SUSPENDED"].includes(req.body.status)) throw fail(400, "Choose ACTIVE or SUSPENDED.");
  return supportMutation(req, res, staff.updateStaffStatus);
});
async function supportMutation(req, res, action) {
  const session = await mongoose.startSession();
  let code, body;
  try {
    await session.withTransaction(async () => {
      code = 200; body = undefined;
      req.operationsStaffSession = session;
      await supportContext(req, true);
      await action(req, { status(value) { code = value; return this; }, json(value) { body = value; return this; } });
      if (code >= 400 || !body?.success) throw fail(code >= 400 ? code : 503,
        body?.message || "Support staff change was not committed.");
    });
  } finally { delete req.operationsStaffSession; await session.endSession(); }
  return res.status(code).json(body);
}
exports.createZonal = wrap(async (req, res) => {
  confirmation(req, ["fullName", "phone", "email", "password", "zone", "permissionProfile", "status"]);
  if (req.body.permissionProfile !== undefined && !["STANDARD", "READ_ONLY"].includes(req.body.permissionProfile) ||
      req.body.status !== undefined && !["ACTIVE", "SUSPENDED"].includes(req.body.status)) {
    throw fail(400, "Choose a supported zone permission profile and ACTIVE or SUSPENDED status.");
  }
  req.operationsManagerCreation = true;
  return managers.createZonalManager(req, res);
});
exports.createState = wrap(async (req, res) => {
  confirmation(req, ["fullName", "phone", "email", "password", "state", "zonalManagerId"]);
  req.operationsManagerCreation = true;
  return management.createStateManager(req, res);
});
