// Read-only operational reporting. Never writes orders, payments or ledgers.
const mongoose = require("mongoose");
const Delivery = require("../models/delivery.model");
const Shipment = require("../models/interstateShipment.model");
const User = require("../models/user.model");

const buckets = {
  PENDING: "CREATED", DRAFT: "CREATED", AWAITING_PAYMENT: "CREATED",
  ADDITIONAL_PAYMENT_REQUIRED: "CREATED", REFUND_REVIEW_REQUIRED: "CREATED",
  PAID: "CONFIRMED", AWAITING_PICKUP: "CONFIRMED",
  RECEIVED_AT_ORIGIN_HUB: "CONFIRMED", VERIFIED_AT_ORIGIN_HUB: "CONFIRMED",
  READY_FOR_INTERSTATE_DISPATCH: "CONFIRMED",
  ASSIGNED: "ASSIGNED", PICKUP_ASSIGNED: "ASSIGNED", ACCEPTED: "ACCEPTED",
  PICKED_UP: "PICKED_UP", IN_TRANSIT: "IN_TRANSIT",
  ARRIVED_AT_DESTINATION_HUB: "ARRIVED_AT_DESTINATION_BRANCH",
  DESTINATION_HUB_VERIFIED: "ARRIVED_AT_DESTINATION_BRANCH",
  READY_FOR_COLLECTION: "ARRIVED_AT_DESTINATION_BRANCH",
  OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY", DELIVERY_ATTEMPTED: "OUT_FOR_DELIVERY",
  DELIVERED: "DELIVERED", CANCELLED: "CANCELLED",
  FAILED: "FAILED", FAILED_DELIVERY: "FAILED",
  RETURN_INITIATED: "FAILED", RETURN_IN_TRANSIT: "FAILED", RETURNED: "FAILED",
};
function lifecycleCounts(raw) {
  const counts = Object.fromEntries([...new Set([...Object.values(buckets), "UNCLASSIFIED"])].map(k => [k, 0]));
  for (const [status, count] of Object.entries(raw)) counts[buckets[status] || (Object.hasOwn(counts, status) ? status : "UNCLASSIFIED")] += count;
  return counts;
}
const money = (field, condition) => ({ $sum: condition ? { $cond: [condition, { $ifNull: [field, 0] }, 0] } : { $ifNull: [field, 0] } });
function pipeline(match, field, today, financialMatch = {}) {
  return [{ $match: match }, { $facet: {
    statuses: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
    today: [{ $match: { createdAt: { $gte: today, $lt: new Date(+today + 86400000) } } }, { $count: "count" }],
    finance: [{ $match: financialMatch }, { $group: {
      _id: null,
      grossOrderValue: money(field),
      recordedPaidValue: money(field, { $eq: ["$paymentStatus", "PAID"] }),
      unpaidValue: money(field, { $eq: ["$paymentStatus", "UNPAID"] }),
      refundedValue: money(field, { $eq: ["$paymentStatus", "REFUNDED"] }),
      recordedRiderCommissions: money("$riderCommissionAmount", { $and: [
        { $ne: ["$riderCommissionStatus", "CANCELLED"] },
        { $or: [{ $in: ["$riderCommissionStatus", ["CREDITED", "SETTLED"]] }, { $eq: ["$riderCommissionCredited", true] }] },
      ] }),
    } }],
  } }];
}
async function branchDeliveryOperations({ branchId, dateRange = {}, staffId, status, now = new Date() }) {
  const bid = new mongoose.Types.ObjectId(String(branchId));
  const filter = { ...(Object.keys(dateRange).length ? { createdAt: dateRange } : {}), ...(status ? { status } : {}) };
  if (staffId) filter.assignedRiderId = new mongoose.Types.ObjectId(String(staffId));
  // Nigeria uses UTC+1 throughout the year.
  const shifted = new Date(+now + 3600000);
  const today = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - 3600000);
  const [local, interstate, activeRiders] = await Promise.all([
    Delivery.aggregate(pipeline({ branchId: bid, ...filter }, "$deliveryFee", today)),
    Shipment.aggregate(pipeline({ $or: [{ originBranchId: bid }, { destinationBranchId: bid }], ...filter }, "$quote.total", today, { originBranchId: bid })),
    User.countDocuments({ branchId: bid, role: "DELIVERY_RIDER", status: "ACTIVE", isDeleted: { $ne: true } }),
  ]);
  const raw = {}, financial = {
    grossOrderValue: 0, recordedPaidValue: 0, unpaidValue: 0, refundedValue: 0, recordedRiderCommissions: 0,
  };
  let todayCount = 0;
  for (const report of [local[0], interstate[0]]) {
    for (const row of report?.statuses || []) raw[row._id || "UNCLASSIFIED"] = (raw[row._id || "UNCLASSIFIED"] || 0) + row.count;
    todayCount += report?.today?.[0]?.count || 0;
    for (const key of Object.keys(financial)) financial[key] += Number(report?.finance?.[0]?.[key] || 0);
  }
  const lifecycle = lifecycleCounts(raw), total = Object.values(raw).reduce((a, b) => a + b, 0);
  return {
    total, today: todayCount, rawStatuses: raw, lifecycle, activeRiders,
    pending: lifecycle.CREATED + lifecycle.CONFIRMED,
    assigned: lifecycle.ASSIGNED + lifecycle.ACCEPTED,
    inTransit: lifecycle.IN_TRANSIT,
    inProgress: lifecycle.PICKED_UP + lifecycle.IN_TRANSIT + lifecycle.ARRIVED_AT_DESTINATION_BRANCH + lifecycle.OUT_FOR_DELIVERY,
    delivered: lifecycle.DELIVERED, cancelled: lifecycle.CANCELLED,
    failed: lifecycle.FAILED, unclassified: lifecycle.UNCLASSIFIED,
    deliveredPercent: total ? Number((100 * lifecycle.DELIVERED / total).toFixed(2)) : 0,
    localOrders: (local[0]?.statuses || []).reduce((n, r) => n + r.count, 0),
    interstateOrders: (interstate[0]?.statuses || []).reduce((n, r) => n + r.count, 0),
    financial: {
      ...financial, operationalExpenses: null, reconciledProfit: null, estimatedNetEarnings: null,
      basis: "SAVED_ORDER_PAYMENT_FLAGS_NOT_RECONCILED_LEDGER_PROFIT",
      attribution: "LOCAL_BRANCH_AND_INTERSTATE_ORIGIN_ONLY",
      limitations: "Interstate commission and expense records are unavailable here. Workload includes both hubs and is not additive across branches. Payment flags do not establish financial custody or bank reconciliation.",
    },
  };
}
module.exports = { branchDeliveryOperations, lifecycleCounts };
