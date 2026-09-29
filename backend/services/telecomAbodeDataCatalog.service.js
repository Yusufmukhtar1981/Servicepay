const crypto = require("crypto");
const telecomAbode = require("./telecomAbode.service");
const DataPriceOverride = require("../models/dataPriceOverride.model");

const NETWORK_NAMES = Object.freeze({
  "01": "MTN",
  "02": "Glo",
  "03": "9mobile",
  "04": "Airtel",
});

// Provider IDs identify reviewed variants; they are never ServicePay price keys.
const VARIANT_MAPPINGS = Object.freeze({
  "01|1GB WEEKLY - 7": Object.freeze({ "1:1": "A", "1:121": "B" }),
  "02|1GB HOT - 1": Object.freeze({ "3:103": "A", "3:179": "B" }),
});

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
  const parsed = catalog.map((plan) => {
    const networkCode = normalizeNetwork(plan.network);
    const providerPlanId = Number(plan.id);
    if (!networkCode ||
        !Number.isSafeInteger(providerPlanId) || providerPlanId <= 0 ||
        !Number.isSafeInteger(plan.networkId) || plan.networkId <= 0 ||
        !Number.isFinite(Number(plan.price)) || Number(plan.price) <= 0 ||
        typeof plan.name !== "string" || !plan.name.trim()) {
      throw new Error("Telecom Abode returned an invalid DATA plan mapping.");
    }
    return {
      name: plan.name,
      networkCode,
      network: NETWORK_NAMES[networkCode],
      providerPlanId,
      providerNetworkId: plan.networkId,
      price: Number(plan.price),
    };
  });
  const identityCounts = new Map();
  for (const plan of parsed) {
    const identity = servicepayPlanCode(plan.networkCode, plan.name);
    identityCounts.set(identity, (identityCounts.get(identity) || 0) + 1);
  }
  const mapped = parsed.map((plan) => {
    const identity = servicepayPlanCode(plan.networkCode, plan.name);
    const ambiguousIdentity = identityCounts.get(identity) > 1;
    const normalizedName = String(plan.name).trim().toUpperCase().replace(/\s+/g, " ");
    const variant = ambiguousIdentity
      ? VARIANT_MAPPINGS[`${plan.networkCode}|${normalizedName}`]?.[
        `${plan.providerNetworkId}:${plan.providerPlanId}`
      ]
      : null;
    if (ambiguousIdentity && !variant) {
      throw new Error("Ambiguous DATA plan requires an explicit ServicePay variant mapping.");
    }
    return {
      ...plan,
      code: ambiguousIdentity ? servicepayPlanCode(plan.networkCode, plan.name, variant) : identity,
      ambiguousIdentity,
      variant,
    };
  });
  if (new Set(mapped.map((plan) => plan.code)).size !== mapped.length) {
    throw new Error("Telecom Abode returned duplicate DATA plan mappings.");
  }
  return mapped;
};

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
    planCode: { $in: plans.map((plan) => plan.code) },
    active: true,
  }).lean();
  const prices = new Map(overrides.map((row) => [row.planCode, Number(row.sellingPrice)]));
  return plans.flatMap((plan) => {
    const sellingPrice = prices.get(plan.code);
    return Number.isFinite(sellingPrice) && sellingPrice > 0
      ? [{ ...plan, sellingPrice }]
      : [];
  });
};

module.exports = {
  NETWORK_NAMES,
  normalizeNetwork,
  servicepayPlanCode,
  mapCatalog,
  getCatalog,
  getPricedCatalog,
};