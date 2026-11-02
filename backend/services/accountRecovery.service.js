"use strict";
const crypto = require("crypto");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/user.model");
const Audit = require("../models/adminAuditLog.model");
const LoginEvent = require("../models/loginSecurityEvent.model");
const { sendEmail } = require("./email.service");
const { createInAppNotification } = require("./inAppNotification.service");
const { validateStrongPassword } = require("../utils/passwordPolicy");
const R = require("./accountRecovery.rules");

const privateFields = "+password +authTokenVersion +accountRecoveryState +accountRecoveryRate " +
  "+recoveryAuditHead +recoveryAuditSequence +profileRecoveryBlocked +passwordResetToken " +
  "+passwordResetExpires +customerRefreshSessions +transactionPin";
const hooks = { sendEmail, createInAppNotification };
const securityFields = [
  "accountRecoveryState", "accountRecoveryRate", "recoveryAuditHead", "recoveryAuditSequence",
  "password", "passwordChangedAt", "mustChangePassword", "authTokenVersion",
  "passwordResetToken", "passwordResetExpires", "customerRefreshSessions",
  "transactionPin", "transactionPinSet", "transactionPinUpdatedAt",
  "transactionPinFailedAttempts", "transactionPinLockedUntil", "transactionPinAttemptVersion",
];

// Every state transition and its keyed audit-chain event commit together.
// A write conflict on the customer serializes concurrent OTPs and token claims.
async function transition(id, actor, event, recoveryReason, change) {
  let result;
  await mongoose.connection.transaction(async session => {
    const user = await User.findById(id).select(privateFields).session(session);
    if (!user) throw R.fail("Customer not found.", 404);
    const outcome = await change(user);
    if (outcome.status === "COMPLETED" && actor.role === "CUSTOMER") {
      const notification = await hooks.createInAppNotification({
        userId: user._id, title: "Account security updated",
        message: "Your account recovery was completed. If this was not you, contact support immediately.",
        type: "SECURITY", category: "SECURITY", referenceType: "SECURITY_EVENT",
        reference: "ACCOUNT_RECOVERY", action: "SECURITY",
        dedupeKey: `account-recovery:${id}:${user.accountRecoveryState?.id || ""}`,
      }, { session });
      if (!notification) throw R.fail("Security notification could not be recorded. Recovery was not completed.", 503);
      user.accountRecoveryState = { ...user.accountRecoveryState, emailNotificationStatus: "PENDING" };
    }
    const sequence = Number(user.recoveryAuditSequence || 0) + 1;
    const metadata = {
      recovery: true, sequence, previous: user.recoveryAuditHead || "",
      event, recoveryAction: outcome.action || user.accountRecoveryState?.action || null,
      status: outcome.status || user.accountRecoveryState?.status || null,
      challengeId: user.accountRecoveryState?.id || null,
      occurredAt: new Date().toISOString(),
    };
    const payload = {
      customerId: String(id), actorId: String(actor._id), actorRole: actor.role,
      reason: recoveryReason, metadata,
    };
    metadata.digest = R.mac(JSON.stringify(payload));
    await Audit.create([{
      actorId: actor._id, actorRole: actor.role, targetUserId: user._id,
      action: "ACCOUNT_RECOVERY_EVENT", reason: recoveryReason, metadata,
    }], { session });
    user.recoveryAuditHead = metadata.digest;
    user.recoveryAuditSequence = sequence;
    // Saving a legacy hydrated User materializes unrelated schema defaults,
    // including virtualAccount fields. Write only modified security fields.
    // These are the same bcrypt work factors as the existing User save hook.
    const set = {}, unset = {};
    for (const field of securityFields) {
      if (!user.isModified(field)) continue;
      let value = user.get(field);
      if (field === "password" && value !== undefined) value = await bcrypt.hash(value, 12);
      if (field === "transactionPin" && value !== undefined) {
        if (!/^\d{4}$/.test(String(value))) throw R.fail("Enter a four-digit PIN.");
        value = await bcrypt.hash(value, 12);
      }
      if (value === undefined) unset[field] = 1;
      else set[field] = value;
    }
    await User.updateOne({ _id: id }, {
      ...(Object.keys(set).length ? { $set: set } : {}),
      ...(Object.keys(unset).length ? { $unset: unset } : {}),
    }, { session });
    result = outcome;
  });
  return result;
}

