const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const User = require("../models/user.model");
const School = require("../models/edupaySchool.model");
const SchoolRequest = require("../models/edupaySchoolRequest.model");
const EduPayAuditLog = require("../models/edupayAuditLog.model");
const EmpowermentOrganization = require("../models/empowermentOrganization.model");
const EmpowermentProgram = require("../models/empowermentProgram.model");
const EmpowermentAuditLog = require("../models/empowermentAuditLog.model");
const organizationModels = require("../models/organizations.models");
const Role = require("../models/role.model");
const managementRoutes = require("../routes/management.routes");
const edupayRoutes = require("../routes/edupay.routes");
const adminEdupayRoutes = require("../routes/adminEdupay.routes");
const empowermentRoutes = require("../routes/empowerment.routes");
const adminOrganizationsRoutes = require("../routes/adminOrganizations.routes");

const { Organization, OrganizationRole, OrganizationWallet, OrganizationAuditLog } =
  organizationModels;

let userSequence = 0;
const nextSuffix = () => String(++userSequence).padStart(7, "0");

const databaseModels = [
  User,
  School,
  SchoolRequest,
  EduPayAuditLog,
  EmpowermentOrganization,
  EmpowermentProgram,
  EmpowermentAuditLog,
  Organization,
  OrganizationRole,
  OrganizationWallet,
  OrganizationAuditLog,
  Role,
];

const createUser = async (role, extra = {}) => {
  const suffix = nextSuffix();
  return User.create({
    fullName: `${role} ${suffix}`,
    phone: `080${suffix}`,
    email: `${role.toLowerCase()}-${suffix}@managed-records.test`,
    password: "managed-record-test-password",
    role,
    status: "ACTIVE",
    walletBalance: 321.45,
    ...extra,
  });
};

const tokenFor = (actor) =>
  jwt.sign({ id: String(actor._id) }, process.env.JWT_SECRET);

