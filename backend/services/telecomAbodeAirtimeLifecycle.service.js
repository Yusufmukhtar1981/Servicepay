const { createTelecomAbodeBillsProvider, buildAirtimePayload } = require("./telecomAbodeBillsProvider.service");
const { createClubkonnectAirtimeLifecycleService } = require("./clubkonnectAirtimeLifecycle.service");
const { getServiceConfig } = require("./providerManagement.service");

const reject = (message, code = "AIRTIME_INVALID_REQUEST", status = 400) =>
  Object.assign(new Error(message), { code, status });
const priceFor = (amount, markupBps = 0) => {
  if (!Number.isInteger(markupBps) || markupBps < 0 || markupBps > 10000)
    throw reject("Airtime pricing is invalid.", "AIRTIME_PRICING_UNAVAILABLE", 503);
  const face = Number(amount);
  if (!Number.isFinite(face) || face < 50 || face > 100000 || !/^\d+(?:\.\d{1,2})?$/.test(String(amount)))
    throw reject("Enter an Airtime amount from ₦50 to ₦100,000 with at most two decimal places.");
  return Math.round(Math.round(face * 100) * (10000 + markupBps) / 10000) / 100;
};
const normalizeProviderNetwork = value => /^\d{1,3}$/.test(String(value))
  ? String(Number(value)) : null;
const createTelecomAbodeAirtimeLifecycle = ({ bills = createTelecomAbodeBillsProvider(),
  readConfig = getServiceConfig, ...options } = {}) => {
  const quote = async ({ network, amount }) => {
    const catalogue = await bills.getAirtimeNetworks();
    const selected = catalogue.find(n => String(n.providerId) === normalizeProviderNetwork(network));
    if (!selected) throw reject("Select a network from the current Airtime catalogue.");
    const config = await readConfig("AIRTIME");
    return { provider: "TELECOM_ABODE", network: selected.providerId,
      networkName: selected.displayName, faceValue: Number(amount),
      customerSellingPrice: priceFor(amount, config.airtimeMarkupBps || 0),
      providerCost: null, markupBps: config.airtimeMarkupBps || 0 };
  };
  const provider = {
    purchase: input => bills.purchaseAirtime(input),
    query: input => bills.query({ ...input, service: "AIRTIME" }),
    isVerifiedEvidence: bills.isVerifiedEvidence,
  };
  const lifecycle = createClubkonnectAirtimeLifecycleService({
    ...options, provider, providerName: "TELECOM_ABODE",
    normalizePurchaseNetwork: normalizeProviderNetwork,
    preparePurchase: async (purchase, input, reference) => {
      const q = await quote({ network: purchase.networkCode, amount: purchase.amount });
      if (input.customerSellingPrice === undefined && q.markupBps !== 0 ||
          input.customerSellingPrice !== undefined && Number(input.customerSellingPrice) !== q.customerSellingPrice)
        throw reject("Airtime pricing changed. Obtain a fresh quote before payment.", "AIRTIME_QUOTE_CHANGED", 409);
      let intent;
      try { intent = buildAirtimePayload({ network: q.network, phone: purchase.phoneNumber,
        amount: purchase.amount, requestId: reference }); }
      catch (_) { throw reject("The Airtime recipient or purchase details are invalid."); }
      return { customerAmount: q.customerSellingPrice, providerIntent: intent, markupBps: q.markupBps };
    },
    verifyAdmission: async (purchase, session) => {
      const config = await readConfig("AIRTIME", session);
      if (config.primaryProvider !== "TELECOM_ABODE" ||
          !config.providerStates?.some(p => p.provider === "TELECOM_ABODE" && p.enabled))
        throw reject("Airtime purchases are paused.", "AIRTIME_PROVIDER_UNAVAILABLE", 503);
      if ((config.airtimeMarkupBps || 0) !== purchase.markupBps)
        throw reject("Airtime pricing changed before admission.", "AIRTIME_QUOTE_CHANGED", 409);
    },
  });
  return { ...lifecycle, quote, getNetworks: bills.getAirtimeNetworks };
};
module.exports = { createTelecomAbodeAirtimeLifecycle, priceFor, normalizeProviderNetwork };