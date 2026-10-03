const { statusLabel } = require("./interstateTracking.service");

const transitions = {
  AWAITING_PICKUP: ["RECEIVED_AT_ORIGIN_HUB"],
  PICKUP_ASSIGNED: ["PICKED_UP"],
  PICKED_UP: ["RECEIVED_AT_ORIGIN_HUB"],
  RECEIVED_AT_ORIGIN_HUB: ["VERIFIED_AT_ORIGIN_HUB"],
  VERIFIED_AT_ORIGIN_HUB: ["READY_FOR_INTERSTATE_DISPATCH"],
  READY_FOR_INTERSTATE_DISPATCH: ["IN_TRANSIT"],
  IN_TRANSIT: ["ARRIVED_AT_DESTINATION_HUB"],
  ARRIVED_AT_DESTINATION_HUB: ["DESTINATION_HUB_VERIFIED"],
  DESTINATION_HUB_VERIFIED: ["READY_FOR_COLLECTION"],
  OUT_FOR_DELIVERY: ["DELIVERY_ATTEMPTED", "FAILED_DELIVERY"],
  DELIVERY_ATTEMPTED: ["OUT_FOR_DELIVERY", "FAILED_DELIVERY"],
  FAILED_DELIVERY: ["RETURN_INITIATED"],
  RETURN_INITIATED: ["RETURN_IN_TRANSIT"],
  RETURN_IN_TRANSIT: ["RETURNED"],
};
const originStatuses = new Set([
  "PICKED_UP", "RECEIVED_AT_ORIGIN_HUB", "VERIFIED_AT_ORIGIN_HUB",
  "READY_FOR_INTERSTATE_DISPATCH", "IN_TRANSIT", "CANCELLED",
]);
function statusOptions(shipment, permitsBranch = () => true) {
  const choices = [...(transitions[shipment.status] || [])];
  // Do not bypass paid cancellation/refund or receiver-OTP settlement paths.
  if (shipment.paymentStatus === "UNPAID" &&
      ["AWAITING_PAYMENT", "AWAITING_PICKUP", "PICKUP_ASSIGNED", "RECEIVED_AT_ORIGIN_HUB"].includes(shipment.status)) {
    choices.push("CANCELLED");
  }
  return choices.filter(status => permitsBranch(
    originStatuses.has(status) ? shipment.originBranchId : shipment.destinationBranchId,
  )).map(status => ({ status, label: statusLabel(status) }));
}
module.exports = { statusOptions, originStatuses };