const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const routes = require("../routes/businessPartner.routes");
const authRoutes = require("../routes/auth.routes");
const emailService = require("../services/email.service");
const logisticsSms = require("../services/logisticsSms.service");
const User = require("../models/user.model");
const Profile = require("../models/businessPartnerProfile.model");
const Commission = require("../models/businessPartnerCommission.model");
const Recovery = require("../models/businessPartnerCommissionRecovery.model");
const Reservation = require("../models/businessPartnerCommissionReservation.model");
const Rule = require("../models/businessPartnerCommissionRule.model");
const BonusRule = require("../models/businessPartnerBonusRule.model");
const Activation = require("../models/businessPartnerActivation.model");
const Transaction = require("../models/transaction.model");
const PhoneApplication = require("../models/phoneApplication.model");
const PhoneProduct = require("../models/phoneProduct.model");
const SolarApplication = require("../models/solarApplication.model");
const SolarPackage = require("../models/solarPackage.model");
const SolarOfficer = require("../models/solarOfficer.model");
const SolarOfficerWallet = require("../models/solarOfficerWallet.model");
const SolarOfficerCommission = require("../models/solarOfficerCommission.model");
const Notification = require("../models/notification.model");
const Audit = require("../models/adminAuditLog.model");
const Role = require("../models/role.model");
const { STAFF_PERMISSIONS } = require("../config/staffPermissions");
const {
  BUSINESS_PARTNER_VIEW_PERMISSIONS,
} = require("../config/businessPartnerPermissions");

const models = [User, Profile, Commission, Recovery, Reservation, Rule, BonusRule, Activation, Transaction, PhoneApplication, PhoneProduct, SolarApplication, SolarPackage, SolarOfficer, SolarOfficerWallet, SolarOfficerCommission, Notification, Audit, Role];
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
const makeScopedStaff = async ({ scopeType, state, partnerId, suffix = "scope" }) => {
  const role = await Role.create({
    name: `BP_SCOPE_${scopeType}_${sequence++}_${suffix}`,
    displayName: "Business Partner Scope Administrator",
    department: "ADMINISTRATION",
    permissions: [
      STAFF_PERMISSIONS.BUSINESS_PARTNERS_VIEW,
      STAFF_PERMISSIONS.BUSINESS_PARTNERS_CREATE,
      STAFF_PERMISSIONS.BUSINESS_PARTNERS_UPDATE,
      STAFF_PERMISSIONS.BUSINESS_PARTNERS_ASSIGN,
    ],
    scopeType,
  });
  const staff = await makeUser("STAFF");
  staff.isStaff = true;
  staff.staffRoleId = role._id;
  if (state) staff.state = state;
  if (partnerId) staff.businessPartnerProfile = partnerId;
  await staff.save();
  return staff;
};

