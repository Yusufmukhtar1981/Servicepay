"use strict";
const crypto = require("crypto");
const User = require("../models/user.model");
const R = require("./accountRecovery.rules");
const S = require("./accountRecovery.service");
const Provider = require("./twilioVerify.service");
const OTP_TTL = 300000, PROVIDER_LEASE = 600000;
const hooks = { ready: Provider.enabled, start: Provider.start, check: Provider.check };
const available = user => R.eligible(user) && R.verifiedPhone(user) && hooks.ready(user.phone);
function entryUrl(challengeId) {
  const origin = String(process.env.ACCOUNT_RECOVERY_PUBLIC_API_ORIGIN || "https://api.servicepay.ng").replace(/\/$/, "");
  if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(origin)) throw R.fail("Secure verification is unavailable.", 503);
  return `${origin}/api/account-recovery/page#challenge=${challengeId}&action=PHONE_OTP`;
}
function busy(state) {
  return (Number(state?.providerLeaseUntil) > Date.now() &&
    !["COMPLETED", "PHONE_VERIFIED"].includes(state?.status)) ||
    (R.live(state) && ["READY", "LINK_SENDING", "VERIFYING"].includes(state.status));
}
function valid(user, state, challengeId) {
  return R.eligible(user) && R.live(state) && state.id === challengeId &&
    state.provider === "TWILIO_VERIFY" && state.channel === "PHONE" &&
    R.equal(state.binding, R.binding(user, "PHONE")) &&
    (state.action === "PHONE_VERIFICATION"
      ? !!R.normalizePhone(user.phone) && user.profileRecoveryBlocked?.phone !== true
      : ["PASSWORD_RESET", "PIN_RECOVERY"].includes(state.action) && R.verifiedPhone(user));
}
async function start(id, actor, body, self = false) {
  const action = self ? "PHONE_VERIFICATION" : body.action;
  if (!["PASSWORD_RESET", "PIN_RECOVERY", "PHONE_VERIFICATION"].includes(action) ||
      (!self && action === "PHONE_VERIFICATION")) throw R.fail("Unsupported phone verification action.");
  const reason = self ? "Customer requested verification of their existing phone" : R.reason(body.reason);
  try { await S.reauthenticate(actor, body.currentPassword); }
  catch (error) {
    if (self && error.statusCode === 401) error.message = "Current customer password verification failed.";
    throw error;
  }
  const challengeId = crypto.randomUUID(), url = entryUrl(challengeId);
  const delivery = await S.transition(id, actor, "VERIFY_CHALLENGE_REQUESTED", reason, async user => {
    if (!R.eligible(user) || !R.normalizePhone(user.phone) || user.profileRecoveryBlocked?.phone === true ||
        (!self && !R.verifiedPhone(user))) throw R.fail("An eligible trusted customer phone is required.", 409);
    if (self && (actor.role !== "CUSTOMER" || String(actor._id) !== String(user._id))) throw R.fail("Customer access only.", 403);
    if (!hooks.ready(user.phone)) throw R.fail("Twilio Verify sending is not activated.", 503, "VERIFY_UNAVAILABLE");
    if (self) {
      if (user.phoneVerified === true) throw R.fail("Your existing phone is already verified.", 409);
      if (Number(user.authTokenVersion || 0) !== Number(actor.authTokenVersion || 0)) throw R.fail("Sign in again before verification.", 401);
    }
    const rate = user.accountRecoveryRate || {}, bucket = Math.floor(Date.now() / 3600000);
    if (Number(rate.lastSentAt || 0) > Date.now() - 60000 ||
        (rate.bucket === bucket && Number(rate.count || 0) >= 3)) throw R.fail("Verification request limit reached. Try later.", 429);
    if (busy(user.accountRecoveryState) || (R.live(user.accountRecoveryState) &&
        user.accountRecoveryState.channel === "PHONE")) throw R.fail("An existing phone verification must finish or expire.", 409);
    user.accountRecoveryRate = { bucket, count: rate.bucket === bucket ? Number(rate.count || 0) + 1 : 1, lastSentAt: Date.now() };
    user.accountRecoveryState = { id: challengeId, action, channel: "PHONE", provider: "TWILIO_VERIFY",
      actorId: String(actor._id), reason, status: "OTP_SENDING", deliveryStatus: "SENDING",
      expiresAt: Date.now() + OTP_TTL, providerLeaseUntil: Date.now() + PROVIDER_LEASE,
      binding: R.binding(user, "PHONE"), attempts: 0 };
    return { phone: R.normalizePhone(user.phone) };
  });
  let sent;
  try { sent = await hooks.start(delivery.phone); } catch (_) { sent = { success: false, status: "UNCONFIRMED" }; }
  const result = await S.transition(id, actor, "VERIFY_SEND_RESULT", reason, async user => {
    const state = user.accountRecoveryState;
    if (state?.id !== challengeId || state.status !== "OTP_SENDING") throw R.fail("Verification changed.", 409);
    const expiresAt = sent.success ? Math.min(state.expiresAt, sent.createdAt + OTP_TTL) : state.expiresAt;
    const accepted = sent.success === true && /^VE[0-9a-f]{32}$/i.test(sent.verificationSid || "") &&
      /^[0-9a-f]{64}$/.test(sent.serviceFingerprint || "") && expiresAt > Date.now();
    user.accountRecoveryState = { ...state, expiresAt,
      status: accepted ? "CHALLENGE_SENT" : "DELIVERY_FAILED",
      deliveryStatus: accepted ? "ACCEPTED" : sent.status === "UNCONFIRMED" ? "UNCONFIRMED" : "FAILED",
      providerHttpStatus: Number.isInteger(sent.httpStatus) ? sent.httpStatus : null,
      providerErrorCode: Number.isInteger(sent.errorCode) ? sent.errorCode : null,
      ...(accepted ? { verificationSid: sent.verificationSid, serviceFingerprint: sent.serviceFingerprint } : {}) };
    return { accepted, expiresAt, providerHttpStatus: sent.httpStatus,
      providerErrorCode: sent.errorCode, providerResult: sent.status };
  });
  if (!result.accepted) throw R.fail("Verify did not confirm a fresh SMS request. No recovery was authorized.", 503, "VERIFY_SEND_UNCONFIRMED");
  return { challengeId, channel: "PHONE", action, expiresAt: result.expiresAt, customerEntryUrl: url,
    message: "Twilio accepted the SMS request, not proof of delivery. Give the customer this entry link; only they enter the code." };
}
async function verify(found, body) {
  const actor = { _id: found._id, role: "CUSTOMER" }, checkId = crypto.randomUUID();
  const reserved = await S.transition(found._id, actor, "VERIFY_CUSTOMER_CHECK_STARTED",
    "Customer-controlled phone verification", async user => {
      const state = user.accountRecoveryState;
      if (!valid(user, state, body.challengeId) || state.status !== "CHALLENGE_SENT") throw R.fail("Verification is changed, expired or already being checked.");
      if (Number(state.attempts || 0) >= 5) throw R.fail("Verification attempts exhausted.", 429);
      user.accountRecoveryState = { ...state, status: "VERIFYING", checkId, attempts: Number(state.attempts || 0) + 1 };
      return { verificationSid: state.verificationSid, serviceFingerprint: state.serviceFingerprint,
        phone: R.normalizePhone(user.phone) };
    });
  let checked;
  try { checked = await hooks.check({ ...reserved, code: body.otp }); }
  catch (_) { checked = { success: false, status: "UNCONFIRMED" }; }
  const token = crypto.randomBytes(32).toString("hex");
  const result = await S.transition(found._id, actor, "VERIFY_CUSTOMER_CHECK_RESULT",
    "Customer-controlled phone ownership result", async user => {
      const state = user.accountRecoveryState;
      if (!valid(user, state, body.challengeId) || state.status !== "VERIFYING" || state.checkId !== checkId) {
        throw R.fail("Verification changed or expired. No recovery was authorized.");
      }
      const next = { ...state }; delete next.checkId;
      next.providerHttpStatus = Number.isInteger(checked.httpStatus) ? checked.httpStatus : null;
      next.providerErrorCode = Number.isInteger(checked.errorCode) ? checked.errorCode : null;
      if (!checked.success || checked.status !== "APPROVED") {
        next.status = checked.success && checked.status === "INCORRECT"
          ? next.attempts >= 5 ? "LOCKED" : "CHALLENGE_SENT" : "CHECK_UNCONFIRMED";
        user.accountRecoveryState = next;
        return { denied: true, uncertain: next.status === "CHECK_UNCONFIRMED",
          providerHttpStatus: checked.httpStatus, providerErrorCode: checked.errorCode, providerResult: checked.status };
      }
      delete next.verificationSid; delete next.serviceFingerprint; delete next.providerLeaseUntil;
      if (state.action === "PHONE_VERIFICATION") {
        user.phoneVerified = true;
        user.authTokenVersion = Number(user.authTokenVersion || 0) + 1;
        user.customerRefreshSessions = undefined;
        user.accountRecoveryState = { id: state.id, action: state.action, channel: "PHONE",
          provider: state.provider, status: "PHONE_VERIFIED", expiresAt: state.expiresAt, completedAt: Date.now() };
        return { action: "PHONE_VERIFICATION", verified: true, requiresLogin: true,
          providerHttpStatus: checked.httpStatus, providerResult: checked.status };
      }
      user.accountRecoveryState = { ...next, status: "READY", tokenHash: R.hash(token),
        expiresAt: Date.now() + R.TTL, completionAttempts: 0 };
      user.passwordResetToken = undefined; user.passwordResetExpires = undefined;
      return { action: state.action, expiresAt: user.accountRecoveryState.expiresAt,
        providerHttpStatus: checked.httpStatus, providerResult: checked.status };
    });
  if (result.denied) throw R.fail(result.uncertain
    ? "Provider verification is uncertain or unavailable. No recovery was authorized. Request assistance."
    : "Verification code is incorrect.", result.uncertain ? 503 : 400);
  return result.action === "PHONE_VERIFICATION"
    ? { action: result.action, verified: true, requiresLogin: true }
    : { action: result.action, expiresAt: result.expiresAt, token };
}
module.exports = { hooks, OTP_TTL, available, busy, start, verify };
