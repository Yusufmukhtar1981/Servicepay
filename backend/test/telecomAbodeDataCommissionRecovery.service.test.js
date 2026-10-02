const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const LedgerEntry = require("../models/ledgerEntry.model");
const Commission = require("../models/commission.model");
const ProductCommission = require("../models/productCommission.model");
const ReferralRewardReconciliation = require("../models/referralRewardReconciliation.model");
const { postDebit } = require("../services/ledger.service");
const {
  createTelecomAbodeDataSettlementService,
} = require("../services/telecomAbodeDataSettlement.service");
const {
  createTelecomAbodeDataCommissionRecoveryService,
  processTelecomAbodeDataCommissionEffect,
} = require("../services/telecomAbodeDataCommissionRecovery.service");

let replicaSet;
let sequence = 0;

const seedPendingPurchase = async (dispatchStatus = "UNKNOWN", {
  amount = 100, providerPrice = 80, agentCommission = 10, withAgent = true,
} = {}) => {
  const id = ++sequence;
  const customer = await User.create({
    fullName: `Commission Recovery Customer ${id}`,
    phone: `080${String(id).padStart(8, "0")}`,
    email: `commission-customer-${id}@test.invalid`,
    password: "test-password-only",
    role: "CUSTOMER",
    status: "ACTIVE",
    walletBalance: 500 - amount,
  });
  const agent = await User.create({
    fullName: `Commission Recovery Agent ${id}`,
    phone: `081${String(id).padStart(8, "0")}`,
    email: `commission-agent-${id}@test.invalid`,
    password: "test-password-only",
    role: "AGENT",
    status: "ACTIVE",
    walletBalance: 0,
    commissionBalance: 0,
  });
  if (withAgent) {
    await User.updateOne({ _id: customer._id }, { $set: { agentId: agent._id } });
  }
  await ProductCommission.create({
    serviceType: "DATA",
    productCode: "DATA",
    productName: "Telecom Abode DATA",
    agentCommission,
    stateCommission: 0,
    zonalCommission: 0,
    isActive: true,
  });
  const reference = `TA-COMMISSION-${id}`;
  const transaction = await Transaction.create({
    reference,
    providerRequestId: reference,
    customerId: customer._id,
    serviceType: "DATA",
    provider: "TELECOM_ABODE",
    phone: customer.phone,
    amount,
    status: "PENDING",
    dispatchStatus,
    dispatchClaimedAt: new Date(),
    providerResponse: {
      providerPrice,
      network: "01",
      planCode: "77",
    },
  });
  const debit = await postDebit({
    userId: customer._id,
    amount,
    openingBalance: 500,
    closingBalance: 500 - amount,
    service: "DATA",
    reference,
    idempotencyKey: `DATA:${reference}:DEBIT`,
    transactionId: transaction._id,
  });
  await Transaction.updateOne(
    { _id: transaction._id },
    { $set: { debitLedgerEntryId: debit.entry._id } },
  );
  return { customer, agent, transaction };
};

const successEvidence = (transaction, source) => ({
  requestId: transaction.providerRequestId,
  service: "data",
  ...(source === "WEBHOOK"
    ? { verifiedSource: true }
    : { documentedDataStatus: true }),
  providerStatus: "SUCCESS",
});

const settleSuccess = (
  service,
  transaction,
  source,
) => service.settleTelecomAbodeDataOutcome({
  requestId: transaction.providerRequestId,
  outcome: "SUCCESS",
  source,
  evidence: successEvidence(transaction, source),
});

test.before(async () => {
  replicaSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ args: ["--nounixsocket"] }],
  });
  await mongoose.connect(replicaSet.getUri(), {
    dbName: "telecom-abode-data-commission-recovery-tests",
  });
  await Promise.all([
    User,
    Transaction,
    LedgerEntry,
    Commission,
    ProductCommission,
    ReferralRewardReconciliation,
  ].map((model) => model.init()));
});

test.after(async () => {
  await mongoose.disconnect();
  await replicaSet?.stop();
});

test.beforeEach(async () => {
  await Promise.all([
    User.collection.deleteMany({}),
    Transaction.collection.deleteMany({}),
    LedgerEntry.collection.deleteMany({}),
    Commission.collection.deleteMany({}),
    ProductCommission.collection.deleteMany({}),
    ReferralRewardReconciliation.collection.deleteMany({}),
  ]);
});

