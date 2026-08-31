const MarketplaceProduct = require('../models/marketplace.model');
const MarketplaceOrder = require('../models/marketplaceOrder.model');

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
const allowedFundsStatuses = new Set([
  'HELD',
  'SETTLED',
  'REFUNDED',
]);
// Legacy null branch records intentionally remain Head Office-only.
const branchFilter = (req) =>
  req.staffAccess?.isHeadOffice ? {} : { branchId: req.user.branchId };

exports.listMarketplaceProducts = async (req, res) => {
  try {
    const {
      status = '',
      page = 1,
      limit = 50,
      q = '',
    } = req.query;

    const filter = branchFilter(req);

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

exports.listMarketplaceOrders = async (req, res) => {
  try {
    const {
      status = '',
      paymentStatus = '',
      fundsStatus = '',
      page = 1,
      limit = 50,
    } = req.query;
    const filter = branchFilter(req);
    const normalizedStatus = String(status).trim().toUpperCase();
    const normalizedPaymentStatus = String(paymentStatus)
      .trim()
      .toUpperCase();
    const normalizedFundsStatus = String(fundsStatus)
      .trim()
      .toUpperCase();

    if (normalizedStatus) {
      filter.orderStatus = normalizedStatus;
    }

    if (normalizedPaymentStatus) {
      filter.paymentStatus = normalizedPaymentStatus;
    }

    if (normalizedFundsStatus) {
      if (!allowedFundsStatuses.has(normalizedFundsStatus)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid Marketplace funds status.',
        });
      }
      filter.fundsStatus = normalizedFundsStatus;
    }

    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const safePage = Math.max(Number(page) || 1, 1);
    const [orders, total] = await Promise.all([
      MarketplaceOrder.find(filter)
        .populate('buyer', 'fullName phone email')
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .lean(),
      MarketplaceOrder.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      orders,
      fundsStatuses: [...allowedFundsStatuses],
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        pages: Math.max(Math.ceil(total / safeLimit), 1),
      },
    });
  } catch (error) {
    console.error('ADMIN_MARKETPLACE_ORDERS_ERROR', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to load Marketplace orders.',
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
        await MarketplaceProduct.findOneAndUpdate(
          { _id: productId, ...branchFilter(req) },
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
