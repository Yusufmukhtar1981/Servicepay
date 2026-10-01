const mongoose = require("mongoose");

const Transaction = require("../models/transaction.model");
const User = require("../models/user.model");
const LedgerEntry = require("../models/ledgerEntry.model");
const { reverseLedgerEntry } = require("./ledger.service");
const { enqueueReferralRewardEvent } = require("./referralReward.service");
const {
  processTelecomAbodeDataCommissionEffect,
  safeErrorCode,
} = require("./telecomAbodeDataCommissionRecovery.service");

const SOURCE_CONFIG = Object.freeze({
  REQUEST: {
    provenance: "TELECOM_ABODE_REQUEST",
    dispatchStatuses: ["SENDING"],
  },
  WEBHOOK: {
    provenance: "TELECOM_ABODE_WEBHOOK",
    dispatchStatuses: ["SENDING", "UNKNOWN"],
  },
  STATUS_QUERY: {
    provenance: "TELECOM_ABODE_STATUS_QUERY",
    dispatchStatuses: ["UNKNOWN"],
  },
});

const normalizedText = (value) =>
  typeof value === "string" ? value.trim() : "";

const normalizedAmount = (value) => {
  if (typeof value === "string" && !/^\d+(?:\.\d{1,2})?$/.test(value.trim())) {
    return null;
  }
  if (typeof value !== "number" && typeof value !== "string") return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
};

const getQueryWithSession = (query, session) =>
  session ? query.session(session) : query;

const verifyCanonicalDebitCustody = async ({
  transaction,
  ledgerModel,
  session = null,
}) => {
  if (transaction.reversalLedgerEntryId) {
    throw new Error("Telecom Abode DATA transaction already has a reversal link.");
  }
  const originalDebit = await getQueryWithSession(
    ledgerModel.findOne({
      _id: transaction.debitLedgerEntryId,
      user: transaction.customerId,
      transactionId: transaction._id,
      reference: transaction.reference,
      service: "DATA",
      direction: "DEBIT",
      amount: transaction.amount,
      status: "POSTED",
      reversalOf: null,
    }),
    session,
  ).lean();
  if (!originalDebit) {
    throw new Error("Telecom Abode DATA canonical debit is missing, inconsistent, or not posted.");
  }
  const existingReversal = await getQueryWithSession(
    ledgerModel.findOne({ reversalOf: originalDebit._id }),
    session,
  ).lean();
  if (existingReversal) {
    throw new Error("Telecom Abode DATA debit already has a reversal entry.");
  }
  return originalDebit;
};

const findExactTransaction = async (transactionModel, requestId) => {
  const matches = await transactionModel.find({
    serviceType: "DATA",
    provider: "TELECOM_ABODE",
    $or: [{ providerRequestId: requestId }, { reference: requestId }],
  })
    .limit(2)
    .lean();
  if (!matches.length) return { status: "NOT_FOUND" };
  if (matches.length !== 1) return { status: "AMBIGUOUS" };
  const transaction = matches[0];
  if (transaction.providerRequestId !== requestId && transaction.reference !== requestId) {
    return { status: "NOT_FOUND" };
  }
  return { status: "FOUND", transaction };
};