for (const [source, dispatchStatus] of [
  ["REQUEST", "SENDING"],
  ["WEBHOOK", "UNKNOWN"],
  ["STATUS_QUERY", "UNKNOWN"],
]) {
  test(`${source} success durably records and processes a commission intent`, async () => {
    const { customer, agent, transaction } = await seedPendingPurchase(dispatchStatus);
    const settlement = createTelecomAbodeDataSettlementService();

    const result = await settleSuccess(settlement, transaction, source);
    const current = await Transaction.findById(transaction._id).lean();
    const commissions = await Commission.find({ transactionId: transaction._id }).lean();

    assert.equal(result.status, "SETTLED");
    assert.equal(current.status, "SUCCESSFUL");
    assert.equal(
      current.providerResponse.dataSuccessEffects.commission.status,
      "COMPLETED",
    );
    assert.equal(
      current.providerResponse.dataSuccessEffects.commission.key,
      `DATA:${transaction.reference}:COMMISSION`,
    );
    assert.equal(commissions.length, 2);
    assert.ok(commissions.every((row) => row.providerCost === 80 && row.netProfit === 20));
    assert.equal(commissions.reduce((sum, row) => sum + row.commissionAmount, 0), 20);
    assert.equal(commissions.find((row) => row.beneficiaryRole === "HEAD_OFFICE").commissionAmount, 10);
    assert.equal(commissions.find((row) => row.beneficiaryRole === "AGENT").commissionAmount, 10);
    assert.equal(await User.findById(agent._id).then((row) => row.walletBalance), 10);
    assert.equal(await User.findById(agent._id).then((row) => row.commissionBalance), 10);
    assert.equal(await User.findById(customer._id).then((row) => row.walletBalance), 400);
    assert.equal(
      await LedgerEntry.countDocuments({ transactionId: transaction._id, direction: "DEBIT" }),
      1,
    );
    assert.equal(
      await LedgerEntry.countDocuments({ transactionId: transaction._id, direction: "CREDIT" }),
      0,
    );
  });
}

test("the observed NGN97 sale and NGN90 cost record only NGN7 Head Office margin once", async () => {
  const { customer, agent, transaction } = await seedPendingPurchase("SENDING", {
    amount: 97, providerPrice: 90, agentCommission: 0, withAgent: false,
  });
  const result = await settleSuccess(createTelecomAbodeDataSettlementService(), transaction, "REQUEST");
  assert.equal(result.status, "SETTLED");
  const rows = await Commission.find({ transactionId: transaction._id }).lean();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].beneficiaryRole, "HEAD_OFFICE");
  assert.equal(rows[0].beneficiaryId, null);
  assert.equal(rows[0].transactionAmount, 97);
  assert.equal(rows[0].providerCost, 90);
  assert.equal(rows[0].netProfit, 7);
  assert.equal(rows[0].commissionAmount, 7);
  assert.equal(await User.findById(customer._id).then((row) => row.walletBalance), 403);
  assert.equal(await User.findById(agent._id).then((row) => row.walletBalance), 0);
  assert.equal(await LedgerEntry.countDocuments({ transactionId: transaction._id, direction: "DEBIT" }), 1);
  assert.equal(await LedgerEntry.countDocuments({ transactionId: transaction._id, direction: "CREDIT" }), 0);
  assert.equal((await processTelecomAbodeDataCommissionEffect(transaction._id)).status, "ALREADY_COMPLETED");
  assert.equal(await Commission.countDocuments({ transactionId: transaction._id }), 1);
});

for (const [label, providerPrice] of [
  ["missing", undefined], ["null", null], ["string", "80"], ["negative", -1],
  ["zero", 0], ["sub-cent", 0.0001], ["NaN", NaN], ["infinity", Infinity], ["above sale", 101],
]) {
  test(`invalid ${label} provider cost never creates commissions or credits a wallet`, async () => {
    const { customer, agent, transaction } = await seedPendingPurchase("SENDING", { providerPrice });
    if (label === "missing") {
      await Transaction.updateOne({ _id: transaction._id }, { $unset: { "providerResponse.providerPrice": "" } });
    }
    const result = await settleSuccess(createTelecomAbodeDataSettlementService(), transaction, "REQUEST");
    assert.equal(result.status, "SETTLED");
    const current = await Transaction.findById(transaction._id).lean();
    assert.equal(current.status, "SUCCESSFUL");
    assert.equal(current.providerResponse.dataSuccessEffects.commission.status, "PENDING");
    assert.equal(await Commission.countDocuments({ transactionId: transaction._id }), 0);
    assert.equal(await User.findById(agent._id).then((row) => row.walletBalance), 0);
    assert.equal(await User.findById(agent._id).then((row) => row.commissionBalance), 0);
    assert.equal(await User.findById(customer._id).then((row) => row.walletBalance), 400);
    assert.equal(await LedgerEntry.countDocuments({ transactionId: transaction._id, direction: "CREDIT" }), 0);
  });
}

