"use strict";
// Reuse the existing generic TTL rate store, with isolated keys. Never create
// collections or indexes from a recovery request or readiness check.
const Store = require("../models/privacyRequestRateLimit.model");
const R = require("./accountRecovery.rules");
function dailyLimit() {
  const raw = process.env.SERVICEPAY_VERIFY_SMS_DAILY_LIMIT;
  if (raw === undefined) return 50;
  return /^\d+$/.test(raw) && Number(raw) >= 1 && Number(raw) <= 1000 ? Number(raw) : 0;
}
async function ready() {
  if (!dailyLimit()) return false;
  try {
    const indexes = await Store.collection.indexes();
    return indexes.some(x => x.unique === true && x.key?.key === 1 &&
      x.key?.bucket === 1 && Object.keys(x.key).length === 2 &&
      !x.partialFilterExpression && !x.sparse);
  } catch (_) { return false; }
}
async function reserve(key, duration, maximum) {
  if (!await ready()) throw R.fail("Secure SMS admission is unavailable.", 503, "SMS_ADMISSION_UNAVAILABLE");
  const now = Date.now(), bucket = Math.floor(now / duration);
  try {
    await Store.findOneAndUpdate({ key, bucket, count: { $lt: maximum } },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((bucket + 2) * duration) } },
      { upsert: true, new: true });
  } catch (error) {
    if (error.code === 11000) throw R.fail("SMS request limit reached. Try later.", 429, "SMS_LIMIT_REACHED");
    throw R.fail("Secure SMS admission is unavailable.", 503, "SMS_ADMISSION_UNAVAILABLE");
  }
}
// Failed and uncertain dispatches remain charged against this allowance.
const reserveSend = () => reserve("verify-sms:global", 86400000, dailyLimit());
const reservePublicIp = ip => reserve(`verify-sms:public:${R.mac(String(ip || "unknown"))}`, 900000, 5);
module.exports = { ready, dailyLimit, reserveSend, reservePublicIp };
