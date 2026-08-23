const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

const getDefaultModels = () => {
  return {
    Transaction: require("../models/transaction.model"),
    Transfer: require("../models/transfer.model"),
    LedgerEntry: require("../models/ledgerEntry.model"),
    ManualFunding: require("../models/manualfunding.model"),
    WithdrawalRequest: require("../models/withdrawalRequest.model"),
    BankTransfer: require("../models/bankTransfer.model"),
    FeaturePayment: require("../models/featurePayment.model"),
  };
};

const asId = (value) => {
  if (!value) return "";

  if (typeof value === "object" && value._id) {
    return String(value._id);
  }

  return String(value);
};

const sameId = (left, right) => {
  return asId(left) !== "" && asId(left) === asId(right);
};

const asAmount = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
};

const asDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

const decodeCursor = (value) => {
  if (!value) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(String(value), "base64url").toString("utf8")
    );
    const createdAt = asDate(parsed.createdAt);
    const id = String(parsed.id || "").trim();

    if (createdAt && id) {
      return {
        createdAt,
        id,
      };
    }
  } catch (_) {
    const createdAt = asDate(value);

    if (createdAt) {
      return {
        createdAt,
        id: "ffffffffffffffffffffffff",
      };
    }
  }

  return null;
};

const encodeCursor = (item) => {
  const createdAt = asDate(item?.createdAt);
  const id = String(item?.sourceId || "").trim();

  if (!createdAt || !id) {
    return null;
  }

  return Buffer.from(
    JSON.stringify({
      createdAt: createdAt.toISOString(),
      id,
    })
  ).toString("base64url");
};

const normalizeStatus = (value, fallback = "PENDING") => {
  const status = String(value || fallback).trim().toUpperCase();

  if (
    ["SUCCESS", "COMPLETED", "PAID", "POSTED", "APPROVED"].includes(status)
  ) {
    return "SUCCESSFUL";
  }

  if (["FAIL", "DECLINED", "CANCELLED", "REJECTED"].includes(status)) {
    return "FAILED";
  }

  return status || fallback;
};

const typeLabel = (value) => {
  return String(value || "TRANSACTION")
    .trim()
    .toUpperCase()
    .replace(/^SERVICEPAY_/, "")
    .replace(/_REVERSAL$/, "_REVERSAL");
};

const metadataFrom = (record) => {
  return record && typeof record === "object" ? record : {};
};

const directionFromTransaction = (transaction) => {
  const details = metadataFrom(transaction.providerResponse);
  const explicit =
    details.transactionDirection ||
    details.direction ||
    transaction.direction;

  if (explicit) {
    const direction = String(explicit).trim().toUpperCase();
    if (direction === "CREDIT" || direction === "DEBIT") {
      return direction;
    }
  }

  const type = typeLabel(transaction.serviceType);

  if (
    type.includes("FUNDING") ||
    type.includes("REFUND") ||
    type.includes("REVERSAL")
  ) {
    return "CREDIT";
  }

  return "DEBIT";
};

const transactionDescription = (transaction) => {
  const details = metadataFrom(transaction.providerResponse);

  return String(
    details.narration ||
      details.description ||
      transaction.description ||
      transaction.narration ||
      transaction.phone ||
      ""
  ).trim();
};

const transactionCounterparty = (transaction) => {
  const details = metadataFrom(transaction.providerResponse);
  const party =
    details.beneficiary ||
    details.receiver ||
    details.sender ||
    details.counterparty ||
    null;

  if (typeof party === "string") {
    return party.trim() || null;
  }

  if (party && typeof party === "object") {
    return (
      String(
        party.fullName ||
          party.name ||
          party.phone ||
          party.email ||
          ""
      ).trim() || null
    );
  }

  return transaction.phone ? String(transaction.phone) : null;
};

