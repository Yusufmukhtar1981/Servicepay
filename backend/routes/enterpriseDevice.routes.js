const express = require("express");
const { controller, handler } = require("../controllers/enterpriseDevice.controller");
const { DeviceError } = require("../services/deviceValidation.service");
function permission(name) {
  return (req, res, next) => {
    const access = req.staffAccess;
    if (access?.isHeadOffice || (access?.scope?.type === "GLOBAL" &&
        access.permissions?.includes(name))) return next();
    return res.status(403).json({ success: false, message: "Enterprise Devices permission required." });
  };
}
function rateLimit(limit) {
  const entries = new Map();
  return (req, res, next) => {
    const now = Date.now();
    for (const [key, value] of entries) if (value.until <= now) entries.delete(key);
    const key = String(req.user?._id || req.ip || req.socket.remoteAddress);
    if (!entries.has(key) && entries.size >= 5000) return res.status(503).json({ success: false, message: "Try again later." });
    const entry = entries.get(key) || { count: 0, until: now + 60_000 };
    entries.set(key, entry);
    if (++entry.count > limit) return res.status(429).set("Retry-After", "60").json({ success: false, message: "Too many device requests; retry later." });
    next();
  };
}
function payload(req, res, next) {
  if (["POST", "PUT", "PATCH"].includes(req.method) &&
      (!req.body || Array.isArray(req.body) || typeof req.body !== "object" || JSON.stringify(req.body).length > 32768)) {
    return res.status(400).json({ success: false, message: "A small JSON object is required." });
  }
  res.set("Cache-Control", "no-store");
  next();
}
function createAdminRouter(options = {}) {
  const c = controller(options.connection);
  const router = express.Router();
  router.use(options.protect || require("../middleware/auth.middleware").protect,
    options.loadStaffRole || require("../middleware/staffPermission.middleware").loadStaffRole);
  router.use(rateLimit(120), permission("enterprise.devices.view"), payload, c.ready);
  const manage = permission("enterprise.devices.manage"), enroll = permission("enterprise.devices.enroll");
  router.get("/overview", c.overview);
  router.post("/search", c.search);
  router.get("/staff", c.staff);
  router.get("/reports", c.reports);
  router.get("/settings", c.settings);
  router.put("/settings", manage, c.saveSettings);
  router.post("/", manage, c.register);
  router.get("/:id/history", c.history);
  router.get("/:id", c.details);
  router.post("/:id/assign", manage, c.assign);
  router.patch("/:id/status", manage, c.status);
  router.post("/:id/enrollment", enroll, c.enrollment);
  router.post("/:id/revoke", enroll, c.revoke);
  return router;
}
function createCompanionRouter(options = {}) {
  const c = controller(options.connection), router = express.Router();
  router.use((req, res, next) => {
    const loopbackTest = process.env.NODE_ENV === "test" &&
      ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);
    if (req.secure || loopbackTest) return next();
    return res.status(400).json({ success: false, message: "HTTPS is required." });
  });
  router.use(rateLimit(90), payload, c.ready);
  router.post("/register", rateLimit(10), c.enroll);
  router.use(async (req, res, next) => {
    try {
      const header = req.headers.authorization || "";
      if (!header.startsWith("Bearer ")) throw new DeviceError("Device authorization required.", 401);
      req.deviceAuth = await c.service.authenticate(header.slice(7), req.headers["x-device-installation"]);
      next();
    } catch (error) {
      return res.status(error.status || 401).json({ success: false, message: error instanceof DeviceError ? error.message : "Device authorization failed." });
    }
  });
  router.get("/config", c.config);
  router.post("/sync", c.sync);
  router.post("/heartbeat", c.heartbeat);
  router.post("/rotate", c.rotate);
  return router;
}
module.exports = { createAdminRouter, createCompanionRouter, permission, rateLimit };
