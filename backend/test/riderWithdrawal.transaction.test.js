const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const User = require("../models/user.model");
const RiderWithdrawal = require("../models/riderWithdrawal.model");
const RiderWalletLedger = require("../models/riderWalletLedger.model");
const AppSettings = require("../models/appSettings.model");
const AdminAuditLog = require("../models/adminAuditLog.model");
const KekeRide = require("../models/kekeRide.model");
const kekeController = require("../controllers/kekeRide.controller");
const controller = require("../controllers/riderWithdrawal.controller");
const adminWalletController = require("../controllers/adminRiderWallet.controller");

let replicaSet;
let serial = 0;

const response = () => {
  const result = { statusCode: 200 };
  result.status = (statusCode) => {
    result.statusCode = statusCode;
    return result;
  };
  result.json = (body) => {
    result.body = body;
    return result;
  };
  return result;
};

const submit = async (rider, key, overrides = {}) => {
  const res = response();
  await controller.createWithdrawalRequest({
    user: { _id: rider._id },
    headers: { "idempotency-key": key },
    get: (name) => name === "Idempotency-Key" ? key : undefined,
    body: {
      amount: 5000,
      bankCode: "058",
      bankName: "Test Bank",
      accountNumber: "0123456789",
      accountName: "Test Rider",
      narration: "Commission",
      transactionPin: "1234",
      ...overrides,
    },
  }, res);
  return res;
};

const createRider = async (balance = 10000) => {
  serial += 1;
  const rider = new User({
    fullName: `Withdrawal Rider ${serial}`,
    phone: `080000${String(serial).padStart(5, "0")}`,
    password: "password1",
    role: "DELIVERY_RIDER",
    status: "ACTIVE",
    riderVerificationStatus: "VERIFIED",
    pendingRiderSettlement: balance,
  });
  rider.setTransactionPin("1234");
  await rider.save();
  return rider;
};

const createAdmin = async () => {
  serial += 1;
  return User.create({
    fullName: `Withdrawal Admin ${serial}`,
    phone: `081000${String(serial).padStart(5, "0")}`,
    password: "password1",
    role: "HEAD_OFFICE",
    status: "ACTIVE",
  });
};

const adjust = async (admin, rider, action, amount) => {
  const res = response();
  await adminWalletController.adjustRiderWallet({
    user: admin,
    params: { id: String(rider._id) },
    body: { action, amount, reason: "Manual settlement correction", note: "test" },
    method: "PATCH",
    originalUrl: `/api/admin/riders/${rider._id}/wallet`,
  }, res);
  return res;
};

const withdrawalAction = async (handler, admin, withdrawalId, body = {}) => {
  const res = response();
  await handler({
    user: admin, params: { id: String(withdrawalId) }, body,
    method: "PATCH", originalUrl: `/api/rider/admin/withdrawals/${withdrawalId}`,
  }, res);
  return res;
};

const transientCommitError = () => {
  const error = new Error("injected WriteConflict");
  error.code = 112;
  error.errorLabels = ["TransientTransactionError"];
  error.hasErrorLabel = (label) =>
    label === "TransientTransactionError";
  return error;
};

const unknownCommitError = () => {
  const error = new Error("injected unknown commit result");
  error.errorLabels = ["UnknownTransactionCommitResult"];
  error.hasErrorLabel = (label) =>
    label === "UnknownTransactionCommitResult";
  return error;
};

const withPatchedStartSession = async (patch, work) => {
  const originalStartSession = mongoose.startSession;
  mongoose.startSession = async (...args) => {
    const session = await originalStartSession.apply(mongoose, args);
    patch(session);
    return session;
  };
  try {
    return await work();
  } finally {
    mongoose.startSession = originalStartSession;
  }
};

test.before(async () => {
  replicaSet = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
  });
  await mongoose.connect(replicaSet.getUri());
  await RiderWithdrawal.init();
  await RiderWalletLedger.init();
});

test.after(async () => {
  await mongoose.disconnect();
  await replicaSet.stop();
});

test.beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    RiderWithdrawal.deleteMany({}),
    RiderWalletLedger.collection.deleteMany({}),
    AppSettings.collection.deleteMany({}),
    KekeRide.deleteMany({}),
  ]);
});

