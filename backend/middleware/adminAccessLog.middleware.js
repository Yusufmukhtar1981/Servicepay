const AdminAccessLog = require("../models/adminAccessLog.model");

// Attach only after protect/loadStaffRole. Never record request bodies, query
// strings, credentials, or response content.
module.exports = (req, res, next) => {
  res.once("finish", () => {
    const actorId = req.user?._id || req.user?.id;
    if (!actorId) return;
    const forwarded = String(req.headers["x-forwarded-for"] || req.ip || "");
    AdminAccessLog.create({
      actorId,
      actorRole: String(req.user?.role || "").toUpperCase(),
      method: req.method,
      path: String(req.baseUrl + req.path).split("?")[0],
      statusCode: res.statusCode,
      ipAddress: forwarded.split(",")[0].trim(),
      userAgent: String(req.headers["user-agent"] || ""),
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    }).catch(() => {});
  });
  next();
};