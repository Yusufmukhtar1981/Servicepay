const Transaction = require("../models/transaction.model");
const LedgerEntry = require("../models/ledgerEntry.model");
const telecomAbode = require("./telecomAbode.service");
const { refundFailedDataPurchase } = require("./clubkonnectDataFailure.service");

const UNKNOWN_RESULT = Object.freeze({
  outcome: "UNKNOWN",
  message: "The provider did not return a correlated terminal status. No wallet mutation or purchase dispatch was made.",
});

const createTelecomAbodeDataReconciliationService = ({
  transactionModel = Transaction,
  getTransactionByRequestId = (requestId) =>
    telecomAbode.getTransactionByRequestId(requestId),
  refundPurchase = refundFailedDataPurchase,
} = {}) => {
  const reconcileByReference = async (reference) => {
    const transaction = await transactionModel.findOne({ reference }).lean();
    if (!transaction) {
      return { httpStatus: 404, body: { outcome: "NOT_FOUND" } };
    }

    const lockedResponse = () => ({
      httpStatus: 409,
      body: {
        outcome: "NOT_ELIGIBLE",
        status: transaction.status,
        dispatchStatus: transaction.dispatchStatus,
      },
    });

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
      return lockedResponse();
    }

    let result;
    try {
      result = await getTransactionByRequestId(transaction.providerRequestId);
    } catch (error) {
      // Provider 404, timeout and transport failures are uncertainty, never
      // evidence that delivery failed or permission to send another purchase.
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
      (result.providerReference &&
        String(result.providerReference).trim() !== transaction.providerRequestId) ||
      (result.service && String(result.service).trim().toLowerCase() !== "data") ||
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
      : ["FAILED", "FAILURE"].includes(rawStatus)
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
    if (
      result.amount !== undefined &&
      transaction.providerResponse?.providerPrice !== undefined &&
      Number(result.amount) !== Number(transaction.providerResponse.providerPrice)
    ) {
      return {
        httpStatus: 202,
        body: { ...UNKNOWN_RESULT, providerLookup: "AMOUNT_MISMATCH" },
      };
    }

    const evidence = {
      provider: "TELECOM_ABODE",
      service: "data",
      status: result.status,
      "request-id": result.requestId,
      reference: result.providerReference || result.requestId,
    };

    const debit = await LedgerEntry.findOne({
      _id: transaction.debitLedgerEntryId,
      user: transaction.customerId,
      transactionId: transaction._id,
      reference: transaction.reference,
      service: "DATA",
      direction: "DEBIT",
      amount: transaction.amount,
    }).lean();
    if (!debit) {
      return {
        httpStatus: 202,
        body: { ...UNKNOWN_RESULT, providerLookup: "DEBIT_LEDGER_UNVERIFIED" },
      };
    }

    if (result.status === "FAILED") {
      const refund = await refundPurchase({
        transactionId: transaction._id,
        providerResponse: evidence,
        httpStatus: 200,
        verifiedStatusQuery: true,
      });
      if (refund.status !== "REFUNDED") {
        const current = await transactionModel.findById(transaction._id).lean();
        return {
          httpStatus: current?.status === "FAILED" ? 200 : 202,
          body: {
            outcome: current?.status === "FAILED" ? "FAILED" : "UNKNOWN",
            status: current?.status || "PENDING",
            dispatchStatus: current?.dispatchStatus || "UNKNOWN",
            ...(current?.status === "FAILED"
              ? { reference: current.reference }
              : {}),
          },
        };
      }
      return {
        httpStatus: 200,
        body: {
          outcome: "FAILED",
          status: "FAILED",
          dispatchStatus: "REFUNDED",
          reference: refund.transaction.reference,
          walletBalance: refund.walletBalance,
        },
      };
    }

    const reconciled = await transactionModel.findOneAndUpdate(
      {
        _id: transaction._id,
        reference: transaction.reference,
        providerRequestId: transaction.providerRequestId,
        serviceType: "DATA",
        provider: "TELECOM_ABODE",
        status: "PENDING",
        dispatchStatus: "UNKNOWN",
        dispatchClaimedAt: { $ne: null },
        debitLedgerEntryId: { $ne: null },
      },
      {
        $set: {
          status: "SUCCESSFUL",
          dispatchStatus: "SUCCEEDED",
          providerStatus: "SUCCESSFUL",
          providerReference: transaction.providerRequestId,
          providerResponse: {
            ...(transaction.providerResponse || {}),
            reconciliation: {
              source: "TELECOM_ABODE_STATUS_QUERY",
              httpStatus: 200,
              outcome: "SUCCESS",
              requestIdMatches: true,
            },
          },
        },
      },
      { new: true },
    );
    if (!reconciled) {
      const current = await transactionModel.findById(transaction._id).lean();
      return {
        httpStatus: current?.status === "SUCCESSFUL" ? 200 : 202,
        body: {
          outcome: current?.status === "SUCCESSFUL" ? "SUCCESS" : "UNKNOWN",
          status: current?.status || "PENDING",
          dispatchStatus: current?.dispatchStatus || "UNKNOWN",
          ...(current?.status === "SUCCESSFUL"
            ? { reference: current.reference }
            : {}),
        },
      };
    }

    return {
      httpStatus: 200,
      body: {
        outcome: "SUCCESS",
        status: "SUCCESSFUL",
        dispatchStatus: "SUCCEEDED",
        reference: reconciled.reference,
      },
    };
  };

  return { reconcileByReference };
};

module.exports = { createTelecomAbodeDataReconciliationService };