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

router.post(
  "/money-requests/:id/pay",
  controller.payMoneyRequest
);

router.post(
  "/money-requests/:id/decline",
  controller.declineMoneyRequest
);

router.get(
  "/payment-links/:code",
  controller.getPaymentLinkByCode
);

router.post(
  "/payment-links/:code/pay",
  controller.payPaymentLink
);

router.post(
  "/groups/:id/members",
  controller.addGroupMember
);

router.delete(
  "/groups/:id/members/:memberId",
  controller.removeGroupMember
);

router.get(
  "/groups/:id",
  controller.getGroupDetails
);

router.patch(
  "/groups/:id",
  controller.updateGroup
);

router.post(
  "/groups/:id/leave",
  controller.leaveGroup
);

router.post(
  "/groups/:id/contribute",
  controller.contributeToGroup
);

router.get(
  "/groups/:id/contributions",
  controller.groupContributions
);

module.exports = router;