const createTelecomAbodeDataSettlementService = ({
  transactionModel = Transaction,
  userModel = User,
  ledgerModel = LedgerEntry,
  startSession = () => mongoose.startSession(),
  reverseEntry = reverseLedgerEntry,
  processSuccessCommissionEffect = processTelecomAbodeDataCommissionEffect,
} = {}) => {
  const settleTelecomAbodeDataOutcome = async ({
    requestId,
    outcome,
    source,
    evidence = {},
  } = {}) => {
    const normalizedRequestId = normalizedText(requestId);
    const normalizedOutcome = String(outcome || "").trim().toUpperCase();
    const sourceConfig = SOURCE_CONFIG[source];
    if (
      !normalizedRequestId ||
      normalizedRequestId.length > 128 ||
      !sourceConfig ||
      !["SUCCESS", "FAILED", "PENDING"].includes(normalizedOutcome) ||
      normalizedText(evidence.requestId) !== normalizedRequestId ||
      normalizedText(evidence.service).toLowerCase() !== "data"
    ) {
      return { status: "NOT_ELIGIBLE" };
    }
    if (source !== "WEBHOOK" && evidence.documentedDataStatus !== true) {
      return { status: "NOT_ELIGIBLE" };
    }
    if (source === "WEBHOOK" && evidence.verifiedSource !== true) {
      return { status: "NOT_ELIGIBLE" };
    }

    const lookup = await findExactTransaction(transactionModel, normalizedRequestId);
    if (lookup.status !== "FOUND") return { status: lookup.status };
    const initial = lookup.transaction;
    if (initial.status !== "PENDING") {
      return { status: "ALREADY_TERMINAL", transaction: initial };
    }

    const suppliedAmount = evidence.amount === undefined || evidence.amount === null
      ? null
      : normalizedAmount(evidence.amount);
    if (evidence.amount !== undefined && evidence.amount !== null && suppliedAmount === null) {
      return { status: "AMOUNT_MISMATCH" };
    }
    if (suppliedAmount !== null) {
      const providerPrice = normalizedAmount(initial.providerResponse?.providerPrice);
      if (providerPrice === null || suppliedAmount !== providerPrice) {
        return { status: "AMOUNT_MISMATCH" };
      }
    }

    if (
      !initial.dispatchClaimedAt ||
      !initial.debitLedgerEntryId ||
      !sourceConfig.dispatchStatuses.includes(initial.dispatchStatus)
    ) {
      return { status: "NOT_ELIGIBLE", transaction: initial };
    }

    const audit = {
      source: sourceConfig.provenance,
      outcome: normalizedOutcome,
      providerStatus: normalizedText(evidence.providerStatus).slice(0, 24) || normalizedOutcome,
      requestIdMatches: true,
      amountProvided: suppliedAmount !== null,
      ...(source === "WEBHOOK"
        ? { balanceEvidenceProvided: evidence.balanceEvidenceProvided === true }
        : {}),
      ...(suppliedAmount !== null ? { amountMatched: true } : {}),
      ...(Number.isInteger(evidence.httpStatus)
        ? { httpStatus: evidence.httpStatus }
        : {}),
      receivedAt: new Date(),
    };
    const transactionFilter = {
      _id: initial._id,
      reference: initial.reference,
      providerRequestId: initial.providerRequestId,
      serviceType: "DATA",
      provider: "TELECOM_ABODE",
      status: "PENDING",
      dispatchStatus: { $in: sourceConfig.dispatchStatuses },
      dispatchClaimedAt: { $ne: null },
      debitLedgerEntryId: { $ne: null },
      reversalLedgerEntryId: null,
    };
    const settlementUpdate = {
      "providerResponse.telecomAbodeSettlement": audit,
    };
    if (source === "REQUEST" || source === "WEBHOOK") {
      settlementUpdate["providerResponse.response"] = {
        provider: "TELECOM_ABODE",
        service: "data",
        status: normalizedOutcome,
        documentedDataStatus: normalizedOutcome !== "PENDING",
        requestId: normalizedRequestId,
        providerReference: normalizedRequestId,
        ...(suppliedAmount === null ? {} : { amount: String(suppliedAmount) }),
      };
    }
    if (source === "STATUS_QUERY") {
      settlementUpdate["providerResponse.reconciliation"] = {
        source: sourceConfig.provenance,
        httpStatus: Number.isInteger(evidence.httpStatus) ? evidence.httpStatus : 200,
        outcome: normalizedOutcome,
        requestIdMatches: true,
        ...(normalizedOutcome === "FAILED" ? { refundStatus: "REFUNDED" } : {}),
        response: {
          provider: "TELECOM_ABODE",
          service: "data",
          status: normalizedOutcome,
          "request-id": normalizedRequestId,
        },
      };
    }
    if (normalizedOutcome === "SUCCESS") {
      const effectCreatedAt = new Date();
      settlementUpdate["providerResponse.dataSuccessEffects.version"] = 1;
      settlementUpdate["providerResponse.dataSuccessEffects.commission"] = {
        key: `DATA:${initial.reference}:COMMISSION`,
        status: "PENDING",
        attempts: 0,
        createdAt: effectCreatedAt,
        nextAttemptAt: effectCreatedAt,
        leaseId: "",
        leaseUntil: null,
        lastErrorCode: "",
      };
    }
    if (normalizedOutcome === "PENDING") {
      await verifyCanonicalDebitCustody({
        transaction: initial,
        ledgerModel,
      });
      const recorded = await transactionModel.findOneAndUpdate(
        transactionFilter,
        { $set: settlementUpdate },
        { new: true },
      ).lean();
      if (recorded) return { status: "PENDING", transaction: recorded };
      const current = await transactionModel.findById(initial._id).lean();
      return current?.status && current.status !== "PENDING"
        ? { status: "ALREADY_TERMINAL", transaction: current }
        : { status: "NOT_ELIGIBLE", transaction: current || initial };
    }

    const session = await startSession();
    let result = { status: "NOT_CLAIMED" };
    try {
      await session.withTransaction(async () => {
        const nextStatus = normalizedOutcome === "SUCCESS" ? "SUCCESSFUL" : "FAILED";
        const nextDispatchStatus = normalizedOutcome === "SUCCESS" ? "SUCCEEDED" : "REFUNDED";
        const current = await transactionModel.findById(initial._id)
          .session(session)
          .lean();
        if (
          !current ||
          current.status !== "PENDING" ||
          current.reference !== initial.reference ||
          current.providerRequestId !== initial.providerRequestId ||
          current.serviceType !== "DATA" ||
          current.provider !== "TELECOM_ABODE" ||
          !sourceConfig.dispatchStatuses.includes(current.dispatchStatus) ||
          !current.dispatchClaimedAt
        ) {
          result = current?.status && current.status !== "PENDING"
            ? { status: "ALREADY_TERMINAL", transaction: current }
            : { status: "NOT_CLAIMED", transaction: current || null };
          return;
        }
        const originalDebit = await verifyCanonicalDebitCustody({
          transaction: current,
          ledgerModel,
          session,
        });
        const claimed = await transactionModel.findOneAndUpdate(
          transactionFilter,
          {
            $set: {
              status: nextStatus,
              dispatchStatus: nextDispatchStatus,
              providerStatus: nextStatus,
              providerReference: normalizedRequestId,
              ...settlementUpdate,
            },
          },
          { new: true, session },
        );
        if (!claimed) {
          const latest = await transactionModel.findById(initial._id).session(session).lean();
          result = latest?.status && latest.status !== "PENDING"
            ? { status: "ALREADY_TERMINAL", transaction: latest }
            : { status: "NOT_CLAIMED", transaction: latest || null };
          return;
        }
        if (!claimed.debitLedgerEntryId.equals(originalDebit._id)) {
          throw new Error("Telecom Abode DATA debit linkage changed before terminal settlement.");
        }

        if (normalizedOutcome === "FAILED") {
          const customerBefore = await userModel.findById(claimed.customerId)
            .select("walletBalance")
            .session(session)
            .lean();
          if (!customerBefore) {
            throw new Error("Customer account for Telecom Abode DATA refund was not found.");
          }
          const openingBalance = Number(customerBefore.walletBalance);
          if (!Number.isFinite(openingBalance) || openingBalance < 0) {
            throw new Error("Customer wallet balance for Telecom Abode DATA refund is invalid.");
          }
          const updatedCustomer = await userModel.findOneAndUpdate(
            { _id: claimed.customerId },
            { $inc: { walletBalance: claimed.amount } },
            { new: true, session },
          );
          if (!updatedCustomer) {
            throw new Error("Customer wallet could not be credited for Telecom Abode DATA refund.");
          }
          const reversal = await reverseEntry({
            originalEntryId: originalDebit._id,
            openingBalance,
            closingBalance: Number(updatedCustomer.walletBalance),
            idempotencyKey: `DATA:${claimed.reference}:REVERSAL:CREDIT`,
            narration: "Telecom Abode DATA purchase refund",
            metadata: {
              provider: "TELECOM_ABODE",
              reason: `Correlated terminal failure from ${sourceConfig.provenance}`,
              providerReference: normalizedRequestId,
            },
            session,
          });
          if (reversal.duplicate) {
            throw new Error("Duplicate Telecom Abode DATA reversal ledger entry detected.");
          }
          const linked = await transactionModel.updateOne(
            {
              _id: claimed._id,
              status: "FAILED",
              dispatchStatus: "REFUNDED",
              reversalLedgerEntryId: null,
            },
            { $set: { reversalLedgerEntryId: reversal.entry._id } },
            { session },
          );
          if (linked.modifiedCount !== 1) {
            throw new Error("Telecom Abode DATA refund ledger could not be linked to its transaction.");
          }
          result = {
            status: "REFUNDED",
            transaction: {
              ...claimed.toObject(),
              reversalLedgerEntryId: reversal.entry._id,
            },
            reversalLedgerEntryId: reversal.entry._id,
            walletBalance: Number(updatedCustomer.walletBalance),
          };
          return;
        }

        await enqueueReferralRewardEvent({
          referredCustomerId: claimed.customerId,
          sourceType: "DATA",
          sourceId: claimed._id,
          session,
        });
        result = { status: "SETTLED", didSettle: true, transaction: claimed };
      });
    } finally {
      await session.endSession();
    }

    if (result.status === "SETTLED" && normalizedOutcome === "SUCCESS") {
      try {
        const effect = await processSuccessCommissionEffect(initial._id);
        if (["RETRY_PENDING", "BLOCKED"].includes(effect?.status)) {
          console.error("TELECOM ABODE DATA COMMISSION EFFECT DEFERRED:", {
            code: effect.errorCode || "DATA_COMMISSION_EFFECT_DEFERRED",
          });
        }
      } catch (error) {
        // The commission intent is durable on the successful transaction;
        // failures must not undo or misreport the provider settlement.
        console.error("TELECOM ABODE DATA COMMISSION EFFECT DEFERRED:", {
          code: safeErrorCode(error),
        });
      }
      return result;
    }
    if (result.status !== "NOT_CLAIMED") return result;
    const current = await transactionModel.findById(initial._id).lean();
    if (current?.status && current.status !== "PENDING") {
      return { status: "ALREADY_TERMINAL", transaction: current };
    }
    return { status: "NOT_ELIGIBLE", transaction: current || initial };
  };

  return { settleTelecomAbodeDataOutcome };
};

const defaultService = createTelecomAbodeDataSettlementService();

module.exports = {
  createTelecomAbodeDataSettlementService,
  settleTelecomAbodeDataOutcome: defaultService.settleTelecomAbodeDataOutcome,
};