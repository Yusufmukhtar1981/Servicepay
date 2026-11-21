const mongoose = require("mongoose");

// Dedicated operational records, never mixed with customer transaction/ledger
// collections. Provisioning is explicit; importing this model performs no DDL.
const schema = new mongoose.Schema({
  kind: { type: String, enum: ["JOB", "ITEM", "LOCK"], required: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  actorName: { type: String, maxlength: 200 },
  requestId: { type: String, maxlength: 36 },
  fingerprint: { type: String, maxlength: 64 },
  reason: { type: String, maxlength: 500 },
  mode: { type: String, enum: ["ALL", "SELECTED"] },
  customerIds: { type: [mongoose.Schema.Types.ObjectId], default: undefined },
  maxCustomerId: mongoose.Schema.Types.ObjectId,
  cursor: mongoose.Schema.Types.ObjectId,
  jobId: { type: mongoose.Schema.Types.ObjectId },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  fullName: { type: String, maxlength: 200 },
  phone: { type: String, maxlength: 30 },
  status: { type: String, required: true,
    enum: ["QUEUED", "RUNNING", "PAUSED", "COMPLETED", "FAILED", "SUCCESS", "PENDING", "SKIPPED", "LOCK"] },
  pauseReason: { type: String, maxlength: 100 },
  total: { type: Number, default: 0, min: 0 },
  processed: { type: Number, default: 0, min: 0 },
  successful: { type: Number, default: 0, min: 0 },
  failed: { type: Number, default: 0, min: 0 },
  pending: { type: Number, default: 0, min: 0 },
  skipped: { type: Number, default: 0, min: 0 },
  leaseToken: String,
  leaseUntil: Date,
  nextRunAt: { type: Date, default: Date.now },
  responseStatus: Number,
}, { timestamps: true, autoCreate: false, autoIndex: false,
  collection: "operationsvirtualaccountjobs" });
schema.index({ kind: 1, status: 1, nextRunAt: 1, createdAt: 1 }, { name: "operations_va_queue" });
schema.index({ jobId: 1, kind: 1, _id: 1 }, { name: "operations_va_results" });

module.exports = mongoose.models.OperationsVirtualAccountJob ||
  mongoose.model("OperationsVirtualAccountJob", schema);
