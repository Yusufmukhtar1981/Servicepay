const express = require('express');

const {
  protect,
} = require('../middleware/auth.middleware');
const {
  requireNoRestriction,
} = require('../middleware/accountRestriction.middleware');

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

router.post(
  '/products',
  protect,
  marketplaceController.createProduct
);



router.get(
  '/merchant/me',
  protect,
  marketplaceController.myMerchantProfile
);

router.post(
  '/merchant/register',
  protect,
  marketplaceController.registerMerchant
);

router.get(
  '/products/mine',
  protect,
  marketplaceController.myProducts
);


/* MARKETPLACE_ORDER_ROUTES_V1 */

router.post(
  '/orders',
  protect,
  requireNoRestriction('BLOCK_MARKETPLACE_PURCHASE', 'BLOCK_WALLET_DEBIT'),
  marketplaceController.createOrder
);

router.get(
  '/orders/mine',
  protect,
  marketplaceController.myOrders
);

router.get(
  '/orders/:orderId',
  protect,
  marketplaceController.getOrder
);



/* SERVICEPAY_MARKETPLACE_SELLER_ORDER_ROUTES_V1 */
router.get(
  '/seller/orders',
  protect,
  marketplaceController.mySellerOrders
);

router.patch(
  '/seller/orders/:orderId/status',
  protect,
  marketplaceController.updateSellerOrderStatus
);


module.exports = router;
