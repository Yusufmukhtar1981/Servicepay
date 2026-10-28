const crypto = require("crypto");
const mongoose = require("mongoose");
const User = require("../models/user.model");
const Audit = require("../models/adminAuditLog.model");
const contacts = require("../services/profileContact.service");
const email = require("../services/email.service");

const actorId = req => req.user?._id || req.user?.id;
function authorize(req) {
  if (!actorId(req)) throw contacts.fail(401, "Authentication is required.");
  if (req.user.role !== "HEAD_OFFICE") throw contacts.fail(403, "Head Office access is required.");
  if (!mongoose.isValidObjectId(req.params.id)) throw contacts.fail(400, "Invalid customer ID.");
  return req.params.id;
}
function errorResponse(res, error) {
  const status = error.code === 11000 ? 409 : error.statusCode || 500;
  return res.status(status).json({ success: false, message: status < 500
    ? error.code === 11000 ? "Another account already uses this contact information." : error.message
    : "Unable to save the pending correction. Refresh and check its status before retrying." });
}
function proposalView(proposal, user) {
  if (!proposal) return null;
  return {
    id: proposal.id,
    status: proposal.basePhone === user.phone && proposal.baseEmail === (user.email || "")
      ? "PENDING_VERIFICATION" : "STALE",
    proposedPhone: proposal.proposedPhone || null,
    proposedEmail: proposal.proposedEmail || null,
    requestedAt: proposal.requestedAt,
    requestedByName: proposal.requestedByName,
    reason: proposal.reason,
  };
}
const snapshot = user => Object.fromEntries(
  ["fullName", "phone", "email", "address", "state", "lga", "zone"].map(field => [field, user[field] || ""]),
);
async function customer(targetId, session) {
  const query = User.findOne({ _id: targetId, role: "CUSTOMER" })
    .select("+profileContactProposal +authTokenVersion");
  if (session) query.session(session);
  const user = await query;
  if (!user) throw contacts.fail(404, "Customer account not found.");
  return user;
}
async function reauthenticate(req) {
  const password = req.body.currentPassword;
  if (typeof password !== "string" || !password || password.length > 128) {
    throw contacts.fail(400, "Your administrator password is required.");
  }
  const now = new Date(), expires = new Date(now.getTime() + 900000);
  // A private persistent cap survives restarts and parallel requests.
  const actor = await User.findOneAndUpdate({
    _id: actorId(req), role: "HEAD_OFFICE", status: "ACTIVE",
    $or: [
      { "profileContactProposalRate.until": { $exists: false } },
      { "profileContactProposalRate.until": { $lte: now } },
      { "profileContactProposalRate.count": { $lt: 20 } },
    ],
  }, [{ $set: { profileContactProposalRate: {
    until: { $cond: [{ $gt: ["$profileContactProposalRate.until", now] }, "$profileContactProposalRate.until", { $literal: expires }] },
    count: { $cond: [{ $gt: ["$profileContactProposalRate.until", now] },
      { $add: [{ $ifNull: ["$profileContactProposalRate.count", 0] }, 1] }, 1] },
  } } }], { new: true, updatePipeline: true }).select("+password +authTokenVersion");
  if (!actor) throw contacts.fail(429, "Too many administrative password checks. Try again later.");
  if (!await actor.comparePassword(password)) throw contacts.fail(401, "Administrator password is incorrect.");
  return actor;
}
function validateBody(req, withdraw) {
  const allowed = new Set(["currentPassword", "reason", "expectedProposalId", ...(withdraw ? [] : ["phone", "email"])]);
  if (!req.body || Object.keys(req.body).some(key => !allowed.has(key))) {
    throw contacts.fail(400, "This request contains fields that cannot be edited.");
  }
  const reason = contacts.clean(req.body.reason || "", 500);
  if (reason.length < 5) throw contacts.fail(400, "A correction reason of at least five characters is required.");
  if (!Object.hasOwn(req.body, "expectedProposalId") ||
      !(req.body.expectedProposalId === null || typeof req.body.expectedProposalId === "string" &&
        /^[a-f0-9-]{36}$/i.test(req.body.expectedProposalId))) {
    throw contacts.fail(400, "Load the current pending correction before saving.");
  }
  if (withdraw && !req.body.expectedProposalId) throw contacts.fail(400, "Select the pending correction to withdraw.");
  return reason;
}
async function notifyExisting(user, actor, reason, proposal, withdrawn) {
  if (!user.email || user.emailVerified !== true) return { status: "not_applicable" };
  let status = "unavailable";
  try {
    const result = await email.sendEmail({
      to: user.email, subject: "ServicePay contact correction notice",
      text: withdrawn
        ? "An administrator withdrew a pending contact correction. Your active contact information has not changed."
        : "An administrator recorded a proposed contact correction for your ServicePay account. It is pending independent verification. Your active phone, email, login and recovery information have not changed. Contact ServicePay support if you did not request this.",
    });
    if (result?.success === true) status = "sent";
  } catch (_) { /* Notification delivery cannot activate a proposal or undo its audit. */ }
  try {
    await Audit.create({
      actorId: actor._id, actorRole: actor.role, actorName: actor.fullName,
      targetUserId: user._id, targetUserName: user.fullName,
      action: "PROFILE_CONTACT_NOTICE", reason,
      metadata: { proposalId: proposal.id, channel: "existing_verified_email", status },
    });
  } catch (_) { /* The original proposal/withdrawal audit was committed atomically. */ }
  return { status };
}
exports.get = async (req, res) => {
  try {
    const user = await customer(authorize(req));
    return res.json({ success: true, data: { proposal: proposalView(user.profileContactProposal, user) } });
  } catch (error) { return errorResponse(res, error); }
};
const mutate = withdraw => async (req, res) => {
  let session;
  try {
    const targetId = authorize(req);
    const reason = validateBody(req, withdraw);
    const normalized = {};
    if (!withdraw) for (const field of ["phone", "email"]) {
      if (req.body[field] !== undefined) normalized[field] = contacts.normalize(field, req.body[field]);
    }
    const actor = await reauthenticate(req);
    session = await mongoose.startSession();
    let user, proposed, previous;
    await session.withTransaction(async () => {
      const freshActor = await User.findOne({ _id: actor._id, role: "HEAD_OFFICE", status: "ACTIVE" })
        .select("+authTokenVersion").session(session);
      if (!freshActor || Number(freshActor.authTokenVersion || 0) !== Number(actor.authTokenVersion || 0)) {
        throw contacts.fail(401, "Your administrative session changed. Sign in again.");
      }
      user = await customer(targetId, session);
      previous = user.profileContactProposal;
      if ((previous?.id || null) !== req.body.expectedProposalId) {
        throw contacts.fail(409, "The pending correction changed. Refresh before saving.");
      }
      if (!withdraw) {
        const changes = {};
        for (const [field, value] of Object.entries(normalized)) {
          let old = user[field] || "";
          try { old = contacts.normalize(field, old); } catch (_) { /* Legacy empty/invalid contact is not new ownership proof. */ }
          if (value !== old) {
            await contacts.unique(field, value, user._id, session);
            changes[field] = value;
          }
        }
        if (!Object.keys(changes).length) throw contacts.fail(400, "Enter a different phone number or email address.");
        proposed = {
          id: crypto.randomUUID(), proposedPhone: changes.phone || null, proposedEmail: changes.email || null,
          basePhone: user.phone, baseEmail: user.email || "",
          requestedAt: new Date(), requestedById: String(actor._id), requestedByName: actor.fullName, reason,
        };
      }
      const cas = previous ? { "profileContactProposal.id": previous.id }
        : { profileContactProposal: { $exists: false } };
      const mutation = withdraw ? { $unset: { profileContactProposal: 1 } }
        : { $set: { profileContactProposal: proposed } };
      const result = await User.updateOne({ _id: user._id, role: "CUSTOMER", ...cas }, mutation, { session });
      if (!result.matchedCount) throw contacts.fail(409, "The pending correction changed. Refresh before saving.");
      await Audit.create([{
        actorId: actor._id, actorRole: actor.role, actorName: actor.fullName,
        targetUserId: user._id, targetUserName: user.fullName,
        action: withdraw ? "PROFILE_CONTACT_WITHDRAWN" : "PROFILE_CONTACT_PROPOSED", reason,
        previousData: snapshot(user), newData: snapshot(user),
        metadata: {
          pendingContact: withdraw ? { ...proposalView(previous, user), status: "WITHDRAWN" } : proposalView(proposed, user),
          previousProposal: previous ? proposalView(previous, user) : null,
          activeContactsChanged: false, ownershipVerified: false,
        }, requestMethod: req.method || "", requestPath: req.originalUrl || "",
      }], { session });
    });
    const notification = await notifyExisting(user, actor, reason, withdraw ? previous : proposed, withdraw);
    return res.json({ success: true,
      message: withdraw ? "Pending correction withdrawn. Active contacts are unchanged."
        : "Correction saved pending verification. Active phone, email, login and recovery remain unchanged.",
      data: { proposal: withdraw ? null : proposalView(proposed, user), notification } });
  } catch (error) { return errorResponse(res, error); }
  finally { if (session) await session.endSession(); }
};
exports.put = mutate(false);
exports.withdraw = mutate(true);
