"use strict";
// No guessed provider cost/lookup contract. Adding an adapter requires an
// independently verified cost source and reviewed, atomic admission, legacy
// exclusion, success, refund and durable recovery integrations for that service.
// A catalogue price or SUCCESSFUL label alone cannot satisfy that contract.
const adapters = Object.freeze({});
const required = Object.freeze([
  "verifiedSettlement", "verifiedRevenue", "actualProviderCost", "approvedDirectCosts",
  "atomicAdmission", "legacyExclusion", "refundIntegration", "durableRecovery",
]);
function blockers(adapter) {
  if (!adapter || typeof adapter.inspect !== "function" ||
      typeof adapter.version !== "string" || !adapter.version ||
      typeof adapter.contractReference !== "string" || !adapter.contractReference) {
    return ["VERIFIED_SERVICE_ADAPTER_REQUIRED"];
  }
  return required.filter(key => adapter[key] !== true).map(key => `MISSING_${key}`);
}
module.exports = { adapters, blockers };