async function reauthenticate(actor, currentPassword) {
  if (typeof currentPassword !== "string" || !currentPassword || currentPassword.length > 200) {
    throw R.fail("Fresh administrator authentication is required.", 401);
  }
  // Durable, atomic per-admin rate limit includes unsuccessful challenges.
  const window = Math.floor(Date.now() / R.TTL);
  await User.updateOne(
    { _id: actor._id, "accountRecoveryAdminRate.window": { $ne: window } },
    { $set: { accountRecoveryAdminRate: { window, count: 0 } } }
  );
  const admin = await User.findOneAndUpdate({
    _id: actor._id, role: actor.role, status: "ACTIVE",
    "accountRecoveryAdminRate.window": window,
    "accountRecoveryAdminRate.count": { $lt: 12 },
  }, { $inc: { "accountRecoveryAdminRate.count": 1 } }, { returnDocument: "after" })
    .select("+password +authTokenVersion");
  if (!admin) throw R.fail("Too many recovery authentication attempts. Try later.", 429);
  if (Number(admin.authTokenVersion || 0) !== Number(actor.authTokenVersion || 0) ||
      !/^\$2[aby]\$/.test(admin.password || "") ||
      !await bcrypt.compare(currentPassword, admin.password)) {
    throw R.fail("Administrator authentication failed.", 401, "REAUTHENTICATION_FAILED");
  }
}

async function snapshot(id, permissions) {
  const user = await User.findById(id).select(privateFields).lean();
  if (!user || user.role !== "CUSTOMER") throw R.fail("Customer not found.", 404);
  const [last, failures, events] = await Promise.all([
    LoginEvent.findOne({ user: id, outcome: "SUCCESS" }).sort({ createdAt: -1 }).select("createdAt").lean(),
    LoginEvent.countDocuments({ user: id, outcome: "FAILED",
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }),
    permissions.includes(R.PERMISSIONS.AUDIT)
      ? Audit.find({ targetUserId: id, action: "ACCOUNT_RECOVERY_EVENT" })
        .sort({ "metadata.sequence": -1 }).limit(50)
        .select("actorId actorRole reason metadata createdAt").lean() : [],
  ]);
  const state = user.accountRecoveryState;
  let auditIntegrity = "NOT_REQUESTED";
  if (permissions.includes(R.PERMISSIONS.AUDIT)) {
    let expected = user.recoveryAuditHead || "";
    auditIntegrity = events.length ? "VERIFIED_RECENT_CHAIN" : user.recoveryAuditHead ? "CHECK_FAILED" : "NO_EVENTS";
    for (const event of events) {
      const metadata = { ...event.metadata };
      const digest = metadata.digest;
      delete metadata.digest;
      const valid = R.equal(expected, digest) && R.equal(digest, R.mac(JSON.stringify({
        customerId: String(id), actorId: String(event.actorId),
        actorRole: event.actorRole, reason: event.reason, metadata,
      })));
      if (!valid) { auditIntegrity = "CHECK_FAILED"; break; }
      expected = metadata.previous;
    }
  }
  return {
    customer: { id: String(user._id), fullName: user.fullName, email: user.email,
      phone: user.phone, status: user.status, emailVerified: user.emailVerified === true },
    diagnostics: { lastSuccessfulLogin: last?.createdAt || null,
      failedLoginAttempts: failures, failedLoginWindowHours: 24,
      ordinaryLockSupported: false, restrictionsPreserved: true,
      loginStatus: R.eligible(user) ? "ELIGIBLE_SUBJECT_TO_SECURITY_HOLDS" : "ACCOUNT_RESTRICTED",
      mustChangePassword: user.mustChangePassword === true },
    channelAvailable: R.verifiedEmail(user) && Boolean(process.env.RESEND_API_KEY) && R.eligible(user),
    permissions,
    recovery: state ? { status: R.live(state) ? state.status :
      state.status === "COMPLETED" ? "COMPLETED" : "EXPIRED",
      action: state.action, expiresAt: state.expiresAt } : { status: "NONE" },
    auditIntegrity,
    history: events.map(e => ({ id: String(e._id), actorId: String(e.actorId),
      reason: e.reason, event: e.metadata?.event, action: e.metadata?.recoveryAction,
      status: e.metadata?.status, occurredAt: e.createdAt,
      tamperEvidence: { sequence: e.metadata?.sequence, digest: e.metadata?.digest } })),
  };
}

