"use strict";

// Only purchase/charge admission uses this guard. Status reads, callbacks,
// refunds and verified incoming credits must never depend on new price setup.
// DATA and AIRTIME already resolve category prices inside their atomic wallet
// admissions. Other adapters must not silently ignore an explicit business
// context and charge the ordinary Customer price.
const supportedContexts = new Set(["AGENT", "MERCHANT"]);
function requireIntegratedBusinessPricing(service) {
  return (req, res, next) => {
    const supplied = [req.body?.businessKind, req.query?.businessKind]
      .filter(value => value !== undefined && value !== null && value !== "");
    if (!supplied.length) return next();
    if (supplied.some(value => typeof value !== "string" || !supportedContexts.has(value)) ||
        new Set(supplied).size !== 1) {
      return res.status(400).json({ success: false, code: "NETWORK_INVALID_PRICING_CONTEXT",
        message: "Select a valid business pricing category." });
    }
    return res.status(409).json({ success: false, code: "NETWORK_PRICE_NOT_CONFIGURED",
      service, message: "Business pricing is not available for this service. No purchase was initiated." });
  };
}
module.exports = { requireIntegratedBusinessPricing };
