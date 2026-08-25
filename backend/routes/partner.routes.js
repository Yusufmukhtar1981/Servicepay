const express = require('express');
const { protect } = require('../middleware/auth.middleware');


const {
  partnerAuth,
  requirePartnerPermission,
} = require(
  '../middleware/partnerAuth.middleware'
);

const partnerController = require(
  '../controllers/partner.controller'
);


const partnerBalanceController = require("../controllers/partnerBalance.controller");
const partnerTransactionsController = require("../controllers/partnerTransactions.controller");
const partnerApiController = require("../controllers/partnerApi.controller");

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

router.get(
  "/me/transactions",
  protect,
  partnerController.getCustomerTransactions
);

router.post(
  "/me/regenerate-credentials",
  protect,
  partnerController.regenerateCustomerCredentials
);

router.post(
  "/me/activate-credentials",
  protect,
  partnerController.activateCustomerCredentials
);

router.post(
  "/me/revoke",
  protect,
  partnerController.revokeCustomerAccess
);

router.get(
  "/me/documentation",
  protect,
  partnerController.getDocumentation
);

router.get(
  "/documentation",
  partnerAuth,
  partnerController.getDocumentation
);

router.get(
  "/transactions",
  partnerAuth,
  partnerTransactionsController.listTransactions
);

router.get(
  "/transactions/:reference",
  partnerAuth,
  partnerTransactionsController.getTransaction
);

router.get(
  "/data-plans/:network",
  partnerAuth,
  requirePartnerPermission("DATA"),
  partnerApiController.getDataPlans
);

router.post(
  "/airtime",
  partnerAuth,
  requirePartnerPermission("AIRTIME"),
  partnerApiController.buyAirtime
);

router.post(
  "/data",
  partnerAuth,
  requirePartnerPermission("DATA"),
  partnerApiController.buyData
);


module.exports = router;
