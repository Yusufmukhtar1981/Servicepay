const mongoose = require("mongoose");
const User = require("../models/user.model");
const Audit = require("../models/adminAuditLog.model");
const contacts = require("../services/profileContact.service");
const CONTACT_UNAVAILABLE = "Phone and email changes are temporarily unavailable while secure verification is configured.";
const contactChangesEnabled = () => process.env.SERVICEPAY_PROFILE_CONTACT_CHANGES_ENABLED === "true";
const allowed = new Set(["fullName", "address", "state", "lga", "zone", "email", "phone", "reason", "contactVerifications"]);
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
    if (!req.body || Object.keys(req.body).some(k => !allowed.has(k))) throw contacts.fail(400, "This request contains fields that cannot be edited.");
    const changes = {};
    for (const field of ["fullName", "address", "state", "lga", "zone"]) {
      if (req.body[field] === undefined) continue;
      changes[field] = contacts.clean(req.body[field], field === "address" ? 500 : 120);
      if (field === "fullName" && changes[field].length < 2) throw contacts.fail(400, "Enter your full name.");
    }
    for (const field of ["email", "phone"]) if (req.body[field] !== undefined) {
      changes[field] = contacts.clean(req.body[field], field === "email" ? 254 : 32);
    }
    session = await mongoose.startSession();
    let updated;
    let contactChanged = false;
    await session.withTransaction(async () => {
      const user = await User.findOne({ _id: targetId, role: "CUSTOMER" }).select("+profileContactChallenge +authTokenVersion").session(session);
      const actor = await User.findById(id(req)).select("+authTokenVersion").session(session);
      if (!user || !actor) throw contacts.fail(404, "Customer account not found.");
      const previousData = visible(user);
      const desired = { ...changes };
      for (const field of ["email", "phone"]) {
        if (desired[field] === undefined) continue;
        // Legacy optional/invalid contacts that the form merely echoes must
        // not prevent an unrelated name/address edit or create empty uniques.
        if (desired[field] === (user[field] || "")) delete desired[field];
        else desired[field] = contacts.normalize(field, desired[field]);
      }
      const contactChanges = ["email", "phone"].filter(f => desired[f] !== undefined &&
        desired[f] !== (user[f] || ""));
      contactChanged = contactChanges.length > 0;
      if (contactChanged && !contactChangesEnabled()) {
        throw Object.assign(contacts.fail(503, CONTACT_UNAVAILABLE), { code: "CONTACT_VERIFICATION_UNAVAILABLE" });
      }
      // One contact at a time prevents one approval code from authorizing two
      // independent changes, and keeps possession of an old recovery contact.
      if (contactChanges.length > 1) throw contacts.fail(400, "Verify and save one contact change at a time.");
      for (const field of contactChanges) {
        await contacts.verify({ user, actor, field, value: desired[field], verification: req.body.contactVerifications?.[field], session });
        user.profileContactChallenge = undefined;
      }
      const set = { ...desired };
      if (contactChanges.length) {
        set[`${contactChanges[0]}Verified`] = true;
        set.authTokenVersion = Number(user.authTokenVersion || 0) + 1;
      }
      // Narrow $set: unrelated financial, KYC, provider and referral fields
      // are neither loaded into the write nor replaced.
      const mutation = { $set: set };
      if (contactChanges.length) mutation.$unset = { profileContactChallenge: 1 };
      updated = await User.findOneAndUpdate({ _id: user._id, role: "CUSTOMER" }, mutation, { new: true, runValidators: true, session });
      await Audit.create([{ actorId: actor._id, actorRole: actor.role, actorName: actor.fullName,
        targetUserId: user._id, targetUserName: updated.fullName, action: "USER_PROFILE_UPDATED",
        reason, previousData, newData: visible(updated),
        metadata: { source: admin ? "HEAD_OFFICE_PROFILE" : "CUSTOMER_PROFILE", verifiedContactFields: contactChanges },
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
exports.history = async (req, res) => {
  try {
    const targetId = authorize(req, true, false);
    if (!await User.exists({ _id: targetId, role: "CUSTOMER" })) throw contacts.fail(404, "Customer account not found.");
    const page = Math.max(1, Math.min(10000, parseInt(req.query.page, 10) || 1));
    const filter = { targetUserId: targetId, action: "USER_PROFILE_UPDATED" };
    const [history, total] = await Promise.all([
      Audit.find(filter).select("actorName actorRole createdAt reason previousData newData").sort({ createdAt: -1, _id: -1 }).skip((page - 1) * 20).limit(20).lean(),
      Audit.countDocuments(filter),
    ]);
    return res.json({ success: true, data: { history: history.map(row => ({ ...row, id: row._id })), page, total, pages: Math.ceil(total / 20) } });
  } catch (error) { return errorResponse(res, error); }
};
