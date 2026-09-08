const express = require('express');

const Partner = require(
  '../models/partner.model'
);

const partnerController = require(
  '../controllers/partner.controller'
);
const partnerApiController = require("../controllers/partnerApi.controller");

const {
  protect,
} = require(
  '../middleware/auth.middleware'
);


const adminPartnerWalletController = require(
  "../controllers/adminPartnerWallet.controller"
);

const router = express.Router();


const partnerWalletHeadOfficeOnly = (req, res, next) => {
  const role = String(
    req.user?.role || ""
  )
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");

  if (role !== "HEAD_OFFICE") {
    return res.status(403).json({
      success: false,
      message: "Head Office access required.",
    });
  }

  next();
};


router.use(protect);
router.use(partnerWalletHeadOfficeOnly);

router.get(
  '/',
  partnerController.getPartners
);

router.post(
  '/',
  partnerController.createPartner
);

router.patch(
  '/:id/status',
  partnerController.updatePartnerStatus
);

router.patch(
  '/:id/permissions',
  partnerController.updatePartnerPermissions
);

router.patch('/:id/limits', partnerController.updatePartnerLimits);
router.get('/:id/usage', partnerController.getPartnerUsage);
router.get('/reconciliation', partnerApiController.listUnresolvedTransactions);
router.post('/reconciliation/:reference/requery', partnerApiController.requeryPartnerTransaction);
router.post('/reconciliation/:reference/resolve', partnerApiController.resolvePartnerTransaction);

/*
 * Partner Wallet Administration
 * HEAD_OFFICE only
 */
router.patch(
  "/:id/wallet",
  adminPartnerWalletController.adjustPartnerWallet
);

router.get(
  "/:id/wallet/transactions",
  adminPartnerWalletController.getWalletAdjustments
);


router.patch(
  '/:id/regenerate-credentials',
  partnerController.regenerateCredentials
);

router.post(
  '/:id/regenerate-credentials',
  partnerController.regenerateCredentials
);

module.exports = router;
