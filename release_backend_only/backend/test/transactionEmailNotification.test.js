const test = require("node:test");
const assert = require("node:assert/strict");

const {
  maskSensitive,
  normalizeEvent,
  sendTransactionNotification,
} = require(
  "../services/transactionEmailNotification.service"
);
const {
  transactionEmail,
} = require("../templates/emailTemplates");
const {
  getChangeSourceTime,
  processFeaturePaymentEvent,
  processPaymentLinkEvent,
  processTransferEvent,
} = require("../services/emailAutomation.service");

const createStore = () => {
  const keys = new Set();
  const outcomes = new Map();

  return {
    keys,
    outcomes,
    async claim(_event, key) {
      if (keys.has(key)) {
        return {
          claimed: false,
          duplicate: true,
        };
      }

      keys.add(key);
      return {
        claimed: true,
        id: key,
      };
    },
    async complete(id, result) {
      outcomes.set(id, result);
    },
    async fail(id, error) {
      outcomes.set(id, {
        success: false,
        error: error.message,
      });
    },
  };
};

test("debit transaction emails contain the receipt fields and authoritative balance", async () => {
  const sent = [];
  const event = {
    email: "customer@example.test",
    userId: "customer-1",
    name: "Customer Name",
    type: "DATA",
    direction: "DEBIT",
    amount: 1500,
    reference: "DATA-100",
    status: "SUCCESSFUL",
    balance: 8500,
    provider: "MTN",
    serviceDetails: "2 GB bundle",
    date: "2026-08-26T12:00:00.000Z",
  };

  const result = await sendTransactionNotification(
    event,
    {
      store: createStore(),
      sender: async (payload) => {
        sent.push(payload);
        return {
          success: true,
          messageId: "email-1",
        };
      },
    }
  );

  assert.equal(result.success, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].direction, "DEBIT");
  assert.equal(sent[0].balance, 8500);
  assert.match(
    sent[0].idempotencyKey,
    /^[a-f0-9]{64}$/
  );

  const rendered = transactionEmail(sent[0]);
  assert.match(rendered.subject, /Data Successful/i);
  assert.match(rendered.html, /DATA/);
  assert.match(rendered.html, /DEBIT/);
  assert.match(rendered.html, /DATA-100/);
  assert.match(rendered.html, /Wallet Balance/);
});

test("credit transaction emails use wallet-credit language", async () => {
  const sent = [];

  await sendTransactionNotification(
    {
      email: "customer@example.test",
      userId: "customer-2",
      name: "Customer Name",
      type: "WALLET_FUNDING",
      direction: "CREDIT",
      amount: 10000,
      reference: "FUND-100",
      status: "SUCCESSFUL",
    },
    {
      store: createStore(),
      sender: async (payload) => {
        sent.push(payload);
        return { success: true };
      },
    }
  );

  const rendered = transactionEmail(sent[0]);
  assert.match(
    rendered.subject,
    /ServicePay Wallet Credit/
  );
  assert.match(
    rendered.html,
    /wallet has been credited/i
  );
});

test("ServicePay transfers create one debit event and one credit event", async () => {
  const notifications = [];
  const users = {
    sender: {
      email: "sender@example.test",
      name: "Sender Name",
    },
    receiver: {
      email: "receiver@example.test",
      name: "Receiver Name",
    },
  };

  await processTransferEvent(
    { operationType: "insert" },
    {
      _id: "transfer-1",
      sender: "sender",
      receiver: "receiver",
      amount: 5000,
      reference: "SPT-100",
      status: "SUCCESSFUL",
      senderBalanceAfter: 2000,
      receiverBalanceAfter: 9000,
      createdAt:
        "2026-08-26T12:00:00.000Z",
    },
    {
      resolve: async ({ userId }) =>
        users[userId],
      notify: async (payload) => {
        notifications.push(payload);
        return { success: true };
      },
    }
  );

  assert.equal(notifications.length, 2);
  assert.deepEqual(
    notifications.map(
      ({ direction }) => direction
    ),
    ["DEBIT", "CREDIT"]
  );
  assert.equal(
    notifications[0].counterparty,
    "Receiver Name"
  );
  assert.equal(
    notifications[1].counterparty,
    "Sender Name"
  );
});