test("configured commissions above the real DATA margin cannot create rows or wallet credits", async () => {
  const { customer, agent, transaction } = await seedPendingPurchase("SENDING", { amount: 97, providerPrice: 90 });
  const result = await settleSuccess(createTelecomAbodeDataSettlementService(), transaction, "REQUEST");
  assert.equal(result.status, "SETTLED");
  assert.equal((await Transaction.findById(transaction._id).lean()).providerResponse.dataSuccessEffects.commission.status, "PENDING");
  assert.equal(await Commission.countDocuments({ transactionId: transaction._id }), 0);
  assert.equal(await User.findById(agent._id).then((row) => row.walletBalance), 0);
  assert.equal(await User.findById(customer._id).then((row) => row.walletBalance), 403);
});

for (const [amount, providerPrice] of [[0.01, 0.009], [97, 97.004]]) {
  test(`raw cost ${providerPrice} on sale ${amount} cannot bypass bounds through rounding`, async () => {
    const { agent, transaction } = await seedPendingPurchase("SENDING", {
      amount, providerPrice, agentCommission: 0,
    });
    await settleSuccess(createTelecomAbodeDataSettlementService(), transaction, "REQUEST");
    assert.equal((await Transaction.findById(transaction._id).lean()).providerResponse.dataSuccessEffects.commission.status, "PENDING");
    assert.equal(await Commission.countDocuments({ transactionId: transaction._id }), 0);
    assert.equal(await User.findById(agent._id).then((row) => row.walletBalance), 0);
    assert.equal(await LedgerEntry.countDocuments({ transactionId: transaction._id, direction: "CREDIT" }), 0);
  });
}

test("completed legacy accounting remains untouched rather than being rewritten or paid again", async () => {
  const { agent, transaction } = await seedPendingPurchase("SENDING");
  await settleSuccess(createTelecomAbodeDataSettlementService(), transaction, "REQUEST");
  await Commission.updateOne({ transactionId: transaction._id, beneficiaryRole: "HEAD_OFFICE" },
    { $set: { providerCost: 0, netProfit: 100, commissionAmount: 90 } });
  const before = await Commission.find({ transactionId: transaction._id }).sort({ _id: 1 }).lean();
  const txBefore = await Transaction.findById(transaction._id).lean();
  assert.equal((await processTelecomAbodeDataCommissionEffect(transaction._id)).status, "ALREADY_COMPLETED");
  assert.deepEqual(await Commission.find({ transactionId: transaction._id }).sort({ _id: 1 }).lean(), before);
  assert.deepEqual(await Transaction.findById(transaction._id).lean(), txBefore);
  assert.equal(await User.findById(agent._id).then((row) => row.walletBalance), 10);
});

test("zero DATA margin with no configured commission completes without fabricated profit", async () => {
  const { agent, transaction } = await seedPendingPurchase("SENDING", { providerPrice: 100, agentCommission: 0 });
  await settleSuccess(createTelecomAbodeDataSettlementService(), transaction, "REQUEST");
  assert.equal((await Transaction.findById(transaction._id).lean()).providerResponse.dataSuccessEffects.commission.status, "COMPLETED");
  assert.equal(await Commission.countDocuments({ transactionId: transaction._id }), 0);
  assert.equal(await User.findById(agent._id).then((row) => row.walletBalance), 0);
});

test("zero DATA margin does not silently mark configured beneficiary commissions paid", async () => {
  const { agent, transaction } = await seedPendingPurchase("SENDING", { providerPrice: 100 });
  await settleSuccess(createTelecomAbodeDataSettlementService(), transaction, "REQUEST");
  assert.equal((await Transaction.findById(transaction._id).lean()).providerResponse.dataSuccessEffects.commission.status, "PENDING");
  assert.equal(await Commission.countDocuments({ transactionId: transaction._id }), 0);
  assert.equal(await User.findById(agent._id).then((row) => row.walletBalance), 0);
});

test("a process interruption after terminal commit leaves a retryable intent and retry pays once", async () => {
  const { agent, transaction } = await seedPendingPurchase();
  await Transaction.updateOne(
    { _id: transaction._id },
    { $set: { "providerResponse.dataSuccessEffectsStarted": true } },
  );
  const interruptedSettlement = createTelecomAbodeDataSettlementService({
    processSuccessCommissionEffect: async () => {
      throw new Error("injected interruption before effect processing");
    },
  });

  const result = await settleSuccess(interruptedSettlement, transaction, "WEBHOOK");
  let current = await Transaction.findById(transaction._id).lean();
  assert.equal(result.status, "SETTLED");
  assert.equal(current.status, "SUCCESSFUL");
  assert.equal(current.providerResponse.dataSuccessEffectsStarted, true);
  assert.equal(
    current.providerResponse.dataSuccessEffects.commission.status,
    "PENDING",
  );
  assert.equal(await Commission.countDocuments({ transactionId: transaction._id }), 0);
  assert.equal(await User.findById(agent._id).then((row) => row.walletBalance), 0);

  const recovered = await processTelecomAbodeDataCommissionEffect(transaction._id);
  assert.equal(recovered.status, "COMPLETED");
  current = await Transaction.findById(transaction._id).lean();
  assert.equal(current.providerResponse.dataSuccessEffects.commission.status, "COMPLETED");
  assert.equal(await Commission.countDocuments({ transactionId: transaction._id }), 2);
  assert.equal(await User.findById(agent._id).then((row) => row.walletBalance), 10);

  const alreadyPaidRetry = await processTelecomAbodeDataCommissionEffect(transaction._id);
  assert.equal(alreadyPaidRetry.status, "ALREADY_COMPLETED");
  assert.equal(await Commission.countDocuments({ transactionId: transaction._id }), 2);
  assert.equal(await User.findById(agent._id).then((row) => row.walletBalance), 10);
});

