"use strict";
// The DATA override collection remains the sole selling-price authority.
// Business prices are opt-in; no bootstrap rewrites regular Customer prices.
const S = require("./businessNetwork.service");
const { M, P, User } = S;
const Prices = require("../models/dataPriceOverride.model");
const Controls = require("./businessNetwork.controls");
async function category(user, kind, session, { lock = false } = {}) {
  if (kind === undefined || kind === null || kind === "") return { category: "CUSTOMER", profile: null };
  const selected = P.kind(kind);
  if (user?.role !== "CUSTOMER") P.fail("Business prices require your own Customer account.", "NETWORK_FORBIDDEN", 403);
  const { profile } = await S.profileFor(user, selected, { session });
  if (String(profile.owner) !== String(user._id)) P.fail("Business pricing cannot delegate wallet ownership.", "NETWORK_FORBIDDEN", 403);
  if (lock) {
    const active = await M.Profile.findOneAndUpdate({ _id: profile._id, status: "APPROVED", revision: profile.revision },
      { $inc: { admissionFence: 1 } }, { session, new: true, timestamps: false });
    if (!active) P.fail("Business access changed. Refresh before purchase.", "NETWORK_CONFLICT", 409);
    // The ordinary wallet admission also writes this same User document, so a
    // concurrent account/KYC restriction conflicts rather than granting access.
    if (!await User.exists({ _id: user._id, status: "ACTIVE", role: "CUSTOMER", kycVerified: true }).session(session || null))
      P.fail("Active Customer access and verified KYC are required.", "NETWORK_FORBIDDEN", 403);
  }
  return { category: selected, profile };
}
function dataPrice(row, categoryName, currentCost) {
  if (!row || row.active !== true || !Number.isFinite(Number(row.sellingPrice)) || Number(row.sellingPrice) <= 0) return null;
  if (categoryName === "CUSTOMER") return Number(row.sellingPrice);
  const configured = row.businessPrices?.[categoryName];
  // Absent rules preserve the existing Customer price. Explicit disable blocks
  // only this category, not Customer, partner API clients or other categories.
  if (!configured) return Number(row.sellingPrice);
  if (!configured.enabled) return null;
  const price = Number(configured.sellingPrice), cost = Number(currentCost);
  if (!Number.isFinite(cost) || cost < 0 || !Number.isFinite(price) || price <= 0 ||
      price < cost || cost > configured.maximumProviderCost) return null;
  return price;
}
function validateDataRule(rule, cost) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule) ||
      Object.keys(rule).some(key => !["enabled", "sellingPrice", "maximumProviderCost"].includes(key)) ||
      typeof rule.enabled !== "boolean") P.fail("Invalid category pricing rule.");
  const money = (value, name) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 ||
        !Number.isSafeInteger(Math.round(value * 100)) || Math.abs(value * 100 - Math.round(value * 100)) > 1e-6)
      P.fail(`Invalid ${name}; use at most two decimal places.`);
    return value;
  };
  const price = money(rule.sellingPrice, "selling price"), ceiling = money(rule.maximumProviderCost, "provider cost ceiling");
  if (price <= 0 || ceiling < cost || price < ceiling) P.fail("Price must cover the approved provider cost ceiling.");
  return { enabled: rule.enabled, sellingPrice: price, maximumProviderCost: ceiling };
}
async function context(user, kind, feature, session, options) {
  const resolved = await category(user, kind, session, options);
  await Controls.requireFeature(resolved.category, feature, session, options);
  return resolved;
}
function airtimePrice(doc, categoryName, network, amount, defaultMarkupBps) {
  const rule = categoryName === "CUSTOMER" ? null : doc?.premium?.airtimePricing?.[String(network)]?.[categoryName];
  if (rule && !rule.enabled) P.fail("Airtime is disabled for this business category.", "NETWORK_FEATURE_UNAVAILABLE", 403);
  const markupBps = rule ? rule.markupBps : defaultMarkupBps;
  P.integer(markupBps, "Airtime markup", 0, 10000);
  // No verified pre-purchase cost/discount contract exists. Never sell below
  // face value or advertise a fictitious provider margin. Category markups can
  // differ independently, but cannot undercut the already-authorized Customer
  // price until a verified provider cost ceiling is available.
  if (rule && markupBps < defaultMarkupBps)
    P.fail("Airtime discounts require a verified provider cost ceiling. Refresh business pricing.", "NETWORK_PRICE_COST_UNVERIFIED", 409);
  return { markupBps, price: Math.round(Math.round(Number(amount) * 100) * (10000 + markupBps) / 10000) / 100,
    configured: !!rule, providerCost: null, margin: null };
}
module.exports = { category, context, dataPrice, validateDataRule, airtimePrice, Prices, Settings: M.Settings };
