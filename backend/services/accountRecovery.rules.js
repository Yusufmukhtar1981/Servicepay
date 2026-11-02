"use strict";
const crypto = require("crypto");
const TTL = 15 * 60 * 1000;
const PERMISSIONS = Object.freeze({
  VIEW: "VIEW_ACCOUNT_RECOVERY",
  PASSWORD: "INITIATE_PASSWORD_RESET",
  UNLOCK: "UNLOCK_CUSTOMER_ACCOUNT",
  PIN: "INITIATE_PIN_RECOVERY",
  AUDIT: "VIEW_RECOVERY_AUDIT_LOG",
});
const ACTIONS = Object.freeze({
  PASSWORD_RESET: PERMISSIONS.PASSWORD,
  FORCE_PASSWORD_CHANGE: PERMISSIONS.PASSWORD,
  PIN_RECOVERY: PERMISSIONS.PIN,
  UNLOCK: PERMISSIONS.UNLOCK,
});
const fail = (message, statusCode = 400, code = "RECOVERY_UNAVAILABLE") =>
  Object.assign(new Error(message), { statusCode, code });
const hash = value => crypto.createHash("sha256").update(String(value)).digest("hex");
const mac = value => {
  if (!process.env.JWT_SECRET) throw fail("Recovery is temporarily unavailable.", 503);
  return crypto.createHmac("sha256", process.env.JWT_SECRET)
    .update(`servicepay-account-recovery:${value}`).digest("hex");
};
const equal = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
};
const verifiedEmail = user => user.emailVerified === true &&
  user.profileRecoveryBlocked?.email !== true &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(user.email || ""));
const binding = user => mac(JSON.stringify([
  String(user._id), user.email, user.emailVerified === true,
  user.profileRecoveryBlocked?.email === true, Number(user.authTokenVersion || 0),
]));
const eligible = user => !!user && user.role === "CUSTOMER" &&
  user.status === "ACTIVE" && user.isDeleted !== true && user.activationPending !== true;
const authorized = (role, permissions, permission) =>
  role === "HEAD_OFFICE" && Array.isArray(permissions) && permissions.includes(permission);
const live = state => !!state && Number(state.expiresAt) > Date.now();
const reason = value => {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < 10 || text.length > 500 ||
      /(?:password|pin|token|secret|otp)\s*[:=]/i.test(text)) {
    throw fail("Enter a recovery reason of 10–500 characters without credentials.");
  }
  return text;
};
module.exports = { TTL, PERMISSIONS, ACTIONS, fail, hash, mac, equal, verifiedEmail,
  binding, eligible, authorized, live, reason };
