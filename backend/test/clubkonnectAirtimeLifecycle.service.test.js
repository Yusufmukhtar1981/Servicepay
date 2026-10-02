const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const LedgerEntry = require("../models/ledgerEntry.model");
const Commission = require("../models/commission.model");
const ProductCommission = require("../models/productCommission.model");
const {
  createClubkonnectAirtimeLifecycleService,
} = require("../services/clubkonnectAirtimeLifecycle.service");

let replicaSet;
let fixtureSequence = 0;
let referenceSequence = 0;

const primaryModels = [
  User,
  Transaction,
  LedgerEntry,
  Commission,
  ProductCommission,
];

const providerEvidence = ({
  source,
  outcome,
  requestId,
  orderId = "",
  statusCode = "100",
  orderStatus = "ORDER_RECEIVED",
  providerCost = null,
  authoritative = true,
  reasonCode = "",
}) => ({
  source,
  outcome,
  authoritative,
  reasonCode,
  requestId,
  providerOrderId: orderId,
  providerCost,
  httpStatus: 200,
  body: {
    statusCode,
    orderStatus,
    orderId,
    requestId,
    amountCharged: providerCost,
  },
});

const defaultProvider = () => {
  const trustedResults = new WeakSet();
  const markTestProviderResult = (result) => {
    trustedResults.add(result);
    return result;
  };
  return {
  purchaseCalls: 0,
  queryCalls: 0,
  purchaseResult: null,
  queryResult: null,
  markTestProviderResult,
  isVerifiedEvidence: (result) =>
    Boolean(result && typeof result === "object" && trustedResults.has(result)),
  async purchase(input) {
    this.purchaseCalls += 1;
    return markTestProviderResult(
      this.purchaseResult
        ? this.purchaseResult(input)
        : providerEvidence({
          source: "INITIAL_REQUEST",
          outcome: "PENDING",
          requestId: input.requestId,
          }),
    );
  },
  async query(input) {
    this.queryCalls += 1;
    return markTestProviderResult(
      this.queryResult
        ? this.queryResult(input)
        : providerEvidence({
          source: "STATUS_QUERY",
          outcome: "UNKNOWN",
          requestId: input.requestId,
          orderId: input.orderId || "",
          statusCode: "",
          orderStatus: "UNKNOWN",
          authoritative: false,
          }),
    );
  },
  };
};

const documentHash = (document) =>
  crypto.createHash("sha256").update(JSON.stringify(document)).digest("hex");

const createService = (provider, options = {}) =>
  createClubkonnectAirtimeLifecycleService({
    provider,
    makeReference: () => `AIR-TEST-${++referenceSequence}`,
    ...options,
  });

const createCustomer = async ({ walletBalance = 500, withAgent = false } = {}) => {
  const sequence = ++fixtureSequence;
  const customer = await User.create({
    fullName: `Airtime lifecycle customer ${sequence}`,
    phone: `080${String(sequence).padStart(8, "0")}`,
    email: `airtime-lifecycle-customer-${sequence}@test.invalid`,
    password: "test-password-only",
    role: "CUSTOMER",
    status: "ACTIVE",
    walletBalance,
    commissionBalance: 0,
  });
  let agent = null;
  if (withAgent) {
    agent = await User.create({
      fullName: `Airtime lifecycle agent ${sequence}`,
      phone: `081${String(sequence).padStart(8, "0")}`,
      email: `airtime-lifecycle-agent-${sequence}@test.invalid`,
      password: "test-password-only",
      role: "AGENT",
      status: "ACTIVE",
      walletBalance: 0,
      commissionBalance: 0,
    });
    await User.updateOne({ _id: customer._id }, { $set: { agentId: agent._id } });
  }
  return { customer, agent };
};

