const Transaction = require("../models/transaction.model");
const telecomAbode = require("./telecomAbode.service");
const {
  settleTelecomAbodeDataOutcome,
} = require("./telecomAbodeDataSettlement.service");

const UNKNOWN_RESULT = Object.freeze({
  outcome: "UNKNOWN",
  message: "The provider did not return a correlated terminal status. No wallet mutation or purchase dispatch was made.",
});

const createTelecomAbodeDataReconciliationService = ({
  transactionModel = Transaction,
  getTransactionByRequestId = (requestId) =>
    telecomAbode.getTransactionByRequestId(requestId),
  settleOutcome = settleTelecomAbodeDataOutcome,
} = {}) => {
  const reconcileByReference = async (reference) => {
    const transaction = await transactionModel.findOne({ reference }).lean();
    if (!transaction) {
      return { httpStatus: 404, body: { outcome: "NOT_FOUND" } };
    }

    if (
      transaction.serviceType !== "DATA" ||
      transaction.provider !== "TELECOM_ABODE" ||
      transaction.status !== "PENDING" ||
      transaction.dispatchStatus !== "UNKNOWN" ||
      !transaction.dispatchClaimedAt ||
      !transaction.reference ||
      !transaction.providerRequestId ||
      transaction.reference !== transaction.providerRequestId
    ) {
      return {
        httpStatus: 409,
        body: {
          outcome: "NOT_ELIGIBLE",
          status: transaction.status,
          dispatchStatus: transaction.dispatchStatus,
        },
      };
    }

    let result;
    try {
      result = await getTransactionByRequestId(transaction.providerRequestId);
    } catch (error) {
      return {
        httpStatus: 202,
        body: {
          ...UNKNOWN_RESULT,
          providerLookup: error?.code === "TRANSACTION_NOT_FOUND"
            ? "NOT_FOUND"
            : "UNAVAILABLE",
        },
      };
    }

    if (
      !result ||
      String(result.requestId || "").trim() !== transaction.providerRequestId ||
      (result.provider &&
        String(result.provider).trim().toUpperCase() !== "TELECOM_ABODE") ||
      String(result.providerReference || "").trim() !== transaction.providerRequestId ||
      String(result.service || "").trim().toLowerCase() !== "data" ||
      result.documentedDataStatus !== true ||
      !["SUCCESS", "FAILED", "PENDING", "UNKNOWN"].includes(result.status)
    ) {
      return {
        httpStatus: 202,
        body: { ...UNKNOWN_RESULT, providerLookup: "UNCORRELATED" },
      };
    }

    const rawStatus = String(result.rawProviderStatus || "").trim().toUpperCase();
    const rawOutcome = ["SUCCESS", "SUCCESSFUL", "COMPLETED"].includes(rawStatus)
      ? "SUCCESS"
      : ["FAILED", "FAIL", "FAILURE"].includes(rawStatus)
        ? "FAILED"
        : ["PENDING", "PROCESSING"].includes(rawStatus)
          ? "PENDING"
          : null;
    if (rawOutcome && rawOutcome !== result.status) {
      return {
        httpStatus: 202,
        body: { ...UNKNOWN_RESULT, providerLookup: "CONTRADICTORY" },
      };
    }
    const providerMessage = String(result.providerMessage || "").toUpperCase();
    const messageSignalsFailure =
      /\b(FAILED|FAILURE|ERROR|INVALID|REJECTED|DECLINED)\b/.test(providerMessage);
    const messageSignalsSuccess =
      /\b(SUCCESS|SUCCESSFUL|COMPLETED)\b/.test(providerMessage);
    if (
      (result.status === "SUCCESS" && messageSignalsFailure) ||
      (result.status === "FAILED" && messageSignalsSuccess)
    ) {
      return {
        httpStatus: 202,
        body: { ...UNKNOWN_RESULT, providerLookup: "CONTRADICTORY" },
      };
    }
    if (result.status === "PENDING" || result.status === "UNKNOWN") {
      return {
        httpStatus: 202,
        body: { ...UNKNOWN_RESULT, providerStatus: result.status },
      };
    }

    const settled = await settleOutcome({
      requestId: transaction.providerRequestId,
      outcome: result.status,
      source: "STATUS_QUERY",
      evidence: {
        requestId: result.requestId,
        service: result.service,
        documentedDataStatus: true,
        providerStatus: result.rawProviderStatus || result.status,
        amount: result.amount,
        httpStatus: 200,
      },
    });

    if (settled.status === "SETTLED") {
      return {
        httpStatus: 200,
        body: {
          outcome: "SUCCESS",
          status: "SUCCESSFUL",
          dispatchStatus: "SUCCEEDED",
          reference: settled.transaction.reference,
        },
      };
    }
    if (settled.status === "REFUNDED") {
      return {
        httpStatus: 200,
        body: {
          outcome: "FAILED",
          status: "FAILED",
          dispatchStatus: "REFUNDED",
          reference: settled.transaction.reference,
          walletDebitHeld: false,
        },
      };
    }
    if (settled.status === "ALREADY_TERMINAL") {
      const successful = settled.transaction.status === "SUCCESSFUL";
      const refunded = settled.transaction.status === "FAILED" &&
        settled.transaction.dispatchStatus === "REFUNDED";
      return {
        httpStatus: successful || refunded ? 200 : 202,
        body: {
          outcome: successful ? "SUCCESS" : refunded ? "FAILED" : "UNKNOWN",
          status: settled.transaction.status,
          dispatchStatus: settled.transaction.dispatchStatus,
          ...(successful || refunded ? { reference: settled.transaction.reference } : {}),
          ...(refunded ? { walletDebitHeld: false } : {}),
        },
      };
    }
    return {
      httpStatus: 202,
      body: {
        ...UNKNOWN_RESULT,
        providerLookup: settled.status === "AMOUNT_MISMATCH"
          ? "AMOUNT_MISMATCH"
          : "SETTLEMENT_UNAVAILABLE",
      },
    };
  };

  return { reconcileByReference };
};

module.exports = { createTelecomAbodeDataReconciliationService };