const toTransactionItem = (transaction) => {
  const details = metadataFrom(transaction.providerResponse);
  const serviceType =
    transaction.serviceType ||
    transaction.type ||
    transaction.transactionType ||
    transaction.category;
  const createdAt =
    transaction.createdAt ||
    transaction.date ||
    transaction.transactionDate ||
    transaction.updatedAt ||
    null;

  return {
    id: `transaction:${asId(transaction._id)}`,
    source: "TRANSACTION",
    sourceId: asId(transaction._id),
    reference: String(
      transaction.reference ||
        transaction.transactionReference ||
        transaction.transactionId ||
        transaction._id ||
        ""
    ),
    type: typeLabel(serviceType),
    direction: directionFromTransaction(transaction),
    amount: asAmount(
      transaction.amount ?? transaction.totalAmount ?? transaction.value
    ),
    fee: asAmount(details.fee || details.transferFee) || null,
    status: normalizeStatus(transaction.status || transaction.paymentStatus),
    description: transactionDescription(transaction),
    counterparty: transactionCounterparty(transaction),
    createdAt,
    updatedAt: transaction.updatedAt || createdAt,
    provider: transaction.provider || details.provider || null,
    metadata: {
      serviceType: serviceType || null,
      transferType: details.transferType || null,
      providerResponse: details,
    },
    transactionId: asId(transaction._id),
  };
};

const toLedgerItem = (entry) => {
  const metadata = metadataFrom(entry.metadata);

  return {
    id: `ledger:${asId(entry._id)}`,
    source: "LEDGER",
    sourceId: asId(entry._id),
    reference: String(entry.reference || entry._id || ""),
    type: typeLabel(entry.service),
    direction: String(entry.direction || "DEBIT").toUpperCase(),
    amount: asAmount(entry.amount),
    fee: null,
    status: normalizeStatus(entry.status),
    description: String(entry.narration || "").trim(),
    counterparty: String(
      metadata.counterparty ||
        metadata.receiverPhone ||
        metadata.senderPhone ||
        ""
    ).trim() || null,
    createdAt: entry.createdAt || entry.updatedAt || null,
    updatedAt: entry.updatedAt || entry.createdAt || null,
    provider: metadata.provider || null,
    metadata,
    transactionId: asId(entry.transactionId),
    reversalOf: asId(entry.reversalOf),
  };
};

const toTransferItem = (transfer, userId) => {
  const isSender = sameId(transfer.sender, userId);

  return {
    id: `transfer:${asId(transfer._id)}`,
    source: "TRANSFER",
    sourceId: asId(transfer._id),
    reference: String(transfer.reference || transfer._id || ""),
    type: "TRANSFER",
    direction: isSender ? "DEBIT" : "CREDIT",
    amount: asAmount(transfer.amount),
    fee: null,
    status: normalizeStatus(transfer.status),
    description: isSender
      ? "ServicePay transfer sent"
      : "ServicePay transfer received",
    counterparty: null,
    createdAt: transfer.createdAt || transfer.updatedAt || null,
    updatedAt: transfer.updatedAt || transfer.createdAt || null,
    provider: "SERVICEPAY",
    metadata: {
      transferType: "SERVICEPAY_TO_SERVICEPAY",
    },
    transactionId: "",
  };
};

const toManualFundingItem = (funding) => {
  return {
    id: `manual-funding:${asId(funding._id)}`,
    source: "MANUAL_FUNDING",
    sourceId: asId(funding._id),
    reference: String(funding.paymentReference || funding._id || ""),
    type: "WALLET_FUNDING",
    direction: "CREDIT",
    amount: asAmount(funding.amount),
    fee: null,
    status: normalizeStatus(funding.status),
    description: String(
      funding.note || `Manual funding from ${funding.senderBank || "bank"}`
    ).trim(),
    counterparty: String(funding.senderName || "").trim() || null,
    createdAt: funding.createdAt || funding.updatedAt || null,
    updatedAt: funding.updatedAt || funding.createdAt || null,
    provider: funding.senderBank || null,
    metadata: {
      fundingRequestId: asId(funding._id),
    },
    transactionId: "",
  };
};