const createAirtimeSetting = async ({
  agentCommission = 0.9,
  stateCommission = 0.54,
  zonalCommission = 0.36,
} = {}) =>
  ProductCommission.create({
    serviceType: "AIRTIME",
    productCode: "AIRTIME",
    productName: "ClubKonnect Airtime",
    headOfficeCommission: 0,
    agentCommission,
    stateCommission,
    zonalCommission,
    isActive: true,
  });

const buy = (customer, key = "airtime-request-001", overrides = {}) => ({
  customerId: customer._id,
  network: "MTN",
  phone: "08012345678",
  amount: 100,
  idempotencyKey: key,
  ...overrides,
});

test.before(async () => {
  if (process.env.NODE_ENV && process.env.NODE_ENV !== "test") {
    throw new Error(
      "Airtime lifecycle integration tests require NODE_ENV=test or unset.",
    );
  }
  if (["MONGODB_URI", "MONGO_URI", "DATABASE_URL", "MONGO_URL"].some(key => process.env[key])) {
    throw new Error("Airtime tests must not inherit database credentials.");
  }
  replicaSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ args: ["--nounixsocket"] }],
  });
  await mongoose.connect(replicaSet.getUri(), {
    dbName: "clubkonnect-airtime-lifecycle-tests",
  });
  await Promise.all(primaryModels.map((model) => model.init()));
});

test.after(async () => {
  await mongoose.disconnect();
  await replicaSet?.stop();
});

test.beforeEach(async () => {
  // Test-only fixture cleanup; ledger writes in assertions stay immutable.
  await Promise.all(
    primaryModels.map((model) => model.collection.deleteMany({})),
  );
});

test("admission atomically persists a single debit and stores only a hash of the client key", async () => {
  const { customer } = await createCustomer();
  const service = createService(defaultProvider());
  const key = "airtime-request-001";
  const result = await service.admitPurchase(buy(customer, key));

  assert.equal(result.created, true);
  assert.equal(result.walletBalance, 400);
  assert.equal(result.transaction.serviceType, "AIRTIME");
  assert.equal(result.transaction.provider, "CLUBKONNECT");
  assert.equal(result.transaction.status, "PENDING");
  assert.equal(result.transaction.dispatchStatus, "READY");
  assert.equal(result.transaction.providerResponse.airtimeLifecycle.version, 1);
  assert.equal(
    result.transaction.idempotencyKey,
    crypto.createHash("sha256").update(key).digest("hex"),
  );
  assert.notEqual(result.transaction.idempotencyKey, key);
  assert.equal(
    typeof result.transaction.providerResponse.airtimeLifecycle.requestFingerprint,
    "string",
  );
  assert.equal(await LedgerEntry.countDocuments({ direction: "DEBIT" }), 1);
  assert.equal(await LedgerEntry.countDocuments({ transactionId: result.transaction._id }), 1);
  assert.equal(await User.findById(customer._id).then((row) => row.walletBalance), 400);
});

test("same idempotency key and fingerprint replay the existing transaction without a second debit or provider call", async () => {
  const { customer } = await createCustomer();
  const provider = defaultProvider();
  const service = createService(provider);
  const first = await service.executePurchase(buy(customer));
  const second = await service.executePurchase(buy(customer));

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.transaction._id.toString(), first.transaction._id.toString());
  assert.equal(provider.purchaseCalls, 1);
  assert.equal(provider.queryCalls, 0);
  assert.equal(first.transaction.status, "PENDING");
  assert.equal(await Transaction.countDocuments({ serviceType: "AIRTIME" }), 1);
  assert.equal(await LedgerEntry.countDocuments({ direction: "DEBIT" }), 1);
  assert.equal(await User.findById(customer._id).then((row) => row.walletBalance), 400);
});

