const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const uri = process.env.ORGANIZATION_TEST_MONGODB_URI;
const isolatedDbName = `sp_org_e11000_${process.pid}`;
if (isolatedDbName.length > 38 || !isolatedDbName.startsWith("sp_org_e11000_")) {
  throw new Error("Invalid isolated organization integration database name.");
}
const models = require("../models/organizations.models");
const User = require("../models/user.model");
const controller = require("../controllers/organizations.controller");
const service = require("../services/organizations.service");
const migrate = require("../scripts/migrateOrganizationMembers");

const response = () => {
  const result = {};
  return {
    result,
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; return body; },
  };
};
const reqFor = (organizationId, userId, body = {}) => ({
  params: { organizationId: String(organizationId) },
  user: { _id: userId },
  body,
});
const createUser = (suffix) => User.create({
  fullName: `Organization Test ${suffix}`,
  phone: `080900${String(suffix).padStart(5, "0")}`,
  email: `organization-test-${suffix}@example.invalid`,
  password: "not-a-production-password",
});

test("real Mongo organization membership concurrency and migration", {
  skip: !uri ? "Set ORGANIZATION_TEST_MONGODB_URI to run replica-set integration tests." : false,
  timeout: 30_000,
}, async () => {
  let connected = false;
  try {
    await mongoose.connect(uri, { dbName: isolatedDbName, serverSelectionTimeoutMS: 10_000, connectTimeoutMS: 10_000 });
    connected = true;
    const owner = await createUser("owner");
    const users = await Promise.all(["one", "two", "rejoin"].map(createUser));
    const org = await models.Organization.create({
      name: "Integration Organization",
      slug: `integration-${process.pid}`,
      code: `IT${process.pid}`,
      createdBy: owner._id,
      status: "VERIFIED",
      membershipMode: "MANUAL",
      registrationFee: 0,
    });

    // Seed the actual legacy sparse indexes and a null member before running
    // the production migration against this isolated database.
    const rawMembers = mongoose.connection.db.collection("organizationmembers");
    await rawMembers.insertOne({ organization: org._id, user: new mongoose.Types.ObjectId(), status: "PENDING", membershipNumber: null, year: 2020 });
    await rawMembers.createIndex({ membershipNumber: 1 }, { name: "membershipNumber_1" });
    await rawMembers.createIndex({ organization: 1, membershipNumber: 1 }, { name: "organization_1_membershipNumber_1", unique: true, sparse: true });
    await migrate();

    const firstTwo = await Promise.all(users.slice(0, 2).map((user) => {
      const res = response();
      return controller.apply(reqFor(org._id, user._id), res).then(() => res.result);
    }));
    assert.deepEqual(firstTwo.map((result) => result.status), [201, 201]);
    assert.equal(await models.OrganizationMember.countDocuments({ organization: org._id, status: "PENDING", membershipNumber: { $exists: false } }), 3);

    const duplicateAttempts = await Promise.all([1, 2].map(() => {
      const res = response();
      return controller.apply(reqFor(org._id, users[2]._id), res).then(() => res.result);
    }));
    assert.equal(duplicateAttempts.filter((result) => result.status === 201).length, 1);
    assert.equal(duplicateAttempts.filter((result) => result.status === 409).length, 1);
    assert.equal(duplicateAttempts.some((result) => /E11000|ObjectId/i.test(result.body?.message || "")), false);

    const pending = await models.OrganizationMember.find({ organization: org._id, status: "PENDING" }).limit(3);
    const approvalResults = await Promise.all(pending.slice(0, 2).map((member) => service.approveMember({ user: owner }, member)));
    assert.equal(new Set(approvalResults.map((member) => member.membershipNumber)).size, 2);
    assert.equal(await models.OrganizationMembershipCard.countDocuments({ organization: org._id }), 2);
    const sameMember = pending[2];
    const sameApproval = await Promise.allSettled([
      service.approveMember({ user: owner }, sameMember),
      service.approveMember({ user: owner }, sameMember),
    ]);
    assert.ok(sameApproval.every((item) => item.status === "fulfilled" || (item.reason?.status === 409 && !/E11000|ObjectId/i.test(item.reason.message))));
    const afterSame = await models.Organization.findById(org._id).lean();
    assert.equal(afterSame.membershipNumberSequence, 3);

    const autoOrg = await models.Organization.create({
      name: "Auto Integration Organization",
      slug: `auto-integration-${process.pid}`,
      code: `AT${process.pid}`,
      createdBy: owner._id,
      status: "VERIFIED",
      membershipMode: "AUTO",
      registrationFee: 0,
    });
    const autoResponse = response();
    await controller.apply(reqFor(autoOrg._id, users[0]._id), autoResponse);
    assert.equal(autoResponse.result.status, 201);
    const retryResponse = response();
    await controller.apply(reqFor(autoOrg._id, users[0]._id), retryResponse);
    assert.equal(retryResponse.result.status, 200);
    assert.equal(await models.OrganizationMember.countDocuments({ organization: autoOrg._id, status: "ACTIVE" }), 1);
    assert.equal(await models.OrganizationMembershipCard.countDocuments({ organization: autoOrg._id }), 1);

    const rerun = await migrate();
    assert.equal(rerun.unset, 0);
    assert.equal(rerun.activeBackfilled, 0);
    assert.equal(rerun.cardsCreated, 0);
    assert.equal(rerun.sequenceUpdates, 0);
  } finally {
    try {
      if (connected) {
        let timer;
        await Promise.race([
          mongoose.connection.dropDatabase(),
          new Promise((resolve) => {
            timer = setTimeout(resolve, 5_000);
            timer.unref?.();
          }),
        ]);
        if (timer) clearTimeout(timer);
      }
    } finally {
      if (connected || mongoose.connection.readyState !== 0) await mongoose.disconnect();
    }
  }
});