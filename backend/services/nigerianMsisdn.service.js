"use strict";
// Telecom Abode's authenticated API docs specify domestic 11-digit MSISDNs.
// Do not infer mobile network from prefixes: number porting makes that unsafe.
const normalizeNigerianMsisdn = value => {
  if (typeof value !== "string") return null;
  const input = value.trim();
  if (!/^\+?[\d ()-]+$/.test(input)) return null;
  let digits = input.replace(/[ ()-]/g, "");
  if (digits.startsWith("+234")) digits = digits.slice(1);
  if (/^234[789]\d{9}$/.test(digits)) digits = `0${digits.slice(3)}`;
  return /^0[789]\d{9}$/.test(digits) ? digits : null;
};
module.exports = { normalizeNigerianMsisdn };