const createWalletRide = async () => {
  const rider = await createRider(0);
  const customer = await User.create({
    fullName: `Keke Customer ${serial}`, phone: `070000${String(serial).padStart(5, "0")}`,
    password: "password1", role: "CUSTOMER", status: "ACTIVE", walletBalance: 10000,
  });
  const ride = await KekeRide.create({
    customerId: customer._id, driverId: rider._id, rideReference: `KEKE-TEST-${Date.now()}-${serial}`,
    pickup: { address: "A", location: { type: "Point", coordinates: [7, 9] } },
    destination: { address: "B", location: { type: "Point", coordinates: [7.1, 9.1] } },
    customerName: customer.fullName, customerPhone: customer.phone,
    status: "RIDE_STARTED", paymentMethod: "WALLET", paymentStatus: "PENDING",
    totalFare: 5000, servicePayCommission: 500, driverEarning: 4500,
  });
  return { rider, customer, ride };
};

const completeRide = async (rider, ride) => {
  const res = response();
  await kekeController.completeRide({ user: { _id: rider._id }, params: { rideId: String(ride._id) } }, res);
  return res;
};

test("wallet-paid Keke completion and retry commit one reconciled Rider earning", async () => {
  const { rider, customer, ride } = await createWalletRide();
  assert.equal((await completeRide(rider, ride)).statusCode, 200);
  assert.equal((await completeRide(rider, ride)).statusCode, 200);
  assert.equal((await User.findById(customer._id)).walletBalance, 5000);
  assert.equal((await User.findById(rider._id)).pendingRiderSettlement, 4500);
  assert.equal((await KekeRide.findById(ride._id)).status, "RIDE_COMPLETED");
  const entries = await RiderWalletLedger.find({ "metadata.kekeRideId": String(ride._id) });
  assert.equal(entries.length, 1);
  assert.deepEqual([entries[0].oldBalance, entries[0].newBalance], [0, 4500]);
});

test("concurrent Keke completion cannot double debit or credit", async () => {
  const { rider, customer, ride } = await createWalletRide();
  const results = await Promise.all([completeRide(rider, ride), completeRide(rider, ride)]);
  assert.deepEqual(results.map((item) => item.statusCode), [200, 200]);
  assert.equal((await User.findById(customer._id)).walletBalance, 5000);
  assert.equal((await User.findById(rider._id)).totalRiderEarnings, 4500);
  assert.equal(await RiderWalletLedger.countDocuments({ "metadata.kekeRideId": String(ride._id) }), 1);
});

test("Keke settlement ledger failure rolls back customer, ride and Rider state", async () => {
  const { rider, customer, ride } = await createWalletRide();
  const originalCreate = RiderWalletLedger.create;
  RiderWalletLedger.create = async () => { throw new Error("injected settlement failure"); };
  try {
    assert.equal((await completeRide(rider, ride)).statusCode, 500);
  } finally {
    RiderWalletLedger.create = originalCreate;
  }
  assert.equal((await User.findById(customer._id)).walletBalance, 10000);
  assert.equal((await User.findById(rider._id)).pendingRiderSettlement, 0);
  assert.equal((await KekeRide.findById(ride._id)).status, "RIDE_STARTED");
  assert.equal(await RiderWalletLedger.countDocuments({ "metadata.kekeRideId": String(ride._id) }), 0);
});

test("creates one pending manual request and reserves its exact debit", async () => {
  const rider = await createRider();
  const res = await submit(rider, "withdrawal-create-0001");

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.withdrawal.status, "PENDING");
  assert.equal(res.body.withdrawal.provider, "MANUAL");
  assert.equal(res.body.availableCommission, 5000);
  assert.equal(await RiderWithdrawal.countDocuments(), 1);
  assert.equal((await User.findById(rider._id)).pendingRiderSettlement, 5000);
  const reserveEntries = await RiderWalletLedger.find({
    riderId: rider._id,
    type: "WITHDRAWAL_RESERVED",
  }).sort({ balanceAccount: 1 });
  assert.equal(reserveEntries.length, 2);
  assert.deepEqual(
    reserveEntries.map((entry) => [entry.balanceAccount, entry.oldBalance, entry.newBalance]),
    [["AVAILABLE", 10000, 5000], ["RESERVED", 0, 5000]]
  );
});

