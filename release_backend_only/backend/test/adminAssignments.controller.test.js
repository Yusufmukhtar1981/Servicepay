const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const routes = require("../routes/adminAssignments.routes");
const User = require("../models/user.model");
const Profile = require("../models/businessPartnerProfile.model");
const SolarApplication = require("../models/solarApplication.model");
const SolarAssignment = require("../models/solarAssignment.model");
const SolarOfficer = require("../models/solarOfficer.model");
const PhoneApplication = require("../models/phoneApplication.model");
const Notification = require("../models/notification.model");
const Audit = require("../models/adminAuditLog.model");

const models = [User, Profile, SolarApplication, SolarAssignment, SolarOfficer, PhoneApplication, Notification, Audit];
let repl, server, base, number = 0;
const user = async (role = "CUSTOMER") => {
  number += 1;
  return User.create({ fullName: `User ${number}`, phone: `080${String(number).padStart(8, "0")}`, email: `u${number}@test.local`, password: "password123", role, status: "ACTIVE" });
};
const api = async ({ method = "GET", path, actor, body }) => {
  const headers = { Accept: "application/json", Authorization: `Bearer ${jwt.sign({ id: String(actor._id) }, process.env.JWT_SECRET)}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
};
test.before(async () => {
  process.env.JWT_SECRET = "admin-assignment-test-secret";
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(repl.getUri(), { dbName: "admin-assignment-tests" });
  await Promise.all(models.map((model) => model.init()));
  const app = express(); app.use(express.json()); app.use("/api/admin/assignments", routes);
  await new Promise((resolve) => { server = app.listen(0, "127.0.0.1", () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
});
test.after(async () => { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); await mongoose.disconnect(); await repl.stop(); });
test.beforeEach(async () => { await Promise.all(models.map((model) => model.collection.deleteMany({}))); number = 0; });

test("Head Office assigns, reassigns, and unassigns isolated Solar and Phone cases", async () => {
  const admin = await user("HEAD_OFFICE");
  const owner = await user("BUSINESS_PARTNER");
  const otherOwner = await user("BUSINESS_PARTNER");
  const partner = await Profile.create({ user: owner._id, partnerId: "SP-BP-000001", businessName: "Partner", createdBy: admin._id, services: ["SOLAR", "PHONE"], permissions: ["SOLAR_ASSIGNMENT", "PHONE_ASSIGNMENT"] });
  const other = await Profile.create({ user: otherOwner._id, partnerId: "SP-BP-000002", businessName: "Other", createdBy: admin._id, services: ["SOLAR", "PHONE"], permissions: ["SOLAR_ASSIGNMENT", "PHONE_ASSIGNMENT"] });
  const customer = await user();
  const solarUser = await user("SOLAR_OFFICER");
  const solarOfficer = await SolarOfficer.create({ user: solarUser._id, officerId: "SSO-000001", state: "Lagos", lga: "Ikeja", address: "Address", createdBy: admin._id, businessPartner: partner._id });
  const solarUserTwo = await user("SOLAR_OFFICER");
  const solarOfficerTwo = await SolarOfficer.create({ user: solarUserTwo._id, officerId: "SSO-000002", state: "Lagos", lga: "Ikeja", address: "Address", createdBy: admin._id, businessPartner: partner._id });
  const phoneOfficer = await user("PHONE_FINANCING_OFFICER"); phoneOfficer.isStaff = true; phoneOfficer.businessPartnerId = partner._id; await phoneOfficer.save();
  const otherPhoneOfficer = await user("PHONE_FINANCING_OFFICER"); otherPhoneOfficer.isStaff = true; otherPhoneOfficer.businessPartnerId = other._id; await otherPhoneOfficer.save();
  const solar = await SolarApplication.create({ customer: customer._id, package: new mongoose.Types.ObjectId(), packageSnapshot: { name: "Solar" }, profileSnapshot: { fullName: customer.fullName }, status: "SUBMITTED" });
  const phone = await PhoneApplication.create({ reference: "PHONE-1", customer: customer._id, product: new mongoose.Types.ObjectId(), productSnapshot: { name: "Phone" }, applicationInput: { occupation: "Trader" }, status: "SUBMITTED" });

  const catalog = await api({ path: `/api/admin/assignments/catalog?partnerId=${partner._id}&service=SOLAR`, actor: admin });
  assert.equal(catalog.status, 200, JSON.stringify(catalog.body)); assert.equal(catalog.body.resources.length, 1);
  const assignedSolar = await api({ method: "POST", path: "/api/admin/assignments", actor: admin, body: { partnerId: partner._id, service: "SOLAR", resourceId: solar._id, officerId: solarOfficer._id } });
  assert.equal(assignedSolar.status, 201, JSON.stringify(assignedSolar.body));
  const reassignedSolar = await api({ method: "PATCH", path: `/api/admin/assignments/${assignedSolar.body.assignment.id}`, actor: admin, body: { officerId: solarOfficerTwo._id } });
  assert.equal(reassignedSolar.status, 200);
  const assignedPhone = await api({ method: "POST", path: "/api/admin/assignments", actor: admin, body: { partnerId: partner._id, service: "PHONE", resourceId: phone._id, officerId: phoneOfficer._id } });
  assert.equal(assignedPhone.status, 201, JSON.stringify(assignedPhone.body));
  const crossPartner = await api({ method: "PATCH", path: `/api/admin/assignments/${assignedPhone.body.assignment.id}`, actor: admin, body: { officerId: otherPhoneOfficer._id } });
  assert.equal(crossPartner.status, 403);
  const view = await api({ path: `/api/admin/assignments/partner/${partner._id}`, actor: admin });
  assert.equal(view.status, 200); assert.equal(view.body.officers.phone.length, 1); assert.equal(view.body.assignments.solar.length, 1);
  const unassigned = await api({ method: "DELETE", path: `/api/admin/assignments/${assignedPhone.body.assignment.id}`, actor: admin, body: { note: "Workload change" } });
  assert.equal(unassigned.status, 200);
  assert.equal((await PhoneApplication.findById(phone._id)).assignmentState, "UNASSIGNED");
  assert.ok(await PhoneApplication.exists({ _id: phone._id }));
});