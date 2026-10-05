const s = require("../services/branchCounterDelivery.service");
const { receiptHtml } = require("../services/branchCounterReceipt.service");
const Route = require("../models/logisticsRoute.model");
const Delivery = require("../models/delivery.model");
const mongoose = require("mongoose");
const Settings = require("../models/appSettings.model");
const wrap = fn => async (req, res) => {
  try { return await fn(req, res); }
  catch (e) {
    const conflict = e.code === 11000 || e.hasErrorLabel?.("TransientTransactionError");
    return res.status(e.status || (conflict ? 409 : e.name === "ValidationError" ? 400 : 500))
      .json({ success: false, message: e.status || e.name === "ValidationError" ? e.message :
        conflict ? "Order changed; retry with the same request key." : "The counter operation could not be completed. Retain your request and retry safely." });
  }
};
exports.config = wrap(async (req, res) => {
  const b = await s.office(req);
  const routes = await Route.find({ originBranchId: b._id, status: "ACTIVE", isArchived: { $ne: true } })
    .select("_id name originState destinationState originBranchId destinationBranchId").limit(100).lean();
  res.json({ success: true, branch: { _id: b._id, name: b.name, state: b.state, lga: b.lga, address: b.address },
    routes, standardDeliveryFee: (await require("../services/deliveryPricing.service").intraState()).price, canConfirmPayments: s.isManager(req, b) });
});
exports.quote = wrap(async (req, res) => res.json({ success: true, quote: await s.quote(req) }));
exports.create = wrap(async (req, res) => {
  const result = await s.create(req);
  res.status(result.idempotent ? 200 : 201).json({ success: true, ...result });
});
exports.detail = wrap(async (req, res) => {
  const { s: order, kind } = await s.scoped(req);
  res.json({ success: true, order: s.output(order, kind) });
});
exports.evidence = wrap(async (req, res) => res.json({ success: true, order: await s.payment(req, false) }));
exports.confirm = wrap(async (req, res) => res.json({ success: true, order: await s.payment(req, true) }));
exports.receipt = wrap(async (req, res) => {
  const { s: order, kind } = await s.scoped(req);
  const layout = req.query.layout === "THERMAL" ? "THERMAL" : "A4";
  // Read existing public support settings; do not initialize or mutate the
  // shared settings/catalogue document merely to print a receipt.
  const settings = await Settings.findOne({ key: "GLOBAL_SETTINGS" }).select("support").lean();
  const support = settings?.support || {};
  const contacts = [support.supportPhone || support.phone, support.supportEmail || support.email]
    .filter(value => value && value !== "08000000000");
  const html = receiptHtml(s.output(order, kind), layout, contacts.length ? contacts : ["09136151515", "admin@servicepay.ng"]);
  res.set("Cache-Control", "private, no-store").set("X-Content-Type-Options", "nosniff");
  if (String(req.get("Accept") || "").includes("application/json"))
    return res.json({ success: true, html, trackingNumber: order.trackingNumber });
  res.set("Content-Security-Policy", "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'")
    .type("html").send(html);
});
exports.print = wrap(async (req, res) => {
  const { b, s: order, kind } = await s.scoped(req);
  await s.audit(req, b, req.body.reprint === true ? "BRANCH_DELIVERY_REPRINT_REQUESTED" : "BRANCH_DELIVERY_PRINT_REQUESTED",
    { orderId: order._id, kind, layout: req.body.layout === "THERMAL" ? "THERMAL" : "A4" });
  res.json({ success: true, message: "Print request recorded; printer completion is not verified." });
});
exports.cancel = wrap(async (req, res) => {
  const session = await mongoose.startSession(); let result;
  try {
    await session.withTransaction(async () => {
      const { b, s: order, Model, kind } = await s.scoped(req, session);
      if (order.status === "CANCELLED") { result = s.output(order, kind); return; }
      if (order.paymentStatus !== "UNPAID") throw s.fail("Paid cancellation requires financial review; no refund has been issued.", 409);
      if (!(kind === "DELIVERY" ? ["PENDING"] : ["RECEIVED_AT_ORIGIN_HUB"]).includes(order.status) ||
          order.assignedRiderId) throw s.fail("Dispatched orders require operational cancellation review.", 409);
      const changed = await Model.findOneAndUpdate({ _id: order._id, status: order.status,
        paymentStatus: "UNPAID", assignedRiderId: order.assignedRiderId || null },
        { $set: { status: "CANCELLED", cancelledAt: new Date() } },
        { session, returnDocument: "after", runValidators: true });
      if (!changed) throw s.fail("Order changed; reload it.", 409);
      if (kind === "INTERSTATE") {
        const History = require("../models/shipmentStatusHistory.model");
        await History.create([{ shipmentId: order._id, status: "CANCELLED", actorId: req.user._id,
          actorRole: req.user.role, branchId: b._id, note: "Counter order cancelled before payment/dispatch." }], { session });
      }
      await s.audit(req, b, "BRANCH_DELIVERY_CANCELLED", { orderId: order._id, kind }, session);
      result = s.output(changed, kind);
    });
    res.json({ success: true, order: result });
  } finally { await session.endSession(); }
});
const groups = {
  PENDING: ["PENDING", "ASSIGNED", "ACCEPTED", "AWAITING_PAYMENT", "PAID", "AWAITING_PICKUP",
    "PICKUP_ASSIGNED", "RECEIVED_AT_ORIGIN_HUB", "VERIFIED_AT_ORIGIN_HUB", "READY_FOR_INTERSTATE_DISPATCH"],
  IN_TRANSIT: ["PICKED_UP", "IN_TRANSIT", "ARRIVED_AT_DESTINATION_HUB", "DESTINATION_HUB_VERIFIED",
    "READY_FOR_COLLECTION", "OUT_FOR_DELIVERY", "DELIVERY_ATTEMPTED"],
  DELIVERED: ["DELIVERED"], CANCELLED: ["CANCELLED"],
};
exports.list = wrap(async (req, res) => {
  const b = await s.office(req), filter = { "counter.branch._id": b._id };
  const status = String(req.query.status || "ALL").toUpperCase();
  if (status !== "ALL") {
    if (!groups[status]) throw s.fail("Invalid counter-order filter.");
    filter.status = { $in: groups[status] };
  }
  const term = String(req.query.search || "").trim().slice(0, 100);
  if (term) {
    const regex = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = ["trackingNumber", "counter.sender.phone", "counter.receiver.phone",
      "counter.sender.name", "counter.receiver.name"].map(field => ({ [field]: { $regex: regex, $options: "i" } }));
  }
  const page = Math.min(10000, Math.max(1, parseInt(req.query.page, 10) || 1)), size = 30;
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const start = new Date(`${date}T00:00:00+01:00`), end = new Date(start.getTime() + 86400000);
  const rows = await Promise.all(Object.entries(s.kinds).map(async ([kind, Model]) => {
    const indexedScope = { [kind === "DELIVERY" ? "branchId" : "originBranchId"]: b._id };
    const base = { ...indexedScope, "counter.branch._id": b._id };
    const [docs, count, stats] = await Promise.all([
      Model.find({ ...indexedScope, ...filter }).sort({ createdAt: -1 }).limit(page * size).lean(),
      Model.countDocuments({ ...indexedScope, ...filter }),
      Model.aggregate([{ $match: base }, { $group: { _id: null,
        todayOrders: { $sum: { $cond: [{ $and: [{ $gte: ["$createdAt", start] }, { $lt: ["$createdAt", end] }] }, 1, 0] } },
        todayRevenue: { $sum: { $cond: [{ $and: [{ $eq: ["$paymentStatus", "PAID"] },
          { $gte: ["$paidAt", start] }, { $lt: ["$paidAt", end] }] }, "$counter.total", 0] } },
        pendingPickup: { $sum: { $cond: [{ $in: ["$status", groups.PENDING] }, 1, 0] } },
        inTransit: { $sum: { $cond: [{ $in: ["$status", groups.IN_TRANSIT] }, 1, 0] } },
        delivered: { $sum: { $cond: [{ $eq: ["$status", "DELIVERED"] }, 1, 0] } },
      } }]),
    ]);
    return { orders: docs.map(d => s.output(d, kind)), count, stats: stats[0] || {} };
  }));
  const stats = Object.fromEntries(["todayOrders", "todayRevenue", "pendingPickup", "inTransit", "delivered"]
    .map(key => [key, rows.reduce((n, row) => n + Number(row.stats[key] || 0), 0)]));
  const orders = rows.flatMap(row => row.orders).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice((page - 1) * size, page * size);
  res.json({ success: true, orders, stats, page, total: rows.reduce((n, row) => n + row.count, 0) });
});