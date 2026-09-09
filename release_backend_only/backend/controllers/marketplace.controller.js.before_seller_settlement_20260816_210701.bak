const MarketplaceOrder = require('../models/marketplaceOrder.model');
const MarketplaceProduct = require('../models/marketplace.model');
const MarketplaceMerchant = require('../models/marketplaceMerchant.model');

const User = require('../models/user.model');
exports.listProducts = async (req, res) => {
  try {
    const {
      q = '',
      category = '',
      state = '',
      page = 1,
      limit = 30,
    } = req.query;

    const filter = {
      status: 'ACTIVE',
    };

    if (category) {
      filter.category = category;
    }

    if (state) {
      filter.state = state;
    }

    if (q) {
      filter.$text = {
        $search: q,
      };
    }

    const safeLimit = Math.min(Number(limit) || 30, 100);
    const safePage = Math.max(Number(page) || 1, 1);

    const [products, total] = await Promise.all([
      MarketplaceProduct.find(filter)
        .sort({
          featured: -1,
          createdAt: -1,
        })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .lean(),

      MarketplaceProduct.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      products,
      total,
      page: safePage,
      limit: safeLimit,
    });
  } catch (error) {
    console.error('MARKETPLACE_LIST_ERROR', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to load Marketplace products.',
    });
  }
};

exports.createProduct = async (req, res) => {
  try {
    const {
      title,
      description = '',
      category = 'General',
      price,
      stock = 0,
      imageUrl = '',
      state = '',
      lga = '',
    } = req.body;

    if (!title || price === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Product title and price are required.',
      });
    }

    const merchantName =
      req.user.fullName ||
      req.user.name ||
      req.user.businessName ||
      'ServicePay Merchant';

    const product = await MarketplaceProduct.create({
      merchant: req.user._id,
      merchantName,
      title,
      description,
      category,
      price: Number(price),
      stock: Number(stock || 0),
      imageUrl,
      state,
      lga,
      status: 'PENDING',
    });

    return res.status(201).json({
      success: true,
      message: 'Product submitted for approval.',
      product,
    });
  } catch (error) {
    console.error('MARKETPLACE_CREATE_ERROR', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to create Marketplace product.',
    });
  }
};

exports.myProducts = async (req, res) => {
  try {
    const products = await MarketplaceProduct.find({
      merchant: req.user._id,
    })
      .sort({
        createdAt: -1,
      })
      .lean();

    return res.json({
      success: true,
      products,
    });
  } catch (error) {
    console.error('MARKETPLACE_MY_PRODUCTS_ERROR', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to load your products.',
    });
  }
};


exports.registerMerchant = async (req, res) => {
  try {
    const userId = req.user && (req.user._id || req.user.id);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    const {
      storeName,
      businessName,
      phone,
      email,
      state,
      lga,
      address,
      description,
      logoUrl,
    } = req.body || {};

    if (!String(storeName || '').trim()) {
      return res.status(400).json({
        success: false,
        message: 'Store name is required.',
      });
    }

    const merchant = await MarketplaceMerchant.findOneAndUpdate(
      { user: userId },
      {
        $set: {
          storeName: String(storeName).trim(),
          businessName: String(businessName || '').trim(),
          phone: String(phone || req.user.phone || '').trim(),
          email: String(email || req.user.email || '').trim().toLowerCase(),
          state: String(state || '').trim(),
          lga: String(lga || '').trim(),
          address: String(address || '').trim(),
          description: String(description || '').trim(),
          logoUrl: String(logoUrl || '').trim(),
        },
        $setOnInsert: {
          user: userId,
          status: 'ACTIVE',
          verified: false,
        },
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
      },
    ).lean();

    return res.status(200).json({
      success: true,
      message: 'Marketplace merchant profile saved successfully.',
      merchant,
    });
  } catch (error) {
    console.error('MARKETPLACE_REGISTER_MERCHANT_ERROR', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to save Marketplace merchant profile.',
    });
  }
};

exports.myMerchantProfile = async (req, res) => {
  try {
    const userId = req.user && (req.user._id || req.user.id);

    const merchant = await MarketplaceMerchant.findOne({
      user: userId,
    }).lean();

    return res.status(200).json({
      success: true,
      merchant: merchant || null,
    });
  } catch (error) {
    console.error('MARKETPLACE_MY_MERCHANT_ERROR', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to load Marketplace merchant profile.',
    });
  }
};

