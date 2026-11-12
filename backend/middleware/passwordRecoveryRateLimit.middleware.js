"use strict";
const { createHash } = require("node:crypto");
const clients = new Map(), windowMs = 15 * 60 * 1000, maxKeys = 10000;

// Apply before account lookup: identical limits for existing/absent addresses.
// These bounded process-local abuse limits complement the persisted cooldown.
const passwordRecoveryRateLimit = (req, res, next) => {
  const now = Date.now();
  const email = String(req.body?.email || "").trim().toLowerCase().slice(0, 255);
  const keys = [
    [`ip:${req.ip || req.socket?.remoteAddress || "unknown"}`, 10],
    [`email:${createHash("sha256").update(email).digest("hex")}`, 3],
  ];
  let blocked = false, resetAt = now;
  for (const [key, limit] of keys) {
    let record = clients.get(key);
    if (!record || record.expires <= now) record = { count: 0, expires: now + windowMs };
    record.count++; clients.set(key, record);
    if (record.count > limit) { blocked = true; resetAt = Math.max(resetAt, record.expires); }
  }
  while (clients.size > maxKeys) clients.delete(clients.keys().next().value);
  res.set?.("Cache-Control", "no-store");
  if (!blocked) return next();
  res.set?.("Retry-After", String(Math.max(1, Math.ceil((resetAt - now) / 1000))));
  return res.status(429).json({ success: false,
    message: "Too many password reset requests. Please try again later." });
};
module.exports = { passwordRecoveryRateLimit, _resetForTests: () => clients.clear() };
