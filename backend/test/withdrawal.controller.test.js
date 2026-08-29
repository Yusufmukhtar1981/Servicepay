const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const User = require("../models/user.model");
const WithdrawalRequest = require("../models/withdrawalRequest.model");
const LedgerEntry = require("../models/ledgerEntry.model");
const AppSettings = require("../models/appSettings.model");
const {
  createWithdrawal,
  myWithdrawals,
  approveWithdrawal,
  rejectWithdrawal,
} = require("../controllers/withdrawal.controller");
const {
  verifyTransactionPin,
} = require("../services/transactionPin.service");

const models = [
  User,
  WithdrawalRequest,
  LedgerEntry,
  AppSettings,
];

let mongo;
let sequence = 0;

const createUser = async ({
  role = "CUSTOMER",
  walletBalance = 1000,
} = {}) => {
  sequence += 1;
  return User.create({
    fullName: `Withdrawal Test ${sequence}`,
    phone: `080755${String(sequence).padStart(5, "0")}`,
    email: `withdrawal-${sequence}@example.test`,
    password: "Password123!",
    transactionPin: "1234",
    transactionPinSet: true,
    role,
    status: "ACTIVE",
    walletBalance,
  });
};

const call = async (
  handler,
  {
    user,
    body = {},
    params = {},
    query = {},
    headers = {},
  }
) => {
  const result = {
    status: 200,
  };
  const req = {
    user,
    body,
    params,
    query,
    get(name) {
      return headers[String(name).toLowerCase()];
    },
  };
  const res = {
    status(code) {
      result.status = code;
      return this;
    },
    json(payload) {
      result.body = payload;
      return this;
    },
  };

  await handler(req, res);
  return result;
};

const validBody = (overrides = {}) => ({
  bankName: "ServicePay Test Bank",
  accountNumber: "0123456789",
  accountName: "Withdrawal Customer",
  amount: 300,
  transactionPin: "1234",
  ...overrides,
});

const requestWithdrawal = (user, key, overrides) =>
  call(createWithdrawal, {
    user,
    body: validBody(overrides),
    headers: {
      "idempotency-key": key,
    },
  });

test.before(async () => {
  mongo = await MongoMemoryReplSet.create({
    replSet: {
      count: 1,
      storageEngine: "wiredTiger",
    },
  });
  await mongoose.connect(mongo.getUri(), {
    dbName: "withdrawal-tests",
  });
  await Promise.all(models.map((model) => model.init()));
});

test.after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

test.beforeEach(async () => {
  await Promise.all(
    models.map((model) => model.collection.deleteMany({}))
  );
});

test("creation holds funds once and an idempotent retry cannot double debit", async () => {
  const customer = await createUser();

  const created = await requestWithdrawal(
    customer,
    "withdrawal-create-once"
  );
  assert.equal(created.status, 201);
  assert.equal(created.body.success, true);
  assert.equal(created.body.withdrawal.status, "PENDING");
  assert.equal(created.body.withdrawal.bankName, "ServicePay Test Bank");

  let storedUser = await User.findById(customer._id);
  assert.equal(storedUser.walletBalance, 700);
  assert.equal(storedUser.withdrawalLockedBalance, 300);
  assert.equal(await WithdrawalRequest.countDocuments(), 1);
  assert.equal(await LedgerEntry.countDocuments(), 1);

  const duplicate = await requestWithdrawal(
    customer,
    "withdrawal-create-once"
  );
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.duplicate, true);

  storedUser = await User.findById(customer._id);
  assert.equal(storedUser.walletBalance, 700);
  assert.equal(storedUser.withdrawalLockedBalance, 300);
  assert.equal(await WithdrawalRequest.countDocuments(), 1);
  assert.equal(await LedgerEntry.countDocuments(), 1);
});