async function start(id, actor, body) {
  const action = body.action;
  const recoveryReason = R.reason(body.reason);
  if (!R.ACTIONS[action]) throw R.fail("Choose a supported recovery action.");
  if (action === "UNLOCK") {
    throw R.fail("No ordinary failed-login lock is configured. Security and compliance holds cannot be removed here.", 409);
  }
  await reauthenticate(actor, body.currentPassword);
  if (!process.env.RESEND_API_KEY) throw R.fail("Verified email delivery is temporarily unavailable.", 503);
  const otp = String(crypto.randomInt(100000, 1000000));
  const challengeId = crypto.randomUUID();
  const expiresAt = Date.now() + R.TTL;
  const delivery = await transition(id, actor, "CHALLENGE_REQUESTED", recoveryReason, async user => {
    if (!R.eligible(user) || !R.verifiedEmail(user)) {
      throw R.fail("An active customer with an existing verified email is required.", 409);
    }
    const rate = user.accountRecoveryRate || {};
    if (rate.lastSentAt && Number(rate.lastSentAt) > Date.now() - 60000) {
      throw R.fail("Wait before requesting another recovery code.", 429);
    }
    const bucket = Math.floor(Date.now() / (60 * 60 * 1000));
    const count = rate.bucket === bucket ? Number(rate.count || 0) : 0;
    if (count >= 3) throw R.fail("Customer recovery request limit reached. Try later.", 429);
    const old = user.accountRecoveryState;
    if (R.live(old) && ["LINK_SENDING", "READY"].includes(old.status)) {
      throw R.fail("A customer recovery link is already active. Let it finish or expire.", 409);
    }
    user.accountRecoveryRate = { bucket, count: count + 1, lastSentAt: Date.now() };
    user.accountRecoveryState = {
      id: challengeId, action, actorId: String(actor._id), status: "OTP_SENDING",
      expiresAt, otpHash: R.mac(`${challengeId}:${otp}`), attempts: 0,
      binding: R.binding(user), reason: recoveryReason,
    };
    return { action, email: user.email };
  });
  const sent = await hooks.sendEmail({
    to: delivery.email, subject: "ServicePay account recovery verification",
    text: `A Head Office administrator requested ${action === "PIN_RECOVERY" ? "transaction PIN" : "password"} recovery. ` +
      `Your verification code is ${otp}. It expires in 15 minutes. Share it only with the authorized ` +
      `Head Office administrator assisting with recovery you requested. If you did not request this, do not share the code and contact support@servicepay.ng.`,
  });
  await transition(id, actor, sent.success ? "OTP_DELIVERED" : "OTP_DELIVERY_FAILED",
    recoveryReason, async user => {
      if (user.accountRecoveryState?.id !== challengeId ||
          user.accountRecoveryState?.status !== "OTP_SENDING") throw R.fail("Recovery changed. Refresh before proceeding.", 409);
      user.accountRecoveryState = { ...user.accountRecoveryState,
        status: sent.success ? "CHALLENGE_SENT" : "DELIVERY_FAILED" };
      return { action };
    });
  if (!sent.success) throw R.fail("Verification email could not be delivered. No recovery was authorized.", 503);
  return { challengeId, expiresAt, message: "Verification code sent to the customer's existing verified email." };
}