test("Rider ledger rejects document and query mutations/deletions", async () => {
  const rider = await createRider();
  await submit(rider, "withdrawal-ledger-immutable");
  const entry = await RiderWalletLedger.findOne({ riderId: rider._id });
  entry.reason = "tampered";
  await assert.rejects(entry.save(), /immutable/);
  await assert.rejects(entry.deleteOne(), /immutable/);
  await assert.rejects(RiderWalletLedger.updateOne({ _id: entry._id }, { $set: { reason: "tampered" } }), /immutable/);
  await assert.rejects(RiderWalletLedger.deleteOne({ _id: entry._id }), /immutable/);
  assert.equal(await RiderWalletLedger.countDocuments({ riderId: rider._id }), 2);
});

test("persisted toggle refuses OFF with 503 then accepts ON with 201", async () => {
  const rider = await createRider();
  const admin = await createAdmin();
  await AppSettings.create({
    key: "GLOBAL_SETTINGS",
    riderWithdrawalControl: { enabled: false, updatedAt: new Date() },
  });

  const disabled = await submit(rider, "withdrawal-feature-disabled");
  const toggle = response();
  await adminWalletController.updateWithdrawalControl({
    user: admin, body: { enabled: true, reason: "Enable withdrawals" },
    method: "PATCH", originalUrl: "/api/admin/rider-withdrawal-control",
  }, toggle);
  const enabled = await submit(rider, "withdrawal-feature-enabled");

  assert.equal(disabled.statusCode, 503);
  assert.equal(toggle.statusCode, 200);
  assert.equal(enabled.statusCode, 201);
  assert.equal((await AppSettings.getGlobalSettings()).riderWithdrawalControl.enabled, true);
  assert.equal(await RiderWithdrawal.countDocuments(), 1);
  assert.equal((await User.findById(rider._id)).pendingRiderSettlement, 5000);
});

test("new pending Rider withdrawal is visible to authorized Head Office queue", async () => {
  const rider = await createRider();
  const admin = await createAdmin();
  const submitted = await submit(rider, "withdrawal-admin-queue-visible");
  const res = response();
  await controller.getAllWithdrawals({
    user: admin,
    query: { status: "PENDING", limit: 20, page: 1 },
  }, res);

  assert.equal(submitted.statusCode, 201);
  assert.equal(res.statusCode, 200);
  const item = res.body.data.withdrawals.find(
    (withdrawal) => withdrawal.reference === submitted.body.withdrawal.reference
  );
  assert.ok(item);
  assert.equal(item.status, "PENDING");
  assert.equal(String(item.riderId._id), String(rider._id));
});

test("admin credits/debits only Rider settlement balance and records immutable entries", async () => {
  const rider = await createRider(1000);
  const admin = await createAdmin();
  const credit = await adjust(admin, rider, "CREDIT", 500);
  const debit = await adjust(admin, rider, "DEBIT", 200);
  const refused = await adjust(admin, rider, "DEBIT", 2000);

  assert.equal(credit.statusCode, 200);
  assert.equal(debit.statusCode, 200);
  assert.equal(refused.statusCode, 422);
  assert.equal((await User.findById(rider._id)).pendingRiderSettlement, 1300);
  assert.equal(await RiderWalletLedger.countDocuments({ riderId: rider._id }), 2);
});

test("concurrent admin debits cannot overdraw Rider settlement", async () => {
  const rider = await createRider(1000);
  const admin = await createAdmin();
  const results = await Promise.all([
    adjust(admin, rider, "DEBIT", 700),
    adjust(admin, rider, "DEBIT", 700),
  ]);
  assert.deepEqual(results.map((item) => item.statusCode).sort(), [200, 422]);
  assert.equal((await User.findById(rider._id)).pendingRiderSettlement, 300);
  assert.equal(await RiderWalletLedger.countDocuments({ riderId: rider._id, type: "ADMIN_DEBIT" }), 1);
});

test("admin toggle persists enabled state and writes audit evidence", async () => {
  const admin = await createAdmin();
  const req = (enabled) => ({
    user: admin, body: { enabled, reason: "Controlled test change" },
    method: "PATCH", originalUrl: "/api/admin/rider-withdrawal-control",
  });
  const off = response();
  await adminWalletController.updateWithdrawalControl(req(false), off);
  const on = response();
  await adminWalletController.updateWithdrawalControl(req(true), on);
  assert.equal(off.statusCode, 200);
  assert.equal(on.statusCode, 200);
  assert.equal((await AppSettings.getGlobalSettings()).riderWithdrawalControl.enabled, true);
  assert.equal(await AdminAuditLog.countDocuments({
    action: "RIDER_WITHDRAWAL_TOGGLE_UPDATED",
    actorId: admin._id,
  }), 2);
});

