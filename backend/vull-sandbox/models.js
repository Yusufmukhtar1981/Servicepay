const mongoose = require("mongoose");

const ENVIRONMENT = {
  type: String,
  enum: ["SANDBOX"],
  default: "SANDBOX",
  immutable: true,
  required: true,
  index: true,
};
const minor = { type: Number, required: true, min: 0, validate: { validator: Number.isSafeInteger, message: "must be an integer minor-unit amount" } };

function createModels(connection) {
  const schema = fields => {
    const value = new mongoose.Schema({ environment: ENVIRONMENT, ...fields }, { timestamps: true, versionKey: false });
    ["countDocuments", "find", "findOne", "findOneAndUpdate", "updateOne", "updateMany", "deleteOne", "deleteMany"]
      .forEach(operation => value.pre(operation, function scopeSandbox() { this.where({ environment: "SANDBOX" }); }));
    return value;
  };
  const Credential = connection.model("VullSandboxCredential", schema({
    apiKey: { type: String, required: true, unique: true, match: /^vull_sb_[A-Za-z0-9_-]+$/ },
    secretHash: { type: String, required: true, select: false },
    callbackUrl: { type: String, default: "" },
    scopes: { type: [String], default: ["checkout:write", "checkout:read", "refund:write", "subscription:write", "reconciliation:read"] },
    status: { type: String, enum: ["ACTIVE", "REVOKED"], default: "ACTIVE" },
  }));
  const Wallet = connection.model("VullSandboxWallet", schema({
    credentialId: { type: mongoose.Schema.Types.ObjectId, required: true },
    balanceMinor: { ...minor, default: 0 },
  }));
  Wallet.schema.index({ environment: 1, credentialId: 1 }, { unique: true });
  const Transaction = connection.model("VullSandboxTransaction", schema({
    credentialId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    reference: { type: String, required: true },
    amountMinor: minor, currency: { type: String, required: true, enum: ["NGN"] },
    scenario: { type: String, required: true, enum: ["success", "declined", "pending"] },
    status: { type: String, required: true, enum: ["SUCCEEDED", "DECLINED", "PENDING", "BILLED"] },
    kind: { type: String, enum: ["CHECKOUT", "SUBSCRIPTION_RENEWAL"], default: "CHECKOUT" },
    refundable: { type: Boolean, default: false },
  }));
  Transaction.schema.index({ environment: 1, credentialId: 1, reference: 1 }, { unique: true });
  const ledgerSchema = schema({
    walletId: { type: mongoose.Schema.Types.ObjectId, required: true }, transactionId: { type: mongoose.Schema.Types.ObjectId, required: true },
    direction: { type: String, required: true, enum: ["DEBIT", "CREDIT"] }, amountMinor: minor,
    openingBalanceMinor: minor, closingBalanceMinor: minor, reference: { type: String, required: true },
    reversalOf: { type: mongoose.Schema.Types.ObjectId, default: null }, idempotencyKey: { type: String, required: true },
  });
  ledgerSchema.index({ environment: 1, walletId: 1, idempotencyKey: 1 }, { unique: true });
  ["updateOne", "updateMany", "findOneAndUpdate", "deleteOne", "deleteMany", "findOneAndDelete"].forEach(operation =>
    ledgerSchema.pre(operation, () => { throw new Error("Ledger entries are append-only."); }));
  const Ledger = connection.model("VullSandboxLedgerEntry", ledgerSchema);
  const Idempotency = connection.model("VullSandboxIdempotency", schema({
    credentialId: { type: mongoose.Schema.Types.ObjectId, required: true }, key: { type: String, required: true },
    requestHash: { type: String, required: true }, state: { type: String, enum: ["PROCESSING", "COMPLETE"], default: "PROCESSING" },
    statusCode: Number, response: mongoose.Schema.Types.Mixed, outboxEventIds: { type: [String], default: [] },
  }));
  Idempotency.schema.index({ environment: 1, credentialId: 1, key: 1 }, { unique: true });
  const Webhook = connection.model("VullSandboxWebhookEvent", schema({
    eventId: { type: String, required: true }, credentialId: { type: mongoose.Schema.Types.ObjectId, required: true },
    type: { type: String, required: true }, rawBody: { type: Buffer, required: true },
    status: { type: String, enum: ["PENDING", "RETRY", "DELIVERED", "FAILED", "RECEIVED"], default: "PENDING" },
    attempts: { type: Number, default: 0, min: 0 }, nextAttemptAt: { type: Date, default: Date.now },
    lastStatusCode: Number, lastErrorCode: String, deliveredAt: Date,
    leaseToken: { type: String, default: null }, leasedUntil: { type: Date, default: null },
    received: { type: Boolean, default: false },
  }));
  Webhook.schema.index({ environment: 1, eventId: 1 }, { unique: true });
  Webhook.schema.index({ environment: 1, status: 1, nextAttemptAt: 1 });
  const Refund = connection.model("VullSandboxRefund", schema({
    credentialId: { type: mongoose.Schema.Types.ObjectId, required: true }, transactionId: { type: mongoose.Schema.Types.ObjectId, required: true },
    reference: { type: String, required: true }, amountMinor: minor, status: { type: String, enum: ["SUCCEEDED"], default: "SUCCEEDED" },
  }));
  Refund.schema.index({ environment: 1, credentialId: 1, transactionId: 1 }, { unique: true });
  Refund.schema.index({ environment: 1, credentialId: 1, reference: 1 }, { unique: true });
  const Subscription = connection.model("VullSandboxSubscription", schema({
    credentialId: { type: mongoose.Schema.Types.ObjectId, required: true }, reference: { type: String, required: true },
    amountMinor: minor, status: { type: String, enum: ["ACTIVE", "CANCELED"], default: "ACTIVE" }, renewals: { type: Number, default: 0, min: 0 },
  }));
  Subscription.schema.index({ environment: 1, credentialId: 1, reference: 1 }, { unique: true });
  const Reconciliation = connection.model("VullSandboxReconciliation", schema({
    credentialId: { type: mongoose.Schema.Types.ObjectId, required: true }, reference: { type: String, required: true },
    status: { type: String, enum: ["COMPLETE"], default: "COMPLETE" }, report: { type: mongoose.Schema.Types.Mixed, required: true },
  }));
  Reconciliation.schema.index({ environment: 1, credentialId: 1, reference: 1 }, { unique: true });
  return { Credential, Wallet, Transaction, Ledger, Idempotency, Webhook, Refund, Subscription, Reconciliation };
}

async function initializeModels(models) {
  await Promise.all(Object.values(models).map(model => model.init()));
  return models;
}

module.exports = { createModels, initializeModels };