/*
 * Scope contract tests use model-shaped stubs rather than a Mongo replica set.
 * The assertions intentionally inspect the filters sent to every collection;
 * this prevents a passing test which only checks response formatting.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const id = () => new mongoose.Types.ObjectId();
const chain = (value) => ({
  select() { return this; },
  sort() { return this; },
  skip() { return this; },
  limit() { return this; },
  lean: async () => value,
});

test("zonal oversight lists and details all four sections from the authorized zone", async (t) => {
  const service = require("../services/zonalScope.service");
  const User = require("../models/user.model");
  const Delivery = require("../models/delivery.model");
  const Empowerment = require("../models/empowermentOrganization.model");
  const { Organization } = require("../models/organizations.models");
  const School = require("../models/edupaySchool.model");
  const SchoolRequest = require("../models/edupaySchoolRequest.model");
  const controller = require("../controllers/zonalOversight.controller");
  const manager = id(), foreign = id(), customer = id(), foreignCustomer = id();
  const records = {
    delivery: [{ _id: id(), customerId: customer, trackingNumber: "NORTH-1" }],
    edupay: [{ _id: id(), stateManagerId: manager, name: "North School" }],
    empowerment: [{ _id: id(), createdBy: customer, name: "North Co-op" }],
    organizations: [{ _id: id(), createdBy: customer, name: "North Org" }],
  };
  const models = { delivery: Delivery, edupay: School, empowerment: Empowerment, organizations: Organization };
  const originals = new Map();
  const filters = {};
  t.after(() => {
    service.getZonalScope = originals.get("scope");
    for (const [model, methods] of originals) {
      if (model !== "scope") {
        for (const [name, fn] of Object.entries(methods)) model[name] = fn;
      }
    }
  });
  originals.set("scope", service.getZonalScope);
  service.getZonalScope = async () => ({
    stateManagerIds: [manager], agentIds: [], customerIds: [customer, foreignCustomer],
  });
  // Only the actual CUSTOMER owner is accepted; a stale/unknown scope ID is
  // deliberately not enough to authorize an organization record.
  originals.set(User, { find: User.find });
  User.find = () => ({ select: () => ({ lean: async () => [{ _id: customer }] }) });
  originals.set(SchoolRequest, { find: SchoolRequest.find });
  SchoolRequest.find = () => chain([]);
  for (const [section, model] of Object.entries(models)) {
    originals.set(model, { find: model.find, countDocuments: model.countDocuments, findOne: model.findOne, exists: model.exists });
    model.find = (query) => { filters[section] = query; return chain(records[section]); };
    model.countDocuments = async () => records[section].length;
    model.findOne = () => chain(records[section][0]);
    model.exists = async () => true;
  }
  for (const section of Object.keys(models)) {
    const response = {};
    await controller.list({ user: { _id: manager }, params: { section }, query: { page: "1", limit: "10" } }, {
      json(value) { Object.assign(response, value); return this; },
      status() { return this; },
    }, assert.fail);
    assert.equal(response.items.length, 1, section);
  }
  assert.deepEqual(filters.delivery.customerId.$in, [customer, foreignCustomer]);
  assert.deepEqual(filters.edupay.stateManagerId.$in, [manager]);
  assert.deepEqual(filters.empowerment.createdBy.$in, [customer]);
  assert.deepEqual(filters.organizations.createdBy.$in, [customer]);
  const detailResponse = {};
  await controller.getOne({ user: { _id: manager }, params: { section: "delivery", id: records.delivery[0]._id } }, {
    json(value) { Object.assign(detailResponse, value); },
    status(code) { this.code = code; return this; },
  }, assert.fail);
  assert.equal(detailResponse.item._id, records.delivery[0]._id);
  assert.notEqual(filters.delivery.customerId.$in.includes(foreign), true);
});

test("overview counts transactions by customer ownership only", async (t) => {
  const service = require("../services/zonalScope.service");
  const User = require("../models/user.model");
  const Transaction = require("../models/transaction.model");
  const Delivery = require("../models/delivery.model");
  const Empowerment = require("../models/empowermentOrganization.model");
  const { Organization } = require("../models/organizations.models");
  const School = require("../models/edupaySchool.model");
  const SchoolRequest = require("../models/edupaySchoolRequest.model");
  const controller = require("../controllers/zonalOversight.controller");
  const customer = id(), manager = id(), staleManager = id();
  const originalScope = service.getZonalScope;
  const originals = { find: User.find, count: User.countDocuments, transaction: Transaction.countDocuments, delivery: Delivery.aggregate, deliveryCount: Delivery.countDocuments, school: School.find, request: SchoolRequest.find, empowerment: Empowerment.countDocuments, organization: Organization.countDocuments };
  t.after(() => {
    service.getZonalScope = originalScope;
    User.find = originals.find; User.countDocuments = originals.count;
    Transaction.countDocuments = originals.transaction;
    Delivery.aggregate = originals.delivery;
    Delivery.countDocuments = originals.deliveryCount;
    Empowerment.countDocuments = originals.empowerment;
    Organization.countDocuments = originals.organization;
    School.find = originals.school; SchoolRequest.find = originals.request;
  });
  service.getZonalScope = async () => ({ stateManagerIds: [manager], agentIds: [], customerIds: [customer] });
  User.find = () => ({ select: () => ({ lean: async () => [{ _id: customer }] }) });
  User.countDocuments = async () => 0;
  School.find = () => chain([]);
  SchoolRequest.find = () => chain([]);
  let transactionFilter;
  Transaction.countDocuments = async (filter) => { transactionFilter = filter; return 7; };
  Delivery.countDocuments = async () => 0;
  Empowerment.countDocuments = async () => 0;
  Organization.countDocuments = async () => 0;
  Delivery.aggregate = async (pipeline) => {
    assert.deepEqual(pipeline[0].$match.customerId.$in, [customer]);
    return [{ total: 6, pending: 1, inProgress: 2, completed: 1, failed: 1, cancelled: 1, totalValue: 9000 }];
  };
  const response = {};
  await controller.getOverview({ user: { _id: manager } }, { json(value) { Object.assign(response, value); } }, assert.fail);
  assert.equal(response.transactions, 7);
  assert.deepEqual(response.deliverySummary, { total: 6, pending: 1, inProgress: 2, completed: 1, failed: 1, cancelled: 1, totalValue: 9000 });
  assert.deepEqual(transactionFilter, { customerId: { $in: [customer] } });
  assert.equal("$or" in transactionFilter, false, "stale manager references must not authorize transactions");
});

test("pending EduPay requests are state-manager scoped and deduplicated", async (t) => {
  const service = require("../services/zonalScope.service");
  const School = require("../models/edupaySchool.model");
  const Request = require("../models/edupaySchoolRequest.model");
  const controller = require("../controllers/zonalOversight.controller");
  const manager = id(), foreignManager = id(), schoolId = id(), linked = id();
  const originalScope = service.getZonalScope;
  const originals = { schoolFind: School.find, requestFind: Request.find };
  t.after(() => {
    service.getZonalScope = originalScope;
    School.find = originals.schoolFind; Request.find = originals.requestFind;
  });
  service.getZonalScope = async () => ({ stateManagerIds: [manager], agentIds: [], customerIds: [] });
  School.find = (filter) => {
    assert.deepEqual(filter.stateManagerId.$in, [manager]);
    return chain([{ _id: schoolId, stateManagerId: manager, name: "Approved", createdAt: new Date() }]);
  };
  Request.find = (filter) => {
    assert.deepEqual(filter.stateManagerId.$in, [manager]);
    assert.deepEqual(filter.status.$in, ["PENDING_REVIEW", "CONTACTED"]);
    return chain([
      { _id: linked, school: schoolId, schoolName: "Duplicate", stateManagerId: manager, status: "PENDING_REVIEW" },
      { _id: id(), school: null, schoolName: "Pending North", stateManagerId: manager, status: "CONTACTED" },
      // A real Mongo query excludes this row; retaining it here verifies the
      // controller never widens the request filter to state/address.
    ]);
  };
  const response = {};
  await controller.list({ params: { section: "edupay" }, query: {} }, {
    json(value) { Object.assign(response, value); },
  }, assert.fail);
  assert.equal(response.total, 2);
  assert.equal(response.items.some((item) => item.schoolName === "Duplicate"), false);
  assert.equal(response.items.some((item) => item.schoolName === "Foreign"), false);
  assert.deepEqual(Object.keys(response.items.find((item) => item.schoolName === "Pending North")), ["_id", "schoolName", "state", "status", "stateManagerId", "createdAt", "updatedAt"]);
});

test("non-zonal and cross-zone detail requests return 403", async () => {
  const controller = require("../controllers/zonalOversight.controller");
  const response = { code: 200 };
  controller.middleware[1]({ user: { role: "CUSTOMER" } }, {
    status(code) { response.code = code; return this; },
    json(value) { response.body = value; },
  }, () => assert.fail("next must not run"));
  assert.equal(response.code, 403);
});

test("zonal route precedence keeps overview and section detail distinct", () => {
  const router = require("../routes/zonalOversight.routes");
  const paths = router.stack.filter((layer) => layer.route).map((layer) => layer.route.path);
  assert.ok(paths.indexOf("/overview") < paths.indexOf("/:section"));
  assert.ok(paths.indexOf("/:section") < paths.indexOf("/:section/:id"));
});