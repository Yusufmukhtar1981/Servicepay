"use strict";
const express = require("express");
const { protect, adminOnly } = require("../middleware/auth.middleware");
const { loadStaffRole, requirePermission } = require("../middleware/staffPermission.middleware");
const { STAFF_PERMISSIONS: P } = require("../config/staffPermissions");
const service = require("../services/adminManagementPerformance.service");
const router = express.Router();
// Viewing management reports is not authority to reassign customers. Existing
// hierarchy mutation routes still require explicit hierarchy.manage.
router.use(protect, adminOnly("HEAD_OFFICE", "HEAD_OFFICE_ADMIN", "ADMIN", "SUPER_ADMIN", "SERVICEPAY_SUPER_ADMIN"),
  loadStaffRole, requirePermission(P.USERS_VIEW));
router.use((req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); });
const wrap = fn => async (req, res) => {
  try { await fn(req, res); }
  catch (e) {
    const status = Number(e.status) || (e.code === 50 ? 503 : 500);
    res.status(status).json({ success: false, message: status < 500 ? e.message : "Management report is temporarily unavailable. Narrow the dates and retry." });
  }
};
router.get("/managers", wrap(async (req, res) => res.json({ success: true, data: await service.managers(req.query) })));
router.get("/report", wrap(async (req, res) => res.json({ success: true, data: await service.report(req.query) })));
router.get("/export", wrap(async (req, res) => {
  const format = String(req.query.format || "");
  if (!["pdf", "xlsx"].includes(format)) return res.status(400).json({ success: false, message: "Choose PDF or Excel." });
  const report = await service.report(req.query);
  const bytes = await service.exportReport(report, format);
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Report-Generated-At", new Date(report.generatedAt).toISOString());
  res.attachment(`servicepay-management-${report.manager.role.toLowerCase()}-${report.manager._id}.${format}`);
  res.type(format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").send(bytes);
}));
module.exports = router;
