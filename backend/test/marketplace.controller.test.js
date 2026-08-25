const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { Writable } = require("node:stream");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const { v2: cloudinary } = require("cloudinary");

const User = require("../models/user.model");
const MarketplaceMerchant = require("../models/marketplaceMerchant.model");
const MarketplaceProduct = require("../models/marketplace.model");
const MarketplaceOrder = require("../models/marketplaceOrder.model");
const Transaction = require("../models/transaction.model");
const LedgerEntry = require("../models/ledgerEntry.model");
const marketplace = require("../controllers/marketplace.controller");

let mongo;
let sequence = 0;

const models = [
  User,
  MarketplaceMerchant,
  MarketplaceProduct,
  MarketplaceOrder,
  Transaction,
  LedgerEntry,
];

const makeRequest = ({
  user = null,
  body = {},
  params = {},
  query = {},
  headers = {},
  file = null,
} = {}) => ({
  user,
  body,
  params,
  query,
  file,
  get(name) {
    return headers[String(name).toLowerCase()];
  },
});

const call = async (handler, options) => {
  const result = {};
  const res = {
    status(code) {
      result.status = code;
      return this;
    },
    json(payload) {
      result.status ??= 200;
      result.body = payload;
      return this;
    },
  };

  await handler(makeRequest(options), res);
  return result;
};

const createUser = async ({ walletBalance = 0 } = {}) => {
  sequence += 1;
  return User.create({
    fullName: `Marketplace Test ${sequence}`,
    phone: `080700${String(sequence).padStart(5, "0")}`,
    email: `marketplace-${sequence}@example.test`,
    password: "Password123!",
    role: "CUSTOMER",
    status: "ACTIVE",
    walletBalance,
  });
};

const createStoreWithProduct = async ({
  price = 1200,
  stock = 4,
} = {}) => {
  const seller = await createUser();
  await MarketplaceMerchant.create({
    user: seller._id,
    storeName: `Store ${sequence}`,
    status: "ACTIVE",
  });
  const product = await MarketplaceProduct.create({
    merchant: seller._id,
    merchantName: `Store ${sequence}`,
    title: `Product ${sequence}`,
    description: "A verified Marketplace test product.",
    category: "Test",
    price,
    stock,
    imageUrl: "https://images.example.test/product.png",
    imageUrls: ["https://images.example.test/product.png"],
    status: "ACTIVE",
  });

  return { seller, product };
};

const checkoutBody = (product, quantity = 1) => ({
  items: [{ productId: String(product._id), quantity }],
  customerName: "Checkout Customer",
  customerPhone: "08030000000",
  deliveryAddress: "1 ServicePay Street",
  state: "Kano",
  lga: "Nassarawa",
  paymentMethod: "WALLET",
});

test.before(async () => {
  mongo = await MongoMemoryReplSet.create({
    replSet: {
      count: 1,
      storageEngine: "wiredTiger",
    },
  });
  await mongoose.connect(mongo.getUri(), {
    dbName: "marketplace-controller-tests",
  });
  await Promise.all(models.map((model) => model.init()));
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongo) {
    await mongo.stop();
  }
});

test.beforeEach(async () => {
  await Promise.all(
    models.map((model) => model.collection.deleteMany({}))
  );
});

test("seller product creation requires a real product image", async () => {
  const seller = await createUser();
  await MarketplaceMerchant.create({
    user: seller._id,
    storeName: "Image Required Store",
    status: "ACTIVE",
  });

  const result = await call(marketplace.createProduct, {
    user: seller,
    body: {
      title: "No image product",
      price: 500,
      stock: 1,
    },
  });

  assert.equal(result.status, 400);
  assert.match(result.body.message, /image/i);
});

test("Marketplace product upload rejects forged or unsupported image files", async () => {
  const seller = await createUser();
  await MarketplaceMerchant.create({
    user: seller._id,
    storeName: "Secure Image Store",
    status: "ACTIVE",
  });

  const result = await call(marketplace.uploadProductImage, {
    user: seller,
    file: {
      mimetype: "image/png",
      buffer: Buffer.from("this is not a PNG file"),
    },
  });

  assert.equal(result.status, 400);
  assert.equal(result.body.code, "UNSUPPORTED_IMAGE");
});

