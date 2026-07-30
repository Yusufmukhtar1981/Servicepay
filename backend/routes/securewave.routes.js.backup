const express = require("express");

const router = express.Router();

const {
  getBanks,
  getMyVirtualAccount,
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
} = require(
  "../middleware/auth.middleware"
);

router.get("/banks", getBanks);

/*
 * SecureWaveNG calls this route directly.
 */
router.post(
  "/webhook",
  handleVirtualAccountWebhook
);

/*
 * Fetch the authenticated customer's
 * stored virtual account.
 */
router.get(
  "/virtual-account",
  protect,
  getMyVirtualAccount
);

/*
 * Create a virtual account.
 */
router.post(
  "/virtual-account",
  protect,
  generateVirtualAccount
);

router.post(
  "/validate-account-name",
  protect,
  validateAccountName
);

module.exports = router;