const toWithdrawalItem = (withdrawal) => {
  return {
    id: `withdrawal:${asId(withdrawal._id)}`,
    source: "WITHDRAWAL",
    sourceId: asId(withdrawal._id),
    reference: String(
      withdrawal.payoutReference || withdrawal.reference || withdrawal._id || ""
    ),
    type: "WITHDRAWAL",
    direction: "DEBIT",
    amount: asAmount(withdrawal.amount),
    fee: null,
    status: normalizeStatus(withdrawal.status),
    description: `Withdrawal to ${withdrawal.bankName || "bank account"}`,
    counterparty: String(withdrawal.accountName || "").trim() || null,
    createdAt: withdrawal.createdAt || withdrawal.updatedAt || null,
    updatedAt: withdrawal.updatedAt || withdrawal.createdAt || null,
    provider: withdrawal.bankName || null,
    metadata: {
      payoutReference: withdrawal.payoutReference || null,
    },
    transactionId: "",
  };
};

const toBankTransferItem = (transfer) => {
  return {
    id: `bank-transfer:${asId(transfer._id)}`,
    source: "BANK_TRANSFER",
    sourceId: asId(transfer._id),
    reference: String(transfer.reference || transfer._id || ""),
    type: "BANK_TRANSFER",
    direction: "DEBIT",
    amount: asAmount(transfer.totalDebit || transfer.amount),
    fee: asAmount(transfer.transferFee) || null,
    status: normalizeStatus(transfer.status),
    description: String(
      transfer.narration || `Bank transfer to ${transfer.bankName || "bank"}`
    ).trim(),
    counterparty: String(
      transfer.accountName || transfer.accountNumber || ""
    ).trim() || null,
    createdAt: transfer.createdAt || transfer.updatedAt || null,
    updatedAt: transfer.updatedAt || transfer.createdAt || null,
    provider: transfer.provider || null,
    metadata: {
      transferAmount: asAmount(transfer.amount),
      providerReference: transfer.providerReference || null,
      refundProcessed: Boolean(transfer.refundProcessed),
    },
    transactionId: asId(transfer.transactionId),
  };
};

const toFeaturePaymentItem = (payment, userId) => {
  const isPayer = sameId(payment.payer, userId);

  return {
    id: `feature-payment:${asId(payment._id)}`,
    source: "FEATURE_PAYMENT",
    sourceId: asId(payment._id),
    reference: String(payment.reference || payment._id || ""),
    type: typeLabel(payment.featureType),
    direction: isPayer ? "DEBIT" : "CREDIT",
    amount: asAmount(payment.amount),
    fee: null,
    status: normalizeStatus(payment.status),
    description: String(payment.description || "").trim(),
    counterparty: null,
    createdAt: payment.createdAt || payment.updatedAt || null,
    updatedAt: payment.updatedAt || payment.createdAt || null,
    provider: "SERVICEPAY",
    metadata: {
      featureType: payment.featureType || null,
    },
    transactionId: "",
  };
};

const findRecent = (Model, filter, cursor, limit, options = {}) => {
  const queryFilter = { ...filter };

  if (cursor) {
    queryFilter.$and = [
      {
        $or: [
          { createdAt: { $lt: cursor.createdAt } },
          {
            createdAt: cursor.createdAt,
            _id: { $lt: cursor.id },
          },
        ],
      },
    ];
  }

  let query = Model.find(queryFilter);

  if (options.allowLegacyFields && typeof query.setOptions === "function") {
    query = query.setOptions({ strictQuery: false });
  }

  return query
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit)
    .lean();
};

const shouldIncludeFallback = (item, knownReferences, knownTransactionIds) => {
  if (item.transactionId && knownTransactionIds.has(item.transactionId)) {
    return false;
  }

  return !knownReferences.has(item.reference);
};