test("Marketplace product upload returns a verified secure image URL", async () => {
  const seller = await createUser();
  await MarketplaceMerchant.create({
    user: seller._id,
    storeName: "Cloud Image Store",
    status: "ACTIVE",
  });

  const originalUploadStream = cloudinary.uploader.upload_stream;
  const originalCloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const originalApiKey = process.env.CLOUDINARY_API_KEY;
  const originalApiSecret = process.env.CLOUDINARY_API_SECRET;
  process.env.CLOUDINARY_CLOUD_NAME = "marketplace-test";
  process.env.CLOUDINARY_API_KEY = "marketplace-test-key";
  process.env.CLOUDINARY_API_SECRET = "marketplace-test-secret";
  cloudinary.uploader.upload_stream = (_options, callback) => {
    const stream = new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
    });
    queueMicrotask(() =>
      callback(null, {
        secure_url: "https://res.cloudinary.example/servicepay/product.webp",
        public_id: "servicepay/marketplace/products/test/product",
      })
    );
    return stream;
  };

  try {
    const result = await call(marketplace.uploadProductImage, {
      user: seller,
      file: {
        mimetype: "image/webp",
        buffer: Buffer.from([
          0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45,
          0x42, 0x50,
        ]),
      },
    });

    assert.equal(result.status, 201);
    assert.equal(result.body.success, true);
    assert.match(result.body.imageUrl, /^https:/);
  } finally {
    cloudinary.uploader.upload_stream = originalUploadStream;
    if (originalCloudName === undefined) {
      delete process.env.CLOUDINARY_CLOUD_NAME;
    } else {
      process.env.CLOUDINARY_CLOUD_NAME = originalCloudName;
    }
    if (originalApiKey === undefined) {
      delete process.env.CLOUDINARY_API_KEY;
    } else {
      process.env.CLOUDINARY_API_KEY = originalApiKey;
    }
    if (originalApiSecret === undefined) {
      delete process.env.CLOUDINARY_API_SECRET;
    } else {
      process.env.CLOUDINARY_API_SECRET = originalApiSecret;
    }
  }
});

test("checkout uses server price, reserves stock, debits wallet and posts ledger atomically", async () => {
  const { product } = await createStoreWithProduct({
    price: 1250,
    stock: 3,
  });
  const buyer = await createUser({ walletBalance: 5000 });

  const result = await call(marketplace.createOrder, {
    user: buyer,
    body: checkoutBody(product, 2),
    headers: { "idempotency-key": "marketplace-test-checkout-1" },
  });

  assert.equal(result.status, 201);
  assert.equal(result.body.success, true);
  assert.equal(result.body.order.paymentMethod, "WALLET");
  assert.equal(result.body.order.paymentStatus, "PAID");
  assert.equal(result.body.order.orderStatus, "PAID");
  assert.equal(result.body.order.totalAmount, 2500);
  assert.equal(result.body.order.fundsStatus, "HELD");

  const storedProduct = await MarketplaceProduct.findById(product._id);
  const storedBuyer = await User.findById(buyer._id);
  const storedOrder = await MarketplaceOrder.findById(result.body.order._id);
  const ledger = await LedgerEntry.findOne({
    reference: storedOrder.orderReference,
  });
  const transaction = await Transaction.findById(storedOrder.transaction);

  assert.equal(storedProduct.stock, 1);
  assert.equal(storedBuyer.walletBalance, 2500);
  assert.equal(ledger.direction, "DEBIT");
  assert.equal(ledger.amount, 2500);
  assert.equal(ledger.closingBalance, 2500);
  assert.equal(transaction.serviceType, "MARKETPLACE");
});

