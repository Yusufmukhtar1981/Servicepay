const models = require("../models/organizations.models");

const sameKey = (left, right) =>
  JSON.stringify(left || {}) === JSON.stringify(right || {});

const hasExactStringPartialFilter = (index, field) => {
  const filter = index.partialFilterExpression;
  if (
    index.unique !== true ||
    !filter ||
    Object.keys(filter).length !== 1 ||
    !filter[field] ||
    Object.keys(filter[field]).length !== 1
  ) {
    return false;
  }
  return filter[field].$type === "string";
};

const ensurePartialUniqueIndex = async (collection, key, field, name) => {
  const indexes = await collection.indexes();
  const matching = indexes.filter((index) => sameKey(index.key, key));
  const compatible = matching.find((index) => hasExactStringPartialFilter(index, field));

  for (const index of matching) {
    if (index.name !== compatible?.name) {
      await collection.dropIndex(index.name);
    }
  }

  if (!compatible) {
    await collection.createIndex(key, {
      name,
      unique: true,
      partialFilterExpression: { [field]: { $type: "string" } },
    });
  }
};

const backfill = async () => {
  await models.OrganizationWallet.updateMany(
    { $or: [{ heldBalance: { $exists: false } }, { totalMoneyIn: { $exists: false } }, { totalWithdrawn: { $exists: false } }, { totalFees: { $exists: false } }] },
    [{
      $set: {
        heldBalance: { $ifNull: ["$heldBalance", 0] },
        totalMoneyIn: { $ifNull: ["$totalMoneyIn", 0] },
        totalWithdrawn: { $ifNull: ["$totalWithdrawn", 0] },
        totalFees: { $ifNull: ["$totalFees", 0] },
      },
    }],
    { updatePipeline: true },
  );
  // Legacy withdrawals are deliberately not assigned fabricated references. Partial
  // indexes permit them to coexist while all new requests remain idempotent.
  const collection = models.OrganizationWithdrawal.collection;
  await ensurePartialUniqueIndex(
    collection,
    { organization: 1, idempotencyKey: 1 },
    "idempotencyKey",
    "organization_1_idempotencyKey_1",
  );
  await ensurePartialUniqueIndex(
    collection,
    { organization: 1, reference: 1 },
    "reference",
    "organization_1_reference_1",
  );
};
module.exports = { backfill };