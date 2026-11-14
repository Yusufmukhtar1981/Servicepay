"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const V = require("../services/businessNetwork.vouchers");
// Synthetic unit-test values only. Never sent to a provider or saved as stock.
const response = () => ({ status: "success", quantity: 2, amount: 190, "request-id": "verified-reference",
  pin: "1234567890123456,2345678901234567", serial: "SYNTHETIC-1,SYNTHETIC-2" });
const expected = { httpStatus: 200, expectedProviderReference: "verified-reference", quantity: 2, maximumCostKobo: 20000 };
test("official Airtime PIN body is separate from airtime top-up and limited to 50 items", () => {
  const body = V.airtimeRequest({ network: 1, denomination: 100, quantity: 2, businessName: "Synthetic local test", reference: "local-test" });
  assert.equal(body["request-id"], "local-test"); assert.equal(body.amount, "100"); assert.equal(body.quantity, 2);
  assert.equal(body.phone, undefined); assert.equal(V.contract.enabled, false);
  assert.throws(() => V.airtimeRequest({ network: 1, denomination: 100, quantity: 51 }));
  assert.equal(V.contract.data.catalogueVerified, false);
});
test("voucher plaintext is encrypted, authenticated and bound to the tenant and purchase", () => {
  const key = crypto.randomBytes(32), scope = { profileId: "local-business-1", reference: "local-purchase-1" }, payload = response();
  const envelope = V.seal(payload, key, scope);
  assert(!JSON.stringify(envelope).includes(payload.pin));
  assert.deepEqual(V.open(envelope, key, scope), payload);
  assert.throws(() => V.open(envelope, key, { ...scope, profileId: "other-business" }));
  assert.throws(() => V.open(envelope, key, { ...scope, reference: "other-purchase" }));
  assert.throws(() => V.seal(payload, Buffer.alloc(4), scope));
});
test("unknown status, ambiguous reference, inconsistent quantities, placeholder serials and overcharges fail closed", () => {
  assert.equal(V.validateIssued(response(), expected).items.length, 2);
  for (const patch of [{ status: "pending" }, { "request-id": "AIRTIMEPIN|unverified" },
    { quantity: 4 }, { serial: "0000000000000000,0000000000000000" },
    { pin: "1234567890123456,1234567890123456" }, { amount: 500 }])
    assert.throws(() => V.validateIssued({ ...response(), ...patch }, expected));
  assert.throws(() => V.validateIssued(response(), { ...expected, httpStatus: 503 }));
  assert.throws(() => V.validateIssued(response(), { ...expected, expectedProviderReference: "" }));
});
test("sold inventory cannot be sold or returned to printable stock a second time", () => {
  assert.equal(V.transition("PURCHASED", "PRINTED"), "PRINTED");
  assert.equal(V.transition("PRINTED", "SOLD"), "SOLD");
  assert.throws(() => V.transition("SOLD", "PRINTED")); assert.throws(() => V.transition("SOLD", "SOLD"));
});
