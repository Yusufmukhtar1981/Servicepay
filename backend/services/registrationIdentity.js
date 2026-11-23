"use strict";

// Registration stores only masked, unverified identity metadata. Raw identity
// numbers must never be persisted, returned or included in error messages.
function registrationIdentity(body) {
  const nin = String(body.nin || body.ninNumber || body.nin_number || "").trim();
  const bvn = String(body.bvn || "").trim();
  const type = String(body.identityType || (bvn ? "BVN" : "NIN")).toUpperCase();
  const number = type === "BVN" ? bvn : nin;
  if (!["NIN", "BVN"].includes(type) || (nin && bvn) ||
      (type === "BVN" && nin) || (type === "NIN" && bvn) ||
      !/^\d{11}$/.test(number)) {
    const error = new Error("Provide one valid 11-digit BVN or NIN matching the selected identity type.");
    error.statusCode = 400;
    error.code = "INVALID_REGISTRATION_IDENTITY";
    throw error;
  }
  return type === "BVN"
    ? { bvnNumberMasked: `*******${number.slice(-4)}`, bvnVerificationStatus: "PENDING" }
    : { ninNumberMasked: `*******${number.slice(-4)}`, ninVerificationStatus: "PENDING" };
}

module.exports = { registrationIdentity };
