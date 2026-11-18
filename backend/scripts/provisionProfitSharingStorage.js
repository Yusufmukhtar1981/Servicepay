"use strict";

// Explicit operator operation only. Never import from application startup.
// Uses only the existing MongoDB database; never provisions paid infrastructure.
const namespaces = Object.freeze([
  "profitsharingadmissions",
  "profitsharingevents",
  "profitsharingaccounts",
]);
function stop(code) {
  throw Object.assign(new Error(code), { code });
}
async function inspect(db) {
  const collections = await db.listCollections(
    { name: { $in: [...namespaces] } }, { nameOnly: false },
  ).toArray();
  const result = [];
  for (const name of namespaces) {
    const existing = collections.find(row => row.name === name);
    if (!existing) {
      result.push({ name, exists: false });
      continue;
    }
    if (existing.type !== "collection" || existing.options?.capped) {
      stop("INCOMPATIBLE_COMMISSION_NAMESPACE");
    }
    const indexes = await db.collection(name).indexes();
    const id = indexes.find(index => index.name === "_id_");
    if (!id || Object.keys(id.key).length !== 1 || id.key._id !== 1 ||
        id.unique === false || id.hidden === true || id.expireAfterSeconds !== undefined ||
        id.partialFilterExpression || id.sparse || id.collation) {
      stop("COMMISSION_IDEMPOTENCY_INDEX_NOT_VERIFIED");
    }
    // A legacy ObjectId collection with the same name must not be repurposed.
    const incompatible = await db.collection(name).findOne(
      { _id: { $not: { $type: "string" } } },
      { projection: { _id: 1 }, maxTimeMS: 5000 },
    );
    if (incompatible) stop("INCOMPATIBLE_COMMISSION_RECORDS");
    result.push({ name, exists: true, idempotencyIndexVerified: true });
  }
  return result;
}
async function provision(db, { approved = false } = {}) {
  const before = await inspect(db);
  if (!approved) return { mode: "PLAN_ONLY", namespaces: before, created: [], writes: 0 };
  const created = [];
  try {
    for (const row of before) {
      if (row.exists) continue;
      // No createIndexes, collMod, backfills, inserts, updates, drops or deletes.
      // MongoDB creates the standard unique _id index for a new collection.
      try {
        await db.createCollection(row.name);
        created.push(row.name);
      } catch (error) {
        // A concurrent operator may have created it; validate, never replace it.
        if (error.code !== 48 && error.codeName !== "NamespaceExists") throw error;
      }
    }
    return { mode: "APPLIED", namespaces: await inspect(db), created,
      existingRecordsChanged: 0, existingIndexesChanged: 0 };
  } catch (error) {
    // Preserve any newly created namespaces. A retry resumes without data loss.
    error.createdNamespaces = [...created];
    throw error;
  }
}
module.exports = { namespaces, inspect, provision };