test("the same client key from different customers creates separate ledger debits", async () => {
  const firstCustomer = await createUser();
  const secondCustomer = await createUser();

  const first = await requestWithdrawal(
    firstCustomer,
    "shared-device-key"
  );
  const second = await requestWithdrawal(
    secondCustomer,
    "shared-device-key"
  );

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);

  const entries = await LedgerEntry.find({
    service: "WITHDRAWAL_HOLD",
  });
  assert.equal(entries.length, 2);
  assert.deepEqual(
    new Set(entries.map((entry) => String(entry.user))),
    new Set([
      String(firstCustomer._id),
      String(secondCustomer._id),
    ])
  );

  const requests = await WithdrawalRequest.find({
    idempotencyKey: "shared-device-key",
  });
  assert.equal(requests.length, 2);
  for (const request of requests) {
    const entry = entries.find(
      (candidate) =>
        String(candidate._id) ===
        String(request.debitLedgerEntry)
    );
    assert.ok(entry);
    assert.equal(String(entry.user), String(request.user));
  }
});

test("creation enforces request key, limits, PIN, and available balance", async () => {
  const customer = await createUser({
    walletBalance: 150,
  });

  const noKey = await call(createWithdrawal, {
    user: customer,
    body: validBody({ amount: 100 }),
  });
  assert.equal(noKey.status, 400);
  assert.equal(noKey.body.code, "IDEMPOTENCY_KEY_REQUIRED");

  const aboveMaximum = await requestWithdrawal(
    customer,
    "withdrawal-above-max",
    { amount: 50001 }
  );
  assert.equal(aboveMaximum.status, 400);
  assert.match(aboveMaximum.body.message, /Maximum withdrawal/);

  const subKobo = await requestWithdrawal(
    customer,
    "withdrawal-sub-kobo",
    { amount: 100.001 }
  );
  assert.equal(subKobo.status, 400);
  assert.match(subKobo.body.message, /two decimal places/);

  const incorrectPin = await requestWithdrawal(
    customer,
    "withdrawal-wrong-pin",
    { amount: 100, transactionPin: "9999" }
  );
  assert.equal(incorrectPin.status, 401);
  const afterIncorrectPin = await User.findById(customer._id);
  assert.equal(afterIncorrectPin.walletBalance, 150);
  assert.equal(afterIncorrectPin.withdrawalLockedBalance, 0);
  assert.equal(await WithdrawalRequest.countDocuments(), 0);
  assert.equal(await LedgerEntry.countDocuments(), 0);

  const insufficient = await requestWithdrawal(
    customer,
    "withdrawal-insufficient",
    { amount: 200 }
  );
  assert.equal(insufficient.status, 400);
  assert.equal(insufficient.body.message, "Insufficient wallet balance.");
  assert.equal(await WithdrawalRequest.countDocuments(), 0);
  assert.equal(await LedgerEntry.countDocuments(), 0);
});

test("a PIN-locked customer cannot create a withdrawal or debit funds", async () => {
  const customer = await createUser({ walletBalance: 1000 });
  for (let index = 0; index < 5; index += 1) {
    await assert.rejects(
      verifyTransactionPin(customer._id, "9999"),
      { code: "INCORRECT_TRANSACTION_PIN" }
    );
  }
  const response = await requestWithdrawal(customer, "withdrawal-pin-locked");
  assert.equal(response.status, 429);
  assert.equal(response.body.code, "TRANSACTION_PIN_LOCKED");
  const stored = await User.findById(customer._id);
  assert.equal(stored.walletBalance, 1000);
  assert.equal(stored.withdrawalLockedBalance, 0);
  assert.equal(await WithdrawalRequest.countDocuments(), 0);
  assert.equal(await LedgerEntry.countDocuments(), 0);
});

