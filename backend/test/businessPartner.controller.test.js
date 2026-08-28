const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const routes = require("../routes/businessPartner.routes");
const User = require("../models/user.model");
const Profile = require("../models/businessPartnerProfile.model");
const Commission = require("../models/businessPartnerCommission.model");
const Rule = require("../models/businessPartnerCommissionRule.model");
const PhoneApplication = require("../models/phoneApplication.model");
const PhoneProduct = require("../models/phoneProduct.model");
const SolarApplication = require("../models/solarApplication.model");
const SolarOfficer = require("../models/solarOfficer.model");
const Notification = require("../models/notification.model");
const Audit = require("../models/adminAuditLog.model");

const models = [User, Profile, Commission, Rule, PhoneApplication, PhoneProduct, SolarApplication, SolarOfficer, Notification, Audit];
let repl, server, base, sequence = 0;
const makeUser = async (role = "CUSTOMER") => {
  sequence += 1;
  return User.create({ fullName: `User ${sequence}`, phone: `081${String(sequence).padStart(8, "0")}`, email: `user${sequence}@test.local`, password: "password123", role, status: "ACTIVE" });
};
const api = async ({ method = "GET", path, actor, body }) => {
  const headers = { Accept: "application/json" };
  if (actor) headers.Authorization = `Bearer ${jwt.sign({ id: String(actor._id) }, process.env.JWT_SECRET)}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
};
const createPartner = async (admin, suffix, permissions) => api({
  method: "POST", path: "/api/business-partner/admin/partners", actor: admin,
  body: { fullName: `Partner ${suffix}`, phone: `090${suffix}0000000`, email: `partner-${suffix}@test.local`, password: "password123", businessName: `Business ${suffix}`, permissions },
});

test.before(async () => {
  process.env.JWT_SECRET = "business-partner-test-secret";
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(repl.getUri(), { dbName: "business-partner-tests" });
  await Promise.all(models.map(model => model.init()));
  const app = express(); app.use(express.json()); app.use("/api/business-partner", routes);
  await new Promise(resolve => { server = app.listen(0, "127.0.0.1", () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
});
test.after(async () => { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await mongoose.disconnect(); await repl.stop(); });
test.beforeEach(async () => { await Promise.all(models.map(model => model.collection.deleteMany({}))); sequence = 0; });

test("Head Office creates, edits, suspends and resets separately profiled Business Partners", async () => {
  const admin = await makeUser("HEAD_OFFICE");
  const made = await createPartner(admin, "1");
  assert.equal(made.status, 201);
  assert.match(made.body.partner.partnerId, /^SP-BP-\d{6}$/);
  assert.equal(made.body.user.role, "BUSINESS_PARTNER");
  const partnerUser = await User.findById(made.body.user._id);
  assert.equal(String(partnerUser.businessPartnerProfile), String(made.body.partner._id));
  assert.equal((await api({ method: "PATCH", path: `/api/business-partner/admin/partners/${made.body.partner._id}`, actor: admin, body: { businessName: "Edited Business", territory: { states: ["Lagos"] } } })).status, 200);
  assert.equal((await api({ method: "POST", path: `/api/business-partner/admin/partners/${made.body.partner._id}/reset-password`, actor: admin, body: { password: "temporary123" } })).status, 200);
  assert.equal((await User.findById(partnerUser._id)).mustChangePassword, true);
  assert.equal((await api({ path: "/api/business-partner/admin/partners/count", actor: admin })).body.counts.active, 1);
  assert.equal((await api({ path: `/api/business-partner/admin/partners/${made.body.partner._id}`, actor: admin })).status, 200);
  assert.equal((await api({ method: "PATCH", path: `/api/business-partner/admin/partners/${made.body.partner._id}/status`, actor: admin, body: { status: "DISABLED" } })).status, 200);
  assert.equal((await api({ path: "/api/business-partner/me", actor: await User.findById(partnerUser._id) })).status, 403);
  assert.equal(await Notification.countDocuments({ userId: partnerUser._id, type: "BUSINESS_PARTNER" }), 2);
  assert.equal(await Audit.countDocuments({ action: "BUSINESS_PARTNER_STATUS_UPDATED" }), 1);
  assert.equal((await Profile.findById(made.body.partner._id)).status, "DISABLED");
});

test("partners are isolated, cannot self-claim, and sensitive customer fields are not projected", async () => {
  const admin = await makeUser("HEAD_OFFICE");
  const a = await createPartner(admin, "2", ["DASHBOARD", "APPLICATIONS", "CUSTOMERS", "OFFICERS", "PHONE_ASSIGNMENT"]);
  const b = await createPartner(admin, "3", ["DASHBOARD", "APPLICATIONS", "CUSTOMERS"]);
  const aUser = await User.findById(a.body.user._id), bUser = await User.findById(b.body.user._id);
  assert.equal((await api({ method: "POST", path: "/api/business-partner/officers/link", actor: aUser, body: { type: "PHONE", officerId: new mongoose.Types.ObjectId() } })).status, 403);
  const customer = await makeUser(); customer.nin = "12345678901"; await customer.save();
  const phone = await PhoneApplication.create({ reference: "BP-PHONE-1", customer: customer._id, product: new mongoose.Types.ObjectId(), productSnapshot: { sku: "BP" }, applicationInput: { occupation: "Trader" }, businessPartner: a.body.partner._id });
  const unassigned = await PhoneApplication.create({ reference: "BP-PHONE-2", customer: customer._id, product: new mongoose.Types.ObjectId(), productSnapshot: { sku: "BP2" }, applicationInput: { occupation: "Trader" } });
  assert.equal((await api({ path: "/api/business-partner/applications", actor: bUser })).body.applications.phone.length, 0);
  assert.equal((await api({ path: "/api/business-partner/customers", actor: bUser })).body.customers.length, 0);
  assert.equal((await api({ method: "POST", path: `/api/business-partner/applications/${phone._id}/assign`, actor: bUser, body: { type: "PHONE", officerId: new mongoose.Types.ObjectId() } })).status, 403);
  assert.equal((await api({ method: "POST", path: `/api/business-partner/applications/${unassigned._id}/assign`, actor: aUser, body: { type: "PHONE", officerId: new mongoose.Types.ObjectId() } })).status, 404);
  const apps = await api({ path: "/api/business-partner/applications", actor: aUser });
  assert.equal(apps.status, 200, JSON.stringify(apps.body)); assert.equal(apps.body.applications.phone.length, 1);
  const customers = await api({ path: "/api/business-partner/customers", actor: aUser });
  assert.equal(customers.body.customers[0].nin, undefined);
});

test("Head Office allocates cases and partner permissions scope officer assignment", async () => {
  const admin = await makeUser("HEAD_OFFICE");
  const partner = await createPartner(admin, "4", ["OFFICERS", "PHONE_ASSIGNMENT"]);
  const partnerUser = await User.findById(partner.body.user._id);
  const customer = await makeUser();
  const app = await PhoneApplication.create({ reference: "BP-ALLOC-1", customer: customer._id, product: new mongoose.Types.ObjectId(), productSnapshot: { sku: "ALLOC" }, applicationInput: { occupation: "Trader" } });
  const allocation = await api({ method: "POST", path: `/api/business-partner/admin/partners/${partner.body.partner._id}/applications/${app._id}/assign`, actor: admin, body: { type: "PHONE" } });
  assert.equal(allocation.status, 200, JSON.stringify(allocation.body));
  const officer = await makeUser("PHONE_FINANCING_OFFICER"); officer.isStaff = true; officer.businessPartnerId = partner.body.partner._id; await officer.save();
  assert.equal((await api({ method: "POST", path: `/api/business-partner/applications/${app._id}/assign`, actor: partnerUser, body: { type: "PHONE", officerId: officer._id } })).status, 200);
  assert.equal(String((await PhoneApplication.findById(app._id)).assignedOfficer), String(officer._id));
  const deniedPartner = await createPartner(admin, "5", ["DASHBOARD"]);
  assert.equal((await api({ path: "/api/business-partner/customers", actor: await User.findById(deniedPartner.body.user._id) })).status, 403);
  assert.equal(await Notification.countDocuments({ userId: partner.body.user._id, referenceType: "BusinessPartnerAssignment" }), 1);
});

test("commission events are idempotent and immutable reversals are compensating rows", async () => {
  const admin = await makeUser("HEAD_OFFICE");
  const partner = await createPartner(admin, "6");
  const service = require("../services/businessPartnerCommission.service");
  const payload = { businessPartner: partner.body.partner._id, application: new mongoose.Types.ObjectId(), sourceType: "PHONE", amount: 125, eventKey: "bp-event-1", createdBy: admin._id };
  const first = await service.createCommission(payload), replay = await service.createCommission(payload);
  assert.equal(first.idempotent, false); assert.equal(replay.idempotent, true); assert.equal(await Commission.countDocuments(), 1);
  await assert.rejects(() => Commission.updateOne({ _id: first.commission._id }, { $set: { amount: 1 } }), /append-only/);
  const reversal = await service.reverseCommission({ commissionId: first.commission._id, eventKey: "bp-event-1-reversal", createdBy: admin._id, reason: "Application cancelled" });
  assert.equal(reversal.commission.status, "REVERSED");
  assert.equal(String(reversal.commission.reversalOf), String(first.commission._id));
  const sequential = await service.reverseCommission({ commissionId: first.commission._id, eventKey: "different-key", createdBy: admin._id });
  assert.equal(sequential.idempotent, true);
  const concurrent = await Promise.all(["concurrent-a", "concurrent-b"].map(eventKey => service.reverseCommission({ commissionId: first.commission._id, eventKey, createdBy: admin._id })));
  assert.ok(concurrent.every(row => String(row.commission._id) === String(reversal.commission._id)));
  assert.equal(await Commission.countDocuments(), 2);
  const net = await Commission.aggregate([{ $group: { _id: null, net: { $sum: "$amount" } } }]);
  assert.equal(net[0].net, 0);
});