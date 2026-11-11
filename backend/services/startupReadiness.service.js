"use strict";
const mongoose = require("mongoose");

// Versioned prerequisite manifest, NOT an automatic migration runner. Legacy
// repair scripts remain operator-only. No index or customer data is changed.
const manifest = [
  { id: "cards-reference-v1", collection: "cards", key: { requestReference: 1 },
    partial: { requestReference: { $type: "string" } } },
  { id: "transaction-request-v1", collection: "transactions",
    key: { customerId: 1, serviceType: 1, idempotencyKey: 1 },
    partial: { idempotencyKey: { $type: "string" } } },
  { id: "transaction-reference-v1", collection: "transactions", key: { reference: 1 } },
  { id: "ledger-request-v1", collection: "ledgerentries", key: { idempotencyKey: 1 } },
  { id: "delivery-request-v1", collection: "deliveries",
    key: { customerId: 1, idempotencyKey: 1 },
    partial: { idempotencyKey: { $type: "string" } } },
  { id: "membership-number-v1", collection: "organizationmembers",
    key: { organization: 1, membershipNumber: 1 },
    partial: { membershipNumber: { $type: "string", $gt: "" } } },
  { id: "membership-user-v1", collection: "organizationmembers", key: { organization: 1, user: 1 } },
  { id: "shipment-payment-v1", collection: "interstateshipments", key: { paymentIdempotencyKey: 1 },
    partial: { paymentIdempotencyKey: { $type: "string" } } },
  { id: "shipment-tracking-v1", collection: "interstateshipments", key: { trackingNumber: 1 },
    partial: { trackingNumber: { $type: "string", $gt: "" } } },
  { id: "shipment-office-v1", collection: "interstateshipments", key: { officeIdempotencyKey: 1 },
    partial: { officeIdempotencyKey: { $type: "string" } } },
  ...["idempotencyKey", "reference"].map(field => ({
    id: `organization-withdrawal-${field}-v1`, collection: "organizationwithdrawals",
    key: { organization: 1, [field]: 1 }, partial: { [field]: { $type: "string" } },
  })),
  { id: "bank-provider-reference-v1", collection: "banktransfers",
    key: { providerReference: 1 }, sparse: true },
  { id: "organization-wallet-v1", collection: "organizationwallets", key: { organization: 1 } },
  { id: "verification-reference-v1", collection: "idverifications", key: { reference: 1 },
    partial: { reference: { $type: "string", $gt: "" } } },
];
const canonical = value => value && typeof value === "object" && !Array.isArray(value)
  ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
function matches(actual, spec) {
  return JSON.stringify(actual.key) === JSON.stringify(spec.key) &&
    actual.unique === true && !actual.hidden &&
    (!actual.collation || actual.collation.locale === "simple") &&
    actual.expireAfterSeconds === undefined &&
    Boolean(actual.sparse) === Boolean(spec.sparse) &&
    JSON.stringify(canonical(actual.partialFilterExpression || {})) ===
      JSON.stringify(canonical(spec.partial || {}));
}
let configured = false;
const verified = new WeakSet();
function configure() {
  // Must precede every model import, including route/controller dependencies.
  mongoose.set("autoCreate", false);
  mongoose.set("autoIndex", false);
  if (configured) return;
  configured = true;
  mongoose.plugin(schema => {
    schema.set("autoCreate", false);
    schema.set("autoIndex", false);
    schema.pre(["save", "insertMany", "updateOne", "updateMany", "findOneAndUpdate",
      "replaceOne", "findOneAndReplace", "bulkWrite"], async function () {
      const context = typeof this.ownerDocument === "function" ? this.ownerDocument() : this;
      const model = typeof context === "function" && context.schema ? context :
        context.model?.schema ? context.model : context.constructor?.schema ? context.constructor : null;
      if (!model?.db || !verified.has(model.db)) {
        const error = Error("Database startup prerequisites have not been verified.");
        error.code = "STARTUP_NOT_VERIFIED"; throw error;
      }
      // Never implicitly create an unprovisioned namespace on first use.
      const exists = await model.db.db.listCollections(
        { name: model.collection.name }, { nameOnly: true }).hasNext();
      if (!exists) {
        const error = Error("Storage must be provisioned before use.");
        error.code = "STORAGE_NOT_PROVISIONED"; throw error;
      }
    });
  });
}
async function inspect(db) {
  const issues = [];
  const names = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name));
  const indexes = new Map();
  for (const spec of manifest) {
    if (!names.has(spec.collection)) {
      issues.push({ id: spec.id, code: "NAMESPACE_MISSING" }); continue;
    }
    if (!indexes.has(spec.collection)) indexes.set(spec.collection, await db.collection(spec.collection).indexes());
    if (!indexes.get(spec.collection).some(i => matches(i, spec)))
      issues.push({ id: spec.id, code: "UNIQUE_INDEX_NOT_VERIFIED" });
  }
  // Explicit data invariants formerly repaired on every restart.
  for (const [collection, filter, id] of [
    ["organizationmembers", { status: "ACTIVE", $or: [
      { membershipNumber: { $exists: false } }, { membershipNumber: null }, { membershipNumber: "" },
    ] }, "active-membership-backfill-v1"],
    ["interstateshipments", { $or: [
      { trackingNumber: { $exists: false } }, { trackingNumber: null }, { trackingNumber: "" },
    ] }, "shipment-tracking-backfill-v1"],
    ["organizationwallets", { $or: ["heldBalance", "totalMoneyIn", "totalWithdrawn", "totalFees"]
      .map(field => ({ [field]: { $exists: false } })) }, "treasury-summary-backfill-v1"],
  ]) {
    if (!names.has(collection) ||
        await db.collection(collection).findOne(filter, { projection: { _id: 1 }, maxTimeMS: 10000 }))
      issues.push({ id, code: "BACKFILL_REVIEW_REQUIRED" });
  }
  if (names.has("organizationmembers")) {
    const missingCard = await db.collection("organizationmembers").aggregate([
      { $match: { status: "ACTIVE", membershipNumber: { $type: "string", $gt: "" } } },
      { $lookup: { from: "organizationmembershipcards", localField: "_id", foreignField: "member", as: "cards" } },
      { $match: { "cards.0": { $exists: false } } }, { $limit: 1 }, { $project: { _id: 1 } },
    ], { maxTimeMS: 10000 }).next();
    if (missingCard) issues.push({ id: "membership-card-backfill-v1", code: "BACKFILL_REVIEW_REQUIRED" });
  }
  return { ready: issues.length === 0, issues, writes: 0 };
}
async function verify(connection = mongoose.connection) {
  verified.delete(connection);
  const result = await inspect(connection.db);
  if (!result.ready) {
    const error = Error("Startup refused: database prerequisites require an approved operator migration.");
    error.code = "STARTUP_READINESS_BLOCKED"; error.readiness = result; throw error;
  }
  verified.add(connection);
  return result;
}
module.exports = { configure, inspect, verify, matches, manifest };
