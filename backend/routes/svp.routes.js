const express = require("express");
const mongoose = require("mongoose");
const c = require("../controllers/svp.controller");
const { protect, adminOnly } = require("../middleware/auth.middleware");
const { loadStaffRole, requirePermission } = require("../middleware/staffPermission.middleware");
const { STAFF_PERMISSIONS: P } = require("../config/staffPermissions");
const router = express.Router();
const executiveManagement = [
  protect,
  adminOnly("HEAD_OFFICE", "HEAD_OFFICE_ADMIN", "SUPER_ADMIN", "ADMIN"),
];
const svp = [protect, adminOnly("SVP"), loadStaffRole];
const validId = (req, res, next) => mongoose.Types.ObjectId.isValid(req.params.id)
  ? next()
  : res.status(400).json({ success: false, message: "A valid id is required." });

router.post("/", ...executiveManagement, c.create);
router.get("/", ...executiveManagement, c.list);
router.get("/reports", ...executiveManagement, c.headOfficeReports);
router.get("/audit", ...executiveManagement, c.headOfficeAudit);
router.get("/me/metrics", ...svp, requirePermission(P.DASHBOARD_VIEW), c.metrics);
router.get("/me/transactions", ...svp, requirePermission(P.TRANSACTION_INTELLIGENCE_VIEW), c.transactions);
router.get("/me/staff-performance", ...svp, requirePermission(P.USERS_VIEW), c.staffPerformance);
router.get("/me/branch-performance", ...svp, requirePermission(P.BRANCHES_VIEW), c.branchPerformance);
router.post("/me/reports", ...svp, requirePermission(P.REPORTS_VIEW), c.createReport);
router.get("/me/reports", ...svp, requirePermission(P.REPORTS_VIEW), c.listReports);
router.get("/me/audit", ...svp, requirePermission(P.AUDIT_VIEW), c.audit);
router.get("/me/live-operations", ...svp, requirePermission(P.DASHBOARD_VIEW), c.liveOperations);
router.patch("/reports/:id/review", ...executiveManagement, validId, c.reviewReport);
router.get("/reports/:id", ...executiveManagement, validId, c.headOfficeReport);
router.patch("/me/reports/:id", ...svp, requirePermission(P.REPORTS_VIEW), validId, c.updateReport);
router.post("/me/reports/:id/submit", ...svp, requirePermission(P.REPORTS_VIEW), validId, c.submitReport);
router.patch("/:id/status", ...executiveManagement, validId, c.status);
router.post("/:id/reset-password", ...executiveManagement, validId, c.resetPassword);
router.post("/:id/revoke-sessions", ...executiveManagement, validId, c.revokeSessions);
router.get("/:id", ...executiveManagement, validId, c.detail);
router.patch("/:id", ...executiveManagement, validId, c.update);
module.exports = router;