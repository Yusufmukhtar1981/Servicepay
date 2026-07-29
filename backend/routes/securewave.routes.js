const express = require("express");

const router = express.Router();

const {
  getBanks,
  validateAccountName,
  generateVirtualAccount,
} = require(
  "../controllers/securewave.controller"
);

const {
  handleVirtualAccountWebhook,
} = require(
  "../controllers/securewaveWebhook.controller"
);

const {
  protect,
} = require("../middleware/auth.middleware");

router.get("/banks", getBanks);

/*
 * SecureWaveNG calls this route directly.
 * Do not add ServicePay JWT protection.
 */
router.post(
  "/webhook",
  handleVirtualAccountWebhook
);

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