const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const ServicePayTransferAttempt = require("../models/servicePayTransferAttempt.model");
const Transfer = require("../models/transfer.model");
const {
  inspectAgedPendingTransfers,
} = require("../services/servicePayTransferMonitor.service");

let mongo;

test.before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri(), { dbName: "pending-transfer-monitor" });
  await Promise.all([ServicePayTransferAttempt.init(), Transfer.init()]);
});

test.after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

test.beforeEach(async () => {
  process.env.JWT_SECRET = "monitor-test-key-one";
  await Promise.all([
    ServicePayTransferAttempt.collection.deleteMany({}),
    Transfer.collection.deleteMany({}),
  ]);
});

const attempt = (reference, createdAt, extra = {}) =>
  ServicePayTransferAttempt.create({
    sender: new mongoose.Types.ObjectId(),
    receiverPhone: "08012345678",
    amount: 100,
    reference,
    idempotencyKey: `secret-idempotency-${reference}`,
    status: "PENDING",
    leaseExpiresAt: new Date(createdAt.getTime() + 5 * 60 * 1000),
    createdAt,
    updatedAt: createdAt,
    ...extra,
  });

test("counts only aged PENDING attempts and classifies authoritative transfers", async () => {
  const now = new Date("2026-09-07T12:00:00.000Z");
  const old = new Date("2026-09-07T11:40:00.000Z");
  const expired = await attempt("opaque-expired-reference", old);
  const committed = await attempt("opaque-committed-reference", old);
  await attempt("opaque-fresh-reference", new Date("2026-09-07T11:55:00.000Z"));
  await ServicePayTransferAttempt.updateOne(
    { _id: await attempt("opaque-failed-reference", old).then(({ _id }) => _id) },
    { $set: { status: "FAILED" } }
  );
  const transfer = await Transfer.create({
    sender: committed.sender,
    receiver: new mongoose.Types.ObjectId(),
    amount: 100,
    reference: committed.reference,
    status: "SUCCESSFUL",
    senderBalanceAfter: 400,
    receiverBalanceAfter: 100,
  });

  const alert = await inspectAgedPendingTransfers({ now, ageMs: 10 * 60 * 1000 });

  assert.equal(alert.agedPendingCount, 2);
  assert.equal(alert.expiredFailedReservationCount, 1);
  assert.equal(alert.committedResponseLostCount, 1);
  assert.deepEqual(
    new Set(alert.records.map(({ classification }) => classification)),
    new Set(["EXPIRED_FAILED_RESERVATION", "COMMITTED_RESPONSE_LOST"])
  );
  assert.equal(alert.records.find(({ attemptId }) => attemptId === String(expired._id)).transferId, null);
  assert.equal(
    alert.records.find(({ attemptId }) => attemptId === String(committed._id)).transferId,
    String(transfer._id)
  );
});

test("alert records expose only opaque references and internal lifecycle fields", async () => {
  const now = new Date("2026-09-07T12:00:00.000Z");
  await attempt("08012345678", new Date("2026-09-07T11:40:00.000Z"));

  const alert = await inspectAgedPendingTransfers({ now, ageMs: 10 * 60 * 1000 });
  const serialized = JSON.stringify(alert);
  process.env.JWT_SECRET = "monitor-test-key-two";
  const alertWithDifferentKey = await inspectAgedPendingTransfers({
    now,
    ageMs: 10 * 60 * 1000,
  });

  assert.deepEqual(Object.keys(alert.records[0]).sort(), [
    "attemptId", "classification", "createdAt", "leaseExpiresAt", "reference", "transferId",
  ]);
  assert.match(alert.records[0].reference, /^SPAR-[A-F0-9]{24}$/);
  assert.notEqual(alert.records[0].reference, alertWithDifferentKey.records[0].reference);
  assert.doesNotMatch(serialized, /08012345678|secret-idempotency|sender|receiverPhone|amount/i);
});

test("preserves exact classification totals when the safe record sample is capped", async () => {
  const now = new Date("2026-09-07T12:00:00.000Z");
  const old = new Date("2026-09-07T11:40:00.000Z");
  await Promise.all([
    attempt("opaque-capped-one", old),
    attempt("opaque-capped-two", old),
    attempt("opaque-capped-three", old),
  ]);

  const alert = await inspectAgedPendingTransfers({
    now,
    ageMs: 10 * 60 * 1000,
    sampleLimit: 1,
  });

  assert.equal(alert.agedPendingCount, 3);
  assert.equal(alert.expiredFailedReservationCount, 3);
  assert.equal(alert.sampledCount, 1);
  assert.equal(alert.sampleTruncated, true);
});

test("excludes an active lease even when a lower alert age is configured", async () => {
  const now = new Date("2026-09-07T12:00:00.000Z");
  await attempt("opaque-still-in-flight", new Date("2026-09-07T11:57:00.000Z"));

  const alert = await inspectAgedPendingTransfers({ now, ageMs: 2 * 60 * 1000 });

  assert.equal(alert.agedPendingCount, 0);
  assert.equal(alert.records.length, 0);
});

test("does not treat PENDING or FAILED Transfer records as committed money movement", async () => {
  const now = new Date("2026-09-07T12:00:00.000Z");
  const old = new Date("2026-09-07T11:40:00.000Z");
  const pendingAttempt = await attempt("opaque-transfer-pending", old);
  const failedAttempt = await attempt("opaque-transfer-failed", old);
  await Transfer.create([
    {
      sender: pendingAttempt.sender,
      receiver: new mongoose.Types.ObjectId(),
      amount: 100,
      reference: pendingAttempt.reference,
      status: "PENDING",
      senderBalanceAfter: 500,
      receiverBalanceAfter: 0,
    },
    {
      sender: failedAttempt.sender,
      receiver: new mongoose.Types.ObjectId(),
      amount: 100,
      reference: failedAttempt.reference,
      status: "FAILED",
      senderBalanceAfter: 500,
      receiverBalanceAfter: 0,
    },
  ]);

  const alert = await inspectAgedPendingTransfers({ now, ageMs: 10 * 60 * 1000 });

  assert.equal(alert.expiredFailedReservationCount, 2);
  assert.equal(alert.committedResponseLostCount, 0);
  assert.ok(alert.records.every(
    ({ classification, transferId }) =>
      classification === "EXPIRED_FAILED_RESERVATION" && transferId === null
  ));
});