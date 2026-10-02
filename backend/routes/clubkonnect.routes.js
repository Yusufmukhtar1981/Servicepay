const express = require("express");

const {
  buyAirtime,
  buyData,
  getDataPlans,
  getDataReconciliationQueue,
} = require(
  "../controllers/clubkonnect.controller"
);

const {
  getAdminDataPricing,
  saveDataSellingPrice,
} = require(
  "../controllers/dataPricing.controller"
);

const {
  protect,
} = require(
  "../middleware/auth.middleware"
);
const {
  loadStaffRole,
} = require("../middleware/staffPermission.middleware");
const {
  STAFF_PERMISSIONS: P,
  normalizeStaffPermission,
} = require("../config/staffPermissions");
const {
  requireNoRestriction,
  requireSpendableBalance,
} = require("../middleware/accountRestriction.middleware");

const router = express.Router();
const { getDataPurchaseStatus } = require("../controllers/dataPurchaseStatus.controller");
router.get("/data/status/:key", protect, getDataPurchaseStatus);

const headOfficeOnly = (
  req,
  res,
  next
) => {
  const role = String(
    req.user?.role || ""
  )
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");

  if (!["HEAD_OFFICE", "ADMIN"].includes(role)) {
    return res.status(403).json({
      success: false,
      message:
        "Head Office or Admin access only.",
    });
  }

  next();
};

const requireExplicitFinanceView = (req, res, next) => {
  const required = normalizeStaffPermission(P.FINANCE_VIEW);
  const permissions = new Set(
    (req.staffAccess?.permissions || [])
      .map(normalizeStaffPermission)
      .filter(Boolean),
  );
  if (!required || !permissions.has(required)) {
    return res.status(403).json({
      success: false,
      message: "Explicit finance view permission is required.",
    });
  }
  return next();
};

router.get(
  "/data-plans/:network",
  protect,
  getDataPlans
);

router.post(
  "/airtime",
  protect,
  requireNoRestriction("BLOCK_BILL_PURCHASES", "BLOCK_WALLET_DEBIT"),
  requireSpendableBalance,
  require("../middleware/transactionPin.middleware").requireTransactionPin,
  buyAirtime
);

router.get("/airtime/networks", protect,
  require("../controllers/clubkonnectAirtime.controller").getAirtimeNetworks);
router.post("/airtime/quote", protect,
  require("../controllers/clubkonnectAirtime.controller").quoteAirtime);

router.post(
  "/airtime/requery",
  protect,
  require("../controllers/clubkonnectAirtime.controller").requeryAirtime
);

router.post(
  "/airtime/:reference/requery",
  protect,
  require("../controllers/clubkonnectAirtime.controller").requeryAirtime
);

router.get(
  "/admin/airtime-provider-evidence/:transactionId",
  protect,
  headOfficeOnly,
  require("../controllers/clubkonnectAirtime.controller").readHistoricalProviderEvidence
);

router.post(
  "/data",
  protect,
  requireNoRestriction("BLOCK_BILL_PURCHASES", "BLOCK_WALLET_DEBIT"),
  requireSpendableBalance,
  require("../middleware/transactionPin.middleware").requireTransactionPin,
  buyData
);

router.get(
  "/admin/data-reconciliation",
  protect,
  loadStaffRole,
  requireExplicitFinanceView,
  getDataReconciliationQueue
);

router.get(
  "/admin/data-pricing/:network",
  protect,
  headOfficeOnly,
  getAdminDataPricing
);

router.put(
  "/admin/data-pricing/:network/:planCode",
  protect,
  headOfficeOnly,
  saveDataSellingPrice
);

module.exports = router;