exports.myProducts = async (req, res) => {
  try {
    const userId = req.user && (req.user._id || req.user.id);

    const products = await MarketplaceProduct.find({
      merchant: userId,
    })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      count: products.length,
      products,
    });
  } catch (error) {
    console.error('MARKETPLACE_MY_PRODUCTS_ERROR', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to load your Marketplace products.',
    });
  }
};


/* MARKETPLACE_ORDER_FOUNDATION_V1 */

function generateMarketplaceOrderReference() {
  const now = Date.now().toString();
  const random = Math.floor(1000 + Math.random() * 9000);
  return `SPM-${now}-${random}`;
}

exports.createOrder = async (req, res) => {
  try {
    const userId =
      req.user &&
      (req.user._id || req.user.id);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    const {
      items,
      customerName,
      customerPhone,
      deliveryAddress,
      state,
      lga,
      deliveryNote,
      paymentMethod,
    } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Your Marketplace cart is empty.',
      });
    }

    if (!String(customerName || '').trim()) {
      return res.status(400).json({
        success: false,
        message: 'Customer name is required.',
      });
    }

    if (!String(customerPhone || '').trim()) {
      return res.status(400).json({
        success: false,
        message: 'Customer phone number is required.',
      });
    }

    if (!String(deliveryAddress || '').trim()) {
      return res.status(400).json({
        success: false,
        message: 'Delivery address is required.',
      });
    }

    const normalizedRequestedItems = [];

    for (const rawItem of items) {
      const productId =
        rawItem &&
        (
          rawItem.productId ||
          rawItem.product ||
          rawItem._id ||
          rawItem.id
        );

      const quantityRaw =
        rawItem &&
        rawItem.quantity;

      const quantity = Number.parseInt(
        String(quantityRaw ?? 1),
        10
      );

      if (!productId) {
        return res.status(400).json({
          success: false,
          message: 'A Marketplace cart item has no product ID.',
        });
      }

      if (!Number.isFinite(quantity) || quantity < 1 || quantity > 100) {
        return res.status(400).json({
          success: false,
          message: 'Invalid Marketplace item quantity.',
        });
      }

      normalizedRequestedItems.push({
        productId: String(productId),
        quantity,
      });
    }

    const productIds = normalizedRequestedItems.map(
      (item) => item.productId
    );

    const products = await MarketplaceProduct.find({
      _id: {
        $in: productIds,
      },
    }).lean();

    const productMap = new Map(
      products.map(
        (product) => [
          String(product._id),
          product,
        ]
      )
    );

    const orderItems = [];
    let subtotal = 0;

    for (const requestedItem of normalizedRequestedItems) {
      const product = productMap.get(
        requestedItem.productId
      );

      if (!product) {
        return res.status(404).json({
          success: false,
          message:
            'One of the Marketplace products is no longer available.',
        });
      }

      const rawPrice =
        product.price ??
        product.sellingPrice ??
        product.amount ??
        0;

      const unitPrice = Number(rawPrice);

      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        return res.status(400).json({
          success: false,
          message:
            'One of the Marketplace products has an invalid price.',
        });
      }

      const merchantId =
        product.merchant &&
        (
          product.merchant._id ||
          product.merchant
        );

      if (!merchantId) {
        return res.status(400).json({
          success: false,
          message:
            'One of the Marketplace products has no merchant.',
        });
      }

      const lineTotal =
        Number(
          (
            unitPrice *
            requestedItem.quantity
          ).toFixed(2)
        );

      subtotal += lineTotal;

      orderItems.push({
        product: product._id,
        merchant: merchantId,
        title:
          String(
            product.title ||
            product.name ||
            'Marketplace Product'
          ),
        imageUrl:
          String(
            product.imageUrl ||
            product.image ||
            ''
          ),
        unitPrice,
        quantity: requestedItem.quantity,
        lineTotal,
      });
    }

    subtotal = Number(subtotal.toFixed(2));

    /*
     * Delivery pricing will be connected to the
     * ServicePay delivery engine in the next stage.
     */
    const deliveryFee = 0;

    const totalAmount = Number(
      (
        subtotal +
        deliveryFee
      ).toFixed(2)
    );

    const allowedPaymentMethods = new Set([
      'WALLET',
      'BANK_TRANSFER',
      'CARD',
      'PAY_ON_DELIVERY',
      'NOT_SELECTED',
    ]);

    const selectedPaymentMethod =
      allowedPaymentMethods.has(
        String(paymentMethod || '').toUpperCase()
      )
        ? String(paymentMethod).toUpperCase()
        : 'NOT_SELECTED';

    let order = null;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        
    /*
     * ============================================================
     * MARKETPLACE_WALLET_DEBIT_V1
     * Atomic ServicePay Marketplace wallet debit.
     * ============================================================
     */
    const marketplaceDebitAmount = Number(totalAmount);

    if (
      !Number.isFinite(marketplaceDebitAmount) ||
      marketplaceDebitAmount <= 0
    ) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_MARKETPLACE_AMOUNT',
        message: 'Invalid Marketplace order amount.',
      });
    }

    const marketplaceCustomerId = req.user._id;

    if (!marketplaceCustomerId) {
      return res.status(401).json({
        success: false,
        code: 'MARKETPLACE_AUTH_REQUIRED',
        message: 'Authentication is required.',
      });
    }

    const marketplaceDebitedUser = await User.findOneAndUpdate(
      {
        _id: marketplaceCustomerId,
        walletBalance: { $gte: marketplaceDebitAmount },
      },
      {
        $inc: {
          walletBalance: -marketplaceDebitAmount,
        },
      },
      {
        new: true,
      }
    );

    if (!marketplaceDebitedUser) {
      return res.status(400).json({
        success: false,
        code: 'INSUFFICIENT_WALLET_BALANCE',
        message: 'Insufficient wallet balance for this Marketplace order.',
      });
    }

    const marketplaceBalanceAfter =
      Number(marketplaceDebitedUser.walletBalance || 0);

