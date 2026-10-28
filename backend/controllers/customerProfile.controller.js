const mongoose = require("mongoose");
const User = require("../models/user.model");
const Audit = require("../models/adminAuditLog.model");
const contacts = require("../services/profileContact.service");
const correction = require("../services/adminContactCorrection.service");
const CONTACT_UNAVAILABLE = "Phone and email changes are temporarily unavailable while secure verification is configured.";
const contactChangesEnabled = () => process.env.SERVICEPAY_PROFILE_CONTACT_CHANGES_ENABLED === "true";
const allowed = new Set(["fullName", "address", "state", "lga", "zone", "email", "phone", "reason", "contactVerifications"]);
const adminAllowed = new Set([...allowed, "currentPassword", "expectedPhone", "expectedEmail"]);
const visible = u => ({ id: u._id, _id: u._id, fullName: u.fullName, phone: u.phone,
  email: u.email || "", address: u.address || "", zone: u.zone || "", state: u.state || "",
  lga: u.lga || "", profilePhotoUrl: u.profilePhotoUrl || "", role: u.role, status: u.status });
const id = req => req.user?._id || req.user?.id;
const requestWindows = new Map();
function limitPasswordChecks(actorId) {
  const now = Date.now(), key = String(actorId);
  const old = requestWindows.get(key);
  const entry = old && old.until > now ? old : { until: now + 900000, count: 0 };
  if (requestWindows.size > 10000) requestWindows.delete(requestWindows.keys().next().value);
  requestWindows.set(key, entry);
  if (++entry.count > 10) throw contacts.fail(429, "Too many verification requests. Please try again later.");
}
function authorize(req, admin, write = true) {
  if (!id(req)) throw contacts.fail(401, "Authentication is required.");
  if (!admin) {
    if (req.user.role !== "CUSTOMER") throw contacts.fail(403, "Customer access is required.");
    return id(req);
  }
  const p = req.staffAccess?.permissions || [];
  if (req.user.role !== "HEAD_OFFICE" || (!req.staffAccess?.isHeadOffice && !p.includes("*") && !p.includes(write ? "users.update" : "users.view"))) {
    throw contacts.fail(403, "Authorized Head Office access is required.");
  }
  if (!mongoose.isValidObjectId(req.params.id)) throw contacts.fail(400, "Invalid customer ID.");
  return req.params.id;
}
const reasonFor = (req, admin) => {
  const reason = admin ? contacts.clean(req.body.reason || "", 500) : "Customer self-service profile update";
  if (admin && reason.length < 5) throw contacts.fail(400, "A reason of at least five characters is required.");
  return reason;
};
function errorResponse(res, error) {
  const status = error?.code === 11000 ? 409 : error.statusCode || 500;
  return res.status(status).json({ success: false, ...(error.code === "CONTACT_VERIFICATION_UNAVAILABLE" ? { code: error.code } : {}), message: error?.code === 11000
    ? "Another account already uses this contact information."
    : status < 500 ? error.message : error.statusCode === 503 ? error.message : "Unable to update the profile. Please try again." });
}
const requestContact = admin => async (req, res) => {
  try {
    const targetId = authorize(req, admin);
    if (!contactChangesEnabled()) throw Object.assign(contacts.fail(503, CONTACT_UNAVAILABLE), { code: "CONTACT_VERIFICATION_UNAVAILABLE" });
    limitPasswordChecks(id(req));
    const reason = reasonFor(req, admin);
    const data = await contacts.request({ actorId: id(req), targetId, field: req.body.field,
      value: req.body.value, currentPassword: req.body.currentPassword, reason });
    return res.json({ success: true, message: "Verification codes sent to the new and existing contacts.", data });
  } catch (error) { return errorResponse(res, error); }
};
const update = admin => async (req, res) => {
  let session;
  try {
    const targetId = authorize(req, admin);
    const reason = reasonFor(req, admin);
    if (!req.body || Object.keys(req.body).some(k => !(admin ? adminAllowed : allowed).has(k))) throw contacts.fail(400, "This request contains fields that cannot be edited.");
    const changes = {};
    for (const field of ["fullName", "address", "state", "lga", "zone"]) {
      if (req.body[field] === undefined) continue;
      changes[field] = contacts.clean(req.body[field], field === "address" ? 500 : 120);
      if (field === "fullName" && changes[field].length < 2) throw contacts.fail(400, "Enter your full name.");
    }
    for (const field of ["email", "phone"]) if (req.body[field] !== undefined) {
      changes[field] = contacts.clean(req.body[field], field === "email" ? 254 : 32);
    }
    // Reauthenticate outside the transaction so a rejected request cannot
    // roll back its durable password-attempt limit.
    const directIntent = admin && ["currentPassword", "expectedPhone", "expectedEmail"]
      .some(field => Object.hasOwn(req.body, field));
    const confirmedActor = directIntent ? await correction.reauthenticate(req) : null;
    session = await mongoose.startSession();
    let updated;
    let contactChanged = false;
    await session.withTransaction(async () => {
      const user = await User.findOne({ _id: targetId, role: "CUSTOMER" }).select("+profileContactChallenge +profileContactProposal +profileRecoveryBlocked +authTokenVersion").session(session);
      const actor = await User.findById(id(req)).select("+authTokenVersion").session(session);
      if (!user || !actor) throw contacts.fail(404, "Customer account not found.");
      if (directIntent && (typeof req.body.expectedPhone !== "string" ||
          typeof req.body.expectedEmail !== "string" ||
          req.body.expectedPhone !== (user.phone || "") ||
          req.body.expectedEmail !== (user.email || ""))) {
        throw contacts.fail(409, "Customer contacts changed. Refresh the profile before saving.");
      }
      const previousData = visible(user);
      const desired = { ...changes };
      for (const field of ["email", "phone"]) {
        if (desired[field] === undefined) continue;
        // Legacy optional/invalid contacts that the form merely echoes must
        // not prevent an unrelated name/address edit or create empty uniques.
        if (desired[field] === (user[field] || "")) delete desired[field];
        else {
          desired[field] = contacts.normalize(field, desired[field]);
          // Equivalent legacy formatting/casing is not a contact mutation.
          try {
            if (desired[field] === contacts.normalize(field, user[field] || "")) delete desired[field];
          } catch (_) { /* A genuinely different new contact still needs OTP. */ }
        }
      }
      const contactChanges = ["email", "phone"].filter(f => desired[f] !== undefined &&
        desired[f] !== (user[f] || ""));
      contactChanged = contactChanges.length > 0;
      if (contactChanged && admin) {
        if (!confirmedActor) throw contacts.fail(400, "Administrator password and current contact values are required.");
        if (!await correction.authorized(actor, session)) {
          throw contacts.fail(403, "Explicit contact-correction permission and fresh administrator reauthentication are required.");
        }
        if (Number(actor.authTokenVersion || 0) !== Number(confirmedActor.authTokenVersion || 0)) {
          throw contacts.fail(401, "Administrator session changed. Sign in again.");
        }
        if (user.isDeleted || user.deletedAt || user.activationPending === true) {
          throw contacts.fail(409, "Contact correction is unavailable for deleted or not-yet-activated accounts.");
        }
        for (const field of contactChanges) await contacts.unique(field, desired[field], user._id, session);
      }
      if (contactChanged && !admin && !contactChangesEnabled()) {
        throw Object.assign(contacts.fail(503, CONTACT_UNAVAILABLE), { code: "CONTACT_VERIFICATION_UNAVAILABLE" });
      }
      // One contact at a time prevents one approval code from authorizing two
      // independent changes, and keeps possession of an old recovery contact.
      if (!admin && contactChanges.length > 1) throw contacts.fail(400, "Verify and save one contact change at a time.");
      for (const field of admin ? [] : contactChanges) {
        await contacts.verify({ user, actor, field, value: desired[field], verification: req.body.contactVerifications?.[field], session });
        user.profileContactChallenge = undefined;
      }
      const set = { ...desired };
      if (contactChanges.length) {
        for (const field of contactChanges) {
          set[`${field}Verified`] = !admin;
          set[`profileRecoveryBlocked.${field}`] = admin;
        }
        set.authTokenVersion = Number(user.authTokenVersion || 0) + 1;
      }
      // Narrow $set: unrelated financial, KYC, provider and referral fields
      // are neither loaded into the write nor replaced.
      const mutation = { $set: set };
      if (contactChanges.length) mutation.$unset = {
        profileContactChallenge: 1, profileContactProposal: 1,
        passwordResetToken: 1, passwordResetExpires: 1,
      };
      updated = await User.findOneAndUpdate({ _id: user._id, role: "CUSTOMER" }, mutation, { new: true, runValidators: true, session });
      await Audit.create([{ actorId: actor._id, actorRole: actor.role, actorName: actor.fullName,
        targetUserId: user._id, targetUserName: updated.fullName, action: "USER_PROFILE_UPDATED",
        reason, previousData, newData: visible(updated),
        metadata: { source: admin ? "HEAD_OFFICE_PROFILE" : "CUSTOMER_PROFILE",
          verifiedContactFields: admin ? [] : contactChanges,
          unverifiedContactFields: admin ? contactChanges : [],
          verificationMethod: admin && contactChanged ? "ADMIN_DIRECT_UNVERIFIED" : "EXISTING_PROFILE_SECURITY",
          ownershipVerified: admin && contactChanged ? false : undefined,
          supersededProposalId: admin && contactChanged ? user.profileContactProposal?.id : undefined },
        requestMethod: req.method || "", requestPath: req.originalUrl || "" }], { session });
    });
    const profile = admin ? visible(updated) : require("./auth.controller").formatUser(updated);
    return res.json({ success: true, message: "Profile updated successfully.", user: profile,
      data: { user: profile, requiresLogin: contactChanged && !admin } });
  } catch (error) { return errorResponse(res, error); }
  finally { if (session) await session.endSession(); }
};
exports.updateSelf = update(false);
exports.updateAdmin = update(true);
exports.requestSelfContact = requestContact(false);
exports.requestAdminContact = requestContact(true);
exports.contactCorrectionAccess = async (req, res) => {
  try {
    const targetId = authorize(req, true, false);
    const [target, actor] = await Promise.all([
      User.findOne({ _id: targetId, role: "CUSTOMER" }).select("phoneVerified emailVerified"),
      User.findById(id(req)),
    ]);
    if (!target) throw contacts.fail(404, "Customer account not found.");
    return res.json({ success: true, data: { canCorrect: await correction.authorized(actor),
      phoneVerified: target.phoneVerified === true, emailVerified: target.emailVerified === true } });
  } catch (error) { return errorResponse(res, error); }
};
exports.history = async (req, res) => {
  try {
    const targetId = authorize(req, true, false);
    if (!await User.exists({ _id: targetId, role: "CUSTOMER" })) throw contacts.fail(404, "Customer account not found.");
    const page = Math.max(1, Math.min(10000, parseInt(req.query.page, 10) || 1));
    const filter = { targetUserId: targetId, action: { $in: [
      "USER_PROFILE_UPDATED", "PROFILE_CONTACT_PROPOSED", "PROFILE_CONTACT_WITHDRAWN",
    ] } };
    const [history, total] = await Promise.all([
      Audit.find(filter).select("actorName actorRole createdAt reason previousData newData action metadata").sort({ createdAt: -1, _id: -1 }).skip((page - 1) * 20).limit(20).lean(),
      Audit.countDocuments(filter),
    ]);
    const mayReadContacts = await correction.authorized(await User.findById(id(req)));
    const rows = history.map(row => {
      if (!mayReadContacts) {
        for (const key of ["previousData", "newData"]) {
          row[key] = { ...(row[key] || {}) };
          delete row[key].phone; delete row[key].email;
        }
      }
      // Legacy metadata is not a public DTO: expose only the proposal fields
      // needed by this protected history screen, never arbitrary audit metadata.
      const pending = row.metadata?.pendingContact;
      const safeMetadata = pending && mayReadContacts ? { pendingContact: Object.fromEntries(
        ["id", "status", "proposedPhone", "proposedEmail", "requestedAt", "requestedByName", "reason"]
          .filter(key => pending[key] !== undefined).map(key => [key, pending[key]]),
      ) } : {};
      if (mayReadContacts && row.metadata?.verificationMethod === "ADMIN_DIRECT_UNVERIFIED") {
        safeMetadata.directCorrection = {
          verificationMethod: "ADMIN_DIRECT_UNVERIFIED", ownershipVerified: false,
          unverifiedContactFields: (row.metadata.unverifiedContactFields || [])
            .filter(field => field === "phone" || field === "email"),
        };
      }
      return { ...row, id: row._id, metadata: safeMetadata };
    });
    return res.json({ success: true, data: { history: rows, page, total, pages: Math.ceil(total / 20) } });
  } catch (error) { return errorResponse(res, error); }
};
