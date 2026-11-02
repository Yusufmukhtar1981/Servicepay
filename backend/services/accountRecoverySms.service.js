"use strict";
// Recovery-only adapter using the existing Twilio account/sender configuration.
// Never changes Delivery SMS behavior or exposes provider bodies/credentials.
const configured = () => process.env.ACCOUNT_RECOVERY_PHONE_SMS_VERIFIED === "true" &&
  !!process.env.TWILIO_ACCOUNT_SID && !!process.env.TWILIO_AUTH_TOKEN &&
  !!process.env.TWILIO_FROM_NUMBER;
async function send({ phone, message }) {
  if (!configured()) return { success: false, status: "UNAVAILABLE" };
  try {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
        method: "POST", signal: AbortSignal.timeout(10000),
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: phone, From: process.env.TWILIO_FROM_NUMBER, Body: message }),
      });
    const payload = await response.json().catch(() => ({}));
    // Provider acceptance is not proof of handset delivery.
    return response.ok && /^SM[a-f0-9]{32}$/i.test(String(payload.sid || ""))
      ? { success: true, status: "ACCEPTED" }
      : { success: false, status: "FAILED" };
  } catch (_) {
    // A transport timeout might have occurred after acceptance. No automatic retry.
    return { success: false, status: "UNCONFIRMED" };
  }
}
module.exports = { configured, send };