test("checkout idempotency prevents duplicate wallet debits and orders", async () => {
  const { product } = await createStoreWithProduct({
    price: 700,
    stock: 5,
  });
  const buyer = await createUser({ walletBalance: 3000 });
  const headers = { "idempotency-key": "marketplace-test-checkout-2" };

  const first = await call(marketplace.createOrder, {
    user: buyer,
    body: checkoutBody(product),
    headers,
  });
  const second = await call(marketplace.createOrder, {
    user: buyer,
    body: checkoutBody(product),
    headers,
  });

  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.body.duplicate, true);
  assert.equal(await MarketplaceOrder.countDocuments(), 1);
  assert.equal(await LedgerEntry.countDocuments(), 1);

  const storedBuyer = await User.findById(buyer._id);
  const storedProduct = await MarketplaceProduct.findById(product._id);
  assert.equal(storedBuyer.walletBalance, 2300);
  assert.equal(storedProduct.stock, 4);
});

test("insufficient stock and self-purchase leave wallet and stock unchanged", async () => {
  const { seller, product } = await createStoreWithProduct({
    price: 900,
    stock: 1,
  });
  const buyer = await createUser({ walletBalance: 5000 });

  const outOfStock = await call(marketplace.createOrder, {
    user: buyer,
    body: checkoutBody(product, 2),
    headers: { "idempotency-key": "marketplace-test-checkout-3" },
  });
  assert.equal(outOfStock.status, 409);

  const selfPurchase = await call(marketplace.createOrder, {
    user: seller,
    body: checkoutBody(product),
    headers: { "idempotency-key": "marketplace-test-checkout-4" },
  });
  assert.equal(selfPurchase.status, 400);

  const storedProduct = await MarketplaceProduct.findById(product._id);
  const storedBuyer = await User.findById(buyer._id);
  assert.equal(storedProduct.stock, 1);
  assert.equal(storedBuyer.walletBalance, 5000);
  assert.equal(await MarketplaceOrder.countDocuments(), 0);
  assert.equal(await LedgerEntry.countDocuments(), 0);
});

test("seller status changes are ownership-filtered and follow the fulfillment sequence", async () => {
  const { seller, product } = await createStoreWithProduct();
  const otherSeller = await createUser();
  const buyer = await createUser({ walletBalance: 5000 });
  const order = await call(marketplace.createOrder, {
    user: buyer,
    body: checkoutBody(product),
    headers: { "idempotency-key": "marketplace-test-checkout-5" },
  });

  const forbidden = await call(marketplace.updateSellerOrderStatus, {
    user: otherSeller,
    params: { orderId: String(order.body.order._id) },
    body: { status: "ACCEPTED" },
  });
  assert.equal(forbidden.status, 403);

  const invalid = await call(marketplace.updateSellerOrderStatus, {
    user: seller,
    params: { orderId: String(order.body.order._id) },
    body: { status: "SHIPPED" },
  });
  assert.equal(invalid.status, 409);

  const accepted = await call(marketplace.updateSellerOrderStatus, {
    user: seller,
    params: { orderId: String(order.body.order._id) },
    body: { status: "ACCEPTED" },
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.order.orderStatus, "ACCEPTED");
});

test("buyer-confirmed delivery settles held funds exactly once", async () => {
  const { seller, product } = await createStoreWithProduct({
    price: 1750,
    stock: 2,
  });
  const buyer = await createUser({ walletBalance: 5000 });
  const created = await call(marketplace.createOrder, {
    user: buyer,
    body: checkoutBody(product),
    headers: { "idempotency-key": "marketplace-settlement-order" },
  });
  const orderId = String(created.body.order._id);

  for (const status of ["ACCEPTED", "PROCESSING", "READY", "SHIPPED"]) {
    const result = await call(marketplace.updateSellerOrderStatus, {
      user: seller,
      params: { orderId },
      body: { status },
    });
    assert.equal(result.status, 200);
  }

  const settlement = await call(marketplace.confirmOrderDelivery, {
    user: buyer,
    params: { orderId },
  });
  const duplicate = await call(marketplace.confirmOrderDelivery, {
    user: buyer,
    params: { orderId },
  });

  assert.equal(settlement.status, 200);
  assert.equal(settlement.body.order.orderStatus, "DELIVERED");
  assert.equal(settlement.body.order.fundsStatus, "SETTLED");
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.duplicate, true);

  const storedSeller = await User.findById(seller._id);
  const storedBuyer = await User.findById(buyer._id);
  const storedOrder = await MarketplaceOrder.findById(orderId);
  const settlementEntries = await LedgerEntry.find({
    service: "MARKETPLACE_SETTLEMENT",
    reference: storedOrder.orderReference,
  });

  assert.equal(storedSeller.walletBalance, 1750);
  assert.equal(storedBuyer.walletBalance, 3250);
  assert.equal(settlementEntries.length, 1);
  assert.equal(settlementEntries[0].direction, "CREDIT");
  assert.equal(storedOrder.settlementLedgerEntry.toString(), settlementEntries[0]._id.toString());
});

