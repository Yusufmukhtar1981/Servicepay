"use strict";
const mongoose = require("mongoose");

// One dedicated namespace, discriminated by kind. No customer or ledger data is
// moved here. No namespace/index creation is permitted implicitly on startup.
const KINDS = Object.freeze(["campaign", "task", "report", "budget", "expense",
  "attribution", "content", "social", "strategy", "proposal", "announcement",
  "target", "attendance", "asset", "activity", "partnership", "contribution",
  "performance", "archive", "notification", "rankingPolicy"]);
const schema = new mongoose.Schema({
  kind: { type: String, enum: KINDS, required: true, immutable: true },
  title: { type: String, required: true, maxlength: 180 },
  description: { type: String, default: "", maxlength: 5000 },
  status: { type: String, required: true },
  campaignId: { type: mongoose.Schema.Types.ObjectId, default: null },
  officerId: { type: mongoose.Schema.Types.ObjectId, default: null },
  customerId: { type: mongoose.Schema.Types.ObjectId, default: undefined },
  createdBy: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, required: true },
  revision: { type: Number, default: 0 },
  data: { type: mongoose.Schema.Types.Mixed, default: {} },
  binary: { type: Buffer, select: false },
  requestKey: { type: String, required: true, immutable: true, maxlength: 100 },
}, { timestamps: true, autoCreate: false, autoIndex: false, strict: "throw" });
schema.index({ kind: 1, createdAt: -1 });
schema.index({ kind: 1, campaignId: 1, status: 1 });
schema.index({ kind: 1, officerId: 1, createdAt: -1 });
schema.index({ createdBy: 1, requestKey: 1 }, { unique: true });
schema.index({ customerId: 1 }, {
  unique: true, partialFilterExpression: { kind: "attribution" },
});
schema.index({ "data.transactionId": 1 }, {
  unique: true, partialFilterExpression: { kind: "contribution" },
});
const MarketingRecord = mongoose.model("MarketingRecord", schema, "marketingrecords");
module.exports = { MarketingRecord, KINDS };
