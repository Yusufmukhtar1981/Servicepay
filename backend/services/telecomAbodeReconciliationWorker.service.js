const Transaction = require("../models/transaction.model");
const { createTelecomAbodeDataReconciliationService } = require("./telecomAbodeDataReconciliation.service");
const { createTelecomAbodeAirtimeLifecycle } = require("./telecomAbodeAirtimeLifecycle.service");
const { createTelecomAbodeElectricity } = require("./telecomAbodeElectricity.service");

// These are recovery scheduling/audit fields, never financial authority.
function recoverySchedule(tx, outcome, date, {
  initialBackoffMs, maxBackoffMs, escalationAfterMs,
}) {
  const previous = tx.providerResponse?.statusReconciliation || {};
  const counter = value => Number.isSafeInteger(value) && value >= 0
    ? Math.min(value, 1000000) : 0;
  const attemptCount = counter(previous.attemptCount) + 1;
  const unchangedOutcomeChecks = previous.outcome === outcome
    ? counter(previous.unchangedOutcomeChecks) + 1 : 1;
  const ageMs = date.getTime() - new Date(tx.createdAt).getTime();
  const unresolved = ["PENDING", "UNKNOWN"].includes(outcome);
  // Recent uncertain requests get faster early checks. Old unresolved requests
  // stay at the cap instead of creating a retry burst when this code is released.
  const delayMs = !unresolved || ageMs >= maxBackoffMs ? maxBackoffMs :
    Math.min(maxBackoffMs, initialBackoffMs * (2 ** Math.min(20, unchangedOutcomeChecks - 1)));
  const lastAlert = new Date(previous.lastOverdueAlertAt).getTime();
  const alert = unresolved && ageMs >= escalationAfterMs &&
    (!Number.isFinite(lastAlert) || date.getTime() - lastAlert >= 3600000);
  return {
    delayMs, alert,
    metadata: {
      attemptCount, unchangedOutcomeChecks,
      ...(alert ? {
        escalatedAt: previous.escalatedAt || date,
        lastOverdueAlertAt: date,
        escalationReason: "PROVIDER_CONFIRMATION_OVERDUE",
      } : {}),
    },
  };
}

// Recovery only: these methods perform authenticated GET lookups and use the
// existing atomic settlement paths. No purchase/dispatch methods are exposed.
function createTelecomAbodeReconciliationWorker({
  model = Transaction, data = createTelecomAbodeDataReconciliationService(),
  airtime = createTelecomAbodeAirtimeLifecycle(), electricity = createTelecomAbodeElectricity(),
  now = () => new Date(), limit = 5,
  initialBackoffMs = 60000, maxBackoffMs = 900000, escalationAfterMs = 1800000,
  onAlert = event => console.warn(JSON.stringify(event)),
} = {}) {
  if (![initialBackoffMs, maxBackoffMs, escalationAfterMs]
    .every(value => Number.isSafeInteger(value) && value > 0) ||
      initialBackoffMs > maxBackoffMs) throw new TypeError("Invalid reconciliation timing");
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    const escalated = { DATA: 0, AIRTIME: 0 };
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
            // The lifecycle returns a transaction document, not a provider
            // result wrapper. Financial PENDING does not prove provider PENDING.
            const transaction = result?.transaction || result;
            const state = transaction?.providerResponse?.airtimeLifecycle;
            outcome = ["SUCCESS", "SUCCESSFUL"].includes(transaction?.status) ? "SUCCESS" :
              ["FAILED", "REFUNDED"].includes(transaction?.status) ? "FAILED" :
              state?.outcome === "PENDING" ? "PENDING" : "UNKNOWN";
            lookupReason = String(state?.reasonCode || "UNCONFIRMED")
              .replace(/[^A-Z0-9_-]/gi, "").slice(0, 64);
          } else {
            const result = await electricity.requery(tx.customerId, tx._id);
            outcome = result?.data?.status || "UNKNOWN";
          }
        } catch (_) {
          // Do not expose raw provider errors, credentials, or recipient details.
          lookupReason = "LOOKUP_UNAVAILABLE";
        }
        const checkedAt = now();
        const schedule = ["DATA", "AIRTIME"].includes(tx.serviceType)
          ? recoverySchedule(tx, outcome, checkedAt,
            { initialBackoffMs, maxBackoffMs, escalationAfterMs }) : null;
        await model.updateOne({ _id: tx._id }, { $set: {
          "providerResponse.statusReconciliation.checkedAt": checkedAt,
          "providerResponse.statusReconciliation.outcome": outcome,
          ...(lookupEvidence ? {
            "providerResponse.statusReconciliation.evidence": lookupEvidence,
          } : {}),
          ...(lookupReason ? {
            "providerResponse.statusReconciliation.reason": lookupReason,
          } : {}),
          ...Object.fromEntries(Object.entries(schedule?.metadata || {}).map(
            ([key, value]) => [`providerResponse.statusReconciliation.${key}`, value])),
          "providerResponse.statusReconciliation.nextCheckAt":
            new Date(checkedAt.getTime() +
              (schedule?.delayMs ?? (outcome === "PENDING" ? 60000 : 900000))),
        }, $unset: { "providerResponse.statusReconciliation.leaseUntil": "" } });
        if (schedule?.alert) escalated[tx.serviceType]++;
      }
      if (escalated.DATA || escalated.AIRTIME) {
        // Aggregate counts only: no references, recipients, balances, provider
        // messages, headers or credentials in monitoring events.
        try {
          await onAlert({ event: "BILL_RECONCILIATION_OVERDUE",
            provider: "TELECOM_ABODE", escalationAfterMs, counts: escalated });
        } catch (_) { /* Monitoring cannot change financial recovery behavior. */ }
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
module.exports = { createTelecomAbodeReconciliationWorker, startTelecomAbodeReconciliationWorker,
  recoverySchedule };