test.before(async () => {
  process.env.JWT_SECRET = "business-partner-test-secret";
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(repl.getUri(), { dbName: "business-partner-tests" });
  await Promise.all(models.map(model => model.init()));
  const app = express(); app.use(express.json()); app.use("/api/business-partner", routes); app.use("/api/auth", authRoutes);
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

test("scoped administrators cannot create, relocate, or assign outside their state/partner scope", async () => {
  const headOffice = await makeUser("HEAD_OFFICE");
  const partnerResult = await createPartner(headOffice, "scoped-owner", ["DASHBOARD", "APPLICATIONS", "CUSTOMERS", "PHONE_ASSIGNMENT", "SOLAR_ASSIGNMENT"], ["PHONE", "SOLAR"]);
  assert.equal(partnerResult.status, 201);
  const partner = await Profile.findById(partnerResult.body.partner._id);
  partner.territory = { states: ["Lagos"], lgas: ["Ikeja"] };
  await partner.save();

  const stateStaff = await makeScopedStaff({ scopeType: "STATE", state: "Lagos" });
  const stateCreate = await createPartner(stateStaff, "scoped-state-create", undefined, ["PHONE"]);
  assert.equal(stateCreate.status, 403, "missing territory must fail closed");
  const allowedCreate = await api({
    method: "POST", path: "/api/business-partner/admin/partners", actor: stateStaff,
    body: { fullName: "Scoped Lagos", phone: "09070000001", email: "scoped-lagos@test.local", password: "password123", businessName: "Scoped Lagos", territory: { states: ["Lagos"], lgas: [] }, services: ["PHONE"] },
  });
  assert.equal(allowedCreate.status, 403, JSON.stringify(allowedCreate.body));
  const deniedCreate = await api({
    method: "POST", path: "/api/business-partner/admin/partners", actor: stateStaff,
    body: { fullName: "Scoped Ogun", phone: "09070000002", email: "scoped-ogun@test.local", password: "password123", businessName: "Scoped Ogun", territory: { states: ["Ogun"], lgas: [] }, services: ["PHONE"] },
  });
  assert.equal(deniedCreate.status, 403);
  assert.equal((await api({ method: "PATCH", path: `/api/business-partner/admin/partners/${partner._id}`, actor: stateStaff, body: { businessName: "Scoped profile edit" } })).status, 200);
  assert.equal((await api({ method: "PATCH", path: `/api/business-partner/admin/partners/${partner._id}`, actor: stateStaff, body: { territory: { states: ["Ogun"], lgas: [] } } })).status, 403);

  const partnerStaff = await makeScopedStaff({ scopeType: "BUSINESS_PARTNER", partnerId: partner._id });
  assert.equal((await createPartner(partnerStaff, "nested", undefined, ["PHONE"])).status, 403);
  assert.equal((await api({ method: "PATCH", path: `/api/business-partner/admin/partners/${partner._id}`, actor: partnerStaff, body: { businessName: "Other" } })).status, 200);
  assert.equal((await api({ method: "PATCH", path: `/api/business-partner/admin/partners/${partner._id}`, actor: partnerStaff, body: { territory: { states: ["Lagos", "Ogun"], lgas: ["Ikeja"] } } })).status, 403);

  const outOfficer = await makeUser("PHONE_FINANCING_OFFICER");
  outOfficer.state = "Ogun"; outOfficer.lga = "Abeokuta"; await outOfficer.save();
  assert.equal((await api({ method: "POST", path: `/api/business-partner/admin/partners/${partner._id}/officers/link`, actor: stateStaff, body: { type: "PHONE", officerId: outOfficer._id } })).status, 403);
  const inOfficer = await makeUser("PHONE_FINANCING_OFFICER");
  inOfficer.state = "Lagos"; inOfficer.lga = "Ikeja"; await inOfficer.save();
  assert.equal((await api({ method: "POST", path: `/api/business-partner/admin/partners/${partner._id}/officers/link`, actor: stateStaff, body: { type: "PHONE", officerId: inOfficer._id } })).status, 200);

  const outOfState = await User.create({ fullName: "Out of State", phone: "08170000001", email: "out-state@test.local", password: "password123", role: "CUSTOMER", status: "ACTIVE", state: "Ogun" });
  const outApp = await PhoneApplication.create({ reference: "BP-SCOPE-OUT", customer: outOfState._id, product: new mongoose.Types.ObjectId(), productSnapshot: { sku: "SCOPE" }, applicationInput: { state: "Ogun" } });
  assert.equal((await api({ method: "POST", path: `/api/business-partner/admin/partners/${partner._id}/applications/${outApp._id}/assign`, actor: stateStaff, body: { type: "PHONE" } })).status, 403);
  const inState = await User.create({ fullName: "In State", phone: "08170000002", email: "in-state@test.local", password: "password123", role: "CUSTOMER", status: "ACTIVE", state: "Lagos" });
  const spoofedPhone = await PhoneApplication.create({ reference: "BP-SCOPE-SPOOF-PHONE", customer: inState._id, product: new mongoose.Types.ObjectId(), productSnapshot: { sku: "SCOPE" }, profileSnapshot: { state: "Ogun" }, applicationInput: { state: "Ogun" } });
  assert.equal((await api({ method: "POST", path: `/api/business-partner/admin/partners/${partner._id}/applications/${spoofedPhone._id}/assign`, actor: stateStaff, body: { type: "PHONE" } })).status, 403);
  const spoofedSolar = await SolarApplication.create({ customer: inState._id, package: new mongoose.Types.ObjectId(), packageSnapshot: { name: "Scope" }, profileSnapshot: { state: "Ogun" }, business: { state: "Ogun" } });
  assert.equal((await api({ method: "POST", path: `/api/business-partner/admin/partners/${partner._id}/applications/${spoofedSolar._id}/assign`, actor: stateStaff, body: { type: "SOLAR" } })).status, 403);
  const inApp = await PhoneApplication.create({ reference: "BP-SCOPE-IN", customer: inState._id, product: new mongoose.Types.ObjectId(), productSnapshot: { sku: "SCOPE" }, applicationInput: { state: "Lagos" } });
  assert.equal((await api({ method: "POST", path: `/api/business-partner/admin/partners/${partner._id}/applications/${inApp._id}/assign`, actor: stateStaff, body: { type: "PHONE" } })).status, 200);
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

test("all Business Partner audit actions are registered in the immutable audit enum", () => {
  const actions = [
    "BUSINESS_PARTNER_CREATED", "BUSINESS_PARTNER_UPDATED", "BUSINESS_PARTNER_STATUS_UPDATED",
    "BUSINESS_PARTNER_PASSWORD_RESET", "BUSINESS_PARTNER_OFFICER_ASSIGNED",
    "BUSINESS_PARTNER_OFFICER_CREATED", "BUSINESS_PARTNER_OFFICER_UPDATED",
    "BUSINESS_PARTNER_OFFICER_STATUS_UPDATED", "BUSINESS_PARTNER_OFFICER_PASSWORD_RESET",
    "BUSINESS_PARTNER_APPLICATION_ASSIGNED", "BUSINESS_PARTNER_CUSTOMER_CREATED",
    "BUSINESS_PARTNER_COMMISSION_CREATED", "BUSINESS_PARTNER_COMMISSION_REVERSED",
    "BUSINESS_PARTNER_COMMISSION_RULE_CREATED", "BUSINESS_PARTNER_COMMISSION_RULE_UPDATED",
    "BUSINESS_PARTNER_COMMISSION_RULE_STATUS_UPDATED", "BUSINESS_PARTNER_TARGET_CREATED",
  ];
  const registered = Audit.schema.path("action").enumValues;
  for (const action of actions) assert.equal(registered.includes(action), true, action);
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

test("service-approved partners can manage officers without the legacy management key", async () => {
  const admin = await makeUser("HEAD_OFFICE");
  const partner = await createPartner(
    admin,
    "service-capability-only",
    ["OFFICERS", "SOLAR_ASSIGNMENT"],
    ["SOLAR"],
  );
  const partnerUser = await User.findById(partner.body.user._id);
  const profile = await Profile.findById(partner.body.partner._id);
  profile.permissions = profile.permissions.filter(
    (permission) => permission !== "OFFICER_MANAGEMENT",
  );
  await profile.save();

  const created = await api({
    method: "POST",
    path: "/api/business-partner/officers",
    actor: partnerUser,
    body: {
      type: "SOLAR",
      fullName: "Capability Solar Officer",
      phone: "08090000021",
      email: "capability-solar@test.local",
      password: "temporary123",
      state: "Lagos",
      lga: "Ikeja",
      address: "Capability Street",
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const updated = await api({
    method: "PATCH",
    path: `/api/business-partner/officers/SOLAR/${created.body.officer.id}`,
    actor: partnerUser,
    body: { fullName: "Updated Capability Officer" },
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));

  const suspended = await api({
    method: "PATCH",
    path: `/api/business-partner/officers/SOLAR/${created.body.officer.id}/status`,
    actor: partnerUser,
    body: { status: "SUSPENDED" },
  });
  assert.equal(suspended.status, 200, JSON.stringify(suspended.body));
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

test("partner customer onboarding is duplicate-safe, hashed, and isolated", async () => {
  const admin = await makeUser("HEAD_OFFICE");
  const a = await createPartner(admin, "customer-a", ["CUSTOMERS"]);
  const b = await createPartner(admin, "customer-b", ["CUSTOMERS"]);
  const aUser = await User.findById(a.body.user._id);
  const bUser = await User.findById(b.body.user._id);
  const created = await api({
    method: "POST", path: "/api/business-partner/customers", actor: aUser,
    body: { fullName: "Owned Customer", phone: "08070000001", email: "owned@test.local", password: "password123" },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const customer = await User.findById(created.body.customer.id).select("+password");
  assert.equal(customer.createdByPartner, true);
  assert.equal(String(customer.businessPartnerId), String(a.body.partner._id));
  assert.equal(customer.acquisitionChannel, "BUSINESS_PARTNER");
  assert.equal(customer.mustChangePassword, true);
  assert.equal(customer.status, "PENDING");
  assert.equal(customer.activationPending, true);
  assert.equal(customer.termsAcceptedAt, null);
  assert.equal(customer.onboardingSource, "BUSINESS_PARTNER");
  assert.match(customer.password, /^\$2/);
  assert.equal(await customer.comparePassword("password123"), false);
  const deniedLogin = await api({
    method: "POST", path: "/api/auth/login",
    body: { email: "owned@test.local", password: "password123" },
  });
  assert.equal(deniedLogin.status, 403);
  assert.equal(deniedLogin.body.code, "ACTIVATION_REQUIRED");

  // The reset token is obtained from mocked delivery, proving possession
  // verification without sending a real email.
  const invalidReset = await api({
    method: "POST", path: "/api/auth/reset-password",
    body: { token: "wrong-possession-token", newPassword: "Customer!123", confirmPassword: "Customer!123" },
  });
  assert.equal(invalidReset.status, 400);
  assert.equal((await User.findById(customer._id)).activationPending, true);
  const originalSendEmail = emailService.sendEmail;
  let deliveredEmail;
  emailService.sendEmail = async payload => {
    deliveredEmail = payload;
    return { success: true, mocked: true };
  };
  const requestedReset = await api({
    method: "POST", path: "/api/auth/forgot-password",
    body: { email: "owned@test.local" },
  });
  emailService.sendEmail = originalSendEmail;
  assert.equal(requestedReset.status, 200);
  assert.equal(deliveredEmail.to, "owned@test.local");
  const possessionToken = new URL(deliveredEmail.text.match(/https?:\/\/\S+/)[0]).searchParams.get("token");
  assert.ok(possessionToken);
  const activated = await api({
    method: "POST", path: "/api/auth/reset-password",
    body: { token: possessionToken, newPassword: "Customer!123", confirmPassword: "Customer!123" },
  });
  assert.equal(activated.status, 200, JSON.stringify(activated.body));
  const activatedCustomer = await User.findById(customer._id);
  assert.equal(activatedCustomer.activationPending, false);
  assert.equal(activatedCustomer.status, "ACTIVE");
  assert.equal(activatedCustomer.mustChangePassword, false);
  const successfulLogin = await api({
    method: "POST", path: "/api/auth/login",
    body: { email: "owned@test.local", password: "Customer!123" },
  });
  assert.equal(successfulLogin.status, 200, JSON.stringify(successfulLogin.body));
  assert.equal((await api({
    method: "POST", path: "/api/business-partner/customers", actor: aUser,
    body: { fullName: "Duplicate Phone", phone: "08070000001", email: "other@test.local", password: "password123" },
  })).status, 409);
  assert.equal((await api({
    method: "POST", path: "/api/business-partner/customers", actor: aUser,
    body: { fullName: "Duplicate Email", phone: "08070000002", email: "owned@test.local", password: "password123" },
  })).status, 409);
  assert.equal((await api({ path: `/api/business-partner/customers/${customer._id}`, actor: bUser })).status, 404);
  assert.equal((await api({ path: "/api/business-partner/customers", actor: bUser })).body.customers.length, 0);
  const aOfficer = await makeUser("PHONE_FINANCING_OFFICER");
  aOfficer.businessPartnerId = a.body.partner._id;
  await aOfficer.save();
  assert.equal((await api({
    method: "POST", path: "/api/business-partner/customers", actor: bUser,
    body: { fullName: "Impersonation Attempt", phone: "08070000003", email: "impersonation@test.local", password: "password123", officerId: aOfficer._id },
  })).status, 403);
});

test("phone-only customer activation uses a mocked one-time SMS possession flow", async () => {
  const admin = await makeUser("HEAD_OFFICE");
  const partner = await createPartner(admin, "phone-activation", ["CUSTOMERS"]);
  const partnerUser = await User.findById(partner.body.user._id);
  const created = await api({
    method: "POST", path: "/api/business-partner/customers", actor: partnerUser,
    body: { fullName: "Phone Activation Customer", phone: "08070000999" },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.activation.channels.email, false);
  assert.equal(created.body.activation.channels.phone, true);
  const customer = await User.findById(created.body.customer.id).select("+password");
  const originalSendSms = logisticsSms.sendDeliveryOtp;
  let deliveredCode;
  logisticsSms.sendDeliveryOtp = async ({ phone, code }) => {
    deliveredCode = code;
    assert.equal(phone, "+2348070000999");
    return { sent: true, providerMessageId: "mock-sms" };
  };
  const requested = await api({
    method: "POST", path: "/api/auth/customer-activation/request",
    body: { phone: "0807 000 0999" },
  });
  assert.equal(requested.status, 200, JSON.stringify(requested.body));
  assert.equal(requested.body.otp, undefined);
  const activation = await Activation.findOne({ user: customer._id }).select("+otpHash");
  assert.ok(activation);
  assert.notEqual(activation.otpHash, deliveredCode);
  assert.equal((await api({
    method: "POST", path: "/api/auth/customer-activation/request",
    body: { phone: "08070000999" },
  })).status, 200);
  const partnerAttempt = await api({
    method: "POST", path: "/api/auth/customer-activation/verify", actor: partnerUser,
    body: { phone: "08070000999", otp: deliveredCode, newPassword: "Phone!123", confirmPassword: "Phone!123" },
  });
  assert.equal(partnerAttempt.status, 403);
  const wrong = await api({
    method: "POST", path: "/api/auth/customer-activation/verify",
    body: { phone: "08070000999", otp: deliveredCode === "999999" ? "000000" : "999999", newPassword: "Phone!123", confirmPassword: "Phone!123" },
  });
  assert.equal(wrong.status, 400);
  await Activation.updateOne({ user: customer._id }, { $set: { expiresAt: new Date(Date.now() - 1), createdAt: new Date(Date.now() - 120000) } });
  const expired = await api({
    method: "POST", path: "/api/auth/customer-activation/verify",
    body: { phone: "08070000999", otp: deliveredCode, newPassword: "Phone!123", confirmPassword: "Phone!123" },
  });
  assert.equal(expired.status, 400);
  assert.equal((await User.findById(customer._id)).activationPending, true);
  await Activation.updateOne({ user: customer._id }, { $set: { createdAt: new Date(Date.now() - 120000), attempts: 0 } });
  const requestedAgain = await api({
    method: "POST", path: "/api/auth/customer-activation/request",
    body: { phone: "08070000999" },
  });
  assert.equal(requestedAgain.status, 200);
  const validCode = deliveredCode;
  const verified = await api({
    method: "POST", path: "/api/auth/customer-activation/verify",
    body: { phone: "08070000999", otp: validCode, newPassword: "Phone!123", confirmPassword: "Phone!123" },
  });
  logisticsSms.sendDeliveryOtp = originalSendSms;
  assert.equal(verified.status, 200, JSON.stringify(verified.body));
  assert.equal((await User.findById(customer._id)).activationPending, false);
  assert.equal((await User.findById(customer._id)).status, "ACTIVE");
  assert.equal((await api({
    method: "POST", path: "/api/auth/customer-activation/verify",
    body: { phone: "08070000999", otp: validCode, newPassword: "Phone!123", confirmPassword: "Phone!123" },
  })).status, 400);
});

test("failed lifecycle events never allocate a partner commission", async () => {
  const commissionService = require("../services/businessPartnerCommission.service");
  const result = await commissionService.createCommissionForEvent({
    businessPartner: new mongoose.Types.ObjectId(),
    transactionId: new mongoose.Types.ObjectId(),
    sourceType: "AIRTIME",
    sourceAmount: 1000,
    eventKey: "failed-event-no-commission",
    createdBy: new mongoose.Types.ObjectId(),
    transactionStatus: "FAILED",
  });
  assert.equal(result, null);
});

test("effective commission rules fail closed at the aggregate margin and reconcile wallet projections", async () => {
  const admin = await makeUser("HEAD_OFFICE");
  const partner = await createPartner(admin, "margin-bound");
  const service = require("../services/businessPartnerCommission.service");
  const rule = await Rule.create({
    sourceType: "PHONE_FINANCING", version: 1, calculation: "PERCENT", value: 50,
    availableMargin: 100, allocatedMargin: 0, createdBy: admin._id,
  });
  const rejected = await service.createCommissionForEvent({
    businessPartner: partner.body.partner._id, application: new mongoose.Types.ObjectId(),
    sourceType: "PHONE", sourceAmount: 300, eventKey: "margin-too-large", createdBy: admin._id,
  });
  assert.equal(rejected, null);
  const accepted = await service.createCommissionForEvent({
    businessPartner: partner.body.partner._id, application: new mongoose.Types.ObjectId(),
    sourceType: "PHONE", sourceAmount: 100, eventKey: "margin-accepted", createdBy: admin._id,
  });
  assert.equal(accepted.idempotent, false);
  assert.equal(accepted.commission.commissionRule.toString(), rule._id.toString());
  const exhausted = await service.createCommissionForEvent({
    businessPartner: partner.body.partner._id, application: new mongoose.Types.ObjectId(),
    sourceType: "PHONE", sourceAmount: 200, eventKey: "margin-exhausted", createdBy: admin._id,
  });
  assert.equal(exhausted, null);
  const wallet = await service.reconcileCommissionWallet({ businessPartner: partner.body.partner._id });
  assert.equal(wallet.available, 50);
  assert.equal(wallet.lifetime, 50);
  assert.equal(wallet.recoveryLiability, 0);
});

test("bonus rules validate metrics, source, margin, and effective partner scope", async () => {
  const admin = await makeUser("HEAD_OFFICE");
  const partner = await createPartner(admin, "bonus-config");
  const invalids = [
    { metric: "AIRTIME_REVENUE", period: "MONTHLY", threshold: 1, bonusAmount: 10, availableMargin: 100 },
    { metric: "ACTIVE_CUSTOMERS", sourceType: "AIRTIME", period: "MONTHLY", threshold: 1, bonusAmount: 10, availableMargin: 100 },
    { metric: "ACTIVE_CUSTOMERS", period: "MONTHLY", threshold: 1, bonusAmount: 101, availableMargin: 100 },
    { metric: "ACTIVE_CUSTOMERS", period: "MONTHLY", threshold: 1, bonusAmount: 10, availableMargin: -1 },
  ];
  for (const body of invalids) {
    const result = await api({ method: "POST", path: "/api/business-partner/admin/bonus-rules", actor: admin, body });
    assert.equal(result.status, 400, JSON.stringify(result.body));
  }
  const effectiveFrom = new Date(Date.now() - 60_000).toISOString();
  const effectiveTo = new Date(Date.now() + 60 * 60_000).toISOString();
  const created = await api({
    method: "POST", path: "/api/business-partner/admin/bonus-rules", actor: admin,
    body: {
      name: "Monthly active customer bonus", metric: "ACTIVE_CUSTOMERS", sourceType: "PHONE",
      period: "MONTHLY", threshold: 1, bonusAmount: 25, availableMargin: 100,
      businessPartnerId: partner.body.partner._id, effectiveFrom, effectiveTo,
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(String(created.body.rule.businessPartner), String(partner.body.partner._id));
  assert.equal(created.body.rule.sourceType, "PHONE_FINANCING");
  assert.equal(new Date(created.body.rule.effectiveFrom).toISOString(), effectiveFrom);
  assert.equal(new Date(created.body.rule.effectiveTo).toISOString(), effectiveTo);
  assert.equal((await BonusRule.countDocuments({ businessPartner: partner.body.partner._id })), 1);
  const updated = await api({
    method: "PATCH", path: `/api/business-partner/admin/bonus-rules/${created.body.rule._id}`, actor: admin,
    body: { threshold: 2, bonusAmount: 30, availableMargin: 120, effectiveTo: new Date(Date.now() + 2 * 60 * 60_000).toISOString() },
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(updated.body.rule.threshold, 2);
  assert.equal(updated.body.rule.bonusAmount, 30);
  assert.equal((await api({
    method: "PATCH", path: `/api/business-partner/admin/bonus-rules/${created.body.rule._id}`, actor: admin,
    body: { bonusAmount: 121, availableMargin: 120 },
  })).status, 400);
  assert.equal(await Audit.countDocuments({ action: "BUSINESS_PARTNER_BONUS_RULE_UPDATED" }), 1);
});

test("bonus evaluation is partner-isolated, wallet-idempotent, margin-bounded, and reverses safely", async () => {
  const admin = await makeUser("HEAD_OFFICE");
  const a = await createPartner(admin, "bonus-a");
  const b = await createPartner(admin, "bonus-b");
  const service = require("../services/businessPartnerCommission.service");
  const activeA = await makeUser();
  activeA.businessPartnerId = a.body.partner._id;
  await activeA.save();
  const activeB = await makeUser();
  activeB.businessPartnerId = b.body.partner._id;
  await activeB.save();
  const rule = await BonusRule.create({
    name: "A threshold", metric: "ACTIVE_CUSTOMERS", period: "MONTHLY", threshold: 1,
    bonusAmount: 40, availableMargin: 40, businessPartner: a.body.partner._id,
    effectiveFrom: new Date(Date.now() - 60_000), createdBy: admin._id,
  });
  const evaluationAnchor = new Date();
  const first = await service.evaluateBonusRule({
    ruleId: rule._id, businessPartner: a.body.partner._id, evaluationAnchor, createdBy: admin._id,
  });
  assert.equal(first.qualified, true);
  assert.equal(first.idempotent, false);
  assert.equal(first.commission.commissionType, "PERFORMANCE_BONUS");
  assert.equal(first.commission.sourceType, "BONUS");
  const replay = await service.evaluateBonusRule({
    ruleId: rule._id, businessPartner: a.body.partner._id, evaluationAnchor, createdBy: admin._id,
  });
  assert.equal(replay.idempotent, true);
  assert.equal(await Commission.countDocuments({ bonusRule: rule._id }), 1);
  const wallet = await service.reconcileCommissionWallet({ businessPartner: a.body.partner._id });
  assert.equal(wallet.available, 40);
  const deniedB = await service.evaluateBonusRule({
    ruleId: rule._id, businessPartner: b.body.partner._id, evaluationAnchor, createdBy: admin._id,
  });
  assert.equal(deniedB.qualified, false);
  assert.equal(await Commission.countDocuments({ businessPartner: b.body.partner._id }), 0);
  const bUser = await User.findById(b.body.user._id);
  const bHistory = await api({ path: "/api/business-partner/bonuses", actor: bUser });
  assert.equal(bHistory.status, 200, JSON.stringify(bHistory.body));
  assert.equal(bHistory.body.bonuses.length, 0);
  const exhaustedRule = await BonusRule.create({
    name: "Exhausted threshold", metric: "ACTIVE_CUSTOMERS", period: "MONTHLY", threshold: 1,
    bonusAmount: 10, availableMargin: 0, businessPartner: a.body.partner._id,
    effectiveFrom: new Date(Date.now() - 60_000), createdBy: admin._id,
  });
  const exhausted = await service.evaluateBonusRule({
    ruleId: exhaustedRule._id, businessPartner: a.body.partner._id,
    evaluationAnchor, createdBy: admin._id,
  });
  assert.equal(exhausted.qualified, true);
  assert.equal(exhausted.marginExhausted, true);
  assert.equal(await Commission.countDocuments({ bonusRule: exhaustedRule._id }), 0);

  const reversed = await service.reverseCommission({
    commissionId: first.commission._id, eventKey: "bonus-reversal-event",
    createdBy: admin._id, reason: "Qualifying lifecycle reversed",
  });
  assert.equal(reversed.commission.reversalOf.toString(), first.commission._id.toString());
  assert.equal(reversed.commission.amount, -40);
  assert.equal((await BonusRule.findById(rule._id)).availableMargin, 40);
  assert.equal((await service.reconcileCommissionWallet({ businessPartner: a.body.partner._id })).available, 0);

  // Paid bonus reversals retain the paid allocation and create a recovery
  // liability until Finance posts an explicit recovery.
  const paidRule = await BonusRule.create({
    name: "Paid threshold", metric: "ACTIVE_CUSTOMERS", period: "MONTHLY", threshold: 1,
    bonusAmount: 20, availableMargin: 0, allocatedMargin: 20,
    businessPartner: a.body.partner._id, effectiveFrom: new Date(Date.now() - 60_000), createdBy: admin._id,
  });
  const paid = await service.createCommission({
    businessPartner: a.body.partner._id, sourceType: "BONUS", amount: 20,
    eventKey: "paid-bonus", createdBy: admin._id, status: "PAID",
    commissionType: "CAMPAIGN_BONUS", bonusRule: paidRule._id,
  });
  const paidReversal = await service.reverseCommission({
    commissionId: paid.commission._id, eventKey: "paid-bonus-reversal", createdBy: admin._id,
  });
  const paidAfter = await BonusRule.findById(paidRule._id);
  assert.equal(paidAfter.availableMargin, 0);
  assert.equal((await service.reconcileCommissionWallet({ businessPartner: a.body.partner._id })).recoveryLiability, 20);
  const recovery = await service.recordCommissionRecovery({
    reversalId: paidReversal.commission._id, eventKey: "paid-bonus-recovery", amount: 20, createdBy: admin._id,
  });
  assert.equal(recovery.idempotent, false);
  assert.equal((await BonusRule.findById(paidRule._id)).availableMargin, 20);
});

test("bonus evaluation uses source, terminal status, and canonical Lagos period boundaries", async () => {
  const admin = await makeUser("HEAD_OFFICE");
  const partner = await createPartner(admin, "bonus-period");
  const customer = await makeUser();
  customer.businessPartnerId = partner.body.partner._id;
  await customer.save();
  const anchor = new Date();
  const localAnchor = new Date(anchor.getTime() + 60 * 60 * 1000);
  const dayStart = new Date(Date.UTC(localAnchor.getUTCFullYear(), localAnchor.getUTCMonth(), localAnchor.getUTCDate()) - 60 * 60 * 1000);
  const rule = await BonusRule.create({
    name: "Phone daily success", metric: "TRANSACTION_COUNT", sourceType: "PHONE",
    period: "DAILY", threshold: 1, bonusAmount: 10, availableMargin: 20,
    businessPartner: partner.body.partner._id, effectiveFrom: new Date(Date.now() - 60000), createdBy: admin._id,
  });
  const rows = [
    ["wrong-service", "AIRTIME", "SUCCESSFUL", new Date(dayStart.getTime() + 1000)],
    ["failed-phone", "PHONE_FINANCING_DEPOSIT", "FAILED", new Date(dayStart.getTime() + 2000)],
    ["pending-phone", "PHONE_FINANCING_DEPOSIT", "PENDING", new Date(dayStart.getTime() + 3000)],
    ["refunded-phone", "PHONE_FINANCING_DEPOSIT", "REFUNDED", new Date(dayStart.getTime() + 4000)],
    ["boundary-success", "PHONE_FINANCING_DEPOSIT", "SUCCESSFUL", dayStart],
    ["out-of-period", "PHONE_FINANCING_DEPOSIT", "SUCCESSFUL", new Date(dayStart.getTime() - 1000)],
  ];
  await Transaction.create(rows.map(([reference, serviceType, status, createdAt]) => ({
    reference, customerId: customer._id, serviceType, amount: 100, status, createdAt, updatedAt: createdAt,
  })));
  const service = require("../services/businessPartnerCommission.service");
  const result = await service.evaluateBonusRule({
    ruleId: rule._id, businessPartner: partner.body.partner._id, evaluationAnchor: anchor, createdBy: admin._id,
  });
  assert.equal(result.actual, 1);
  assert.equal(result.qualified, true);
  const replay = await service.evaluateBonusRule({
    ruleId: rule._id, businessPartner: partner.body.partner._id, evaluationAnchor: anchor, createdBy: admin._id,
  });
  assert.equal(replay.idempotent, true);
  await assert.rejects(() => service.evaluateBonusRule({
    ruleId: rule._id, businessPartner: partner.body.partner._id,
    periodStart: dayStart, periodEnd: anchor, createdBy: admin._id,
  }), /server-derived evaluation anchor/);
});

test("reversing a paid commission records recovery liability without rewriting paid lifetime", async () => {
  const admin = await makeUser("HEAD_OFFICE");
  const partner = await createPartner(admin, "paid-recovery");
  const service = require("../services/businessPartnerCommission.service");
  const rule = await Rule.create({
    sourceType: "SOLAR", version: 1, calculation: "FIXED", value: 75,
    availableMargin: 0, allocatedMargin: 75, createdBy: admin._id,
  });
  const original = await service.createCommission({
    businessPartner: partner.body.partner._id, transactionId: new mongoose.Types.ObjectId(),
    sourceType: "SOLAR", amount: 75, commissionRule: rule._id, eventKey: "paid-recovery-original", createdBy: admin._id, status: "PAID",
  });
  const reversed = await service.reverseCommission({
    commissionId: original.commission._id, eventKey: "paid-recovery-reversal",
    createdBy: admin._id, reason: "Refunded after settlement",
  });
  assert.equal(reversed.commission.status, "REVERSED");
  const wallet = await service.reconcileCommissionWallet({ businessPartner: partner.body.partner._id });
  assert.equal(wallet.paid, 75);
  assert.equal(wallet.lifetime, 75);
  assert.equal(wallet.recoveryLiability, 75);
  const blocked = await service.createCommissionForEvent({
    businessPartner: partner.body.partner._id, application: new mongoose.Types.ObjectId(),
    sourceType: "SOLAR", sourceAmount: 1, eventKey: "paid-recovery-blocked", createdBy: admin._id,
  });
  assert.equal(blocked, null);
  const recovery = await service.recordCommissionRecovery({
    reversalId: reversed.commission._id, eventKey: "paid-recovery-recorded",
    amount: 75, createdBy: admin._id,
  });
  assert.equal(recovery.idempotent, false);
  const replay = await service.recordCommissionRecovery({
    reversalId: reversed.commission._id, eventKey: "paid-recovery-recorded",
    amount: 75, createdBy: admin._id,
  });
  assert.equal(replay.idempotent, true);
  const funded = await service.createCommissionForEvent({
    businessPartner: partner.body.partner._id, application: new mongoose.Types.ObjectId(),
    sourceType: "SOLAR", sourceAmount: 1, eventKey: "paid-recovery-funded", createdBy: admin._id,
  });
  assert.equal(funded.idempotent, false);
  const second = await service.createCommission({
    businessPartner: partner.body.partner._id, application: new mongoose.Types.ObjectId(),
    sourceType: "SOLAR", amount: 20, eventKey: "paid-recovery-second", createdBy: admin._id, status: "PAID",
  });
  const secondReversal = await service.reverseCommission({
    commissionId: second.commission._id, eventKey: "paid-recovery-second-reversal", createdBy: admin._id,
  });
  const recoverySessions = [await mongoose.startSession(), await mongoose.startSession()];
  const concurrentRecoveries = await Promise.allSettled(recoverySessions.map(session => session.withTransaction(() => service.recordCommissionRecovery({
    reversalId: secondReversal.commission._id, eventKey: "paid-recovery-concurrent",
    amount: 20, createdBy: admin._id, session,
  }))));
  await Promise.all(recoverySessions.map(session => session.endSession()));
  assert.equal(concurrentRecoveries.filter(result => result.status === "fulfilled").length, 2);
  assert.equal(concurrentRecoveries.filter(result => result.status === "fulfilled" && result.value.idempotent).length, 1);
  assert.equal(await Recovery.countDocuments({ eventKey: "paid-recovery-concurrent" }), 1);
});

test("caller-owned session idempotency uses an external reservation without aborting the loser", async () => {
  const admin = await makeUser("HEAD_OFFICE");
  const partner = await createPartner(admin, "session-race");
  await Rule.create({ sourceType: "SOLAR", version: 1, calculation: "FIXED", value: 5, availableMargin: 10, createdBy: admin._id });
  const service = require("../services/businessPartnerCommission.service");
  const payload = {
    businessPartner: partner.body.partner._id,
    application: new mongoose.Types.ObjectId(),
    sourceType: "SOLAR",
    sourceAmount: 1,
    eventKey: "session-race-event",
    createdBy: admin._id,
  };
  const sessions = [await mongoose.startSession(), await mongoose.startSession()];
  const results = await Promise.allSettled(sessions.map(session => session.withTransaction(() => service.createCommissionForEvent({ ...payload, session }))));
  await Promise.all(sessions.map(session => session.endSession()));
  assert.equal(await Commission.countDocuments({ eventKey: payload.eventKey }), 1);
  assert.equal(results.filter(result => result.status === "fulfilled" && result.value?.commission).length, 1);
  assert.equal(results.filter(result => result.status === "rejected" && result.reason?.code === "COMMISSION_RESERVATION_CONFLICT").length, 1);
});

test("caller-owned races with differing event keys still serialize transaction commission type", async () => {
  const admin = await makeUser("HEAD_OFFICE");
  const partner = await createPartner(admin, "transaction-race");
  await Rule.create({ sourceType: "SOLAR", version: 1, calculation: "FIXED", value: 5, availableMargin: 10, createdBy: admin._id });
  const service = require("../services/businessPartnerCommission.service");
  const transactionId = new mongoose.Types.ObjectId();
  const basePayload = {
    businessPartner: partner.body.partner._id, transactionId,
    sourceType: "SOLAR", sourceAmount: 1, createdBy: admin._id,
  };
  const sessions = [await mongoose.startSession(), await mongoose.startSession()];
  const results = await Promise.allSettled([
    sessions[0].withTransaction(() => service.createCommissionForEvent({ ...basePayload, eventKey: "transaction-race-a", session: sessions[0] })),
    sessions[1].withTransaction(() => service.createCommissionForEvent({ ...basePayload, eventKey: "transaction-race-b", session: sessions[1] })),
  ]);
  assert.equal(await Commission.countDocuments({ transactionId, commissionType: "DIRECT_CUSTOMER_COMMISSION" }), 1);
  assert.equal(results.filter(result => result.status === "rejected" && result.reason?.code === "COMMISSION_RESERVATION_CONFLICT").length, 1);
  assert.equal(results.filter(result => result.status === "fulfilled" && result.value?.commission).length, 1);
  // Both caller-owned sessions remain usable: the loser returned a conflict
  // without causing a duplicate-key abort in its parent transaction.
  for (const session of sessions) {
    await session.withTransaction(async () => {
      assert.equal(await Commission.countDocuments({ transactionId }).session(session), 1);
    });
    await session.endSession();
  }
});

test("abandoned caller-owned winner reservations are reclaimable before TTL", async () => {
  const admin = await makeUser("HEAD_OFFICE");
  const partner = await createPartner(admin, "reservation-retry");
  await Rule.create({ sourceType: "SOLAR", version: 1, calculation: "FIXED", value: 5, availableMargin: 10, createdBy: admin._id });
  const service = require("../services/businessPartnerCommission.service");
  const payload = {
    businessPartner: partner.body.partner._id, transactionId: new mongoose.Types.ObjectId(),
    sourceType: "SOLAR", sourceAmount: 1, eventKey: "abandoned-winner", createdBy: admin._id,
  };
  const session = await mongoose.startSession();
  await assert.rejects(() => session.withTransaction(async () => {
    const provisional = await service.createCommissionForEvent({ ...payload, session });
    assert.equal(provisional.idempotent, false);
    throw new Error("simulated parent transaction abort");
  }), /simulated parent transaction abort/);
  await session.endSession();
  assert.equal(await Commission.countDocuments({ eventKey: payload.eventKey }), 0);
  await new Promise(resolve => setTimeout(resolve, 1100));
  const retry = await service.createCommissionForEvent(payload);
  assert.equal(retry.idempotent, false);
  assert.equal(await Commission.countDocuments({ eventKey: payload.eventKey }), 1);
});

test("application assignment does not transfer canonical customer ownership or history", async () => {
  const admin = await makeUser("HEAD_OFFICE");
  const a = await createPartner(admin, "multi-app-a", ["CUSTOMERS", "APPLICATIONS", "PHONE_ASSIGNMENT"], ["PHONE"]);
  const b = await createPartner(admin, "multi-app-b", ["CUSTOMERS", "APPLICATIONS", "PHONE_ASSIGNMENT"], ["PHONE"]);
  const aUser = await User.findById(a.body.user._id);
  const bUser = await User.findById(b.body.user._id);
  const created = await api({
    method: "POST", path: "/api/business-partner/customers", actor: aUser,
    body: { fullName: "Canonical A Customer", phone: "08070000021", email: "canonical-a@test.local", password: "password123" },
  });
  const customer = await User.findById(created.body.customer.id);
  await PhoneApplication.create([
    { reference: "BP-MULTI-A", customer: customer._id, product: new mongoose.Types.ObjectId(), productSnapshot: { sku: "A" }, businessPartner: a.body.partner._id, applicationInput: { occupation: "Trader" } },
    { reference: "BP-MULTI-B", customer: customer._id, product: new mongoose.Types.ObjectId(), productSnapshot: { sku: "B" }, businessPartner: b.body.partner._id, applicationInput: { occupation: "Trader" } },
  ]);
  const bCustomers = await api({ path: "/api/business-partner/customers", actor: bUser });
  assert.equal(bCustomers.status, 200);
  assert.equal(bCustomers.body.customers.length, 1);
  assert.equal(bCustomers.body.customers[0].walletBalance, undefined);
  assert.equal((await api({ path: `/api/business-partner/customers/${customer._id}`, actor: bUser })).status, 404);
  assert.equal((await api({ path: `/api/business-partner/customers/${customer._id}/transactions`, actor: bUser })).status, 404);
  assert.equal((await api({ path: "/api/business-partner/transactions", actor: bUser })).body.transactions.length, 0);
  assert.equal((await api({ path: "/api/business-partner/customers", actor: aUser })).body.customers.length, 1);
});