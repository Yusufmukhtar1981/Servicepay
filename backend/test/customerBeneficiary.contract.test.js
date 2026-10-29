const fs = require("fs");
const test = require("node:test");
const assert = require("node:assert/strict");
const CustomerBeneficiary = require("../models/customerBeneficiary.model");
const User = require("../models/user.model");
const controller = require("../controllers/customerBeneficiary.controller");

const original = [];
const customerId = "a".repeat(24);
const foreignId = "b".repeat(24);
let owner;
const query = value => ({
  select() { return this; }, limit() { return this; },
  async lean() { return typeof value === "function" ? value() : value; },
});
const replace = (model, name, value) => {
  if (!original.some(row => row.model === model && row.name === name)) original.push({ model, name, value: model[name] });
  model[name] = value;
};
test.beforeEach(() => {
  owner = { _id: customerId, role: "CUSTOMER", status: "ACTIVE", savedTelecomBeneficiaries: [] };
  replace(CustomerBeneficiary, "find", filter => {
    assert.equal(String(filter.customer), customerId);
    return query([]);
  });
  replace(User, "findOne", filter => {
    assert.equal(String(filter._id), customerId);
    assert.equal(filter.role, "CUSTOMER");
    assert.equal(filter.status, "ACTIVE");
    return query(owner);
  });
});
test.afterEach(() => {
  for (const row of original) row.model[row.name] = row.value;
  original.length = 0;
});
const response = async (handler, req) => {
  const result = { status: 200 };
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
    assert.equal(require("../controllers/customerBeneficiary.controller").normalizePhone("+234 801-234-5678"), "08012345678");
    assert.match(controller, /_id: customerId\(req\), role: "CUSTOMER", status: "ACTIVE"/);
});

test("create normalizes 234 numbers and list/search is customer scoped", async () => {
  let stored;
  replace(User, "findOneAndUpdate", (filter, update) => {
    assert.equal(String(filter._id), customerId);
    assert.deepEqual(filter["savedTelecomBeneficiaries.normalizedPhone"], { $ne: "08012345678" });
    assert.ok(filter.$expr);
    stored = update.$push.savedTelecomBeneficiaries;
    owner.savedTelecomBeneficiaries.push(stored);
    return query(owner);
  });
  const created = await response(controller.create, {
    user: { _id: customerId },
    body: { phone: "+234 801-234-5678", name: "Mum", serviceType: "AIRTIME" },
  });
  assert.equal(created.status, 201);
  assert.equal(stored.phone, "08012345678");
  assert.equal(owner.savedTelecomBeneficiaries.length, 1);
  const listed = await response(controller.list, { user: { _id: customerId }, query: { search: "mum" } });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.beneficiaries[0]._id, String(stored._id));
  assert.equal(listed.body.beneficiaries[0].phone, "08012345678");
  assert.equal(listed.body.beneficiaries[0].customer, undefined);
});

test("update and delete cannot cross customer ownership", async () => {
  replace(User, "findOneAndUpdate", filter => {
    assert.equal(String(filter._id), customerId);
    assert.equal(filter["savedTelecomBeneficiaries._id"], foreignId);
    return query(null);
  });
  replace(CustomerBeneficiary, "deleteOne", async filter => {
    assert.equal(String(filter.customer), customerId);
    assert.equal(filter._id, foreignId);
    return { deletedCount: 0 };
  });
  replace(User, "updateOne", async filter => {
    assert.equal(String(filter._id), customerId);
    assert.equal(filter["savedTelecomBeneficiaries._id"], foreignId);
    return { modifiedCount: 0 };
  });
  const updated = await response(controller.update, { user: { _id: customerId }, params: { id: foreignId }, body: { name: "Nope" } });
  const removed = await response(controller.remove, { user: { _id: customerId }, params: { id: foreignId } });
  assert.equal(updated.status, 404);
  assert.equal(removed.status, 404);
});

test("duplicate create returns the existing record without another insertion", async () => {
  owner.savedTelecomBeneficiaries.push({ _id: foreignId, phone: "08012345678", normalizedPhone: "08012345678", name: "Mum" });
  replace(User, "findOneAndUpdate", () => query(null));
  const result = await response(controller.create, { user: { _id: customerId }, body: { phone: "+2348012345678", name: "Changed name" } });
  assert.equal(result.status, 200);
  assert.equal(result.body.beneficiary._id, foreignId);
  assert.equal(result.body.beneficiary.name, "Mum");
  assert.equal(owner.savedTelecomBeneficiaries.length, 1);
});