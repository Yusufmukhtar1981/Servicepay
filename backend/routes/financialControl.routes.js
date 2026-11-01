const router = require("express").Router();
const { protect } = require("../middleware/auth.middleware");
const { loadStaffRole, requirePermission } = require("../middleware/staffPermission.middleware");
const c = require("../controllers/financialControl.controller");
router.use(protect, loadStaffRole);
router.use((_req, res, next) => { res.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }); next(); });
const headOffice = (req, res, next) =>
  String(req.user?.role).toUpperCase() === "HEAD_OFFICE" &&
  req.staffAccess?.isHeadOffice === true && req.staffAccess?.scope?.type === "GLOBAL" ? next() :
    res.status(403).json({ success: false, message: "Financial Control Center requires authorized Head Office access." });
const operational = (req, res, next) => {
  const a = req.staffAccess;
  return a?.isHeadOffice === true ||
    (a?.roleName === "OPERATIONS_MANAGER" && a.scope?.type === "GLOBAL" &&
      a.permissions?.includes("operations.workspace.view")) ||
    (a?.roleName === "BRANCH_MANAGER" && a.permissions?.includes("branch.finance.view")) ? next() :
    res.status(403).json({ success: false, message: "Authorized operational summary access required." });
};
router.get("/operational-summary", operational, c.operational);
router.use(headOffice, requirePermission("finance.view"));
router.get("/summary", c.summary);
router.get("/expenses", c.expenses);
router.post("/expenses", c.recordExpense);
router.get("/expenses/:id/document", c.document);
router.get("/report", c.report);
module.exports = router;
module.exports.headOffice = headOffice;
module.exports.operational = operational;
