const test = require("node:test");
const assert = require("node:assert/strict");

process.env.JWT_SECRET = "mock-data-plan-quote-test-key";
const { issueDataPlanQuote, verifyDataPlanQuote } = require("../services/dataPlanQuote.service");

const plan = {
  code: "77",
  networkId: 1,
  name: "1GB SME - 30 days",
  datasize: "1GB",
  type: "SME",
  day: "30 days",
};
const selection = {
  customerId: "customer-1",
  provider: "TELECOM_ABODE",
  network: "01",
  plan,
  price: 150,
};

test("quote binds provider, network ID, full product identity, price, customer and expiry", () => {
  const now = Date.now();
  const quote = issueDataPlanQuote({ ...selection, now });
  assert.equal(verifyDataPlanQuote(quote, { ...selection, now }), true);
  for (const altered of [
    { provider: "CLUBKONNECT" },
    { network: "02" },
    { customerId: "customer-2" },
    { price: 151 },
    { plan: { ...plan, code: "78" } },
    { plan: { ...plan, networkId: 2 } },
    { plan: { ...plan, datasize: "2GB" } },
    { plan: { ...plan, type: "DIRECT" } },
    { plan: { ...plan, day: "7 days" } },
    { plan: { ...plan, name: "2GB SME - 30 days" } },
  ]) {
    assert.equal(verifyDataPlanQuote(quote, { ...selection, ...altered, now }), false);
  }
  assert.equal(verifyDataPlanQuote(quote, { ...selection, now: now + 15 * 60 * 1000 }), false);
  assert.equal(verifyDataPlanQuote(`${quote}x`, { ...selection, now }), false);
});
test("new quotes contain only public product facts and an opaque routing binding", () => {
  const quote = issueDataPlanQuote(selection);
  const payload = JSON.parse(Buffer.from(quote.split(".")[0], "base64url"));
  assert.equal(payload.version, 2);
  assert.equal(payload.provider, undefined);
  assert.equal(payload.providerPlanId, undefined);
  assert.equal(payload.networkId, undefined);
  assert.equal(payload.planId, plan.code);
  assert.equal(payload.name, plan.name);
  assert.equal(payload.price, selection.price);
  assert.equal(typeof payload.binding, "string");
  assert.doesNotMatch(JSON.stringify(payload), /TELECOM|provider|networkId/i);
});
test("already-issued signed v1 quotes remain valid only for their original bound product and lifetime", () => {
  const crypto = require("crypto"), now = Date.now();
  const legacy = { version: 1, customerId: selection.customerId, provider: selection.provider,
    network: selection.network, planId: plan.code, networkId: plan.networkId, providerPlanId: null,
    name: plan.name, size: plan.datasize, type: plan.type, duration: plan.day,
    price: selection.price, issuedAt: now, expiresAt: now + 15 * 60 * 1000 };
  const body = Buffer.from(JSON.stringify(legacy)).toString("base64url");
  const key = crypto.createHmac("sha256", process.env.JWT_SECRET).update("servicepay:data-plan-quote:v1").digest();
  const quote = body + "." + crypto.createHmac("sha256", key).update(body).digest("base64url");
  assert.equal(verifyDataPlanQuote(quote, { ...selection, now }), true);
  assert.equal(verifyDataPlanQuote(quote, { ...selection, provider: "CLUBKONNECT", now }), false);
  assert.equal(verifyDataPlanQuote(quote, { ...selection, price: 151, now }), false);
  assert.equal(verifyDataPlanQuote(quote, { ...selection, now: now + 15 * 60 * 1000 }), false);
});