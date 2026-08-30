const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const User = require("../models/user.model");
const Transfer = require("../models/transfer.model");
const Transaction = require("../models/transaction.model");
const LedgerEntry = require("../models/ledgerEntry.model");
const controller = require("../controllers/transfer.controller");
const {
  verifyTransactionPin,
} = require("../services/transactionPin.service");

let mongo;
let sequence = 0;
const originalStartSession = mongoose.startSession.bind(mongoose);
const models = [User, Transfer, Transaction, LedgerEntry];

const customer = (label, walletBalance) => User.create({
  fullName: `${label} ${sequence}`,
  phone: `080${String(++sequence).padStart(8, "0")}`,
  email: `${label.toLowerCase()}${sequence}@servicepay.test`,
  password: "Passw0rd!",
  transactionPin: "1234",
  transactionPinSet: true,
  walletBalance,
  status: "ACTIVE",
});

const request = ({ sender, receiver, amount = 100, key, pin = "1234" }) => ({
  user: { _id: sender._id },
  body: {
    receiverPhone: receiver.phone,
    amount,
    pin,
  },
  get(name) {
    return name.toLowerCase() === "idempotency-key" ? key : undefined;
  },
});

const call = async (options) => {
  const result = { status: 200 };
  await controller.transfer(request(options), {
    status(code) {
      result.status = code;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    },
  });
  return result;
};

const assertExactTransfer = async ({
  sender,
  receiver,
  senderBalance,
  receiverBalance,
  count = 1,
}) => {
  assert.equal((await User.findById(sender._id)).walletBalance, senderBalance);
  assert.equal((await User.findById(receiver._id)).walletBalance, receiverBalance);
  assert.equal(await Transfer.countDocuments(), count);
  assert.equal(await Transaction.countDocuments({ serviceType: "TRANSFER" }), count);
  assert.equal(await LedgerEntry.countDocuments({ service: "SERVICEPAY_TRANSFER" }), count * 2);
  assert.equal(await LedgerEntry.countDocuments({
    service: "SERVICEPAY_TRANSFER",
    direction: "DEBIT",
  }), count);
  assert.equal(await LedgerEntry.countDocuments({
    service: "SERVICEPAY_TRANSFER",
    direction: "CREDIT",
  }), count);
};

const writeConflict = () => {
  const error = new Error("simulated write conflict");
  error.code = 112;
  error.codeName = "WriteConflict";
  error.errorLabels = ["TransientTransactionError"];
  return error;
};

test.before(async () => {
  mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  await mongoose.connect(mongo.getUri(), {
    dbName: "servicepay-transfer-money-safety",
  });
  await Promise.all(models.map((model) => model.init()));
});

