const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const User = require("../models/user.model");
const GroupWallet = require("../models/groupWallet.model");
const GroupContribution = require("../models/groupContribution.model");
const GroupWalletLedger = require("../models/groupWalletLedger.model");
const GroupWalletActivity = require("../models/groupWalletActivity.model");
const FeaturePayment = require("../models/featurePayment.model");
const Notification = require("../models/notification.model");
const controller = require("../controllers/servicepayFeatures.controller");

let mongo;
let sequence = 0;
const models = [
  User,
  GroupWallet,
  GroupContribution,
  GroupWalletLedger,
  GroupWalletActivity,
  FeaturePayment,
  Notification,
];

const call = async (handler, { user, body = {}, params = {}, headers = {} } = {}) => {
  const result = {};
  const res = {
    status(code) {
      result.status = code;
      return this;
    },
    json(payload) {
      result.status ??= 200;
      result.body = payload;
      return this;
    },
  };
  await handler({
    user,
    body,
    params,
    get(name) {
      return headers[String(name).toLowerCase()];
    },
  }, res);
  return result;
};

const createUser = async ({ walletBalance = 0 } = {}) => {
  sequence += 1;
  const user = await User.create({
    fullName: `Ajo Tester ${sequence}`,
    phone: `080811${String(sequence).padStart(5, "0")}`,
    email: `ajo-${sequence}@example.test`,
    password: "Password123!",
    role: "CUSTOMER",
    status: "ACTIVE",
    walletBalance,
  });
  await user.setTransactionPin("1234");
  await user.save();
  return user;
};

test.before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

test.beforeEach(async () => {
  await Promise.all(models.map((model) => model.deleteMany({})));
});

test("active members can see a group created by another customer", async () => {
  const leader = await createUser();
  const member = await createUser();
  const created = await call(controller.createGroup, {
    user: leader,
    body: { name: "Family Adashi", contributionAmount: 500, frequency: "MONTHLY" },
  });
  assert.equal(created.status, 201);

  const added = await call(controller.addGroupMember, {
    user: leader,
    params: { id: created.body.group._id.toString() },
    body: { phone: member.phone },
  });
  assert.equal(added.status, 200);

  const listed = await call(controller.myGroups, { user: member });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.groupsILead.length, 0);
  assert.equal(listed.body.groupsIBelongTo.length, 1);
  assert.equal(listed.body.groupsIBelongTo[0].isLeader, false);
  assert.equal(listed.body.groupsIBelongTo[0].members.length, 2);
});

test("legacy Adashi members with user and status fields remain visible and authorized", async () => {
  const leader = await createUser();
  const member = await createUser();
  const legacyId = new mongoose.Types.ObjectId();
  await GroupWallet.collection.insertOne({
    _id: legacyId,
    owner: leader._id,
    name: "Legacy Adashi",
    description: "Existing customer group",
    contributionAmount: 400,
    frequency: "MONTHLY",
    members: [{ user: member._id, phone: member.phone, status: "ACTIVE" }],
    totalCollected: 0,
    status: "ACTIVE",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const listed = await call(controller.myGroups, { user: member });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.groupsIBelongTo.length, 1);

  const details = await call(controller.getGroupDetails, {
    user: member,
    params: { id: legacyId.toString() },
  });
  assert.equal(details.status, 200);
  assert.equal(details.body.group.members[0].membershipStatus, "ACTIVE");
});

test("contribution atomically debits the wallet and credits the group ledger once", async () => {
  const leader = await createUser();
  const member = await createUser({ walletBalance: 1800 });
  const created = await call(controller.createGroup, {
    user: leader,
    body: { name: "Health Support", contributionAmount: 600, frequency: "MONTHLY" },
  });
  const groupId = created.body.group._id.toString();
  await call(controller.addGroupMember, {
    user: leader,
    params: { id: groupId },
    body: { phone: member.phone },
  });

  const first = await call(controller.contributeToGroup, {
    user: member,
    params: { id: groupId },
    body: { transactionPin: "1234", idempotencyKey: "member-one-month-one" },
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.groupBalance, 600);
  assert.equal(first.body.walletBalance, 1200);

  const duplicate = await call(controller.contributeToGroup, {
    user: member,
    params: { id: groupId },
    body: { transactionPin: "1234", idempotencyKey: "member-one-month-one" },
  });
  assert.equal(duplicate.status, 409);

  const changedKey = await call(controller.contributeToGroup, {
    user: member,
    params: { id: groupId },
    body: { transactionPin: "1234", idempotencyKey: "member-one-month-two" },
  });
  assert.equal(changedKey.status, 409);

  const [group, refreshedMember, contributions, ledger, payments] = await Promise.all([
    GroupWallet.findById(groupId),
    User.findById(member._id),
    GroupContribution.find({ group: groupId }),
    GroupWalletLedger.find({ group: groupId }),
    FeaturePayment.find({ sourceId: groupId }),
  ]);
  assert.equal(group.totalCollected, 600);
  assert.equal(refreshedMember.walletBalance, 1200);
  assert.equal(contributions.length, 1);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].balanceAfter, 600);
  assert.equal(payments.length, 1);
});

test("non-members cannot read a group's contribution history", async () => {
  const leader = await createUser();
  const outsider = await createUser();
  const created = await call(controller.createGroup, {
    user: leader,
    body: { name: "School Fees", contributionAmount: 1000, frequency: "WEEKLY" },
  });

  const history = await call(controller.groupContributions, {
    user: outsider,
    params: { id: created.body.group._id.toString() },
  });
  assert.equal(history.status, 404);
});