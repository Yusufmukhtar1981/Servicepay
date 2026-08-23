const assert = require("node:assert/strict");
const test = require("node:test");

const {
  decodeCursor,
  encodeCursor,
  getCustomerHistory,
  mergeCustomerHistory,
} = require("../services/customerHistory.service");

const customerId = "customer-1";
const otherCustomerId = "customer-2";

const createdAt = (day) => `2026-08-${String(day).padStart(2, "0")}T12:00:00.000Z`;

const makeModel = (records, calls) => ({
  find(filter) {
    calls.push(filter);

    return {
      setOptions() {
        return this;
      },
      sort() {
        return this;
      },
      limit() {
        return this;
      },
      async lean() {
        const continuation = filter.$and?.[0]?.$or;

        if (!continuation) {
          return records;
        }

        const olderThan = continuation[0]?.createdAt?.$lt;
        const atTimestamp = continuation[1]?.createdAt;
        const beforeId = continuation[1]?._id?.$lt;

        return records.filter((record) => {
          const recordDate = new Date(record.createdAt).getTime();
          const cursorDate = new Date(olderThan).getTime();

          return (
            recordDate < cursorDate ||
            (recordDate === cursorDate &&
              String(record._id) < String(beforeId))
          );
        });
      },
    };
  },
});

test("merges mixed customer history without duplicating linked ledger rows", () => {
  const transactions = [
    {
      _id: "transaction-airtime",
      customerId,
      reference: "AIR-001",
      serviceType: "AIRTIME",
      amount: 500,
      status: "SUCCESSFUL",
      createdAt: createdAt(4),
      providerResponse: {
        narration: "Airtime purchase",
      },
    },
  ];

  const ledgerEntries = [
    {
      _id: "ledger-airtime",
      user: customerId,
      transactionId: "transaction-airtime",
      reference: "AIR-001",
      direction: "DEBIT",
      amount: 500,
      service: "AIRTIME",
      status: "POSTED",
      createdAt: createdAt(4),
    },
    {
      _id: "ledger-received-transfer",
      user: customerId,
      transactionId: "sender-transaction",
      reference: "TRANSFER-001",
      direction: "CREDIT",
      amount: 1000,
      service: "SERVICEPAY_TRANSFER",
      status: "POSTED",
      narration: "Transfer from Ada",
      createdAt: createdAt(5),
    },
  ];

  const history = mergeCustomerHistory({
    userId: customerId,
    transactions,
    ledgerEntries,
    transfers: [
      {
        _id: "transfer-001",
        sender: otherCustomerId,
        receiver: customerId,
        reference: "TRANSFER-001",
        amount: 1000,
        status: "SUCCESSFUL",
        createdAt: createdAt(5),
      },
    ],
  });

  assert.equal(history.length, 2);
  assert.equal(history[0].direction, "CREDIT");
  assert.equal(history[0].reference, "TRANSFER-001");
  assert.equal(history[1].type, "AIRTIME");
  assert.equal(
    history.filter((item) => item.reference === "AIR-001").length,
    1
  );
});

test("normalizes funding, withdrawals, bank transfers, and feature payments", () => {
  const history = mergeCustomerHistory({
    userId: customerId,
    manualFundings: [
      {
        _id: "funding-1",
        paymentReference: "FUND-001",
        amount: 2000,
        status: "APPROVED",
        senderName: "Ada",
        senderBank: "Example Bank",
        createdAt: createdAt(1),
      },
    ],
    withdrawals: [
      {
        _id: "withdrawal-1",
        reference: "WITHDRAW-001",
        amount: 3000,
        status: "APPROVED",
        bankName: "Example Bank",
        accountName: "Ada Customer",
        createdAt: createdAt(2),
      },
    ],
    bankTransfers: [
      {
        _id: "bank-transfer-1",
        reference: "BANK-001",
        amount: 4000,
        totalDebit: 4050,
        transferFee: 50,
        status: "SUCCESSFUL",
        bankName: "Example Bank",
        accountName: "Ada Recipient",
        createdAt: createdAt(3),
      },
    ],
    featurePayments: [
      {
        _id: "feature-payment-1",
        reference: "PAY-001",
        payer: customerId,
        beneficiary: otherCustomerId,
        featureType: "PAY_BY_LINK",
        amount: 5000,
        status: "SUCCESSFUL",
        createdAt: createdAt(4),
      },
    ],
  });

  assert.deepEqual(
    history.map((item) => [item.reference, item.direction]),
    [
      ["PAY-001", "DEBIT"],
      ["BANK-001", "DEBIT"],
      ["WITHDRAW-001", "DEBIT"],
      ["FUND-001", "CREDIT"],
    ]
  );
  assert.equal(history[1].fee, 50);
});