async function verify(id, actor, body) {
  await reauthenticate(actor, body.currentPassword);
  const challengeId = typeof body.challengeId === "string" ? body.challengeId : "";
  const otp = typeof body.otp === "string" ? body.otp : "";
  if (!/^\d{6}$/.test(otp)) throw R.fail("Enter the six-digit customer verification code.");
  const token = crypto.randomBytes(32).toString("hex");
  const outcome = await transition(id, actor, "CUSTOMER_OWNERSHIP_CHECK", "Customer ownership verification", async user => {
    const state = user.accountRecoveryState;
    if (!R.eligible(user) || !R.verifiedEmail(user) || !R.live(state) ||
        state.id !== challengeId || state.actorId !== String(actor._id) ||
        state.status !== "CHALLENGE_SENT" || !R.equal(state.binding, R.binding(user))) {
      throw R.fail("Recovery challenge is invalid, changed or expired.", 409);
    }
    if (Number(state.attempts || 0) >= 5) throw R.fail("Verification attempts exhausted. Request a new challenge.", 429);
    const matches = R.equal(state.otpHash, R.mac(`${challengeId}:${otp}`));
    const next = { ...state, attempts: Number(state.attempts || 0) + 1 };
    if (!matches) {
      if (next.attempts >= 5) next.status = "LOCKED";
      user.accountRecoveryState = next;
      return { mismatch: true, status: next.status };
    }
    delete next.otpHash;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    if (state.action === "FORCE_PASSWORD_CHANGE") {
      user.mustChangePassword = true;
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      user.authTokenVersion = Number(user.authTokenVersion || 0) + 1;
      user.customerRefreshSessions = undefined;
      // Supply a customer-only reset link as well as enforcing the flag;
      // the Customer portal need not depend on staff-only temporary login UI.
      next.initiatedAction = state.action;
      next.action = "PASSWORD_RESET";
      next.binding = R.binding(user);
    }
    next.status = "LINK_SENDING";
    next.tokenHash = R.hash(token);
    next.expiresAt = Date.now() + R.TTL;
    next.completionAttempts = 0;
    user.accountRecoveryState = next;
    return { action: next.action, email: user.email, status: next.status };
  });
  if (outcome.mismatch) throw R.fail("Verification code is incorrect.", 400, "OTP_INCORRECT");
  const apiOrigin = String(process.env.ACCOUNT_RECOVERY_PUBLIC_API_ORIGIN || "https://api.servicepay.ng").replace(/\/$/, "");
  if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(apiOrigin)) throw R.fail("Secure recovery delivery is unavailable.", 503);
  const url = `${apiOrigin}/api/account-recovery/page#token=${token}&action=${outcome.action}`;
  const sent = await hooks.sendEmail({
    to: outcome.email, subject: "Complete your ServicePay account recovery",
    text: `Your ownership verification is complete. Open ${url} to set your new ` +
      `${outcome.action === "PIN_RECOVERY" ? "transaction PIN. Your current account password is also required" : "password"}. ` +
      "This single-use link expires in 15 minutes. Never share it or your credentials with anyone, including support staff. " +
      "If you did not request recovery, contact support@servicepay.ng.",
  });
  await transition(id, actor, sent.success ? "RECOVERY_LINK_DELIVERED" : "RECOVERY_LINK_DELIVERY_FAILED",
    "Customer-only recovery link delivery", async user => {
      const state = user.accountRecoveryState;
      if (state?.id !== challengeId || state.status !== "LINK_SENDING") throw R.fail("Recovery changed.", 409);
      user.accountRecoveryState = { ...state, status: sent.success ? "READY" : "DELIVERY_FAILED" };
      return { action: state.action };
    });
  if (!sent.success) throw R.fail("Recovery link could not be delivered. No credential was changed.", 503);
  return { message: "A single-use recovery link was sent directly to the verified customer. Staff cannot set their credential." };
}

