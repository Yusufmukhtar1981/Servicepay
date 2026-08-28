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
const SolarPackage = require("../models/solarPackage.model");
const SolarOfficer = require("../models/solarOfficer.model");
const Notification = require("../models/notification.model");
const Audit = require("../models/adminAuditLog.model");

const models = [User, Profile, Commission, Rule, PhoneApplication, PhoneProduct, SolarApplication, SolarPackage, SolarOfficer, Notification, Audit];
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

test("invalid partner provisioning payloads do not leave users or profiles", async () => {
  const admin = await makeUser("HEAD_OFFICE");
  const invalidPermissions = await createPartner(admin, "invalid-permissions", ["NOT_A_PERMISSION"]);
  assert.equal(invalidPermissions.status, 400);
  const invalidTerritory = await api({ method:"POST", path:"/api/business-partner/admin/partners", actor:admin, body:{
    fullName:"Bad Territory",phone:"09099990001",email:"bad-territory@test.local",password:"password123",businessName:"Bad",territory:{states:"Lagos",lgas:[]},
  }});
  assert.equal(invalidTerritory.status, 400);
  assert.equal(await User.countDocuments({ role:"BUSINESS_PARTNER" }), 0);
  assert.equal(await Profile.countDocuments(), 0);
});

test("downstream profile and audit failures roll back provisioning completely", async () => {
  const admin = await makeUser("HEAD_OFFICE");
  const originalProfileCreate = Profile.create;
  Profile.create = async () => { throw new Error("forced profile write failure"); };
  try {
    const result = await createPartner(admin, "profile-failure");
    assert.equal(result.status, 500);
  } finally { Profile.create = originalProfileCreate; }
  assert.equal(await User.countDocuments({ role:"BUSINESS_PARTNER" }), 0);
  assert.equal(await Profile.countDocuments(), 0);

  const originalAuditCreate = Audit.create;
  Audit.create = async () => { throw new Error("forced audit write failure"); };
  try {
    const result = await createPartner(admin, "audit-failure");
    assert.equal(result.status, 500);
  } finally { Audit.create = originalAuditCreate; }
  assert.equal(await User.countDocuments({ role:"BUSINESS_PARTNER" }), 0);
  assert.equal(await Profile.countDocuments(), 0);
  assert.equal(await User.countDocuments({ role:"BUSINESS_PARTNER", businessPartnerProfile: { $ne:null } }), 0);
});

test("concurrent provisioning allocates distinct IDs with reciprocal links", async () => {
  const admin = await makeUser("HEAD_OFFICE");
  const results = await Promise.all(Array.from({length:6}, (_, index) => createPartner(admin, `concurrent-${index}`)));
  assert.ok(results.every(result => result.status === 201), JSON.stringify(results.map(result => result.body)));
  const ids = results.map(result => result.body.partner.partnerId);
  assert.equal(new Set(ids).size, ids.length);
  const users = await User.find({ role:"BUSINESS_PARTNER" });
  const profiles = await Profile.find({});
  assert.equal(users.length, 6); assert.equal(profiles.length, 6);
  for (const user of users) {
    assert.ok(user.businessPartnerProfile);
    const profile = profiles.find(row => String(row._id) === String(user.businessPartnerProfile));
    assert.ok(profile);
    assert.equal(String(profile.user), String(user._id));
  }
});

test("partners are isolated, cannot self-claim, and sensitive customer fields are not projected", async () => {
  const admin = await makeUser("HEAD_OFFICE");
  const a = await createPartner(admin, "2", ["DASHBOARD", "APPLICATIONS", "CUSTOMERS", "OFFICERS", "PHONE_ASSIGNMENT"]);
  const b = await createPartner(admin, "3", ["DASHBOARD", "APPLICATIONS", "CUSTOMERS"]);
  const aUser = await User.findById(a.body.user._id), bUser = await User.findById(b.body.user._id);
  assert.equal((await api({ method: "POST", path: "/api/business-partner/officers/link", actor: aUser, body: { type: "PHONE", officerId: new mongoose.Types.ObjectId() } })).status, 403);
  const customer = await makeUser(); customer.nin = "12345678901"; await customer.save();
  const phone = await PhoneApplication.create({ reference: "BP-PHONE-1", customer: customer._id, product: new mongoose.Types.ObjectId(), productSnapshot: { sku: "BP", secretCost: 5 }, profileSnapshot:{address:"SECRET"},kycSnapshot:{nin:"SECRET"},applicationInput: { occupation: "Trader", monthlyIncome:999 }, businessPartner: a.body.partner._id });
  const solar = await SolarApplication.create({customer:customer._id,package:new mongoose.Types.ObjectId(),packageSnapshot:{name:"Home Solar",secretCost:9},profileSnapshot:{address:"SECRET"},kycSnapshot:{nin:"SECRET"},business:{income:999},guarantor:{phone:"SECRET"},businessPartner:a.body.partner._id});
  const unassigned = await PhoneApplication.create({ reference: "BP-PHONE-2", customer: customer._id, product: new mongoose.Types.ObjectId(), productSnapshot: { sku: "BP2" }, applicationInput: { occupation: "Trader" } });
  assert.equal((await api({ path: "/api/business-partner/applications", actor: bUser })).body.applications.phone.length, 0);
  assert.equal((await api({ path: "/api/business-partner/customers", actor: bUser })).body.customers.length, 0);
  assert.equal((await api({ method: "POST", path: `/api/business-partner/applications/${phone._id}/assign`, actor: bUser, body: { type: "PHONE", officerId: new mongoose.Types.ObjectId() } })).status, 403);
  assert.equal((await api({ method: "POST", path: `/api/business-partner/applications/${unassigned._id}/assign`, actor: aUser, body: { type: "PHONE", officerId: new mongoose.Types.ObjectId() } })).status, 404);
  const apps = await api({ path: "/api/business-partner/applications", actor: aUser });
  assert.equal(apps.status, 200, JSON.stringify(apps.body)); assert.equal(apps.body.applications.phone.length, 1);
  const serialized=JSON.stringify(apps.body);
  for(const secret of ["kycSnapshot","profileSnapshot","applicationInput","guarantor","business","monthlyIncome","secretCost"]) assert.equal(serialized.includes(secret),false);
  assert.equal(apps.body.applications.solar[0].package.name,"Home Solar");
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
  const reverseReversal=await api({method:"POST",path:`/api/business-partner/admin/commissions/${reversal.commission._id}/reverse`,actor:admin,body:{eventKey:"illegal-second-order",reason:"not allowed"}});
  assert.equal(reverseReversal.status,409);
  assert.equal(await Commission.countDocuments(),2);
  assert.equal((await Commission.aggregate([{$group:{_id:null,net:{$sum:"$amount"}}}]))[0].net,0);
});