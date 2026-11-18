"use strict";
const M = require("../models/profitSharing.models");
const Transaction = require("../models/transaction.model");
const { createEngine } = require("./profitSharing.engine");
function createWorker({ engine = createEngine(), admissionModel = M.Admission,
  transactionModel = Transaction } = {}) {
  let cursor = null, running = false;
  async function runBatch() {
    if (running) return { status: "BUSY" };
    running = true;
    try {
      // Read only prerequisite: never create or migrate storage at startup.
      if (!await admissionModel.db.db.listCollections(
        { name: admissionModel.collection.name }, { nameOnly: true }).hasNext()) return { status: "STORAGE_NOT_READY" };
      const rows = await admissionModel.find(cursor ? { _id: { $gt: cursor } } : {})
        .sort({ _id: 1 }).limit(20).select("_id transaction").lean();
      if (!rows.length) { cursor = null; return { status: "IDLE" }; }
      const outcomes = [];
      for (const row of rows) {
        const tx = await transactionModel.findById(row.transaction).select("status").lean();
        try {
          const result = tx?.status === "REFUNDED"
            ? await engine.reverse(row.transaction) : await engine.settle(row.transaction);
          outcomes.push({ transactionId: row._id, ...result });
        } catch (error) {
          // No credentials or provider/customer payloads in worker output.
          await engine.recordBlocked?.(row.transaction, error.code).catch(() => {});
          outcomes.push({ transactionId: row._id, status: "BLOCKED",
            code: typeof error.code === "string" ? error.code : "SETTLEMENT_RETRY_REQUIRED" });
        }
        cursor = row._id;
      }
      return { status: "PROCESSED", outcomes };
    } finally { running = false; }
  }
  return { runBatch };
}
let timer;
function start() {
  if (timer) return;
  // No background workload at all until at least one real service contract has
  // been implemented and reviewed. Synthetic test adapters never register here.
  if (Object.keys(require("./profitSharing.adapters").adapters).length === 0) return;
  const worker = createWorker();
  // No immediate startup write. Unknown/unverified costs remain unallocated;
  // canonical customer settlement is never rolled back for a commission error.
  timer = setInterval(() => worker.runBatch().catch(() => {
    console.error("PROFIT_SHARING_WORKER: reconciliation deferred.");
  }), 60_000);
  timer.unref?.();
}
module.exports = { createWorker, start };
