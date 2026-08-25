const express = require('express');
const multer = require('multer');

const {
  protect,
} = require('../middleware/auth.middleware');
const {
  requireTransactionPin,
} = require('../middleware/transactionPin.middleware');

const marketplaceController = require(
  '../controllers/marketplace.controller'
);

const router = express.Router();
const marketplaceImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024,
  },
});

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
  '/products/mine',
  protect,
  marketplaceController.myProducts
);

router.post(
  '/products/image',
  protect,
  (req, res, next) => {
    marketplaceImageUpload.single('image')(req, res, (error) => {
      if (error) {
        return res.status(400).json({
          success: false,
          message:
            error.code === 'LIMIT_FILE_SIZE'
              ? 'Marketplace product photos must be 8 MB or smaller.'
              : 'Unable to process this product photo.',
        });
      }
      return next();
    });
  },
  marketplaceController.uploadProductImage
);

router.get(
  '/products/:productId',
  marketplaceController.getProduct
);

router.patch(
  '/products/:productId',
  protect,
  marketplaceController.updateProduct
);

router.delete(
  '/products/:productId',
  protect,
  marketplaceController.deactivateProduct
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
  '/seller/dashboard',
  protect,
  marketplaceController.sellerDashboard
);


/* MARKETPLACE_ORDER_ROUTES_V1 */

router.post(
  '/orders',
  protect,
  requireTransactionPin,
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

router.post(
  '/orders/:orderId/confirm-delivery',
  protect,
  marketplaceController.confirmOrderDelivery
);

router.post(
  '/orders/:orderId/cancel',
  protect,
  marketplaceController.cancelMyOrder
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
