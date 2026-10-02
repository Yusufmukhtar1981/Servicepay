const crypto = require("crypto");
const telecomAbode = require("./telecomAbode.service");
const DataPriceOverride = require("../models/dataPriceOverride.model");
const legacyPriceBindings = require("./telecomAbodeLegacyPriceBindings.json");

const NETWORK_NAMES = Object.freeze({
  "01": "MTN",
  "02": "Glo",
  "03": "9mobile",
  "04": "Airtel",
});

// Historical name-based price keys are compatibility-only. Product keys below
// use immutable provider network/plan IDs, never a display name.

const normalizeNetwork = (input) => {
  const value = String(input || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return Object.keys(NETWORK_NAMES).find(
    (code) => code === value || NETWORK_NAMES[code].toUpperCase() === value,
  ) || null;
};

const servicepayPlanCode = (networkCode, name, variant = null) =>
  `DATA-${NETWORK_NAMES[networkCode].toUpperCase()}-${crypto.createHash("sha256")
    .update(JSON.stringify([
      networkCode,
      String(name).trim().toUpperCase().replace(/\s+/g, " "),
      ...(variant ? [variant] : []),
    ]))
    .digest("hex")
    .slice(0, 20)}`;

const mapCatalog = (catalog) => {
  if (!Array.isArray(catalog)) throw new Error("Telecom Abode DATA catalog is unavailable.");
  const parsed = [];
  const byProviderKey = new Map();
  const quarantined = new Set();
  for (const plan of catalog) {
    if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
      console.warn("DATA_CATALOG_ANOMALY", { reason: "MALFORMED_PRODUCT" });
      continue;
    }
    const networkCode = normalizeNetwork(plan.network);
    const providerPlanId = Number(plan.id);
    if (!networkCode ||
        !Number.isSafeInteger(providerPlanId) || providerPlanId <= 0 ||
        !Number.isSafeInteger(plan.networkId) || plan.networkId <= 0 ||
        !Number.isFinite(Number(plan.price)) || Number(plan.price) <= 0 ||
        typeof plan.name !== "string" || !plan.name.trim()) {
      console.warn("DATA_CATALOG_ANOMALY", { reason: "UNSUPPORTED_PRODUCT",
        providerPlanId: Number.isSafeInteger(providerPlanId) ? providerPlanId : undefined });
      continue;
    }
    const normalized = {
      name: plan.name,
      networkCode,
      network: NETWORK_NAMES[networkCode],
      providerPlanId,
      providerNetworkId: plan.networkId,
      price: Number(plan.price),
    };
    const key = `${plan.networkId}:${providerPlanId}`;
    if (quarantined.has(key)) continue;
    const previous = byProviderKey.get(key);
    if (previous) {
      if (JSON.stringify(previous) !== JSON.stringify(normalized)) {
        quarantined.add(key);
        byProviderKey.delete(key);
      }
      console.warn("DATA_CATALOG_ANOMALY", { reason: quarantined.has(key)
        ? "CONFLICTING_PROVIDER_ID" : "REPEATED_PROVIDER_ID", providerPlanId });
      continue;
    }
    byProviderKey.set(key, normalized);
  }
  parsed.push(...byProviderKey.values());
  const identityCounts = new Map();
  for (const plan of parsed) {
    const identity = servicepayPlanCode(plan.networkCode, plan.name);
    identityCounts.set(identity, (identityCounts.get(identity) || 0) + 1);
  }
  const mapped = parsed.map((plan) => {
    const identity = servicepayPlanCode(plan.networkCode, plan.name);
    const ambiguousIdentity = identityCounts.get(identity) > 1;
    const binding = legacyPriceBindings[`${plan.providerNetworkId}:${plan.providerPlanId}`];
    const sameDescription = binding && binding.networkCode === plan.networkCode &&
      binding.name.trim().toUpperCase().replace(/\s+/g, " ") ===
      plan.name.trim().toUpperCase().replace(/\s+/g, " ");
    const code = providerPlanCode(plan.networkCode, plan.providerNetworkId, plan.providerPlanId);
    return {
      ...plan,
      code,
      // A fixed compatibility binding preserves approved prices without
      // migrating records or inheriting prices for a newly-added same-name ID.
      pricingCode: sameDescription ? binding.pricingCode : code,
      ambiguousIdentity,
    };
  });
  return mapped;
};

const providerPlanCode = (networkCode, networkId, planId) =>
  `DATA-${NETWORK_NAMES[networkCode].toUpperCase()}-${crypto.createHash("sha256")
    .update(JSON.stringify(["TELECOM_ABODE", Number(networkId), Number(planId)]))
    .digest("hex").slice(0, 20)}`;

const getCatalog = async (network, provider = telecomAbode) => {
  const networkCode = normalizeNetwork(network);
  if (!networkCode) {
    const error = new Error("Select MTN, Glo, Airtel or 9mobile.");
    error.statusCode = 400;
    throw error;
  }
  return mapCatalog(await provider.getDataPlans()).filter(
    (plan) => plan.networkCode === networkCode,
  );
};

const getPricedCatalog = async (network, provider = telecomAbode) => {
  const plans = await getCatalog(network, provider);
  const networkCode = normalizeNetwork(network);
  const overrides = await DataPriceOverride.find({
    networkCode,
    planCode: { $in: plans.map((plan) => plan.pricingCode) },
    active: true,
  }).lean();
  const prices = new Map(overrides.map((row) => [row.planCode, Number(row.sellingPrice)]));
  return plans.flatMap((plan) => {
    const sellingPrice = prices.get(plan.pricingCode);
    return Number.isFinite(sellingPrice) && sellingPrice > 0
      ? [{ ...plan, sellingPrice }]
      : [];
  });
};

module.exports = {
  NETWORK_NAMES,
  normalizeNetwork,
  servicepayPlanCode,
  providerPlanCode,
  mapCatalog,
  getCatalog,
  getPricedCatalog,
};