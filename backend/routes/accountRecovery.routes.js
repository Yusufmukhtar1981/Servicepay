"use strict";
const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const User = require("../models/user.model");
const { protect } = require("../middleware/auth.middleware");
const { loadStaffRole } = require("../middleware/staffPermission.middleware");
const S = require("../services/accountRecovery.service");
const R = require("../services/accountRecovery.rules");

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
module.exports = { adminRouter, customerRouter, permissions, guard };
