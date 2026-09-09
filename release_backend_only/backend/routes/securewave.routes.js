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

router.get(
  "/banks",
  getBanks
);

/*
 * SecureWaveNG webhook.
 *
 * Temporary logging is included so that we can
 * see the exact payload sent by SecureWaveNG.
 */
router.post(
  "/webhook",

  (req, res, next) => {
    console.log(
      "========== SECUREWAVE WEBHOOK START =========="
    );

    console.log(
      "SecureWave webhook headers:",
      JSON.stringify(
        req.headers,
        null,
        2
      )
    );

    console.log(
      "SecureWave webhook body:",
      JSON.stringify(
        req.body,
        null,
        2
      )
    );

    console.log(
      "SecureWave raw body available:",
      Buffer.isBuffer(
        req.rawBody
      )
    );

    console.log(
      "========== SECUREWAVE WEBHOOK END =========="
    );

    next();
  },

  handleVirtualAccountWebhook
);

/*
 * Fetch authenticated customer's
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
