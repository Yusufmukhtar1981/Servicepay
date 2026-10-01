const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const User = require("../models/user.model");
const School = require("../models/edupaySchool.model");
const SchoolRequest = require("../models/edupaySchoolRequest.model");
const EmpowermentOrganization = require("../models/empowermentOrganization.model");
const EmpowermentProgram = require("../models/empowermentProgram.model");
const { Organization } = require("../models/organizations.models");
const managedRecordsRoutes = require("../routes/managedRecords.routes");
const {
  getManagedRecordScope,
  managedRecordFilter,
} = require("../services/aggregatorRecordScope.service");

let sequence = 0;
const nextNumber = () => String(++sequence).padStart(7, "0");
const createUser = (role, extra = {}) => {
  const suffix = nextNumber();
  return User.create({
    fullName: `${role} ${suffix}`,
    phone: `080${suffix}`,
    email: `${role.toLowerCase()}-${suffix}@scope.test`,
    password: "Password123!",
    role,
    status: "ACTIVE",
    ...extra,
  });
};

const createSchool = (name, owner, extra = {}) => School.create({
  name,
  address: "10 Example Street",
  state: "Alpha State",
  createdBy: owner._id,
  ...extra,
});

const createSponsor = (name, owner, extra = {}) => EmpowermentOrganization.create({
  name,
  organizationType: "COOPERATIVE",
  createdBy: owner._id,
  ...extra,
});

const tokenFor = (user) => jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET);

