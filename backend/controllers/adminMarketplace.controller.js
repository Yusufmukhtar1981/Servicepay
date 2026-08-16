const MarketplaceProduct = require('../models/marketplace.model');

/*
 * ============================================================
 * SERVICEPAY MARKETPLACE — HEAD OFFICE PRODUCT MODERATION
 * ============================================================
 */

const allowedStatuses = new Set([
  'PENDING',
  'ACTIVE',
  'REJECTED',
  'SUSPENDED',
]);

exports.listMarketplaceProducts = async (req, res) => {
  try {
    const {
      status = '',
      page = 1,
      limit = 50,
      q = '',
    } = req.query;

    const filter = {};

    if (status) {
      const normalizedStatus = String(status).trim().toUpperCase();

      if (!allowedStatuses.has(normalizedStatus)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid Marketplace product status.',
        });
      }

      filter.status = normalizedStatus;
    }

    if (String(q || '').trim()) {
      const search = String(q).trim();

      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { merchantName: { $regex: search, $options: 'i' } },
      ];
    }

    const safeLimit = Math.min(
      Math.max(Number(limit) || 50, 1),
      100
    );

    const safePage = Math.max(Number(page) || 1, 1);

    const [products, total] = await Promise.all([
      MarketplaceProduct.find(filter)
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .lean(),

      MarketplaceProduct.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      products,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        pages: Math.max(
          Math.ceil(total / safeLimit),
          1
        ),
      },
    });
  } catch (error) {
    console.error(
      'ADMIN_MARKETPLACE_LIST_ERROR',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Unable to load Marketplace products.',
    });
  }
};


exports.updateMarketplaceProductStatus =
  async (req, res) => {
    try {
      const productId = String(
        req.params.id || ''
      ).trim();

      const status = String(
        req.body.status || ''
      )
        .trim()
        .toUpperCase();

      if (!productId) {
        return res.status(400).json({
          success: false,
          message: 'Marketplace product ID is required.',
        });
      }

      if (!allowedStatuses.has(status)) {
        return res.status(400).json({
          success: false,
          message:
            'Status must be PENDING, ACTIVE, REJECTED or SUSPENDED.',
        });
      }

      const product =
        await MarketplaceProduct.findByIdAndUpdate(
          productId,
          {
            $set: {
              status,
            },
          },
          {
            new: true,
            runValidators: true,
          }
        );

      if (!product) {
        return res.status(404).json({
          success: false,
          message:
            'Marketplace product not found.',
        });
      }

      return res.json({
        success: true,
        message:
          status === 'ACTIVE'
            ? 'Marketplace product approved successfully.'
            : status === 'REJECTED'
            ? 'Marketplace product rejected.'
            : status === 'SUSPENDED'
            ? 'Marketplace product suspended.'
            : 'Marketplace product returned to pending review.',
        product,
      });
    } catch (error) {
      console.error(
        'ADMIN_MARKETPLACE_STATUS_ERROR',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to update Marketplace product status.',
      });
    }
  };


exports.approveMarketplaceProduct =
  async (req, res) => {
    req.body = {
      ...req.body,
      status: 'ACTIVE',
    };

    return exports.updateMarketplaceProductStatus(
      req,
      res
    );
  };


exports.rejectMarketplaceProduct =
  async (req, res) => {
    req.body = {
      ...req.body,
      status: 'REJECTED',
    };

    return exports.updateMarketplaceProductStatus(
      req,
      res
    );
  };


exports.suspendMarketplaceProduct =
  async (req, res) => {
    req.body = {
      ...req.body,
      status: 'SUSPENDED',
    };

    return exports.updateMarketplaceProductStatus(
      req,
      res
    );
  };
