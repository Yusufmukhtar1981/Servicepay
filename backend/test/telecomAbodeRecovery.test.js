const test = require("node:test");
const assert = require("node:assert/strict");
const { mapCatalog, providerPlanCode } = require("../services/telecomAbodeDataCatalog.service");
const { normalizeNigerianMsisdn } = require("../services/nigerianMsisdn.service");
const { buildAirtimePayload } = require("../services/telecomAbodeBillsProvider.service");
const p = (id, extra = {}) => ({ id, network: "MTN", networkId: 1,
  name: "1GB Weekly - 7", price: 370, ...extra });

test("all common Nigerian MSISDN formats normalize to documented domestic format", () => {
  for (const phone of ["08012345678", "2348012345678", "+2348012345678", "+234 801 234 5678"]) {
    assert.equal(normalizeNigerianMsisdn(phone), "08012345678");
    assert.equal(buildAirtimePayload({ network: 1, phone, amount: 50,
      requestId: "READONLY-FIXTURE-1" }).phone, "08012345678");
  }
  for (const phone of ["abc08012345678", "0801234567", "23408012345678",
    "+108012345678", "++2348012345678", "", 8012345678]) {
    assert.equal(normalizeNigerianMsisdn(phone), null);
  }
});
test("provider identity is stable across display-name changes but not provider ID changes", () => {
  const original = mapCatalog([p(1)])[0];
  const renamed = mapCatalog([p(1, { name: "New name" })])[0];
  assert.equal(original.code, renamed.code);
  assert.notEqual(original.code, providerPlanCode("01", 1, 93));
  assert.equal(renamed.pricingCode, renamed.code, "changed description cannot inherit a legacy price");
});
test("malformed entries and conflicting immutable IDs quarantine only affected products", () => {
  const items = [null, {}, p(1), p(93), p(121, { price: 776 }),
    p(77), p(77, { name: "Different product" }), p(999, { price: "no" })];
  const result = mapCatalog(items);
  assert.deepEqual(result.map(p => p.providerPlanId), [1, 93, 121]);
  assert.equal(result[0].pricingCode,
    require("../services/telecomAbodeLegacyPriceBindings.json")["1:1"].pricingCode);
  assert.equal(result[1].pricingCode, result[1].code, "unreviewed duplicate has no inherited price");
  assert.equal(mapCatalog([p(1), p(1)]).length, 1);
});