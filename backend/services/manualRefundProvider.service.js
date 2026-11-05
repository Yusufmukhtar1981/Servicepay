const { createClubKonnectAirtimeProvider } = require("./clubkonnectAirtimeProvider.service");
const telecom = require("./telecomAbode.service");
const club = createClubKonnectAirtimeProvider();

// Query only. Never call a purchase, requery-and-settle controller, or dispatcher.
const createVerifier = ({ clubProvider = club, telecomProvider = telecom } = {}) => async transaction => {
  const requestId = String(transaction.providerRequestId || "").trim();
  if (!requestId) return { outcome: "UNKNOWN", code: "PROVIDER_REFERENCE_REQUIRED" };
  try {
    if (transaction.provider === "CLUBKONNECT") {
      const result = await clubProvider.query({
        requestId,
        orderId: transaction.providerOrderId || "",
      });
      const correlated = result.requestId === requestId &&
        (!transaction.providerOrderId || result.providerOrderId === transaction.providerOrderId);
      return {
        outcome: correlated && result.authoritative === true &&
          result.httpStatus === 200 && ["SUCCESS", "FAILED"].includes(result.outcome)
          ? result.outcome : "UNKNOWN",
        source: "CLUBKONNECT_STATUS_QUERY",
        requestId, providerOrderId: result.providerOrderId || "",
        httpStatus: result.httpStatus || null,
      };
    }
    if (transaction.provider === "TELECOM_ABODE" && transaction.serviceType === "DATA") {
      const result = await telecomProvider.getTransactionByRequestId(requestId);
      const text = String(result.providerMessage || "").toUpperCase();
      const correlated = result.provider === "TELECOM_ABODE" && result.service === "data" &&
        result.requestId === requestId && result.providerReference === requestId;
      const failed = result.status === "FAILED" && result.documentedDataStatus === true &&
        result.confirmedFailureReason === "INVALID_NETWORK_RECIPIENT" && result.amount &&
        Number(result.amount) === Number(transaction.providerResponse?.providerPrice) &&
        !/SUCCESS|COMPLETED|DELIVERED|GIFTED|PROCESSING|PENDING|CHECK.{0,48}LATER/.test(text);
      return {
        outcome: correlated && !result.contradictory
          ? failed ? "FAILED" : result.status === "SUCCESS" ? "SUCCESS" : "UNKNOWN"
          : "UNKNOWN",
        source: "TELECOM_ABODE_STATUS_QUERY", requestId,
        httpStatus: result.httpStatus || 200,
      };
    }
  } catch (_) {
    // Authentication/404/timeouts are not evidence of failed service delivery.
    return { outcome: "UNKNOWN", code: "PROVIDER_QUERY_UNAVAILABLE" };
  }
  return { outcome: "UNKNOWN", code: "PROVIDER_QUERY_UNSUPPORTED" };
};
module.exports = { verifyFailure: createVerifier(), createVerifier };
