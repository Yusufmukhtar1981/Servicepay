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
  req.staffAccess?.isHeadOffice ||
  (req.staffAccess?.roleName === "OPERATIONS_MANAGER" &&
    req.staffAccess?.scope?.type === "GLOBAL" &&
    req.staffAccess?.permissions?.includes("operations.workspace.view"))
    ? {} : { branchId: req.user.branchId };

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
      const requestedStatus = String(status).trim().toUpperCase();
      const normalizedStatus =
        requestedStatus === 'APPROVED' ? 'ACTIVE' : requestedStatus;

      if (normalizedStatus !== 'ALL' && !allowedStatuses.has(normalizedStatus)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid Marketplace product status.',
        });
      }

      if (normalizedStatus !== 'ALL') {
        filter.status = normalizedStatus;
      }
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

exports.getMarketplaceProduct = async (req, res) => {
  try {
    const productId = String(req.params.id || "").trim();
    if (!productId) {
      return res.status(400).json({ success: false, message: "Marketplace product ID is required." });
    }
    const product = await MarketplaceProduct.findOne({
      _id: productId,
      ...branchFilter(req),
    }).lean();
    if (!product) {
      return res.status(404).json({ success: false, message: "Marketplace product not found." });
    }
    return res.json({ success: true, product, data: { product } });
  } catch (error) {
    if (error?.name === "CastError") {
      return res.status(400).json({ success: false, message: "Invalid Marketplace product ID." });
    }
    console.error("ADMIN_MARKETPLACE_DETAIL_ERROR", error);
    return res.status(500).json({ success: false, message: "Unable to load Marketplace product." });
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
    let session;
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

      const isOperations = req.staffAccess?.roleName === "OPERATIONS_MANAGER";
      const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : "";
      if ((isOperations && reason.length < 10) || reason.length > 500) {
        return res.status(400).json({ success: false, message: "A moderation reason of 10–500 characters is required." });
      }
      const mongoose = require("mongoose");
      if (!mongoose.isValidObjectId(productId)) return res.status(400).json({ success: false, message: "Invalid product ID." });
      session = await mongoose.startSession();
      let product;
      await session.withTransaction(async () => {
      const previous = await MarketplaceProduct.findOne({ _id: productId, ...branchFilter(req) }).session(session);
      if (!previous) throw Object.assign(new Error("Marketplace product not found."), { statusCode: 404 });
      if (req.body.expectedStatus && req.body.expectedStatus !== previous.status)
        throw Object.assign(new Error("Product status changed. Refresh before retrying."), { statusCode: 409 });
      product =
        await MarketplaceProduct.findOneAndUpdate(
          { _id: productId, status: previous.status, ...branchFilter(req) },
          {
            $set: {
              status,
            },
          },
          {
            new: true,
            runValidators: true,
            session,
          }
        );

      if (!product) throw Object.assign(new Error("Product status changed. Refresh before retrying."), { statusCode: 409 });
      await require("../models/adminAuditLog.model").create([{
        actorId: req.user._id, actorRole: req.user.role, actorName: req.user.fullName,
        action: "FINTECH_OPERATION", reason: reason || "Marketplace moderation",
        metadata: { module: "OPERATIONS_MARKETPLACE", productId: String(product._id),
          previousStatus: previous.status, status },
      }], { session });
      });

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
      if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
      console.error(
        'ADMIN_MARKETPLACE_STATUS_ERROR',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to update Marketplace product status.',
      });
    } finally {
      if (session) await session.endSession();
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