order = await MarketplaceOrder.create({
          orderReference:
            generateMarketplaceOrderReference(),

          buyer: userId,

          items: orderItems,

          customerName:
            String(customerName).trim(),

          customerPhone:
            String(customerPhone).trim(),

          deliveryAddress:
            String(deliveryAddress).trim(),

          state:
            String(state || '').trim(),

          lga:
            String(lga || '').trim(),

          deliveryNote:
            String(deliveryNote || '').trim(),

          subtotal,
          deliveryFee,
          totalAmount,

          paymentMethod:
            selectedPaymentMethod,

          paymentStatus: 'PENDING',

          orderStatus:
            'PENDING_PAYMENT',
        });

        break;
      } catch (createError) {
        if (
          createError &&
          createError.code === 11000 &&
          attempt < 4
        ) {
          continue;
        }

        throw createError;
      }
    }

    if (!order) {
      throw new Error(
        'Unable to generate Marketplace order reference.'
      );
    }

    return res.status(201).json({
      success: true,
      message:
        'Marketplace order created successfully.',
      order,
    });
  } catch (error) {

      /*
       * MARKETPLACE_WALLET_REFUND_V1
       * Restore wallet when order creation fails after debit.
       */
      try {
        if (
          typeof marketplaceDebitAmount !== 'undefined' &&
          marketplaceDebitAmount > 0 &&
          typeof marketplaceCustomerId !== 'undefined' &&
          marketplaceCustomerId
        ) {
          await User.updateOne(
            { _id: marketplaceCustomerId },
            {
              $inc: {
                walletBalance: marketplaceDebitAmount,
              },
            }
          );
        }
      } catch (marketplaceRefundError) {
        console.error(
          'MARKETPLACE_WALLET_REFUND_ERROR',
          marketplaceRefundError
        );
      }


    console.error(
      'MARKETPLACE_CREATE_ORDER_ERROR',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Unable to create Marketplace order.',
    });
  }
};

exports.myOrders = async (req, res) => {
  try {
    const userId =
      req.user &&
      (req.user._id || req.user.id);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    const orders = await MarketplaceOrder.find({
      buyer: userId,
    })
      .sort({
        createdAt: -1,
      })
      .lean();

    return res.status(200).json({
      success: true,
      count: orders.length,
      orders,
    });
  } catch (error) {
    console.error(
      'MARKETPLACE_MY_ORDERS_ERROR',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Unable to load your Marketplace orders.',
    });
  }
};

exports.getOrder = async (req, res) => {
  try {
    const userId =
      req.user &&
      (req.user._id || req.user.id);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    const order = await MarketplaceOrder.findOne({
      _id: req.params.orderId,
      buyer: userId,
    }).lean();

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Marketplace order not found.',
      });
    }

    return res.status(200).json({
      success: true,
      order,
    });
  } catch (error) {
    console.error(
      'MARKETPLACE_GET_ORDER_ERROR',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Unable to load Marketplace order.',
    });
  }
};
