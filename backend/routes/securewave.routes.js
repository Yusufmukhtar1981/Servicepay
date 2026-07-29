const express = require("express");

const router = express.Router();

const {
  getBanks,
  validateAccountName,
  generateVirtualAccount,
} = require("../controllers/securewave.controller");

const {
  protect,
} = require("../middleware/auth.middleware");

/*
 * Public route:
 * Returns the list of supported Nigerian banks.
 */
router.get("/banks", getBanks);

/*
 * Protected routes:
 * Customer must provide a valid ServicePay JWT token.
 */
router.post(
  "/validate-account-name",
  protect,
  validateAccountName
);

router.post(
  "/virtual-account",
  protect,
  generateVirtualAccount
);

module.exports = router;