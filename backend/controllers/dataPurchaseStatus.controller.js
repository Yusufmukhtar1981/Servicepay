const Transaction = require("../models/transaction.model");

// Recovery reads recorded custody only. Never calls a provider or mutates funds.
function createDataPurchaseStatus({ lookup = query => Transaction.findOne(query)
  .select("serviceType phone amount status reference dispatchStatus createdAt providerResponse").lean() } = {}) {
  return async (req, res) => {
    const customerId = req.user?._id || req.user?.id;
    const key = req.params?.key;
    if (!customerId || String(req.user?.role).toUpperCase() !== "CUSTOMER")
      return res.status(403).json({ success: false, message: "Customer access only." });
    if (typeof key !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(key))
      return res.status(400).json({ success: false, message: "Invalid request key." });
    try {
      const tx = await lookup({ customerId, serviceType: "DATA", idempotencyKey: key });
      if (!tx) return res.status(404).json({ success: false, pending: true,
        message: "Original request is not yet recorded. Do not submit another purchase." });
      const meta = tx.providerResponse || {};
      return res.json({ success: tx.status === "SUCCESSFUL",
        status: tx.status, pending: tx.status === "PENDING",
        reference: tx.reference, dispatchStatus: tx.dispatchStatus,
        phone: tx.phone, amount: tx.amount, amountCharged: tx.amount,
        createdAt: tx.createdAt,
        network: meta.network || meta.telecomAbodePurchaseIntent?.network,
        planName: meta.planName || meta.dataPlanName || meta.productName,
        message: tx.status === "SUCCESSFUL" ? "Data purchase successful." :
          tx.dispatchStatus === "REFUNDED" ? "Data purchase failed. Wallet refund confirmed." :
            "The original DATA request is awaiting confirmation. Do not submit again." });
    } catch (_) {
      return res.status(503).json({ success: false, pending: true,
        message: "Status unavailable. Retain the original request; do not submit again." });
    }
  };
}
module.exports = { createDataPurchaseStatus, getDataPurchaseStatus: createDataPurchaseStatus() };