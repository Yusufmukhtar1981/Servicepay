const fs = require("fs");
const test = require("node:test");
const assert = require("node:assert/strict");
const CustomerBeneficiary = require("../models/customerBeneficiary.model");
const controller = require("../controllers/customerBeneficiary.controller");

const original = new Map();
const replace = (name, value) => {
  if (!original.has(name)) original.set(name, CustomerBeneficiary[name]);
  CustomerBeneficiary[name] = value;
};
test.afterEach(() => {
  for (const [name, value] of original) CustomerBeneficiary[name] = value;
  original.clear();
});
const response = async (handler, req) => {
  const result = {};
  const res = { status(code) { result.status = code; return this; }, json(body) { result.body = body; return this; } };
  await handler(req, res);
  return result;
};

test("uses customer-scoped unique phone records", () => {
    const model = fs.readFileSync("backend/models/customerBeneficiary.model.js", "utf8");
    assert.match(model, /customer:\s*\{/);
    assert.match(model, /customer:\s*1,\s*phone:\s*1/);
    assert.match(model, /unique:\s*true/);
});

test("routes expose authenticated CRUD and controller normalizes numbers", () => {
    const routes = fs.readFileSync("backend/routes/customerBeneficiary.routes.js", "utf8");
    const controller = fs.readFileSync("backend/controllers/customerBeneficiary.controller.js", "utf8");
    assert.match(routes, /router\.use\(protect\)/);
    assert.match(routes, /router\.get/);
    assert.match(routes, /router\.post/);
    assert.match(routes, /router\.patch/);
    assert.match(routes, /router\.delete/);
    assert.match(controller, /startsWith\("234"\)/);
    assert.match(controller, /customer: customerId\(req\)/);
});

test("create normalizes 234 numbers and list/search is customer scoped", async () => {
  let stored;
  replace("findOneAndUpdate", async (filter, update) => {
    stored = { _id: "b1", ...filter, ...update.$set };
    return stored;
  });
  const created = await response(controller.create, {
    user: { _id: "customer-a" },
    body: { phone: "+234 801-234-5678", name: "Mum", serviceType: "AIRTIME" },
  });
  assert.equal(created.status, 201);
  assert.equal(stored.phone, "08012345678");
  assert.equal(stored.customer, "customer-a");

  replace("find", () => ({ sort: () => ({ lean: async () => [{ _id: "b1", customer: "customer-a", phone: "08012345678" }] }) }));
  const listed = await response(controller.list, { user: { _id: "customer-a" }, query: { search: "Mum" } });
  assert.equal(listed.status, undefined);
  assert.equal(listed.body.beneficiaries[0].customer, "customer-a");
});

test("update and delete cannot cross customer ownership", async () => {
  replace("findOneAndUpdate", async (filter) => {
    assert.equal(filter.customer, "customer-a");
    return null;
  });
  replace("findOneAndDelete", async (filter) => {
    assert.equal(filter.customer, "customer-a");
    return null;
  });
  const updated = await response(controller.update, { user: { _id: "customer-a" }, params: { id: "b-owned-by-b" }, body: { name: "Nope" } });
  const removed = await response(controller.remove, { user: { _id: "customer-a" }, params: { id: "b-owned-by-b" } });
  assert.equal(updated.status, 404);
  assert.equal(removed.status, 404);
});

test("duplicate create returns conflict", async () => {
  replace("findOneAndUpdate", async () => { const error = new Error("duplicate"); error.code = 11000; throw error; });
  const result = await response(controller.create, { user: { _id: "customer-a" }, body: { phone: "08012345678", name: "Mum" } });
  assert.equal(result.status, 409);
});