"use strict";
const R = require("./accountRecovery.rules");
const hooks = { fetch: (...args) => fetch(...args) };
const sid = () => String(process.env.TWILIO_VERIFY_SERVICE_SID || "").trim();
const credentialsConfigured = () => /^VA[0-9a-f]{32}$/i.test(sid()) &&
  /^AC[0-9a-f]{32}$/i.test(process.env.TWILIO_ACCOUNT_SID || "") &&
  !!process.env.TWILIO_AUTH_TOKEN;
function enabled(phone) {
  if (!credentialsConfigured() || process.env.SERVICEPAY_TWILIO_VERIFY_ENABLED !== "true") return false;
  if (process.env.SERVICEPAY_TWILIO_VERIFY_DELIVERY_VERIFIED === "true") return true;
  const test = R.normalizePhone(process.env.TWILIO_VERIFY_TEST_PHONE);
  return !!test && (!phone || R.normalizePhone(phone) === test);
}
async function request(path, data) {
  if (!credentialsConfigured()) return { success: false, status: "UNAVAILABLE" };
  try {
    const response = await hooks.fetch(`https://verify.twilio.com/v2/Services/${sid()}${path}`, {
      method: data ? "POST" : "GET",
      headers: { Authorization: "Basic " + Buffer.from(
        process.env.TWILIO_ACCOUNT_SID + ":" + process.env.TWILIO_AUTH_TOKEN).toString("base64"),
      ...(data ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
      ...(data ? { body: new URLSearchParams(data).toString() } : {}),
      signal: AbortSignal.timeout(10000),
    });
    let body = {};
    try { body = await response.json(); } catch (_) {}
    if (!response.ok) return { success: false, status: response.status === 404 ? "EXPIRED_OR_UNAVAILABLE" :
      response.status === 429 ? "RATE_LIMITED" : "REJECTED", httpStatus: response.status,
      errorCode: Number.isInteger(body.code) ? body.code : null };
    return { success: true, httpStatus: response.status, body };
  } catch (_) { return { success: false, status: "UNCONFIRMED" }; }
}
const owned = body => body.service_sid === sid() && body.account_sid === process.env.TWILIO_ACCOUNT_SID;
async function start(phone) {
  if (!enabled(phone) || !R.normalizePhone(phone)) return { success: false, status: "UNAVAILABLE" };
  // Managed Verify codes; never CustomCode, sender override or disabled RiskCheck.
  const result = await request("/Verifications", { To: R.normalizePhone(phone), Channel: "sms", RiskCheck: "enable" });
  if (!result.success) return result;
  const b = result.body, createdAt = Date.parse(b.date_created);
  if (!owned(b) || !/^VE[0-9a-f]{32}$/i.test(b.sid || "") ||
      b.to !== R.normalizePhone(phone) || b.channel !== "sms" || b.status !== "pending" ||
      !Number.isFinite(createdAt) || createdAt > Date.now() + 30000) {
    return { success: false, status: "UNCONFIRMED", httpStatus: result.httpStatus };
  }
  return { success: true, status: "ACCEPTED", verificationSid: b.sid, createdAt,
    serviceFingerprint: R.hash(sid()), httpStatus: result.httpStatus };
}
async function check({ verificationSid, phone, code, serviceFingerprint }) {
  if (!enabled(phone) || !R.equal(serviceFingerprint, R.hash(sid())) ||
      !/^VE[0-9a-f]{32}$/i.test(verificationSid || "") || !/^\d{6}$/.test(code || "")) {
    return { success: false, status: "UNAVAILABLE" };
  }
  // Check the exact stored verification, not just a phone number shared by purposes.
  const result = await request("/VerificationCheck", { VerificationSid: verificationSid, Code: code });
  if (!result.success) return result;
  const b = result.body;
  if (!owned(b) || b.sid !== verificationSid || b.to !== R.normalizePhone(phone) || b.channel !== "sms") {
    return { success: false, status: "UNCONFIRMED", httpStatus: result.httpStatus };
  }
  return { success: true, status: b.status === "approved" ? "APPROVED" :
    b.status === "pending" ? "INCORRECT" : "REJECTED", httpStatus: result.httpStatus };
}
async function probe() {
  const r = await request("");
  const b = r.body || {};
  return { credentialsConfigured: credentialsConfigured(), httpStatus: r.httpStatus || null,
    serviceAccessible: r.success && b.sid === sid() && b.account_sid === process.env.TWILIO_ACCOUNT_SID &&
      b.friendly_name === "Servicepay OTP" && b.code_length === 6,
    serviceNameMatches: b.friendly_name === "Servicepay OTP", codeLength: b.code_length || null,
    errorCode: r.errorCode || null, sendingEnabled: enabled(),
    deliveryVerified: process.env.SERVICEPAY_TWILIO_VERIFY_DELIVERY_VERIFIED === "true",
    geographicPermission: "CONSOLE_CONFIRMATION_REQUIRED", realSmsTestPerformed: false };
}
module.exports = { hooks, credentialsConfigured, enabled, start, check, probe };