test(
  "managed-record routes enforce current hierarchy across real creation and existing APIs",
  { timeout: 240_000 },
  async (t) => {
    const previousJwtSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "managed-record-routes-disposable-secret";
    const mongo = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: "wiredTiger" },
    });
    let server;
    t.after(async () => {
      if (server) {
        server.closeAllConnections?.();
        await new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
      if (mongoose.connection.readyState) {
        await mongoose.connection.dropDatabase();
        await mongoose.disconnect();
      }
      await mongo.stop();
      if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousJwtSecret;
    });

    await mongoose.connect(mongo.getUri(), {
      dbName: "managed-record-routes-integration",
    });
    await Promise.all(databaseModels.map((model) => model.init()));

    const app = express();
    app.use(express.json());
    app.use("/api/management", managementRoutes);
    app.use("/api/edupay", edupayRoutes);
    app.use("/api/admin/edupay", adminEdupayRoutes);
    app.use("/api/empowerment", empowermentRoutes);
    app.use("/api/admin/organizations", adminOrganizationsRoutes);
    app.use((error, req, res, next) => {
      if (res.headersSent) return next(error);
      return res.status(error.status || 500).json({
        success: false,
        message: error.message || "Unexpected integration-test server error.",
      });
    });
    server = await new Promise((resolve) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const api = async ({ actor, path, method = "GET", body }) => {
      const headers = { Accept: "application/json" };
      if (actor) headers.Authorization = `Bearer ${tokenFor(actor)}`;
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    };

    const zoneA = "ZoneA";
    const zoneB = "ZoneB";
    const zonalA = await createUser("ZONAL_MANAGER", { fullName: "ZoneA Zonal", zone: zoneA });
    const zonalB = await createUser("ZONAL_MANAGER", { fullName: "ZoneB Zonal", zone: zoneB });
    const stateA1 = await createUser("STATE_MANAGER", {
      fullName: "StateA1",
      zone: zoneA,
      state: "Lagos",
      zonalManagerId: zonalA._id,
    });
    const stateA2 = await createUser("STATE_MANAGER", {
      fullName: "StateA2",
      zone: zoneA,
      state: "Ogun",
      zonalManagerId: zonalA._id,
    });
    const stateB = await createUser("STATE_MANAGER", {
      fullName: "StateB",
      zone: zoneB,
      state: "Kano",
      zonalManagerId: zonalB._id,
    });
    const agentA1 = await createUser("AGENT", {
      fullName: "AgentA1",
      zone: zoneA,
      state: "Lagos",
      stateManagerId: stateA1._id,
      zonalManagerId: zonalA._id,
    });
    const agentA2 = await createUser("AGENT", {
      fullName: "AgentA2",
      zone: zoneA,
      state: "Lagos",
      stateManagerId: stateA1._id,
      zonalManagerId: zonalA._id,
    });
    const agentA3 = await createUser("AGENT", {
      fullName: "AgentA3",
      zone: zoneA,
      state: "Ogun",
      stateManagerId: stateA2._id,
      zonalManagerId: zonalA._id,
    });
    const agentB = await createUser("AGENT", {
      fullName: "AgentB",
      zone: zoneB,
      state: "Kano",
      stateManagerId: stateB._id,
      zonalManagerId: zonalB._id,
    });
    const customerA = await createUser("CUSTOMER", {
      fullName: "ZoneA Customer",
      zone: zoneA,
      state: "Lagos",
      stateManagerId: stateA1._id,
      zonalManagerId: zonalA._id,
      agentId: agentA1._id,
    });
    const customerB = await createUser("CUSTOMER", {
      fullName: "ZoneB Customer",
      zone: zoneB,
      state: "Kano",
      stateManagerId: stateB._id,
      zonalManagerId: zonalB._id,
      agentId: agentB._id,
    });
    const headOffice = await createUser("HEAD_OFFICE", { fullName: "Head Office Reviewer" });

    const missingLineageAgent = await createUser("AGENT", {
      fullName: "Missing Lineage Agent",
      zone: zoneA,
      state: "Lagos",
    });
    const conflictingLineageAgent = await createUser("AGENT", {
      fullName: "Conflicting Lineage Agent",
      zone: zoneA,
      state: "Lagos",
      stateManagerId: stateA1._id,
      zonalManagerId: zonalB._id,
    });
    const suspendedAgent = await createUser("AGENT", {
      fullName: "Suspended Agent",
      zone: zoneA,
      state: "Lagos",
      stateManagerId: stateA1._id,
      zonalManagerId: zonalA._id,
      status: "SUSPENDED",
    });

    const managedRoles = [agentA1, agentA2, agentA3, agentB, stateA1, stateA2, stateB, zonalA, zonalB, headOffice];
    const originalRoleAndBalance = new Map(
      [zonalA, zonalB, stateA1, stateA2, stateB, agentA1, agentA2, agentA3, agentB, customerA, customerB, headOffice]
        .map((user) => [String(user._id), { role: user.role, walletBalance: user.walletBalance }]),
    );
    const roleCountBeforeRecords = await Role.countDocuments();
    const emptySummary = {
      success: true,
      counts: { schools: 0, empowerment: 0, organizations: 0 },
    };
    const assertSummaryContract = (response) => {
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(response.body.success, true, JSON.stringify(response.body));
      for (const key of ["schools", "empowerment", "organizations"]) {
        assert.equal(Number.isSafeInteger(response.body.counts?.[key]), true, JSON.stringify(response.body));
        assert.ok(response.body.counts[key] >= 0, JSON.stringify(response.body));
      }
      return response.body;
    };
    const summaryActors = [agentA1, agentA2, agentA3, agentB, stateA1, stateA2, stateB, zonalA, zonalB, headOffice];
    for (const actor of managedRoles) {
      const initial = await api({ actor, path: "/api/management/records/summary" });
      assert.deepEqual(assertSummaryContract(initial), emptySummary);
    }
    const captureSummaries = async () => {
      const summaries = new Map();
      for (const actor of summaryActors) {
        const response = await api({ actor, path: "/api/management/records/summary" });
        summaries.set(String(actor._id), assertSummaryContract(response));
      }
      return summaries;
    };

    const schoolName = "Managed [AgentA1] +* Academy";
    const schoolPayload = {
      schoolName,
      location: "Ikeja",
      state: "Lagos",
      schoolType: "PRIMARY",
      lga: "Ikeja",
      contactPerson: "School Representative",
      phone: "08012345001",
      email: "school-agent-a1@managed-records.test",
      registrationNumber: "MANAGED-A1-SCHOOL-001",
      authorizedRepresentative: "Authorized School Representative",
    };
    const conflictingBody = await api({
      actor: agentA1,
      path: "/api/management/records/schools",
      method: "POST",
      body: { ...schoolPayload, aggregatorId: agentA2._id },
    });
    assert.equal(conflictingBody.status, 409);
    assert.equal(await SchoolRequest.countDocuments(), 0);
    for (const [actor, path] of [
      [missingLineageAgent, "/api/management/records/schools"],
      [conflictingLineageAgent, "/api/management/records/schools"],
      [suspendedAgent, "/api/management/records/schools"],
      [customerA, "/api/management/records/schools"],
      [headOffice, "/api/management/records/schools"],
    ]) {
      const response = await api({ actor, path, method: "POST", body: schoolPayload });
      assert.ok([403, 409].includes(response.status), JSON.stringify(response.body));
      assert.equal(await SchoolRequest.countDocuments(), 0);
    }

    const recordDescriptors = [];
    const verifyRealRecord = async ({ id, section, kind, name, status, owners, outsiders, summaryBefore, reparentable = true, privateMarkers = [] }) => {
      assert.ok(id && name);
      const assertSafeDetails = (value) => {
        const serialized = JSON.stringify(value);
        for (const marker of privateMarkers) {
          assert.equal(serialized.includes(marker), false, `managed response leaked ${marker}`);
        }
        for (const field of [
          "bankDetails",
          "bankCredentials",
          "accountNumber",
          "encryptedAccountNumber",
          "storageKey",
          "documents",
          "representative",
          "privateNin",
        ]) {
          assert.equal(serialized.includes(field), false, `managed response included ${field}`);
        }
      };
      const search = encodeURIComponent(name);
      const statusListPath = `/api/management/records/${section}?search=${search}&status=${encodeURIComponent(status)}`;
      for (const actor of owners) {
        const list = await api({
          actor,
          path: `/api/management/records/${section}?search=${search}`,
        });
        assert.equal(list.status, 200, JSON.stringify(list.body));
        assert.equal(list.body.total, 1, JSON.stringify(list.body));
        assert.equal(String(list.body.items[0]._id), String(id));
        assert.equal(list.body.items[0].name, name);
        assert.equal(list.body.items[0].status, status);
        assertSafeDetails(list.body);

        const filtered = await api({ actor, path: statusListPath });
        assert.equal(filtered.status, 200, JSON.stringify(filtered.body));
        assert.equal(filtered.body.total, 1, JSON.stringify(filtered.body));
        assert.equal(String(filtered.body.items[0]._id), String(id));
        const wrongStatus = await api({
          actor,
          path: `/api/management/records/${section}?search=${search}&status=DOES_NOT_MATCH`,
        });
        assert.equal(wrongStatus.status, 200, JSON.stringify(wrongStatus.body));
        assert.equal(wrongStatus.body.total, 0);

        const detail = await api({
          actor,
          path: `/api/management/records/${section}/${id}?kind=${encodeURIComponent(kind)}`,
        });
        assert.equal(detail.status, 200, JSON.stringify(detail.body));
        assert.equal(String(detail.body.item._id), String(id));
        assert.equal(detail.body.item.kind, kind);
        assert.equal(detail.body.item.name, name);
        assertSafeDetails(detail.body);

        const summary = await api({ actor, path: "/api/management/records/summary" });
        const actualSummary = assertSummaryContract(summary);
        const expected = { ...summaryBefore.get(String(actor._id)) };
        expected.counts = { ...expected.counts, [section]: expected.counts[section] + 1 };
        assert.deepEqual(actualSummary, expected, `summary count for ${actor.role} / ${name}`);
      }

      for (const actor of outsiders) {
        const listing = await api({
          actor,
          path: `/api/management/records/${section}?search=${search}&status=${encodeURIComponent(status)}`,
        });
        if (actor.role === "CUSTOMER") {
          assert.equal(listing.status, 403, JSON.stringify(listing.body));
          const summary = await api({ actor, path: "/api/management/records/summary" });
          assert.equal(summary.status, 403, JSON.stringify(summary.body));
        } else {
          assert.equal(listing.status, 200, JSON.stringify(listing.body));
          assert.equal(listing.body.total, 0, JSON.stringify(listing.body));
          assert.equal(listing.body.items.length, 0);
          const before = summaryBefore.get(String(actor._id));
          const after = await api({ actor, path: "/api/management/records/summary" });
          assert.deepEqual(assertSummaryContract(after), before, `outside summary changed for ${actor.role} / ${name}`);
        }
        const detail = await api({
          actor,
          path: `/api/management/records/${section}/${id}?kind=${encodeURIComponent(kind)}`,
        });
        assert.equal(detail.status, 403, JSON.stringify(detail.body));
      }

      recordDescriptors.push({ id, section, kind, name, status, reparentable });
    };

    const schoolSummaryBefore = await captureSummaries();
    const schoolResponse = await api({
      actor: agentA1,
      path: "/api/management/records/schools",
      method: "POST",
      body: schoolPayload,
    });
    assert.equal(schoolResponse.status, 201, JSON.stringify(schoolResponse.body));
    const schoolRequest = await SchoolRequest.findOne({ schoolName }).lean();
    assert.ok(schoolRequest);
    assert.equal(schoolResponse.body.request.status, "PENDING_REVIEW");
    assert.equal(String(schoolRequest.parent), String(agentA1._id));
    assert.equal(String(schoolRequest.createdBy), String(agentA1._id));
    assert.equal(schoolRequest.createdByRole, "AGENT");
    assert.equal(String(schoolRequest.aggregatorId), String(agentA1._id));
    assert.equal(String(schoolRequest.stateManagerId), String(stateA1._id));
    assert.equal(String(schoolRequest.zonalManagerId), String(zonalA._id));
    assert.equal(await School.countDocuments(), 0);
    await SchoolRequest.collection.updateOne(
      { _id: schoolRequest._id },
      {
        $set: {
          privateTestBankCredentials: { accountNumber: "BANK_PRIVATE_TEST_SECRET" },
          supportingDocuments: [{ storageKey: "PRIVATE_SCHOOL_DOCUMENT_KEY" }],
        },
      },
    );
    const siblingDuplicate = await api({
      actor: agentA2,
      path: "/api/management/records/schools",
      method: "POST",
      body: schoolPayload,
    });
    assert.equal(siblingDuplicate.status, 409, JSON.stringify(siblingDuplicate.body));
    assert.equal(siblingDuplicate.body.code, "ACTIVE_SCHOOL_REQUEST_EXISTS");
    assert.equal(siblingDuplicate.body.request, undefined);
    const siblingConflictBody = JSON.stringify(siblingDuplicate.body);
    for (const privateValue of [
      schoolName,
      schoolPayload.contactPerson,
      schoolPayload.phone,
      schoolPayload.email,
      schoolPayload.authorizedRepresentative,
      "BANK_PRIVATE_TEST_SECRET",
      "PRIVATE_SCHOOL_DOCUMENT_KEY",
    ]) {
      assert.equal(siblingConflictBody.includes(privateValue), false, `sibling conflict leaked ${privateValue}`);
    }
    await verifyRealRecord({
      id: schoolRequest._id,
      section: "schools",
      kind: "school-request",
      name: schoolName,
      status: "PENDING_REVIEW",
      owners: [agentA1, stateA1, zonalA, headOffice],
      outsiders: [agentA2, agentA3, agentB, stateA2, stateB, zonalB, customerA, customerB],
      summaryBefore: schoolSummaryBefore,
      privateMarkers: ["BANK_PRIVATE_TEST_SECRET", "PRIVATE_SCHOOL_DOCUMENT_KEY"],
    });

    const sponsorBSummaryBefore = await captureSummaries();
    const sponsorBName = "Managed [AgentB] +* Sponsor";
    const sponsorBResponse = await api({
      actor: agentB,
      path: "/api/management/records/empowerment/sponsors",
      method: "POST",
      body: {
        name: sponsorBName,
        organizationType: "NGO",
        registrationNumber: "MANAGED-B-SPONSOR-001",
        contactName: "ZoneB Contact",
        phone: "08012345002",
        email: "sponsor-b@managed-records.test",
        address: "1 Kano Street",
        state: "Kano",
      },
    });
    assert.equal(sponsorBResponse.status, 201, JSON.stringify(sponsorBResponse.body));
    const sponsorB = await EmpowermentOrganization.findOne({ name: sponsorBName }).lean();
    assert.ok(sponsorB);
    assert.equal(sponsorB.status, "PENDING");
    assert.equal(sponsorB.verificationStatus, "PENDING_VERIFICATION");
    assert.equal(String(sponsorB.createdBy), String(agentB._id));
    assert.equal(sponsorB.createdByRole, "AGENT");
    assert.equal(String(sponsorB.aggregatorId), String(agentB._id));
    assert.equal(String(sponsorB.stateManagerId), String(stateB._id));
    assert.equal(String(sponsorB.zonalManagerId), String(zonalB._id));
    await EmpowermentOrganization.collection.updateOne(
      { _id: sponsorB._id },
      {
        $set: {
          bankCredentials: "BANK_PRIVATE_TEST_SECRET",
          privateNin: "12345678901",
          documents: [{ storageKey: "PRIVATE_SPONSOR_DOCUMENT_KEY" }],
        },
      },
    );
    await verifyRealRecord({
      id: sponsorB._id,
      section: "empowerment",
      kind: "sponsor",
      name: sponsorBName,
      status: "PENDING",
      owners: [agentB, stateB, zonalB, headOffice],
      outsiders: [agentA1, agentA2, agentA3, stateA1, stateA2, zonalA, customerA, customerB],
      summaryBefore: sponsorBSummaryBefore,
      reparentable: false,
      privateMarkers: ["BANK_PRIVATE_TEST_SECRET", "12345678901", "PRIVATE_SPONSOR_DOCUMENT_KEY"],
    });

    const sponsorASummaryBefore = await captureSummaries();
    const sponsorAName = "Managed [AgentA1] +* Sponsor";
    const sponsorAResponse = await api({
      actor: agentA1,
      path: "/api/management/records/empowerment/sponsors",
      method: "POST",
      body: {
        name: sponsorAName,
        organizationType: "NGO",
        registrationNumber: "MANAGED-A1-SPONSOR-001",
        contactName: "ZoneA Contact",
        phone: "08012345003",
        email: "sponsor-a1@managed-records.test",
        address: "1 Lagos Street",
        state: "Lagos",
      },
    });
    assert.equal(sponsorAResponse.status, 201, JSON.stringify(sponsorAResponse.body));
    const sponsorA = await EmpowermentOrganization.findOne({ name: sponsorAName }).lean();
    assert.ok(sponsorA);
    assert.equal(sponsorA.status, "PENDING");
    assert.equal(sponsorA.verificationStatus, "PENDING_VERIFICATION");
    assert.equal(String(sponsorA.createdBy), String(agentA1._id));
    assert.equal(sponsorA.createdByRole, "AGENT");
    assert.equal(String(sponsorA.aggregatorId), String(agentA1._id));
    assert.equal(String(sponsorA.stateManagerId), String(stateA1._id));
    assert.equal(String(sponsorA.zonalManagerId), String(zonalA._id));
    await EmpowermentOrganization.collection.updateOne(
      { _id: sponsorA._id },
      {
        $set: {
          bankCredentials: "BANK_PRIVATE_TEST_SECRET",
          privateNin: "12345678901",
          documents: [{ storageKey: "PRIVATE_SPONSOR_DOCUMENT_KEY" }],
        },
      },
    );
    await verifyRealRecord({
      id: sponsorA._id,
      section: "empowerment",
      kind: "sponsor",
      name: sponsorAName,
      status: "PENDING",
      owners: [agentA1, stateA1, zonalA, headOffice],
      outsiders: [agentA2, agentA3, agentB, stateA2, stateB, zonalB, customerA, customerB],
      summaryBefore: sponsorASummaryBefore,
      privateMarkers: ["BANK_PRIVATE_TEST_SECRET", "12345678901", "PRIVATE_SPONSOR_DOCUMENT_KEY"],
    });

    const organizationSummaryBefore = await captureSummaries();
    const organizationName = "Managed [AgentA1] +* KYB Organization";
    const organizationPayload = {
      name: organizationName,
      organizationType: "NGO",
      registrationStatus: "UNREGISTERED",
      dateEstablished: "2020-01-01",
      description: "A community organization submitting a draft KYB profile.",
      industry: "Education",
      organizationEmail: "kyb-agent-a1@managed-records.test",
      organizationPhone: "08012345004",
      officeAddress: {
        address: "1 Ikeja Road",
        state: "Lagos",
        lga: "Ikeja",
        city: "Ikeja",
      },
      representative: {
        fullName: "Private KYB Representative",
        role: "Director",
        phone: "08012345005",
        email: "representative@managed-records.test",
        nin: "12345678901",
        residentialAddress: { address: "2 Ikeja Road", city: "Ikeja" },
      },
      state: "Lagos",
      lga: "Ikeja",
    };
    const organizationResponse = await api({
      actor: agentA1,
      path: "/api/management/records/organizations",
      method: "POST",
      body: organizationPayload,
    });
    assert.equal(organizationResponse.status, 201, JSON.stringify(organizationResponse.body));
    const organization = await Organization.findOne({ name: organizationName }).select("+representative.nin").lean();
    assert.ok(organization);
    assert.equal(organization.status, "DRAFT");
    assert.equal(String(organization.createdBy), String(agentA1._id));
    assert.equal(organization.createdByRole, "AGENT");
    assert.equal(String(organization.aggregatorId), String(agentA1._id));
    assert.equal(String(organization.stateManagerId), String(stateA1._id));
    assert.equal(String(organization.zonalManagerId), String(zonalA._id));
    assert.equal(organization.representative.nin, "12345678901");
    await Organization.collection.updateOne(
      { _id: organization._id },
      {
        $set: {
          documents: [{ name: "Private KYB file", storageKey: "PRIVATE_KYB_DOCUMENT_KEY" }],
          "representative.nin": "12345678901",
          bankCredentials: "BANK_PRIVATE_TEST_SECRET",
        },
      },
    );
    await verifyRealRecord({
      id: organization._id,
      section: "organizations",
      kind: "organization",
      name: organizationName,
      status: "DRAFT",
      owners: [agentA1, stateA1, zonalA, headOffice],
      outsiders: [agentA2, agentA3, agentB, stateA2, stateB, zonalB, customerA, customerB],
      summaryBefore: organizationSummaryBefore,
      privateMarkers: [
        "BANK_PRIVATE_TEST_SECRET",
        "12345678901",
        "PRIVATE_KYB_DOCUMENT_KEY",
        "Private KYB Representative",
      ],
    });

    const ownUnverifiedProgram = await api({
      actor: agentA1,
      path: "/api/management/records/empowerment/programs",
      method: "POST",
      body: {
        organizationId: String(sponsorA._id),
        name: "Must Wait For Verification",
        amountPerBeneficiary: 100,
        targetBeneficiaries: 5,
        state: "Lagos",
      },
    });
    assert.equal(ownUnverifiedProgram.status, 409, JSON.stringify(ownUnverifiedProgram.body));
    const otherAgentUnverifiedProgram = await api({
      actor: agentA1,
      path: "/api/management/records/empowerment/programs",
      method: "POST",
      body: {
        organizationId: String(sponsorB._id),
        name: "Must Not Borrow AgentB Sponsor",
        amountPerBeneficiary: 100,
        targetBeneficiaries: 5,
        state: "Lagos",
      },
    });
    assert.equal(otherAgentUnverifiedProgram.status, 403, JSON.stringify(otherAgentUnverifiedProgram.body));
    assert.equal(await EmpowermentProgram.countDocuments(), 0);

    await EmpowermentOrganization.collection.updateOne(
      { _id: sponsorA._id },
      { $set: { status: "ACTIVE", verificationStatus: "VERIFIED" } },
    );
    await EmpowermentOrganization.collection.updateOne(
      { _id: sponsorB._id },
      { $set: { status: "ACTIVE", verificationStatus: "VERIFIED" } },
    );
    const otherAgentVerifiedProgram = await api({
      actor: agentA1,
      path: "/api/management/records/empowerment/programs",
      method: "POST",
      body: {
        organizationId: String(sponsorB._id),
        name: "Must Not Borrow Verified AgentB Sponsor",
        amountPerBeneficiary: 100,
        targetBeneficiaries: 5,
        state: "Lagos",
      },
    });
    assert.equal(otherAgentVerifiedProgram.status, 403, JSON.stringify(otherAgentVerifiedProgram.body));
    assert.equal(await EmpowermentProgram.countDocuments(), 0);

    const programSummaryBefore = await captureSummaries();
    const programName = "Managed [AgentA1] +* Program";
    const programResponse = await api({
      actor: agentA1,
      path: "/api/management/records/empowerment/programs",
      method: "POST",
      body: {
        organizationId: String(sponsorA._id),
        name: programName,
        description: "A draft grant with no financial activity.",
        amountPerBeneficiary: 100,
        targetBeneficiaries: 5,
        state: "Lagos",
        status: "OPEN",
      },
    });
    assert.equal(programResponse.status, 201, JSON.stringify(programResponse.body));
    const program = await EmpowermentProgram.findOne({ name: programName }).lean();
    assert.ok(program);
    assert.equal(program.status, "DRAFT");
    assert.equal(String(program.organization), String(sponsorA._id));
    assert.equal(String(program.createdBy), String(agentA1._id));
    assert.equal(program.createdByRole, "AGENT");
    assert.equal(String(program.aggregatorId), String(agentA1._id));
    assert.equal(String(program.stateManagerId), String(stateA1._id));
    assert.equal(String(program.zonalManagerId), String(zonalA._id));
    assert.equal(program.totalBudget, 500);
    assert.equal(program.availableFundingAmount, 0);
    assert.equal(program.totalFundedAmount, 0);
    assert.equal(program.totalDisbursedAmount, 0);
    await verifyRealRecord({
      id: program._id,
      section: "empowerment",
      kind: "program",
      name: programName,
      status: "DRAFT",
      owners: [agentA1, stateA1, zonalA, headOffice],
      outsiders: [agentA2, agentA3, agentB, stateA2, stateB, zonalB, customerA, customerB],
      summaryBefore: programSummaryBefore,
    });

    const unauthorizedUnverified = await api({
      actor: customerA,
      path: "/api/management/records/organizations",
      method: "POST",
      body: organizationPayload,
    });
    assert.equal(unauthorizedUnverified.status, 403);

    // Existing customer onboarding still works, but client-submitted lineage is
    // ignored and cannot make a customer request appear Agent-owned.
    const customerRequestResponse = await api({
      actor: customerA,
      path: "/api/edupay/school-requests",
      method: "POST",
      body: {
        schoolName: "Customer [Spoof] Request",
        location: "Ikeja",
        contactPhone: "08012345006",
        aggregatorId: agentA1._id,
        stateManagerId: stateA1._id,
        zonalManagerId: zonalA._id,
        createdBy: agentA1._id,
        createdByRole: "AGENT",
      },
    });
    assert.equal(customerRequestResponse.status, 201, JSON.stringify(customerRequestResponse.body));
    const customerRequest = await SchoolRequest.findOne({ schoolName: "Customer [Spoof] Request" }).lean();
    assert.ok(customerRequest);
    assert.equal(customerRequest.createdBy, null);
    assert.equal(String(customerRequest.parent), String(customerA._id));
    assert.equal(customerRequest.createdByRole, null);
    assert.equal(customerRequest.aggregatorId, null);
    assert.equal(customerRequest.stateManagerId, null);
    assert.equal(customerRequest.zonalManagerId, null);
    const agentDoesNotAdmitCustomerRequest = await api({
      actor: agentA1,
      path: `/api/management/records/schools?search=${encodeURIComponent(customerRequest.schoolName)}`,
    });
    assert.equal(agentDoesNotAdmitCustomerRequest.status, 200);
    assert.equal(agentDoesNotAdmitCustomerRequest.body.total, 0);

    // The original global admin endpoints still see records from both current
    // reporting trees; managed routes remain the scoped surface.
    const adminSchoolRequests = await api({
      actor: headOffice,
      path: "/api/admin/edupay/school-requests",
    });
    assert.equal(adminSchoolRequests.status, 200, JSON.stringify(adminSchoolRequests.body));
    const adminSchoolRows = JSON.stringify(adminSchoolRequests.body);
    assert.equal(adminSchoolRows.includes(schoolName), true);
    assert.equal(adminSchoolRows.includes(customerRequest.schoolName), true);

    const adminSponsors = await api({
      actor: headOffice,
      path: `/api/empowerment/organizations?search=${encodeURIComponent("Managed")}`,
    });
    assert.equal(adminSponsors.status, 200, JSON.stringify(adminSponsors.body));
    const adminSponsorRows = JSON.stringify(adminSponsors.body);
    assert.equal(adminSponsorRows.includes(sponsorAName), true);
    assert.equal(adminSponsorRows.includes(sponsorBName), true);

    const adminOrganizations = await api({
      actor: headOffice,
      path: "/api/admin/organizations",
    });
    assert.equal(adminOrganizations.status, 200, JSON.stringify(adminOrganizations.body));
    assert.equal(JSON.stringify(adminOrganizations.body).includes(organizationName), true);

    // Review the real pending request through the existing protected Admin
    // route and verify the approved School inherits immutable request lineage.
    const approval = await api({
      actor: headOffice,
      path: `/api/admin/edupay/school-requests/${schoolRequest._id}`,
      method: "PATCH",
      body: { action: "APPROVE", representativeAuthorityConfirmed: true },
    });
    assert.equal(approval.status, 200, JSON.stringify(approval.body));
    const approvedSchool = await School.findOne({ sourceRequest: schoolRequest._id }).lean();
    assert.ok(approvedSchool);
    assert.equal(approvedSchool.status, "APPROVED");
    assert.equal(approvedSchool.active, true);
    assert.equal(String(approvedSchool.sourceRequest), String(schoolRequest._id));
    assert.equal(String(approvedSchool.createdBy), String(agentA1._id));
    assert.equal(approvedSchool.createdByRole, "AGENT");
    assert.equal(String(approvedSchool.aggregatorId), String(agentA1._id));
    assert.equal(String(approvedSchool.stateManagerId), String(stateA1._id));
    assert.equal(String(approvedSchool.zonalManagerId), String(zonalA._id));
    assert.equal(approvedSchool.portalUser, null);
    const schoolRequestDescriptor = recordDescriptors.find(
      (descriptor) => String(descriptor.id) === String(schoolRequest._id),
    );
    assert.ok(schoolRequestDescriptor);
    schoolRequestDescriptor.approvedSchoolId = approvedSchool._id;
    const approvedSchoolDetail = await api({
      actor: stateA1,
      path: `/api/management/records/schools/${approvedSchool._id}?kind=school`,
    });
    assert.equal(approvedSchoolDetail.status, 200, JSON.stringify(approvedSchoolDetail.body));
    assert.equal(approvedSchoolDetail.body.item.status, "APPROVED");
    assert.equal(JSON.stringify(approvedSchoolDetail.body).includes("bankDetails"), false);
    assert.equal(JSON.stringify(approvedSchoolDetail.body).includes("supportingDocuments"), false);

    // Reuse the genuine route-created sponsor as a pre-migration legacy row:
    // it retains an AGENT creator but has no aggregator or manager snapshots.
    // This exercises current-creator fallback through the real read routes.
    await EmpowermentOrganization.collection.updateOne(
      { _id: sponsorA._id },
      {
        $unset: {
          aggregatorId: "",
          stateManagerId: "",
          zonalManagerId: "",
        },
      },
    );
    const legacyAgentSponsor = await EmpowermentOrganization.collection.findOne({ _id: sponsorA._id });
    assert.equal(String(legacyAgentSponsor.createdBy), String(agentA1._id));
    assert.equal(legacyAgentSponsor.aggregatorId, undefined);
    assert.equal(legacyAgentSponsor.stateManagerId, undefined);
    assert.equal(legacyAgentSponsor.zonalManagerId, undefined);

    // Reparent only this disposable Agent row. Old persisted record snapshots
    // must not grant stale State/Zonal Manager access after the live move.
    const newZonalA = await createUser("ZONAL_MANAGER", {
      fullName: "ZoneA Reparented Zonal",
      zone: "ZoneA-Reparented",
    });
    const newStateA1 = await createUser("STATE_MANAGER", {
      fullName: "StateA1 Reparented",
      zone: "ZoneA-Reparented",
      state: "Lagos",
      zonalManagerId: newZonalA._id,
    });
    await User.updateOne(
      { _id: agentA1._id },
      {
        $set: {
          zone: "ZoneA-Reparented",
          stateManagerId: newStateA1._id,
          zonalManagerId: newZonalA._id,
        },
      },
    );
    for (const descriptor of recordDescriptors.filter((record) => record.reparentable)) {
      const { id, section, kind, name } = descriptor;
      const oldManagerList = await api({
        actor: stateA1,
        path: `/api/management/records/${section}?search=${encodeURIComponent(name)}`,
      });
      assert.equal(oldManagerList.status, 200, JSON.stringify(oldManagerList.body));
      assert.equal(oldManagerList.body.total, 0, `${name} remained with old State Manager`);
      const oldManagerDetail = await api({
        actor: stateA1,
        path: `/api/management/records/${section}/${id}?kind=${encodeURIComponent(kind)}`,
      });
      assert.equal(oldManagerDetail.status, 403, JSON.stringify(oldManagerDetail.body));
      const oldZonalList = await api({
        actor: zonalA,
        path: `/api/management/records/${section}?search=${encodeURIComponent(name)}`,
      });
      assert.equal(oldZonalList.status, 200, JSON.stringify(oldZonalList.body));
      assert.equal(oldZonalList.body.total, 0, `${name} remained with old Zonal Manager`);
      const oldZonalDetail = await api({
        actor: zonalA,
        path: `/api/management/records/${section}/${id}?kind=${encodeURIComponent(kind)}`,
      });
      assert.equal(oldZonalDetail.status, 403, JSON.stringify(oldZonalDetail.body));

      for (const actor of [agentA1, newStateA1, newZonalA, headOffice]) {
        const visible = await api({
          actor,
          path: `/api/management/records/${section}?search=${encodeURIComponent(name)}`,
        });
        assert.equal(visible.status, 200, JSON.stringify(visible.body));
        assert.equal(visible.body.total, 1, `${name} missing from current reporting line`);
        assert.equal(
          String(visible.body.items[0]._id),
          String(descriptor.approvedSchoolId || id),
        );
        const detail = await api({
          actor,
          path: `/api/management/records/${section}/${id}?kind=${encodeURIComponent(kind)}`,
        });
        assert.equal(detail.status, 200, JSON.stringify(detail.body));
        if (descriptor.approvedSchoolId) {
          const approvedDetail = await api({
            actor,
            path: `/api/management/records/schools/${descriptor.approvedSchoolId}?kind=school`,
          });
          assert.equal(approvedDetail.status, 200, JSON.stringify(approvedDetail.body));
        }
      }
      if (descriptor.approvedSchoolId) {
        for (const actor of [stateA1, zonalA]) {
          const approvedDetail = await api({
            actor,
            path: `/api/management/records/schools/${descriptor.approvedSchoolId}?kind=school`,
          });
          assert.equal(approvedDetail.status, 403, JSON.stringify(approvedDetail.body));
        }
      }
    }

    const storedSchoolRequest = await SchoolRequest.findById(schoolRequest._id).lean();
    const storedProgram = await EmpowermentProgram.findById(program._id).lean();
    const storedOrganization = await Organization.findById(organization._id).lean();
    for (const stored of [storedSchoolRequest, storedProgram, storedOrganization]) {
      assert.equal(String(stored.aggregatorId), String(agentA1._id));
      assert.equal(String(stored.stateManagerId), String(stateA1._id));
      assert.equal(String(stored.zonalManagerId), String(zonalA._id));
    }
    const approvedSchoolAfterReparent = await School.findById(approvedSchool._id).lean();
    assert.equal(String(approvedSchoolAfterReparent.aggregatorId), String(agentA1._id));
    assert.equal(String(approvedSchoolAfterReparent.stateManagerId), String(stateA1._id));
    assert.equal(String(approvedSchoolAfterReparent.zonalManagerId), String(zonalA._id));
    const legacySponsorAfterReparent = await EmpowermentOrganization.collection.findOne({ _id: sponsorA._id });
    assert.equal(String(legacySponsorAfterReparent.createdBy), String(agentA1._id));
    assert.equal(legacySponsorAfterReparent.aggregatorId, undefined);
    assert.equal(legacySponsorAfterReparent.stateManagerId, undefined);
    assert.equal(legacySponsorAfterReparent.zonalManagerId, undefined);

    assert.equal(await Role.countDocuments(), roleCountBeforeRecords);
    for (const user of [zonalA, zonalB, stateA1, stateA2, stateB, agentA1, agentA2, agentA3, agentB, customerA, customerB, headOffice]) {
      const saved = await User.findById(user._id).select("+authTokenVersion").lean();
      const original = originalRoleAndBalance.get(String(user._id));
      assert.equal(saved.role, original.role);
      assert.equal(saved.walletBalance, original.walletBalance);
    }
  },
);