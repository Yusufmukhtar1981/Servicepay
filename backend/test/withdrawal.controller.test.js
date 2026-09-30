const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const User = require("../models/user.model");
const WithdrawalRequest = require("../models/withdrawalRequest.model");
const LedgerEntry = require("../models/ledgerEntry.model");
const AppSettings = require("../models/appSettings.model");
const WithdrawalPayoutClaim = require("../models/withdrawalPayoutClaim.model");
const {
  clearWithdrawalIndexReadinessCache,
} = require("../services/withdrawalIndexReadiness.service");
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
  WithdrawalPayoutClaim,
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
  clearWithdrawalIndexReadinessCache();
  await AppSettings.create({ key: "GLOBAL_SETTINGS" });
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

test("withdrawal idempotency rejects changed destination intent", async () => {
  const customer = await createUser();
  const first = await requestWithdrawal(customer, "withdrawal-intent-conflict");
  assert.equal(first.status, 201);
  const changed = await requestWithdrawal(customer, "withdrawal-intent-conflict", {
    amount: 301,
    accountNumber: "9876543210",
    accountName: "Another Recipient",
    bankName: "Another Bank",
  });
  assert.equal(changed.status, 409);
  assert.equal(changed.body.code, "IDEMPOTENCY_INTENT_CONFLICT");
  assert.equal(await WithdrawalRequest.countDocuments(), 1);
});

