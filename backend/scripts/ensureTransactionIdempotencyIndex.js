const mongoose = require("mongoose");

const INDEX_NAME = "uniq_customer_service_idempotency_key";
const INDEX_KEYS = {
  customerId: 1,
  serviceType: 1,
  idempotencyKey: 1,
};
const PARTIAL_FILTER = {
  idempotencyKey: { $type: "string" },
};
const COLLECTION_NAME = "transactions";

function matchesIndex(index) {
  const keys = index.key || {};
  const keyNames = Object.keys(keys);
  const expectedKeyNames = Object.keys(INDEX_KEYS);
  const filter = index.partialFilterExpression || {};
  const filterKeys = Object.keys(filter);

  return (
    index.name === INDEX_NAME &&
    index.unique === true &&
    keyNames.length === expectedKeyNames.length &&
    expectedKeyNames.every(
      (key, position) => keyNames[position] === key && keys[key] === 1,
    ) &&
    filterKeys.length === 1 &&
    filterKeys[0] === "idempotencyKey" &&
    Object.keys(filter.idempotencyKey || {}).length === 1 &&
    filter.idempotencyKey.$type === "string"
  );
}

async function findNamedIndex(collection) {
  try {
    return (await collection.indexes()).find((index) => index.name === INDEX_NAME);
  } catch (error) {
    // A concurrent startup may be creating the collection/index. Treat only
    // the missing namespace case as "not present"; other catalog errors matter.
    if (error.code === 26 || error.codeName === "NamespaceNotFound") {
      return undefined;
    }
    throw error;
  }
}

async function assertNoDuplicateKeys(collection) {
  const duplicates = await collection
    .aggregate([
      { $match: { idempotencyKey: { $type: "string" } } },
      {
        $group: {
          _id: {
            customerId: "$customerId",
            serviceType: "$serviceType",
            idempotencyKey: "$idempotencyKey",
          },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } },
      { $limit: 1 },
      { $count: "duplicateGroups" },
    ])
    .toArray();

  if (duplicates.length > 0) {
    throw new Error(
      `Cannot create ${INDEX_NAME}: duplicate idempotency key groups exist in transactions`,
    );
  }
}

async function ensureTransactionIdempotencyIndex(db = mongoose.connection.db) {
  if (!db) {
    throw new Error(
      `Cannot create ${INDEX_NAME}: MongoDB database connection is not ready`,
    );
  }

  const collection = db.collection(COLLECTION_NAME);
  const existingIndex = await findNamedIndex(collection);
  if (existingIndex) {
    if (!matchesIndex(existingIndex)) {
      throw new Error(
        `Cannot create ${INDEX_NAME}: an index with that name exists but has conflicting uniqueness, keys, or partial filter`,
      );
    }
    return;
  }

  await assertNoDuplicateKeys(collection);

  try {
    await collection.createIndex(INDEX_KEYS, {
      name: INDEX_NAME,
      unique: true,
      partialFilterExpression: PARTIAL_FILTER,
    });
  } catch (createError) {
    // Another process may have completed the same index build after our
    // catalog read. Accept that race only after validating the catalog entry.
    const concurrentIndex = await findNamedIndex(collection);
    if (concurrentIndex && matchesIndex(concurrentIndex)) {
      return;
    }

    const error = new Error(
      `Cannot create ${INDEX_NAME}: unique partial index creation failed: ${createError.message}`,
    );
    error.cause = createError;
    throw error;
  }

  const createdIndex = await findNamedIndex(collection);
  if (!createdIndex || !matchesIndex(createdIndex)) {
    throw new Error(
      `Cannot create ${INDEX_NAME}: index creation completed but catalog verification failed`,
    );
  }
}

module.exports = ensureTransactionIdempotencyIndex;