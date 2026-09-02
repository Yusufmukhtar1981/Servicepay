const money = (value) => Number(Number(value || 0).toFixed(2));

function calculateInterstateQuote(route, input) {
  const weightKg = Number(input.weightKg);
  const declaredValue = Number(input.declaredValue || 0);
  if (!Number.isFinite(weightKg) || weightKg <= 0) throw new Error("Weight must be greater than zero.");
  if (!Number.isFinite(declaredValue) || declaredValue < 0) throw new Error("Declared value must be valid.");
  if (weightKg > Number(route.maximumWeightKg)) throw new Error("Parcel weight exceeds this route's maximum.");
  if (input.serviceType === "EXPRESS" && !route.expressEnabled) throw new Error("Express is not available for this route.");
  const extraWeight = Math.max(0, weightKg - Number(route.minimumWeightKg || 0));
  const transportFee = money(Number(route.baseFare) + extraWeight * Number(route.pricePerAdditionalKg));
  const expressSurcharge = input.serviceType === "EXPRESS" ? money(route.expressSurcharge) : 0;
  const pickupFee = input.pickupMethod === "RIDER_PICKUP" ? money(route.pickupFee) : 0;
  const deliveryFee = input.deliveryMethod === "DOOR_DELIVERY" ? money(route.doorDeliveryFee) : money(route.branchCollectionFee);
  if (!["RIDER_PICKUP", "BRANCH_DROP_OFF"].includes(input.pickupMethod)) throw new Error("Invalid pickup method.");
  if (!["DOOR_DELIVERY", "BRANCH_COLLECTION"].includes(input.deliveryMethod)) throw new Error("Invalid delivery method.");
  if (!["STANDARD", "EXPRESS"].includes(input.serviceType)) throw new Error("Invalid service type.");
  const protectionFee = input.protection && route.protectionEnabled
    ? money(Number(route.protectionFlatFee || 0) + declaredValue * Number(route.protectionPercent || 0) / 100) : 0;
  const total = money(transportFee + expressSurcharge + pickupFee + deliveryFee + protectionFee);
  return { breakdown: { transportFee, expressSurcharge, pickupFee, deliveryFee, protectionFee }, total,
    expectedDelivery: input.serviceType === "EXPRESS" ? route.expressDeliveryTime : route.standardDeliveryTime };
}
module.exports = { calculateInterstateQuote };