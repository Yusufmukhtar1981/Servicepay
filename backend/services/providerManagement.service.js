const ProviderManagementConfig = require("../models/providerManagementConfig.model");

const SERVICE_PROVIDERS = {
  AIRTIME: ["CLUBKONNECT", "TELECOM_ABODE"],
  DATA: ["CLUBKONNECT", "TELECOM_ABODE"],
  ELECTRICITY: ["NELLOBYTES", "TELECOM_ABODE"],
  CABLE: ["CLUBKONNECT", "TELECOM_ABODE"],
};

const DEFAULTS = {
  AIRTIME: {
    primaryProvider: "CLUBKONNECT",
    fallbackProvider: null,
    providerStates: [
      { provider: "CLUBKONNECT", enabled: true },
      { provider: "TELECOM_ABODE", enabled: false },
    ],
  },
  DATA: {
    primaryProvider: "CLUBKONNECT",
    fallbackProvider: null,
    providerStates: [
      { provider: "CLUBKONNECT", enabled: true },
      { provider: "TELECOM_ABODE", enabled: false },
    ],
  },
  ELECTRICITY: {
    primaryProvider: "NELLOBYTES",
    fallbackProvider: null,
    providerStates: [
      { provider: "NELLOBYTES", enabled: true },
      { provider: "TELECOM_ABODE", enabled: false },
    ],
  },
  CABLE: {
    primaryProvider: null,
    fallbackProvider: null,
    providerStates: [
      { provider: "CLUBKONNECT", enabled: false },
      { provider: "TELECOM_ABODE", enabled: false },
    ],
  },
};

const defaultServiceConfig = (service) => new ProviderManagementConfig({
  _id: service,
  service,
  ...DEFAULTS[service],
});

// Customer request guards and GET requests must never create operational state.
const getServiceConfig = async (service, session = null) => {
  let query = ProviderManagementConfig.findOne({ service });
  if (session) query = query.session(session);
  return (await query) || defaultServiceConfig(service);
};

// First-time configuration is created only by an audited admin mutation,
// within that mutation's transaction.
const getOrCreateServiceConfigForMutation = async (service, session) => {
  const existing = await ProviderManagementConfig.findOne({ service }).session(session);
  if (existing) return existing;
  const config = defaultServiceConfig(service);
  await config.save({ session });
  return config;
};

const hasLegacyElectricityCredentials = () => Boolean(
  process.env.NELLOBYTES_USERID && process.env.NELLOBYTES_APIKEY
);

const hasClubKonnectCredentials = () => Boolean(
  String(process.env.CLUBKONNECT_USER_ID || "").trim() &&
  String(process.env.CLUBKONNECT_API_KEY || "").trim()
);

const telecomAbodeServicesWithAdapter = new Set(["ELECTRICITY", "CABLE", "DATA"]);

const getProviderCapabilities = (service, provider) => {
  const telecomAbode = provider === "TELECOM_ABODE";
  const adapterImplemented = telecomAbode
    ? telecomAbodeServicesWithAdapter.has(service)
    : (provider === "CLUBKONNECT" && ["AIRTIME", "DATA"].includes(service)) ||
      (provider === "NELLOBYTES" && service === "ELECTRICITY");
  const credentialsConfigured = telecomAbode
    ? Boolean(String(process.env.TELECOM_ABODE_API_KEY || "").trim())
    : provider === "CLUBKONNECT"
      ? hasClubKonnectCredentials()
      : provider === "NELLOBYTES"
        ? hasLegacyElectricityCredentials()
        : false;

  // DATA catalogs are fetched from the selected provider before admission;
  // no plan list is served from an unverified local cache.
  const catalogAvailable = telecomAbode && service === "DATA";
  // DATA admission freezes the selected provider and a product-bound quote;
  // the Telecom Abode adapter consumes a durable one-shot dispatch claim.
  const purchaseSupported = (!telecomAbode && adapterImplemented) ||
    (telecomAbode && service === "DATA");
  const routingControlSupported = service === "DATA" && purchaseSupported;
  // TA's base transaction collection has no documented single-reference
  // lookup semantics, and the webhook has no verified sender authentication.
  const querySupported = false;
  const webhookSupported = false;
  const webhookVerified = false;
  const financialSafetyVerified = telecomAbode && service === "DATA";
  const productionReady = telecomAbode && service === "DATA"
    ? adapterImplemented && credentialsConfigured && catalogAvailable &&
      purchaseSupported && financialSafetyVerified
    : adapterImplemented && credentialsConfigured && catalogAvailable &&
      purchaseSupported && querySupported && webhookSupported &&
      webhookVerified && financialSafetyVerified;

  const readinessReasons = [];
  if (!adapterImplemented) {
    readinessReasons.push(`No ${provider} adapter is implemented for ${service}.`);
  }
  if (!credentialsConfigured) {
    readinessReasons.push(`${provider} credentials are not configured.`);
  }
  if (!catalogAvailable) {
    readinessReasons.push("A verified, available service catalog is not established.");
  }
  if (!purchaseSupported) {
    readinessReasons.push(telecomAbode
      ? "Telecom Abode purchases are locked until customer pricing and provider recovery contracts are verified."
      : `No ${provider} purchase route is implemented for ${service}.`);
  }
  if (!querySupported) {
    readinessReasons.push(telecomAbode
      ? "Telecom Abode's authoritative single-transaction query contract is undocumented."
      : "A verified transaction-query capability is not established.");
  }
  if (!webhookSupported) {
    readinessReasons.push(telecomAbode
      ? "Webhook updates are disabled because sender authentication is undocumented."
      : "A verified webhook processing capability is not established.");
  }
  if (!webhookVerified) {
    readinessReasons.push("Webhook sender verification is not established.");
  }
  if (!financialSafetyVerified) {
    readinessReasons.push("Provider-specific financial dispatch and settlement safety is not verified.");
  }

  return {
    adapterImplemented,
    credentialsConfigured,
    catalogAvailable,
    purchaseSupported,
    routingControlSupported,
    querySupported,
    webhookSupported,
    webhookVerified,
    financialSafetyVerified,
    productionReady,
    readinessReasons,
  };
};

