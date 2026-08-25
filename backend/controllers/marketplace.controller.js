const crypto = require("crypto");
const mongoose = require("mongoose");

const MarketplaceOrder = require("../models/marketplaceOrder.model");
const MarketplaceProduct = require("../models/marketplace.model");
const MarketplaceMerchant = require("../models/marketplaceMerchant.model");
const Transaction = require("../models/transaction.model");
const User = require("../models/user.model");
const { postDebit } = require("../services/ledger.service");

const PRODUCT_STATUSES = new Set([
  "PENDING",
  "ACTIVE",
  "REJECTED",
  "SUSPENDED",
]);

const SELLER_ORDER_TRANSITIONS = {
  PAID: ["ACCEPTED"],
  ACCEPTED: ["PROCESSING"],
  PROCESSING: ["READY"],
  READY: ["SHIPPED"],
};

const LEGACY_PAID_SELLER_TRANSITIONS = {
  PLACED: ["ACCEPTED"],
  CONFIRMED: ["ACCEPTED"],
  READY_FOR_DELIVERY: ["SHIPPED"],
};

const getUserId = (req) =>
  req.user?._id || req.user?.id || null;

const toMoney = (value) => {
  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return null;
  }

  return Math.round((amount + Number.EPSILON) * 100) / 100;
};

const generateOrderReference = () =>
  `SPM-${Date.now()}-${crypto
    .randomBytes(4)
    .toString("hex")
    .toUpperCase()}`;

const cleanText = (value, maxLength = 500) =>
  String(value || "").trim().slice(0, maxLength);

const getIdempotencyKey = (req) =>
  cleanText(
    req.get?.("idempotency-key") ||
      req.body?.idempotencyKey,
    160
  );

const isSafeImageUrl = (value) => {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:";
  } catch (_) {
    return false;
  }
};

const normalizeImageUrls = (body = {}) => {
  const candidates = [
    ...(Array.isArray(body.imageUrls) ? body.imageUrls : []),
    ...(Array.isArray(body.images) ? body.images : []),
    body.imageUrl,
  ];

  return [
    ...new Set(
      candidates
        .map((value) => cleanText(value, 2000))
        .filter(Boolean)
        .filter(isSafeImageUrl)
    ),
  ];
};

const normalizeCartItems = (items) => {
  if (!Array.isArray(items) || items.length === 0) {
    return {
      error: "Your Marketplace cart is empty.",
      items: [],
    };
  }

  const quantities = new Map();

  for (const rawItem of items) {
    const productId = String(
      rawItem?.productId ||
        rawItem?.product ||
        rawItem?._id ||
        rawItem?.id ||
        ""
    ).trim();
    const quantity = Number.parseInt(
      String(rawItem?.quantity ?? 1),
      10
    );

    if (!mongoose.isValidObjectId(productId)) {
      return {
        error: "Each Marketplace cart item must have a valid product ID.",
        items: [],
      };
    }

    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 100
    ) {
      return {
        error: "Marketplace item quantities must be between 1 and 100.",
        items: [],
      };
    }

    quantities.set(
      productId,
      (quantities.get(productId) || 0) + quantity
    );
  }

  const normalized = [...quantities.entries()].map(
    ([productId, quantity]) => ({
      productId,
      quantity,
    })
  );

  if (normalized.some((item) => item.quantity > 100)) {
    return {
      error: "Marketplace item quantities must be between 1 and 100.",
      items: [],
    };
  }

  return { error: "", items: normalized };
};

const getMerchantForUser = async (userId, session = null) => {
  const query = MarketplaceMerchant.findOne({
    user: userId,
  });

  if (session) {
    query.session(session);
  }

  return query;
};

const activeMerchant = (merchant) =>
  merchant &&
  String(merchant.status || "ACTIVE").toUpperCase() ===
    "ACTIVE";