test("same idempotency key with different normalized purchase data is rejected", async () => {
  const { customer } = await createCustomer();
  const service = createService(defaultProvider());
  await service.admitPurchase(buy(customer));

  await assert.rejects(
    service.admitPurchase(
      buy(customer, "airtime-request-001", { network: "AIRTEL" }),
    ),
    (error) =>
      error.status === 409 && error.code === "AIRTIME_IDEMPOTENCY_CONFLICT",
  );
  assert.equal(await Transaction.countDocuments({ serviceType: "AIRTIME" }), 1);
  assert.equal(await LedgerEntry.countDocuments({ direction: "DEBIT" }), 1);
  assert.equal(await User.findById(customer._id).then((row) => row.walletBalance), 400);
});

test("insufficient balance or debit-ledger failure rolls back admission and wallet movement", async () => {
  const { customer } = await createCustomer({ walletBalance: 40 });
  const service = createService(defaultProvider());
  await assert.rejects(
    service.admitPurchase(buy(customer)),
    (error) => error.code === "INSUFFICIENT_WALLET_BALANCE",
  );
  assert.equal(await Transaction.countDocuments({ serviceType: "AIRTIME" }), 0);
  assert.equal(await LedgerEntry.countDocuments(), 0);
  assert.equal(await User.findById(customer._id).then((row) => row.walletBalance), 40);

  const funded = await User.create({
    fullName: "Airtime ledger rollback customer",
    phone: "08099999999",
    email: "airtime-ledger-rollback@test.invalid",
    password: "test-password-only",
    role: "CUSTOMER",
    status: "ACTIVE",
    walletBalance: 500,
  });
  const failingService = createService(defaultProvider(), {
    ledger: {
      postDebit: async () => {
        throw new Error("injected ledger failure");
      },
    },
  });
  await assert.rejects(
    failingService.admitPurchase(buy(funded)),
    /injected ledger failure/,
  );
  assert.equal(await Transaction.countDocuments({ serviceType: "AIRTIME" }), 0);
  assert.equal(await LedgerEntry.countDocuments(), 0);
  assert.equal(await User.findById(funded._id).then((row) => row.walletBalance), 500);
});

test("concurrent retries for one request key admit and dispatch at most once", async () => {
  const { customer } = await createCustomer();
  const provider = defaultProvider();
  provider.purchase = async ({ requestId: id }) => {
    provider.purchaseCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 15));
    return provider.markTestProviderResult(providerEvidence({
      source: "INITIAL_REQUEST",
      outcome: "PENDING",
      requestId: id,
    }));
  };
  const service = createService(provider);

  const [left, right] = await Promise.all([
    service.executePurchase(buy(customer)),
    service.executePurchase(buy(customer)),
  ]);

  assert.equal([left, right].filter((result) => result.created).length, 1);
  assert.equal(provider.purchaseCalls, 1);
  assert.equal(await Transaction.countDocuments({ serviceType: "AIRTIME" }), 1);
  assert.equal(await LedgerEntry.countDocuments({ direction: "DEBIT" }), 1);
  assert.equal(await User.findById(customer._id).then((row) => row.walletBalance), 400);
});

test("a timeout/unknown outcome is never resent by a duplicate request", async () => {
  const { customer } = await createCustomer();
  const provider = defaultProvider();
  provider.purchaseResult = ({ requestId }) =>
    providerEvidence({
      source: "INITIAL_REQUEST",
      outcome: "UNKNOWN",
      requestId,
      statusCode: "",
      orderStatus: "UNKNOWN",
      authoritative: false,
      reasonCode: "PROVIDER_TRANSPORT_UNCERTAIN",
    });
  const service = createService(provider);

  const first = await service.executePurchase(buy(customer));
  const retry = await service.executePurchase(buy(customer));
  const persisted = await Transaction.findById(first.transaction._id).lean();

  assert.equal(first.transaction.status, "PENDING");
  assert.equal(retry.created, false);
  assert.equal(provider.purchaseCalls, 1);
  assert.equal(persisted.dispatchStatus, "UNKNOWN");
  assert.ok(persisted.dispatchStartedAt);
  assert.equal(await LedgerEntry.countDocuments({ direction: "DEBIT" }), 1);
  assert.equal(await LedgerEntry.countDocuments({ direction: "CREDIT" }), 0);
  assert.equal(await User.findById(customer._id).then((row) => row.walletBalance), 400);
});

