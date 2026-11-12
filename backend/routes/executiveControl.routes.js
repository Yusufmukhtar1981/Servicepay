"use strict";
const router = require("express").Router();
const { protect } = require("../middleware/auth.middleware");
const { loadStaffRole, requirePermission } = require("../middleware/staffPermission.middleware");
const c = require("../controllers/executiveControl.controller");
const intelligence = require("../controllers/customerIntelligence.controller");
const S = require("../services/executiveControl.service");
function executive(req, res, next) {
  const a = req.staffAccess, permissions = a?.permissions || [];
  if (a?.scope?.type !== "GLOBAL") return res.status(403).json({ success: false, message: "Global executive access is required." });
  if (a.isHeadOffice === true || (req.user?.isStaff === true && permissions.includes("executive.control_center.view") &&
      permissions.includes("users.view") && permissions.includes("transactions.view"))) return next();
  return res.status(403).json({ success: false, message: "Authorized executive access is required." });
}
router.use(protect, loadStaffRole, executive);
// Query objects are immutable Express getters. Rewrite only this facade used
// by the existing scoped workforce handler; do not mutate the original request.
router.get("/field", (req, res) => {
  try {
    const p = S.period(req.query), request = Object.create(req);
    Object.defineProperty(request, "query", { value: { ...p.query, dimension: req.query.dimension || "agent",
      page: req.query.page || 1, limit: req.query.limit || 25 } });
    return intelligence.performance(request, res);
  } catch (e) { return res.status(e.status || 400).json({ success: false, message: e.message }); }
});
for (const name of ["overview", "finance", "marketing", "health"]) router.get("/" + name, c[name]);
router.get("/report", requirePermission("executive.control_center.export"), c.report);
module.exports = router;
module.exports.executive = executive;
