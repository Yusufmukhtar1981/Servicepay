const express = require('express');

const {
  protect,
} = require('../middleware/auth.middleware');

const controller = require(
  '../controllers/adminPartnerApplication.controller'
);

const router = express.Router();

router.use(protect);

/*
 * Partner application approval is
 * HEAD OFFICE only.
 */
router.use((req, res, next) => {
  const role = String(
    req.user?.role || ''
  ).toUpperCase();

  if (role !== 'HEAD_OFFICE') {
    return res.status(403).json({
      success: false,
      message:
        'Only Head Office can review Partner applications.',
    });
  }

  next();
});

router.get(
  '/',
  controller.getApplications
);

router.patch(
  '/:id/approve',
  controller.approveApplication
);

router.patch(
  '/:id/reject',
  controller.rejectApplication
);

module.exports = router;
