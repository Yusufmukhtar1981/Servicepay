const express = require("express");

const {
  buyAirtime,
  buyData,
  getDataPlans,
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

const router = express.Router();

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

  if (role !== "HEAD_OFFICE") {
    return res.status(403).json({
      success: false,
      message:
        "Head Office access only.",
    });
  }

  next();
};

router.get(
  "/data-plans/:network",
  protect,
  getDataPlans
);

router.post(
  "/airtime",
  protect,
  buyAirtime
);

router.post(
  "/data",
  protect,
  buyData
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