const mergeCustomerHistory = ({
  userId,
  transactions = [],
  ledgerEntries = [],
  transfers = [],
  manualFundings = [],
  withdrawals = [],
  bankTransfers = [],
  featurePayments = [],
  limit = DEFAULT_LIMIT,
}) => {
  const items = [];
  const seenSourceIds = new Set();
  const knownReferences = new Set();
  const knownTransactionIds = new Set();

  const add = (item) => {
    if (!item.sourceId || seenSourceIds.has(item.id)) {
      return;
    }

    seenSourceIds.add(item.id);
    items.push(item);
  };

  for (const transaction of transactions) {
    const item = toTransactionItem(transaction);
    add(item);
    knownReferences.add(item.reference);
    knownTransactionIds.add(item.transactionId);
  }

  for (const entry of ledgerEntries) {
    const item = toLedgerItem(entry);
    const isReversal =
      Boolean(item.reversalOf) || item.type.endsWith("_REVERSAL");

    if (isReversal || shouldIncludeFallback(item, knownReferences, knownTransactionIds)) {
      add(item);
      knownReferences.add(item.reference);
    }
  }

  const fallbackGroups = [
    transfers.map((transfer) => toTransferItem(transfer, userId)),
    manualFundings.map(toManualFundingItem),
    withdrawals.map(toWithdrawalItem),
    bankTransfers.map(toBankTransferItem),
    featurePayments.map((payment) => toFeaturePaymentItem(payment, userId)),
  ];

  for (const group of fallbackGroups) {
    for (const item of group) {
      if (shouldIncludeFallback(item, knownReferences, knownTransactionIds)) {
        add(item);
        knownReferences.add(item.reference);
      }
    }
  }

  return items
    .sort((left, right) => {
      const rightDate = asDate(right.createdAt)?.getTime() || 0;
      const leftDate = asDate(left.createdAt)?.getTime() || 0;

      if (rightDate !== leftDate) {
        return rightDate - leftDate;
      }

      return String(right.sourceId).localeCompare(String(left.sourceId));
    })
    .slice(0, limit);
};

const getCustomerHistory = async ({
  userId,
  limit = DEFAULT_LIMIT,
  before = null,
  models = {},
}) => {
  const sourceModels =
    Object.keys(models).length > 0
      ? models
      : getDefaultModels();

  const requestedLimit = Number.parseInt(limit, 10);
  const safeLimit = Math.min(
    Math.max(Number.isFinite(requestedLimit) ? requestedLimit : DEFAULT_LIMIT, 1),
    MAX_LIMIT
  );
  const cursor = decodeCursor(before);
  const perSourceLimit = safeLimit * 2 + 1;

  const [
    transactions,
    ledgerEntries,
    transfers,
    manualFundings,
    withdrawals,
    bankTransfers,
    featurePayments,
  ] = await Promise.all([
    findRecent(
      sourceModels.Transaction,
      {
        $or: [
          { customerId: userId },
          { user: userId },
          { userId },
          { sender: userId },
          { receiver: userId },
        ],
      },
      cursor,
      perSourceLimit,
      { allowLegacyFields: true }
    ),
    findRecent(sourceModels.LedgerEntry, { user: userId }, cursor, perSourceLimit),
    findRecent(
      sourceModels.Transfer,
      { $or: [{ sender: userId }, { receiver: userId }] },
      cursor,
      perSourceLimit
    ),
    findRecent(sourceModels.ManualFunding, { user: userId }, cursor, perSourceLimit),
    findRecent(sourceModels.WithdrawalRequest, { user: userId }, cursor, perSourceLimit),
    findRecent(sourceModels.BankTransfer, { sender: userId }, cursor, perSourceLimit),
    findRecent(
      sourceModels.FeaturePayment,
      { $or: [{ payer: userId }, { beneficiary: userId }] },
      cursor,
      perSourceLimit
    ),
  ]);

  const merged = mergeCustomerHistory({
    userId,
    transactions,
    ledgerEntries,
    transfers,
    manualFundings,
    withdrawals,
    bankTransfers,
    featurePayments,
    limit: safeLimit + 1,
  });

  const sourceHasMore = [
    transactions,
    ledgerEntries,
    transfers,
    manualFundings,
    withdrawals,
    bankTransfers,
    featurePayments,
  ].some((records) => records.length === perSourceLimit);
  const hasMore = merged.length > safeLimit || sourceHasMore;
  const visible = merged.slice(0, safeLimit);
  const lastItem = visible[visible.length - 1];
  const nextCursor = hasMore ? encodeCursor(lastItem) : null;

  return {
    transactions: visible,
    pagination: {
      limit: safeLimit,
      hasMore,
      nextCursor,
    },
  };
};

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  getCustomerHistory,
  mergeCustomerHistory,
  normalizeStatus,
  decodeCursor,
  encodeCursor,
};