const express = require("express");

const {
  protect,
} = require("../middleware/auth.middleware");

const kycController = require(
  "../controllers/kyc.controller"
);

const router = express.Router();

/*
 * GET /api/kyc/status
 * Returns the logged-in user's KYC profile.
 */
router.get(
  "/status",
  protect,
  kycController.getMyKycStatus
);

/*
 * POST /api/kyc/submit
 * Submit or update individual KYC.
 */
router.post(
  "/submit",
  protect,
  kycController.submitMyKyc
);

module.exports = router;
