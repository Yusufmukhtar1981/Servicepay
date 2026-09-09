const express = require('express');

const {
  protect,
} = require('../middleware/auth.middleware');

const controller = require(
  '../controllers/partnerApplication.controller'
);

const router = express.Router();

router.post(
  '/apply',
  protect,
  controller.apply
);

router.get(
  '/my',
  protect,
  controller.myApplication
);

module.exports = router;
