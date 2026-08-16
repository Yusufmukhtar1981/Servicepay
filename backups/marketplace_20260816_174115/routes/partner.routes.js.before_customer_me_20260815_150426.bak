const express = require('express');
const { protect } = require('../middleware/auth.middleware');


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


router.get(
  '/me',
  protect,
  partnerController.getCustomerPartnerProfile
);


module.exports = router;
