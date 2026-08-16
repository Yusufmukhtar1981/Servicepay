const express = require('express');

const {
  protect,
} = require('../middleware/auth.middleware');

const marketplaceController = require(
  '../controllers/marketplace.controller'
);

const router = express.Router();

router.get(
  '/',
  marketplaceController.listProducts
);

router.get(
  '/my-products',
  protect,
  marketplaceController.myProducts
);

router.post(
  '/',
  protect,
  marketplaceController.createProduct
);

module.exports = router;
