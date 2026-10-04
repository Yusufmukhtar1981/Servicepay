const Transaction = require("../models/transaction.model");
const User = require("../models/user.model");
const mongoose = require("mongoose");
const { createTelecomAbodeDataReconciliationService } =
  require("../services/telecomAbodeDataReconciliation.service");
const reconciliation = createTelecomAbodeDataReconciliationService();
const checks = new Map();
async function reconcileOnce(reference) {
  const previous = checks.get(reference);
  if (previous && previous.until > Date.now()) return previous.promise;
  if (checks.size >= 1000) checks.delete(checks.keys().next().value);
  const promise = reconciliation.reconcileByReference(reference);
  checks.set(reference, { until: Date.now() + 30000, promise });
  return promise;
}

// Query only: use the existing correlated settlement service, never redispatch.
function createDataPurchaseStatus({ lookup = query => Transaction.findOne(query)
  .select("serviceType provider providerRequestId dispatchClaimedAt phone amount status reference dispatchStatus createdAt providerResponse").lean(),
  reconcile = reconcileOnce,
  isRetired = async (customerId, key) =>
    Boolean(await User.exists({ _id: customerId, retiredDataRequestKeys: key }))
} = {}) {
  return async (req, res) => {
    const customerId = req.user?._id || req.user?.id;
    const key = req.params?.key;
    if (!customerId || String(req.user?.role).toUpperCase() !== "CUSTOMER")
      return res.status(403).json({ success: false, message: "Customer access only." });
    if (typeof key !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(key))
      return res.status(400).json({ success: false, message: "Invalid request key." });
    try {
      const filter = { customerId, serviceType: "DATA", idempotencyKey: key };
      let tx = await lookup(filter);
      if (!tx && await isRetired(customerId, key)) {
        return res.json({ success: false, status: "FAILED",
          pending: false, requestRetired: true, walletDebitHeld: false,
          message: "The unrecorded request was retired before admission. No wallet debit was made." });
      }
      if (!tx) return res.status(404).json({ success: false, pending: true,
        status: "UNKNOWN", manualReviewRequired: true, allowSeparatePurchase: false,
        canRetireUnrecordedRequest: true,
        message: "Original request is not yet recorded. Do not submit another purchase." });
      let checked;
      if (tx.provider === "TELECOM_ABODE" && tx.status === "PENDING" &&
          tx.dispatchStatus === "UNKNOWN" && tx.dispatchClaimedAt) {
        checked = await reconcile(tx.reference);
        // Settlement is atomic and request-bound. Re-read custody, not a
        // provider message, before claiming delivery or a confirmed refund.
        tx = await lookup(filter);
        if (!tx) throw new Error("RECOVERY_RECORD_MISSING");
      }
      const active = tx.status === "PENDING" &&
        (tx.dispatchStatus !== "UNKNOWN" || checked?.body?.providerStatus === "PENDING");
      const review = !active && (tx.dispatchStatus === "UNKNOWN" ||
        (tx.status === "FAILED" && tx.dispatchStatus !== "REFUNDED"));
      const meta = tx.providerResponse || {};
      return res.json({ success: tx.status === "SUCCESSFUL",
        status: review ? "UNKNOWN" : tx.status,
        pending: tx.status === "PENDING" || review,
        manualReviewRequired: review,
        allowSeparatePurchase: review,
        reference: tx.reference, dispatchStatus: tx.dispatchStatus,
        phone: tx.phone, amount: tx.amount, amountCharged: tx.amount,
        createdAt: tx.createdAt,
        network: meta.network || meta.telecomAbodePurchaseIntent?.network,
        planName: meta.planName || meta.dataPlanName || meta.productName,
        message: tx.status === "SUCCESSFUL" ? "Data purchase successful." :
          tx.dispatchStatus === "REFUNDED" ? "Data purchase failed. Wallet refund confirmed." :
            review ? "The earlier request remains unresolved and retained for review. Its funds remain held. You may explicitly start a separate purchase; the original will not be resent." :
            "The original DATA request is awaiting confirmation. Do not submit again." });
    } catch (_) {
      return res.status(503).json({ success: false, pending: true,
        message: "Status unavailable. Retain the original request; do not submit again." });
    }
  };
}

async function retireUnrecordedDataRequest(req, res) {
  const customerId = req.user?._id || req.user?.id;
  const key = req.params?.key;
  if (!customerId || String(req.user?.role).toUpperCase() !== "CUSTOMER") {
    return res.status(403).json({ success: false, message: "Customer access only." });
  }
  if (typeof key !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    return res.status(400).json({ success: false, message: "Invalid request key." });
  }
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // Lock the same customer document the debit admission writes. Concurrent
      // admission must either commit first (and be found below), or lose to this
      // permanent fence. Never infer "no debit" from a naked 404 or client age.
      const customer = await User.findOneAndUpdate(
        { _id: customerId, status: "ACTIVE",
          $or: [{retiredDataRequestKeys: key},
            {"retiredDataRequestKeys.999": {$exists: false}}] },
        { $addToSet: { retiredDataRequestKeys: key } },
        { new: true, session },
      );
      if (!customer) throw Object.assign(new Error("RECOVERY_UNAVAILABLE"), { code: "RECOVERY_UNAVAILABLE" });
      const recorded = await Transaction.findOne({
        customerId, serviceType: "DATA", idempotencyKey: key,
      }).session(session).lean();
      if (recorded) throw Object.assign(new Error("REQUEST_RECORDED"), { code: "REQUEST_RECORDED" });
    });
    return res.json({ success: false, status: "FAILED", pending: false,
      requestRetired: true, walletDebitHeld: false,
      message: "The unrecorded request was safely retired before admission. No purchase was sent and no wallet debit was made." });
  } catch (error) {
    return res.status(error.code === "REQUEST_RECORDED" ? 409 : 503).json({
      success: false, pending: true, status: "PENDING",
      message: "The original request could not be safely retired. Check its status; do not submit again.",
    });
  } finally {
    await session.endSession();
  }
}
module.exports = { createDataPurchaseStatus, getDataPurchaseStatus: createDataPurchaseStatus(),
  retireUnrecordedDataRequest };