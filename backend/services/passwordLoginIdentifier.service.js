"use strict";
const { normalizeNigerianMsisdn } = require("./nigerianMsisdn.service");

// Exact indexed alternatives only: never use suffix matching or select an
// arbitrary account when legacy records represent the same Nigerian number.
function passwordLoginIdentifier(value) {
  if (typeof value !== "string") return null;
  const input = value.trim();
  if (!input || input.length > 254) return null;
  if (input.includes("@")) {
    const email = input.toLowerCase();
    return { filter: { email }, auditIdentifier: email };
  }
  const local = normalizeNigerianMsisdn(input);
  if (!local) return null;
  const international = `234${local.slice(1)}`;
  return {
    filter: { phone: { $in: [local, international, `+${international}`] } },
    auditIdentifier: local,
  };
}

module.exports = { passwordLoginIdentifier };