test("dispatch can be claimed and started only once", async () => {
  const { customer } = await createCustomer();
  const service = createService(defaultProvider());
  const { transaction } = await service.admitPurchase(buy(customer));

  const claim = await service.claimDispatch(transaction._id);
  assert.ok(claim);
  assert.equal(claim.dispatchStatus, "CLAIMED");
  assert.equal(await service.claimDispatch(transaction._id), null);

  const started = await service.markDispatchStarted(transaction._id);
  assert.ok(started);
  assert.equal(started.dispatchStatus, "SENDING");
  assert.ok(started.dispatchStartedAt);
  assert.equal(await service.markDispatchStarted(transaction._id), null);
  assert.equal(await LedgerEntry.countDocuments({ direction: "DEBIT" }), 1);
});

test("legacy versions and missing debit custody never trigger a provider lookup or lifecycle mutation", async () => {
  const { customer } = await createCustomer();
  const provider = defaultProvider();
  const service = createService(provider);
  const cases = [
    {
      key: "airtime-legacy-version",
      update: { $set: { "providerResponse.airtimeLifecycle.version": 0 } },
    },
    {
      key: "airtime-missing-debit-custody",
      update: { $unset: { debitLedgerEntryId: "" } },
    },
  ];

  for (const item of cases) {
    const admitted = await service.admitPurchase(buy(customer, item.key));
    await Transaction.updateOne({ _id: admitted.transaction._id }, item.update);
    const before = await Transaction.findById(admitted.transaction._id).lean();
    const beforeHash = documentHash(before);

    await assert.rejects(
      service.reconcilePendingPurchase({ transactionId: admitted.transaction._id }),
      (error) =>
        ["AIRTIME_LIFECYCLE_NOT_RECONCILABLE", "AIRTIME_DEBIT_CUSTODY_MISMATCH"].includes(
          error.code,
        ),
    );
    await assert.rejects(
      service.markUnknown(admitted.transaction._id),
      (error) =>
        ["AIRTIME_LIFECYCLE_NOT_RECONCILABLE", "AIRTIME_DEBIT_CUSTODY_MISMATCH"].includes(
          error.code,
        ),
    );
    assert.equal(
      documentHash(await Transaction.findById(admitted.transaction._id).lean()),
      beforeHash,
    );
  }

  assert.equal(provider.queryCalls, 0);
  assert.equal(await User.findById(customer._id).then((row) => row.walletBalance), 300);
  assert.equal(await LedgerEntry.countDocuments({ direction: "CREDIT" }), 0);
});

