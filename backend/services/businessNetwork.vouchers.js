"use strict";
// Offline preparation/validation only. There is deliberately no HTTP client,
// wallet access, PIN persistence, feature activation or provider purchase here.
const crypto = require("node:crypto");
const P = require("./businessNetwork.policy");
const contract = Object.freeze({
  airtime: { documentation: "https://telecomabode.com.ng/documentation/airtimepin-request",
    networks: "/get-pin-networks?service=airtimepin", issue: "/recharge_card" },
  data: { documentation: "https://telecomabode.com.ng/documentation/datapin-request",
    issue: "/data_card", catalogueVerified: false },
  enabled: false,
  prerequisites: ["Authoritative pre-purchase price/availability", "Verified duplicate-request and timeout recovery",
    "Verified request-reference mapping", "Unique provider serials", "Dedicated voucher encryption key",
    "Authorized issue/settlement admission", "Printer/device verification", "Provider redemption authority"],
});
function airtimeRequest({ network, denomination, quantity, businessName, reference }) {
  P.integer(network, "PIN network ID", 1);
  P.integer(denomination, "denomination", 1, 100000);
  P.integer(quantity, "quantity", 1, 50);
  return { network, amount: String(denomination), quantity,
    business_name: P.text(businessName, "business name", 120, true),
    "request-id": P.text(reference, "purchase reference", 100, true) };
}
function keyBuffer(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) P.fail("A dedicated 256-bit voucher encryption key is required.", "NETWORK_VOUCHER_KEY_REQUIRED", 503);
  return key;
}
function seal(payload, key, { profileId, reference }) {
  const aad = `${P.text(profileId, "business scope", 100, true)}:${P.text(reference, "purchase reference", 100, true)}`;
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", keyBuffer(key), iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return { version: 1, iv: iv.toString("base64"), ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}
function open(envelope, key, { profileId, reference }) {
  const aad = `${P.text(profileId, "business scope", 100, true)}:${P.text(reference, "purchase reference", 100, true)}`;
  if (envelope?.version !== 1) P.fail("Unsupported encrypted voucher format.");
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", keyBuffer(key), Buffer.from(envelope.iv, "base64"));
    decipher.setAAD(Buffer.from(aad)); decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8"));
  } catch (_) { P.fail("Voucher decryption denied.", "NETWORK_FORBIDDEN", 403); }
}
function validateIssued(body, { httpStatus, expectedProviderReference, quantity, maximumCostKobo }) {
  // An independently established provider reference is mandatory. Never invent
  // its mapping by stripping or adding AIRTIMEPIN| / Datapin| prefixes.
  P.text(expectedProviderReference, "verified provider reference", 150, true);
  P.integer(quantity, "quantity", 1, 50); P.integer(maximumCostKobo, "authorized maximum cost", 1);
  if (![200, 201].includes(httpStatus) || !["success", "successful", "completed"].includes(String(body?.status || body?.Status).toLowerCase()) ||
      body["request-id"] !== expectedProviderReference) P.fail("Voucher issuance is not definitively verified.", "NETWORK_PROVIDER_UNCERTAIN", 409);
  const split = value => typeof value === "string" ? value.split(",").map(s => s.trim()) : [];
  const pins = split(body.pin), serials = split(body.serial);
  if (Number(body.quantity) !== quantity || pins.length !== quantity || serials.length !== quantity ||
      pins.some(p => !/^\d{10,30}$/.test(p) || /^0+$/.test(p)) ||
      serials.some(s => !/^[A-Za-z0-9-]{6,64}$/.test(s) || /^0+$/.test(s)) ||
      new Set(pins).size !== quantity || new Set(serials).size !== quantity)
    P.fail("Provider voucher inventory is inconsistent; do not retry issuance.", "NETWORK_PROVIDER_UNCERTAIN", 409);
  const costKobo = P.kobo(body.amount);
  if (!costKobo || costKobo > maximumCostKobo) P.fail("Provider invoice differs from the authorized maximum.", "NETWORK_PROVIDER_UNCERTAIN", 409);
  return { costKobo, providerReference: expectedProviderReference,
    items: pins.map((pin, i) => ({ pin, serial: serials[i], status: "PURCHASED" })) };
}
function transition(status, next) {
  if (!({ PURCHASED: ["PRINTED", "SOLD"], PRINTED: ["SOLD"], SOLD: [] }[status] || []).includes(next))
    P.fail("Invalid voucher inventory transition.", "NETWORK_CONFLICT", 409);
  return next;
}
module.exports = { contract, airtimeRequest, seal, open, validateIssued, transition };