const serializeProduct = (product) => {
  const value = product?.toObject
    ? product.toObject()
    : product;
  const images = Array.isArray(value?.imageUrls)
    ? value.imageUrls.filter(Boolean)
    : [];
  const imageUrl = value?.imageUrl || images[0] || "";

  return {
    ...value,
    imageUrl,
    imageUrls: images.length ? images : imageUrl ? [imageUrl] : [],
    inStock: Number(value?.stock || 0) > 0,
  };
};

exports.listProducts = async (req, res) => {
  try {
    const q = cleanText(req.query.q, 120);
    const category = cleanText(req.query.category, 120);
    const state = cleanText(req.query.state, 120);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(
      Math.max(Number(req.query.limit) || 30, 1),
      100
    );

    const filter = { status: "ACTIVE" };

    if (category) {
      filter.category = category;
    }

    if (state) {
      filter.state = state;
    }

    if (q) {
      filter.$text = { $search: q };
    }

    const [products, total, categories] = await Promise.all([
      MarketplaceProduct.find(filter)
        .sort({ featured: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      MarketplaceProduct.countDocuments(filter),
      MarketplaceProduct.distinct("category", {
        status: "ACTIVE",
      }),
    ]);

    return res.json({
      success: true,
      products: products.map(serializeProduct),
      total,
      page,
      limit,
      categories: categories
        .map((item) => cleanText(item, 120))
        .filter(Boolean)
        .sort(),
    });
  } catch (error) {
    console.error("MARKETPLACE_LIST_ERROR", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load Marketplace products.",
    });
  }
};

exports.getProduct = async (req, res) => {
  try {
    const productId = String(req.params.productId || "").trim();

    if (!mongoose.isValidObjectId(productId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Marketplace product ID.",
      });
    }

    const product = await MarketplaceProduct.findOne({
      _id: productId,
      status: "ACTIVE",
    }).lean();

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Marketplace product not found.",
      });
    }

    return res.json({
      success: true,
      product: serializeProduct(product),
    });
  } catch (error) {
    console.error("MARKETPLACE_PRODUCT_ERROR", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load Marketplace product.",
    });
  }
};

const getProductPayload = (body, { requireImage = false } = {}) => {
  const title = cleanText(body.title, 180);
  const category = cleanText(body.category || "General", 120);
  const description = cleanText(body.description, 4000);
  const price = toMoney(body.price);
  const stock = Number(body.stock);
  const images = normalizeImageUrls(body);

  if (!title || price === null) {
    return {
      error: "Product name and price are required.",
    };
  }

  if (price <= 0) {
    return {
      error: "Product price must be greater than zero.",
    };
  }

  if (
    !Number.isInteger(stock) ||
    stock < 0
  ) {
    return {
      error: "Stock quantity must be a whole number of zero or more.",
    };
  }

  if (requireImage && images.length === 0) {
    return {
      error:
        "Add at least one valid product image before saving this product.",
    };
  }

  return {
    error: "",
    payload: {
      title,
      description,
      category,
      price,
      stock,
      imageUrl: images[0] || cleanText(body.imageUrl, 2000),
      imageUrls: images,
      sku: cleanText(body.sku, 120),
      brand: cleanText(body.brand, 120),
      condition: cleanText(body.condition, 120),
      weight: cleanText(body.weight, 120),
      state: cleanText(body.state, 120),
      lga: cleanText(body.lga, 120),
    },
  };
};

exports.createProduct = async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const merchant = await getMerchantForUser(userId);

    if (!activeMerchant(merchant)) {
      return res.status(403).json({
        success: false,
        message:
          "Create and activate your Marketplace seller account before adding products.",
      });
    }

    const { error, payload } = getProductPayload(req.body || {}, {
      requireImage: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: error,
      });
    }

    const product = await MarketplaceProduct.create({
      ...payload,
      merchant: userId,
      merchantName:
        merchant.storeName ||
        req.user?.fullName ||
        "ServicePay Store",
      status: "PENDING",
    });

    return res.status(201).json({
      success: true,
      message: "Product submitted for Marketplace approval.",
      product: serializeProduct(product),
    });
  } catch (error) {
    console.error("MARKETPLACE_CREATE_ERROR", error);
    return res.status(500).json({
      success: false,
      message: "Unable to create Marketplace product.",
    });
  }
};

