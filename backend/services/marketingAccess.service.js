"use strict";
const { fail, id } = require("./marketing.service");
const User = require("../models/user.model");
const Role = require("../models/role.model");
const PRIVATE = new Set(["target", "report", "task", "attendance", "activity",
  "performance", "archive", "notification"]);
const leadership = req => req.staffAccess.isHeadOffice ||
  req.staffAccess.roleName === "HEAD_OF_MARKETING" &&
  req.staffAccess.permissions.includes("marketing.team.manage");
const superAdmin = req => req.staffAccess.sourceRole === "SUPER_ADMIN";
async function context(req) {
  req.marketingLeader = leadership(req);
  if (req.staffAccess.isHeadOffice) return;
  if (req.marketingLeader) {
    const roles = await Role.find({ department: "MARKETING", name: "MARKETING_OFFICER" }).select("_id").lean();
    const officers = await User.find({ department: "MARKETING", isStaff: true,
      staffRoleId: { $in: roles.map(r => r._id) } }).select("_id").limit(1001).lean();
    if (officers.length > 1000) throw fail("Marketing team exceeds reporting capacity.", 422);
    req.marketingOwners = [req.user._id, ...officers.map(u => u._id)];
  } else req.marketingOwners = [req.user._id];
}
function scope(req, kind) {
  if (req.staffAccess.isHeadOffice || !PRIVATE.has(kind)) return {};
  const owners = req.marketingOwners || [req.user._id];
  return { $or: [{ officerId: { $in: owners } },
    { officerId: null, createdBy: { $in: owners } },
    ...(kind === "target" ? [{ "data.scope": "DEPARTMENT" }] : [])] };
}
function own(req, record) {
  const owner = String(record.officerId || record.createdBy);
  return owner === String(req.user._id);
}
function assertVisible(req, record) {
  if (!PRIVATE.has(record.kind) || req.staffAccess.isHeadOffice) return;
  if (record.kind === "target" && record.data?.scope === "DEPARTMENT") return;
  if (!(req.marketingOwners || [req.user._id]).some(o => String(o) === String(record.officerId || record.createdBy))) {
    throw fail("Marketing record not found.", 404);
  }
}
async function targetEditable(req, record, session) {
  if (req.staffAccess.isHeadOffice) return;
  // Legacy Admin targets have no authority marker. Consult their immutable
  // author rather than treating missing metadata as delegated authority.
  const author = await User.findById(record.createdBy).select("role").session(session).lean();
  if (record.data?.scope === "DEPARTMENT" || record.data?.authority === "ADMIN" ||
      !author || ["HEAD_OFFICE", "SUPER_ADMIN"].includes(author.role)) {
    throw fail("Only authorized Admin can modify Admin-assigned targets.", 403);
  }
}
async function assignment(req, officerId) {
  if (!officerId) throw fail("Select an individual marketing staff member.");
  const target = await User.findOne({ _id: id(officerId), department: "MARKETING",
    isStaff: true, status: "ACTIVE" }).populate("staffRoleId").lean();
  if (!target) throw fail("Active marketing staff member not found.");
  const role = target.staffRoleId?.name;
  if (req.staffAccess.isHeadOffice) {
    if (!["HEAD_OF_MARKETING", "MARKETING_OFFICER"].includes(role)) throw fail("Select a marketing leader or officer.");
  } else if (!leadership(req) || role !== "MARKETING_OFFICER") {
    throw fail("Only Head Office assigns leaders; marketing leaders assign officers.", 403);
  }
  return target;
}
module.exports = { PRIVATE, leadership, superAdmin, context, scope, own, assertVisible, assignment, targetEditable };