test.after(async () => {
  mongoose.startSession = originalStartSession;
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

test.beforeEach(async () => {
  mongoose.startSession = originalStartSession;
  await Promise.all(models.map((model) => model.collection.deleteMany({})));
});

test("normal transfer atomically writes one debit, credit, transfer, transaction, and ledger pair", async () => {
  const sender = await customer("Sender", 500);
  const receiver = await customer("Receiver", 50);

  const result = await call({
    sender,
    receiver,
    key: "normal-transfer-request",
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(result.body.duplicate, false);
  await assertExactTransfer({
    sender,
    receiver,
    senderBalance: 400,
    receiverBalance: 150,
  });
});

test("a transient WriteConflict retries with a fresh session and succeeds once", async () => {
  const sender = await customer("Sender", 500);
  const receiver = await customer("Receiver", 0);
  let sessions = 0;

  mongoose.startSession = async (...args) => {
    const session = await originalStartSession(...args);
    sessions += 1;
    if (sessions === 1) {
      session.commitTransaction = async () => {
        throw writeConflict();
      };
    }
    return session;
  };

  const result = await call({
    sender,
    receiver,
    key: "write-conflict-recovery",
  });

  assert.equal(result.status, 200);
  assert.equal(sessions, 2);
  await assertExactTransfer({
    sender,
    receiver,
    senderBalance: 400,
    receiverBalance: 100,
  });
});

test("retry exhaustion returns a safe error and leaves no financial mutation", async () => {
  const sender = await customer("Sender", 500);
  const receiver = await customer("Receiver", 0);
  let sessions = 0;

  mongoose.startSession = async (...args) => {
    const session = await originalStartSession(...args);
    sessions += 1;
    session.commitTransaction = async () => {
      throw writeConflict();
    };
    return session;
  };

  const result = await call({
    sender,
    receiver,
    key: "write-conflict-exhaustion",
  });

  assert.equal(result.status, 503);
  assert.equal(result.body.code, "TRANSFER_TEMPORARILY_UNAVAILABLE");
  assert.match(result.body.message, /No duplicate charge was made/i);
  assert.doesNotMatch(result.body.message, /write conflict|mongodb/i);
  assert.equal(sessions, 3);
  await assertExactTransfer({
    sender,
    receiver,
    senderBalance: 500,
    receiverBalance: 0,
    count: 0,
  });
});

test("the same request key returns the original transfer without duplicate money movement", async () => {
  const sender = await customer("Sender", 500);
  const receiver = await customer("Receiver", 0);
  const options = {
    sender,
    receiver,
    key: "same-request-is-exactly-once",
  };

  const first = await call(options);
  const duplicate = await call(options);

  assert.equal(first.status, 200);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.duplicate, true);
  assert.equal(
    String(duplicate.body.data.transferId),
    String(first.body.data.transferId)
  );
  await assertExactTransfer({
    sender,
    receiver,
    senderBalance: 400,
    receiverBalance: 100,
  });
});

test("a request key cannot be reused for a different amount", async () => {
  const sender = await customer("Sender", 500);
  const receiver = await customer("Receiver", 0);
  const key = "request-intent-cannot-change";

  assert.equal((await call({ sender, receiver, key, amount: 100 })).status, 200);
  const changed = await call({ sender, receiver, key, amount: 200 });

  assert.equal(changed.status, 409);
  assert.equal(changed.body.code, "IDEMPOTENCY_KEY_REUSED");
  await assertExactTransfer({
    sender,
    receiver,
    senderBalance: 400,
    receiverBalance: 100,
  });
});

test("an uncertain commit result resolves the committed request without a second transfer", async () => {
  const sender = await customer("Sender", 500);
  const receiver = await customer("Receiver", 0);
  let sessions = 0;

  mongoose.startSession = async (...args) => {
    const session = await originalStartSession(...args);
    sessions += 1;
    const commit = session.commitTransaction.bind(session);
    session.commitTransaction = async () => {
      await commit();
      const error = new Error("simulated lost commit acknowledgement");
      error.errorLabels = ["UnknownTransactionCommitResult"];
      throw error;
    };
    return session;
  };

  const result = await call({
    sender,
    receiver,
    key: "unknown-commit-is-resolved",
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.duplicate, true);
  assert.equal(sessions, 1);
  await assertExactTransfer({
    sender,
    receiver,
    senderBalance: 400,
    receiverBalance: 100,
  });
});

test("simultaneous transfers from one sender cannot overspend the wallet", async () => {
  const sender = await customer("Sender", 150);
  const firstReceiver = await customer("FirstReceiver", 0);
  const secondReceiver = await customer("SecondReceiver", 0);

  const results = await Promise.all([
    call({
      sender,
      receiver: firstReceiver,
      key: "concurrent-transfer-first",
    }),
    call({
      sender,
      receiver: secondReceiver,
      key: "concurrent-transfer-second",
    }),
  ]);

  assert.equal(results.filter(({ status }) => status === 200).length, 1);
  assert.equal(results.filter(({ status }) => status === 400).length, 1);
  const updatedSender = await User.findById(sender._id);
  const updatedFirst = await User.findById(firstReceiver._id);
  const updatedSecond = await User.findById(secondReceiver._id);
  assert.equal(updatedSender.walletBalance, 50);
  assert.equal(
    updatedFirst.walletBalance + updatedSecond.walletBalance,
    100
  );
  assert.equal(await Transfer.countDocuments(), 1);
  assert.equal(await Transaction.countDocuments({ serviceType: "TRANSFER" }), 1);
  assert.equal(await LedgerEntry.countDocuments({ service: "SERVICEPAY_TRANSFER" }), 2);
});

test("concurrent duplicate requests create exactly one transfer", async () => {
  const sender = await customer("Sender", 500);
  const receiver = await customer("Receiver", 0);
  const options = {
    sender,
    receiver,
    key: "concurrent-duplicate-request",
  };

  const results = await Promise.all([call(options), call(options)]);

  assert.ok(results.every(({ status }) => status === 200));
  assert.ok(results.some(({ body }) => body.duplicate === true));
  await assertExactTransfer({
    sender,
    receiver,
    senderBalance: 400,
    receiverBalance: 100,
  });
});

test("PIN failure creates no debit, credit, transaction, transfer, or ledger entry", async () => {
  const sender = await customer("Sender", 500);
  const receiver = await customer("Receiver", 0);

  const result = await call({
    sender,
    receiver,
    key: "incorrect-pin-no-mutation",
    pin: "9999",
  });

  assert.equal(result.status, 401);
  assert.equal(result.body.code, "INCORRECT_TRANSACTION_PIN");
  await assertExactTransfer({
    sender,
    receiver,
    senderBalance: 500,
    receiverBalance: 0,
    count: 0,
  });
});

test("two concurrent correct PIN verifications do not create a false persistent lock", async () => {
  const sender = await customer("Sender", 500);

  const results = await Promise.allSettled(
    Array.from({ length: 2 }, () =>
      verifyTransactionPin(sender._id, "1234")
    )
  );

  assert.ok(
    results.some(({ status }) => status === "fulfilled"),
    results.map((result) =>
      result.status === "fulfilled" ? "fulfilled" : result.reason?.code
    ).join(",")
  );
  for (const result of results) {
    if (result.status === "rejected") {
      assert.equal(result.reason.code, "TRANSACTION_PIN_RETRY_REQUIRED");
    }
  }
  const stored = await User.findById(sender._id).select(
    "+transactionPinFailedAttempts +transactionPinLockedUntil"
  );
  assert.equal(stored.transactionPinFailedAttempts, 0);
  assert.equal(stored.transactionPinLockedUntil, null);
});