exports.myProducts = async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const products = await MarketplaceProduct.find({
      merchant: userId,
    })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      success: true,
      count: products.length,
      products: products.map(serializeProduct),
    });
  } catch (error) {
    console.error("MARKETPLACE_MY_PRODUCTS_ERROR", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load your Marketplace products.",
    });
  }
};

exports.updateProduct = async (req, res) => {
  try {
    const userId = getUserId(req);
    const productId = String(req.params.productId || "").trim();

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    if (!mongoose.isValidObjectId(productId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Marketplace product ID.",
      });
    }

    const product = await MarketplaceProduct.findOne({
      _id: productId,
      merchant: userId,
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Marketplace product not found for this store.",
      });
    }

    const merchant = await getMerchantForUser(userId);

    if (!activeMerchant(merchant)) {
      return res.status(403).json({
        success: false,
        message: "An active Marketplace seller account is required.",
      });
    }

    const mergedInput = {
      ...product.toObject(),
      ...(req.body || {}),
      imageUrls:
        req.body?.imageUrls ||
        req.body?.images ||
        product.imageUrls ||
        (product.imageUrl ? [product.imageUrl] : []),
      imageUrl:
        req.body?.imageUrl ||
        product.imageUrl ||
        product.imageUrls?.[0] ||
        "",
    };
    const { error, payload } = getProductPayload(mergedInput, {
      requireImage: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: error,
      });
    }

    Object.assign(product, payload);
    await product.save();

    return res.json({
      success: true,
      message: "Marketplace product updated successfully.",
      product: serializeProduct(product),
    });
  } catch (error) {
    console.error("MARKETPLACE_UPDATE_PRODUCT_ERROR", error);
    return res.status(500).json({
      success: false,
      message: "Unable to update Marketplace product.",
    });
  }
};

exports.deactivateProduct = async (req, res) => {
  try {
    const userId = getUserId(req);
    const productId = String(req.params.productId || "").trim();

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    if (!mongoose.isValidObjectId(productId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Marketplace product ID.",
      });
    }

    const product = await MarketplaceProduct.findOneAndUpdate(
      {
        _id: productId,
        merchant: userId,
      },
      {
        $set: { status: "SUSPENDED" },
      },
      { new: true }
    );

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Marketplace product not found for this store.",
      });
    }

    return res.json({
      success: true,
      message: "Marketplace product deactivated.",
      product: serializeProduct(product),
    });
  } catch (error) {
    console.error("MARKETPLACE_DEACTIVATE_PRODUCT_ERROR", error);
    return res.status(500).json({
      success: false,
      message: "Unable to deactivate Marketplace product.",
    });
  }
};

exports.registerMerchant = async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const storeName = cleanText(req.body?.storeName, 180);

    if (!storeName) {
      return res.status(400).json({
        success: false,
        message: "Store name is required.",
      });
    }

    const logoUrl = cleanText(req.body?.logoUrl, 2000);

    if (logoUrl && !isSafeImageUrl(logoUrl)) {
      return res.status(400).json({
        success: false,
        message: "Store logo must be a valid image URL.",
      });
    }

    const merchant = await MarketplaceMerchant.findOneAndUpdate(
      { user: userId },
      {
        $set: {
          storeName,
          businessName: cleanText(req.body?.businessName, 180),
          phone: cleanText(req.body?.phone || req.user?.phone, 60),
          email: cleanText(
            req.body?.email || req.user?.email,
            180
          ).toLowerCase(),
          state: cleanText(req.body?.state, 120),
          lga: cleanText(req.body?.lga, 120),
          address: cleanText(
            req.body?.businessAddress || req.body?.address,
            500
          ),
          description: cleanText(
            req.body?.storeDescription || req.body?.description,
            2000
          ),
          logoUrl,
        },
        $setOnInsert: {
          user: userId,
          status: "ACTIVE",
          verified: false,
        },
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
      }
    );

    return res.json({
      success: true,
      message: "Marketplace seller profile saved successfully.",
      merchant,
    });
  } catch (error) {
    console.error("MARKETPLACE_REGISTER_MERCHANT_ERROR", error);
    return res.status(500).json({
      success: false,
      message: "Unable to save Marketplace seller profile.",
    });
  }
};