test("approve, processing and paid are audited and paid settlement is exact-once", async () => {
  const rider = await createRider();
  const admin = await createAdmin();
  const submitted = await submit(rider, "withdrawal-paid-lifecycle");
  const withdrawalId = submitted.body.withdrawal.id;
  assert.equal((await withdrawalAction(controller.approveWithdrawal, admin, withdrawalId)).statusCode, 200);
  assert.equal((await withdrawalAction(controller.markWithdrawalProcessing, admin, withdrawalId)).statusCode, 200);
  assert.equal((await withdrawalAction(controller.markWithdrawalPaid, admin, withdrawalId)).statusCode, 200);
  const duplicate = await withdrawalAction(controller.markWithdrawalPaid, admin, withdrawalId);

  assert.equal(duplicate.statusCode, 400);
  assert.equal((await User.findById(rider._id)).settledRiderEarnings, 5000);
  assert.equal(await RiderWalletLedger.countDocuments({ withdrawalId, type: "WITHDRAWAL_PAID" }), 1);
  assert.equal(await AdminAuditLog.countDocuments({
    action: { $in: ["RIDER_WITHDRAWAL_APPROVED", "RIDER_WITHDRAWAL_PROCESSING", "RIDER_WITHDRAWAL_PAID"] },
    targetUserId: rider._id,
  }), 3);
});

test("rejection returns reserved funds exactly once and preserves accurate prior status", async () => {
  const rider = await createRider();
  const admin = await createAdmin();
  const submitted = await submit(rider, "withdrawal-rejection-lifecycle");
  const withdrawalId = submitted.body.withdrawal.id;
  assert.equal((await withdrawalAction(controller.approveWithdrawal, admin, withdrawalId)).statusCode, 200);
  assert.equal((await withdrawalAction(controller.rejectWithdrawal, admin, withdrawalId, { reason: "Bank account mismatch" })).statusCode, 200);
  const duplicate = await withdrawalAction(controller.rejectWithdrawal, admin, withdrawalId, { reason: "Bank account mismatch" });
  assert.equal(duplicate.statusCode, 400);
  assert.equal((await User.findById(rider._id)).pendingRiderSettlement, 10000);
  assert.equal(await RiderWalletLedger.countDocuments({ withdrawalId, type: "WITHDRAWAL_REVERSAL" }), 2);
  const audit = await AdminAuditLog.findOne({ action: "RIDER_WITHDRAWAL_REJECTED", targetUserId: rider._id });
  assert.equal(audit.previousData.status, "APPROVED");
});

test("failed and reversed requests release the reserved sub-ledger exactly once", async () => {
  const rider = await createRider();
  const admin = await createAdmin();
  const failedSubmission = await submit(rider, "withdrawal-failed-lifecycle");
  const failedId = failedSubmission.body.withdrawal.id;
  await withdrawalAction(controller.approveWithdrawal, admin, failedId);
  await withdrawalAction(controller.markWithdrawalFailed, admin, failedId, { reason: "Provider declined transfer" });
  assert.equal((await User.findById(rider._id)).pendingRiderSettlement, 10000);
  assert.equal(await RiderWalletLedger.countDocuments({ withdrawalId: failedId, type: "WITHDRAWAL_REVERSAL" }), 2);

  const reverseSubmission = await submit(rider, "withdrawal-reversed-lifecycle");
  const reverseId = reverseSubmission.body.withdrawal.id;
  assert.equal((await withdrawalAction(controller.reverseWithdrawal, admin, reverseId, { reason: "Operator cancellation" })).statusCode, 200);
  assert.equal((await withdrawalAction(controller.reverseWithdrawal, admin, reverseId, { reason: "Operator cancellation" })).statusCode, 200);
  assert.equal(await RiderWalletLedger.countDocuments({ withdrawalId: reverseId, type: "WITHDRAWAL_REVERSAL" }), 2);
});

