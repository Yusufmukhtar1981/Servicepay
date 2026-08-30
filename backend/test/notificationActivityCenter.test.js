const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const Notification = require("../models/notification.model");
const controller = require("../controllers/notification.controller");
const {
  createInAppNotification,
  inferNotificationCategory,
} = require("../services/inAppNotification.service");
const {
  sendTransactionNotification,
} = require("../services/transactionEmailNotification.service");

let mongo;
const firstUser = new mongoose.Types.ObjectId();
const secondUser = new mongoose.Types.ObjectId();

const call = async (handler, { userId = firstUser, query = {}, params = {} } = {}) => {
  const result = { status: 200 };
  const req = { user: { _id: userId }, query, params, body: {} };
  const res = {
    status(code) {
      result.status = code;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    },
  };
  await handler(req, res);
  return result;
};

test.before(async () => {
  mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  await mongoose.connect(mongo.getUri(), {
    dbName: "notification-activity-center-tests",
  });
  await Notification.init();
});

test.after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

test.beforeEach(async () => {
  await Notification.deleteMany({});
});

test("legacy notification types receive stable categories", () => {
  assert.equal(
    inferNotificationCategory({ type: "TRANSFER", referenceType: "" }),
    "TRANSACTION"
  );
  assert.equal(
    inferNotificationCategory({ type: "GENERAL", referenceType: "KYC_APPLICATION" }),
    "ACCOUNT"
  );
  assert.equal(
    inferNotificationCategory({ type: "SECURITY", referenceType: "" }),
    "SECURITY"
  );
});

test("event keys prevent duplicate in-app records", async () => {
  const input = {
    userId: firstUser,
    title: "Transfer successful",
    message: "Your transfer was completed.",
    type: "TRANSFER",
    reference: "SPT-100",
    referenceType: "TRANSACTION_EVENT",
    relatedStatus: "SUCCESSFUL",
    dedupeKey: "transaction:SPT-100:SUCCESSFUL",
  };
  const [first, second] = await Promise.all([
    createInAppNotification(input),
    createInAppNotification(input),
  ]);
  assert.equal(String(first._id), String(second._id));
  assert.equal(await Notification.countDocuments({}), 1);
});

test("transaction activity is recorded even when the user has no email", async () => {
  const result = await sendTransactionNotification({
    userId: firstUser,
    email: "",
    name: "Email-less Customer",
    type: "WITHDRAWAL",
    direction: "DEBIT",
    amount: 5000,
    reference: "WDR-NO-EMAIL",
    status: "PENDING",
  });
  assert.equal(result.success, true);
  assert.equal(result.reason, "EMAIL_RECIPIENT_MISSING");
  assert.equal(await Notification.countDocuments({
    userId: firstUser,
    reference: "WDR-NO-EMAIL",
  }), 1);
});

test("list filters, paginates, and never leaks internal fields", async () => {
  await Notification.create([
    {
      userId: firstUser,
      title: "Transfer successful",
      message: "Completed.",
      type: "TRANSFER",
      category: "TRANSACTION",
      reference: "SPT-SEARCH",
      relatedStatus: "SUCCESSFUL",
      action: "TRANSACTION",
      dedupeKey: "first",
    },
    {
      userId: firstUser,
      title: "Password changed",
      message: "Changed.",
      type: "SECURITY",
      category: "SECURITY",
      dedupeKey: "second",
    },
    {
      userId: secondUser,
      title: "Other customer",
      message: "Private.",
      type: "GENERAL",
      dedupeKey: "third",
    },
  ]);

  const result = await call(controller.getMyNotifications, {
    query: {
      category: "TRANSACTION",
      unread: "true",
      search: "SPT-SEARCH",
      limit: "1",
    },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.notifications.length, 1);
  assert.equal(result.body.notifications[0].category, "TRANSACTION");
  assert.equal(result.body.notifications[0].dedupeKey, undefined);
  assert.equal(result.body.notifications[0].__v, undefined);
});

test("category filters include notification history created before categories", async () => {
  await Notification.collection.insertOne({
    userId: firstUser,
    title: "Legacy transfer",
    message: "Completed.",
    type: "TRANSFER",
    isRead: false,
    readAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const result = await call(controller.getMyNotifications, {
    query: { category: "TRANSACTION" },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.notifications.length, 1);
  assert.equal(result.body.notifications[0].category, "TRANSACTION");
});

test("mark one is ownership-safe and idempotent", async () => {
  const item = await Notification.create({
    userId: firstUser,
    title: "Notice",
    message: "Message",
  });
  const forbidden = await call(controller.markAsRead, {
    userId: secondUser,
    params: { id: item._id },
  });
  assert.equal(forbidden.status, 404);

  const first = await call(controller.markAsRead, {
    params: { id: item._id },
  });
  const repeated = await call(controller.markAsRead, {
    params: { id: item._id },
  });
  assert.equal(first.status, 200);
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.notification.isRead, true);
  assert.ok(repeated.body.notification.readAt);
});

test("mark all only changes the authenticated user's unread records", async () => {
  await Notification.create([
    { userId: firstUser, title: "A", message: "A" },
    { userId: firstUser, title: "B", message: "B" },
    { userId: secondUser, title: "C", message: "C" },
  ]);
  const result = await call(controller.markAllAsRead);
  assert.equal(result.status, 200);
  assert.equal(result.body.modifiedCount, 2);
  assert.equal(await Notification.countDocuments({
    userId: firstUser,
    isRead: false,
  }), 0);
  assert.equal(await Notification.countDocuments({
    userId: secondUser,
    isRead: false,
  }), 1);
});