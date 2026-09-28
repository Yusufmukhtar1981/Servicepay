const mongoose = require("mongoose");

const NAME = "customerId_1_idempotencyKey_1";
const KEYS = { customerId: 1, idempotencyKey: 1 };
const PARTIAL = { idempotencyKey: { $type: "string" } };

const matches = (index) =>
  index?.unique === true &&
  Object.keys(index.key || {}).join(",") === "customerId,idempotencyKey" &&
  index.key.customerId === 1 &&
  index.key.idempotencyKey === 1 &&
  Object.keys(index.partialFilterExpression || {}).join(",") === "idempotencyKey" &&
  Object.keys(index.partialFilterExpression.idempotencyKey || {}).join(",") === "$type" &&
  index.partialFilterExpression.idempotencyKey.$type === "string";

async function ensureDeliveryIdempotencyIndex(db = mongoose.connection.db) {
  if (!db) throw new Error("Delivery idempotency storage requires a database connection.");
  const collection = db.collection("deliveries");
  const listIndexes = async () => {
    try {
      return await collection.indexes();
    } catch (err) {
      if (err.code === 26 || err.codeName === "NamespaceNotFound") return [];
      throw err;
    }
  };
  const indexes = await listIndexes();
  const existing = indexes.find((index) =>
    index.name === NAME ||
    (index.key?.customerId === 1 && index.key?.idempotencyKey === 1));
  if (existing) {
    if (!matches(existing)) throw new Error("Delivery idempotency index conflicts with the required unique partial index.");
    return;
  }

  const duplicates = await collection.aggregate([
    { $match: { idempotencyKey: { $type: "string" } } },
    { $group: { _id: { customerId: "$customerId", idempotencyKey: "$idempotencyKey" }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 1 },
  ]).toArray();
  if (duplicates.length) throw new Error("Duplicate delivery request keys prevent safe index creation.");

  try {
    await collection.createIndex(KEYS, {
      name: NAME, unique: true, partialFilterExpression: PARTIAL,
    });
  } catch (err) {
    const concurrent = (await listIndexes()).find((index) => index.name === NAME);
    if (!matches(concurrent)) throw err;
  }
  const created = (await listIndexes()).find((index) => index.name === NAME);
  if (!matches(created)) throw new Error("Delivery idempotency index verification failed.");
}

module.exports = ensureDeliveryIdempotencyIndex;