test("concurrent recovery claims and duplicate callbacks cannot pay commission twice", async () => {
  const { agent, transaction } = await seedPendingPurchase();
  const interruptedSettlement = createTelecomAbodeDataSettlementService({
    processSuccessCommissionEffect: async () => {},
  });
  const first = await settleSuccess(interruptedSettlement, transaction, "WEBHOOK");
  const duplicate = await settleSuccess(interruptedSettlement, transaction, "WEBHOOK");
  assert.equal(first.status, "SETTLED");
  assert.equal(duplicate.status, "ALREADY_TERMINAL");

  const recovery = createTelecomAbodeDataCommissionRecoveryService();
  const [left, right] = await Promise.all([
    recovery.processTelecomAbodeDataCommissionEffect(transaction._id),
    recovery.processTelecomAbodeDataCommissionEffect(transaction._id),
  ]);
  assert.ok(["COMPLETED", "RUNNING"].includes(left.status));
  assert.ok(["COMPLETED", "RUNNING"].includes(right.status));
  assert.equal(await Commission.countDocuments({ transactionId: transaction._id }), 2);
  assert.equal(await User.findById(agent._id).then((row) => row.walletBalance), 10);
  const current = await Transaction.findById(transaction._id).lean();
  assert.equal(current.providerResponse.dataSuccessEffects.commission.status, "COMPLETED");
});

test("recovery ignores terminal transactions without a new Telecom Abode DATA intent", async () => {
  const { agent, transaction } = await seedPendingPurchase();
  await Transaction.updateOne(
    { _id: transaction._id },
    { $set: { status: "SUCCESSFUL", dispatchStatus: "SUCCEEDED" } },
  );

  const recovered = await createTelecomAbodeDataCommissionRecoveryService()
    .processPendingTelecomAbodeDataCommissions(50);
  assert.equal(recovered.length, 0);
  assert.equal(await Commission.countDocuments({ transactionId: transaction._id }), 0);
  assert.equal(await User.findById(agent._id).then((row) => row.walletBalance), 0);
});

test("a failure between commission insert and wallet credit rolls back both then retries", async () => {
  const { agent, transaction } = await seedPendingPurchase();
  const interruptedSettlement = createTelecomAbodeDataSettlementService({
    processSuccessCommissionEffect: async () => {},
  });
  await settleSuccess(interruptedSettlement, transaction, "STATUS_QUERY");

  const failingRecovery = createTelecomAbodeDataCommissionRecoveryService({
    afterCommissionRecord: async ({ record }) => {
      if (record.beneficiaryId) {
        throw new Error("injected failure between row and wallet update");
      }
    },
  });
  const failed = await failingRecovery
    .processTelecomAbodeDataCommissionEffect(transaction._id);
  assert.equal(failed.status, "RETRY_PENDING");
  assert.equal(await Commission.countDocuments({ transactionId: transaction._id }), 0);
  assert.equal(await User.findById(agent._id).then((row) => row.walletBalance), 0);
  let current = await Transaction.findById(transaction._id).lean();
  assert.equal(current.providerResponse.dataSuccessEffects.commission.status, "PENDING");

  await Transaction.updateOne(
    { _id: transaction._id },
    {
      $set: {
        "providerResponse.dataSuccessEffects.commission.nextAttemptAt": new Date(0),
      },
    },
  );
  const retried = await processTelecomAbodeDataCommissionEffect(transaction._id);
  assert.equal(retried.status, "COMPLETED");
  current = await Transaction.findById(transaction._id).lean();
  assert.equal(current.providerResponse.dataSuccessEffects.commission.status, "COMPLETED");
  assert.equal(await Commission.countDocuments({ transactionId: transaction._id }), 2);
  assert.equal(await User.findById(agent._id).then((row) => row.walletBalance), 10);
});