test("approval consumes only locked funds and cannot debit the wallet again", async () => {
  const customer = await createUser();
  const admin = await createUser({
    role: "HEAD_OFFICE",
    walletBalance: 0,
  });
  const created = await requestWithdrawal(
    customer,
    "withdrawal-approve"
  );

  const approved = await call(approveWithdrawal, {
    user: admin,
    params: {
      id: String(created.body.withdrawal._id),
    },
    body: {
      adminNote: "Paid after finance review.",
      payoutReference: "BANK-PAYOUT-001",
    },
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.withdrawal.status, "APPROVED");

  const storedUser = await User.findById(customer._id);
  assert.equal(storedUser.walletBalance, 700);
  assert.equal(storedUser.withdrawalLockedBalance, 0);
  assert.equal(await LedgerEntry.countDocuments(), 1);

  const repeated = await call(approveWithdrawal, {
    user: admin,
    params: {
      id: String(created.body.withdrawal._id),
    },
    body: {
      payoutReference: "BANK-PAYOUT-001",
    },
  });
  assert.equal(repeated.status, 404);
  const afterRepeat = await User.findById(customer._id);
  assert.equal(afterRepeat.walletBalance, 700);
  assert.equal(afterRepeat.withdrawalLockedBalance, 0);
});

test("approval requires payout proof before consuming locked funds", async () => {
  const customer = await createUser();
  const admin = await createUser({
    role: "HEAD_OFFICE",
    walletBalance: 0,
  });
  const created = await requestWithdrawal(
    customer,
    "withdrawal-no-payout-reference"
  );

  const rejectedApproval = await call(approveWithdrawal, {
    user: admin,
    params: {
      id: String(created.body.withdrawal._id),
    },
    body: {
      payoutReference: "   ",
    },
  });
  assert.equal(rejectedApproval.status, 400);
  assert.match(rejectedApproval.body.message, /payout reference/i);

  const storedUser = await User.findById(customer._id);
  const storedRequest = await WithdrawalRequest.findById(
    created.body.withdrawal._id
  );
  assert.equal(storedUser.walletBalance, 700);
  assert.equal(storedUser.withdrawalLockedBalance, 300);
  assert.equal(storedRequest.status, "PENDING");
});

test("rejection returns held funds once and records a refund ledger credit", async () => {
  const customer = await createUser();
  const admin = await createUser({
    role: "HEAD_OFFICE",
    walletBalance: 0,
  });
  const created = await requestWithdrawal(
    customer,
    "withdrawal-reject",
    { amount: 300.25 }
  );

  const heldUser = await User.findById(customer._id);
  assert.equal(heldUser.walletBalance, 699.75);
  assert.equal(heldUser.withdrawalLockedBalance, 300.25);

  const rejected = await call(rejectWithdrawal, {
    user: admin,
    params: {
      id: String(created.body.withdrawal._id),
    },
    body: {
      adminNote: "Bank details could not be verified.",
    },
  });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.withdrawal.status, "REJECTED");

  const storedUser = await User.findById(customer._id);
  assert.equal(storedUser.walletBalance, 1000);
  assert.equal(storedUser.withdrawalLockedBalance, 0);

  const ledger = await LedgerEntry.find({
    user: customer._id,
  }).sort({ createdAt: 1 });
  assert.equal(ledger.length, 2);
  assert.equal(ledger[0].direction, "DEBIT");
  assert.equal(ledger[0].amount, 300.25);
  assert.equal(ledger[1].direction, "CREDIT");
  assert.equal(ledger[1].amount, 300.25);

  const repeated = await call(rejectWithdrawal, {
    user: admin,
    params: {
      id: String(created.body.withdrawal._id),
    },
  });
  assert.equal(repeated.status, 404);
  const afterRepeat = await User.findById(customer._id);
  assert.equal(afterRepeat.walletBalance, 1000);
});

test("withdrawal history is customer-owned and newest first", async () => {
  const firstCustomer = await createUser();
  const secondCustomer = await createUser();

  await requestWithdrawal(
    firstCustomer,
    "withdrawal-history-one",
    { amount: 100 }
  );
  await new Promise((resolve) => setTimeout(resolve, 5));
  await requestWithdrawal(
    firstCustomer,
    "withdrawal-history-two",
    { amount: 200 }
  );
  await requestWithdrawal(
    secondCustomer,
    "withdrawal-history-other",
    { amount: 100 }
  );

  const history = await call(myWithdrawals, {
    user: firstCustomer,
  });
  assert.equal(history.status, 200);
  assert.equal(history.body.withdrawals.length, 2);
  assert.equal(history.body.withdrawals[0].amount, 200);
  assert.equal(history.body.withdrawals[1].amount, 100);
  assert.ok(
    history.body.withdrawals.every(
      (item) => String(item.user) === String(firstCustomer._id)
    )
  );
});