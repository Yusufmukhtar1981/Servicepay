"use strict";
const M = require("../models/profitSharing.models");
const N = require("../models/businessNetwork.models");
const Tx = require("../models/transaction.model");
const { createCompany, ID } = require("./profitSharing.company");
const { createEngine } = require("./profitSharing.engine");
function createWorker({ company = createCompany(), engine = createEngine(),
  eventModel = M.Event, settingsModel = N.Settings, transactionModel = Tx } = {}) {
  let running = false, cursor = null, pendingCursor = null, reversalCursor = null;
  async function runBatch() {
    if (running) return { status: "BUSY" };
    running = true;
    try {
      // No collection creation, migration or immediate startup write.
      const doc = await settingsModel.findById(ID).lean();
      const config = doc?.profitSharing;
      if (!config?.windows?.length) return { status: "DISABLED" };
      const outcomes = [];
      const attempt = async (transactionId, reverse = false) => {
        try { outcomes.push(reverse ? await engine.reverse(transactionId) : await company.settle(transactionId)); }
        catch (error) { outcomes.push({ status: "DEFERRED",
          code: /^[A-Z0-9_]+$/.test(error.code || "") ? error.code : "COMPANY_RETRY_REQUIRED" }); }
      };
      if (config.enabled) {
        const rows = await transactionModel.find({ status: "SUCCESSFUL",
          createdAt: { $gte: new Date(config.windows[0].start) },
          ...(cursor ? { _id: { $gt: cursor } } : {}) })
          .sort({ _id: 1 }).limit(15).select("_id").lean().maxTimeMS(5000);
        for (const row of rows) { await attempt(row._id); cursor = row._id; }
        if (!rows.length) cursor = null;
        // Late-arriving verified evidence is retried fairly, independently of
        // discovery. A missing amount is never replaced by zero or principal.
        const pending = await eventModel.find({ kind: "BLOCKED", "data.scope": "COMPANY",
          ...(pendingCursor ? { _id: { $gt: pendingCursor } } : {}) })
          .sort({ _id: 1 }).limit(5).select("_id transaction").lean().maxTimeMS(5000);
        for (const row of pending) { await attempt(row.transaction); pendingCursor = row._id; }
        if (!pending.length) pendingCursor = null;
      }
      // Refund recovery continues even when new distributions are paused.
      const accruals = await eventModel.find({ kind: "ACCRUAL", "data.plan.scope": "COMPANY",
        ...(reversalCursor ? { _id: { $gt: reversalCursor } } : {}) })
        .sort({ _id: 1 }).limit(5).select("_id transaction").lean().maxTimeMS(5000);
      for (const row of accruals) {
        const tx = await transactionModel.findById(row.transaction).select("status").lean();
        if (tx?.status === "REFUNDED") await attempt(row.transaction, true);
        reversalCursor = row._id;
      }
      if (!accruals.length) reversalCursor = null;
      return { status: "PROCESSED", outcomes };
    } finally { running = false; }
  }
  return { runBatch };
}
module.exports = { createWorker };
