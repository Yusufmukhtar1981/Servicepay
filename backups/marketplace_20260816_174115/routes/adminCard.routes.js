const express = require('express');
const router = express.Router();

const { protect } = require('../middleware/auth.middleware');
const adminCardController = require('../controllers/adminCard.controller');

const headOfficeOnly = (req, res, next) => {
  const role = String(req.user?.role || '').trim().toUpperCase();

  if (role !== 'HEAD_OFFICE') {
    return res.status(403).json({
      success: false,
      message: 'Head Office access only.',
    });
  }

  next();
};

router.use(protect);
router.use(headOfficeOnly);

router.get('/', adminCardController.getCardRequests);
router.get('/:id', adminCardController.getCardRequest);

router.patch(
  '/:id/approve',
  adminCardController.approveCardRequest
);

router.patch(
  '/:id/reject',
  adminCardController.rejectCardRequest
);

router.patch(
  '/:id/status',
  adminCardController.updateCardStatus
);

module.exports = router;
