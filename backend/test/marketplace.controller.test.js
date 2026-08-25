const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

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
} = {}) => ({
  user,
  body,
  params,
  query,
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