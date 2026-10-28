const User = require("../models/user.model");
const Role = require("../models/role.model");
const contacts = require("./profileContact.service");
const PERMISSION = "users.contacts.correct";
const actorId = req => req.user?._id || req.user?.id;

async function authorized(actor, session) {
  if (!actor || actor.role !== "HEAD_OFFICE" || actor.status !== "ACTIVE" ||
      actor.isDeleted || actor.deletedAt || !actor.staffRoleId) return false;
  const query = Role.exists({
    _id: actor.staffRoleId?._id || actor.staffRoleId,
    status: "ACTIVE", permissions: PERMISSION,
  });
  if (session) query.session(session);
  return Boolean(await query);
}

async function reauthenticate(req) {
  const actor = await User.findById(actorId(req)).select("+authTokenVersion");
  if (!await authorized(actor)) throw contacts.fail(403, "Explicit contact-correction permission is required.");
  const password = req.body.currentPassword;
  if (typeof password !== "string" || !password || password.length > 128) {
    throw contacts.fail(400, "Your current administrator password is required.");
  }
  const now = new Date(), until = new Date(now.getTime() + 900000);
  const checked = await User.findOneAndUpdate({
    _id: actor._id, role: "HEAD_OFFICE", status: "ACTIVE", isDeleted: { $ne: true }, deletedAt: null,
    $expr: { $eq: [{ $ifNull: ["$authTokenVersion", 0] }, Number(actor.authTokenVersion || 0)] },
    $or: [
      { "profileContactProposalRate.until": { $exists: false } },
      { "profileContactProposalRate.until": { $lte: now } },
      { "profileContactProposalRate.count": { $lt: 20 } },
    ],
  }, [{ $set: { profileContactProposalRate: {
    until: { $cond: [{ $gt: ["$profileContactProposalRate.until", now] }, "$profileContactProposalRate.until", { $literal: until }] },
    count: { $cond: [{ $gt: ["$profileContactProposalRate.until", now] },
      { $add: [{ $ifNull: ["$profileContactProposalRate.count", 0] }, 1] }, 1] },
  } } }], { new: true, updatePipeline: true }).select("+password +authTokenVersion");
  if (!checked) throw contacts.fail(429, "Too many administrative password checks. Try again later.");
  if (!await checked.comparePassword(password)) throw contacts.fail(401, "Administrator password is incorrect.");
  return checked;
}

module.exports = { PERMISSION, authorized, reauthenticate };
