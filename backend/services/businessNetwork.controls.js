"use strict";
// Capability controls extend the existing NetworkSettings document. They never
// select a provider or grant wallet authority. Unsupported capabilities cannot
// be activated by changing a label in Admin.
const S = require("./businessNetwork.service");
const { M, P } = S;
const states = ["ENABLED", "DISABLED", "COMING_SOON", "MAINTENANCE"];
const definitions = Object.freeze({
  airtime: { label: "Airtime", categories: ["CUSTOMER", "AGENT", "MERCHANT"], ready: true },
  data: { label: "Data", categories: ["CUSTOMER", "AGENT", "MERCHANT"], ready: true },
  reports: { label: "Sales reports and transaction history", ready: true, history: true },
  customerDirectory: { label: "Consented customer sales directory", ready: true },
  expenses: { label: "Business expense records", ready: true },
  promotions: { label: "Promotional offers", ready: true },
  merchantStaff: { label: "Merchant staff management", categories: ["MERCHANT"], ready: true },
  rechargePrinting: { label: "Recharge Card printing", ready: false },
  dataPrinting: { label: "Data Card / Voucher printing", ready: false },
  bluetooth: { label: "Bluetooth thermal printer", ready: false },
  merchantQr: { label: "Merchant payment QR", categories: ["MERCHANT"], ready: false },
  paymentLink: { label: "Merchant payment link", categories: ["MERCHANT"], ready: false },
  directAirtime: { label: "Direct Airtime infrastructure", ready: false },
  directData: { label: "Direct Data infrastructure", ready: false },
  voucherInventory: { label: "Voucher inventory and distribution", ready: false },
});
function matrix(doc) {
  const saved = doc?.premium?.featureAccess || {};
  return Object.entries(definitions).map(([key, definition]) => ({
    key, ...definition,
    categories: Object.fromEntries((definition.categories || ["AGENT", "MERCHANT"]).map(category =>
      [category, saved[category]?.[key] || (definition.ready ? "ENABLED" : "COMING_SOON")])),
    reason: definition.ready ? "" : "Not activated: verified integration, allocation and supported device checks are required.",
  }));
}
function validate(input, previous = {}) {
  if (!input || Array.isArray(input) || typeof input !== "object" ||
      Object.keys(input).some(category => !["CUSTOMER", "AGENT", "MERCHANT"].includes(category)))
    P.fail("Select a supported customer category.");
  const result = structuredClone(previous);
  for (const [category, features] of Object.entries(input)) {
    if (!features || Array.isArray(features) || typeof features !== "object") P.fail("Invalid feature controls.");
    result[category] ||= {};
    for (const [key, state] of Object.entries(features)) {
      const spec = definitions[key];
      if (!spec || !(spec.categories || ["AGENT", "MERCHANT"]).includes(category) || !states.includes(state))
        P.fail("Unsupported feature or state for this category.");
      if (!spec.ready && state === "ENABLED")
        P.fail("This capability is not verified and cannot be enabled.", "NETWORK_FEATURE_NOT_READY", 409);
      // Historical reports remain readable even if new business activity stops.
      if (spec.history && state !== "ENABLED") P.fail("Existing transaction history must remain accessible.");
      result[category][key] = state;
    }
  }
  return result;
}
async function requireFeature(category, key, session, { lock = false } = {}) {
  const spec = definitions[key];
  if (!spec || !(spec.categories || ["AGENT", "MERCHANT"]).includes(category))
    P.fail("This feature does not belong to this business category.", "NETWORK_FORBIDDEN", 403);
  const query = M.Settings.findById("network").session(session || null);
  const doc = await query;
  const state = doc?.premium?.featureAccess?.[category]?.[key] || (spec.ready ? "ENABLED" : "COMING_SOON");
  if (!spec.ready || state !== "ENABLED") P.fail(`${spec.label} is ${state.toLowerCase().replaceAll("_", " ")}.`,
    "NETWORK_FEATURE_UNAVAILABLE", 403);
  if (session && lock && doc)
    await M.Settings.updateOne({ _id: "network", revision: doc.revision }, { $inc: { loyaltyFence: 1 } }, { session, timestamps: false });
  return doc;
}
module.exports = { states, definitions, matrix, validate, requireFeature };