test("uses authenticated ownership filters and bounded cursor pagination", async () => {
  const calls = [];
  const records = Array.from({ length: 3 }, (_, index) => ({
    _id: `transaction-${index}`,
    customerId,
    reference: `REF-${index}`,
    serviceType: "DATA",
    amount: 100,
    status: "SUCCESSFUL",
    createdAt: createdAt(10 - index),
  }));

  const emptyModel = makeModel([], calls);
  const history = await getCustomerHistory({
    userId: customerId,
    limit: 2,
    before: createdAt(11),
    models: {
      Transaction: makeModel(records, calls),
      LedgerEntry: emptyModel,
      Transfer: emptyModel,
      ManualFunding: emptyModel,
      WithdrawalRequest: emptyModel,
      BankTransfer: emptyModel,
      FeaturePayment: emptyModel,
    },
  });

  assert.equal(history.transactions.length, 2);
  assert.equal(history.pagination.hasMore, true);
  assert.ok(history.pagination.nextCursor);
  assert.deepEqual(decodeCursor(history.pagination.nextCursor), {
    createdAt: new Date(createdAt(9)),
    id: "transaction-1",
  });
  assert.ok(
    calls.some(
      (filter) =>
        Array.isArray(filter.$or) &&
        filter.$or.some((condition) => condition.customerId === customerId)
    )
  );
  assert.ok(
    calls.every(
      (filter) =>
        !filter.$or ||
        filter.$or.every(
          (condition) =>
            !condition.customerId || condition.customerId === customerId
        )
    )
  );
});

test("uses the source ID to continue through same-timestamp history", () => {
  const cursor = encodeCursor({
    createdAt: createdAt(8),
    sourceId: "64f000000000000000000010",
  });

  assert.deepEqual(decodeCursor(cursor), {
    createdAt: new Date(createdAt(8)),
    id: "64f000000000000000000010",
  });
  assert.notEqual(cursor, createdAt(8));
});

test("does not omit cross-source records with identical timestamps", async () => {
  const calls = [];
  const timestamp = createdAt(7);
  const transaction = {
    _id: "64f000000000000000000001",
    customerId,
    reference: "TXN-SAME-TIME",
    serviceType: "DATA",
    amount: 200,
    status: "SUCCESSFUL",
    createdAt: timestamp,
  };
  const ledgerEntry = {
    _id: "64f000000000000000000002",
    user: customerId,
    reference: "LEDGER-SAME-TIME",
    service: "MANUAL_FUNDING",
    direction: "CREDIT",
    amount: 300,
    status: "POSTED",
    createdAt: timestamp,
  };
  const emptyModel = makeModel([], calls);
  const models = {
    Transaction: makeModel([transaction], calls),
    LedgerEntry: makeModel([ledgerEntry], calls),
    Transfer: emptyModel,
    ManualFunding: emptyModel,
    WithdrawalRequest: emptyModel,
    BankTransfer: emptyModel,
    FeaturePayment: emptyModel,
  };

  const first = await getCustomerHistory({
    userId: customerId,
    limit: 1,
    models,
  });
  const second = await getCustomerHistory({
    userId: customerId,
    limit: 1,
    before: first.pagination.nextCursor,
    models,
  });

  assert.equal(first.transactions[0].reference, "LEDGER-SAME-TIME");
  assert.equal(second.transactions[0].reference, "TXN-SAME-TIME");
});

test("normalizes legacy transaction field names without rewriting records", () => {
  const history = mergeCustomerHistory({
    userId: customerId,
    transactions: [
      {
        _id: "legacy-transaction",
        user: customerId,
        transactionReference: "LEGACY-001",
        transactionType: "CABLE",
        totalAmount: "1250.50",
        paymentStatus: "COMPLETED",
        narration: "Legacy cable subscription",
        transactionDate: createdAt(6),
      },
    ],
  });

  assert.equal(history.length, 1);
  assert.equal(history[0].reference, "LEGACY-001");
  assert.equal(history[0].type, "CABLE");
  assert.equal(history[0].amount, 1250.5);
  assert.equal(history[0].status, "SUCCESSFUL");
  assert.equal(history[0].description, "Legacy cable subscription");
  assert.equal(history[0].createdAt, createdAt(6));
});

test("returns an empty history without fabricating records", () => {
  const history = mergeCustomerHistory({
    userId: customerId,
  });

  assert.deepEqual(history, []);
});