test("buyer cancellation refunds held funds and restores stock exactly once", async () => {
  const { product } = await createStoreWithProduct({
    price: 900,
    stock: 2,
  });
  const buyer = await createUser({ walletBalance: 5000 });
  const created = await call(marketplace.createOrder, {
    user: buyer,
    body: checkoutBody(product),
    headers: { "idempotency-key": "marketplace-refund-order" },
  });
  const orderId = String(created.body.order._id);

  const refund = await call(marketplace.cancelMyOrder, {
    user: buyer,
    params: { orderId },
  });
  const duplicate = await call(marketplace.cancelMyOrder, {
    user: buyer,
    params: { orderId },
  });

  assert.equal(refund.status, 200);
  assert.equal(refund.body.order.orderStatus, "REFUNDED");
  assert.equal(refund.body.order.paymentStatus, "REFUNDED");
  assert.equal(refund.body.order.fundsStatus, "REFUNDED");
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.duplicate, true);

  const storedBuyer = await User.findById(buyer._id);
  const storedProduct = await MarketplaceProduct.findById(product._id);
  const storedOrder = await MarketplaceOrder.findById(orderId);
  const originalTransaction = await Transaction.findById(storedOrder.transaction);
  const refundEntries = await LedgerEntry.find({
    service: "MARKETPLACE_REFUND",
    reference: storedOrder.orderReference,
  });

  assert.equal(storedBuyer.walletBalance, 5000);
  assert.equal(storedProduct.stock, 2);
  assert.equal(refundEntries.length, 1);
  assert.equal(refundEntries[0].direction, "CREDIT");
  assert.equal(originalTransaction.status, "REFUNDED");
});

test("accepted Marketplace orders cannot be self-refunded by the buyer", async () => {
  const { seller, product } = await createStoreWithProduct();
  const buyer = await createUser({ walletBalance: 5000 });
  const created = await call(marketplace.createOrder, {
    user: buyer,
    body: checkoutBody(product),
    headers: { "idempotency-key": "marketplace-refund-after-acceptance" },
  });
  const orderId = String(created.body.order._id);

  const accepted = await call(marketplace.updateSellerOrderStatus, {
    user: seller,
    params: { orderId },
    body: { status: "ACCEPTED" },
  });
  const refund = await call(marketplace.cancelMyOrder, {
    user: buyer,
    params: { orderId },
  });

  assert.equal(accepted.status, 200);
  assert.equal(refund.status, 409);
  assert.equal((await User.findById(buyer._id)).walletBalance, 3800);
  assert.equal((await MarketplaceProduct.findById(product._id)).stock, 3);
  assert.equal(await LedgerEntry.countDocuments({ service: "MARKETPLACE_REFUND" }), 0);
});

test("concurrent buyer cancellation and seller acceptance cannot create a refunded fulfillment order", async () => {
  const { seller, product } = await createStoreWithProduct({
    price: 1100,
    stock: 2,
  });
  const buyer = await createUser({ walletBalance: 5000 });
  const created = await call(marketplace.createOrder, {
    user: buyer,
    body: checkoutBody(product),
    headers: { "idempotency-key": "marketplace-cancel-accept-race" },
  });
  const orderId = String(created.body.order._id);

  await Promise.all([
    call(marketplace.cancelMyOrder, {
      user: buyer,
      params: { orderId },
    }),
    call(marketplace.updateSellerOrderStatus, {
      user: seller,
      params: { orderId },
      body: { status: "ACCEPTED" },
    }),
  ]);

  const storedOrder = await MarketplaceOrder.findById(orderId);
  const isRefunded = storedOrder.orderStatus === "REFUNDED";
  const isAcceptedAndHeld =
    storedOrder.orderStatus === "ACCEPTED" &&
    storedOrder.paymentStatus === "PAID" &&
    storedOrder.fundsStatus === "HELD";

  assert.equal(
    isRefunded || isAcceptedAndHeld,
    true,
    "an order may be refunded or accepted, but never both"
  );
  assert.notEqual(
    storedOrder.orderStatus === "ACCEPTED" &&
      storedOrder.fundsStatus === "REFUNDED",
    true
  );
});

