"use strict";
// Read the existing customer Feature Control registry. Never provision settings,
// change global service controls, call a provider or infer voucher capability.
const AppSettings = require("../models/appSettings.model");
const { FEATURE_REGISTRY, currentRegistry } = require("../controllers/featureControl.controller");
const P = require("./businessNetwork.policy");
const applicable = new Set(["airtime", "data", "electricity", "cableTv", "examPin",
  "ninVerification", "bvnVerification", "delivery", "solar", "empowerment",
  "marketplace", "storePosting", "amana", "flightBooking", "kekeNapep", "transport",
  "phoneFinancing", "edupay", "referral"]);
const overrides = { cableTv: "CABLE", examPin: "EXAM_PIN", ninVerification: "NIN",
  bvnVerification: "BVN", flightBooking: "FLIGHT", kekeNapep: "KEKE_NAPEP",
  storePosting: "STORE_POSTING", phoneFinancing: "PHONE_FINANCING" };
const codeFor = key => overrides[key] || key.toUpperCase();
const codes = FEATURE_REGISTRY.filter(r => applicable.has(r[0])).map(r => codeFor(r[0]));
function preferences(value) {
  if (!Array.isArray(value) || value.length > codes.length || value.some(code => !codes.includes(code)))
    P.fail("Select services from the current business catalogue.");
  return [...new Set(value)];
}
function build(settings, networkSettings) {
  const all = currentRegistry(settings).filter(row => applicable.has(row.key));
  const configured = networkSettings?.premium?.businessServices || {};
  return Object.fromEntries(P.kinds.map(kind => [kind, all.map(row => {
    const code = codeFor(row.key);
    const enabled = row.effectiveEnabled && row.visible && !row.maintenanceMode;
    const allowed = !Array.isArray(configured[kind]) || configured[kind].includes(code);
    // Flight search is not evidence of a live ticketing integration.
    const verifiedService = row.key !== "flightBooking";
    const processable = P.billServices.includes(code) && enabled && allowed && verifiedService;
    return { code, label: row.displayName,
      category: P.billServices.includes(code) ? "Bill payments" :
        ["delivery", "kekeNapep", "transport"].includes(row.key) ? "Logistics and bookings" : "Business products",
      available: Boolean(enabled && verifiedService), processable,
      preferencesEnabled: Boolean(enabled && allowed && verifiedService),
      reason: !verifiedService ? "Live flight ticketing is not verified." :
        !enabled ? row.maintenanceMessage || "Currently disabled in ServicePay." :
        !allowed ? "Disabled for this business type by Head Office." :
        !processable ? "Business interest only; no delegated purchasing or commissions are enabled for this service." : "",
    };
  })]));
}
async function catalogue(networkSettings, session) {
  let q = AppSettings.findOne({}).lean();
  if (session) q = q.session(session);
  return build(await q, networkSettings);
}
async function validate(values, kind, networkSettings, { processing = false, session } = {}) {
  const selected = preferences(values);
  const rows = (await catalogue(networkSettings, session))[P.kind(kind)];
  if (selected.some(code => !rows.some(row => row.code === code && row.preferencesEnabled && (!processing || row.processable))))
    P.fail(processing ? "Only enabled, processable bill services can be approved for business payments." :
      "A selected service is unavailable for this business type. Review the preferred services.");
  return selected;
}
module.exports = { catalogue, build, codes, preferences, validate };
