const express = require("express");

const {
  protect,
} = require("../middleware/auth.middleware");

const controller = require(
  "../controllers/servicepayFeatures.controller"
);

const router = express.Router();

router.use(protect);

router.post(
  "/payment-links",
  controller.createPaymentLink
);

router.get(
  "/payment-links",
  controller.myPaymentLinks
);

router.post(
  "/money-requests",
  controller.createMoneyRequest
);

router.get(
  "/money-requests",
  controller.moneyRequests
);

router.post(
  "/business-wallet",
  controller.createBusinessProfile
);

router.get(
  "/business-wallet",
  controller.getBusinessProfile
);

router.get(
  "/agents",
  controller.agentLocator
);

router.post(
  "/groups",
  controller.createGroup
);

router.get(
  "/groups",
  controller.myGroups
);

module.exports = router;
