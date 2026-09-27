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