test("feature payment reversal credits only the original payer", async () => {
  const notifications = [];
  const users = {
    payer: {
      email: "payer@example.test",
      name: "Payer",
    },
    beneficiary: {
      email: "beneficiary@example.test",
      name: "Beneficiary",
    },
  };

  await processFeaturePaymentEvent(
    {
      operationType: "update",
      updateDescription: {
        updatedFields: {
          status: "REVERSED",
        },
      },
    },
    {
      payer: "payer",
      beneficiary: "beneficiary",
      featureType: "MONEY_REQUEST",
      amount: 3000,
      reference: "FEATURE-REV-1",
      status: "REVERSED",
      updatedAt:
        "2026-08-26T12:00:00.000Z",
    },
    {
      resolve: async ({ userId }) =>
        users[userId],
      notify: async (payload) => {
        notifications.push(payload);
        return { success: true };
      },
    }
  );

  assert.equal(notifications.length, 1);
  assert.equal(
    notifications[0].email,
    "payer@example.test"
  );
  assert.equal(
    notifications[0].direction,
    "CREDIT"
  );
  assert.equal(
    notifications[0].status,
    "REVERSED"
  );
});

test("paid payment links notify payer debit and owner credit", async () => {
  const notifications = [];
  const users = {
    payer: {
      email: "payer@example.test",
      name: "Payer",
    },
    owner: {
      email: "owner@example.test",
      name: "Owner",
    },
  };

  await processPaymentLinkEvent(
    { operationType: "update" },
    {
      paidBy: "payer",
      owner: "owner",
      title: "Invoice",
      amount: 6000,
      code: "PAYLINK-1",
      status: "PAID",
      paidAt:
        "2026-08-26T12:00:00.000Z",
    },
    {
      resolve: async ({ userId }) =>
        users[userId],
      notify: async (payload) => {
        notifications.push(payload);
        return { success: true };
      },
    }
  );

  assert.deepEqual(
    notifications.map(
      ({ email, direction }) => ({
        email,
        direction,
      })
    ),
    [
      {
        email: "payer@example.test",
        direction: "DEBIT",
      },
      {
        email: "owner@example.test",
        direction: "CREDIT",
      },
    ]
  );
});

test("withdrawal requests and refunds normalize to the correct meaning", () => {
  const withdrawal = normalizeEvent({
    email: "customer@example.test",
    type: "WITHDRAWAL",
    amount: 4000,
    reference: "WD-100",
    status: "PENDING",
    direction: "DEBIT",
  });
  const refund = normalizeEvent({
    email: "customer@example.test",
    type: "AIRTIME_REVERSAL",
    amount: 500,
    reference: "AIR-100",
    status: "REFUNDED",
  });

  assert.equal(withdrawal.direction, "DEBIT");
  assert.equal(withdrawal.status, "PENDING");
  assert.equal(refund.direction, "CREDIT");
  assert.equal(refund.status, "REFUNDED");
  assert.match(
    transactionEmail(withdrawal).subject,
    /Withdrawal Request Received/
  );
});

test("duplicate transaction status events are suppressed durably", async () => {
  const store = createStore();
  let sendCount = 0;
  const event = {
    email: "customer@example.test",
    userId: "customer-3",
    type: "ELECTRICITY",
    direction: "DEBIT",
    amount: 7500,
    reference: "ELEC-100",
    status: "SUCCESSFUL",
  };
  const options = {
    store,
    sender: async () => {
      sendCount += 1;
      return { success: true };
    },
  };

  const first =
    await sendTransactionNotification(
      event,
      options
    );
  const duplicate =
    await sendTransactionNotification(
      {
        ...event,
        type: "ELECTRICITY PAYMENT",
      },
      options
    );

  assert.equal(first.success, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(sendCount, 1);
});

test("email provider failure is recorded and never thrown into transaction processing", async () => {
  const store = createStore();

  const result =
    await sendTransactionNotification(
      {
        email: "customer@example.test",
        userId: "customer-4",
        type: "MARKETPLACE",
        direction: "DEBIT",
        amount: 25000,
        reference: "MKT-100",
        status: "SUCCESSFUL",
      },
      {
        store,
        sender: async () => {
          throw new Error(
            "Provider temporarily unavailable"
          );
        },
      }
    );

  assert.equal(result.success, false);
  assert.match(
    result.error,
    /temporarily unavailable/
  );
  assert.equal(store.outcomes.size, 1);
});

test("sensitive account and identity-like values are masked before rendering", () => {
  assert.equal(
    maskSensitive(
      "Account 0123456789 and NIN 12345678901"
    ),
    "Account 012****6789 and NIN 123****8901"
  );
});

test("recovery checkpoints use the Mongo source event time instead of handler completion time", () => {
  const committedAt =
    new Date(
      "2026-08-26T10:00:00.000Z"
    );

  assert.equal(
    getChangeSourceTime({
      wallTime: committedAt,
    }).toISOString(),
    committedAt.toISOString()
  );
  assert.equal(
    getChangeSourceTime({
      clusterTime: {
        getHighBits: () =>
          Math.floor(
            committedAt.getTime() / 1000
          ),
      },
    }).toISOString(),
    committedAt.toISOString()
  );
});