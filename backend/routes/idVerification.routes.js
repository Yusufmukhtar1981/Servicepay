const express = require("express");
const router = express.Router();

const {
  verifyNin,
  getNinVerificationHistory,
  getSingleNinVerification,

  verifyBvn,
  getBvnVerificationHistory,
  getSingleBvnVerification,
} = require("../controllers/idVerification.controller");

const { protect } = require("../middleware/auth.middleware");
const { requireIntegratedBusinessPricing } = require("../middleware/businessPricingAdmission.middleware");

// NIN verification routes
router.post(
  "/nin",
  protect,
  requireIntegratedBusinessPricing("NIN"),
  verifyNin
);

router.get(
  "/nin/history",
  protect,
  getNinVerificationHistory
);

router.get(
  "/nin/:id",
  protect,
  getSingleNinVerification
);

// BVN verification routes
router.post(
  "/bvn",
  protect,
  requireIntegratedBusinessPricing("BVN"),
  verifyBvn
);

router.get(
  "/bvn/history",
  protect,
  getBvnVerificationHistory
);

router.get(
  "/bvn/:id",
  protect,
  getSingleBvnVerification
);

module.exports = router;