test("duplicate payout references and uncertain provider status cannot approve withdrawals", async () => {
  const firstCustomer = await createUser();
  const secondCustomer = await createUser();
  const admin = await createUser({ role: "HEAD_OFFICE", walletBalance: 0 });
  const first = await requestWithdrawal(firstCustomer, "withdrawal-payout-one");
  const firstApproval = await call(approveWithdrawal, {
    user: admin,
    params: { id: String(first.body.withdrawal._id) },
    body: {
      adminNote: "Transfer completed.",
      payoutReference: "UNIQUE-PAYOUT-1",
      manualPaymentConfirmed: true,
      expectedAmount: first.body.withdrawal.amount,
      expectedAccountNumber: first.body.withdrawal.accountNumber,
    },
  });
  assert.equal(firstApproval.status, 200);
  const second = await requestWithdrawal(secondCustomer, "withdrawal-payout-two");
  const duplicate = await call(approveWithdrawal, {
    user: admin,
    params: { id: String(second.body.withdrawal._id) },
    body: {
      adminNote: "Transfer completed.",
      payoutReference: "UNIQUE-PAYOUT-1",
      manualPaymentConfirmed: true,
      expectedAmount: second.body.withdrawal.amount,
      expectedAccountNumber: second.body.withdrawal.accountNumber,
    },
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, "DUPLICATE_PAYOUT_REFERENCE");
  const uncertain = await call(approveWithdrawal, {
    user: admin,
    params: { id: String(second.body.withdrawal._id) },
    body: { payoutReference: "UNIQUE-PAYOUT-2", providerStatus: "PROCESSING" },
  });
  assert.equal(uncertain.status, 409);
  assert.equal(uncertain.body.code, "PAYOUT_NOT_CONFIRMED");
  const contradictory = await call(approveWithdrawal, {
    user: admin,
    params: { id: String(second.body.withdrawal._id) },
    body: {
      payoutReference: "UNIQUE-PAYOUT-3",
      providerStatus: "PROCESSING",
      manualPaymentConfirmed: true,
      expectedAmount: second.body.withdrawal.amount,
      expectedAccountNumber: second.body.withdrawal.accountNumber,
    },
  });
  assert.equal(contradictory.status, 409);
  assert.equal(contradictory.body.code, "PAYOUT_NOT_CONFIRMED");
  const conflictingFields = await call(approveWithdrawal, {
    user: admin,
    params: { id: String(second.body.withdrawal._id) },
    body: {
      payoutReference: "UNIQUE-PAYOUT-4",
      providerStatus: "SUCCESSFUL",
      payoutStatus: "PROCESSING",
      manualPaymentConfirmed: true,
      expectedAmount: second.body.withdrawal.amount,
      expectedAccountNumber: second.body.withdrawal.accountNumber,
    },
  });
  assert.equal(conflictingFields.status, 409);
  assert.equal(conflictingFields.body.code, "PAYOUT_NOT_CONFIRMED");
  assert.equal((await WithdrawalRequest.findById(second.body.withdrawal._id)).status, "PENDING");
});

test("two fractional holds can both be approved without losing a locked cent", async () => {
  const customer = await createUser({ walletBalance: 1000 });
  const admin = await createUser({ role: "HEAD_OFFICE", walletBalance: 0 });
  const first = await requestWithdrawal(customer, "fractional-approve-1", { amount: 300.1 });
  const second = await requestWithdrawal(customer, "fractional-approve-2", { amount: 300.2 });

  for (const [created, payoutReference] of [
    [first, "FRACTIONAL-APPROVE-1"],
    [second, "FRACTIONAL-APPROVE-2"],
  ]) {
    const approved = await call(approveWithdrawal, {
      user: admin,
      params: { id: String(created.body.withdrawal._id) },
      body: {
        payoutReference,
        manualPaymentConfirmed: true,
        expectedAmount: created.body.withdrawal.amount,
        expectedAccountNumber: created.body.withdrawal.accountNumber,
      },
    });
    assert.equal(approved.status, 200);
  }

  const stored = await User.findById(customer._id);
  assert.equal(stored.walletBalance, 399.7);
  assert.equal(stored.withdrawalLockedBalance, 0);
});

test("fractional withdrawal refunds restore exact cents across multiple rejections", async () => {
  const customer = await createUser({ walletBalance: 1000 });
  const admin = await createUser({ role: "HEAD_OFFICE", walletBalance: 0 });
  const first = await requestWithdrawal(customer, "fractional-refund-1", { amount: 300.1 });
  const second = await requestWithdrawal(customer, "fractional-refund-2", { amount: 300.2 });

  for (const created of [first, second]) {
    const rejected = await call(rejectWithdrawal, {
      user: admin,
      params: { id: String(created.body.withdrawal._id) },
      body: { adminNote: "Refund requested." },
    });
    assert.equal(rejected.status, 200);
  }

  const stored = await User.findById(customer._id);
  assert.equal(stored.walletBalance, 1000);
  assert.equal(stored.withdrawalLockedBalance, 0);
  assert.equal(
    await LedgerEntry.countDocuments({
      user: customer._id,
      service: "WITHDRAWAL_REFUND",
    }),
    2
  );
});

test("concurrent identical withdrawal keys debit once and tolerate a lazy settings duplicate race", async () => {
  const customer = await createUser({ walletBalance: 1000 });
  const originalGetSettings = AppSettings.getGlobalSettings;
  let injectDuplicate = true;
  AppSettings.getGlobalSettings = async function (...args) {
    if (injectDuplicate) {
      injectDuplicate = false;
      const error = new Error("Concurrent singleton creation.");
      error.code = 11000;
      throw error;
    }
    return originalGetSettings.apply(this, args);
  };
  let responses;
  try {
    responses = await Promise.all([
      requestWithdrawal(customer, "concurrent-same-key"),
      requestWithdrawal(customer, "concurrent-same-key"),
    ]);
  } finally {
    AppSettings.getGlobalSettings = originalGetSettings;
  }

  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
  const stored = await User.findById(customer._id);
  assert.equal(stored.walletBalance, 700);
  assert.equal(stored.withdrawalLockedBalance, 300);
  assert.equal(await WithdrawalRequest.countDocuments({ user: customer._id }), 1);
  assert.equal(await LedgerEntry.countDocuments({ user: customer._id }), 1);
});

test("approve-versus-reject finalizes one withdrawal exactly once", async () => {
  const customer = await createUser({ walletBalance: 1000 });
  const admin = await createUser({ role: "HEAD_OFFICE", walletBalance: 0 });
  const created = await requestWithdrawal(customer, "approve-reject-race", { amount: 300.1 });
  const params = { id: String(created.body.withdrawal._id) };

  const [approval, rejection] = await Promise.all([
    call(approveWithdrawal, {
      user: admin,
      params,
      body: {
        payoutReference: "APPROVE-REJECT-RACE",
        manualPaymentConfirmed: true,
        expectedAmount: created.body.withdrawal.amount,
        expectedAccountNumber: created.body.withdrawal.accountNumber,
      },
    }),
    call(rejectWithdrawal, { user: admin, params }),
  ]);
  assert.equal([approval, rejection].filter((response) => response.status === 200).length, 1);
  const storedRequest = await WithdrawalRequest.findById(created.body.withdrawal._id);
  const storedUser = await User.findById(customer._id);
  assert.ok(["APPROVED", "REJECTED"].includes(storedRequest.status));
  assert.equal(storedUser.withdrawalLockedBalance, 0);
  if (storedRequest.status === "APPROVED") {
    assert.equal(storedUser.walletBalance, 699.9);
    assert.equal(await LedgerEntry.countDocuments({ user: customer._id }), 1);
  } else {
    assert.equal(storedUser.walletBalance, 1000);
    assert.equal(await LedgerEntry.countDocuments({ user: customer._id }), 2);
  }
});

test("concurrent approvals cannot claim the same payout reference", async () => {
  const customerA = await createUser();
  const customerB = await createUser();
  const admin = await createUser({ role: "HEAD_OFFICE", walletBalance: 0 });
  const first = await requestWithdrawal(customerA, "payout-race-a");
  const second = await requestWithdrawal(customerB, "payout-race-b");
  const approve = (created) => call(approveWithdrawal, {
    user: admin,
    params: { id: String(created.body.withdrawal._id) },
    body: {
      payoutReference: "CONCURRENT-UNIQUE-PAYOUT",
      manualPaymentConfirmed: true,
      expectedAmount: created.body.withdrawal.amount,
      expectedAccountNumber: created.body.withdrawal.accountNumber,
    },
  });

  const responses = await Promise.all([approve(first), approve(second)]);
  assert.equal(responses.filter((response) => response.status === 200).length, 1);
  assert.equal(responses.filter((response) =>
    response.status === 409 &&
    response.body.code === "DUPLICATE_PAYOUT_REFERENCE"
  ).length, 1);
  assert.equal(
    await WithdrawalPayoutClaim.countDocuments({
      payoutReference: "CONCURRENT-UNIQUE-PAYOUT",
    }),
    1
  );
});

test("transaction failures roll back request holds, payout claims, refunds, and ledgers", async () => {
  const customer = await createUser({ walletBalance: 1000 });
  const secondCustomer = await createUser({ walletBalance: 1000 });
  const admin = await createUser({ role: "HEAD_OFFICE", walletBalance: 0 });
  const originalSave = WithdrawalRequest.prototype.save;
  WithdrawalRequest.prototype.save = async function (...args) {
    if (this.debitLedgerEntry) {
      throw new Error("Injected request persistence failure.");
    }
    return originalSave.apply(this, args);
  };
  let failedCreate;
  try {
    failedCreate = await requestWithdrawal(customer, "injected-create-failure", { amount: 300.1 });
  } finally {
    WithdrawalRequest.prototype.save = originalSave;
  }
  assert.equal(failedCreate.status, 500);
  assert.equal((await User.findById(customer._id)).walletBalance, 1000);
  assert.equal((await User.findById(customer._id)).withdrawalLockedBalance, 0);
  assert.equal(await LedgerEntry.countDocuments({ user: customer._id }), 0);
  assert.equal(await WithdrawalRequest.countDocuments({ user: customer._id }), 0);

  const forApproval = await requestWithdrawal(customer, "injected-approval-failure", { amount: 300.1 });
  const forRejection = await requestWithdrawal(secondCustomer, "injected-rejection-failure", { amount: 300.2 });
  WithdrawalRequest.prototype.save = async function (...args) {
    if (this.status === "APPROVED" || this.status === "REJECTED") {
      throw new Error("Injected finalization persistence failure.");
    }
    return originalSave.apply(this, args);
  };
  let approvalFailure;
  let rejectionFailure;
  try {
    approvalFailure = await call(approveWithdrawal, {
      user: admin,
      params: { id: String(forApproval.body.withdrawal._id) },
      body: {
        payoutReference: "INJECTED-APPROVAL-FAILURE",
        manualPaymentConfirmed: true,
        expectedAmount: forApproval.body.withdrawal.amount,
        expectedAccountNumber: forApproval.body.withdrawal.accountNumber,
      },
    });
    rejectionFailure = await call(rejectWithdrawal, {
      user: admin,
      params: { id: String(forRejection.body.withdrawal._id) },
    });
  } finally {
    WithdrawalRequest.prototype.save = originalSave;
  }

  assert.equal(approvalFailure.status, 500);
  assert.equal(rejectionFailure.status, 500);
  assert.equal((await WithdrawalRequest.findById(forApproval.body.withdrawal._id)).status, "PENDING");
  assert.equal((await WithdrawalRequest.findById(forRejection.body.withdrawal._id)).status, "PENDING");
  assert.equal((await User.findById(customer._id)).walletBalance, 699.9);
  assert.equal((await User.findById(customer._id)).withdrawalLockedBalance, 300.1);
  assert.equal((await User.findById(secondCustomer._id)).walletBalance, 699.8);
  assert.equal((await User.findById(secondCustomer._id)).withdrawalLockedBalance, 300.2);
  assert.equal(await WithdrawalPayoutClaim.countDocuments(), 0);
  assert.equal(await LedgerEntry.countDocuments({ service: "WITHDRAWAL_REFUND" }), 0);
  assert.equal(await LedgerEntry.countDocuments({ user: customer._id }), 1);
  assert.equal(await LedgerEntry.countDocuments({ user: secondCustomer._id }), 1);
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
      manualPaymentConfirmed: true,
      expectedAmount: created.body.withdrawal.amount,
      expectedAccountNumber: created.body.withdrawal.accountNumber,
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
      manualPaymentConfirmed: true,
      expectedAmount: created.body.withdrawal.amount,
      expectedAccountNumber: created.body.withdrawal.accountNumber,
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

test("manual approval requires matching explicit confirmation and persists authenticated evidence", async () => {
  const customer = await createUser();
  const admin = await createUser({ role: "HEAD_OFFICE", walletBalance: 0 });
  const created = await requestWithdrawal(customer, "withdrawal-manual-evidence");
  const params = { id: String(created.body.withdrawal._id) };

  const mismatched = await call(approveWithdrawal, {
    user: admin,
    params,
    body: {
      payoutReference: "MANUAL-PAYOUT-1",
      manualPaymentConfirmed: true,
      expectedAmount: 301,
      expectedAccountNumber: created.body.withdrawal.accountNumber,
    },
  });
  assert.equal(mismatched.status, 409);
  assert.equal(mismatched.body.code, "PAYOUT_DETAILS_MISMATCH");

  const wrongAccount = await call(approveWithdrawal, {
    user: admin,
    params,
    body: {
      payoutReference: "MANUAL-PAYOUT-2",
      manualPaymentConfirmed: true,
      expectedAmount: created.body.withdrawal.amount,
      expectedAccountNumber: "9876543210",
    },
  });
  assert.equal(wrongAccount.status, 409);
  assert.equal(wrongAccount.body.code, "PAYOUT_DETAILS_MISMATCH");

  const uncertain = await call(approveWithdrawal, {
    user: admin,
    params,
    body: {
      payoutReference: "MANUAL-PAYOUT-3",
      providerStatus: "SUCCESS",
    },
  });
  assert.equal(uncertain.status, 409);
  assert.equal(uncertain.body.code, "PAYOUT_NOT_CONFIRMED");
  const notConfirmed = await call(approveWithdrawal, {
    user: admin,
    params,
    body: {
      payoutReference: "MANUAL-PAYOUT-4",
      providerStatus: "SUCCESS",
      manualPaymentConfirmed: false,
      expectedAmount: created.body.withdrawal.amount,
      expectedAccountNumber: created.body.withdrawal.accountNumber,
    },
  });
  assert.equal(notConfirmed.status, 409);
  assert.equal(notConfirmed.body.code, "PAYOUT_NOT_CONFIRMED");

  const approved = await call(approveWithdrawal, {
    user: admin,
    params,
    body: {
      payoutReference: "MANUAL-PAYOUT-5",
      manualPaymentConfirmed: true,
      expectedAmount: created.body.withdrawal.amount,
      expectedAccountNumber: created.body.withdrawal.accountNumber,
      actor: String(customer._id),
    },
  });
  assert.equal(approved.status, 200);
  const stored = await WithdrawalRequest.findById(created.body.withdrawal._id);
  assert.equal(stored.manualPayoutEvidence.method, "MANUAL_BANK_TRANSFER");
  assert.equal(stored.manualPayoutEvidence.confirmed, true);
  assert.equal(String(stored.manualPayoutEvidence.actor), String(admin._id));
  assert.ok(stored.manualPayoutEvidence.confirmedAt instanceof Date);
  assert.equal(stored.manualPayoutEvidence.amount, created.body.withdrawal.amount);
  assert.equal(stored.manualPayoutEvidence.bankName, created.body.withdrawal.bankName);
  assert.equal(stored.manualPayoutEvidence.accountNumber, created.body.withdrawal.accountNumber);
  assert.equal(stored.manualPayoutEvidence.accountName, created.body.withdrawal.accountName);
  assert.equal(stored.manualPayoutEvidence.payoutReference, "MANUAL-PAYOUT-5");

  stored.manualPayoutEvidence.actor = customer._id;
  await stored.save();
  const immutableEvidence = await WithdrawalRequest.findById(created.body.withdrawal._id);
  assert.equal(String(immutableEvidence.manualPayoutEvidence.actor), String(admin._id));
});

test("atomic spendable-balance predicate preserves holds across concurrent withdrawals", async () => {
  const customer = await createUser({ walletBalance: 10000 });
  customer.walletHeldBalance = 4000;
  await customer.save();

  const [first, second] = await Promise.all([
    requestWithdrawal(customer, "withdrawal-concurrent-a", { amount: 4000 }),
    requestWithdrawal(customer, "withdrawal-concurrent-b", { amount: 4000 }),
  ]);
  assert.deepEqual([first.status, second.status].sort(), [201, 400]);
  const stored = await User.findById(customer._id);
  assert.equal(stored.walletBalance - stored.walletHeldBalance, 2000);
  assert.equal(await WithdrawalRequest.countDocuments({ user: customer._id }), 1);
  assert.equal(await LedgerEntry.countDocuments({ user: customer._id }), 1);
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