test("authenticated terminal query provides provider cost before exactly-once commission recovery", async () => {
  const { customer, agent } = await createCustomer({ withAgent: true });
  await createAirtimeSetting();
  const recoveryErrors = [];
  const provider = defaultProvider();
  provider.purchaseResult = ({ requestId }) =>
    providerEvidence({
      source: "INITIAL_REQUEST",
      outcome: "PENDING",
      requestId,
    });
  provider.queryResult = ({ requestId, orderId }) =>
    providerEvidence({
      source: "STATUS_QUERY",
      outcome: "SUCCESS",
      requestId,
      orderId: orderId || "CK-SUCCESS-001",
      statusCode: "200",
      orderStatus: "ORDER_COMPLETED",
      providerCost: 79,
    });
  const service = createService(provider, {
    onCommissionRecoveryError: (error) => recoveryErrors.push(error.message),
  });
  const purchase = await service.executePurchase(buy(customer));

  assert.equal(purchase.transaction.status, "PENDING");
  const [firstQuery, secondQuery] = await Promise.all([
    service.reconcilePendingPurchase({ transactionId: purchase.transaction._id }),
    service.reconcilePendingPurchase({ transactionId: purchase.transaction._id }),
  ]);
  assert.equal(firstQuery.status, "SUCCESSFUL");
  assert.equal(secondQuery.status, "SUCCESSFUL");
  const terminal = await Transaction.findById(purchase.transaction._id).lean();
  assert.equal(terminal.providerResponse.airtimeLifecycle.amountCharged, 79);
  assert.equal(terminal.providerResponse.airtimeCommissionRecovery.status, "PENDING");

  const recoveryRuns = await Promise.all([
    service.processCommissionEffect(purchase.transaction._id),
    service.processCommissionEffect(purchase.transaction._id),
  ]);
  const commissions = await Commission.find({
    transactionId: purchase.transaction._id,
  }).lean();
  const finalTransaction = await Transaction.findById(purchase.transaction._id).lean();
  assert.equal(
    finalTransaction.providerResponse.airtimeCommissionRecovery.status,
    "COMPLETE",
    JSON.stringify({ recoveryRuns, recoveryErrors }),
  );
  assert.equal(commissions.length, 2);
  assert.equal(commissions.reduce((total, row) => total + row.commissionAmount, 0), 21);
  assert.ok(commissions.every((row) => row.providerCost === 79 && row.netProfit === 21));
  assert.equal(
    commissions.find((row) => row.beneficiaryRole === "AGENT").commissionAmount,
    0.9,
  );
  assert.equal(await User.findById(agent._id).then((row) => row.walletBalance), 0.9);
  assert.equal(await User.findById(agent._id).then((row) => row.commissionBalance), 0.9);
  assert.equal(await User.findById(customer._id).then((row) => row.walletBalance), 400);
  assert.equal(await LedgerEntry.countDocuments({ transactionId: purchase.transaction._id }), 1);
  assert.equal(
    await service.processCommissionEffect(purchase.transaction._id).then((result) => result.claimed),
    false,
  );
  assert.equal(await Commission.countDocuments({ transactionId: purchase.transaction._id }), 2);

  const completedDocument = await Transaction.findById(purchase.transaction._id).lean();
  const completedHash = documentHash(completedDocument);
  const queryCallsAtCompletion = provider.queryCalls;
  await service.reconcilePendingPurchase({ transactionId: purchase.transaction._id });
  assert.equal(provider.queryCalls, queryCallsAtCompletion);
  assert.equal(
    documentHash(await Transaction.findById(purchase.transaction._id).lean()),
    completedHash,
  );

  provider.queryResult = ({ requestId, orderId }) =>
    providerEvidence({
      source: "STATUS_QUERY",
      outcome: "SUCCESS",
      requestId,
      orderId,
      statusCode: "200",
      orderStatus: "ORDER_COMPLETED",
      providerCost: 78,
    });
  const conflictingEvidence = await provider.query({
    requestId: purchase.transaction.providerRequestId,
    orderId: "CK-SUCCESS-001",
  });
  const conflict = await service.settle({
    transactionId: purchase.transaction._id,
    source: "STATUS_QUERY",
    evidence: conflictingEvidence,
  });
  assert.equal(conflict.evidenceDisposition, "TERMINAL_CONFLICT");
  assert.equal(
    documentHash(await Transaction.findById(purchase.transaction._id).lean()),
    completedHash,
  );
  assert.equal(await Commission.countDocuments({ transactionId: purchase.transaction._id }), 2);
});