test("managed records use current verified trees, safe legacy fallback, and server-owned creation lineage", {
  timeout: 240000,
}, async (t) => {
  // Always use an isolated disposable replica set; never read MONGODB_URI or
  // connect to a configured/production database from this test.
  const mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  await mongoose.connect(mongo.getUri(), { dbName: `managed-records-${nextNumber()}` });
  const serverModels = [User, School, SchoolRequest, EmpowermentOrganization, EmpowermentProgram, Organization];
  await Promise.all(serverModels.map((model) => model.init()));

  const app = express();
  app.use(express.json());
  app.use("/api/management/records", managedRecordsRoutes);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/management/records`;
  process.env.JWT_SECRET = "managed-record-scope-disposable-test-secret";
  const api = async (actor, path, method = "GET", body) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${tokenFor(actor)}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await mongo.stop();
  });

  const zonal = await createUser("ZONAL_MANAGER", { zone: "North" });
  const otherZonal = await createUser("ZONAL_MANAGER", { zone: "South" });
  const smAlpha = await createUser("STATE_MANAGER", {
    zone: "North", state: "Alpha State", zonalManagerId: zonal._id,
  });
  const smBeta = await createUser("STATE_MANAGER", {
    zone: "North", state: "Beta State", zonalManagerId: zonal._id,
  });
  const smSouth = await createUser("STATE_MANAGER", {
    zone: "South", state: "Gamma State", zonalManagerId: otherZonal._id,
  });
  const agentAlpha = await createUser("AGENT", {
    zone: "North", state: "Alpha State", zonalManagerId: zonal._id, stateManagerId: smAlpha._id,
  });
  const agentBeta = await createUser("AGENT", {
    zone: "North", state: "Beta State", zonalManagerId: zonal._id, stateManagerId: smBeta._id,
  });
  const agentSouth = await createUser("AGENT", {
    zone: "South", state: "Gamma State", zonalManagerId: otherZonal._id, stateManagerId: smSouth._id,
  });
  const suspendedAgent = await createUser("AGENT", {
    zone: "North", state: "Alpha State", zonalManagerId: zonal._id, stateManagerId: smAlpha._id,
    status: "SUSPENDED",
  });
  const customerAlpha = await createUser("CUSTOMER", {
    zone: "North", state: "Alpha State", zonalManagerId: zonal._id,
    stateManagerId: smAlpha._id, agentId: agentAlpha._id,
  });
  const customerBeta = await createUser("CUSTOMER", {
    zone: "North", state: "Beta State", zonalManagerId: zonal._id,
    stateManagerId: smBeta._id, agentId: agentBeta._id,
  });
  const customerStateManagerOnly = await createUser("CUSTOMER", {
    zone: "North", state: "Alpha State", zonalManagerId: zonal._id,
    stateManagerId: smAlpha._id, agentId: null,
  });
  const customerSouth = await createUser("CUSTOMER", {
    zone: "South", state: "Gamma State", zonalManagerId: otherZonal._id,
    stateManagerId: smSouth._id, agentId: agentSouth._id,
  });
  const conflictingCustomer = await createUser("CUSTOMER", {
    zone: "North", state: "Alpha State", zonalManagerId: otherZonal._id,
    stateManagerId: smSouth._id, agentId: agentAlpha._id,
  });

  const alphaSchool = await createSchool("Alpha Agent School", agentAlpha, {
    aggregatorId: agentAlpha._id, stateManagerId: smAlpha._id, createdByRole: "AGENT",
    bankDetails: { accountNumberLast4: "1234" }, supportingDocuments: [{ key: "private" }],
  });
  const betaSchool = await createSchool("Beta Agent School", agentBeta, {
    state: "Beta State", aggregatorId: agentBeta._id, stateManagerId: smBeta._id,
  });
  await createSchool("Beta Direct State Manager School", smBeta, {
    state: "Beta State", aggregatorId: null, stateManagerId: smBeta._id,
    createdByRole: "STATE_MANAGER",
  });
  const southSchool = await createSchool("South Agent School", agentSouth, {
    state: "Gamma State", aggregatorId: agentSouth._id, stateManagerId: smSouth._id,
  });
  await createSchool("Suspended Aggregator School", suspendedAgent, {
    aggregatorId: suspendedAgent._id, stateManagerId: smAlpha._id,
  });
  await createSchool("Legacy Customer School", customerAlpha, { aggregatorId: null });
  await createSchool("Legacy Aggregator School", agentAlpha, { aggregatorId: null });
  await createSchool("Conflicting Explicit Owner", customerAlpha, {
    aggregatorId: agentSouth._id, stateManagerId: smAlpha._id,
  });
  await createSchool("Stale Snapshot Only", conflictingCustomer, {
    aggregatorId: null, stateManagerId: smAlpha._id,
  });
  await createSchool("Direct State Manager School", smAlpha, {
    aggregatorId: null, stateManagerId: smAlpha._id, createdByRole: "STATE_MANAGER",
  });

  const linkedRequest = await SchoolRequest.create({
    parent: agentAlpha._id,
    createdBy: agentAlpha._id,
    createdByRole: "AGENT",
    aggregatorId: agentAlpha._id,
    stateManagerId: smAlpha._id,
    zonalManagerId: zonal._id,
    schoolName: alphaSchool.name,
    normalizedSchoolName: "ALPHA AGENT SCHOOL",
    location: "North",
    normalizedLocation: "NORTH",
    state: "Alpha State",
    school: alphaSchool._id,
    status: "APPROVED",
  });
  const pendingRequest = await SchoolRequest.create({
    parent: agentAlpha._id,
    createdBy: agentAlpha._id,
    createdByRole: "AGENT",
    aggregatorId: agentAlpha._id,
    stateManagerId: smAlpha._id,
    zonalManagerId: zonal._id,
    schoolName: "New Alpha Request",
    normalizedSchoolName: "NEW ALPHA REQUEST",
    location: "North",
    normalizedLocation: "NORTH",
    state: "Alpha State",
  });
  const ownedRequestLinkedOutsideScope = await SchoolRequest.create({
    parent: agentAlpha._id,
    createdBy: agentAlpha._id,
    createdByRole: "AGENT",
    aggregatorId: agentAlpha._id,
    stateManagerId: smAlpha._id,
    zonalManagerId: zonal._id,
    schoolName: "Alpha Request For Existing School",
    normalizedSchoolName: "ALPHA REQUEST FOR EXISTING SCHOOL",
    location: "North",
    normalizedLocation: "NORTH-EXISTING",
    state: "Alpha State",
    school: southSchool._id,
    status: "APPROVED",
  });
  await SchoolRequest.create({
    parent: agentSouth._id,
    createdBy: agentSouth._id,
    createdByRole: "AGENT",
    aggregatorId: agentSouth._id,
    stateManagerId: smSouth._id,
    zonalManagerId: otherZonal._id,
    schoolName: "South Request",
    normalizedSchoolName: "SOUTH REQUEST",
    location: "South",
    normalizedLocation: "SOUTH",
    state: "Gamma State",
  });

  const alphaSponsor = await createSponsor("Alpha Sponsor", agentAlpha, { aggregatorId: agentAlpha._id });
  const betaSponsor = await createSponsor("Beta Sponsor", agentBeta, { aggregatorId: agentBeta._id });
  await createSponsor("South Sponsor", agentSouth, { aggregatorId: agentSouth._id });
  await createSponsor("Legacy Alpha Sponsor", customerAlpha, { aggregatorId: null });
  await createSponsor("Legacy Agent Sponsor", agentAlpha, { aggregatorId: null });
  await createSponsor("State Manager Customer Sponsor", customerStateManagerOnly, {
    aggregatorId: null, stateManagerId: smAlpha._id,
  });
  await createSponsor("Conflicting Explicit Sponsor", customerAlpha, { aggregatorId: agentSouth._id });
  await createSponsor("Stale Snapshot Sponsor", conflictingCustomer, { aggregatorId: null, stateManagerId: smAlpha._id });
  await createSponsor("Suspended Aggregator Sponsor", suspendedAgent, {
    aggregatorId: suspendedAgent._id, stateManagerId: smAlpha._id,
  });

  const alphaProgram = await EmpowermentProgram.create({
    name: "Alpha Program", organization: alphaSponsor._id, createdBy: agentAlpha._id,
    aggregatorId: agentAlpha._id, stateManagerId: smAlpha._id,
    amountPerBeneficiary: 10, targetBeneficiaries: 3,
  });
  await EmpowermentProgram.create({
    name: "South Program", organization: alphaSponsor._id, createdBy: agentSouth._id,
    aggregatorId: agentSouth._id, stateManagerId: smSouth._id,
    amountPerBeneficiary: 10, targetBeneficiaries: 3,
  });

  const alphaOrganization = await Organization.create({
    name: "Alpha Organization",
    slug: `alpha-${nextNumber()}`,
    code: `ALPHA-${nextNumber()}`,
    createdBy: agentAlpha._id,
    aggregatorId: agentAlpha._id,
    stateManagerId: smAlpha._id,
    representative: { fullName: "Private Representative", nin: "12345678901" },
    documents: [{ name: "Private incorporation document", storageKey: "private/key" }],
  });
  await Organization.create({
    name: "South Organization",
    slug: `south-${nextNumber()}`,
    code: `SOUTH-${nextNumber()}`,
    createdBy: agentSouth._id,
    aggregatorId: agentSouth._id,
  });

  const zonalScope = await getManagedRecordScope(zonal);
  assert.deepEqual(new Set(zonalScope.aggregatorIds.map(String)), new Set([
    String(agentAlpha._id), String(agentBeta._id), String(suspendedAgent._id),
  ]));
  assert.equal(zonalScope.stateManagerIds.length, 2);
  assert.ok(zonalScope.customerIds.map(String).includes(String(customerAlpha._id)));
  assert.equal(zonalScope.customerIds.map(String).includes(String(conflictingCustomer._id)), false);

  const agentScope = await getManagedRecordScope(agentAlpha);
  assert.deepEqual(agentScope.aggregatorIds.map(String), [String(agentAlpha._id)]);
  assert.deepEqual(agentScope.stateManagerIds.map(String), [String(smAlpha._id)]);
  assert.equal(agentScope.customerIds.map(String).includes(String(customerAlpha._id)), true);

  const filter = managedRecordFilter(agentScope, { includeLegacyCustomers: true });
  assert.ok(filter.$or.some((branch) => branch.aggregatorId?.$in?.some((id) => String(id) === String(agentAlpha._id))));
  assert.ok(filter.$or.some((branch) => branch.createdBy?.$in?.some((id) => String(id) === String(agentAlpha._id)) &&
    branch.aggregatorId === null));
  const roleAwareAgentFilter = managedRecordFilter(agentScope, {
    includeLegacyCustomers: true,
    includeLegacyStateManagers: true,
    stateManagerField: "stateManagerId",
  });
  assert.equal(roleAwareAgentFilter.$or.some((branch) =>
    branch.createdBy?.$in?.some((id) => String(id) === String(customerAlpha._id))), false,
  "AGENT scopes do not inherit customer fallbacks, including customers created directly under the parent State Manager");
  assert.equal(roleAwareAgentFilter.$or.some((branch) =>
    branch.createdBy?.$in?.some((id) => String(id) === String(smAlpha._id))), false,
  "AGENT scopes do not inherit direct State Manager legacy records");

  const zonalSummary = await api(zonal, "/summary");
  assert.equal(zonalSummary.status, 200);
  assert.deepEqual(Object.keys(zonalSummary.body).sort(), ["counts", "success"]);
  assert.equal(zonalSummary.body.success, true);
  assert.deepEqual(Object.keys(zonalSummary.body.counts).sort(), ["empowerment", "organizations", "schools"]);
  for (const section of ["schools", "empowerment", "organizations"]) {
    assert.equal(typeof zonalSummary.body.counts[section], "number",
      `summary counts.${section} must be numeric for the cross-component API contract`);
  }
  assert.equal(zonalSummary.body.counts.schools, 9,
    "current zone records include two states, suspended descendants, valid customer/Aggregator legacy, and direct State Manager records; only approved requests linked to scoped schools deduplicate");
  assert.equal(zonalSummary.body.counts.empowerment, 7);
  assert.equal(zonalSummary.body.counts.organizations, 1);

  const zonalSchools = await api(zonal, "/schools?search=Alpha");
  assert.equal(zonalSchools.status, 200);
  assert.ok(zonalSchools.body.items.some((item) => String(item._id) === String(pendingRequest._id)));
  assert.equal(zonalSchools.body.items.some((item) => String(item._id) === String(linkedRequest._id)), false);
  const retainedApprovedRequest = zonalSchools.body.items.find((item) => String(item._id) === String(ownedRequestLinkedOutsideScope._id));
  assert.equal(retainedApprovedRequest.kind, "school-request");
  assert.equal(retainedApprovedRequest.status, "APPROVED");
  assert.equal(zonalSchools.body.items.some((item) => item.name === "Stale Snapshot Only"), false);
  assert.equal(zonalSchools.body.items.some((item) => item.name === "Conflicting Explicit Owner"), false);

  const alphaAgentSchools = await api(agentAlpha, "/schools");
  assert.equal(alphaAgentSchools.status, 200);
  assert.equal(alphaAgentSchools.body.items.some((item) => item.name === "Direct State Manager School"), false);
  assert.equal(alphaAgentSchools.body.items.some((item) => item.name === "Beta Agent School"), false);
  assert.equal(alphaAgentSchools.body.items.some((item) => item.name === "Alpha Agent School"), true);
  assert.equal(alphaAgentSchools.body.items.some((item) => item.name === "Legacy Customer School"), false,
    "an Agent never inherits legacy customer-created records, even when the customer is currently assigned to that Agent");
  assert.equal(alphaAgentSchools.body.items.some((item) => item.name === "Legacy Aggregator School"), true);
  assert.equal(alphaAgentSchools.body.items.some((item) => String(item._id) === String(ownedRequestLinkedOutsideScope._id)), true,
    "the requester retains its approved request when the linked school is outside its current scope");

  const agentEmpowerment = await api(agentAlpha, "/empowerment");
  assert.equal(agentEmpowerment.body.total, 3);
  assert.equal(agentEmpowerment.body.items.some((item) => item.name === "Legacy Agent Sponsor"), true,
    "a legacy record created by the scoped Aggregator remains visible without aggregatorId");
  assert.equal(agentEmpowerment.body.items.some((item) => item.name === "State Manager Customer Sponsor"), false,
    "an Agent never inherits agentless customers owned directly by its parent State Manager");

  const empowermentList = await api(zonal, "/empowerment");
  assert.equal(empowermentList.body.total, 7);
  assert.ok(empowermentList.body.items.some((item) => item.kind === "program" && item.name === alphaProgram.name));
  assert.equal(JSON.stringify(empowermentList.body).includes("amountPerBeneficiary"), false);

  const organizationList = await api(zonal, "/organizations");
  assert.equal(organizationList.body.total, 1);
  assert.equal(JSON.stringify(organizationList.body).includes("Private Representative"), false);
  assert.equal(JSON.stringify(organizationList.body).includes("storageKey"), false);
  assert.equal(JSON.stringify(organizationList.body).includes("12345678901"), false);

  const schoolDetail = await api(agentAlpha, `/schools/${alphaSchool._id}?kind=school`);
  assert.equal(schoolDetail.status, 200);
  assert.equal(schoolDetail.body.item.name, alphaSchool.name);
  assert.equal(JSON.stringify(schoolDetail.body).includes("supportingDocuments"), false);
  assert.equal(JSON.stringify(schoolDetail.body).includes("bankDetails"), false);
  const requestDetail = await api(agentAlpha, `/schools/${linkedRequest._id}?kind=school-request`);
  assert.equal(requestDetail.status, 200);
  assert.equal(requestDetail.body.item.kind, "school-request");
  assert.equal(requestDetail.body.item.status, "APPROVED",
    "an approved, deduplicated request remains directly visible to its current owner");
  const forbiddenDetail = await api(agentAlpha, `/schools/${betaSchool._id}?kind=school`);
  assert.equal(forbiddenDetail.status, 403);

  const customerSpoof = await api(customerAlpha, "/organizations", "POST", {
    name: "Customer Spoof",
    aggregatorId: agentAlpha._id,
    stateManagerId: smAlpha._id,
    zonalManagerId: zonal._id,
  });
  assert.equal(customerSpoof.status, 403);
  const headOffice = await createUser("HEAD_OFFICE");
  const headOfficeSpoof = await api(headOffice, "/organizations", "POST", {
    name: "Head Office Spoof",
    aggregatorId: agentAlpha._id,
  });
  assert.equal(headOfficeSpoof.status, 403);
  const forgedCreator = await api(agentAlpha, "/schools", "POST", {
    schoolName: "Forged School",
    location: "North",
    state: "Alpha State",
    schoolType: "Primary",
    lga: "Central",
    contactPerson: "Person",
    phone: "08012345678",
    email: "person@example.test",
    registrationNumber: "REG-FORGED",
    authorizedRepresentative: "Person",
    createdBy: agentBeta._id,
  });
  assert.equal(forgedCreator.status, 409);
  assert.equal(await SchoolRequest.exists({ schoolName: "Forged School" }), null);

  const forgedParent = await api(agentAlpha, "/schools", "POST", {
    schoolName: "Forged Parent",
    location: "North",
    state: "Alpha State",
    schoolType: "Primary",
    lga: "Central",
    contactPerson: "Person",
    phone: "08012345678",
    email: "person@example.test",
    registrationNumber: "REG-FORGED-PARENT",
    authorizedRepresentative: "Person",
    stateManagerId: smBeta._id,
  });
  assert.equal(forgedParent.status, 409);
  assert.equal(await SchoolRequest.exists({ schoolName: "Forged Parent" }), null);

  // Valid creation with omitted legacy metadata still gets exclusively server
  // derived provenance from the fenced current AGENT -> SM -> ZM hierarchy.
  const created = await api(agentAlpha, "/schools", "POST", {
    schoolName: "Server Owned School",
    location: "North",
    state: "Alpha State",
    schoolType: "Primary",
    lga: "Central",
    contactPerson: "Person",
    phone: "08012345679",
    email: "created@example.test",
    registrationNumber: "REG-SERVER-OWNED",
    authorizedRepresentative: "Person",
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const persisted = await SchoolRequest.findOne({ schoolName: "Server Owned School" }).lean();
  assert.equal(String(persisted.createdBy), String(agentAlpha._id));
  assert.equal(String(persisted.aggregatorId), String(agentAlpha._id));
  assert.equal(String(persisted.stateManagerId), String(smAlpha._id));
  assert.equal(String(persisted.zonalManagerId), String(zonal._id));

  await User.updateOne({ _id: smBeta._id }, { $set: { zonalManagerId: otherZonal._id, zone: "South" } });
  await User.updateOne({ _id: agentBeta._id }, { $set: { zonalManagerId: otherZonal._id, zone: "South" } });
  await User.updateOne({ _id: customerBeta._id }, { $set: { zonalManagerId: otherZonal._id, zone: "South" } });
  const oldZoneAfterMove = await getManagedRecordScope(zonal);
  assert.equal(oldZoneAfterMove.stateManagerIds.map(String).includes(String(smBeta._id)), false);
  assert.equal(oldZoneAfterMove.aggregatorIds.map(String).includes(String(agentBeta._id)), false,
    "the previous Zonal Manager loses scope after the current graph is reassigned");
  const newZoneAfterMove = await getManagedRecordScope(otherZonal);
  assert.equal(newZoneAfterMove.stateManagerIds.map(String).includes(String(smBeta._id)), true);
  assert.equal(newZoneAfterMove.aggregatorIds.map(String).includes(String(agentBeta._id)), true);
  const oldZoneSchools = await api(zonal, "/schools");
  assert.equal(oldZoneSchools.body.items.some((item) => item.name === "Beta Agent School"), false);
  assert.equal(oldZoneSchools.body.items.some((item) => item.name === "Beta Direct State Manager School"), false);
  const newZoneSchools = await api(otherZonal, "/schools");
  assert.equal(newZoneSchools.body.items.some((item) => item.name === "Beta Agent School"), true);
  assert.equal(newZoneSchools.body.items.some((item) => item.name === "Beta Direct State Manager School"), true,
    "direct State Manager records follow the current graph rather than saved old-zone snapshots");
});