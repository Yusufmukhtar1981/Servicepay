const Shipment = require("../models/interstateShipment.model");

const KEY = { paymentIdempotencyKey: 1 };
const FILTER = { paymentIdempotencyKey: { $type: "string" } };
const NAME = "paymentIdempotencyKey_1_string_unique";

const isPaymentKeyIndex = (index) =>
  Object.keys(index.key).length === 1 && index.key.paymentIdempotencyKey === 1;

const isSafeIndex = (index) =>
  isPaymentKeyIndex(index) &&
  index.unique === true &&
  JSON.stringify(index.partialFilterExpression) === JSON.stringify(FILTER);

const ensurePaymentKeyIndex = async (collection) => {
  const indexes = await collection.indexes();
  const paymentIndexes = indexes.filter(isPaymentKeyIndex);
  let safe = paymentIndexes.find(isSafeIndex);

  if (!safe) {
    // Do not discard an existing uniqueness guarantee until its replacement
    // has been built. A duplicate or an unsupported parallel index must fail
    // startup; repairing payment keys automatically would alter retry semantics.
    const duplicate = await collection.aggregate([
      { $match: FILTER },
      { $group: { _id: "$paymentIdempotencyKey", count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 1 },
    ]).next();
    if (duplicate) {
      throw new Error("Duplicate Interstate payment keys prevent safe index migration.");
    }
    await collection.createIndex(KEY, {
      name: NAME,
      unique: true,
      partialFilterExpression: FILTER,
    });
    safe = (await collection.indexes()).find(isSafeIndex);
  }

  if (!safe) throw new Error("Interstate payment-key uniqueness could not be verified.");

  for (const index of (await collection.indexes()).filter(isPaymentKeyIndex)) {
    if (index.name !== safe.name) await collection.dropIndex(index.name);
  }
};

const migrate = async () => {
  const collection = Shipment.collection;
  const exists = await Shipment.db.db
    .listCollections({ name: collection.collectionName }, { nameOnly: true })
    .hasNext();
  // Even a first-use deployment must not serve payments before uniqueness
  // exists. If collection/index creation fails, startup fails closed.
  if (!exists) await Shipment.createCollection();
  await ensurePaymentKeyIndex(collection);
};

module.exports = { migrate, ensurePaymentKeyIndex };