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
const SolarOfficerWallet = require("../models/solarOfficerWallet.model");
const SolarOfficerCommission = require("../models/solarOfficerCommission.model");
const Notification = require("../models/notification.model");
const Audit = require("../models/adminAuditLog.model");
const {
  BUSINESS_PARTNER_VIEW_PERMISSIONS,
} = require("../config/businessPartnerPermissions");

const models = [User, Profile, Commission, Rule, PhoneApplication, PhoneProduct, SolarApplication, SolarPackage, SolarOfficer, SolarOfficerWallet, SolarOfficerCommission, Notification, Audit];
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
const createPartner = async (admin, suffix, permissions, services = []) => api({
  method: "POST", path: "/api/business-partner/admin/partners", actor: admin,
  body: { fullName: `Partner ${suffix}`, phone: `090${suffix}0000000`, email: `partner-${suffix}@test.local`, password: "password123", businessName: `Business ${suffix}`, permissions, services },
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

test("Solar, Phone, and combined services remain separate from canonical permissions", async () => {
  const admin = await makeUser("HEAD_OFFICE");
  const cases = [
    ["solar", ["SOLAR"], ["SOLAR_ASSIGNMENT"]],
    ["phone", ["PHONE"], ["PHONE_ASSIGNMENT"]],
    ["both", ["SOLAR", "PHONE"], ["SOLAR_ASSIGNMENT", "PHONE_ASSIGNMENT"]],
  ];
  for (const [suffix, services, permissions] of cases) {
    const made = await createPartner(admin, suffix, permissions, services);
    assert.equal(made.status, 201, JSON.stringify(made.body));
    assert.deepEqual([...made.body.partner.services].sort(), [...services].sort());
    assert.equal(made.body.partner.permissions.includes("SOLAR"), false);
    assert.equal(made.body.partner.permissions.includes("PHONE"), false);
    for (const permission of permissions) {
      assert.equal(made.body.partner.permissions.includes(permission), true);
    }
  }
});

test("unauthorized customer role cannot create Business Partners", async () => {
  const customer = await makeUser("CUSTOMER");
  const result = await createPartner(
    customer,
    "unauthorized",
    ["SOLAR_ASSIGNMENT"],
    ["SOLAR"]
  );
  assert.equal(result.status, 403);
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
  const a = await createPartner(admin, "2", ["DASHBOARD", "APPLICATIONS", "CUSTOMERS", "OFFICERS", "SOLAR_ASSIGNMENT", "PHONE_ASSIGNMENT"], ["SOLAR", "PHONE"]);
  const b = await createPartner(admin, "3", ["DASHBOARD", "APPLICATIONS", "CUSTOMERS", "PHONE_ASSIGNMENT"], ["PHONE"]);
  const aUser = await User.findById(a.body.user._id), bUser = await User.findById(b.body.user._id);
  assert.equal((await api({ method: "POST", path: "/api/business-partner/officers/link", actor: aUser, body: { type: "PHONE", officerId: new mongoose.Types.ObjectId() } })).status, 403);
  const customer = await makeUser(); customer.nin = "12345678901"; await customer.save();
  const phone = await PhoneApplication.create({ reference: "BP-PHONE-1", customer: customer._id, product: new mongoose.Types.ObjectId(), productSnapshot: { sku: "BP", secretCost: 5 }, profileSnapshot:{address:"SECRET"},kycSnapshot:{nin:"SECRET"},applicationInput: { occupation: "Trader", monthlyIncome:999 }, businessPartner: a.body.partner._id });
  const solar = await SolarApplication.create({customer:customer._id,package:new mongoose.Types.ObjectId(),packageSnapshot:{name:"Home Solar",secretCost:9},profileSnapshot:{address:"SECRET"},kycSnapshot:{nin:"SECRET"},business:{income:999},guarantor:{phone:"SECRET"},businessPartner:a.body.partner._id});
  const unassigned = await PhoneApplication.create({ reference: "BP-PHONE-2", customer: customer._id, product: new mongoose.Types.ObjectId(), productSnapshot: { sku: "BP2" }, applicationInput: { occupation: "Trader" } });
  assert.equal((await api({ path: "/api/business-partner/applications", actor: bUser })).body.applications.phone.length, 0);
  assert.equal((await api({ path: "/api/business-partner/customers", actor: bUser })).body.customers.length, 0);
  assert.equal((await api({ method: "POST", path: `/api/business-partner/applications/${phone._id}/assign`, actor: bUser, body: { type: "PHONE", officerId: new mongoose.Types.ObjectId() } })).status, 404);
  assert.equal((await api({ method: "POST", path: `/api/business-partner/applications/${unassigned._id}/assign`, actor: aUser, body: { type: "PHONE", officerId: new mongoose.Types.ObjectId() } })).status, 404);
  const apps = await api({ path: "/api/business-partner/applications", actor: aUser });
  assert.equal(apps.status, 200, JSON.stringify(apps.body)); assert.equal(apps.body.applications.phone.length, 1);
  const serialized=JSON.stringify(apps.body);
  for(const secret of ["kycSnapshot","profileSnapshot","applicationInput","guarantor","business","monthlyIncome","secretCost"]) assert.equal(serialized.includes(secret),false);
  assert.equal(apps.body.applications.solar[0].package.name,"Home Solar");
  const customers = await api({ path: "/api/business-partner/customers", actor: aUser });
  assert.equal(customers.body.customers[0].nin, undefined);
});

test("active legacy Business Partners automatically receive module view access only", async () => {
  const admin = await makeUser("HEAD_OFFICE");
  const made = await createPartner(admin, "legacy-view", []);
  const partnerUser = await User.findById(made.body.user._id);
  const profile = await Profile.findById(made.body.partner._id);

  profile.permissions = [];
  await profile.save();
  partnerUser.businessPartnerProfile = null;
  partnerUser.businessPartnerId = profile._id;
  await partnerUser.save();

  const customers = await api({
    path: "/api/business-partner/customers",
    actor: partnerUser,
  });
  assert.equal(customers.status, 200, JSON.stringify(customers.body));

  const repairedProfile = await Profile.findById(profile._id);
  assert.deepEqual(
    [...repairedProfile.permissions].sort(),
    [...BUSINESS_PARTNER_VIEW_PERMISSIONS].sort()
  );
  assert.equal(
    repairedProfile.permissions.includes("PHONE_ASSIGNMENT"),
    false
  );
  assert.equal(
    repairedProfile.permissions.includes("VERIFICATION_REVIEW"),
    false
  );

  const repairedUser = await User.findById(partnerUser._id);
  assert.equal(
    String(repairedUser.businessPartnerProfile),
    String(profile._id)
  );

  const customer = await makeUser("CUSTOMER");
  const denied = await api({
    path: "/api/business-partner/customers",
    actor: customer,
  });
  assert.equal(denied.status, 403);
});

test("Head Office allocates cases and partner permissions scope officer assignment", async () => {
  const admin = await makeUser("HEAD_OFFICE");
  const partner = await createPartner(admin, "4", ["OFFICERS", "PHONE_ASSIGNMENT"], ["PHONE"]);
  const partnerUser = await User.findById(partner.body.user._id);
  const customer = await makeUser();
  const app = await PhoneApplication.create({ reference: "BP-ALLOC-1", customer: customer._id, product: new mongoose.Types.ObjectId(), productSnapshot: { sku: "ALLOC" }, applicationInput: { occupation: "Trader" } });
  const allocation = await api({ method: "POST", path: `/api/business-partner/admin/partners/${partner.body.partner._id}/applications/${app._id}/assign`, actor: admin, body: { type: "PHONE" } });
  assert.equal(allocation.status, 200, JSON.stringify(allocation.body));
  const officer = await makeUser("PHONE_FINANCING_OFFICER"); officer.isStaff = true; officer.businessPartnerId = partner.body.partner._id; await officer.save();
  assert.equal((await api({ method: "POST", path: `/api/business-partner/applications/${app._id}/assign`, actor: partnerUser, body: { type: "PHONE", officerId: officer._id } })).status, 200);
  assert.equal(String((await PhoneApplication.findById(app._id)).assignedOfficer), String(officer._id));
  const deniedPartner = await createPartner(admin, "5", ["DASHBOARD"]);
  const deniedPartnerUser = await User.findById(deniedPartner.body.user._id);
  assert.equal((await api({ path: "/api/business-partner/customers", actor: deniedPartnerUser })).status, 200);
  assert.equal((await api({ method: "POST", path: `/api/business-partner/applications/${app._id}/assign`, actor: deniedPartnerUser, body: { type: "PHONE", officerId: officer._id } })).status, 403);
  const revoked = await api({ method: "PATCH", path: `/api/business-partner/admin/partners/${partner.body.partner._id}`, actor: admin, body: { services: [], permissions: ["OFFICERS", "PHONE_ASSIGNMENT"] } });
  assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
  assert.equal(revoked.body.partner.permissions.includes("PHONE_ASSIGNMENT"), false);
  assert.equal(revoked.body.partner.permissions.includes("OFFICER_MANAGEMENT"), false);
  assert.equal((await api({ method: "POST", path: `/api/business-partner/applications/${app._id}/assign`, actor: partnerUser, body: { type: "PHONE", officerId: officer._id } })).status, 403);
  const [revokedDashboard, revokedApplications, revokedCustomers, revokedRepayments, revokedPerformance, revokedOfficers] = await Promise.all([
    api({ path: "/api/business-partner/dashboard", actor: partnerUser }),
    api({ path: "/api/business-partner/applications", actor: partnerUser }),
    api({ path: "/api/business-partner/customers", actor: partnerUser }),
    api({ path: "/api/business-partner/repayments", actor: partnerUser }),
    api({ path: "/api/business-partner/performance", actor: partnerUser }),
    api({ path: "/api/business-partner/officers", actor: partnerUser }),
  ]);
  assert.equal(revokedDashboard.body.dashboard.phoneApplications, 0);
  assert.deepEqual(revokedApplications.body.applications.phone, []);
  assert.deepEqual(revokedCustomers.body.customers, []);
  assert.deepEqual(revokedRepayments.body.repayments.phone, []);
  assert.deepEqual(revokedPerformance.body.performance.phone, []);
  assert.deepEqual(revokedOfficers.body.officers.phone, []);
  const emptyServices = await createPartner(admin, "empty-service", ["OFFICERS", "PHONE_ASSIGNMENT"]);
  assert.equal(emptyServices.body.partner.permissions.includes("PHONE_ASSIGNMENT"), false);
  assert.equal(await Notification.countDocuments({ userId: partner.body.user._id, referenceType: "BusinessPartnerAssignment" }), 1);
});

test("Head Office links officers only within the partner's approved service", async () => {
  const admin = await makeUser("HEAD_OFFICE");
  const solarOnly = await createPartner(
    admin,
    "link-solar-only",
    ["OFFICERS", "SOLAR_ASSIGNMENT"],
    ["SOLAR"]
  );
  const phoneOnly = await createPartner(
    admin,
    "link-phone-only",
    ["OFFICERS", "PHONE_ASSIGNMENT"],
    ["PHONE"]
  );
  for (const partner of [solarOnly, phoneOnly]) {
    await Profile.updateOne(
      { _id: partner.body.partner._id },
      { $set: { territory: { states: ["Lagos"], lgas: ["Ikeja"] } } }
    );
  }
  const phoneOfficer = await makeUser("PHONE_FINANCING_OFFICER");
  phoneOfficer.isStaff = true;
  phoneOfficer.state = "Lagos";
  phoneOfficer.lga = "Ikeja";
  await phoneOfficer.save();

  const denied = await api({
    method: "POST",
    path: `/api/business-partner/admin/partners/${solarOnly.body.partner._id}/officers/link`,
    actor: admin,
    body: { type: "PHONE", officerId: phoneOfficer._id },
  });
  assert.equal(denied.status, 403);
  assert.equal((await User.findById(phoneOfficer._id)).businessPartnerId, null);

  const allowed = await api({
    method: "POST",
    path: `/api/business-partner/admin/partners/${phoneOnly.body.partner._id}/officers/link`,
    actor: admin,
    body: { type: "PHONE", officerId: phoneOfficer._id },
  });
  assert.equal(allowed.status, 200, JSON.stringify(allowed.body));
  assert.equal(
    String((await User.findById(phoneOfficer._id)).businessPartnerId),
    String(phoneOnly.body.partner._id)
  );
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

test("Business Partners manage only their own normalized officer teams", async () => {
  const admin = await makeUser("HEAD_OFFICE");
  const a = await createPartner(admin, "officer-a", ["OFFICERS", "OFFICER_MANAGEMENT", "SOLAR_ASSIGNMENT", "PHONE_ASSIGNMENT"], ["SOLAR", "PHONE"]);
  const b = await createPartner(admin, "officer-b", ["OFFICERS", "OFFICER_MANAGEMENT", "SOLAR_ASSIGNMENT", "PHONE_ASSIGNMENT"], ["SOLAR", "PHONE"]);
  const viewOnly = await createPartner(admin, "officer-view", ["OFFICERS"]);
  const solarOnly = await createPartner(admin, "officer-solar-only", ["OFFICERS", "OFFICER_MANAGEMENT", "SOLAR_ASSIGNMENT"], ["SOLAR"]);
  const aUser = await User.findById(a.body.user._id);
  const bUser = await User.findById(b.body.user._id);
  const viewOnlyUser = await User.findById(viewOnly.body.user._id);
  const solarOnlyUser = await User.findById(solarOnly.body.user._id);
  for (const partner of [a, b]) {
    const profile = await Profile.findById(partner.body.partner._id);
    profile.territory = { states: ["Lagos"], lgas: ["Ikeja"] };
    await profile.save();
  }
  const solarPayload = {
    type: "SOLAR", fullName: "A Solar Officer", phone: "08090000001",
    email: "a-solar@test.local", password: "temporary123", state: "Lagos",
    lga: "Ikeja", address: "1 Solar Street",
  };
  assert.equal(viewOnly.body.partner.permissions.includes("OFFICER_MANAGEMENT"), false);
  assert.equal((await api({ method: "POST", path: "/api/business-partner/officers", actor: viewOnlyUser, body: solarPayload })).status, 403);
  assert.equal((await api({ method: "POST", path: "/api/business-partner/officers", actor: solarOnlyUser, body: { ...solarPayload, type: "PHONE", phone: "08090000006", email: "blocked-phone@test.local" } })).status, 403);
  const solarCreated = await api({ method: "POST", path: "/api/business-partner/officers", actor: aUser, body: solarPayload });
  assert.equal(solarCreated.status, 201, JSON.stringify(solarCreated.body));
  assert.equal(solarCreated.body.officer.type, "SOLAR");
  assert.match(solarCreated.body.officer.officerCode, /^SSO-\d{6}$/);
  const solar = await SolarOfficer.findById(solarCreated.body.officer.id);
  const solarUser = await User.findById(solar.user);
  assert.equal(String(solar.businessPartner), String(a.body.partner._id));
  assert.equal(String(solarUser.businessPartnerId), String(a.body.partner._id));
  assert.equal(solarUser.mustChangePassword, true);
  assert.equal(await SolarOfficerWallet.countDocuments({ officer: solar._id }), 1);

  const phoneCreated = await api({ method: "POST", path: "/api/business-partner/officers", actor: aUser, body: {
    type: "PHONE", fullName: "A Phone Officer", phone: "08090000002",
    email: "a-phone@test.local", password: "temporary123", state: "Lagos",
    lga: "Ikeja", address: "2 Phone Street",
  } });
  assert.equal(phoneCreated.status, 201, JSON.stringify(phoneCreated.body));
  assert.equal(phoneCreated.body.officer.type, "PHONE");
  assert.match(phoneCreated.body.officer.officerCode, /^SP-PFO-\d{5}$/);
  const phone = await User.findById(phoneCreated.body.officer.id);
  assert.equal(phone.mustChangePassword, true);
  assert.equal(String(phone.businessPartnerId), String(a.body.partner._id));

  const duplicate = await api({ method: "POST", path: "/api/business-partner/officers", actor: aUser, body: { ...solarPayload, type: "PHONE", phone: "08090000003" } });
  assert.equal(duplicate.status, 409);
  assert.equal((await api({ method: "POST", path: "/api/business-partner/officers", actor: aUser, body: { ...solarPayload, type: "RIDER", phone: "08090000004", email: "rider@test.local" } })).status, 400);
  assert.equal((await api({ method: "POST", path: "/api/business-partner/officers", actor: aUser, body: { ...solarPayload, phone: "08090000005", email: "outside@test.local", state: "Ogun" } })).status, 409);

  const list = await api({ path: "/api/business-partner/officers", actor: aUser });
  assert.equal(list.status, 200);
  assert.equal(list.body.officers.solar.length, 1);
  assert.equal(list.body.officers.phone.length, 1);
  const otherList = await api({ path: "/api/business-partner/officers", actor: bUser });
  assert.equal(otherList.status, 200);
  assert.equal(otherList.body.officers.solar.length, 0);
  assert.equal(otherList.body.officers.phone.length, 0);
  const expectedFields = ["address", "createdAt", "email", "fullName", "id", "lga", "metrics", "officerCode", "phone", "state", "status", "type"];
  assert.deepEqual(Object.keys(list.body.officers.solar[0]).sort(), expectedFields);
  const serialized = JSON.stringify(list.body);
  for (const sensitive of ["password", "mustChangePassword", "businessPartnerId", "businessPartner", "staffCreatedBy", "role"]) assert.equal(serialized.includes(sensitive), false);
  const detail = await api({ path: `/api/business-partner/officers/SOLAR/${solar._id}`, actor: aUser });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.officer.metrics.assignedApplications, 0);

  for (const request of [
    { method: "GET", path: `/api/business-partner/officers/SOLAR/${solar._id}` },
    { method: "PATCH", path: `/api/business-partner/officers/SOLAR/${solar._id}`, body: { fullName: "Stolen" } },
    { method: "PATCH", path: `/api/business-partner/officers/SOLAR/${solar._id}/status`, body: { status: "SUSPENDED" } },
    { method: "POST", path: `/api/business-partner/officers/SOLAR/${solar._id}/reset-access`, body: { password: "temporary123" } },
  ]) assert.equal((await api({ ...request, actor: bUser })).status, 404);

  const edited = await api({ method: "PATCH", path: `/api/business-partner/officers/SOLAR/${solar._id}`, actor: aUser, body: { fullName: "Edited Solar", address: "3 Edited Street", role: "HEAD_OFFICE", businessPartnerId: b.body.partner._id } });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.officer.fullName, "Edited Solar");
  assert.equal((await User.findById(solar.user)).role, "SOLAR_OFFICER");
  assert.equal(String((await SolarOfficer.findById(solar._id)).businessPartner), String(a.body.partner._id));
  assert.equal((await api({ method: "PATCH", path: `/api/business-partner/officers/SOLAR/${solar._id}/status`, actor: aUser, body: { status: "SUSPENDED" } })).status, 200);
  assert.equal((await User.findById(solar.user)).status, "SUSPENDED");
  assert.equal((await SolarOfficer.findById(solar._id)).status, "SUSPENDED");
  assert.equal((await api({ method: "POST", path: `/api/business-partner/officers/PHONE/${phone._id}/reset-access`, actor: aUser, body: { password: "newtemporary123" } })).status, 200);
  assert.equal((await User.findById(phone._id)).mustChangePassword, true);
  assert.equal((await api({ method: "PATCH", path: `/api/business-partner/officers/PHONE/${phone._id}`, actor: viewOnlyUser, body: { fullName: "Not allowed" } })).status, 403);
  assert.equal((await api({ method: "PATCH", path: `/api/business-partner/officers/PHONE/${phone._id}/status`, actor: viewOnlyUser, body: { status: "SUSPENDED" } })).status, 403);
  assert.equal((await api({ method: "POST", path: `/api/business-partner/officers/PHONE/${phone._id}/reset-access`, actor: viewOnlyUser, body: { password: "newtemporary123" } })).status, 403);
  assert.equal(await Audit.countDocuments({ action: { $in: ["BUSINESS_PARTNER_OFFICER_CREATED", "BUSINESS_PARTNER_OFFICER_UPDATED", "BUSINESS_PARTNER_OFFICER_STATUS_UPDATED", "BUSINESS_PARTNER_OFFICER_PASSWORD_RESET"] } }), 5);

  const oversight = await api({ path: `/api/business-partner/admin/partners/${a.body.partner._id}`, actor: admin });
  assert.equal(oversight.status, 200, JSON.stringify(oversight.body));
  assert.equal(oversight.body.officers.solar.length, 1);
  assert.equal(oversight.body.officers.phone.length, 1);
});

test("concurrent Business Partner phone assignment and suspension never leave an active suspended officer", async () => {
  const admin = await makeUser("HEAD_OFFICE");
  const partner = await createPartner(admin, "officer-race", ["OFFICERS", "OFFICER_MANAGEMENT", "PHONE_ASSIGNMENT"], ["PHONE"]);
  const partnerUser = await User.findById(partner.body.user._id);
  const created = await api({ method: "POST", path: "/api/business-partner/officers", actor: partnerUser, body: {
    type: "PHONE", fullName: "Race Officer", phone: "08090000011", email: "race-officer@test.local",
    password: "temporary123", state: "Lagos", lga: "Ikeja", address: "Race Street",
  } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const customer = await makeUser();
  const application = await PhoneApplication.create({
    reference: "BP-OFFICER-RACE", customer: customer._id, product: new mongoose.Types.ObjectId(),
    productSnapshot: { sku: "RACE" }, applicationInput: { occupation: "Trader" },
    businessPartner: partner.body.partner._id,
  });
  const [assignment, suspension] = await Promise.all([
    api({ method: "POST", path: `/api/business-partner/applications/${application._id}/assign`, actor: partnerUser, body: { type: "PHONE", officerId: created.body.officer.id } }),
    api({ method: "PATCH", path: `/api/business-partner/officers/PHONE/${created.body.officer.id}/status`, actor: partnerUser, body: { status: "SUSPENDED" } }),
  ]);
  assert.ok([200, 404, 409].includes(assignment.status), JSON.stringify(assignment.body));
  assert.ok([200, 409].includes(suspension.status), JSON.stringify(suspension.body));
  const [officer, persistedApplication] = await Promise.all([User.findById(created.body.officer.id), PhoneApplication.findById(application._id)]);
  assert.equal(officer.status === "SUSPENDED" && persistedApplication.assignmentState === "ACTIVE", false);
});