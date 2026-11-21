#!/usr/bin/env node
// Explicit additive provisioning only. No startup DDL, migrations, backfills,
// financial writes, index replacement, or automatic cleanup/rollback.
const mongoose = require("mongoose");
mongoose.set("autoCreate", false);
mongoose.set("autoIndex", false);
const Job = require("../models/operationsVirtualAccountJob.model");
const { storageReady } = require("../services/operationsVirtualAccountJobs.service");

async function provision({ apply = false } = {}) {
  const db = mongoose.connection.db;
  const name = Job.collection.collectionName;
  const existing = await db.listCollections({ name }, { nameOnly: false }).toArray();
  if (existing.length && existing[0].type !== "collection") throw new Error("Expected a regular dedicated job collection. Nothing changed.");
  const indexes = existing.length ? await db.collection(name).listIndexes().toArray() : [];
  const specs = Job.schema.indexes().map(([key, options]) => ({ key, name: options.name }));
  const missing = specs.filter(spec => !indexes.some(index =>
    JSON.stringify(index.key) === JSON.stringify(spec.key) && !index.unique));
  const count = existing.length ? await db.collection(name).estimatedDocumentCount() : 0;
  if (apply && count && missing.length) {
    throw new Error("The existing job collection is nonempty and lacks prerequisites. Separate review is required; nothing changed.");
  }
  if (apply) {
    if (!existing.length) await db.createCollection(name);
    for (const spec of missing) await db.collection(name).createIndex(spec.key, { name: spec.name });
    if (!await storageReady()) throw new Error("Dedicated job storage did not pass verification.");
  }
  return { applied: apply, collection: name, existed: existing.length > 0, existingJobRecords: count,
    indexes: specs, ready: apply ? true : await storageReady(),
    preserved: "All existing collections, indexes, customer records and financial records" };
}

module.exports = { provision };
if (require.main === module) {
  const apply = process.argv.includes("--apply");
  if (apply && !process.argv.includes("--confirm-collection=operationsvirtualaccountjobs")) {
    process.stderr.write("Explicit approval for operationsvirtualaccountjobs is required.\n");
    process.exitCode = 1;
  } else {
    void (async () => {
      try {
        const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
        if (!uri) throw new Error("Database connection is not configured.");
        await mongoose.connect(uri, { autoCreate: false, autoIndex: false });
        process.stdout.write(JSON.stringify(await provision({ apply }), null, 2) + "\n");
      } catch (_) {
        // Driver errors can contain connection details. Do not print raw errors.
        process.stderr.write("Dedicated job storage provisioning failed; no existing records or indexes were removed. Check authorization, quota and index compatibility.\n");
        process.exitCode = 1;
      } finally { await mongoose.disconnect(); }
    })();
  }
}
