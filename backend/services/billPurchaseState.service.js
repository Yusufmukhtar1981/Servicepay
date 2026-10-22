// Presentation only. Never use a display state to authorize settlement/refunds.
function billPurchaseState(transaction) {
  if (!["DATA", "AIRTIME"].includes(transaction?.serviceType)) return {};
  const status = String(transaction.status || "").toUpperCase();
  let processingStatus;
  if (["SUCCESS", "SUCCESSFUL"].includes(status)) processingStatus = "SUCCESS";
  else if (status === "REFUNDED") processingStatus = "REFUNDED";
  else if (status === "FAILED") processingStatus = "FAILED";
  else if (transaction.dispatchStatus === "READY") processingStatus = "INITIATED";
  else if (["CLAIMED", "SENDING"].includes(transaction.dispatchStatus)) {
    processingStatus = "PROCESSING";
  } else processingStatus = "PENDING_VERIFICATION";
  return {
    processingStatus,
    verificationRequired: processingStatus === "PENDING_VERIFICATION",
    ...(processingStatus === "PENDING_VERIFICATION" ? {
      verificationMessage:
        "Your transaction is being verified. Please do not repeat this purchase.",
    } : {}),
  };
}

module.exports = { billPurchaseState };