async function complete(body) {
  if (typeof body.token !== "string" || !/^[a-f0-9]{64}$/.test(body.token) ||
      !["PASSWORD_RESET", "PIN_RECOVERY"].includes(body.action)) {
    throw R.fail("Recovery link is invalid or expired.");
  }
  const user = await User.findOne({ "accountRecoveryState.tokenHash": R.hash(body.token) })
    .select(privateFields);
  if (!user) throw R.fail("Recovery link is invalid or expired.");
  const actor = { _id: user._id, role: "CUSTOMER" };
  const action = body.action;
  if (action === "PASSWORD_RESET") {
    if (typeof body.newPassword !== "string" || body.newPassword.length > 200 ||
        body.newPassword !== body.confirmPassword) throw R.fail("Enter matching password and confirmation.");
    const validation = validateStrongPassword(body.newPassword);
    if (!validation.valid) throw R.fail(validation.message);
  } else if (typeof body.newPin !== "string" || !/^\d{4}$/.test(body.newPin) ||
             body.newPin !== body.confirmPin) {
    throw R.fail("Enter a matching four-digit PIN and confirmation.");
  }
  const done = await transition(user._id, actor, "CUSTOMER_COMPLETION_ATTEMPT",
    "Customer-controlled credential recovery", async current => {
      const state = current.accountRecoveryState;
      if (!R.eligible(current) || !R.verifiedEmail(current) || !R.live(state) ||
          state.status !== "READY" || state.action !== action ||
          !R.equal(state.tokenHash, R.hash(body.token)) ||
          !R.equal(state.binding, R.binding(current))) {
        throw R.fail("Recovery link is invalid, changed or expired.");
      }
      if (Number(state.completionAttempts || 0) >= 5) throw R.fail("Recovery verification attempts exhausted.", 429);
      if (action === "PIN_RECOVERY" && (
        typeof body.currentPassword !== "string" || body.currentPassword.length > 200 ||
        !/^\$2[aby]\$/.test(current.password || "") ||
        !await bcrypt.compare(body.currentPassword, current.password))) {
        current.accountRecoveryState = { ...state, completionAttempts: Number(state.completionAttempts || 0) + 1 };
        return { invalidPassword: true };
      }
      if (action === "PASSWORD_RESET") {
        if (/^\$2[aby]\$/.test(current.password || "") &&
            await bcrypt.compare(body.newPassword, current.password)) {
          throw R.fail("Choose a different password from your current password.");
        }
        // Reuse the User password hashing hook and the existing revocation version.
        current.password = body.newPassword;
        current.passwordChangedAt = new Date();
        current.mustChangePassword = false;
      } else {
        // Reuse the official PIN setter and hashing hook; never write a raw PIN through updates.
        current.setTransactionPin(body.newPin);
        current.transactionPinFailedAttempts = 0;
        current.transactionPinLockedUntil = null;
        current.transactionPinAttemptVersion = Number(current.transactionPinAttemptVersion || 0) + 1;
      }
      current.passwordResetToken = undefined;
      current.passwordResetExpires = undefined;
      current.customerRefreshSessions = undefined;
      current.authTokenVersion = Number(current.authTokenVersion || 0) + 1;
      current.accountRecoveryState = {
        id: state.id, action, actorId: state.actorId, reason: state.reason,
        status: "COMPLETED", completedAt: Date.now(), expiresAt: state.expiresAt,
      };
      return { email: current.email, action, status: "COMPLETED" };
    });
  if (done.invalidPassword) throw R.fail("Customer password verification failed.", 401);
  let notificationPending = false;
  try { notificationPending = !await notify(user._id, actor, done.email, action); }
  catch (_) { notificationPending = true; }
  return { message: "Recovery completed. Sign in again with your customer credentials.", notificationPending };
}

async function notify(id, actor, email, action) {
  const results = await Promise.allSettled([
    hooks.sendEmail({ to: email, subject: "ServicePay account security notification",
      text: "Your account recovery was completed. Existing sessions were revoked. " +
        "If you did not request this change, contact support@servicepay.ng immediately." }),
  ]);
  const delivered = results.map(r => r.status === "fulfilled" && r.value?.success !== false && !!r.value);
  await transition(id, actor, "COMPLETION_NOTIFICATION", "Customer security notification", async user => {
    user.accountRecoveryState = { ...user.accountRecoveryState,
      emailNotificationStatus: delivered.every(Boolean) ? "SENT" : "FAILED" };
    return { action, status: delivered.every(Boolean) ? "NOTIFIED" : "NOTIFICATION_REQUIRES_ATTENTION" };
  });
  return delivered.every(Boolean);
}

module.exports = { snapshot, start, verify, complete, reauthenticate, transition, hooks };