test("a valid completed purchase without queried cost defers accounting instead of paying gross margin", async () => {
  const { customer, agent } = await createCustomer({ withAgent: true });
  await createAirtimeSetting();
  const provider = defaultProvider();
  provider.purchaseResult = ({ requestId }) =>
    providerEvidence({
      source: "INITIAL_REQUEST",
      outcome: "SUCCESS",
      requestId,
      orderId: "CK-INITIAL-SUCCESS",
      statusCode: "200",
      orderStatus: "ORDER_COMPLETED",
    });
  const service = createService(provider);

  const result = await service.executePurchase(buy(customer));
  assert.equal(result.transaction.status, "SUCCESSFUL");
  assert.equal(provider.queryCalls, 0);
  assert.equal(
    (await service.processCommissionEffect(result.transaction._id)).blocked,
    true,
  );
  const transaction = await Transaction.findById(result.transaction._id).lean();
  assert.equal(transaction.providerResponse.airtimeCommissionRecovery.status, "BLOCKED");
  assert.equal(
    transaction.providerResponse.airtimeCommissionRecovery.lastErrorCode,
    "AIRTIME_COMMISSION_INVALID_PROVIDER_COST",
  );
  assert.equal(await Commission.countDocuments({ transactionId: result.transaction._id }), 0);
  assert.equal(await User.findById(agent._id).then((row) => row.walletBalance), 0);
  assert.equal(await User.findById(customer._id).then((row) => row.walletBalance), 400);
  assert.equal(await LedgerEntry.countDocuments({ direction: "CREDIT" }), 0);

  provider.queryResult = ({ requestId, orderId }) =>
    providerEvidence({
      source: "STATUS_QUERY",
      outcome: "SUCCESS",
      requestId,
      orderId,
      statusCode: "200",
      orderStatus: "ORDER_COMPLETED",
      providerCost: 79,
    });
  const reconciled = await service.reconcilePendingPurchase({
    transactionId: result.transaction._id,
  });
  assert.equal(reconciled.providerResponse.airtimeLifecycle.amountCharged, 79);
  assert.equal(provider.queryCalls, 1);
  const recovered = await service.processCommissionEffect(result.transaction._id);
  assert.equal(recovered.completed, true);
  const commissions = await Commission.find({ transactionId: result.transaction._id }).lean();
  assert.ok(commissions.length > 0);
  assert.ok(commissions.every((commission) => commission.providerCost === 79));
});

test("a missing cost on query leaves successful Airtime blocked and is not treated as zero", async () => {
  const { customer, agent } = await createCustomer({ withAgent: true });
  await createAirtimeSetting();
  const provider = defaultProvider();
  provider.purchaseResult = ({ requestId }) =>
    providerEvidence({
      source: "INITIAL_REQUEST",
      outcome: "SUCCESS",
      requestId,
      orderId: "CK-QUERY-WITHOUT-COST",
      statusCode: "200",
      orderStatus: "ORDER_COMPLETED",
    });
  provider.queryResult = ({ requestId, orderId }) =>
    providerEvidence({
      source: "STATUS_QUERY",
      outcome: "SUCCESS",
      requestId,
      orderId,
      statusCode: "200",
      orderStatus: "ORDER_COMPLETED",
      providerCost: null,
    });
  const service = createService(provider);
  const purchase = await service.executePurchase(buy(customer));
  await service.reconcilePendingPurchase({ transactionId: purchase.transaction._id });
  const result = await service.processCommissionEffect(purchase.transaction._id);

  assert.equal(result.blocked, true);
  assert.equal(
    (await Transaction.findById(purchase.transaction._id).lean())
      .providerResponse.airtimeCommissionRecovery.status,
    "BLOCKED",
  );
  assert.equal(await Commission.countDocuments({ transactionId: purchase.transaction._id }), 0);
  assert.equal(await User.findById(agent._id).then((row) => row.walletBalance), 0);
  assert.equal(await LedgerEntry.countDocuments({ direction: "CREDIT" }), 0);
});

