const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const axios = require("axios");

const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const BankTransfer = require("../models/bankTransfer.model");
const LedgerEntry = require("../models/ledgerEntry.model");
const controller = require("../controllers/bankTransfer.controller");

const {
  createTransferRecords,
  refundBankTransfer,
  markSuccessful,
  markProcessing,
  markFailed,
} = controller.__testOnly;

let mongo;
let sequence = 0;
const models = [User, Transaction, BankTransfer, LedgerEntry];

test.before(async () => {
  mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  await mongoose.connect(mongo.getUri(), { dbName: "bank-transfer-safety" });
  await Promise.all(models.map((model) => model.init()));
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

test.beforeEach(async () => {
  sequence += 1;
  await Promise.all(models.map((model) => model.collection.deleteMany({})));
});

let customerSequence = 0;
const customer = async (balance = 1000) => User.create({
  fullName: `Transfer Test ${sequence}`,
  phone: `080${String(++customerSequence).padStart(8, "0")}`,
  password: "password",
  transactionPin: "1234",
  transactionPinSet: true,
  walletBalance: balance,
  status: "ACTIVE",
});

const create = async ({ balance = 1000, requestId = `request-${sequence}` } = {}) => {
  const user = await customer(balance);
  const reference = `SQUAD-${sequence}-${requestId}`;
  const result = await createTransferRecords({
    userId: user._id,
    bank: { code: "000001", name: "Sterling Bank" },
    accountNumber: "0123456789",
    accountName: "Safety Recipient",
    narration: "Safety test",
    amount: 100,
    transferFee: 10,
    totalDebit: 110,
    reference,
    clientRequestId: requestId,
  });
  return { ...result, originalBalance: balance };
};

const consistency = async (recordId, expected) => {
  const record = await BankTransfer.findById(recordId).lean();
  const transaction = await Transaction.findById(record.transactionId).lean();
  assert.equal(record.status, expected);
  assert.equal(transaction.status, expected);
  assert.equal(record.reference, transaction.reference);
  return record;
};

test("A/B: pending-success settlement is synchronized and posts exactly one debit", async () => {
  const { record, customer: debited } = await create();
  assert.equal(debited.walletBalance, 890);
  assert.equal(await LedgerEntry.countDocuments({ reference: record.reference }), 1);

  await markProcessing({ record, providerPayload: { status: "pending" } });
  const pending = await BankTransfer.findById(record._id);
  await markSuccessful({ record: pending, providerPayload: { success: true, data: { status: "success" } } });

  await consistency(record._id, "SUCCESSFUL");
  assert.equal(await LedgerEntry.countDocuments({ reference: record.reference, direction: "DEBIT" }), 1);
  assert.equal(await LedgerEntry.countDocuments({ reference: record.reference, direction: "CREDIT" }), 0);
});

test("B/C: failure holds funds until an authoritative reversal, which refunds once", async () => {
  const { record, customer: debited } = await create();
  await markFailed({
    record,
    reason: "provider failed",
    providerPayload: { status: "failed" },
  });

  await consistency(record._id, "FAILED");
  let user = await User.findById(debited._id);
  assert.equal(user.walletBalance, 890);
  assert.equal(
    await LedgerEntry.countDocuments({
      reference: record.reference,
      direction: "CREDIT",
    }),
    0
  );

  await Promise.all([
    refundBankTransfer({ bankTransferId: record._id, reason: "reversed", providerPayload: { status: "reversed" } }),
    refundBankTransfer({ bankTransferId: record._id, reason: "reversed", providerPayload: { status: "reversed" } }),
  ]);

  await consistency(record._id, "REFUNDED");
  user = await User.findById(debited._id);
  assert.equal(user.walletBalance, 1000);
  assert.equal(await LedgerEntry.countDocuments({ reference: record.reference, direction: "DEBIT" }), 1);
  assert.equal(await LedgerEntry.countDocuments({ reference: record.reference, direction: "CREDIT" }), 1);
});

test("I: a late authoritative success recovers FAILED without refunding", async () => {
  const { record, customer: debited } = await create();
  await markFailed({
    record,
    reason: "provider initially failed",
    providerPayload: { status: "failed" },
  });

  const failed = await consistency(
    record._id,
    "FAILED"
  );
  await Promise.all([
    markSuccessful({
      record: failed,
      providerPayload: {
        success: true,
        status: "success",
      },
    }),
    markSuccessful({
      record: failed,
      providerPayload: {
        success: true,
        status: "success",
      },
    }),
  ]);

  await consistency(record._id, "SUCCESSFUL");
  const user = await User.findById(debited._id);
  assert.equal(user.walletBalance, 890);
  assert.equal(
    await LedgerEntry.countDocuments({
      reference: record.reference,
      direction: "DEBIT",
    }),
    1
  );
  assert.equal(
    await LedgerEntry.countDocuments({
      reference: record.reference,
      direction: "CREDIT",
    }),
    0
  );
});

test("D/E/F: concurrent success/reversal has one consistent wallet outcome and late success cannot undo a refund", async () => {
  const { record, customer: debited } = await create();
  await Promise.all([
    markSuccessful({ record, providerPayload: { success: true, status: "success" } }),
    refundBankTransfer({ bankTransferId: record._id, reason: "reversed", providerPayload: { status: "reversed" } }),
  ]);

  const settled = await BankTransfer.findById(record._id);
  assert.ok(["SUCCESSFUL", "REFUNDED"].includes(settled.status));
  await consistency(record._id, settled.status);
  const user = await User.findById(debited._id);
  const credits = await LedgerEntry.countDocuments({
    reference: record.reference,
    direction: "CREDIT",
  });
  assert.equal(
    user.walletBalance,
    settled.status === "REFUNDED" ? 1000 : 890
  );
  assert.equal(
    credits,
    settled.status === "REFUNDED" ? 1 : 0
  );

  if (settled.status === "REFUNDED") {
    await markSuccessful({ record: settled, providerPayload: { success: true, status: "success" } });
    await consistency(record._id, "REFUNDED");
  }
});

test("G/H: duplicate success (webhook/requery equivalent) is idempotent and preserves record integrity", async () => {
  const { record } = await create();
  await Promise.all([
    markSuccessful({ record, providerPayload: { success: true, status: "success" } }),
    markSuccessful({ record, providerPayload: { success: true, status: "success" } }),
  ]);

  const final = await consistency(record._id, "SUCCESSFUL");
  assert.equal(final.refundProcessed, false);
  assert.equal(final.refundedAmount, 0);
  assert.equal(await LedgerEntry.countDocuments({ reference: record.reference }), 1);
});

test("G/H controller paths: duplicate signed webhook settles once and terminal requery is provider-free", async () => {
  const { record } = await create();
  process.env.SQUAD_SECRET_KEY = "test-secret";
  process.env.SQUAD_WEBHOOK_SECRET = "test-secret";
  process.env.SQUAD_MERCHANT_ID = "TEST";
  const payload = {
    success: true,
    data: { transaction_reference: record.reference, status: "success" },
  };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const signature = require("crypto")
    .createHmac("sha512", "test-secret")
    .update(rawBody)
    .digest("hex");
  const callWebhook = async () => {
    const result = {};
    await controller.squadWebhook({
      body: payload, rawBody,
      headers: { "x-squad-encrypted-body": signature },
    }, {
      status(code) { result.status = code; return this; },
      json(body) { result.body = body; return this; },
    });
    return result;
  };
  assert.equal((await callWebhook()).status, 200);
  assert.equal((await callWebhook()).status, 200);
  await consistency(record._id, "SUCCESSFUL");
  assert.equal(await LedgerEntry.countDocuments({ reference: record.reference }), 1);

  const originalPost = axios.post;
  let providerCalls = 0;
  axios.post = async () => { providerCalls += 1; throw new Error("must not call"); };
  try {
    const result = {};
    await controller.requeryBankTransfer({
      user: { _id: record.sender }, params: {}, body: { reference: record.reference },
    }, {
      status(code) { result.status = code; return this; },
      json(body) { result.body = body; return this; },
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.data.status, "SUCCESSFUL");
    assert.equal(providerCalls, 0);
  } finally {
    axios.post = originalPost;
  }
});

test("explicit failed status overrides a successful envelope in initiation, requery, and webhook", async () => {
  const originalPost = axios.post;
  process.env.SQUAD_TRANSFER_ENABLED = "true";
  process.env.SQUAD_SECRET_KEY = "test-secret";
  process.env.SQUAD_WEBHOOK_SECRET = "test-secret";
  process.env.SQUAD_MERCHANT_ID = "TEST";
  const failedEnvelope = {
    success: true,
    data: { status: "failed" },
  };

  try {
    let payoutCalls = 0;
    axios.post = async (url) => {
      if (url.endsWith("/lookup")) {
        return {
          status: 200,
          data: {
            success: true,
            data: {
              account_name: "Safety Recipient",
              account_number: "0123456789",
            },
          },
        };
      }
      payoutCalls += 1;
      return { status: 200, data: failedEnvelope };
    };

    const user = await customer();
    const initiation = {};
    await controller.initiateBankTransfer(
      {
        user: { _id: user._id },
        body: {
          bankCode: "000001",
          accountNumber: "0123456789",
          amount: 100,
          pin: "1234",
          clientRequestId: "failed-envelope-initiation",
        },
        get: () => undefined,
      },
      {
        status(code) {
          initiation.status = code;
          return this;
        },
        json(body) {
          initiation.body = body;
          return this;
        },
      }
    );
    assert.equal(initiation.status, 202);
    assert.equal(initiation.body.status, "FAILED");
    assert.equal(payoutCalls, 1);

    let record = await BankTransfer.findOne({
      clientRequestId: "failed-envelope-initiation",
    });
    await consistency(record._id, "FAILED");
    assert.equal((await User.findById(user._id)).walletBalance, 900);
    assert.equal(
      await LedgerEntry.countDocuments({
        reference: record.reference,
        direction: "CREDIT",
      }),
      0
    );

    axios.post = async () => ({
      status: 200,
      data: failedEnvelope,
    });
    const requery = {};
    await controller.requeryBankTransfer(
      {
        user: { _id: user._id },
        params: {},
        body: { reference: record.reference },
      },
      {
        status(code) {
          requery.status = code;
          return this;
        },
        json(body) {
          requery.body = body;
          return this;
        },
      }
    );
    assert.equal(requery.status, 200);
    assert.equal(requery.body.data.status, "FAILED");
    assert.equal(
      await LedgerEntry.countDocuments({
        reference: record.reference,
        direction: "CREDIT",
      }),
      0
    );

    const webhookBody = JSON.stringify({
      ...failedEnvelope,
      transaction_reference: record.reference,
    });
    const signature = require("node:crypto")
      .createHmac("sha512", "test-secret")
      .update(Buffer.from(webhookBody))
      .digest("hex");
    const webhook = {};
    await controller.squadWebhook(
      {
        body: JSON.parse(webhookBody),
        rawBody: Buffer.from(webhookBody),
        headers: {
          "x-squad-encrypted-body": signature,
        },
      },
      {
        status(code) {
          webhook.status = code;
          return this;
        },
        json(body) {
          webhook.body = body;
          return this;
        },
      }
    );
    assert.equal(webhook.status, 200);
    record = await consistency(record._id, "FAILED");
    assert.equal(record.refundProcessed, false);
    assert.equal((await User.findById(user._id)).walletBalance, 900);

    const reversedBody = JSON.stringify({
      success: true,
      data: { status: "reversed" },
      transaction_reference: record.reference,
    });
    const reversedSignature = require("node:crypto")
      .createHmac("sha512", "test-secret")
      .update(Buffer.from(reversedBody))
      .digest("hex");
    await controller.squadWebhook(
      {
        body: JSON.parse(reversedBody),
        rawBody: Buffer.from(reversedBody),
        headers: {
          "x-squad-encrypted-body": reversedSignature,
        },
      },
      {
        status() {
          return this;
        },
        json() {
          return this;
        },
      }
    );
    await consistency(record._id, "REFUNDED");
    assert.equal((await User.findById(user._id)).walletBalance, 1000);
    assert.equal(
      await LedgerEntry.countDocuments({
        reference: record.reference,
        direction: "CREDIT",
      }),
      1
    );
  } finally {
    axios.post = originalPost;
  }
});

test("I: initiation timeout is PROCESSING and a same-ID replay does not execute Squad twice", async () => {
  const originalPost = axios.post;
  let transferCalls = 0;
  axios.post = async (url) => {
    if (url.endsWith("/lookup")) {
      return { status: 200, data: { success: true, data: { account_name: "Safety Recipient", account_number: "0123456789" } } };
    }
    transferCalls += 1;
    const error = new Error("timeout");
    error.code = "ECONNABORTED";
    throw error;
  };
  process.env.SQUAD_TRANSFER_ENABLED = "true";
  process.env.SQUAD_SECRET_KEY = "test-secret";
  process.env.SQUAD_MERCHANT_ID = "TEST";

  try {
    const user = await customer();
    const req = {
      user: { _id: user._id },
      body: { bankCode: "000001", accountNumber: "0123456789", amount: 100, pin: "1234", clientRequestId: "timeout-id" },
      get: () => undefined,
    };
    const call = async () => {
      const result = {};
      await controller.initiateBankTransfer(req, {
        status(code) { result.status = code; return this; },
        json(body) { result.body = body; return this; },
      });
      return result;
    };
    const first = await call();
    const replay = await call();
    assert.equal(first.status, 202);
    assert.equal(first.body.status, "PROCESSING");
    assert.equal(replay.status, 202);
    assert.equal(replay.body.idempotent, true);
    assert.equal(transferCalls, 1);
    const record = await BankTransfer.findOne({ clientRequestId: "timeout-id" });
    assert.equal(record.status, "PROCESSING");
    const transaction = await Transaction.findById(record.transactionId);
    assert.equal(transaction.status, "PENDING");
    assert.equal(await LedgerEntry.countDocuments({ reference: record.reference }), 1);
  } finally {
    axios.post = originalPost;
  }
});

test("J: sender-scoped request IDs allow another sender but reject duplicate transfer records", async () => {
  const first = await create({ requestId: "same-client-id" });
  const second = await customer();
  await createTransferRecords({
    userId: second._id, bank: { code: "000001", name: "Sterling Bank" },
    accountNumber: "0123456789", accountName: "Safety Recipient", narration: "Safety test",
    amount: 100, transferFee: 10, totalDebit: 110, reference: `SQUAD-${sequence}-second`,
    clientRequestId: "same-client-id",
  });
  await assert.rejects(() => createTransferRecords({
    userId: first.customer._id, bank: { code: "000001", name: "Sterling Bank" },
    accountNumber: "0123456789", accountName: "Safety Recipient", narration: "Safety test",
    amount: 100, transferFee: 10, totalDebit: 110, reference: `SQUAD-${sequence}-duplicate`,
    clientRequestId: "same-client-id",
  }), /duplicate key/i);
});