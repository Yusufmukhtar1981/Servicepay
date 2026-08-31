const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const Role = require("../models/role.model");
const User = require("../models/user.model");
const AdminAuditLog = require("../models/adminAuditLog.model");
const { updateRole } = require("../controllers/staffManagement.controller");
const { STAFF_PERMISSIONS: P } = require("../config/staffPermissions");

let mongo;
let sequence = 0;

test.before(async () => {
  mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  await mongoose.connect(mongo.getUri(), { dbName: "staff-role-update-tests" });
  await Promise.all([Role.init(), User.init(), AdminAuditLog.init()]);
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

test.beforeEach(async () => {
  sequence += 1;
  await Promise.all([
    Role.collection.deleteMany({}),
    User.collection.deleteMany({}),
    AdminAuditLog.collection.deleteMany({}),
  ]);
});

const request = (roleId, body) => ({
  params: { roleId },
  body,
  user: {
    _id: new mongoose.Types.ObjectId(),
    role: "HEAD_OFFICE",
    fullName: "Role Test Administrator",
  },
  staffAccess: { isHeadOffice: true, permissions: ["*"] },
  ip: "127.0.0.1",
  headers: { "user-agent": "staff-role-update-test" },
  method: "PUT",
  originalUrl: `/api/staff/roles/${roleId}`,
});

const callUpdateRole = async (roleId, body) => {
  const result = {};
  const res = {
    status(code) {
      result.status = code;
      return this;
    },
    json(responseBody) {
      result.body = responseBody;
      return this;
    },
  };
  await updateRole(request(roleId, body), res);
  return result;
};

const createStaff = (roleId, suffix) => User.create({
  fullName: `Role Test Staff ${suffix}`,
  phone: `080000${String(sequence).padStart(4, "0")}${suffix}`,
  email: `staff-${sequence}-${suffix}@example.test`,
  password: "password123",
  role: "STAFF",
  status: "ACTIVE",
  isStaff: true,
  staffId: `SP-STF-${sequence}-${suffix}`,
  staffRoleId: roleId,
  department: "OPERATIONS",
  authTokenVersion: 4,
});

test("role permission and status changes invalidate assigned staff tokens with the matching audit event", async () => {
  const role = await Role.create({
    name: `ROLE_TEST_${sequence}`,
    displayName: "Role Update Test",
    department: "OPERATIONS",
    permissions: [P.USERS_VIEW],
    status: "ACTIVE",
  });
  const [firstStaff, secondStaff] = await Promise.all([
    createStaff(role._id, 1),
    createStaff(role._id, 2),
  ]);

  const permissionResponse = await callUpdateRole(role._id, {
    permissions: [P.USERS_VIEW, P.USERS_UPDATE],
  });

  assert.equal(permissionResponse.status, 200);
  assert.equal(permissionResponse.body.role.permissions.includes(P.USERS_UPDATE), true);
  const afterPermissionChange = await User.find({
    _id: { $in: [firstStaff._id, secondStaff._id] },
  }).select("+authTokenVersion").lean();
  assert.deepEqual(
    afterPermissionChange.map((staff) => staff.authTokenVersion).sort(),
    [5, 5]
  );
  assert.equal(
    await AdminAuditLog.countDocuments({ action: "ROLE_PERMISSIONS_CHANGED", "metadata.roleId": role._id }),
    1
  );

  const statusResponse = await callUpdateRole(role._id, { status: "INACTIVE" });

  assert.equal(statusResponse.status, 200);
  const afterStatusChange = await User.find({
    _id: { $in: [firstStaff._id, secondStaff._id] },
  }).select("+authTokenVersion").lean();
  assert.deepEqual(
    afterStatusChange.map((staff) => staff.authTokenVersion).sort(),
    [6, 6]
  );
  assert.equal(
    await AdminAuditLog.countDocuments({ action: "ROLE_STATUS_CHANGED", "metadata.roleId": role._id }),
    1
  );
});

test("role permission changes roll back when their audit event cannot be written", async () => {
  const role = await Role.create({
    name: `ROLE_ROLLBACK_${sequence}`,
    displayName: "Role Rollback Test",
    department: "OPERATIONS",
    permissions: [P.USERS_VIEW],
    status: "ACTIVE",
  });
  const staff = await createStaff(role._id, 3);
  const originalCreate = AdminAuditLog.create;
  AdminAuditLog.create = async () => {
    throw new Error("audit storage unavailable");
  };

  try {
    const response = await callUpdateRole(role._id, {
      permissions: [P.USERS_VIEW, P.USERS_UPDATE],
    });

    assert.equal(response.status, 500);
    assert.deepEqual((await Role.findById(role._id).lean()).permissions, [P.USERS_VIEW]);
    assert.equal(
      (await User.findById(staff._id).select("+authTokenVersion").lean()).authTokenVersion,
      4
    );
    assert.equal(await AdminAuditLog.countDocuments({}), 0);
  } finally {
    AdminAuditLog.create = originalCreate;
  }
});