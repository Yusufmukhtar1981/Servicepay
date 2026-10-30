const express = require("express");
const { protect } = require("../middleware/auth.middleware");
const { loadStaffRole, requirePermission } = require("../middleware/staffPermission.middleware");
const c = require("../controllers/staffWorkspace.controller");
const router = express.Router();
router.use(protect, loadStaffRole);
router.use(require("../middleware/adminAccessLog.middleware"));
// Operational records span the company: scoped roles must not gain global access.
router.use((req, res, next) => {
  const access = req.staffAccess;
  if (access?.isHeadOffice) return next();
  const permissions = new Set(access?.permissions || []);
  if (access?.scope?.type !== "GLOBAL" ||
      !["operations.workspace.view", "support.workspace.view"].some((p) => permissions.has(p))) {
    return res.status(403).json({ success: false, message: "Global operational workspace permission required." });
  }
  next();
});
router.get("/overview", c.overview);
router.get("/customers", c.customers);
router.get("/customers/:id", c.customerDetail);
router.get("/staff/:id/history", c.staffHistory);
router.get("/transactions", (req, res, next) => {
  if (req.staffAccess.isHeadOffice || req.staffAccess.permissions.includes("operations.workspace.view")) return next();
  return res.status(403).json({ success: false, message: "Operations permission required. Investigate transactions through a selected customer." });
}, c.transactions);
router.post("/tickets", requirePermission("support.resolve"), c.createTicket);
router.post("/tickets/:id/escalate", requirePermission("support.resolve"), c.escalate);
router.post("/provision-roles", c.provisionRoles);
module.exports = router;
