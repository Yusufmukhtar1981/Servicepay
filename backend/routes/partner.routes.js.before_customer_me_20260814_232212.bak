const express = require('express');

const {
  partnerAuth,
} = require(
  '../middleware/partnerAuth.middleware'
);

const partnerController = require(
  '../controllers/partner.controller'
);


const partnerBalanceController = require("../controllers/partnerBalance.controller");

const router = express.Router();

router.get(
  '/profile',
  partnerAuth,
  partnerController.getMyProfile
);


router.get(
  "/balance",
  partnerAuth,
  partnerBalanceController.getBalance
);

module.exports = router;
