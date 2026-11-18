const express = require("express");

const router = express.Router();

const { protect } = require(
  "../middleware/auth.middleware"
);

const {
  getProductCommissions,
  upsertProductCommission,
  updateProductCommission,
  updateProductCommissionStatus,
  deleteProductCommission,
} = require(
  "../controllers/productCommission.controller"
);

const headOfficeOnly = (
  req,
  res,
  next
) => {
  const role = String(
    req.user?.role || ""
  ).toUpperCase();

  if (role !== "HEAD_OFFICE") {
    return res.status(403).json({
      success: false,
      message:
        "Only Head Office can manage product commissions.",
    });
  }

  next();
};

router.use(protect);
router.use(headOfficeOnly);

// Reuse the existing Head Office commission endpoint and its established named
// permission. The wildcard alone never authorizes changing future profit rules.
const { loadStaffRole, requireExplicitPermission } = require("../middleware/staffPermission.middleware");
const profitSharing = require("../controllers/profitSharing.controller");
router.get("/profit-sharing", loadStaffRole, profitSharing.read);
router.post("/profit-sharing", loadStaffRole, requireExplicitPermission("commissions.manage"), profitSharing.save);
const profitEngine = require("../controllers/profitSharingEngine.controller");
router.get("/profit-sharing/engine", loadStaffRole, profitEngine.status);
router.get("/profit-sharing/settlements", loadStaffRole, requireExplicitPermission("commissions.manage"), profitEngine.settlements);
router.post("/profit-sharing/dry-run", loadStaffRole, requireExplicitPermission("commissions.manage"), profitEngine.dryRun);
router.post("/profit-sharing/activation", loadStaffRole, requireExplicitPermission("commissions.manage"), profitEngine.activation);
const companyProfit = require("../controllers/profitSharingCompany.controller");
router.get("/profit-sharing/company", loadStaffRole, companyProfit.read);
router.post("/profit-sharing/company", loadStaffRole, requireExplicitPermission("commissions.manage"), companyProfit.save);
router.post("/profit-sharing/company/activation", loadStaffRole, requireExplicitPermission("commissions.manage"), companyProfit.activate);

router.get(
  "/",
  getProductCommissions
);

router.post(
  "/",
  upsertProductCommission
);

router.patch(
  "/:id",
  updateProductCommission
);

router.patch(
  "/:id/status",
  updateProductCommissionStatus
);

router.delete(
  "/:id",
  deleteProductCommission
);

module.exports = router;
