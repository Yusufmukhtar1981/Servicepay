const express = require("express");

const {
  protect,
} = require("../middleware/auth.middleware");

const transferController = require(
  "../controllers/transfer.controller"
);

const router = express.Router();

/*
 * Verify beneficiary before asking
 * the customer for a transaction PIN.
 */
router.get(
  "/beneficiary/:phone",
  protect,
  transferController.lookupBeneficiary
);

/*
 * Complete ServicePay-to-ServicePay transfer.
 */
router.post(
  "/servicepay",
  protect,
  transferController.transfer
);

module.exports = router;