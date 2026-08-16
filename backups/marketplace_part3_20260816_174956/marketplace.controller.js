const MarketplaceProduct = require('../models/marketplace.model');

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