exports.myMerchantProfile = async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const merchant = await getMerchantForUser(userId);

    return res.json({
      success: true,
      merchant: merchant || null,
    });
  } catch (error) {
    console.error("MARKETPLACE_MY_MERCHANT_ERROR", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load Marketplace seller profile.",
    });
  }
};

exports.sellerDashboard = async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const merchant = await getMerchantForUser(userId);

    if (!merchant) {
      return res.json({
        success: true,
        merchant: null,
        metrics: {
          totalProducts: 0,
          activeProducts: 0,
          totalOrders: 0,
          pendingOrders: 0,
          completedOrders: 0,
          salesTotal: 0,
        },
      });
    }

    const [totalProducts, activeProducts, orders] = await Promise.all([
      MarketplaceProduct.countDocuments({ merchant: userId }),
      MarketplaceProduct.countDocuments({
        merchant: userId,
        status: "ACTIVE",
      }),
      MarketplaceOrder.find({
        "items.merchant": userId,
      })
        .select("items orderStatus paymentStatus")
        .lean(),
    ]);

    const ownOrderTotal = (order) =>
      (order.items || [])
        .filter(
          (item) =>
            String(item.merchant) === String(userId)
        )
        .reduce(
          (sum, item) => sum + Number(item.lineTotal || 0),
          0
        );

    const metrics = {
      totalProducts,
      activeProducts,
      totalOrders: orders.length,
      pendingOrders: orders.filter((order) =>
        ["PAID", "ACCEPTED", "PROCESSING", "READY", "SHIPPED"].includes(
          order.orderStatus
        )
      ).length,
      completedOrders: orders.filter(
        (order) => order.orderStatus === "DELIVERED"
      ).length,
      salesTotal: orders
        .filter(
          (order) =>
            ["PAID", "ACCEPTED", "PROCESSING", "READY", "SHIPPED", "DELIVERED"].includes(
              order.orderStatus
            ) && order.paymentStatus === "PAID"
        )
        .reduce((sum, order) => sum + ownOrderTotal(order), 0),
    };

    return res.json({
      success: true,
      merchant,
      metrics: {
        ...metrics,
        salesTotal: toMoney(metrics.salesTotal) || 0,
      },
    });
  } catch (error) {
    console.error("MARKETPLACE_SELLER_DASHBOARD_ERROR", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load Marketplace seller dashboard.",
    });
  }
};

