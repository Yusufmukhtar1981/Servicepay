const WithdrawalRequest = require("../models/withdrawalRequest.model");
const WithdrawalPayoutClaim = require("../models/withdrawalPayoutClaim.model");

const CACHE_TTL_MS = 5000;
let cachedReadiness = null;
let cachedUntil = 0;
let refreshPromise = null;

const hasUniqueIndex = (indexes, keyPattern, predicate = () => true) =>
  indexes.some((index) =>
    index.unique === true &&
    JSON.stringify(index.key) === JSON.stringify(keyPattern) &&
    predicate(index)
  );

const getIndexes = async (collection) =>
  collection.listIndexes().toArray();

const inspectWithdrawalIndexes = async () => {
  const checkedAt = new Date();
  try {
    const [requestIndexes, payoutClaimIndexes] = await Promise.all([
      getIndexes(WithdrawalRequest.collection),
      getIndexes(WithdrawalPayoutClaim.collection),
    ]);

    const idempotencyIndex = hasUniqueIndex(
      requestIndexes,
      { user: 1, idempotencyKey: 1 },
      (index) =>
        JSON.stringify(index.partialFilterExpression) ===
        JSON.stringify({ idempotencyKey: { $type: "string" } })
    );
    const payoutReferenceIndex = hasUniqueIndex(
      payoutClaimIndexes,
      { payoutReference: 1 },
      (index) =>
        !index.partialFilterExpression &&
        index.sparse !== true
    );
    const withdrawalClaimIndex = hasUniqueIndex(
      payoutClaimIndexes,
      { withdrawalId: 1 },
      (index) =>
        !index.partialFilterExpression &&
        index.sparse !== true
    );

    return {
      ready: idempotencyIndex && payoutReferenceIndex && withdrawalClaimIndex,
      checkedAt,
      indexes: {
        withdrawalUserIdempotencyUnique: idempotencyIndex,
        payoutReferenceUnique: payoutReferenceIndex,
        withdrawalPayoutClaimUnique: withdrawalClaimIndex,
      },
    };
  } catch (_) {
    return {
      ready: false,
      checkedAt,
      indexes: {
        withdrawalUserIdempotencyUnique: false,
        payoutReferenceUnique: false,
        withdrawalPayoutClaimUnique: false,
      },
      error: "Unable to verify required withdrawal indexes.",
    };
  }
};

const getWithdrawalIndexReadiness = async ({ forceRefresh = false } = {}) => {
  if (!forceRefresh && cachedReadiness && Date.now() < cachedUntil) {
    return cachedReadiness;
  }
  if (refreshPromise) return refreshPromise;

  refreshPromise = inspectWithdrawalIndexes();
  try {
    cachedReadiness = await refreshPromise;
    cachedUntil = Date.now() + CACHE_TTL_MS;
    return cachedReadiness;
  } finally {
    refreshPromise = null;
  }
};

const clearWithdrawalIndexReadinessCache = () => {
  cachedReadiness = null;
  cachedUntil = 0;
};

module.exports = {
  getWithdrawalIndexReadiness,
  clearWithdrawalIndexReadinessCache,
};