test("an above-sale authenticated cost is never used for commission or refund", async () => {
  const { customer, agent } = await createCustomer({ withAgent: true });
  await createAirtimeSetting();
  const provider = defaultProvider();
  provider.purchaseResult = ({ requestId }) =>
    providerEvidence({
      source: "INITIAL_REQUEST",
      outcome: "PENDING",
      requestId,
    });
  provider.queryResult = ({ requestId }) =>
    providerEvidence({
      source: "STATUS_QUERY",
      outcome: "SUCCESS",
      requestId,
      orderId: "CK-OVER-SALE-COST",
      statusCode: "200",
      orderStatus: "ORDER_COMPLETED",
      providerCost: 100.01,
    });
  const service = createService(provider);
  const purchase = await service.executePurchase(buy(customer));
  const settled = await service.reconcilePendingPurchase({
    transactionId: purchase.transaction._id,
  });

  assert.equal(settled.status, "PENDING");
  assert.equal(settled.dispatchStatus, "UNKNOWN");
  assert.equal(await Commission.countDocuments({ transactionId: purchase.transaction._id }), 0);
  assert.equal(await User.findById(agent._id).then((row) => row.walletBalance), 0);
  assert.equal(await User.findById(customer._id).then((row) => row.walletBalance), 400);
  assert.equal(await LedgerEntry.countDocuments({ direction: "CREDIT" }), 0);
});

test("documented terminal failure refunds once with a paired immutable ledger reversal", async () => {
  const { customer } = await createCustomer();
  const provider = defaultProvider();
  provider.purchaseResult = ({ requestId }) =>
    providerEvidence({
      source: "INITIAL_REQUEST",
      outcome: "FAILED",
      requestId,
      orderId: "CK-CANCELLED",
      statusCode: "501",
      orderStatus: "ORDER_CANCELLED",
    });
  const service = createService(provider);

  const result = await service.executePurchase(buy(customer));
  const transaction = await Transaction.findById(result.transaction._id).lean();
  const ledger = await LedgerEntry.find({
    transactionId: result.transaction._id,
  }).sort({ direction: 1 }).lean();

  assert.equal(transaction.status, "FAILED");
  assert.equal(transaction.dispatchStatus, "REFUNDED");
  assert.equal(await User.findById(customer._id).then((row) => row.walletBalance), 500);
  assert.equal(ledger.length, 2);
  const debit = ledger.find((entry) => entry.direction === "DEBIT");
  const credit = ledger.find((entry) => entry.direction === "CREDIT");
  assert.equal(debit.amount, 100);
  assert.equal(credit.amount, 100);
  assert.equal(credit.reversalOf.toString(), debit._id.toString());
  assert.equal(credit.idempotencyKey, `AIRTIME:${transaction.reference}:REFUND`);
});

test("unverified client-supplied callback success cannot settle or refund a transaction", async () => {
  const { customer } = await createCustomer();
  const provider = defaultProvider();
  const service = createService(provider);
  const { transaction } = await service.admitPurchase(buy(customer));
  await service.claimDispatch(transaction._id);
  await service.markDispatchStarted(transaction._id);
  const forgedSuccess = providerEvidence({
    source: "STATUS_QUERY",
    outcome: "SUCCESS",
    requestId: transaction.providerRequestId,
    orderId: "CLIENT-SUPPLIED-ORDER",
    statusCode: "200",
    orderStatus: "ORDER_COMPLETED",
    providerCost: 1,
  });

  await assert.rejects(
    service.settle({
      transactionId: transaction._id,
      source: "CALLBACK_QUERY",
      evidence: forgedSuccess,
    }),
    (error) => error.code === "AIRTIME_UNTRUSTED_EVIDENCE",
  );
  assert.equal(await Transaction.findById(transaction._id).then((row) => row.status), "PENDING");
  assert.equal(await User.findById(customer._id).then((row) => row.walletBalance), 400);
  assert.equal(await LedgerEntry.countDocuments({ direction: "CREDIT" }), 0);
  assert.equal(provider.queryCalls, 0);
});

