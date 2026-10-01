const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const User = require("../models/user.model");
const EmpowermentOrganization = require("../models/empowermentOrganization.model");
const EmpowermentProgram = require("../models/empowermentProgram.model");
const EmpowermentBeneficiary = require("../models/empowermentBeneficiary.model");
const EmpowermentFunding = require("../models/empowermentFunding.model");
const EmpowermentDisbursement = require("../models/empowermentDisbursement.model");
const EmpowermentAuditLog = require("../models/empowermentAuditLog.model");
const organizationModels = require("../models/organizations.models");
const empowerment = require("../controllers/empowerment.controller");
const organizations = require("../controllers/organizations.controller");
const managedRecords = require("../controllers/managedRecords.controller");
const organizationService = require("../services/organizations.service");

const {
  Organization,
  OrganizationRole,
  OrganizationWallet,
  OrganizationAuditLog,
} = organizationModels;

const databaseModels = [
  User,
  EmpowermentOrganization,
  EmpowermentProgram,
  EmpowermentBeneficiary,
  EmpowermentFunding,
  EmpowermentDisbursement,
  EmpowermentAuditLog,
  Organization,
  OrganizationRole,
  OrganizationWallet,
  OrganizationAuditLog,
];

let mongo;
let sequence = 0;

test.before(async () => {
  mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  await mongoose.connect(mongo.getUri(), { dbName: "managed-record-security" });
  await Promise.all(databaseModels.map((model) => model.init()));
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

test.beforeEach(async () => {
  await Promise.all(databaseModels.map((model) => model.collection.deleteMany({})));
  sequence = 0;
});

const createUser = async ({
  role = "CUSTOMER",
  name = "Managed Record User",
  zone = "South West",
  state = "Lagos",
  walletBalance = 73.25,
  ...other
} = {}) => {
  sequence += 1;
  return User.create({
    fullName: `${name} ${sequence}`,
    phone: `080720${String(sequence).padStart(6, "0")}`,
    email: `managed-record-${sequence}@example.test`,
    password: "secret-password",
    role,
    status: "ACTIVE",
    zone,
    state,
    walletBalance,
    ...other,
  });
};

const createHierarchy = async ({ name, zone, state }) => {
  const zonalManager = await createUser({
    name: `${name} zonal`,
    role: "ZONAL_MANAGER",
    zone,
    state,
  });
  const stateManager = await createUser({
    name: `${name} state`,
    role: "STATE_MANAGER",
    zone,
    state,
    zonalManagerId: zonalManager._id,
  });
  const aggregator = await createUser({
    name: `${name} aggregator`,
    role: "AGENT",
    zone,
    state,
    stateManagerId: stateManager._id,
    zonalManagerId: zonalManager._id,
  });
  const customer = await createUser({
    name: `${name} customer`,
    zone,
    state,
    agentId: aggregator._id,
    stateManagerId: stateManager._id,
    zonalManagerId: zonalManager._id,
  });
  return { zonalManager, stateManager, aggregator, customer };
};

const responseFor = () => ({
  statusCode: 200,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(value) {
    this.body = value;
    return this;
  },
});

const call = async (handler, {
  user,
  body = {},
  params = {},
  query = {},
  headers = {},
  staffAccess,
} = {}) => {
  const res = responseFor();
  await handler({
    user,
    body,
    params,
    query,
    headers,
    staffAccess,
    get(name) {
      const key = Object.keys(headers).find(
        (header) => header.toLowerCase() === name.toLowerCase()
      );
      return key ? headers[key] : undefined;
    },
  }, res);
  return res;
};

const sponsorPayload = (hierarchy, foreign) => ({
  name: "Community Sponsor",
  organizationType: "NGO",
  registrationNumber: "NGO-OWN-100",
  contactName: "Sponsor Contact",
  phone: "08012345678",
  email: "sponsor@example.test",
  address: "1 Community Road",
  state: hierarchy.aggregator.state,
  aggregatorId: foreign.aggregator._id,
  stateManagerId: foreign.stateManager._id,
  zonalManagerId: foreign.zonalManager._id,
  createdBy: foreign.customer._id,
  status: "ACTIVE",
  verificationStatus: "VERIFIED",
});

test("Aggregator creation stamps only verified hierarchy and keeps sponsor/program lifecycle", async () => {
  const owner = await createHierarchy({
    name: "Owner",
    zone: "South West",
    state: "Lagos",
  });
  const foreign = await createHierarchy({
    name: "Foreign",
    zone: "North West",
    state: "Kano",
  });
  const actorBefore = await User.findById(owner.aggregator._id).lean();
  const createSponsor = await call(empowerment.createOrganization, {
    user: owner.aggregator,
    body: sponsorPayload(owner, foreign),
  });

  assert.equal(createSponsor.statusCode, 201);
  const sponsor = await EmpowermentOrganization.findById(
    createSponsor.body.organization._id
  ).lean();
  assert.equal(String(sponsor.createdBy), String(owner.aggregator._id));
  assert.equal(sponsor.createdByRole, "AGENT");
  assert.equal(String(sponsor.aggregatorId), String(owner.aggregator._id));
  assert.equal(String(sponsor.stateManagerId), String(owner.stateManager._id));
  assert.equal(String(sponsor.zonalManagerId), String(owner.zonalManager._id));
  assert.equal(sponsor.status, "PENDING");
  assert.equal(sponsor.verificationStatus, "PENDING_VERIFICATION");
  const spoofedSponsorUpdate = await call(empowerment.updateOrganization, {
    user: owner.aggregator,
    params: { id: sponsor._id },
    body: {
      name: "Updated sponsor name",
      aggregatorId: foreign.aggregator._id,
      stateManagerId: foreign.stateManager._id,
      zonalManagerId: foreign.zonalManager._id,
      createdBy: foreign.customer._id,
    },
  });
  assert.equal(spoofedSponsorUpdate.statusCode, 200);
  const afterSponsorUpdate = await EmpowermentOrganization.findById(sponsor._id).lean();
  assert.equal(String(afterSponsorUpdate.aggregatorId), String(owner.aggregator._id));
  assert.equal(String(afterSponsorUpdate.stateManagerId), String(owner.stateManager._id));
  assert.equal(String(afterSponsorUpdate.zonalManagerId), String(owner.zonalManager._id));
  assert.equal(String(afterSponsorUpdate.createdBy), String(owner.aggregator._id));

  const unverifiedProgram = await call(empowerment.createProgram, {
    user: owner.aggregator,
    body: {
      organizationId: sponsor._id,
      name: "Must Wait For Sponsor Verification",
      state: "Lagos",
      amountPerBeneficiary: 100,
      targetBeneficiaries: 5,
      aggregatorId: foreign.aggregator._id,
      stateManagerId: foreign.stateManager._id,
      zonalManagerId: foreign.zonalManager._id,
    },
  });
  assert.equal(unverifiedProgram.statusCode, 409);
  assert.equal(await EmpowermentProgram.countDocuments({}), 0);

  await EmpowermentOrganization.updateOne(
    { _id: sponsor._id },
    { $set: { status: "ACTIVE", verificationStatus: "VERIFIED" } }
  );
  const createProgram = await call(empowerment.managedCreateProgram, {
    user: owner.aggregator,
    body: {
      organizationId: sponsor._id,
      name: "Correctly Scoped Grant",
      state: "Lagos",
      amountPerBeneficiary: 100,
      targetBeneficiaries: 5,
      aggregatorId: foreign.aggregator._id,
      stateManagerId: foreign.stateManager._id,
      zonalManagerId: foreign.zonalManager._id,
      createdBy: foreign.customer._id,
      status: "OPEN",
    },
  });
  assert.equal(createProgram.statusCode, 201);
  const program = await EmpowermentProgram.findById(
    createProgram.body.program._id
  ).lean();
  assert.equal(String(program.createdBy), String(owner.aggregator._id));
  assert.equal(program.createdByRole, "AGENT");
  assert.equal(String(program.aggregatorId), String(owner.aggregator._id));
  assert.equal(String(program.stateManagerId), String(owner.stateManager._id));
  assert.equal(String(program.zonalManagerId), String(owner.zonalManager._id));
  assert.equal(program.status, "DRAFT");
  assert.equal(program.totalBudget, 500);
  const spoofedProgramUpdate = await call(empowerment.updateProgram, {
    user: owner.aggregator,
    params: { programId: program._id },
    body: {
      name: "Updated scoped grant",
      aggregatorId: foreign.aggregator._id,
      stateManagerId: foreign.stateManager._id,
      zonalManagerId: foreign.zonalManager._id,
      createdBy: foreign.customer._id,
    },
  });
  assert.equal(spoofedProgramUpdate.statusCode, 200);
  const afterProgramUpdate = await EmpowermentProgram.findById(program._id).lean();
  assert.equal(String(afterProgramUpdate.aggregatorId), String(owner.aggregator._id));
  assert.equal(String(afterProgramUpdate.stateManagerId), String(owner.stateManager._id));
  assert.equal(String(afterProgramUpdate.zonalManagerId), String(owner.zonalManager._id));
  assert.equal(String(afterProgramUpdate.createdBy), String(owner.aggregator._id));

  const crossBorrow = await call(empowerment.createProgram, {
    user: owner.aggregator,
    body: {
      sponsorId: foreign.aggregator._id,
      name: "Cross-borrow attempt",
      state: "Lagos",
      amountPerBeneficiary: 100,
      targetBeneficiaries: 5,
    },
  });
  assert.equal(crossBorrow.statusCode, 403);
  assert.equal(await EmpowermentProgram.countDocuments({}), 1);

  const actorAfter = await User.findById(owner.aggregator._id).lean();
  assert.equal(actorAfter.role, actorBefore.role);
  assert.equal(actorAfter.status, actorBefore.status);
  assert.equal(actorAfter.walletBalance, actorBefore.walletBalance);
});

test("Customer and non-manager create paths ignore forged ownership attribution", async () => {
  const customer = await createUser({ name: "Regular customer" });
  const other = await createHierarchy({
    name: "Attribution target",
    zone: "North East",
    state: "Borno",
  });
  const response = await call(empowerment.createOrganization, {
    user: customer,
    body: sponsorPayload({ aggregator: customer }, other),
  });
  assert.equal(response.statusCode, 201);
  const sponsor = await EmpowermentOrganization.findById(
    response.body.organization._id
  ).lean();
  assert.equal(String(sponsor.createdBy), String(customer._id));
  assert.equal(sponsor.createdByRole, "CUSTOMER");
  assert.equal(sponsor.aggregatorId, null);
  assert.equal(sponsor.stateManagerId, null);
  assert.equal(sponsor.zonalManagerId, null);
  const customerSponsorUpdate = await call(empowerment.updateOrganization, {
    user: customer,
    params: { id: sponsor._id },
    body: {
      name: "Customer-owned updated sponsor",
      aggregatorId: other.aggregator._id,
      stateManagerId: other.stateManager._id,
      zonalManagerId: other.zonalManager._id,
      createdBy: other.customer._id,
    },
  });
  assert.equal(customerSponsorUpdate.statusCode, 200);
  const customerSponsorAfterUpdate = await EmpowermentOrganization.findById(
    sponsor._id
  ).lean();
  assert.equal(customerSponsorAfterUpdate.aggregatorId, null);
  assert.equal(customerSponsorAfterUpdate.stateManagerId, null);
  assert.equal(customerSponsorAfterUpdate.zonalManagerId, null);
  assert.equal(String(customerSponsorAfterUpdate.createdBy), String(customer._id));

  const profileBefore = await User.findById(customer._id).lean();
  const aggregatorBefore = await User.findById(other.aggregator._id).lean();
  const customerTenant = await call(organizations.create, {
    user: customer,
    body: {
      name: "Customer-owned tenant organization",
      aggregatorId: other.aggregator._id,
      stateManagerId: other.stateManager._id,
      zonalManagerId: other.zonalManager._id,
      createdByRole: "AGENT",
      status: "VERIFIED",
    },
  });
  assert.equal(customerTenant.statusCode, 201);
  const customerOrganization = await Organization.findById(
    customerTenant.body.organization._id
  ).lean();
  assert.equal(String(customerOrganization.createdBy), String(customer._id));
  assert.equal(customerOrganization.createdByRole, "CUSTOMER");
  assert.equal(customerOrganization.aggregatorId, null);
  assert.equal(customerOrganization.stateManagerId, null);
  assert.equal(customerOrganization.zonalManagerId, null);
  const customerTenantUpdate = await call(organizations.onboardingPatch, {
    user: customer,
    params: { organizationId: customerOrganization._id },
    body: {
      description: "Customer's safe KYB update.",
      aggregatorId: other.aggregator._id,
      stateManagerId: other.stateManager._id,
      zonalManagerId: other.zonalManager._id,
      createdByRole: "AGENT",
    },
  });
  assert.equal(customerTenantUpdate.statusCode, 200);
  const customerOrganizationAfterUpdate = await Organization.findById(
    customerOrganization._id
  ).lean();
  assert.equal(customerOrganizationAfterUpdate.aggregatorId, null);
  assert.equal(customerOrganizationAfterUpdate.stateManagerId, null);
  assert.equal(customerOrganizationAfterUpdate.zonalManagerId, null);
  assert.equal(String(customerOrganizationAfterUpdate.createdBy), String(customer._id));
  const tenantResponse = await call(organizations.managedCreateOrganization, {
    user: other.aggregator,
    body: {
      name: "Aggregator tenant organization",
      organizationType: "NGO",
      registrationStatus: "UNREGISTERED",
      description: "A valid draft for KYB onboarding.",
      aggregatorId: customer._id,
      stateManagerId: customer._id,
      zonalManagerId: customer._id,
      createdBy: customer._id,
      createdByRole: "HEAD_OFFICE",
      status: "VERIFIED",
      role: "ADMIN",
      walletBalance: 900000,
      contact: { name: "Owner contact", email: "owner@example.test" },
    },
  });
  assert.equal(tenantResponse.statusCode, 201);
  const tenant = await Organization.findById(
    tenantResponse.body.organization._id
  ).lean();
  assert.equal(String(tenant.createdBy), String(other.aggregator._id));
  assert.equal(tenant.createdByRole, "AGENT");
  assert.equal(String(tenant.aggregatorId), String(other.aggregator._id));
  assert.equal(String(tenant.stateManagerId), String(other.stateManager._id));
  assert.equal(String(tenant.zonalManagerId), String(other.zonalManager._id));
  assert.equal(tenant.status, "DRAFT");
  assert.equal(tenant.representative?.nin, undefined);
  assert.equal(await OrganizationRole.countDocuments({
    organization: tenant._id,
    user: other.aggregator._id,
    role: "OWNER",
  }), 1);
  const wallet = await OrganizationWallet.findOne({ organization: tenant._id }).lean();
  assert.equal(wallet.balance, 0);
  assert.equal(wallet.heldBalance, 0);
  assert.equal(wallet.status, "ACTIVE");
  const profileAfter = await User.findById(customer._id).lean();
  assert.equal(profileAfter.role, profileBefore.role);
  assert.equal(profileAfter.status, profileBefore.status);
  assert.equal(profileAfter.walletBalance, profileBefore.walletBalance);
  const aggregatorAfter = await User.findById(other.aggregator._id).lean();
  assert.equal(aggregatorAfter.role, aggregatorBefore.role);
  assert.equal(aggregatorAfter.status, aggregatorBefore.status);
  assert.equal(aggregatorAfter.walletBalance, aggregatorBefore.walletBalance);
  const spoofedKybPatch = await call(organizations.onboardingPatch, {
    user: other.aggregator,
    params: { organizationId: tenant._id },
    body: {
      description: "Updated through the owner's existing KYB form.",
      aggregatorId: customer._id,
      stateManagerId: customer._id,
      zonalManagerId: customer._id,
      createdBy: customer._id,
      createdByRole: "HEAD_OFFICE",
    },
  });
  assert.equal(spoofedKybPatch.statusCode, 200);
  const tenantAfterPatch = await Organization.findById(tenant._id).lean();
  assert.equal(String(tenantAfterPatch.aggregatorId), String(other.aggregator._id));
  assert.equal(String(tenantAfterPatch.stateManagerId), String(other.stateManager._id));
  assert.equal(String(tenantAfterPatch.zonalManagerId), String(other.zonalManager._id));
  assert.equal(String(tenantAfterPatch.createdBy), String(other.aggregator._id));

  const headOffice = await createUser({ name: "Legacy Head Office", role: "HEAD_OFFICE" });
  const headOfficeSponsor = await call(empowerment.createOrganization, {
    user: headOffice,
    body: sponsorPayload({ aggregator: headOffice }, other),
  });
  assert.equal(headOfficeSponsor.statusCode, 201);
  const legacySponsor = await EmpowermentOrganization.findById(
    headOfficeSponsor.body.organization._id
  ).lean();
  assert.equal(String(legacySponsor.createdBy), String(headOffice._id));
  assert.equal(legacySponsor.createdByRole, "HEAD_OFFICE");
  assert.equal(legacySponsor.aggregatorId, null);
  assert.equal(legacySponsor.stateManagerId, null);
  assert.equal(legacySponsor.zonalManagerId, null);
  const headOfficeSponsorUpdate = await call(empowerment.updateOrganization, {
    user: headOffice,
    params: { id: legacySponsor._id },
    body: {
      name: "Head Office sponsor update",
      aggregatorId: other.aggregator._id,
      stateManagerId: other.stateManager._id,
      zonalManagerId: other.zonalManager._id,
      createdBy: other.customer._id,
    },
  });
  assert.equal(headOfficeSponsorUpdate.statusCode, 200);
  const legacySponsorAfterUpdate = await EmpowermentOrganization.findById(
    legacySponsor._id
  ).lean();
  assert.equal(legacySponsorAfterUpdate.aggregatorId, null);
  assert.equal(legacySponsorAfterUpdate.stateManagerId, null);
  assert.equal(legacySponsorAfterUpdate.zonalManagerId, null);
  assert.equal(String(legacySponsorAfterUpdate.createdBy), String(headOffice._id));
  const headOfficeTenant = await call(organizations.create, {
    user: headOffice,
    body: {
      name: "Head Office legacy creation",
      aggregatorId: other.aggregator._id,
      stateManagerId: other.stateManager._id,
      zonalManagerId: other.zonalManager._id,
      createdByRole: "AGENT",
      status: "VERIFIED",
    },
  });
  assert.equal(headOfficeTenant.statusCode, 201);
  const legacyTenant = await Organization.findById(
    headOfficeTenant.body.organization._id
  ).lean();
  assert.equal(String(legacyTenant.createdBy), String(headOffice._id));
  assert.equal(legacyTenant.createdByRole, "HEAD_OFFICE");
  assert.equal(legacyTenant.aggregatorId, null);
  assert.equal(legacyTenant.stateManagerId, null);
  assert.equal(legacyTenant.zonalManagerId, null);
  const headOfficeTenantUpdate = await call(organizations.onboardingPatch, {
    user: headOffice,
    params: { organizationId: legacyTenant._id },
    body: {
      description: "Head Office owner update.",
      aggregatorId: other.aggregator._id,
      stateManagerId: other.stateManager._id,
      zonalManagerId: other.zonalManager._id,
      createdByRole: "AGENT",
    },
  });
  assert.equal(headOfficeTenantUpdate.statusCode, 200);
  const legacyTenantAfterUpdate = await Organization.findById(
    legacyTenant._id
  ).lean();
  assert.equal(legacyTenantAfterUpdate.aggregatorId, null);
  assert.equal(legacyTenantAfterUpdate.stateManagerId, null);
  assert.equal(legacyTenantAfterUpdate.zonalManagerId, null);
  assert.equal(String(legacyTenantAfterUpdate.createdBy), String(headOffice._id));
});

test("State and Zonal Manager list/detail/status routes stay inside the live hierarchy", async () => {
  const owner = await createHierarchy({
    name: "Scoped",
    zone: "South East",
    state: "Enugu",
  });
  const outside = await createHierarchy({
    name: "Unrelated",
    zone: "North Central",
    state: "Nasarawa",
  });
  const ownedSponsor = await EmpowermentOrganization.create({
    name: "Owned legacy sponsor",
    organizationType: "NGO",
    createdBy: owner.customer._id,
    status: "ACTIVE",
    verificationStatus: "VERIFIED",
  });
  const parentStateManagerSponsor = await EmpowermentOrganization.create({
    name: "Legacy parent State Manager sponsor",
    organizationType: "NGO",
    createdBy: owner.stateManager._id,
    status: "ACTIVE",
    verificationStatus: "VERIFIED",
  });
  const outsideSponsor = await EmpowermentOrganization.create({
    name: "Outside sponsor",
    organizationType: "NGO",
    createdBy: outside.customer._id,
    status: "ACTIVE",
    verificationStatus: "VERIFIED",
  });
  const makeProgram = (organization, createdBy, extra = {}) =>
    EmpowermentProgram.create({
      organization: organization._id,
      name: `${organization.name} grant`,
      state: "Lagos",
      amountPerBeneficiary: 100,
      targetBeneficiaries: 5,
      createdBy,
      status: "DRAFT",
      ...extra,
    });
  const ownedProgram = await makeProgram(ownedSponsor, owner.customer._id);
  const parentStateManagerProgram = await makeProgram(
    parentStateManagerSponsor,
    owner.stateManager._id
  );
  const outsideProgram = await makeProgram(
    outsideSponsor,
    outside.customer._id,
    { status: "OPEN", publicTransparencyEnabled: true }
  );
  const agentOwnedSponsor = await EmpowermentOrganization.create({
    name: "Legacy Aggregator-owned sponsor",
    organizationType: "NGO",
    createdBy: owner.aggregator._id,
    status: "ACTIVE",
    verificationStatus: "VERIFIED",
  });
  const agentOwnedProgram = await makeProgram(
    agentOwnedSponsor,
    owner.aggregator._id
  );
  const outsideBeneficiary = await EmpowermentBeneficiary.create({
    program: outsideProgram._id,
    fullName: "Outside beneficiary",
    phone: "08077770000",
    normalizedPhone: "08077770000",
    applicationStatus: "SUBMITTED",
  });

  for (const manager of [owner.stateManager, owner.zonalManager]) {
    const organizationsList = await call(empowerment.listOrganizations, {
      user: manager,
    });
    assert.equal(organizationsList.statusCode, 200);
    assert.equal(organizationsList.body.pagination.total, 3);
    assert.deepEqual(
      organizationsList.body.organizations
        .map((organization) => String(organization._id))
        .sort(),
      [
        String(parentStateManagerSponsor._id),
        String(ownedSponsor._id),
        String(agentOwnedSponsor._id),
      ].sort()
    );

    const programsList = await call(empowerment.listPrograms, { user: manager });
    assert.equal(programsList.statusCode, 200);
    assert.equal(programsList.body.pagination.total, 3);
    assert.deepEqual(
      programsList.body.programs.map((program) => String(program._id)).sort(),
      [
        String(parentStateManagerProgram._id),
        String(ownedProgram._id),
        String(agentOwnedProgram._id),
      ].sort()
    );
    const summary = await call(empowerment.getEmpowermentDashboardSummary, {
      user: manager,
      staffAccess: { scope: { type: "STATE", state: manager.state } },
    });
    assert.equal(summary.statusCode, 200);
    assert.equal(summary.body.summary.organizations, 3);
    assert.equal(summary.body.summary.programs, 3);
    const sponsorDashboard = await call(empowerment.getSponsorDashboard, {
      user: manager,
      staffAccess: { scope: { type: "STATE", state: manager.state } },
    });
    assert.equal(sponsorDashboard.statusCode, 200);
    assert.equal(sponsorDashboard.body.organizations.length, 3);
    assert.equal(sponsorDashboard.body.programs.length, 3);

    const foreignOrganization = await call(empowerment.getOrganization, {
      user: manager,
      params: { id: outsideSponsor._id },
    });
    assert.equal(foreignOrganization.statusCode, 404);
    const foreignProgram = await call(empowerment.getProgram, {
      user: manager,
      params: { programId: outsideProgram._id },
    });
    assert.equal(foreignProgram.statusCode, 404);

    const forbiddenOrgStatus = await call(empowerment.updateOrganizationStatus, {
      user: manager,
      params: { id: outsideSponsor._id },
      body: { status: "ACTIVE" },
    });
    assert.equal(forbiddenOrgStatus.statusCode, 404);
    const forbiddenProgramStatus = await call(empowerment.updateProgramStatus, {
      user: manager,
      params: { id: outsideProgram._id },
      body: { status: "OPEN" },
    });
    assert.equal(forbiddenProgramStatus.statusCode, 404);
    const forbiddenBeneficiaryEdit = await call(empowerment.updateBeneficiaryStatus, {
      user: manager,
      params: { id: outsideBeneficiary._id },
      body: { status: "UNDER_REVIEW" },
    });
    assert.equal(forbiddenBeneficiaryEdit.statusCode, 403);
  }

  const publicViewer = await createUser({ role: "CUSTOMER" });
  const publicProgram = await call(empowerment.getProgram, {
    user: publicViewer,
    params: { programId: outsideProgram._id },
  });
  assert.equal(publicProgram.statusCode, 200);
  assert.equal(String(publicProgram.body.program._id), String(outsideProgram._id));

  const agentSponsorList = await call(empowerment.listOrganizations, {
    user: owner.aggregator,
  });
  assert.equal(agentSponsorList.body.pagination.total, 1);
  assert.equal(
    String(agentSponsorList.body.organizations[0]._id),
    String(agentOwnedSponsor._id)
  );
  const agentProgramList = await call(empowerment.listPrograms, {
    user: owner.aggregator,
  });
  assert.equal(agentProgramList.body.pagination.total, 1);
  assert.equal(
    String(agentProgramList.body.programs[0]._id),
    String(agentOwnedProgram._id)
  );

  const ownedTenant = await Organization.create({
    name: "Scoped tenant",
    slug: "scoped-tenant",
    code: "ORGSCOPED",
    createdBy: owner.aggregator._id,
    createdByRole: "AGENT",
    aggregatorId: owner.aggregator._id,
    stateManagerId: owner.stateManager._id,
    zonalManagerId: owner.zonalManager._id,
    status: "DRAFT",
    type: "NGO",
    contact: { email: "private@example.test" },
    representative: { fullName: "Private Person", nin: "12345678901" },
    documents: [{
      name: "Private registration",
      documentType: "REGISTRATION_CERTIFICATE",
      storageKey: "private/org-document",
      mimeType: "application/pdf",
      size: 100,
    }],
  });
  await Organization.create({
    name: "Unrelated tenant",
    slug: "unrelated-tenant",
    code: "ORGOTHER",
    createdBy: outside.aggregator._id,
    createdByRole: "AGENT",
    aggregatorId: outside.aggregator._id,
    stateManagerId: outside.stateManager._id,
    zonalManagerId: outside.zonalManager._id,
    status: "DRAFT",
    type: "NGO",
  });
  const managerList = await call(organizations.adminList, {
    user: owner.zonalManager,
    staffAccess: { permissions: ["organizations.view"] },
  });
  assert.equal(managerList.statusCode, 200);
  assert.deepEqual(
    managerList.body.organizations.map((org) => String(org._id)),
    [String(ownedTenant._id)]
  );
  assert.equal(managerList.body.organizations[0].contact, undefined);
  assert.equal(managerList.body.organizations[0].documents, undefined);
  assert.equal(managerList.body.organizations[0].representative, undefined);
  const scopedTenant = await call(organizations.adminDetail, {
    user: owner.zonalManager,
    params: { id: ownedTenant._id },
    staffAccess: { permissions: ["organizations.view"] },
  });
  assert.equal(scopedTenant.statusCode, 200);
  assert.equal(scopedTenant.body.organization.contact, undefined);
  assert.equal(scopedTenant.body.organization.documents, undefined);
  assert.equal(scopedTenant.body.organization.representative, undefined);
  const privateDocument = await call(organizations.organizationDocumentView, {
    user: owner.zonalManager,
    params: {
      id: ownedTenant._id,
      documentId: ownedTenant.documents[0]._id,
    },
    staffAccess: {
      permissions: ["organizations.documents.view"],
    },
  });
  assert.equal(privateDocument.statusCode, 403);
  const managerSummary = await call(organizations.adminSummary, {
    user: owner.zonalManager,
    staffAccess: { permissions: ["organizations.view"] },
  });
  assert.equal(managerSummary.statusCode, 200);
  assert.equal(managerSummary.body.summary.total, 1);
  const newManagedOrganizationList = await call(managedRecords.list, {
    user: owner.zonalManager,
    params: { section: "organizations" },
    query: {},
  });
  assert.equal(newManagedOrganizationList.body.total, 1);
  const organizationDto = newManagedOrganizationList.body.items[0];
  assert.notEqual(
    organizationDto.details.organizationEmail,
    "private@example.test"
  );
  assert.equal(organizationDto.details.organizationPhone, undefined);
  assert.equal(organizationDto.details.documents, undefined);
  assert.equal(organizationDto.details.representative, undefined);
  const managedEmpowermentList = await call(managedRecords.list, {
    user: owner.zonalManager,
    params: { section: "empowerment" },
    query: {},
  });
  assert.equal(managedEmpowermentList.body.total, 6);
  const sponsorDto = managedEmpowermentList.body.items.find(
    (item) => item.kind === "sponsor"
  );
  assert.equal(sponsorDto.details.contactName, undefined);
  assert.equal(sponsorDto.details.phone, undefined);
  assert.equal(sponsorDto.details.email, undefined);
  assert.equal(sponsorDto.details.address, undefined);
  const unrelatedNewDetail = await call(managedRecords.detail, {
    user: owner.zonalManager,
    params: { section: "empowerment", id: outsideSponsor._id },
    query: {},
  });
  assert.equal(unrelatedNewDetail.statusCode, 403);
  const managerDetail = await call(organizations.adminDetail, {
    user: owner.zonalManager,
    params: { id: "507f1f77bcf86cd799439011" },
    staffAccess: { permissions: ["organizations.view"] },
  });
  assert.equal(managerDetail.statusCode, 404);

  const headOffice = await createUser({ name: "Global Admin", role: "HEAD_OFFICE" });
  const globalList = await call(empowerment.listOrganizations, { user: headOffice });
  assert.equal(globalList.body.pagination.total, 4);
  const customerList = await call(empowerment.listOrganizations, {
    user: owner.customer,
  });
  assert.equal(customerList.body.pagination.total, 1);
});

test("a reparented manager cannot read or replay historical program financial keys", async () => {
  const previous = await createHierarchy({
    name: "Previously scoped",
    zone: "South East",
    state: "Enugu",
  });
  const next = await createHierarchy({
    name: "New parents",
    zone: "North Central",
    state: "Nasarawa",
  });
  const sponsor = await EmpowermentOrganization.create({
    name: "Reparenting replay sponsor",
    organizationType: "NGO",
    createdBy: previous.aggregator._id,
    createdByRole: "AGENT",
    aggregatorId: previous.aggregator._id,
    stateManagerId: previous.stateManager._id,
    zonalManagerId: previous.zonalManager._id,
    status: "ACTIVE",
    verificationStatus: "VERIFIED",
  });
  const program = await EmpowermentProgram.create({
    organization: sponsor._id,
    name: "Reparenting replay program",
    state: previous.aggregator.state,
    amountPerBeneficiary: 100,
    targetBeneficiaries: 1,
    createdBy: previous.aggregator._id,
    createdByRole: "AGENT",
    aggregatorId: previous.aggregator._id,
    stateManagerId: previous.stateManager._id,
    zonalManagerId: previous.zonalManager._id,
    status: "APPROVED",
  });
  const selectedBeneficiary = new mongoose.Types.ObjectId();
  const fundingKey = "revoked-manager-funding-key";
  const disbursementKey = "revoked-manager-disbursement-key";
  const [funding] = await EmpowermentFunding.create([{
    organization: sponsor._id,
    program: program._id,
    fundedBy: previous.stateManager._id,
    amount: 100,
    reference: "REPLAY-FUNDING-REFERENCE",
    idempotencyKey: fundingKey,
  }]);
  const [disbursement] = await EmpowermentDisbursement.create([{
    organization: sponsor._id,
    program: program._id,
    batchReference: "REPLAY-DISBURSEMENT-REFERENCE",
    idempotencyKey: disbursementKey,
    beneficiaryCount: 1,
    amountPerBeneficiary: 100,
    totalAmount: 100,
    status: "COMPLETED",
    beneficiaryIds: [selectedBeneficiary],
    createdBy: previous.stateManager._id,
    metadata: { selectedBeneficiaryIds: [selectedBeneficiary] },
  }]);

  const priorManagerProgram = await call(empowerment.getProgram, {
    user: previous.stateManager,
    params: { programId: program._id },
  });
  assert.equal(priorManagerProgram.statusCode, 200);

  await User.updateOne(
    { _id: previous.aggregator._id },
    {
      $set: {
        stateManagerId: next.stateManager._id,
        zonalManagerId: next.zonalManager._id,
        state: next.stateManager.state,
        zone: next.stateManager.zone,
      },
    }
  );

  const revokedManagerProgram = await call(empowerment.getProgram, {
    user: previous.stateManager,
    params: { programId: program._id },
  });
  assert.equal(revokedManagerProgram.statusCode, 404);
  const fundingReplay = await call(empowerment.fundProgram, {
    user: previous.stateManager,
    params: { programId: program._id },
    body: { amount: 100 },
    headers: { "Idempotency-Key": fundingKey },
  });
  const disbursementReplay = await call(empowerment.disburseProgram, {
    user: previous.stateManager,
    params: { programId: program._id },
    body: { beneficiaryIds: [String(selectedBeneficiary)] },
    headers: { "Idempotency-Key": disbursementKey },
  });
  assert.equal(fundingReplay.statusCode, 403);
  assert.equal(disbursementReplay.statusCode, 403);
  assert.equal(fundingReplay.body.financials, undefined);
  assert.equal(disbursementReplay.body.financials, undefined);
  assert.equal(await EmpowermentFunding.countDocuments({ _id: funding._id }), 1);
  assert.equal(
    await EmpowermentDisbursement.countDocuments({ _id: disbursement._id }),
    1
  );
});

test("management snapshots are immutable and absent snapshots stay optional", () => {
  for (const model of [
    EmpowermentOrganization,
    EmpowermentProgram,
    Organization,
  ]) {
    for (const field of [
      "aggregatorId",
      "stateManagerId",
      "zonalManagerId",
      "createdByRole",
    ]) {
      assert.ok(model.schema.path(field), `${model.modelName}.${field}`);
      assert.equal(model.schema.path(field).options.immutable, true);
      assert.notEqual(model.schema.path(field).isRequired, true);
    }
  }
  const legacy = new EmpowermentOrganization({
    name: "Legacy Sponsor",
    organizationType: "NGO",
  });
  assert.equal(legacy.validateSync(), undefined);
  assert.equal(organizationService.normalizeKybInput({
    name: "Allowed",
    aggregatorId: "507f1f77bcf86cd799439011",
    stateManagerId: "507f1f77bcf86cd799439012",
    zonalManagerId: "507f1f77bcf86cd799439013",
  }).aggregatorId, undefined);
});