exports.createOrder = async (req, res) => {
  const userId = getUserId(req);
  const idempotencyKey = getIdempotencyKey(req);

  try {
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    if (!idempotencyKey) {
      return res.status(400).json({
        success: false,
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message:
          "A checkout idempotency key is required. Please try checkout again.",
      });
    }

    const existing = await MarketplaceOrder.findOne({
      buyer: userId,
      idempotencyKey,
    }).lean();

    if (existing) {
      return res.status(200).json({
        success: true,
        duplicate: true,
        message: "This Marketplace checkout was already completed.",
        order: existing,
      });
    }

    const paymentMethod = cleanText(
      req.body?.paymentMethod || "WALLET",
      40
    ).toUpperCase();

    if (paymentMethod !== "WALLET") {
      return res.status(400).json({
        success: false,
        message:
          "ServicePay Wallet is currently the only Marketplace payment method.",
      });
    }

    const customerName = cleanText(req.body?.customerName, 180);
    const customerPhone = cleanText(req.body?.customerPhone, 60);
    const deliveryAddress = cleanText(
      req.body?.deliveryAddress,
      500
    );
    const state = cleanText(req.body?.state, 120);
    const lga = cleanText(req.body?.lga, 120);
    const deliveryNote = cleanText(req.body?.deliveryNote, 1000);
    const cart = normalizeCartItems(req.body?.items);

    if (cart.error) {
      return res.status(400).json({
        success: false,
        message: cart.error,
      });
    }

    if (!customerName || !customerPhone || !deliveryAddress || !state || !lga) {
      return res.status(400).json({
        success: false,
        message:
          "Customer name, phone, delivery address, state, and LGA are required.",
      });
    }

    const session = await mongoose.startSession();
    let createdOrder = null;
    let duplicateOrder = null;

    try {
      await session.withTransaction(async () => {
        const duplicate = await MarketplaceOrder.findOne({
          buyer: userId,
          idempotencyKey,
        }).session(session);

        if (duplicate) {
          duplicateOrder = duplicate;
          return;
        }

        const buyer = await User.findById(userId).session(session);

        if (!buyer || String(buyer.status || "").toUpperCase() !== "ACTIVE") {
          throw Object.assign(
            new Error("Your account is not active."),
            { statusCode: 403 }
          );
        }

        const orderItems = [];
        let subtotal = 0;
        let storeOwnerId = "";

        const sortedCart = [...cart.items].sort((left, right) =>
          left.productId.localeCompare(right.productId)
        );

        for (const requested of sortedCart) {
          const product = await MarketplaceProduct.findById(
            requested.productId
          ).session(session);

          if (
            !product ||
            product.status !== "ACTIVE"
          ) {
            throw Object.assign(
              new Error(
                "One of the Marketplace products is no longer available."
              ),
              { statusCode: 409 }
            );
          }

          if (String(product.merchant) === String(userId)) {
            throw Object.assign(
              new Error(
                "You cannot purchase a product from your own store."
              ),
              { statusCode: 400 }
            );
          }

          const seller = await getMerchantForUser(
            product.merchant,
            session
          );

          if (!activeMerchant(seller)) {
            throw Object.assign(
              new Error(
                "One of the Marketplace stores is currently unavailable."
              ),
              { statusCode: 409 }
            );
          }

          const unitPrice = toMoney(product.price);

          if (!unitPrice || unitPrice <= 0) {
            throw Object.assign(
              new Error(
                "One of the Marketplace products has an invalid price."
              ),
              { statusCode: 409 }
            );
          }

          const updatedProduct =
            await MarketplaceProduct.findOneAndUpdate(
              {
                _id: product._id,
                status: "ACTIVE",
                stock: { $gte: requested.quantity },
              },
              {
                $inc: {
                  stock: -requested.quantity,
                },
              },
              {
                new: true,
                session,
              }
            );

          if (!updatedProduct) {
            throw Object.assign(
              new Error(
                `${product.title} no longer has enough stock available.`
              ),
              { statusCode: 409 }
            );
          }

          if (!storeOwnerId) {
            storeOwnerId = String(product.merchant);
          } else if (storeOwnerId !== String(product.merchant)) {
            throw Object.assign(
              new Error(
                "Please place separate checkouts for products from different stores."
              ),
              { statusCode: 400 }
            );
          }

          const lineTotal = toMoney(
            unitPrice * requested.quantity
          );

          subtotal = toMoney(subtotal + lineTotal);
          orderItems.push({
            product: product._id,
            merchant: product.merchant,
            title: product.title,
            imageUrl:
              product.imageUrl ||
              product.imageUrls?.[0] ||
              "",
            unitPrice,
            quantity: requested.quantity,
            lineTotal,
          });
        }

        const deliveryFee = 0;
        const totalAmount = toMoney(subtotal + deliveryFee);

        if (!totalAmount || totalAmount <= 0) {
          throw Object.assign(
            new Error("Invalid Marketplace order amount."),
            { statusCode: 400 }
          );
        }

        const openingBalance = toMoney(buyer.walletBalance || 0);

        if (openingBalance < totalAmount) {
          throw Object.assign(
            new Error(
              "Insufficient wallet balance for this Marketplace order."
            ),
            { statusCode: 400, code: "INSUFFICIENT_WALLET_BALANCE" }
          );
        }

        const orderReference = generateOrderReference();
        const transactionDocs = await Transaction.create(
          [
            {
              reference: orderReference,
              customerId: buyer._id,
              serviceType: "MARKETPLACE",
              provider: "SERVICEPAY_WALLET",
              amount: totalAmount,
              status: "SUCCESSFUL",
              providerResponse: {
                marketplace: true,
                idempotencyKey,
              },
            },
          ],
          { session }
        );
        const transaction = transactionDocs[0];

        const debitedBuyer = await User.findOneAndUpdate(
          {
            _id: buyer._id,
            status: "ACTIVE",
            walletBalance: { $gte: totalAmount },
          },
          {
            $inc: {
              walletBalance: -totalAmount,
            },
          },
          {
            new: true,
            session,
          }
        );

        if (!debitedBuyer) {
          throw Object.assign(
            new Error(
              "Insufficient wallet balance for this Marketplace order."
            ),
            { statusCode: 400, code: "INSUFFICIENT_WALLET_BALANCE" }
          );
        }

        const ledger = await postDebit({
          userId: buyer._id,
          amount: totalAmount,
          openingBalance,
          closingBalance: toMoney(debitedBuyer.walletBalance),
          service: "MARKETPLACE",
          reference: orderReference,
          idempotencyKey: `${idempotencyKey}:wallet-debit`,
          transactionId: transaction._id,
          narration: `Marketplace wallet payment for ${orderReference}`,
          metadata: {
            marketplace: true,
            itemCount: orderItems.length,
          },
          session,
        });

        const orderDocs = await MarketplaceOrder.create(
          [
            {
              orderReference,
              buyer: buyer._id,
              items: orderItems,
              customerName,
              customerPhone,
              deliveryAddress,
              state,
              lga,
              deliveryNote,
              subtotal,
              deliveryFee,
              totalAmount,
              paymentMethod: "WALLET",
              paymentStatus: "PAID",
              orderStatus: "PAID",
              fundsStatus: "HELD",
              idempotencyKey,
              transaction: transaction._id,
              ledgerEntry: ledger.entry._id,
              paymentReference: orderReference,
              paidAt: new Date(),
              statusHistory: [
                {
                  status: "PAID",
                  changedBy: buyer._id,
                  changedAt: new Date(),
                  note: "Wallet payment confirmed.",
                },
              ],
            },
          ],
          { session }
        );

        createdOrder = orderDocs[0];
      });
    } finally {
      await session.endSession();
    }

    if (duplicateOrder) {
      return res.status(200).json({
        success: true,
        duplicate: true,
        message: "This Marketplace checkout was already completed.",
        order: duplicateOrder,
      });
    }

    return res.status(201).json({
      success: true,
      message: "Marketplace order paid successfully.",
      order: createdOrder,
    });
  } catch (error) {
    if (error?.code === 11000 && idempotencyKey && userId) {
      const existing = await MarketplaceOrder.findOne({
        buyer: userId,
        idempotencyKey,
      }).lean();

      if (existing) {
        return res.status(200).json({
          success: true,
          duplicate: true,
          message: "This Marketplace checkout was already completed.",
          order: existing,
        });
      }
    }

    console.error("MARKETPLACE_CREATE_ORDER_ERROR", error);
    return res.status(error?.statusCode || 500).json({
      success: false,
      code: error?.code,
      message:
        error?.statusCode && error?.message
          ? error.message
          : "Unable to create Marketplace order.",
    });
  }
};