test("callback-triggered settlement queries ClubKonnect before accepting terminal failure", async () => {
  const { customer } = await createCustomer();
  const provider = defaultProvider();
  provider.purchaseResult = ({ requestId }) =>
    providerEvidence({
      source: "INITIAL_REQUEST",
      outcome: "PENDING",
      requestId,
    });
  provider.queryResult = ({ requestId }) =>
    providerEvidence({
      source: "STATUS_QUERY",
      outcome: "FAILED",
      requestId,
      orderId: "CK-CALLBACK-QUERY-CANCELLED",
      statusCode: "501",
      orderStatus: "ORDER_CANCELLED",
    });
  const service = createService(provider);
  const purchase = await service.executePurchase(buy(customer));
  const settled = await service.reconcilePendingPurchase({
    transactionId: purchase.transaction._id,
    source: "CALLBACK_QUERY",
  });

  assert.equal(provider.queryCalls, 1);
  assert.equal(settled.status, "FAILED");
  assert.equal(settled.dispatchStatus, "REFUNDED");
  assert.equal(await User.findById(customer._id).then((row) => row.walletBalance), 500);
  assert.equal(await LedgerEntry.countDocuments({ direction: "CREDIT" }), 1);
});

test("pending commission batch processing is bounded and touches only ClubKonnect Airtime intents", async () => {
  const { customer } = await createCustomer();
  await createAirtimeSetting();
  const provider = defaultProvider();
  provider.purchaseResult = ({ requestId }) =>
    providerEvidence({
      source: "INITIAL_REQUEST",
      outcome: "SUCCESS",
      requestId,
      orderId: "CK-PENDING-COMMISSION",
      statusCode: "200",
      orderStatus: "ORDER_COMPLETED",
    });
  provider.queryResult = ({ requestId, orderId }) =>
    providerEvidence({
      source: "STATUS_QUERY",
      outcome: "SUCCESS",
      requestId,
      orderId,
      statusCode: "200",
      orderStatus: "ORDER_COMPLETED",
      providerCost: 80,
    });
  const service = createService(provider);
  const purchase = await service.executePurchase(buy(customer));
  await service.reconcilePendingPurchase({ transactionId: purchase.transaction._id });

  assert.deepEqual(await service.processPendingCommissions(0), {
    scanned: 0,
    results: [],
  });
  const batch = await service.processPendingCommissions(10);
  assert.equal(batch.scanned, 1);
  assert.equal(batch.results[0].completed, true, JSON.stringify(batch));
  assert.equal(await Commission.countDocuments({ transactionId: purchase.transaction._id }), 1);
});

test("the commission batch reclaims an expired RUNNING lease after a worker interruption", async () => {
  const { customer } = await createCustomer();
  await createAirtimeSetting();
  const provider = defaultProvider();
  provider.purchaseResult = ({ requestId }) =>
    providerEvidence({
      source: "INITIAL_REQUEST",
      outcome: "SUCCESS",
      requestId,
      orderId: "CK-EXPIRED-LEASE",
      statusCode: "200",
      orderStatus: "ORDER_COMPLETED",
    });
  provider.queryResult = ({ requestId, orderId }) =>
    providerEvidence({
      source: "STATUS_QUERY",
      outcome: "SUCCESS",
      requestId,
      orderId,
      statusCode: "200",
      orderStatus: "ORDER_COMPLETED",
      providerCost: 80,
    });
  const service = createService(provider);
  const purchase = await service.executePurchase(buy(customer));
  await service.reconcilePendingPurchase({ transactionId: purchase.transaction._id });
  await Transaction.updateOne(
    { _id: purchase.transaction._id },
    {
      $set: {
        "providerResponse.airtimeCommissionRecovery.status": "RUNNING",
        "providerResponse.airtimeCommissionRecovery.leaseUntil": new Date(0),
        "providerResponse.airtimeCommissionRecovery.nextAttemptAt": new Date(0),
      },
    },
  );

  const recovery = await service.processPendingCommissions(10);
  assert.equal(recovery.scanned, 1);
  assert.equal(recovery.results[0].completed, true);
  assert.equal(
    (await Transaction.findById(purchase.transaction._id).lean())
      .providerResponse.airtimeCommissionRecovery.status,
    "COMPLETE",
  );
  assert.equal(await Commission.countDocuments({ transactionId: purchase.transaction._id }), 1);
});