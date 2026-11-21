const express = require("express");
const { protect } = require("../middleware/auth.middleware");
const { loadStaffRole, requirePermission } = require("../middleware/staffPermission.middleware");
const c = require("../controllers/staffWorkspace.controller");
const enterprise = require("../controllers/operationsEnterprise.controller");
const management = require("../controllers/operationsManagement.controller");
const router = express.Router();
router.use(protect, loadStaffRole);
router.use(require("../middleware/adminAccessLog.middleware"));
const operationsStaff = require("../controllers/operationsStaff.controller");
router.get("/control-centre/staff/options", operationsStaff.options);
router.get("/control-centre/managers", operationsStaff.managers);
router.put("/control-centre/managers/:id/access", operationsStaff.updateManagerAccess);
router.get("/control-centre/head-office-dashboard",
  require("../services/adminDashboard.service").getOperationsExecutiveDashboard);
router.get("/control-centre/staff", operationsStaff.list);
router.post("/control-centre/staff", operationsStaff.create);
router.get("/control-centre/staff/:staffId", operationsStaff.detail);
router.put("/control-centre/staff/:staffId", operationsStaff.update);
router.put("/control-centre/staff/:staffId/status", operationsStaff.status);
router.post("/control-centre/managers/zonal", operationsStaff.createZonal);
router.post("/control-centre/managers/state", operationsStaff.createState);
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
router.get("/operational-hub", management.hub);
router.get("/operational-report", management.report);
router.get("/directory", management.directory);
router.get("/activity", management.activity);
router.get("/marketplace-operations", management.marketplace);
router.post("/marketplace-sellers/:id/status", management.sellerStatus);
router.patch("/customers/:id/profile", requirePermission("users.update"),
  require("../controllers/customerProfile.controller").updateOperations);
router.get("/enterprise", enterprise.summary);
router.get("/enterprise/export", enterprise.exportReport);
router.get("/transactions/:id/detail", enterprise.detail);
router.post("/customers/:id/status", enterprise.customerStatus);
router.post("/services/:key/status", enterprise.serviceStatus);
router.get("/transaction-reliability", c.transactionReliability);
router.get("/support-summary", c.supportSummary);
router.get("/virtual-accounts", c.virtualAccounts);
router.get("/customers", c.customers);
router.get("/customers/:id", c.customerDetail);
router.get("/staff/:id/history", c.staffHistory);
router.get("/transactions", c.transactions);
router.post("/tickets", requirePermission("support.resolve"), c.createTicket);
router.post("/tickets/:id/escalate", requirePermission("support.resolve"), c.escalate);
router.post("/provision-roles", c.provisionRoles);
module.exports = router;
