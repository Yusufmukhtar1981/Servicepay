const test = require("node:test");
const assert = require("node:assert/strict");

const adminRoutes = require("../routes/admin.routes");
const controller = require("../controllers/adminMarketplace.controller");
const MarketplaceProduct = require("../models/marketplace.model");

const response = () => {
  const result = {};
  return {
    result,
    status(code) {
      result.status = code;
      return this;
    },
    json(body) {
      result.status ??= 200;
      result.body = body;
      return this;
    },
  };
};

test("admin Marketplace compatibility routes are registered", () => {
  const routes = adminRoutes.stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      path: layer.route.path,
      methods: layer.route.methods,
    }));

  assert.ok(routes.some((route) =>
    route.path === "/marketplace/products" && route.methods.get));
  assert.ok(routes.some((route) =>
    route.path === "/marketplace/products/:id" && route.methods.get));
  for (const action of ["approve", "reject", "suspend"]) {
    assert.ok(routes.some((route) =>
      route.path === `/marketplace/products/:id/${action}` &&
      route.methods.patch));
  }
});

test("admin Marketplace list returns a stable empty response", async () => {
  const originalFind = MarketplaceProduct.find;
  const originalCount = MarketplaceProduct.countDocuments;
  MarketplaceProduct.find = () => ({
    sort: () => ({
      skip: () => ({
        limit: () => ({ lean: async () => [] }),
      }),
    }),
  });
  MarketplaceProduct.countDocuments = async () => 0;

  try {
    const res = response();
    await controller.listMarketplaceProducts(
      { query: { limit: "100", status: "PENDING" }, staffAccess: { isHeadOffice: true } },
      res,
    );
    assert.equal(res.result.status, 200);
    assert.deepEqual(res.result.body.products, []);
    assert.deepEqual(res.result.body.pagination, {
      page: 1, limit: 100, total: 0, pages: 1,
    });
  } finally {
    MarketplaceProduct.find = originalFind;
    MarketplaceProduct.countDocuments = originalCount;
  }
});

test("admin Marketplace rejects an unsupported product status", async () => {
  const res = response();
  await controller.listMarketplaceProducts(
    { query: { status: "DELETED" }, staffAccess: { isHeadOffice: true } },
    res,
  );
  assert.equal(res.result.status, 400);
  assert.equal(res.result.body.success, false);
});

test("APPROVED remains a backwards-compatible alias for ACTIVE", async () => {
  let filter;
  const originalFind = MarketplaceProduct.find;
  const originalCount = MarketplaceProduct.countDocuments;
  MarketplaceProduct.find = (value) => {
    filter = value;
    return {
      sort: () => ({
        skip: () => ({
          limit: () => ({ lean: async () => [] }),
        }),
      }),
    };
  };
  MarketplaceProduct.countDocuments = async () => 0;

  try {
    const res = response();
    await controller.listMarketplaceProducts(
      { query: { status: "APPROVED" }, staffAccess: { isHeadOffice: true } },
      res,
    );
    assert.equal(res.result.status, 200);
    assert.equal(filter.status, "ACTIVE");
  } finally {
    MarketplaceProduct.find = originalFind;
    MarketplaceProduct.countDocuments = originalCount;
  }
});