test("rejects wrong PIN and over-balance requests without mutation", async () => {
  const rider = await createRider();
  const wrongPin = await submit(rider, "withdrawal-wrong-pin-01", {
    transactionPin: "0000",
  });
  const overBalance = await submit(rider, "withdrawal-over-balance", {
    amount: 15000,
  });

  assert.equal(wrongPin.statusCode, 401);
  assert.equal(overBalance.statusCode, 400);
  assert.equal(await RiderWithdrawal.countDocuments(), 0);
  assert.equal((await User.findById(rider._id)).pendingRiderSettlement, 10000);
});

test("sequential and concurrent duplicate keys produce one request and one debit", async () => {
  const rider = await createRider();
  const key = "withdrawal-duplicate-001";
  const first = await submit(rider, key);
  const duplicate = await submit(rider, key);

  assert.equal(first.statusCode, 201);
  assert.equal(duplicate.statusCode, 200);
  assert.equal(duplicate.body.withdrawal.reference, first.body.withdrawal.reference);

  const concurrentRider = await createRider();
  const concurrentKey = "withdrawal-concurrent-001";
  const results = await Promise.all([
    submit(concurrentRider, concurrentKey),
    submit(concurrentRider, concurrentKey),
  ]);
  assert.deepEqual(results.map((item) => item.statusCode).sort(), [200, 201]);
  assert.equal(await RiderWithdrawal.countDocuments({ riderId: concurrentRider._id }), 1);
  assert.equal(
    (await User.findById(concurrentRider._id)).pendingRiderSettlement,
    5000
  );
});

test("reused key with a changed withdrawal intent returns conflict", async () => {
  const rider = await createRider();
  const key = "withdrawal-intent-conflict";
  await submit(rider, key);
  const changed = await submit(rider, key, { amount: 4000 });

  assert.equal(changed.statusCode, 409);
  assert.equal(changed.body.code, "IDEMPOTENCY_KEY_INTENT_CONFLICT");
  assert.equal(await RiderWithdrawal.countDocuments({ riderId: rider._id }), 1);
  assert.equal((await User.findById(rider._id)).pendingRiderSettlement, 5000);
});

test("retries an injected commit WriteConflict without a second withdrawal or debit", async () => {
  const rider = await createRider();
  let commits = 0;
  let callbacks = 0;

  const res = await withPatchedStartSession((session) => {
    const commit = session.commitTransaction.bind(session);
    const abort = session.abortTransaction.bind(session);
    session.withTransaction = async (callback, options) => {
      for (;;) {
        session.startTransaction(options);
        callbacks += 1;
        try {
          await callback();
          commits += 1;
          if (commits === 1) {
            // This is deliberately raised at commit, after the callback has
            // made its transactional writes. The aborted first attempt must
            // not be observable as an extra debit/request.
            throw transientCommitError();
          }
          await commit();
          return;
        } catch (error) {
          await abort();
          if (error.hasErrorLabel?.("TransientTransactionError")) {
            continue;
          }
          throw error;
        }
      }
    };
  }, () => submit(rider, "withdrawal-write-conflict-01"));

  assert.equal(res.statusCode, 201);
  assert.ok(callbacks >= 2);
  assert.equal(await RiderWithdrawal.countDocuments({ riderId: rider._id }), 1);
  assert.equal(
    (await RiderWithdrawal.findOne({ riderId: rider._id })).status,
    "PENDING"
  );
  assert.equal((await User.findById(rider._id)).pendingRiderSettlement, 5000);
});

test("resolves an injected unknown commit result using the committed idempotency key", async () => {
  const rider = await createRider();
  const key = "withdrawal-unknown-commit-01";

  const res = await withPatchedStartSession((session) => {
    const commit = session.commitTransaction.bind(session);
    const abort = session.abortTransaction.bind(session);
    session.withTransaction = async (callback, options) => {
      session.startTransaction(options);
      try {
        await callback();
        await commit(); // The financial transaction has actually committed.
      } catch (error) {
        await abort();
        throw error;
      }
      // Simulate a connection loss after a successful commit acknowledgement
      // was lost. The controller must resolve the durable request by key.
      throw unknownCommitError();
    };
  }, () => submit(rider, key));

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.withdrawal.status, "PENDING");
  assert.equal(await RiderWithdrawal.countDocuments({ riderId: rider._id }), 1);
  assert.equal(
    (await User.findById(rider._id)).pendingRiderSettlement,
    5000
  );
});