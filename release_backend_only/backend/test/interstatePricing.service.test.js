const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateInterstateQuote } = require("../services/interstatePricing.service");

const route = { baseFare: 2000, minimumWeightKg: 1, maximumWeightKg: 10, pricePerAdditionalKg: 500, expressEnabled: true, expressSurcharge: 750, pickupFee: 300, doorDeliveryFee: 600, branchCollectionFee: 100, protectionEnabled: true, protectionPercent: 2, protectionFlatFee: 50, standardDeliveryTime: "2–4 business days", expressDeliveryTime: "1–2 business days" };
test("interstate quote is route-authoritative with full breakdown", () => {
  const quote = calculateInterstateQuote(route, { weightKg: 3, declaredValue: 10000, serviceType: "EXPRESS", pickupMethod: "RIDER_PICKUP", deliveryMethod: "DOOR_DELIVERY", protection: true });
  assert.deepEqual(quote.breakdown, { transportFee: 3000, expressSurcharge: 750, fragileItemSurcharge: 0, pickupFee: 300, deliveryFee: 600, protectionFee: 250 });
  assert.equal(quote.total, 4900);
  assert.equal(quote.expectedDelivery, "1–2 business days");
});
test("interstate quote applies only the configured fragile-item surcharge", () => {
  const quote = calculateInterstateQuote(
    { ...route, fragileItemSurcharge: 400 },
    { weightKg: 1, declaredValue: 0, serviceType: "STANDARD", pickupMethod: "BRANCH_DROP_OFF", deliveryMethod: "BRANCH_COLLECTION", fragile: true },
  );
  assert.equal(quote.breakdown.fragileItemSurcharge, 400);
  assert.equal(quote.total, 2500);
});
test("interstate quote rejects unavailable service and overweight parcels", () => {
  assert.throws(() => calculateInterstateQuote({ ...route, expressEnabled: false }, { weightKg: 1, declaredValue: 0, serviceType: "EXPRESS", pickupMethod: "BRANCH_DROP_OFF", deliveryMethod: "BRANCH_COLLECTION" }), /Express/);
  assert.throws(() => calculateInterstateQuote(route, { weightKg: 11, declaredValue: 0, serviceType: "STANDARD", pickupMethod: "BRANCH_DROP_OFF", deliveryMethod: "BRANCH_COLLECTION" }), /maximum/);
});