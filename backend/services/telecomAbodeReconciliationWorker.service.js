const Transaction = require("../models/transaction.model");
const { createTelecomAbodeDataReconciliationService } = require("./telecomAbodeDataReconciliation.service");
const { createTelecomAbodeAirtimeLifecycle } = require("./telecomAbodeAirtimeLifecycle.service");
const { createTelecomAbodeElectricity } = require("./telecomAbodeElectricity.service");

// Recovery only: these methods perform authenticated GET lookups and use the
// existing atomic settlement paths. No purchase/dispatch methods are exposed.
function createTelecomAbodeReconciliationWorker({
  model = Transaction, data = createTelecomAbodeDataReconciliationService(),
  airtime = createTelecomAbodeAirtimeLifecycle(), electricity = createTelecomAbodeElectricity(),
  now = () => new Date(), limit = 5,
} = {}) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      for (let i = 0; i < Math.min(10, limit); i++) {
        const date = now();
        const tx = await model.findOneAndUpdate({
          provider: "TELECOM_ABODE", serviceType: { $in: ["DATA", "AIRTIME", "ELECTRICITY"] },
          status: "PENDING", dispatchStatus: { $in: ["SENDING", "UNKNOWN"] },
          debitLedgerEntryId: { $ne: null }, providerRequestId: { $type: "string" },
          createdAt: { $lte: new Date(date.getTime() - 120000) },
          $and: [
            // A recently claimed dispatch is still in flight even when the
            // admission itself is older. Never race its provider response.
            { $or: [
              { dispatchStatus: "UNKNOWN" },
              { dispatchStatus: "SENDING", dispatchClaimedAt: {
                $lte: new Date(date.getTime() - 120000),
              } },
            ] },
            { $or: [{ "providerResponse.statusReconciliation.nextCheckAt": { $exists: false } },
              { "providerResponse.statusReconciliation.nextCheckAt": { $lte: date } }] },
            { $or: [{ "providerResponse.statusReconciliation.leaseUntil": { $exists: false } },
              { "providerResponse.statusReconciliation.leaseUntil": { $lte: date } }] },
          ],
        }, { $set: { "providerResponse.statusReconciliation.leaseUntil":
          new Date(date.getTime() + 300000) } }, {
          new: true,
          // Repeatedly pending old purchases must not starve newer recovery.
          // Missing checkedAt sorts first, then the least recently checked.
          sort: { "providerResponse.statusReconciliation.checkedAt": 1, createdAt: 1 },
        }).lean();
        if (!tx) break;
        let outcome = "UNKNOWN";
        let lookupEvidence = null;
        let lookupReason = null;
        try {
          if (tx.serviceType === "DATA") {
            if (tx.dispatchStatus === "SENDING") {
              // A crash after dispatch cannot prove delivery or non-delivery.
              // Move only this stale claim to recovery custody. Do not send,
              // debit, refund, or change its original request reference.
              const recovered = await model.findOneAndUpdate({
                _id: tx._id, provider: "TELECOM_ABODE", serviceType: "DATA",
                status: "PENDING", dispatchStatus: "SENDING",
                providerRequestId: tx.providerRequestId,
                reference: tx.providerRequestId,
                dispatchClaimedAt: { $lte: new Date(date.getTime() - 120000) },
              }, { $set: { dispatchStatus: "UNKNOWN" } }, { new: true }).lean();
              // A concurrent webhook/request may already have settled it.
              if (!recovered) continue;
            }
            const result = await data.reconcileByReference(tx.reference);
            outcome = result.body?.outcome || "UNKNOWN";
            lookupEvidence = result.evidence || null;
            lookupReason = result.body?.providerLookup || null;
          } else if (tx.serviceType === "AIRTIME") {
            const result = await airtime.reconcilePendingPurchase({ transactionId: tx._id });
            outcome = result?.transaction?.status || result?.status || "UNKNOWN";
          } else {
            const result = await electricity.requery(tx.customerId, tx._id);
            outcome = result?.data?.status || "UNKNOWN";
          }
        } catch (_) {
          // Do not expose raw provider errors, credentials, or recipient details.
        }
        await model.updateOne({ _id: tx._id }, { $set: {
          "providerResponse.statusReconciliation.checkedAt": now(),
          "providerResponse.statusReconciliation.outcome": outcome,
          ...(lookupEvidence ? {
            "providerResponse.statusReconciliation.evidence": lookupEvidence,
          } : {}),
          ...(lookupReason ? {
            "providerResponse.statusReconciliation.reason": lookupReason,
          } : {}),
          "providerResponse.statusReconciliation.nextCheckAt":
            new Date(now().getTime() + (outcome === "PENDING" ? 60000 : 900000)),
        }, $unset: { "providerResponse.statusReconciliation.leaseUntil": "" } });
      }
    } finally { running = false; }
  };
  return { run };
}
let timer;
function startTelecomAbodeReconciliationWorker() {
  if (timer) return timer;
  const worker = createTelecomAbodeReconciliationWorker();
  void worker.run().catch(() => console.warn("[BILL_RECONCILIATION] pass unavailable"));
  timer = setInterval(() => void worker.run().catch(() =>
    console.warn("[BILL_RECONCILIATION] pass unavailable")), 60000);
  timer.unref?.();
  return timer;
}
module.exports = { createTelecomAbodeReconciliationWorker, startTelecomAbodeReconciliationWorker };