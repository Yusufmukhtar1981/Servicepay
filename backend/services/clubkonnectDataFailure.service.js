const mongoose = require("mongoose");

const Transaction = require("../models/transaction.model");
const User = require("../models/user.model");
const LedgerEntry = require("../models/ledgerEntry.model");
const { reverseLedgerEntry } = require("./ledger.service");

const normalizeKey = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const readField = (object, names) => {
  if (!object || typeof object !== "object" || Array.isArray(object)) {
    return null;
  }
  const normalized = new Map(
    Object.entries(object).map(([key, value]) => [normalizeKey(key), value]),
  );
  for (const name of names) {
    const value = normalized.get(normalizeKey(name));
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return null;
};

const normalizeSignal = (value) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");

const FAILURE_PATTERN =
  /(^|_)(FAILED|FAILURE|ERROR|INVALID|INSUFFICIENT|MISSING|DECLINED|REJECTED|UNAUTHORIZED|NOT_FOUND|CANCELLED|CANCELED)(_|$)/;
const NEGATED_FAILURE_PATTERN =
  /(^|_)(NOT|NO)_(FAILED|FAILURE|ERROR|INVALID|INSUFFICIENT|MISSING|DECLINED|REJECTED|UNAUTHORIZED|NOT_FOUND|CANCELLED|CANCELED)(_|$)/;
const SUCCESS_PATTERN = /^(SUCCESS|SUCCESSFUL|COMPLETED|ORDER_COMPLETED)$/;
const isFailureSignal = (value) =>
  FAILURE_PATTERN.test(value) && !NEGATED_FAILURE_PATTERN.test(value);

const analyzeProviderFailure = (providerResponse, expectedReference) => {
  const statusFields = [
    "status",
    "orderStatus",
    "responseStatus",
    "responseDescription",
    "responseCode",
    "code",
    "message",
  ];
  const values = statusFields.map((name) =>
    normalizeSignal(readField(providerResponse, [name])),
  );
  const succeeded = values.some((value) => SUCCESS_PATTERN.test(value));
  const failed = values.some(isFailureSignal);
  const explicitTerminalFailure = [
    "status",
    "orderStatus",
    "responseStatus",
    "responseCode",
    "code",
  ].some((name) => isFailureSignal(normalizeSignal(readField(providerResponse, [name]))));
  const successFlag = readField(providerResponse, ["success"]);
  const booleanSuccess =
    successFlag === true || String(successFlag || "").toLowerCase() === "true";
  const booleanFailure =
    successFlag === false || String(successFlag || "").toLowerCase() === "false";
  const contradictory =
    (succeeded && failed) ||
    (succeeded && booleanFailure) ||
    (failed && booleanSuccess);

  const correlatedReference = readField(providerResponse, [
    "RequestID",
    "request_id",
    "requestId",
    "clientRequestId",
    "client_request_id",
    "clientReference",
    "client_reference",
    "reference",
  ]);
  const correlated =
    correlatedReference !== null &&
    String(correlatedReference).trim() === String(expectedReference || "").trim();

  return {
    failed,
    explicitTerminalFailure,
    contradictory,
    correlated,
    correlatedReference: correlated ? String(correlatedReference).trim() : "",
  };
};

const refundFailedDataPurchase = async ({
  transactionId,
  providerResponse,
  httpStatus,
}) => {
  if (!(httpStatus >= 200 && httpStatus < 300)) {
    return { status: "NOT_ELIGIBLE" };
  }

  const initial = await Transaction.findById(transactionId)
    .select("_id reference providerRequestId serviceType provider status dispatchStatus providerResponse")
    .lean();
  if (
    !initial ||
    initial.serviceType !== "DATA" ||
    !["CLUBKONNECT", "TELECOM_ABODE"].includes(initial.provider)
  ) {
    return { status: "NOT_ELIGIBLE" };
  }

  const dispatchReference = initial.providerRequestId || initial.reference;
  const evidence = analyzeProviderFailure(providerResponse, dispatchReference);
  if (
    !evidence.failed ||
    !evidence.explicitTerminalFailure ||
    evidence.contradictory ||
    !evidence.correlated
  ) {
    return { status: "NOT_ELIGIBLE" };
  }

  const session = await mongoose.startSession();
  let result = { status: "NOT_CLAIMED" };
  try {
    await session.withTransaction(async () => {
      const claimed = await Transaction.findOneAndUpdate(
        {
          _id: transactionId,
          reference: initial.reference,
          serviceType: "DATA",
          provider: initial.provider,
          status: "PENDING",
          dispatchStatus: initial.provider === "TELECOM_ABODE" ? "SENDING" : "CLAIMED",
          dispatchClaimedAt: { $ne: null },
        },
        {
          $set: {
            status: "FAILED",
            dispatchStatus: "REFUNDED",
            providerStatus:
              normalizeSignal(
                readField(providerResponse, [
                  "status",
                  "orderStatus",
                  "responseStatus",
                  "responseCode",
                  "code",
                ]),
              ) || "FAILED",
            providerReference: evidence.correlatedReference,
            providerResponse: {
              ...initial.providerResponse,
              response: providerResponse,
              httpStatus,
              outcome: "FAILED",
              correlatedReference: evidence.correlatedReference,
            },
          },
        },
        { new: true, session },
      );

      if (!claimed) {
        const current = await Transaction.findById(transactionId)
          .session(session)
          .lean();
        result = { status: "NOT_CLAIMED", transaction: current };
        return;
      }

      const originalDebit = await LedgerEntry.findOne({
        _id: claimed.debitLedgerEntryId,
        user: claimed.customerId,
        transactionId: claimed._id,
        reference: claimed.reference,
        service: "DATA",
        direction: "DEBIT",
        amount: claimed.amount,
      })
        .session(session)
        .lean();
      if (!originalDebit) {
        throw new Error("The DATA debit ledger entry is missing or inconsistent.");
      }

      const customerBefore = await User.findById(claimed.customerId)
        .select("walletBalance")
        .session(session)
        .lean();
      if (!customerBefore) {
        throw new Error("Customer account for DATA refund was not found.");
      }
      const openingBalance = Number(customerBefore.walletBalance || 0);
      const updatedCustomer = await User.findOneAndUpdate(
        { _id: claimed.customerId },
        { $inc: { walletBalance: claimed.amount } },
        { new: true, session },
      );
      if (!updatedCustomer) {
        throw new Error("Customer wallet could not be credited for DATA refund.");
      }

      const reversal = await reverseLedgerEntry({
        originalEntryId: originalDebit._id,
        openingBalance,
        closingBalance: Number(updatedCustomer.walletBalance || 0),
        idempotencyKey: `DATA:${claimed.reference}:REVERSAL:CREDIT`,
        narration: "ClubKonnect DATA purchase refund",
        metadata: {
          provider: "CLUBKONNECT",
          reason: "Correlated explicit terminal provider failure",
          providerReference: evidence.correlatedReference,
        },
        session,
      });
      if (reversal.duplicate) {
        throw new Error("Duplicate DATA reversal ledger entry detected.");
      }

      const linked = await Transaction.updateOne(
        {
          _id: claimed._id,
          status: "FAILED",
          dispatchStatus: "REFUNDED",
        },
        {
          $set: { reversalLedgerEntryId: reversal.entry._id },
        },
        { session },
      );
      if (linked.modifiedCount !== 1) {
        throw new Error("DATA refund ledger could not be linked to its transaction.");
      }

      result = {
        status: "REFUNDED",
        transaction: {
          ...claimed.toObject(),
          reversalLedgerEntryId: reversal.entry._id,
        },
        walletBalance: Number(updatedCustomer.walletBalance || 0),
        reversalLedgerEntryId: reversal.entry._id,
      };
    });
  } finally {
    await session.endSession();
  }
  return result;
};

module.exports = {
  analyzeProviderFailure,
  refundFailedDataPurchase,
};