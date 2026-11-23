"use strict";
const models = require("../models/expenseManagement.models");
const { fail, canonical } = require("./expenseManagement.rules");
const manifest = Object.values(models).map(model => ({
  collection: model.collection.name,
  indexes: model.schema.indexes().map(([key, options]) => ({
    key, name: options.name, unique: options.unique === true,
    partialFilterExpression: options.partialFilterExpression,
  })),
}));
function matches(actual, required) {
  return JSON.stringify(Object.entries(actual.key || {})) === JSON.stringify(Object.entries(required.key)) &&
    !!actual.unique === required.unique &&
    !actual.hidden && actual.expireAfterSeconds === undefined && !actual.sparse &&
    (!actual.collation || actual.collation.locale === "simple") &&
    JSON.stringify(canonical(actual.partialFilterExpression || {})) ===
      JSON.stringify(canonical(required.partialFilterExpression || {}));
}
async function readiness(db = models.Expense.db.db) {
  if (!db) return { ready: false, missing: ["EXPENSE_DATABASE_UNAVAILABLE"] };
  const names = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map(row => row.name));
  const missing = [];
  for (const spec of manifest) {
    if (!names.has(spec.collection)) {
      missing.push(spec.collection);
      continue;
    }
    const actual = await db.collection(spec.collection).indexes();
    for (const index of spec.indexes) {
      if (!actual.some(row => matches(row, index))) missing.push(`${spec.collection}.${index.name}`);
    }
  }
  return { ready: missing.length === 0, missing };
}
async function requireReady() {
  const result = await readiness();
  if (!result.ready) throw fail(
    "Expense storage requires approved provisioning. Other ServicePay services are unaffected.",
    503, "EXPENSE_STORAGE_NOT_READY",
  );
}
async function provision(db, { apply = false } = {}) {
  // Operator-only, restricted to these four explicitly approved namespaces.
  // Never repair, drop or alter an existing index or nonempty unready collection.
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map(row => row.name));
  const plan = [];
  for (const spec of manifest) {
    const actual = existing.has(spec.collection) ? await db.collection(spec.collection).indexes() : [];
    const missing = spec.indexes.filter(index => !actual.some(row => matches(row, index)));
    if (actual.some(index => missing.some(required => required.name === index.name))) {
      throw fail(`Conflicting expense index in ${spec.collection}. No repair was attempted.`, 409, "EXPENSE_INDEX_CONFLICT");
    }
    if (existing.has(spec.collection) && missing.length &&
        await db.collection(spec.collection).findOne({}, { projection: { _id: 1 }, maxTimeMS: 10000 })) {
      throw fail(`Nonempty unready expense collection ${spec.collection}; explicit investigation required.`, 409, "EXPENSE_STORAGE_CONFLICT");
    }
    plan.push({ collection: spec.collection, create: !existing.has(spec.collection), indexes: missing });
  }
  if (!apply) return { applied: false, plan };
  for (const item of plan) {
    if (item.create) await db.createCollection(item.collection);
    for (const index of item.indexes) {
      const options = { name: index.name };
      if (index.unique) options.unique = true;
      if (index.partialFilterExpression) options.partialFilterExpression = index.partialFilterExpression;
      await db.collection(item.collection).createIndex(index.key, options);
    }
  }
  return { applied: true, plan, ...(await readiness(db)) };
}
module.exports = { manifest, matches, readiness, requireReady, provision };
