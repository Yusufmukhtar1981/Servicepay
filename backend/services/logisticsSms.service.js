/* Twilio delivery OTP sender. Credentials are read only by the HTTP client and
 * never included in errors, logs, notifications, or persisted documents. */
const clean = (value, max = 256) => String(value || "").trim().slice(0, max);
exports.sendDeliveryOtp = async ({ phone, code }) => {
  const sid = clean(process.env.TWILIO_ACCOUNT_SID, 128);
  const token = clean(process.env.TWILIO_AUTH_TOKEN, 256);
  const from = clean(process.env.TWILIO_FROM_NUMBER, 64);
  if (!sid || !token || !from) return { sent: false, unavailable: true };
  const body = new URLSearchParams({ To: clean(phone, 32), From: from, Body: `Your ServicePay delivery verification code is ${code}. It expires in 10 minutes.` });
  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" }, body,
    });
    const payload = await response.json().catch(() => ({}));
    return response.ok && payload?.sid ? { sent: true, providerMessageId: payload.sid } : { sent: false, unavailable: false };
  } catch (_) { return { sent: false, unavailable: false }; }
};