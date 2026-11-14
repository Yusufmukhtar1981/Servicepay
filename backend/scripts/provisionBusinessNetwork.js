"use strict";
// Operator-only additive provisioning. Never imported by application startup.
// No existing financial/customer namespace, index or record is changed.
const mongoose = require("mongoose");
const M = require("../models/businessNetwork.models");
async function provision({ apply = false } = {}) {
  const report = [];
  for (const Model of Object.values(M)) {
    const exists = await mongoose.connection.db.listCollections({ name: Model.collection.name }, { nameOnly: true }).hasNext();
    const existingIndexes = exists ? await Model.collection.indexes() : [];
    for (const [key, spec] of Model.schema.indexes()) {
      const existing = existingIndexes.find(i => JSON.stringify(i.key) === JSON.stringify(key));
      if (existing && (!!existing.unique !== !!spec.unique || existing.partialFilterExpression || existing.sparse || existing.expireAfterSeconds !== undefined))
        throw new Error("NETWORK_INDEX_OPTION_CONFLICT:" + Model.collection.name);
    }
    const absent = Model.schema.indexes().filter(([key]) => !existingIndexes.some(i => JSON.stringify(i.key) === JSON.stringify(key)));
    // A partial earlier run is recoverable only while the NEW network collection
    // is empty. Never retrofit an index onto populated storage without review.
    if (exists && absent.length && await Model.collection.countDocuments({}, { limit: 1 }))
      throw new Error("NETWORK_POPULATED_PREREQUISITE_REVIEW_REQUIRED:" + Model.collection.name);
    report.push({ collection: Model.collection.name, exists, missingIndexes: absent.length });
  }
  if (apply) for (const Model of Object.values(M)) {
    if (!await mongoose.connection.db.listCollections({ name: Model.collection.name }, { nameOnly: true }).hasNext()) await Model.createCollection();
    const existingIndexes = await Model.collection.indexes();
    for (const [key, opts] of Model.schema.indexes()) {
      const existing = existingIndexes.find(i => JSON.stringify(i.key) === JSON.stringify(key));
      if (existing) {
        if (!!existing.unique !== !!opts.unique) throw new Error("NETWORK_INDEX_OPTION_CONFLICT:" + Model.collection.name);
        continue;
      }
      await Model.collection.createIndex(key, opts);
    }
  }
  return report;
}
if (require.main === module) (async () => {
  if (!process.env.MONGODB_URI) throw new Error("Database configuration missing.");
  await mongoose.connect(process.env.MONGODB_URI, { autoCreate: false, autoIndex: false, serverSelectionTimeoutMS: 15000 });
  try { console.log(JSON.stringify({ apply: process.argv.includes("--apply"), namespaces: await provision({ apply: process.argv.includes("--apply") }) })); }
  finally { await mongoose.disconnect(); }
})().catch(() => { console.error("Business Network provisioning stopped; no existing customer or financial data was changed. Inspect namespace readiness before retrying."); process.exitCode = 1; });
module.exports = { provision };
