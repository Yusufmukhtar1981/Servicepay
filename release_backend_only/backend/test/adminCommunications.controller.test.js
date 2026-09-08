const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const User = require("../models/user.model");
const Notification = require("../models/notification.model");
const Campaign = require("../models/communicationCampaign.model");
const Recipient = require("../models/communicationRecipient.model");
const communications = require("../controllers/adminCommunications.controller");
const { processCampaign } = require("../services/communicationCampaign.service");

let mongo;
let sequence = 0;
let customerSequence = 0;
const models = [User, Notification, Campaign, Recipient];

const admin = () => ({
  _id: new mongoose.Types.ObjectId(),
  role: "HEAD_OFFICE",
  fullName: "Head Office",
  email: "head-office@servicepay.test",
});
const request = (body = {}, query = {}, params = {}) => ({
  user: admin(), body, query, params,
});
const call = async (handler, body, query, params) => {
  const result = { status: 200 };
  const res = {
    status(code) { result.status = code; return this; },
    json(payload) { result.body = payload; return this; },
  };
  await handler(request(body, query, params), res);
  return result;
};
const customer = (overrides = {}) => User.create({
  fullName: `Customer ${++customerSequence}`,
  phone: `080${String(customerSequence).padStart(8, "0")}`,
  email: `customer${customerSequence}@servicepay.test`,
  password: "Passw0rd!",
  role: "CUSTOMER",
  status: "ACTIVE",
  ...overrides,
});

test.before(async () => {
  mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  await mongoose.connect(mongo.getUri(), { dbName: "communications-tests" });
  await Promise.all(models.map((model) => model.init()));
});
test.after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
test.beforeEach(async () => {
  sequence += 1;
  await Promise.all(models.map((model) => model.deleteMany({})));
});

test("audience preview resolves only active customer accounts server-side", async () => {
  await customer({ status: "ACTIVE" });
  await customer({ status: "SUSPENDED" });
  await customer({ role: "STAFF" });
  const result = await call(communications.previewAudience, {
    channel: "IN_APP",
    audience: { kind: "ACTIVE_CUSTOMERS", count: 99999 },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.count, 1);
});

test("in-app broadcast returns 202 with pending snapshots, then completes idempotently", async () => {
  const first = await customer();
  const second = await customer();
  const body = {
    title: "Maintenance",
    message: "A short maintenance window is planned.",
    audience: { kind: "SELECTED_CUSTOMERS", userIds: [first._id, second._id] },
    idempotencyKey: "notification-campaign-1",
  };
  const created = await call(communications.broadcastNotifications, body);
  assert.equal(created.status, 202);
  assert.equal(created.body.campaign.status, "PROCESSING");
  assert.equal(await Recipient.countDocuments({ outcome: "PENDING" }), 2);
  const duplicateWhilePending = await call(communications.broadcastNotifications, body);
  assert.equal(duplicateWhilePending.status, 202);
  assert.equal(duplicateWhilePending.body.duplicate, true);
  assert.equal(duplicateWhilePending.body.campaign.status, "PROCESSING");
  await processCampaign(created.body.campaign.id);
  const completed = await Campaign.findById(created.body.campaign.id);
  assert.equal(completed.status, "COMPLETED");
  assert.equal(completed.deliveredCount, 2);
  assert.equal(await Notification.countDocuments({}), 2);
  assert.equal(await Recipient.countDocuments({}), 2);

  const duplicate = await call(communications.broadcastNotifications, body);
  assert.equal(duplicate.status, 202);
  assert.equal(duplicate.body.duplicate, true);
  assert.equal(duplicate.body.campaign.status, "COMPLETED");
  assert.equal(await Notification.countDocuments({}), 2);
});

test("broadcast rejects every audience that resolves above 500 recipients", async () => {
  await User.insertMany(Array.from({ length: 501 }, (_, index) => ({
    fullName: `Bulk Customer ${index}`,
    phone: `081${String(index).padStart(8, "0")}`,
    email: `bulk-${index}@servicepay.test`,
    password: "Passw0rd!",
    role: "CUSTOMER",
    status: "ACTIVE",
  })));
  const result = await call(communications.broadcastNotifications, {
    title: "Maintenance",
    message: "The service will be unavailable briefly.",
    audience: { kind: "ALL_CUSTOMERS" },
    idempotencyKey: "over-cap",
  });
  assert.equal(result.status, 400);
  assert.match(result.body.message, /maximum of 500 recipients/i);
  assert.equal(await Campaign.countDocuments({}), 0);
});

test("broadcast transaction rolls back campaign when recipient snapshot insertion fails", async () => {
  const selected = await customer();
  const originalInsertMany = Recipient.insertMany;
  Recipient.insertMany = async () => {
    throw new Error("snapshot insertion failed");
  };
  try {
    const result = await call(communications.broadcastNotifications, {
      title: "Maintenance",
      message: "A short maintenance window is planned.",
      audience: { kind: "SELECTED_CUSTOMERS", userIds: [selected._id] },
      idempotencyKey: "rollback-recipient-snapshot",
    });
    assert.equal(result.status, 400);
    assert.match(result.body.message, /snapshot insertion failed/i);
  } finally {
    Recipient.insertMany = originalInsertMany;
  }
  assert.equal(await Campaign.countDocuments({}), 0);
  assert.equal(await Recipient.countDocuments({}), 0);
});

test("worker leaves a campaign processing when recipient snapshot count mismatches", async () => {
  const selected = await customer();
  const campaign = await Campaign.create({
    channel: "IN_APP",
    kind: "BROADCAST",
    title: "Maintenance",
    message: "A short maintenance window is planned.",
    audience: { kind: "SELECTED_CUSTOMERS" },
    createdBy: new mongoose.Types.ObjectId(),
    recipientCount: 2,
  });
  await Recipient.create({
    campaignId: campaign._id,
    userId: selected._id,
    recipientKey: String(selected._id),
    email: selected.email,
    outcome: "DELIVERED",
  });
  const originalConsoleError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args.join(" "));
  try {
    await processCampaign(campaign._id);
  } finally {
    console.error = originalConsoleError;
  }
  const persisted = await Campaign.findById(campaign._id);
  assert.equal(persisted.status, "PROCESSING");
  assert.equal(persisted.deliveredCount, 1);
  assert.equal(persisted.completedAt, null);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /snapshot count 1 does not match expected 2/i);
});

test("email test persists a TEST campaign and never creates a broadcast", async () => {
  const result = await call(communications.testEmail, {
    subject: "Test message",
    message: "This is a provider-safe test.",
    email: "recipient@servicepay.test",
  });
  assert.equal(result.status, 201);
  assert.equal(result.body.campaign.kind, "TEST");
  assert.equal(result.body.campaign.recipientCount, 1);
  assert.equal(await Campaign.countDocuments({ kind: "BROADCAST" }), 0);
  assert.equal(await Recipient.countDocuments({}), 1);
});