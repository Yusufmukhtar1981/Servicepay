"use strict";
// Admission policy only. Never reject or reverse a verified incoming transfer
// merely because it is below a newly configured minimum.
const { M, P } = require("./businessNetwork.service");
const DEFAULT_MERCHANT_MINIMUM_KOBO = 5000000;
function merchantMinimum(doc) {
  const amount = doc?.premium?.merchantMinimumFundingKobo;
  if (amount === undefined) return DEFAULT_MERCHANT_MINIMUM_KOBO;
  if (!Number.isSafeInteger(amount) || amount < 10000 || amount > 100000000000)
    P.fail("Merchant funding configuration needs Head Office review.", "NETWORK_FUNDING_CONFIG_INVALID", 503);
  return amount;
}
async function policy(user) {
  // Approval is looked up server-side; a supplied category cannot downgrade
  // an approved Merchant to the normal Customer minimum.
  const merchant = user?.role === "CUSTOMER" && await M.Profile.exists({
    owner: user._id || user.id, kind: "MERCHANT", status: "APPROVED",
  });
  const minimumKobo = merchant ? merchantMinimum(await M.Settings.findById("network").lean()) : 10000;
  return { category: merchant ? "MERCHANT" : "CUSTOMER", minimumKobo,
    scope: "INDIVIDUAL_FUNDING_REQUEST",
    incomingTransfers: "Verified incoming transfers retain existing settlement and credit protection." };
}
function validateAmount(amount, minimumKobo) {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 ||
      !Number.isSafeInteger(Math.round(amount * 100)) ||
      Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6)
    P.fail("Enter a valid funding amount with at most two decimal places.", "NETWORK_FUNDING_AMOUNT_INVALID");
  if (Math.round(amount * 100) < minimumKobo)
    P.fail(`The minimum wallet funding amount is ₦${(minimumKobo / 100).toLocaleString("en-NG")}.`,
      "NETWORK_FUNDING_BELOW_MINIMUM");
  return Math.round(amount * 100);
}
module.exports = { merchantMinimum, policy, validateAmount };
