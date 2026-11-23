"use strict";
const S = require("../services/businessNetwork.service");
const A = require("../services/businessNetwork.controls");
const Pricing = require("../services/businessNetwork.pricing");
const Catalog = require("../services/telecomAbodeDataCatalog.service");
const { wrap } = require("./businessNetwork.controller");
const { M, P } = S;
const out = (res, data) => res.json({ success: true, data });
exports.controls = wrap(async (_req, res) => {
  const doc = await M.Settings.findById("network");
  out(res, { revision: doc?.revision || 0, features: A.matrix(doc), states: A.states,
    provider: "Existing ServicePay provider routing remains authoritative; direct infrastructure is not operational." });
});
exports.saveControls = wrap(async (req, res) => {
  if (Object.keys(req.body).some(key => !["revision", "features", "reason"].includes(key))) P.fail("Unsupported feature configuration.");
  const revision = P.integer(req.body.revision, "configuration revision");
  const reason = P.text(req.body.reason, "change reason", 500, true);
  const result = await S.atomic(async session => {
    let doc = await M.Settings.findById("network").session(session);
    if ((doc?.revision || 0) !== revision) P.fail("Feature configuration changed. Refresh before saving.", "NETWORK_CONFLICT", 409);
    const previous = doc?.premium?.featureAccess || {};
    const next = A.validate(req.body.features, previous);
    doc ||= new M.Settings({ _id: "network" });
    doc.premium = { ...(doc.premium || {}), featureAccess: next };
    doc.revision = revision + 1;
    await doc.save({ session });
    await S.audit(req.user, "FEATURE_ACCESS_CHANGED", null, reason, { previous, next, revision: doc.revision }, session);
    return { revision: doc.revision, features: A.matrix(doc), states: A.states };
  });
  out(res, result);
});
exports.pricing = wrap(async (req, res) => {
  const network = Catalog.normalizeNetwork(req.query.network);
  if (!network) P.fail("Select MTN, Glo, Airtel or 9mobile.");
  const plans = await Catalog.getCatalog(network);
  const overrides = await Pricing.Prices.find({ networkCode: network }).lean();
  const byCode = new Map(overrides.map(row => [row.planCode, row]));
  const search = P.text(req.query.search, "search", 100).toLowerCase();
  const items = plans.filter(plan => !search || `${plan.code} ${plan.name}`.toLowerCase().includes(search)).map(plan => {
    const saved = byCode.get(plan.pricingCode || plan.code);
    return { code: plan.code, pricingCode: plan.pricingCode || plan.code, name: plan.name,
      networkCode: network, provider: "TELECOM_ABODE", providerCost: Number(plan.price),
      costEvidence: "CATALOGUE_QUOTE_NOT_SETTLED", profitVerified: false,
      revision: saved?.pricingVersion || 0, customer: { sellingPrice: saved?.sellingPrice ?? null, enabled: saved?.active === true },
      categories: Object.fromEntries(["AGENT", "MERCHANT"].map(category => {
        const configured = saved?.businessPrices?.[category];
        const price = Pricing.dataPrice(saved, category, Number(plan.price));
        return [category, { configured: !!configured, ...(configured || {}), effectivePrice: price,
          margin: price === null ? null : Math.round((price - Number(plan.price)) * 100) / 100,
          marginIsEstimate: true,
          available: price !== null, inherited: false, requiresConfiguration: !configured }];
      })) };
  });
  out(res, { items, airtime: { configurable: true,
    reason: "Independent nonnegative Airtime markups are configured in Airtime Pricing. Sub-face-value discounts remain unavailable without a verified provider cost contract." },
    customerPricing: "Existing Admin Data Pricing remains the Customer price authority. No prices change automatically." });
});
exports.savePricing = wrap(async (req, res) => {
  if (Object.keys(req.body).some(key => !["network", "changes", "reason"].includes(key))) P.fail("Unsupported pricing field.");
  const network = Catalog.normalizeNetwork(req.body.network);
  if (!network) P.fail("Select a supported network.");
  const reason = P.text(req.body.reason, "price change reason", 500, true);
  const changes = req.body.changes;
  if (!Array.isArray(changes) || !changes.length || changes.length > 50) P.fail("Submit between 1 and 50 explicit plan changes.");
  const plans = new Map((await Catalog.getCatalog(network)).map(plan => [plan.code, plan]));
  const seen = new Set();
  for (const change of changes) {
    if (!change || Object.keys(change).some(key => !["code", "category", "revision", "rule"].includes(key))) P.fail("Unsupported plan change.");
    const plan = plans.get(change.code);
    if (!plan || plan.ambiguousIdentity) P.fail("Refresh the authoritative plan catalogue before saving.");
    const category = P.kind(change.category), key = `${plan.pricingCode || plan.code}:${category}`;
    if (seen.has(key)) P.fail("A bulk update must not repeat a plan/category.");
    seen.add(key); P.integer(change.revision, "price revision"); Pricing.validateDataRule(change.rule, Number(plan.price));
  }
  const result = await S.atomic(async session => {
    // Group all categories of a plan into one compare-and-swap. No partial bulk
    // save, no new plan identity or default price, and no new index is needed.
    const groups = new Map();
    for (const change of changes) {
      const plan = plans.get(change.code), key = plan.pricingCode || plan.code;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ ...change, plan });
    }
    for (const [planCode, rows] of groups) {
      const before = await Pricing.Prices.findOne({ networkCode: network, planCode }).session(session).lean();
      if (!before || before.active !== true || !(before.sellingPrice > 0)) P.fail("Configure the existing Customer plan first.", "NETWORK_CONFLICT", 409);
      if (rows.some(row => row.revision !== (before.pricingVersion || 0))) P.fail("Pricing changed. Refresh before saving.", "NETWORK_CONFLICT", 409);
      const businessPrices = { ...(before.businessPrices || {}) };
      for (const row of rows) businessPrices[row.category] = {
        ...Pricing.validateDataRule(row.rule, Number(row.plan.price)), updatedBy: req.user._id, updatedAt: new Date(),
      };
      const saved = await Pricing.Prices.findOneAndUpdate({ _id: before._id, pricingVersion: before.pricingVersion,
        sellingPrice: before.sellingPrice, active: true }, { $set: { businessPrices }, $inc: { pricingVersion: 1 } },
      { new: true, session, runValidators: true });
      if (!saved) P.fail("Pricing changed. Refresh before saving.", "NETWORK_CONFLICT", 409);
      await S.audit(req.user, "BUSINESS_DATA_PRICE_CHANGED", null, reason, { network, planCode,
        previous: before.businessPrices || {}, next: businessPrices, revision: saved.pricingVersion }, session);
    }
    return { updated: changes.length };
  });
  out(res, result);
});
exports.history = wrap(async (_req, res) => out(res, { items: await M.Audit.find({
  action: { $in: ["BUSINESS_DATA_PRICE_CHANGED", "BUSINESS_AIRTIME_PRICE_CHANGED", "FEATURE_ACCESS_CHANGED"] },
}).sort({ createdAt: -1, _id: -1 }).limit(100).lean() }));
exports.airtimePricing = wrap(async (_req, res) => {
  const networks = await require("../services/telecomAbodeBillsProvider.service").createTelecomAbodeBillsProvider().getAirtimeNetworks();
  const doc = await M.Settings.findById("network");
  const config = await require("../services/providerManagement.service").getServiceConfig("AIRTIME");
  out(res, { revision: doc?.revision || 0, provider: "TELECOM_ABODE",
    providerCost: null, margin: null, customerMarkupBps: config.airtimeMarkupBps || 0,
    costWarning: "Provider cost is confirmed only from an authenticated invoice. Until a provider cost ceiling is verified, category markups cannot undercut the existing Customer markup.",
    items: networks.map(network => ({ network: String(network.providerId), name: network.displayName,
      categories: Object.fromEntries(["AGENT", "MERCHANT"].map(category => {
        const rule = doc?.premium?.airtimePricing?.[String(network.providerId)]?.[category];
        return [category, { ...(rule || {}), configured: !!rule, inherited: false,
          requiresConfiguration: !rule, enabled: rule?.enabled === true,
          markupBps: rule?.markupBps ?? null }];
      })) })) });
});
exports.saveAirtimePricing = wrap(async (req, res) => {
  if (Object.keys(req.body).some(key => !["revision", "changes", "reason"].includes(key))) P.fail("Unsupported Airtime pricing field.");
  const revision = P.integer(req.body.revision, "settings revision");
  const reason = P.text(req.body.reason, "price change reason", 500, true);
  const networks = await require("../services/telecomAbodeBillsProvider.service").createTelecomAbodeBillsProvider().getAirtimeNetworks();
  const config = await require("../services/providerManagement.service").getServiceConfig("AIRTIME");
  const changes = req.body.changes;
  if (!Array.isArray(changes) || !changes.length || changes.length > 50) P.fail("Submit between 1 and 50 explicit network/category rules.");
  const seen = new Set();
  for (const change of changes) {
    if (!change || Object.keys(change).some(key => !["network", "category", "enabled", "markupBps"].includes(key)) ||
        typeof change.enabled !== "boolean" || typeof change.network !== "string" ||
        !networks.some(network => String(network.providerId) === change.network)) P.fail("Select a current provider network.");
    const key = change.network + ":" + P.kind(change.category);
    if (seen.has(key)) P.fail("Do not repeat a network/category rule.");
    seen.add(key); P.integer(change.markupBps, "markup basis points above face value", 0, 10000);
    if (change.enabled && change.markupBps < (config.airtimeMarkupBps || 0))
      P.fail("Airtime discounts require a verified provider cost ceiling; do not undercut the current Customer markup.");
  }
  const result = await S.atomic(async session => {
    let doc = await M.Settings.findById("network").session(session);
    if ((doc?.revision || 0) !== revision) P.fail("Pricing changed. Refresh before saving.", "NETWORK_CONFLICT", 409);
    const previous = doc?.premium?.airtimePricing || {}, next = structuredClone(previous);
    for (const row of changes) {
      next[row.network] ||= {};
      next[row.network][row.category] = { enabled: row.enabled, markupBps: row.markupBps, updatedBy: req.user._id, updatedAt: new Date() };
    }
    doc ||= new M.Settings({ _id: "network" });
    doc.premium = { ...(doc.premium || {}), airtimePricing: next };
    doc.revision = revision + 1; await doc.save({ session });
    await S.audit(req.user, "BUSINESS_AIRTIME_PRICE_CHANGED", null, reason, { previous, next, revision: doc.revision }, session);
    return { revision: doc.revision, updated: changes.length };
  });
  out(res, result);
});
