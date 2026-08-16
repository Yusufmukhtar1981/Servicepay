const express = require('express');

const {
  protect,
} = require('../middleware/auth.middleware');

const cardController = require(
  '../controllers/card.controller'
);

const router = express.Router();

router.use(protect);

router.get(
  '/',
  cardController.getMyCards
);

router.post(
  '/physical/request',
  cardController.requestPhysicalCard
);

router.post(
  '/virtual/request',
  cardController.requestVirtualCard
);

router.patch(
  '/:id/freeze',
  cardController.freezeCard
);

router.patch(
  '/:id/unfreeze',
  cardController.unfreezeCard
);

module.exports = router;