const isAvailable = (service, provider) => {
  const capabilities = getProviderCapabilities(service, provider);
  // Availability is an existing route's operational eligibility, not the
  // stronger productionReady assessment for a newly introduced provider.
  return capabilities.adapterImplemented &&
    capabilities.credentialsConfigured &&
    capabilities.purchaseSupported;
};

const unavailableReason = (service, provider) => {
  const capabilities = getProviderCapabilities(service, provider);
  if (provider === "TELECOM_ABODE") {
    return capabilities.readinessReasons.join(" ");
  }
  if (service === "CABLE") {
    return "No cable purchase route or provider adapter is implemented; cable purchases are unavailable.";
  }
  if (service === "ELECTRICITY" && provider === "NELLOBYTES") {
    return hasLegacyElectricityCredentials()
      ? null
      : "NELLOBYTE credentials are not configured.";
  }
  if (["AIRTIME", "DATA"].includes(service) && provider === "CLUBKONNECT") {
    return hasClubKonnectCredentials()
      ? null
      : "ClubKonnect credentials are not configured.";
  }
  if (service === "AIRTIME" || service === "DATA") {
    return "ClubKonnect is the existing purchase route; Telecom Abode is unavailable.";
  }
  return "No cable purchase route or provider adapter is implemented.";
};

const serializeConfig = (config) => {
  const service = config.service;
  const providers = SERVICE_PROVIDERS[service].map((provider) => {
    const state = config.providerStates.find((item) => item.provider === provider);
    const capabilities = getProviderCapabilities(service, provider);
    const available = isAvailable(service, provider);
    return {
      provider,
      enabled: Boolean(state?.enabled),
      available,
      routingControlSupported: capabilities.routingControlSupported,
      productionReady: capabilities.productionReady,
      capabilities,
      readinessReasons: capabilities.readinessReasons,
      reason: available ? null : unavailableReason(service, provider),
    };
  });
  const enabledPrimary = providers.find((item) =>
    item.provider === config.primaryProvider && item.enabled && item.available
  );
  // Airtime remains on its legacy route; DATA consumes this primary selection.
  const currentProvider = service === "AIRTIME"
    ? providers.find((item) => item.provider === "CLUBKONNECT" && item.available)?.provider || null
    : enabledPrimary?.provider || null;
  return {
    service,
    primaryProvider: config.primaryProvider,
    fallbackProvider: config.fallbackProvider,
    fallbackSupported: false,
    routingControlSupported: Boolean(
      providers.find((item) => item.provider === config.primaryProvider)?.routingControlSupported,
    ),
    currentProvider,
    providers,
    updatedAt: config.updatedAt,
    updatedBy: config.updatedBy ? String(config.updatedBy) : null,
  };
};

const readProviderManagementMatrix = async () => {
  const configs = await Promise.all([
    getServiceConfig("AIRTIME"),
    getServiceConfig("DATA"),
    getServiceConfig("ELECTRICITY"),
    getServiceConfig("CABLE"),
  ]);
  return configs.map(serializeConfig);
};

const ensureProviderCanRouteElectricity = async () => {
  const config = await getServiceConfig("ELECTRICITY");
  const primary = config.providerStates.find((item) =>
    item.provider === config.primaryProvider
  );
  if (config.primaryProvider !== "NELLOBYTES" || !primary?.enabled ||
      !isAvailable("ELECTRICITY", "NELLOBYTES")) {
    const error = new Error("Electricity purchases are disabled or no supported provider is available.");
    error.statusCode = 503;
    error.code = "ELECTRICITY_PROVIDER_UNAVAILABLE";
    throw error;
  }
  return "NELLOBYTES";
};

module.exports = {
  DEFAULTS,
  SERVICE_PROVIDERS,
  getServiceConfig,
  getOrCreateServiceConfigForMutation,
  isAvailable,
  getProviderCapabilities,
  readProviderManagementMatrix,
  serializeConfig,
  ensureProviderCanRouteElectricity,
};