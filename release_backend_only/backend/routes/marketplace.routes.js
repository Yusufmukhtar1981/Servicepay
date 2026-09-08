const express = require('express');
const multer = require('multer');

const {
  protect,
} = require('../middleware/auth.middleware');
const {
  requireNoRestriction,
} = require('../middleware/accountRestriction.middleware');

const marketplaceController = require(
  '../controllers/marketplace.controller'
);
const {
  SUPPORTED_MARKETPLACE_IMAGE_TYPES,
} = require('../services/marketplaceImage.service');

const router = express.Router();
const marketplaceImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (req, file, callback) => {
    const mimeType = String(file.mimetype || '').toLowerCase();
    const extension = String(file.originalname || '')
      .split('.')
      .pop()
      .toLowerCase();
    const extensionMimeType =
      ['jpg', 'jpeg'].includes(extension)
        ? 'image/jpeg'
        : extension === 'png'
          ? 'image/png'
          : extension === 'webp'
            ? 'image/webp'
            : '';

    if (
      SUPPORTED_MARKETPLACE_IMAGE_TYPES.has(mimeType) ||
      (mimeType === 'application/octet-stream' && extensionMimeType)
    ) {
      callback(null, true);
      return;
    }

    const error = new Error(
      'Marketplace product photos must be JPEG, PNG, or WebP images.'
    );
    error.code = 'UNSUPPORTED_IMAGE';
    callback(error);
  },
});

const handleMarketplaceImageUpload = (req, res, next) => {
  marketplaceImageUpload.single('image')(req, res, (error) => {
    if (!error) return next();

    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        success: false,
        code: 'IMAGE_TOO_LARGE',
        message: 'Marketplace product photos must be 5 MB or smaller.',
      });
    }

    return res.status(400).json({
      success: false,
      code: error.code === 'LIMIT_UNEXPECTED_FILE'
        ? 'IMAGE_FILE_REQUIRED'
        : 'UNSUPPORTED_IMAGE',
      message: error.code === 'LIMIT_UNEXPECTED_FILE'
        ? 'Attach one product photo using the image field.'
        : error.message ||
          'Marketplace product photos must be JPEG, PNG, or WebP images.',
    });
  });
};

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

router.post(
  '/products/image',
  protect,
  handleMarketplaceImageUpload,
  marketplaceController.uploadProductImage
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

router.post(
  '/orders/:orderId/confirm-delivery',
  protect,
  marketplaceController.confirmOrderDelivery
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
