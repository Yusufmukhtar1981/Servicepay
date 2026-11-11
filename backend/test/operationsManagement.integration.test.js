const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const User = require("../models/user.model");
const Audit = require("../models/adminAuditLog.model");
const Merchant = require("../models/marketplaceMerchant.model");
const Product = require("../models/marketplace.model");
const Order = require("../models/marketplaceOrder.model");
const Delivery = require("../models/delivery.model");
const controller = require("../controllers/operationsManagement.controller");
const profile = require("../controllers/customerProfile.controller");
const moderation = require("../controllers/adminMarketplace.controller");
let mongo, actor, customer, zone, state, agent, seller, product, seq = 0;
const access = permissions => ({ isHeadOffice: false, roleName: "OPERATIONS_MANAGER",
  scope: { type: "GLOBAL" }, permissions: ["operations.workspace.view", ...permissions] });
const invoke = async (fn, extra = {}) => {
  const out = { status: 200 };
  await fn({ user: actor, staffAccess: access([]), staffRole: { permissions: [] },
    params: {}, query: {}, body: {}, method: "GET", originalUrl: "/test/operations", ...extra },
  { status(v) { out.status = v; return this; }, set() { return this; },
    json(v) { out.body = v; return this; }, send(v) { out.bytes = v; return this; } });
  return out;
};
before(async () => {
  for (const k of ["MONGODB_URI", "MONGO_URI", "MONGO_URL", "DATABASE_URL"])
    assert.equal(process.env[k], undefined, "Tests must never inherit a production database.");
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(mongo.getUri(), { dbName: "operations-management-disposable" });
  await Promise.all([User, Audit, Merchant, Product, Order, Delivery].map(m => m.init()));
  const make = (role, fullName, extra = {}) => User.create({ role, fullName, password: "LocalFixture91!",
    status: "ACTIVE", phone: `080${String(++seq).padStart(8, "0")}`, email: `ops-new-${seq}@example.invalid`, ...extra });
  actor = await make("STAFF", "Disposable Operations");
  customer = await make("CUSTOMER", "Disposable Customer", { walletBalance: 4250, address: "Old address" });
  zone = await make("ZONAL_MANAGER", "North West Manager", { zone: "North West" });
  state = await make("STATE_MANAGER", "Kaduna Manager", { state: "Kaduna", zonalManagerId: zone._id });
  agent = await make("AGENT", "Kaduna Aggregator", { stateManagerId: state._id, zonalManagerId: zone._id });
  seller = await Merchant.create({ user: customer._id, storeName: "Disposable Store", status: "PENDING" });
  product = await Product.create({ merchant: customer._id, merchantName: "Disposable Store",
    title: "Disposable product", price: 100, status: "PENDING" });
});
after(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });
test("all management handlers deny Support, scoped Operations and guests before querying", async () => {
  for (const staffAccess of [undefined, { ...access([]), roleName: "CUSTOMER_SUPPORT" },
    { ...access([]), scope: { type: "BRANCH" } }]) {
    for (const fn of [controller.hub, controller.directory, controller.activity, controller.marketplace, controller.sellerStatus]) {
      assert.equal((await invoke(fn, { staffAccess })).status, 403);
    }
  }
});
test("summary returns actual customer totals and omits unauthorized operational datasets", async () => {
  const r = await invoke(controller.hub);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data.customers, { total: 1, active: 1, inactive: 0 });
  assert.equal(r.body.data.deliveries, null);
  assert.equal(r.body.data.staff, null);
  const full = await invoke(controller.hub, { staffAccess: access(["operations.staff.view", "marketplace.view", "delivery.view"]) });
  assert.equal(full.body.data.staff.AGGREGATOR, 1);
  assert.equal(full.body.data.products.PENDING, 1);
});
test("directory uses actual assigned hierarchy and never discloses authentication data", async () => {
  assert.equal((await invoke(controller.directory, { query: { role: "AGGREGATOR" } })).status, 403);
  const r = await invoke(controller.directory, { staffAccess: access(["operations.staff.view"]),
    query: { role: "AGGREGATOR", parentId: String(state._id), q: "Kaduna" } });
  assert.equal(r.status, 200); assert.equal(r.body.data.total, 1);
  assert.equal(String(r.body.data.items[0].stateManagerId._id), String(state._id));
  assert.equal(r.body.data.items[0].zonalManagerId.fullName, zone.fullName);
  assert.equal(Object.hasOwn(r.body.data.items[0], "password"), false);
  assert.equal(Object.hasOwn(r.body.data.items[0], "walletBalance"), false);
  assert.equal((await invoke(controller.directory, { staffAccess: access(["operations.staff.view"]), query: { role: "HEAD_OFFICE" } })).status, 400);
});
test("literal searches and bounded pagination reject injection-shaped input", async () => {
  const request = { staffAccess: access(["operations.staff.view"]), query: { role: "AGGREGATOR", q: ".*" } };
  assert.equal((await invoke(controller.directory, request)).body.data.total, 0);
  assert.equal((await invoke(controller.directory, { ...request, query: { role: "AGGREGATOR", q: { $ne: "" } } })).status, 400);
  assert.deepEqual(controller._test.pagination({ page: -1, limit: 10000 }), { page: 1, limit: 100, skip: 0 });
});
test("Operations profile edit reuses transaction and audit while preserving money, contacts and assignments", async () => {
  const r = await invoke(profile.updateOperations, { staffAccess: access(["users.update"]),
    params: { id: String(customer._id) }, body: { fullName: "Corrected Customer", address: "Updated address", reason: "Customer requested correction" } });
  assert.equal(r.status, 200);
  const u = await User.findById(customer._id).lean();
  assert.equal(u.walletBalance, 4250); assert.equal(u.phone, customer.phone);
  assert.equal(u.fullName, "Corrected Customer");
  assert.equal(await Audit.countDocuments({ targetUserId: customer._id, "metadata.source": "OPERATIONS_PROFILE" }), 1);
});
test("profile edit denies contact, KYC, role, wallet and hierarchy changes even with profile permission", async () => {
  for (const field of ["phone", "email", "walletBalance", "role", "zone", "state", "kycStatus", "authTokenVersion"]) {
    const r = await invoke(profile.updateOperations, { staffAccess: access(["users.update"]),
      params: { id: String(customer._id) }, body: { [field]: "changed", reason: "Unacceptable field change" } });
    assert.equal(r.status, 403, field);
  }
  assert.equal((await invoke(profile.updateOperations, { params: { id: String(customer._id) },
    body: { fullName: "Another name", reason: "Permission not granted" } })).status, 403);
});
test("seller changes require permission, reason and current state; audit is atomic", async () => {
  const request = { params: { id: String(seller._id) }, body: {
    status: "ACTIVE", expectedStatus: "PENDING", reason: "Business review completed" } };
  assert.equal((await invoke(controller.sellerStatus, request)).status, 403);
  const r = await invoke(controller.sellerStatus, { ...request, staffAccess: access(["marketplace.moderate"]) });
  assert.equal(r.status, 200);
  assert.equal(await Audit.countDocuments({ "metadata.sellerId": String(seller._id), "metadata.status": "ACTIVE" }), 1);
  assert.equal((await invoke(controller.sellerStatus, { ...request, staffAccess: access(["marketplace.moderate"]) })).status, 409);
  assert.equal((await User.findById(customer._id)).walletBalance, 4250);
});
test("marketplace lists are permission-bound, paginated and financial-write free", async () => {
  assert.equal((await invoke(controller.marketplace)).status, 403);
  const r = await invoke(controller.marketplace, { staffAccess: access(["marketplace.view"]), query: { kind: "sellers" } });
  assert.equal(r.body.data.total, 1);
  assert.equal(Object.hasOwn(r.body.data.items[0], "password"), false);
  const orders = await invoke(controller.marketplace, { staffAccess: access(["marketplace.view"]), query: { kind: "orders" } });
  assert.equal(orders.status, 200);
});
test("existing product moderation captures reasons, detects stale state and preserves price", async () => {
  const request = { params: { id: String(product._id) }, staffAccess: access(["marketplace.moderate"]),
    body: { status: "REJECTED", expectedStatus: "PENDING", reason: "Product violates marketplace policy" } };
  assert.equal((await invoke(moderation.updateMarketplaceProductStatus, { ...request, body: { status: "REJECTED" } })).status, 400);
  assert.equal((await invoke(moderation.updateMarketplaceProductStatus, request)).status, 200);
  assert.equal((await Product.findById(product._id)).price, 100);
  assert.equal((await invoke(moderation.updateMarketplaceProductStatus, request)).status, 409);
  assert.equal(await Audit.countDocuments({ "metadata.productId": String(product._id) }), 1);
});
test("global Operations sees legacy/global products without exposing them to branch staff", async () => {
  const r = await invoke(moderation.listMarketplaceProducts, {
    staffAccess: access(["marketplace.view"]), query: { status: "ALL" },
  });
  assert.equal(r.status, 200);
  assert.ok(r.body.products.some(p => String(p._id) === String(product._id)));
});
test("year reports include older stored transactions without inflating monthly totals", async () => {
  const Transaction = require("../models/transaction.model");
  const service = require("../services/operationsEnterprise.service");
  await Transaction.init();
  await Transaction.create({ customerId: customer._id, serviceType: "DATA", status: "SUCCESSFUL",
    amount: 100, servicepayProfit: 10, reference: "OPS-YEAR-OLD",
    createdAt: new Date(Date.now() - 100 * 86400000) });
  const request = { user: actor, staffAccess: access([]), staffRole: { permissions: [] } };
  const yearly = await service.summary(request, { period: "year" });
  const monthly = await service.summary(request, { period: "month" });
  assert.equal(yearly.summary.total, 1);
  assert.equal(monthly.summary.total, 0);
  assert.equal(yearly.financial.monthlyEarnings, 0);
});
test("activity is bounded and returns operational audit evidence without raw financial metadata", async () => {
  const r = await invoke(controller.activity, { query: { period: "year" } });
  assert.equal(r.status, 200); assert.ok(r.body.data.total >= 3);
  assert.equal(Object.hasOwn(r.body.data.items[0], "metadata"), false);
  assert.equal((await invoke(controller.activity, { query: { period: "all" } })).status, 400);
});
test("operational CSV reports enforce module permissions and export real records safely", async () => {
  assert.equal((await invoke(controller.report, { query: { type: "customers" } })).status, 403);
  const request = { staffAccess: access(["reports.export", "users.view", "operations.staff.view", "delivery.view", "marketplace.view"]),
    query: { type: "customers", period: "year" } };
  const r = await invoke(controller.report, request);
  assert.equal(r.status, 200);
  assert.match(r.bytes, /Corrected Customer/);
  assert.doesNotMatch(r.bytes, /walletBalance|password|authToken|4250/);
  for (const type of ["profile-changes", "deliveries", "marketplace", "staff"])
    assert.equal((await invoke(controller.report, { ...request, query: { type, period: "month" } })).status, 200, type);
  assert.equal((await invoke(controller.report, { ...request, staffAccess: access(["reports.export"]),
    query: { type: "staff" } })).status, 403);
});
test("an ordinary Operations staff account logs in with its assigned role and no financial permissions", async () => {
  const Role = require("../models/role.model");
  const role = await Role.create({ name: "OPERATIONS_MANAGER", displayName: "Operations Manager",
    department: "OPERATIONS", status: "ACTIVE", scopeType: "GLOBAL",
    permissions: ["operations.workspace.view", "users.view", "delivery.view", "marketplace.view", "operations.staff.view"] });
  actor.isStaff = true;
  actor.staffRoleId = role._id;
  await actor.save();
  const r = await invoke(require("../controllers/auth.controller").loginUser, {
    body: { email: actor.email, password: "LocalFixture91!" },
    headers: {}, ip: "127.0.0.1", get: () => "",
  });
  assert.equal(r.status, 200);
  const data = r.body.data || r.body;
  assert.equal(data.user.role, "STAFF");
  assert.equal(typeof data.token, "string");
  assert.equal(role.permissions.includes("wallets.adjust"), false);
  assert.equal(role.permissions.includes("transactions.refund"), false);
});
