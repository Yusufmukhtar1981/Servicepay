"use strict";
const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const User = require("../models/user.model");
const { protect } = require("../middleware/auth.middleware");
const { loadStaffRole } = require("../middleware/staffPermission.middleware");
const S = require("../services/accountRecovery.service");
const R = require("../services/accountRecovery.rules");
const Phone = require("../services/accountRecoveryPhone.service");

const adminRouter = express.Router();
const customerRouter = express.Router();
const safe = fn => async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    return res.json({ success: true, ...await fn(req) });
  } catch (error) {
    // Never log request bodies, OTPs, completion tokens or credential errors.
    return res.status(error.statusCode || 503).json({
      success: false, code: error.code || "RECOVERY_UNAVAILABLE",
      message: error.statusCode ? error.message : "Recovery is temporarily unavailable. Contact support.",
    });
  }
};
const permissions = req => Array.isArray(req.staffRole?.permissions)
  ? req.staffRole.permissions.filter(p => Object.values(R.PERMISSIONS).includes(p)) : [];
const guard = permission => (req, res, next) => {
  if (!R.authorized(req.user?.role, permissions(req), permission)) {
    return res.status(403).json({ success: false, message: "Explicit Head Office recovery permission is required." });
  }
  next();
};
adminRouter.use(protect, loadStaffRole, require("../middleware/adminAccessLog.middleware"), guard(R.PERMISSIONS.VIEW));
adminRouter.get("/provider-readiness", safe(() => require("../services/twilioVerify.service").probe()));
adminRouter.use("/:id", (req, res, next) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) {
    return res.status(400).json({ success: false, message: "Invalid customer identifier." });
  }
  next();
});
adminRouter.get("/:id", safe(req => S.snapshot(req.params.id, permissions(req))));
adminRouter.post("/:id/challenge", safe(async req => {
  const needed = R.ACTIONS[req.body?.action];
  if (!needed || !R.authorized(req.user.role, permissions(req), needed)) {
    throw R.fail("This recovery action is not permitted.", 403);
  }
  return S.start(req.params.id, req.user, req.body || {});
}));
adminRouter.post("/:id/verify", safe(async req => {
  const user = await User.findById(req.params.id).select("+accountRecoveryState").lean();
  const needed = R.ACTIONS[user?.accountRecoveryState?.action];
  if (!needed || !R.authorized(req.user.role, permissions(req), needed)) {
    throw R.fail("This recovery action is not permitted.", 403);
  }
  return S.verify(req.params.id, req.user, req.body || {});
}));
adminRouter.post("/:id/contact-verification", guard(R.PERMISSIONS.PASSWORD),
  safe(req => Phone.requestIdentityReview(req.params.id, req.user, req.body || {})));
customerRouter.get("/page", (req, res) => {
  res.set({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  });
  res.sendFile(path.join(__dirname, "../views/accountRecovery.html"));
});
customerRouter.post("/complete", safe(req => S.complete(req.body || {})));
customerRouter.post("/phone-verification/challenge", protect, safe(req => {
  if (req.user?.role !== "CUSTOMER") throw R.fail("Customer access only.", 403);
  return require("../services/accountRecoveryVerify.service").start(req.user._id, req.user, req.body || {}, true);
}));
// Advisory per-IP ceiling complements durable, five-attempt customer challenges.
// Bounded memory and fail-closed admission; never trust client-supplied IP headers.
const phoneClients = new Map();
customerRouter.post("/phone/verify", (req, res, next) => {
  const now = Date.now(), key = String(req.ip || "unknown");
  let rate = phoneClients.get(key);
  if (!rate || rate.until <= now) {
    if (phoneClients.size >= 5000) {
      for (const [ip, item] of phoneClients) if (item.until <= now) phoneClients.delete(ip);
      if (phoneClients.size >= 5000) return res.status(503).json({ success: false, message: "Recovery is temporarily busy." });
    }
    rate = { count: 0, until: now + Phone.OTP_TTL };
    phoneClients.set(key, rate);
  }
  if (++rate.count > 30) return res.status(429).json({ success: false, message: "Wait before trying recovery again." });
  next();
}, safe(req => Phone.verify(req.body || {})));
module.exports = { adminRouter, customerRouter, permissions, guard };
