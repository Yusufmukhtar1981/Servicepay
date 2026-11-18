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
