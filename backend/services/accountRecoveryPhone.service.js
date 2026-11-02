"use strict";
const crypto = require("crypto");
const User = require("../models/user.model");
const R = require("./accountRecovery.rules");
const S = require("./accountRecovery.service");
const Sms = require("./accountRecoverySms.service");
const OTP_TTL = 5 * 60 * 1000;
const hooks = { configured: Sms.configured, sendSms: Sms.send };
function available(user) {
  const Verify = require("./accountRecoveryVerify.service");
  return Verify.hooks.ready() ? Verify.available(user) :
    R.eligible(user) && R.verifiedPhone(user) && hooks.configured();
}
function publicOrigin() {
  const origin = String(process.env.ACCOUNT_RECOVERY_PUBLIC_API_ORIGIN || "https://api.servicepay.ng").replace(/\/$/, "");
  if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(origin)) throw R.fail("Secure recovery delivery is unavailable.", 503);
  return origin;
}
async function start(id, actor, body) {
  const Verify = require("./accountRecoveryVerify.service");
  if (Verify.hooks.ready()) return Verify.start(id, actor, body);
  if (body.action !== "PASSWORD_RESET") throw R.fail("Phone OTP supports password recovery only.");
  const recoveryReason = R.reason(body.reason);
  await S.reauthenticate(actor, body.currentPassword);
  if (!hooks.configured()) throw R.fail("Phone verification delivery is temporarily unavailable.", 503, "SMS_UNAVAILABLE");
  const origin = publicOrigin();
  const otp = String(crypto.randomInt(100000, 1000000));
  const challengeId = crypto.randomUUID(), expiresAt = Date.now() + OTP_TTL;
  const delivery = await S.transition(id, actor, "PHONE_CHALLENGE_REQUESTED", recoveryReason, async user => {
    if (!R.eligible(user) || !R.verifiedPhone(user)) {
      throw R.fail("An existing verified customer phone number is required.", 409, "IDENTITY_VERIFICATION_REQUIRED");
    }
    const rate = user.accountRecoveryRate || {};
    if (rate.lastSentAt && Number(rate.lastSentAt) > Date.now() - 60000) {
      throw R.fail("Wait at least 60 seconds before requesting another recovery code.", 429);
    }
    const bucket = Math.floor(Date.now() / 3600000);
    const count = rate.bucket === bucket ? Number(rate.count || 0) : 0;
    if (count >= 3) throw R.fail("Customer recovery request limit reached. Try later.", 429);
    if (Verify.busy(user.accountRecoveryState) ||
        (R.live(user.accountRecoveryState) && ["READY", "LINK_SENDING"].includes(user.accountRecoveryState.status))) {
      throw R.fail("A customer recovery authorization is already active.", 409);
    }
    user.accountRecoveryRate = { bucket, count: count + 1, lastSentAt: Date.now() };
    user.accountRecoveryState = {
      id: challengeId, action: "PASSWORD_RESET", channel: "PHONE",
      actorId: String(actor._id), status: "OTP_SENDING", deliveryStatus: "SENDING",
      otpHash: R.mac(`phone:${challengeId}:${otp}`), expiresAt, attempts: 0,
      binding: R.binding(user, "PHONE"), reason: recoveryReason,
    };
    return { phone: R.normalizePhone(user.phone), action: "PASSWORD_RESET" };
  });
  let sent;
  try {
    sent = await hooks.sendSms({ phone: delivery.phone,
      message: `ServicePay password recovery code: ${otp}. Expires in 5 minutes. ` +
        `Enter it yourself at ${origin}/api/account-recovery/page#challenge=${challengeId}&action=PHONE_OTP ` +
        "Do not share this code with anyone, including staff. Ignore if not requested." });
  } catch (_) { sent = { success: false, status: "UNCONFIRMED" }; }
  await S.transition(id, actor, sent.success ? "PHONE_OTP_ACCEPTED" : "PHONE_OTP_DELIVERY_FAILED",
    recoveryReason, async user => {
      if (user.accountRecoveryState?.id !== challengeId || user.accountRecoveryState.status !== "OTP_SENDING") {
        throw R.fail("Recovery changed. Refresh before proceeding.", 409);
      }
      user.accountRecoveryState = { ...user.accountRecoveryState,
        status: sent.success ? "CHALLENGE_SENT" : "DELIVERY_FAILED",
        deliveryStatus: sent.success ? "ACCEPTED" :
          sent.status === "UNCONFIRMED" ? "UNCONFIRMED" : "FAILED" };
      return { action: "PASSWORD_RESET" };
    });
  if (!sent.success) throw R.fail("SMS delivery was not confirmed. No recovery was authorized. Refresh before retrying.", 503, "SMS_DELIVERY_FAILED");
  return { challengeId, channel: "PHONE", expiresAt,
    message: "SMS accepted by the provider. The customer must verify privately; handset delivery is not yet confirmed." };
}
async function verify(body) {
  if (typeof body.challengeId !== "string" ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(body.challengeId) ||
      typeof body.otp !== "string" || !/^\d{6}$/.test(body.otp)) {
    throw R.fail("Enter a valid recovery link and six-digit code.");
  }
  const found = await User.findOne({ "accountRecoveryState.id": body.challengeId })
    .select("+accountRecoveryState").lean();
  if (!found) throw R.fail("Recovery challenge is invalid or expired.");
  if (found.accountRecoveryState?.provider === "TWILIO_VERIFY") {
    return require("./accountRecoveryVerify.service").verify(found, body);
  }
  const token = crypto.randomBytes(32).toString("hex");
  const result = await S.transition(found._id, { _id: found._id, role: "CUSTOMER" },
    "PHONE_CUSTOMER_OWNERSHIP_CHECK", "Customer-controlled phone ownership verification", async user => {
      const state = user.accountRecoveryState;
      if (!R.eligible(user) || !R.verifiedPhone(user) || !R.live(state) ||
          state.id !== body.challengeId || state.channel !== "PHONE" ||
          state.action !== "PASSWORD_RESET" || state.status !== "CHALLENGE_SENT" ||
          !R.equal(state.binding, R.binding(user, "PHONE"))) {
        throw R.fail("Recovery challenge is invalid, changed or expired.");
      }
      if (Number(state.attempts || 0) >= 5) throw R.fail("Verification attempts exhausted.", 429);
      const next = { ...state, attempts: Number(state.attempts || 0) + 1 };
      if (!R.equal(state.otpHash, R.mac(`phone:${body.challengeId}:${body.otp}`))) {
        if (next.attempts >= 5) next.status = "LOCKED";
        user.accountRecoveryState = next;
        return { mismatch: true };
      }
      delete next.otpHash;
      next.status = "READY";
      next.expiresAt = Date.now() + R.TTL;
      next.tokenHash = R.hash(token);
      next.completionAttempts = 0;
      user.accountRecoveryState = next;
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      return { expiresAt: next.expiresAt, action: "PASSWORD_RESET" };
    });
  if (result.mismatch) throw R.fail("Verification code is incorrect.", 400, "OTP_INCORRECT");
  // Only the customer-controlled interface gets this credential; no Admin route calls verify().
  return { token, action: "PASSWORD_RESET", expiresAt: result.expiresAt };
}
async function requestIdentityReview(id, actor, body) {
  const recoveryReason = R.reason(body.reason);
  await S.reauthenticate(actor, body.currentPassword);
  return S.transition(id, actor, "IDENTITY_VERIFICATION_REQUESTED", recoveryReason, async user => {
    if (!R.eligible(user)) throw R.fail("Customer account restrictions must be preserved.", 409);
    if (R.verifiedEmail(user) || R.verifiedPhone(user)) {
      throw R.fail("Use an existing verified recovery channel; this review is for customers without one.", 409);
    }
    if (R.live(user.accountRecoveryState)) throw R.fail("An identity or recovery request already exists. Review its history.", 409);
    const requestId = crypto.randomUUID();
    user.accountRecoveryState = { id: requestId, action: "CONTACT_VERIFICATION",
      actorId: String(actor._id), status: "IDENTITY_VERIFICATION_REQUIRED",
      expiresAt: Date.now() + 86400000, reason: recoveryReason };
    return { requestId, status: "IDENTITY_VERIFICATION_REQUIRED",
      message: "Identity review recorded. An approved independent ownership verification process is required before any contact can become trusted. This request does not verify contacts or authorize recovery." };
  });
}
module.exports = { OTP_TTL, hooks, available, start, verify, requestIdentityReview };