exports.myOrders = async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const orders = await MarketplaceOrder.find({
      buyer: userId,
    })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      success: true,
      count: orders.length,
      orders,
    });
  } catch (error) {
    console.error("MARKETPLACE_MY_ORDERS_ERROR", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load your Marketplace orders.",
    });
  }
};

exports.getOrder = async (req, res) => {
  try {
    const userId = getUserId(req);
    const orderId = String(req.params.orderId || "").trim();

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    if (!mongoose.isValidObjectId(orderId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Marketplace order ID.",
      });
    }

    const order = await MarketplaceOrder.findOne({
      _id: orderId,
      buyer: userId,
    }).lean();

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Marketplace order not found.",
      });
    }

    return res.json({
      success: true,
      order,
    });
  } catch (error) {
    console.error("MARKETPLACE_GET_ORDER_ERROR", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load Marketplace order.",
    });
  }
};

exports.mySellerOrders = async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const merchant = await getMerchantForUser(userId);

    if (!merchant) {
      return res.json({
        success: true,
        orders: [],
        count: 0,
        message: "Create your Marketplace seller account to view store orders.",
      });
    }

    const orders = await MarketplaceOrder.find({
      "items.merchant": userId,
    })
      .populate("buyer", "fullName phone email")
      .sort({ createdAt: -1 })
      .lean();

    const ownOrders = orders.map((order) => {
      const items = (order.items || []).filter(
        (item) => String(item.merchant) === String(userId)
      );
      const sellerSubtotal = toMoney(
        items.reduce(
          (sum, item) => sum + Number(item.lineTotal || 0),
          0
        )
      );

      return {
        ...order,
        items,
        sellerSubtotal,
        store: {
          id: merchant._id,
          storeName: merchant.storeName,
        },
      };
    });

    return res.json({
      success: true,
      orders: ownOrders,
      data: ownOrders,
      count: ownOrders.length,
    });
  } catch (error) {
    console.error("MARKETPLACE_SELLER_ORDERS_ERROR", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load Marketplace seller orders.",
    });
  }
};

