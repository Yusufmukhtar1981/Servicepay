const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const User = require("../models/user.model");
const Role = require("../models/role.model");
const Branch = require("../models/branch.model");
const EmpowermentOrganization = require(
  "../models/empowermentOrganization.model"
);
const EmpowermentAuditLog = require("../models/empowermentAuditLog.model");
const { STAFF_PERMISSIONS: P } = require("../config/staffPermissions");
const empowermentRoutes = require("../routes/empowerment.routes");
const managementRoutes = require("../routes/management.routes");
const managedRecordsRoutes = require("../routes/managedRecords.routes");
const { manageAccess } = require(
  "../middleware/empowermentAccess.middleware"
);

const testModels = [
  User,
  Role,
  Branch,
  EmpowermentOrganization,
  EmpowermentAuditLog,
];

let userSequence = 0;

const createUser = async (role, extra = {}) => {
  const suffix = String(++userSequence).padStart(7, "0");
  return User.create({
    fullName: `${role} ${suffix}`,
    phone: `081${suffix}`,
    email: `${role.toLowerCase()}-${suffix}@empowerment-access.test`,
    password: "empowerment-access-test-password",
    role,
    status: "ACTIVE",
    ...extra,
  });
};

const tokenFor = (user) =>
  jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET);

test(
  "original and managed Empowerment create routes share staff permission, branch and module admission",
  { timeout: 240_000 },
  async (t) => {
    const previousJwtSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "empowerment-access-disposable-secret";
    userSequence = 0;
    const mongo = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: "wiredTiger" },
    });
    let server;
    t.after(async () => {
      if (server) {
        server.closeAllConnections?.();
        await new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
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
      dbName: "empowerment-access-routes",
    });
    await Promise.all(testModels.map((model) => model.init()));

    const originalCreateRoute = empowermentRoutes.stack.find(
      (layer) =>
        layer.route?.path === "/organizations" &&
        layer.route.methods.post
    );
    const managedCreateRoute = managedRecordsRoutes.stack.find(
      (layer) =>
        layer.route?.path === "/empowerment/sponsors" &&
        layer.route.methods.post
    );
    assert.ok(originalCreateRoute);
    assert.ok(managedCreateRoute);
    assert.equal(originalCreateRoute.route.stack[0].handle, manageAccess);
    assert.equal(managedCreateRoute.route.stack[0].handle, manageAccess);

    const app = express();
    app.use(express.json());
    app.use("/api/empowerment", empowermentRoutes);
    app.use("/api/management", managementRoutes);
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
    const api = async ({ actor, path, body }) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${tokenFor(actor)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    };

    const headOffice = await createUser("HEAD_OFFICE");
    const makeBranch = (suffix, status, assignedModules) =>
      Branch.create({
        code: `EA-${suffix}`,
        name: `Empowerment Access ${suffix}`,
        status,
        assignedModules,
        createdBy: headOffice._id,
      });
    const makeStaff = async ({
      name,
      branch,
      permissions,
    }) => {
      const role = await Role.create({
        name: `EMPOWERMENT_ACCESS_${name}`,
        displayName: `Empowerment Access ${name}`,
        department: "OPERATIONS",
        scopeType: "BRANCH",
        permissions,
        status: "ACTIVE",
      });
      return createUser("STAFF", {
        isStaff: true,
        branchId: branch._id,
        staffRoleId: role._id,
        department: "OPERATIONS",
      });
    };

    const activeModuleBranch = await makeBranch(
      "PERMISSION",
      "ACTIVE",
      ["EMPOWERMENT"]
    );
    const noPermissionStaff = await makeStaff({
      name: "NO_PERMISSION",
      branch: activeModuleBranch,
      permissions: [],
    });
    const noModuleBranch = await makeBranch("NO_MODULE", "ACTIVE", []);
    const noModuleStaff = await makeStaff({
      name: "NO_MODULE",
      branch: noModuleBranch,
      permissions: [P.EMPOWERMENT_MANAGE],
    });
    const inactiveBranch = await makeBranch(
      "INACTIVE",
      "INACTIVE",
      ["EMPOWERMENT"]
    );
    const inactiveBranchStaff = await makeStaff({
      name: "INACTIVE_BRANCH",
      branch: inactiveBranch,
      permissions: [P.EMPOWERMENT_MANAGE],
    });
    const staffAgentRole = await Role.create({
      name: "EMPOWERMENT_ACCESS_AGENT_STAFF",
      displayName: "Empowerment Access Agent Staff",
      department: "OPERATIONS",
      scopeType: "BRANCH",
      permissions: [P.EMPOWERMENT_MANAGE],
      status: "ACTIVE",
    });
    const staffAgent = await createUser("AGENT", {
      isStaff: true,
      branchId: activeModuleBranch._id,
      staffRoleId: staffAgentRole._id,
      department: "OPERATIONS",
    });

    const createPaths = [
      "/api/empowerment/organizations",
      "/api/management/records/empowerment/sponsors",
    ];
    for (const actor of [
      noPermissionStaff,
      noModuleStaff,
      inactiveBranchStaff,
      staffAgent,
    ]) {
      for (const path of createPaths) {
        const response = await api({ actor, path, body: {} });
        assert.equal(response.status, 403, `${path}: ${JSON.stringify(response.body)}`);
        assert.equal(response.body.success, false);
      }
    }

    const zonalManager = await createUser("ZONAL_MANAGER", {
      zone: "Access Zone",
      state: "Lagos",
    });
    const stateManager = await createUser("STATE_MANAGER", {
      zone: "Access Zone",
      state: "Lagos",
      zonalManagerId: zonalManager._id,
    });
    const aggregator = await createUser("AGENT", {
      zone: "Access Zone",
      state: "Lagos",
      stateManagerId: stateManager._id,
      zonalManagerId: zonalManager._id,
    });
    const sponsorPayload = (suffix) => ({
      name: `Ordinary Aggregator ${suffix}`,
      organizationType: "NGO",
      registrationNumber: `AGENT-${suffix}`,
      contactName: "Aggregator Contact",
      phone: "08012345678",
      email: `aggregator-${suffix}@empowerment-access.test`,
      address: "1 Access Road",
      state: "Lagos",
    });
    const originalAgentCreate = await api({
      actor: aggregator,
      path: createPaths[0],
      body: sponsorPayload("ORIGINAL"),
    });
    const aliasAgentCreate = await api({
      actor: aggregator,
      path: createPaths[1],
      body: sponsorPayload("ALIAS"),
    });
    assert.equal(originalAgentCreate.status, 201, JSON.stringify(originalAgentCreate.body));
    assert.equal(aliasAgentCreate.status, 201, JSON.stringify(aliasAgentCreate.body));
    assert.equal(
      await EmpowermentOrganization.countDocuments({
        createdBy: aggregator._id,
        createdByRole: "AGENT",
      }),
      2
    );
  }
);