const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const User = require("../models/user.model");
const RiderWithdrawal = require("../models/riderWithdrawal.model");
const controller = require("../controllers/riderWithdrawal.controller");

let replicaSet;
let serial = 0;

const response = () => {
  const result = {};
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
});

test.after(async () => {
  await mongoose.disconnect();
  await replicaSet.stop();
});

test.beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    RiderWithdrawal.deleteMany({}),
  ]);
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