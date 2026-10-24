const router = require("express").Router();
const { protect } = require("../middleware/auth.middleware");
const { loadStaffRole, requirePermission } = require("../middleware/staffPermission.middleware");
const { STAFF_PERMISSIONS: P } = require("../config/staffPermissions");
const controller = require("../controllers/adminRevenue.controller");
const headOfficeOnly = (req,res,next) => req.staffAccess?.isHeadOffice === true &&
  req.staffAccess?.scope?.type === "GLOBAL" ? next() :
  res.status(403).json({success:false,message:"Revenue Account is restricted to authorized Head Office administrators."});
router.use(protect, loadStaffRole, headOfficeOnly, requirePermission(P.TRANSACTIONS_VIEW));
router.use((_req,res,next)=>{res.set("Cache-Control","no-store");next();});
router.get("/summary",controller.summary);
router.get("/transactions",controller.transactions);
router.get("/ledger",controller.ledger);
router.post("/reconcile",controller.reconcile);
router.get("/export",controller.export);
module.exports = router;
module.exports.headOfficeOnly = headOfficeOnly;
