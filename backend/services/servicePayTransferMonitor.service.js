const crypto = require("crypto");

const ServicePayTransferAttempt = require("../models/servicePayTransferAttempt.model");
const Transfer = require("../models/transfer.model");
const { sendEmail } = require("./email.service");

const DEFAULT_AGE_MS = 10 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_SAMPLE_LIMIT = 100;

let monitorTimer = null;
let monitorRunning = false;

const positiveInteger = (value, fallback) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const opaqueReference = (attempt) => {
  const key = process.env.JWT_SECRET || process.env.SESSION_SECRET;
  if (!key) {
    throw new Error("A server secret is required for transfer alert correlation references.");
  }
  return `SPAR-${crypto.createHmac("sha256", key)
    .update(`${attempt._id}:${attempt.reference}`)
    .digest("hex")
    .slice(0, 24)
    .toUpperCase()}`;
};

const publicRecord = (attempt, transfer) => ({
  attemptId: String(attempt._id),
  reference: opaqueReference(attempt),
  transferId: transfer ? String(transfer._id) : null,
  createdAt: new Date(attempt.createdAt).toISOString(),
  leaseExpiresAt: new Date(attempt.leaseExpiresAt).toISOString(),
  classification: transfer
    ? "COMMITTED_RESPONSE_LOST"
    : "EXPIRED_FAILED_RESERVATION",
});

const buildEmail = (alert) => {
  const rows = alert.records.map((record) =>
    `<tr><td>${escapeHtml(record.classification)}</td><td>${escapeHtml(record.reference)}</td>` +
    `<td>${escapeHtml(record.attemptId)}</td><td>${escapeHtml(record.transferId || "none")}</td></tr>`
  ).join("");
  return {
    subject: `[ServicePay Operations] ${alert.agedPendingCount} aged pending transfer attempt(s)`,
    text: [
      `Aged pending attempts: ${alert.agedPendingCount}`,
      `Expired failed reservations: ${alert.expiredFailedReservationCount}`,
      `Committed transfers with a lost response: ${alert.committedResponseLostCount}`,
      ...alert.records.map((record) =>
        `${record.classification} reference=${record.reference} attemptId=${record.attemptId} transferId=${record.transferId || "none"}`
      ),
      "Follow the ServicePay pending transfer runbook. Do not ask customers to retry pending references.",
    ].join("\n"),
    html: `<h2>ServicePay aged pending transfer attempts</h2>
      <p>Aged pending attempts: ${alert.agedPendingCount}</p>
      <p>Expired failed reservations: ${alert.expiredFailedReservationCount}</p>
      <p>Committed transfers with a lost response: ${alert.committedResponseLostCount}</p>
      <table><thead><tr><th>Classification</th><th>Reference</th><th>Attempt ID</th><th>Transfer ID</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <p>Follow the pending transfer runbook. Do not ask customers to retry pending references.</p>`,
  };
};

const inspectAgedPendingTransfers = async ({
  now = new Date(),
  ageMs = positiveInteger(process.env.SERVICEPAY_PENDING_TRANSFER_ALERT_AGE_MS, DEFAULT_AGE_MS),
  sampleLimit = positiveInteger(process.env.SERVICEPAY_PENDING_TRANSFER_ALERT_SAMPLE_LIMIT, DEFAULT_SAMPLE_LIMIT),
} = {}) => {
  const cutoff = new Date(now.getTime() - ageMs);
  const filter = {
    status: "PENDING",
    createdAt: { $lte: cutoff },
    leaseExpiresAt: { $lte: now },
  };
  const [agedPendingCount, attempts, classificationCounts] = await Promise.all([
    ServicePayTransferAttempt.countDocuments(filter),
    ServicePayTransferAttempt.find(filter)
      .select("_id reference createdAt leaseExpiresAt")
      .sort({ createdAt: 1 })
      .limit(sampleLimit)
      .lean(),
    ServicePayTransferAttempt.aggregate([
      { $match: filter },
      {
        $lookup: {
          from: Transfer.collection.name,
          let: { attemptReference: "$reference" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$reference", "$$attemptReference"] },
                    { $eq: ["$status", "SUCCESSFUL"] },
                  ],
                },
              },
            },
            { $project: { _id: 1 } },
          ],
          as: "committedTransfers",
        },
      },
      {
        $project: {
          classification: {
            $cond: [
              { $gt: [{ $size: "$committedTransfers" }, 0] },
              "COMMITTED_RESPONSE_LOST",
              "EXPIRED_FAILED_RESERVATION",
            ],
          },
        },
      },
      { $group: { _id: "$classification", count: { $sum: 1 } } },
    ]),
  ]);
  const references = attempts.map(({ reference }) => reference);
  const transfers = references.length
    ? await Transfer.find({
      reference: { $in: references },
      status: "SUCCESSFUL",
    }).select("_id reference").lean()
    : [];
  const transfersByReference = new Map(
    transfers.map((transfer) => [String(transfer.reference), transfer])
  );
  const records = attempts.map((attempt) =>
    publicRecord(attempt, transfersByReference.get(String(attempt.reference)))
  );
  const counts = new Map(
    classificationCounts.map(({ _id, count }) => [String(_id), Number(count)])
  );

  return {
    event: "servicepay_aged_pending_transfer_attempts",
    observedAt: now.toISOString(),
    cutoff: cutoff.toISOString(),
    agedPendingCount,
    expiredFailedReservationCount: counts.get("EXPIRED_FAILED_RESERVATION") || 0,
    committedResponseLostCount: counts.get("COMMITTED_RESPONSE_LOST") || 0,
    sampledCount: records.length,
    sampleTruncated: agedPendingCount > records.length,
    records,
  };
};

const runServicePayTransferMonitor = async (options = {}) => {
  const alert = await inspectAgedPendingTransfers(options);
  if (alert.agedPendingCount === 0) return alert;

  console.warn("servicepay_operations_alert", alert);
  const recipient = String(process.env.SERVICEPAY_PRODUCTION_ADMIN_EMAIL || "").trim();
  if (recipient) {
    const email = buildEmail(alert);
    const intervalMs = positiveInteger(
      process.env.SERVICEPAY_PENDING_TRANSFER_MONITOR_INTERVAL_MS,
      DEFAULT_INTERVAL_MS
    );
    await sendEmail({
      to: recipient,
      ...email,
      idempotencyKey: `pending-transfer-alert/${Math.floor(
        (options.now?.getTime?.() || Date.now()) / intervalMs
      )}`,
    });
  }
  return alert;
};

const startServicePayTransferMonitor = () => {
  if (monitorTimer) return monitorTimer;
  const intervalMs = positiveInteger(
    process.env.SERVICEPAY_PENDING_TRANSFER_MONITOR_INTERVAL_MS,
    DEFAULT_INTERVAL_MS
  );
  const run = async () => {
    if (monitorRunning) return;
    monitorRunning = true;
    try {
      await runServicePayTransferMonitor();
    } catch (error) {
      console.error("servicepay_transfer_monitor_error", {
        event: "monitor_failed",
        message: error?.message || "Unknown monitor failure",
      });
    } finally {
      monitorRunning = false;
    }
  };
  run();
  monitorTimer = setInterval(run, intervalMs);
  monitorTimer.unref?.();
  return monitorTimer;
};

module.exports = {
  inspectAgedPendingTransfers,
  runServicePayTransferMonitor,
  startServicePayTransferMonitor,
};