test("delivery settlement refuses orders with unallocated delivery fees", async () => {
  const { seller, product } = await createStoreWithProduct({
    price: 1500,
    stock: 2,
  });
  const buyer = await createUser({ walletBalance: 5000 });
  const created = await call(marketplace.createOrder, {
    user: buyer,
    body: checkoutBody(product),
    headers: { "idempotency-key": "marketplace-delivery-fee-block" },
  });
  const orderId = String(created.body.order._id);

  for (const status of ["ACCEPTED", "PROCESSING", "READY", "SHIPPED"]) {
    const result = await call(marketplace.updateSellerOrderStatus, {
      user: seller,
      params: { orderId },
      body: { status },
    });
    assert.equal(result.status, 200);
  }

  await MarketplaceOrder.updateOne(
    { _id: orderId },
    { $set: { deliveryFee: 200, totalAmount: 1700 } }
  );
  const settlement = await call(marketplace.confirmOrderDelivery, {
    user: buyer,
    params: { orderId },
  });

  assert.equal(settlement.status, 409);
  assert.equal(settlement.body.code, "DELIVERY_FEE_SETTLEMENT_BLOCKED");
  assert.equal((await User.findById(seller._id)).walletBalance, 0);
  assert.equal((await MarketplaceOrder.findById(orderId)).fundsStatus, "HELD");
});

test("suspended sellers cannot edit or sell existing active products", async () => {
  const { seller, product } = await createStoreWithProduct({
    price: 800,
    stock: 2,
  });
  const buyer = await createUser({ walletBalance: 3000 });
  await MarketplaceMerchant.updateOne(
    { user: seller._id },
    { $set: { status: "SUSPENDED" } }
  );

  const mutation = await call(marketplace.updateProduct, {
    user: seller,
    params: { productId: String(product._id) },
    body: { price: 1 },
  });
  const checkout = await call(marketplace.createOrder, {
    user: buyer,
    body: checkoutBody(product),
    headers: { "idempotency-key": "marketplace-test-checkout-suspended" },
  });

  assert.equal(mutation.status, 403);
  assert.equal(checkout.status, 409);
  assert.equal(await MarketplaceOrder.countDocuments(), 0);
  assert.equal(await LedgerEntry.countDocuments(), 0);
  assert.equal((await MarketplaceProduct.findById(product._id)).stock, 2);
});

test("paid legacy orders can enter the controlled fulfillment workflow", async () => {
  const { seller, product } = await createStoreWithProduct();
  const buyer = await createUser({ walletBalance: 5000 });
  const placed = await call(marketplace.createOrder, {
    user: buyer,
    body: checkoutBody(product),
    headers: { "idempotency-key": "marketplace-test-checkout-legacy" },
  });
  const orderId = String(placed.body.order._id);

  await MarketplaceOrder.updateOne(
    { _id: orderId },
    { $set: { orderStatus: "PLACED", paymentStatus: "PAID" } }
  );
  const accepted = await call(marketplace.updateSellerOrderStatus, {
    user: seller,
    params: { orderId },
    body: { status: "ACCEPTED" },
  });

  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.order.orderStatus, "ACCEPTED");
  assert.match(
    accepted.body.order.statusHistory.at(-1).note,
    /legacy status placed/i
  );

  await MarketplaceOrder.updateOne(
    { _id: orderId },
    { $set: { orderStatus: "CONFIRMED", paymentStatus: "PENDING" } }
  );
  const unpaid = await call(marketplace.updateSellerOrderStatus, {
    user: seller,
    params: { orderId },
    body: { status: "ACCEPTED" },
  });
  assert.equal(unpaid.status, 409);
  assert.match(unpaid.body.message, /confirmed payment/i);
});