exports.updateSellerOrderStatus = async (req, res) => {
  try {
    const userId = getUserId(req);
    const orderId = String(req.params.orderId || "").trim();
    const requestedStatus = cleanText(
      req.body?.status || req.body?.orderStatus,
      40
    ).toUpperCase();

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    if (!mongoose.isValidObjectId(orderId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Marketplace order ID.",
      });
    }

    const merchant = await getMerchantForUser(userId);

    if (!activeMerchant(merchant)) {
      return res.status(403).json({
        success: false,
        message: "An active Marketplace seller account is required.",
      });
    }

    const order = await MarketplaceOrder.findOne({
      _id: orderId,
      "items.merchant": userId,
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Marketplace order not found for this store.",
      });
    }

    const currentStatus = String(order.orderStatus || "").toUpperCase();
    const isLegacyStatus =
      Object.prototype.hasOwnProperty.call(
        LEGACY_PAID_SELLER_TRANSITIONS,
        currentStatus
      );
    const permittedNextStatuses =
      SELLER_ORDER_TRANSITIONS[currentStatus] ||
      LEGACY_PAID_SELLER_TRANSITIONS[currentStatus] ||
      [];

    if (!permittedNextStatuses.includes(requestedStatus)) {
      return res.status(409).json({
        success: false,
        message: `This order cannot move from ${currentStatus || "its current status"} to ${requestedStatus || "that status"}.`,
      });
    }

    if (isLegacyStatus && order.paymentStatus !== "PAID") {
      return res.status(409).json({
        success: false,
        message:
          "Only legacy Marketplace orders with confirmed payment can enter fulfillment.",
      });
    }

    order.orderStatus = requestedStatus;
    order.statusHistory.push({
      status: requestedStatus,
      changedBy: userId,
      changedAt: new Date(),
      note: isLegacyStatus
        ? `Legacy status ${currentStatus} moved into the controlled fulfillment workflow.`
        : "Updated by the seller.",
    });
    await order.save();

    return res.json({
      success: true,
      message: "Marketplace order status updated successfully.",
      order,
    });
  } catch (error) {
    console.error("MARKETPLACE_SELLER_STATUS_ERROR", error);
    return res.status(500).json({
      success: false,
      message: "Unable to update Marketplace order.",
    });
  }
};

module.exports.PRODUCT_STATUSES = PRODUCT_STATUSES;
module.exports.SELLER_ORDER_TRANSITIONS = SELLER_ORDER_TRANSITIONS;
module.exports.LEGACY_PAID_SELLER_TRANSITIONS =
  LEGACY_PAID_SELLER_TRANSITIONS;