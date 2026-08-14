const express = require('express');

const Partner = require(
  '../models/partner.model'
);

const partnerController = require(
  '../controllers/partner.controller'
);

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
  async (req, res) => {
    try {
      const status =
        String(
          req.body?.status || ''
        ).toUpperCase();

      if (
        ![
          'ACTIVE',
          'SUSPENDED',
          'REVOKED',
        ].includes(status)
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Invalid partner status.',
        });
      }

      const partner =
        await Partner.findByIdAndUpdate(
          req.params.id,
          { status },
          {
            new: true,
            runValidators: true,
          }
        ).select('-apiSecretHash');

      if (!partner) {
        return res.status(404).json({
          success: false,
          message:
            'Partner not found.',
        });
      }

      return res.json({
        success: true,
        message:
          'Partner status updated.',
        partner,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message:
          error.message ||
          'Unable to update partner.',
      });
    }
  }
);

router.patch(
  '/:id/permissions',
  async (req, res) => {
    try {
      const permissions =
        Array.isArray(
          req.body?.permissions
        )
          ? req.body.permissions
          : [];

      const partner =
        await Partner.findByIdAndUpdate(
          req.params.id,
          { permissions },
          {
            new: true,
            runValidators: true,
          }
        ).select('-apiSecretHash');

      if (!partner) {
        return res.status(404).json({
          success: false,
          message:
            'Partner not found.',
        });
      }

      return res.json({
        success: true,
        message:
          'Partner permissions updated.',
        partner,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message:
          error.message ||
          'Unable to update permissions.',
      });
    }
  }
);


/*
 * Partner Wallet Administration
 * HEAD_OFFICE only
 */
router.patch(
  "/:id/wallet",
  partnerWalletHeadOfficeOnly,
  adminPartnerWalletController.adjustPartnerWallet
);

router.get(
  "/:id/wallet/transactions",
  partnerWalletHeadOfficeOnly,
  adminPartnerWalletController.getWalletAdjustments
);

module.exports = router;
