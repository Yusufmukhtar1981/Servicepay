const crypto = require("crypto");
const mongoose = require("mongoose");
const LogisticsRoute = require("../models/logisticsRoute.model");
const Shipment = require("../models/interstateShipment.model");
const History = require("../models/shipmentStatusHistory.model");
const Otp = require("../models/shipmentDeliveryOtp.model");
const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const Notification = require("../models/notification.model");
const BranchAuditLog = require("../models/branchAuditLog.model");
const AdminAuditLog = require("../models/adminAuditLog.model");
const TransportDriver = require("../models/transportDriver.model");
const TransportVehicle = require("../models/transportVehicle.model");
const TransportTrip = require("../models/transportTrip.model");
const Branch = require("../models/branch.model");
const LogisticsQuote = require("../models/logisticsQuote.model");
const { calculateInterstateQuote } = require("../services/interstatePricing.service");
const { sendDeliveryOtp } = require("../services/logisticsSms.service");

const staffRoles = ["HEAD_OFFICE", "ZONAL_MANAGER", "STATE_MANAGER", "BRANCH_MANAGER", "STAFF"];
const transitions = {
  AWAITING_PICKUP: ["PICKUP_ASSIGNED", "RECEIVED_AT_ORIGIN_HUB", "CANCELLED"],
  PICKUP_ASSIGNED: ["PICKED_UP", "CANCELLED"], PICKED_UP: ["RECEIVED_AT_ORIGIN_HUB"],
  RECEIVED_AT_ORIGIN_HUB: ["VERIFIED_AT_ORIGIN_HUB"], VERIFIED_AT_ORIGIN_HUB: ["READY_FOR_INTERSTATE_DISPATCH"],
  READY_FOR_INTERSTATE_DISPATCH: ["IN_TRANSIT"], IN_TRANSIT: ["ARRIVED_AT_DESTINATION_HUB"],
  ARRIVED_AT_DESTINATION_HUB: ["DESTINATION_HUB_VERIFIED"], DESTINATION_HUB_VERIFIED: ["OUT_FOR_DELIVERY", "READY_FOR_COLLECTION"],
  OUT_FOR_DELIVERY: ["DELIVERY_ATTEMPTED", "DELIVERED", "FAILED_DELIVERY"], DELIVERY_ATTEMPTED: ["OUT_FOR_DELIVERY", "FAILED_DELIVERY"],
  FAILED_DELIVERY: ["RETURN_INITIATED"], RETURN_INITIATED: ["RETURN_IN_TRANSIT"], RETURN_IN_TRANSIT: ["RETURNED"],
};
const branchAllowed = (user, branchId) => user.role === "HEAD_OFFICE" || String(user.branchId || "") === String(branchId);
const tracking = () => `SPX-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
const ref = () => `INTERSTATE-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
const quoteInput = (body = {}) => ({ ...body, weightKg: body.weightKg ?? body.parcel?.weightKg, declaredValue: body.declaredValue ?? body.parcel?.declaredValue, fragile: body.fragile ?? body.parcel?.fragile });
const quoteHash = (body) => crypto.createHash("sha256").update(JSON.stringify({ routeId: String(body.routeId), weightKg: Number(body.weightKg), declaredValue: Number(body.declaredValue || 0), serviceType: body.serviceType, pickupMethod: body.pickupMethod, deliveryMethod: body.deliveryMethod, protection: !!body.protection, fragile: !!body.fragile })).digest("hex");
const audit = async (req, shipment, action, reason) => {
  if (req.user.role === "HEAD_OFFICE") await AdminAuditLog.create({ actorId: req.user._id, actorRole: req.user.role, actorName: req.user.fullName || "", action, reason, metadata: { shipmentId: shipment._id, trackingNumber: shipment.trackingNumber }, ipAddress: req.ip || "", userAgent: req.get?.("user-agent") || "", requestMethod: req.method || "", requestPath: req.originalUrl || "" });
  if (req.user.branchId && branchAllowed(req.user, shipment.originBranchId)) await BranchAuditLog.create({ branchId: req.user.branchId, actorId: req.user._id, action, reason, metadata: { shipmentId: shipment._id, trackingNumber: shipment.trackingNumber } });
};
const recordStatus = async (shipment, status, req, options = {}) => {
  shipment.status = status;
  if (status === "DELIVERED") shipment.deliveredAt = new Date();
  if (status === "CANCELLED") shipment.cancelledAt = new Date();
  await shipment.save();
  await History.create({ shipmentId: shipment._id, status, actorId: req.user?._id || null, actorRole: req.user?.role || "SYSTEM", branchId: options.branchId || req.user?.branchId || null, locationText: options.locationText || "", note: options.note || "", evidenceUrls: options.evidenceUrls || [], publicVisible: options.publicVisible !== false });
  await audit(req, shipment, "INTERSTATE_STATUS_UPDATED", `Status changed to ${status}`);
};
const getRouteQuote = async (body) => {
  const route = await LogisticsRoute.findOne({ _id: body.routeId, status: "ACTIVE" });
  if (!route) throw new Error("ServicePay Interstate Logistics is not yet available for this route.");
  const input = quoteInput(body);
  return { route, input, quote: calculateInterstateQuote(route, input) };
};
exports.quote = async (req, res) => {
  try { const { route, input, quote } = await getRouteQuote(req.body); const routeVersion = String(route.updatedAt.getTime()); const persisted = await LogisticsQuote.create({ customerId: req.user._id, routeId: route._id, routeVersion, inputHash: quoteHash(input), quote, expiresAt: new Date(Date.now() + 15 * 60 * 1000) }); return res.json({ success: true, data: { ...quote, routeId: route._id, quoteId: persisted._id, expiresAt: persisted.expiresAt }, routeId: route._id, quoteId: persisted._id, quote: { ...quote, quoteId: persisted._id, expiresAt: persisted.expiresAt } }); }
  catch (e) { return res.status(400).json({ success: false, message: e.message }); }
};
exports.createShipment = async (req, res) => {
  try {
    const b = req.body; const { route, input, quote } = await getRouteQuote(b);
    const savedQuote = await LogisticsQuote.findOne({ _id: b.quoteId, customerId: req.user._id, routeId: route._id, expiresAt: { $gt: new Date() } });
    if (!savedQuote || savedQuote.routeVersion !== String(route.updatedAt.getTime()) || savedQuote.inputHash !== quoteHash(input)) return res.status(409).json({ success: false, code: "QUOTE_STALE", message: "Quote is stale or no longer matches shipment details. Request a new quote." });
    if (!b.sender?.name || !b.sender?.phone || !b.sender?.address || !b.receiver?.name || !b.receiver?.phone || !b.receiver?.address || !b.parcel?.category || !b.parcel?.description || !b.prohibitedItemsAcknowledged) return res.status(400).json({ success: false, message: "Provide complete sender, receiver, parcel details and prohibited-items acknowledgement." });
    const prohibited = ["WEAPONS", "EXPLOSIVES", "ILLEGAL_DRUGS", "DANGEROUS_CHEMICALS", "CASH", "CURRENCY"];
    if (prohibited.includes(String(b.parcel.category).toUpperCase())) return res.status(400).json({ success: false, message: "This parcel category is prohibited." });
    const shipment = await Shipment.create({ customerId: req.user._id, routeId: route._id, originBranchId: route.originBranchId, destinationBranchId: route.destinationBranchId, sender: b.sender, receiver: b.receiver, pickupMethod: b.pickupMethod, deliveryMethod: b.deliveryMethod, parcel: b.parcel, serviceType: b.serviceType, protection: !!b.protection, quote: { routeVersion: savedQuote.routeVersion, breakdown: quote.breakdown, total: quote.total, expectedDelivery: quote.expectedDelivery }, status: "AWAITING_PAYMENT" });
    await History.create({ shipmentId: shipment._id, status: "AWAITING_PAYMENT", actorId: req.user._id, actorRole: req.user.role, branchId: route.originBranchId, note: "Shipment created" });
    return res.status(201).json({ success: true, data: shipment, shipment });
  } catch (e) { return res.status(400).json({ success: false, message: e.message }); }
};
exports.pay = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const key = String(req.get("Idempotency-Key") || req.body.idempotencyKey || "").trim() || `shipment-payment:${req.params.id}`;
    if (key.length > 120) return res.status(400).json({ success: false, message: "Idempotency-Key is too long." });
    const existing = await Shipment.findOne({ customerId: req.user._id, paymentIdempotencyKey: key }).populate("paymentTransactionId");
    if (existing) return res.json({ success: true, idempotent: true, data: existing, shipment: existing, transaction: existing.paymentTransactionId });
    session.startTransaction();
    const shipment = await Shipment.findOne({ _id: req.params.id, customerId: req.user._id, paymentStatus: "UNPAID", status: "AWAITING_PAYMENT" }).session(session);
    if (!shipment) throw Object.assign(new Error("Shipment is not available for payment."), { status: 404 });
    const route = await LogisticsRoute.findOne({ _id: shipment.routeId, status: "ACTIVE" }).session(session);
    if (!route || shipment.quote.routeVersion !== String(route.updatedAt.getTime())) throw Object.assign(new Error("Route pricing changed. Request a new quote before payment."), { status: 409, code: "QUOTE_STALE" });
    shipment.paymentIdempotencyKey = key; shipment.trackingNumber = tracking(); shipment.paymentStatus = "PAID"; shipment.paidAt = new Date(); shipment.status = "PAID";
    const user = await User.findOneAndUpdate({ _id: req.user._id, status: "ACTIVE", walletBalance: { $gte: shipment.quote.total } }, { $inc: { walletBalance: -shipment.quote.total, totalTransactions: 1 } }, { new: true, session });
    if (!user) throw Object.assign(new Error("Insufficient wallet balance."), { status: 400 });
    const [transaction] = await Transaction.create([{ reference: ref(), customerId: user._id, branchId: shipment.originBranchId, agentId: user.agentId || null, stateManagerId: user.stateManagerId || null, zonalManagerId: user.zonalManagerId || null, serviceType: "INTERSTATE_LOGISTICS", provider: "SERVICEPAY_LOGISTICS", phone: shipment.receiver.phone, amount: shipment.quote.total, status: "SUCCESSFUL", providerResponse: { shipmentId: shipment._id, trackingNumber: shipment.trackingNumber, paymentMode: "WALLET" } }], { session });
    shipment.paymentTransactionId = transaction._id; await shipment.save({ session });
    await History.create([{ shipmentId: shipment._id, status: "PAID", actorId: req.user._id, actorRole: req.user.role, branchId: shipment.originBranchId, note: "Wallet payment successful" }, { shipmentId: shipment._id, status: "AWAITING_PICKUP", actorId: req.user._id, actorRole: req.user.role, branchId: shipment.originBranchId }], { session });
    shipment.status = "AWAITING_PICKUP"; await shipment.save({ session }); await session.commitTransaction();
    await Notification.create({ userId: user._id, title: "Interstate shipment paid", message: `Your shipment ${shipment.trackingNumber} has been paid for.`, type: "DELIVERY", action: "DELIVERY", referenceId: shipment._id, referenceType: "INTERSTATE_SHIPMENT", reference: shipment.trackingNumber, relatedStatus: shipment.status, dedupeKey: `interstate-paid-${shipment._id}` });
    return res.json({ success: true, data: shipment, shipment, transaction, walletBalance: user.walletBalance });
  } catch (e) { if (session.inTransaction()) await session.abortTransaction(); if (e.code === 11000) { const retryKey = String(req.get("Idempotency-Key") || req.body.idempotencyKey || "").trim() || `shipment-payment:${req.params.id}`; const shipment = await Shipment.findOne({ customerId: req.user._id, paymentIdempotencyKey: retryKey }).populate("paymentTransactionId"); if (shipment) return res.json({ success: true, idempotent: true, data: shipment, shipment, transaction: shipment.paymentTransactionId }); } return res.status(e.status || 500).json({ success: false, message: e.message || "Payment failed." }); } finally { session.endSession(); }
};
exports.myShipments = async (req, res) => { const filter = { customerId: req.user._id }; if (req.query.status) filter.status = String(req.query.status).toUpperCase(); const shipments = await Shipment.find(filter).sort({ createdAt: -1 }); res.json({ success: true, count: shipments.length, shipments }); };
exports.customerRoutes = async (req, res) => { const routes = await LogisticsRoute.find({ status: "ACTIVE" }).select("-createdBy -updatedBy").sort({ originState: 1, destinationState: 1 }); res.json({ success: true, data: { routes }, routes }); };
exports.config = exports.customerRoutes;
exports.getShipment = async (req, res) => { const shipment = await Shipment.findOne({ _id: req.params.id, customerId: req.user._id }); if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found." }); const timeline = await History.find({ shipmentId: shipment._id }).sort({ createdAt: 1 }); res.json({ success: true, shipment, timeline }); };
exports.track = async (req, res) => { const shipment = await Shipment.findOne({ trackingNumber: String(req.params.trackingNumber).toUpperCase() }).select("trackingNumber sender.state receiver.state status quote.expectedDelivery createdAt updatedAt deliveredAt"); if (!shipment) return res.status(404).json({ success: false, message: "Invalid tracking number." }); const timeline = await History.find({ shipmentId: shipment._id, publicVisible: true }).select("status locationText createdAt").sort({ createdAt: 1 }); res.json({ success: true, shipment: { trackingNumber: shipment.trackingNumber, origin: shipment.sender.state, destination: shipment.receiver.state, status: shipment.status, expectedDelivery: shipment.quote.expectedDelivery, latestUpdate: shipment.updatedAt }, timeline }); };
exports.cancel = async (req, res) => {
  const shipment = await Shipment.findOne({ _id: req.params.id, customerId: req.user._id });
  if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found." });
  if (shipment.paymentStatus === "PAID") return res.status(409).json({ success: false, code: "CANCELLATION_REVIEW_REQUIRED", message: "Paid shipment cancellation requires controlled branch or Head Office review; no refund has been issued." });
  if (shipment.status !== "AWAITING_PAYMENT") return res.status(400).json({ success: false, message: "This shipment requires branch or admin cancellation review." });
  await recordStatus(shipment, "CANCELLED", req, { note: "Cancelled by customer" });
  return res.json({ success: true, shipment, message: shipment.paymentStatus === "PAID" ? "Cancellation recorded; refund requires controlled review." : "Shipment cancelled." });
};
exports.listBranch = async (req, res) => {
  if (!staffRoles.includes(req.user.role) || !req.user.branchId) return res.status(403).json({ success: false, message: "Branch logistics access required." });
  const filter = { $or: [{ originBranchId: req.user.branchId }, { destinationBranchId: req.user.branchId }] };
  if (req.query.status) filter.status = String(req.query.status).toUpperCase() === "VERIFICATION" ? "RECEIVED_AT_ORIGIN_HUB" : String(req.query.status).toUpperCase();
  const shipments = await Shipment.find(filter).sort({ createdAt: -1 });
  res.json({ success: true, shipments });
};
exports.branchStatus = async (req, res) => {
  const shipment = await Shipment.findById(req.params.id);
  if (!shipment || !branchAllowed(req.user, shipment.originBranchId) && !branchAllowed(req.user, shipment.destinationBranchId)) return res.status(404).json({ success: false, message: "Shipment not found for your branch." });
  const status = String(req.body.status || "").toUpperCase();
  const allowed = ["RECEIVED_AT_ORIGIN_HUB", "VERIFIED_AT_ORIGIN_HUB", "READY_FOR_INTERSTATE_DISPATCH", "ARRIVED_AT_DESTINATION_HUB", "DESTINATION_HUB_VERIFIED", "READY_FOR_COLLECTION", "DELIVERY_ATTEMPTED", "FAILED_DELIVERY", "RETURN_INITIATED", "RETURN_IN_TRANSIT", "RETURNED"];
  if (!allowed.includes(status)) return res.status(400).json({ success: false, message: "Invalid branch shipment status." });
  const originActions = ["RECEIVED_AT_ORIGIN_HUB", "VERIFIED_AT_ORIGIN_HUB", "READY_FOR_INTERSTATE_DISPATCH"];
  const destinationActions = ["ARRIVED_AT_DESTINATION_HUB", "DESTINATION_HUB_VERIFIED", "READY_FOR_COLLECTION", "DELIVERY_ATTEMPTED", "FAILED_DELIVERY", "RETURN_INITIATED", "RETURN_IN_TRANSIT", "RETURNED"];
  if ((originActions.includes(status) && !branchAllowed(req.user, shipment.originBranchId)) || (destinationActions.includes(status) && !branchAllowed(req.user, shipment.destinationBranchId))) return res.status(403).json({ success: false, message: "This action belongs to the other hub." });
  if (!(transitions[shipment.status] || []).includes(status)) return res.status(409).json({ success: false, message: `Cannot change shipment from ${shipment.status} to ${status}.` });
  if (status === "VERIFIED_AT_ORIGIN_HUB" && req.body.verifiedWeightKg !== undefined) {
    const verifiedWeightKg = Number(req.body.verifiedWeightKg);
    if (!Number.isFinite(verifiedWeightKg) || verifiedWeightKg <= 0) return res.status(400).json({ success: false, message: "Verified weight must be valid." });
    const route = await LogisticsRoute.findOne({ _id: shipment.routeId, status: "ACTIVE" });
    if (!route) return res.status(409).json({ success: false, message: "Route is unavailable for weight verification." });
    const recalculated = calculateInterstateQuote(route, { weightKg: verifiedWeightKg, declaredValue: shipment.parcel.declaredValue, serviceType: shipment.serviceType, pickupMethod: shipment.pickupMethod, deliveryMethod: shipment.deliveryMethod, protection: shipment.protection, fragile: shipment.parcel.fragile });
    const difference = Number((recalculated.total - shipment.quote.total).toFixed(2));
    shipment.verifiedWeightKg = verifiedWeightKg;
    shipment.priceAdjustments.push({ declaredWeightKg: shipment.parcel.weightKg, verifiedWeightKg, previousTotal: shipment.quote.total, adjustedTotal: recalculated.total, difference, actorId: req.user._id });
    shipment.quote.breakdown = recalculated.breakdown; shipment.quote.total = recalculated.total;
    if (difference > 0) { shipment.status = "ADDITIONAL_PAYMENT_REQUIRED"; await shipment.save(); await History.create({ shipmentId: shipment._id, status: shipment.status, actorId: req.user._id, actorRole: req.user.role, branchId: shipment.originBranchId, note: "Actual weight requires additional payment", publicVisible: true }); return res.status(409).json({ success: false, code: "ADDITIONAL_PAYMENT_REQUIRED", message: "Verified weight requires additional payment before dispatch.", shipment }); }
    if (difference < 0) { shipment.status = "REFUND_REVIEW_REQUIRED"; await shipment.save(); await History.create({ shipmentId: shipment._id, status: shipment.status, actorId: req.user._id, actorRole: req.user.role, branchId: shipment.originBranchId, note: "Actual weight reduction requires controlled refund review", publicVisible: true }); return res.status(409).json({ success: false, code: "REFUND_REVIEW_REQUIRED", message: "Weight reduction is pending controlled refund review.", shipment }); }
  }
  await recordStatus(shipment, status, req, req.body);
  res.json({ success: true, shipment });
};
exports.paySupplement = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const key = String(req.get("Idempotency-Key") || req.body.idempotencyKey || "").trim() || `shipment-supplement:${req.params.id}`;
    const shipment = await Shipment.findOne({ _id: req.params.id, customerId: req.user._id, status: "ADDITIONAL_PAYMENT_REQUIRED" }).session(session);
    if (!shipment) return res.status(404).json({ success: false, message: "No additional payment is due for this shipment." });
    const adjustment = shipment.priceAdjustments[shipment.priceAdjustments.length - 1];
    if (adjustment?.settlementTransactionId) return res.json({ success: true, idempotent: true, data: shipment, shipment });
    const amount = Number(adjustment?.difference || 0); if (amount <= 0) return res.status(409).json({ success: false, message: "Invalid supplemental adjustment." });
    session.startTransaction(); const user = await User.findOneAndUpdate({ _id: req.user._id, status: "ACTIVE", walletBalance: { $gte: amount } }, { $inc: { walletBalance: -amount, totalTransactions: 1 } }, { new: true, session }); if (!user) throw Object.assign(new Error("Insufficient wallet balance."), { status: 400 });
    const [transaction] = await Transaction.create([{ reference: `${ref()}-ADJ`, customerId: user._id, branchId: shipment.originBranchId, serviceType: "INTERSTATE_LOGISTICS", provider: "SERVICEPAY_LOGISTICS", phone: shipment.receiver.phone, amount, status: "SUCCESSFUL", providerResponse: { shipmentId: shipment._id, type: "WEIGHT_ADJUSTMENT", idempotencyKey: key } }], { session });
    adjustment.settlementTransactionId = transaction._id; shipment.status = "VERIFIED_AT_ORIGIN_HUB"; await shipment.save({ session }); await History.create([{ shipmentId: shipment._id, status: shipment.status, actorId: req.user._id, actorRole: req.user.role, branchId: shipment.originBranchId, note: "Additional weight payment settled" }], { session }); await session.commitTransaction();
    res.json({ success: true, data: shipment, shipment, transaction, walletBalance: user.walletBalance });
  } catch (e) { if (session.inTransaction()) await session.abortTransaction(); res.status(e.status || 500).json({ success: false, message: e.message }); } finally { session.endSession(); }
};
exports.confirmDeliveryFallback = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const reason = String(req.body.reason || "").trim();
    const evidenceUrls = req.body.evidenceUrls === undefined ? [] : req.body.evidenceUrls;
    if (reason.length < 10 || reason.length > 500) return res.status(400).json({ success: false, message: "A delivery fallback reason of 10 to 500 characters is required." });
    if (!Array.isArray(evidenceUrls) || evidenceUrls.length > 5 || evidenceUrls.some((url) => { try { const parsed = new URL(String(url)); return !["http:", "https:"].includes(parsed.protocol); } catch (_) { return true; } })) return res.status(400).json({ success: false, message: "Evidence must contain at most five valid HTTP(S) URLs." });
    const initial = await Shipment.findById(req.params.id).session(session);
    if (!initial) return res.status(404).json({ success: false, message: "Shipment not found." });
    if (initial.status === "DELIVERED") return res.json({ success: true, idempotent: true, data: initial, shipment: initial });
    if (!branchAllowed(req.user, initial.destinationBranchId)) return res.status(403).json({ success: false, message: "Only Head Office or the destination branch can confirm this delivery." });
    if (!["OUT_FOR_DELIVERY", "DELIVERY_ATTEMPTED", "FAILED_DELIVERY"].includes(initial.status)) return res.status(409).json({ success: false, message: "Fallback confirmation is not allowed in the shipment's current state." });
    session.startTransaction();
    const shipment = await Shipment.findOneAndUpdate({ _id: initial._id, status: { $in: ["OUT_FOR_DELIVERY", "DELIVERY_ATTEMPTED", "FAILED_DELIVERY"] } }, { $set: { status: "DELIVERED", deliveredAt: new Date() } }, { new: true, session });
    if (!shipment) {
      await session.abortTransaction();
      const current = await Shipment.findById(initial._id);
      if (current?.status === "DELIVERED") return res.json({ success: true, idempotent: true, data: current, shipment: current });
      return res.status(409).json({ success: false, message: "Shipment state changed; fallback confirmation was not applied." });
    }
    await History.create([{ shipmentId: shipment._id, status: "DELIVERED", actorId: req.user._id, actorRole: req.user.role, branchId: req.user.role === "HEAD_OFFICE" ? shipment.destinationBranchId : req.user.branchId, note: `DELIVERY_FALLBACK: ${reason}`, evidenceUrls: evidenceUrls.map(String), publicVisible: false }], { session });
    await session.commitTransaction();
    const metadata = { shipmentId: shipment._id, trackingNumber: shipment.trackingNumber, method: "AUTHORIZED_FALLBACK", evidenceCount: evidenceUrls.length };
    if (req.user.role === "HEAD_OFFICE") await AdminAuditLog.create({ actorId: req.user._id, actorRole: req.user.role, actorName: req.user.fullName || "", action: "INTERSTATE_DELIVERY_FALLBACK_CONFIRMED", reason, metadata, ipAddress: req.ip || "", userAgent: req.get("user-agent") || "", requestMethod: req.method || "", requestPath: req.originalUrl || "" });
    else await BranchAuditLog.create({ branchId: req.user.branchId, actorId: req.user._id, action: "INTERSTATE_DELIVERY_FALLBACK_CONFIRMED", reason, metadata });
    await Notification.create({ userId: shipment.customerId, title: "Shipment delivered", message: `Your shipment ${shipment.trackingNumber} has been confirmed as delivered.`, type: "DELIVERY", action: "DELIVERY", referenceId: shipment._id, referenceType: "INTERSTATE_SHIPMENT", reference: shipment.trackingNumber, relatedStatus: "DELIVERED", dedupeKey: `interstate-delivered-${shipment._id}` });
    return res.json({ success: true, data: shipment, shipment });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    return res.status(500).json({ success: false, message: "Unable to confirm fallback delivery." });
  } finally { await session.endSession(); }
};
exports.assignRider = async (req, res) => {
  const shipment = await Shipment.findById(req.params.id); const rider = await User.findOne({ _id: req.body.riderId, role: "DELIVERY_RIDER", status: "ACTIVE" });
  if (!shipment || !rider || !branchAllowed(req.user, shipment.destinationBranchId) || String(rider.branchId) !== String(shipment.destinationBranchId)) return res.status(400).json({ success: false, message: "Valid destination-branch shipment and rider are required." });
  if (shipment.status !== "DESTINATION_HUB_VERIFIED") return res.status(409).json({ success: false, message: "Shipment must be destination-hub verified before rider assignment." });
  shipment.assignedRiderId = rider._id; await recordStatus(shipment, "OUT_FOR_DELIVERY", req, { note: "Last-mile rider assigned", publicVisible: true });
  res.json({ success: true, shipment });
};
exports.riderShipment = async (req, res) => { const shipments = await Shipment.find({ assignedRiderId: req.user._id, status: { $in: ["OUT_FOR_DELIVERY", "DELIVERY_ATTEMPTED"] } }).select("trackingNumber receiver.name receiver.phone receiver.address parcel.description parcel.fragile status").lean(); const deliveries = shipments.map((shipment) => ({ ...shipment, receiverName: shipment.receiver?.name || "", receiverPhone: shipment.receiver?.phone || "", deliveryAddress: shipment.receiver?.address || "" })); res.json({ success: true, data: { deliveries, shipments: deliveries }, deliveries, shipments: deliveries }); };
exports.sendOtp = async (req, res) => {
  const shipment = await Shipment.findOne({ _id: req.params.id, assignedRiderId: req.user._id, status: "OUT_FOR_DELIVERY" });
  if (!shipment) return res.status(404).json({ success: false, message: "Assigned shipment not found." });
  const prior = await Otp.findOne({ shipmentId: shipment._id }).select("+otpHash");
  if (prior && prior.lastSentAt > new Date(Date.now() - 60 * 1000)) return res.status(429).json({ success: false, code: "OTP_RESEND_COOLDOWN", message: "Please wait before requesting another delivery OTP." });
  if (prior && prior.attempts >= prior.maxAttempts) return res.status(429).json({ success: false, code: "OTP_ATTEMPTS_LOCKED", message: "Delivery OTP verification is locked." });
  const code = String(crypto.randomInt(100000, 1000000));
  const delivery = await sendDeliveryOtp({ phone: shipment.receiver.phone, code });
  if (!delivery.sent) return res.status(503).json({ success: false, code: delivery.unavailable ? "OTP_DELIVERY_PROVIDER_UNAVAILABLE" : "OTP_DELIVERY_FAILED", message: "Unable to confirm delivery of the receiver OTP. No OTP was issued." });
  const pepper = String(process.env.LOGISTICS_OTP_PEPPER || "");
  const hash = crypto.createHash("sha256").update(`${code}:${pepper}`).digest("hex");
  await Otp.findOneAndUpdate({ shipmentId: shipment._id }, { otpHash: hash, expiresAt: new Date(Date.now() + 10 * 60000), attempts: prior?.attempts || 0, lastSentAt: new Date(), resendCount: (prior?.resendCount || 0) + 1, providerMessageId: delivery.providerMessageId, verifiedAt: null }, { upsert: true });
  await Notification.create({ userId: shipment.customerId, title: "Delivery OTP sent", message: `A delivery verification code was sent for ${shipment.trackingNumber}.`, type: "DELIVERY", action: "DELIVERY", referenceId: shipment._id, referenceType: "INTERSTATE_SHIPMENT", reference: shipment.trackingNumber, relatedStatus: shipment.status, dedupeKey: `interstate-otp-${shipment._id}-${Date.now()}` });
  res.json({ success: true, message: "Delivery OTP was sent to the receiver." });
};
exports.verifyDelivery = async (req, res) => {
  const shipment = await Shipment.findOne({ _id: req.params.id, assignedRiderId: req.user._id, status: "OUT_FOR_DELIVERY" });
  const otp = await Otp.findOne({ shipmentId: req.params.id }).select("+otpHash");
  const value = String(req.body.otp || ""); if (!shipment || !otp) return res.status(404).json({ success: false, message: "Delivery OTP is unavailable." });
  if (otp.expiresAt < new Date() || otp.attempts >= otp.maxAttempts) return res.status(400).json({ success: false, message: "Delivery OTP has expired or is locked." });
  const pepper = String(process.env.LOGISTICS_OTP_PEPPER || "");
  if (crypto.createHash("sha256").update(`${value}:${pepper}`).digest("hex") !== otp.otpHash) { otp.attempts += 1; await otp.save(); return res.status(400).json({ success: false, message: "Invalid delivery OTP." }); }
  otp.verifiedAt = new Date(); await otp.save(); await recordStatus(shipment, "DELIVERED", req, { note: "Receiver OTP verified" }); res.json({ success: true, shipment });
};
const routeFields = [
  "name", "originState", "originBranchId", "destinationState",
  "destinationBranchId", "distanceKm", "baseFare", "minimumWeightKg",
  "maximumWeightKg", "pricePerAdditionalKg", "expressEnabled",
  "expressSurcharge", "fragileItemSurcharge", "pickupFee", "doorDeliveryFee", "branchCollectionFee",
  "protectionEnabled", "protectionPercent", "protectionFlatFee",
  "standardDeliveryTime", "expressDeliveryTime", "notes", "status",
];
const picked = (body, fields) => Object.fromEntries(
  fields.filter((field) => Object.prototype.hasOwnProperty.call(body || {}, field))
    .map((field) => [field, body[field]]),
);
const validateRouteBranches = async (input) => {
  if (String(input.originBranchId) === String(input.destinationBranchId)) {
    throw new Error("Origin and destination branches must be different.");
  }
  const branches = await Branch.find({
    _id: { $in: [input.originBranchId, input.destinationBranchId] },
    status: "ACTIVE",
  }).select("_id state");
  if (branches.length !== 2) throw new Error("Both branches must be active.");
  const byId = Object.fromEntries(branches.map((branch) => [String(branch._id), branch]));
  if (String(byId[input.originBranchId]?.state || "").toUpperCase() !== String(input.originState || "").toUpperCase()) {
    throw new Error("Origin state must match the selected origin branch.");
  }
  if (String(byId[input.destinationBranchId]?.state || "").toUpperCase() !== String(input.destinationState || "").toUpperCase()) {
    throw new Error("Destination state must match the selected destination branch.");
  }
};
exports.adminRoutes = async (req, res) => {
  const routes = await LogisticsRoute.find().populate("originBranchId", "name code state").populate("destinationBranchId", "name code state").sort({ createdAt: -1 });
  res.json({ success: true, routes });
};
exports.adminBranches = async (req, res) => {
  const branches = await Branch.find({ status: "ACTIVE" }).select("_id name code state lga").sort({ state: 1, name: 1 });
  res.json({ success: true, branches });
};
exports.createRoute = async (req, res) => {
  try {
    const input = picked(req.body, routeFields);
    await validateRouteBranches(input);
    if (Number(input.maximumWeightKg) < Number(input.minimumWeightKg || 0)) throw new Error("Maximum weight must be at least the included weight.");
    const route = await LogisticsRoute.create({ ...input, createdBy: req.user._id });
    res.status(201).json({ success: true, route });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};
exports.updateRoute = async (req, res) => {
  try {
    const existing = await LogisticsRoute.findById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: "Route not found." });
    const input = picked(req.body, routeFields);
    await validateRouteBranches({ ...existing.toObject(), ...input });
    if (Number(input.maximumWeightKg ?? existing.maximumWeightKg) < Number(input.minimumWeightKg ?? existing.minimumWeightKg)) throw new Error("Maximum weight must be at least the included weight.");
    const route = await LogisticsRoute.findByIdAndUpdate(req.params.id, { ...input, updatedBy: req.user._id }, { new: true, runValidators: true });
    res.json({ success: true, route });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};
exports.adminShipments = async (req, res) => { const q = req.query; const filter = {}; if (q.status) filter.status = String(q.status).toUpperCase(); if (q.originBranchId) filter.originBranchId = q.originBranchId; if (q.destinationBranchId) filter.destinationBranchId = q.destinationBranchId; if (q.search) filter.$or = ["trackingNumber", "sender.name", "sender.phone", "receiver.name", "receiver.phone"].map((field) => ({ [field]: { $regex: q.search, $options: "i" } })); const shipments = await Shipment.find(filter).sort({ createdAt: -1 }); res.json({ success: true, shipments }); };
exports.createDriver = async (req, res) => { try { res.status(201).json({ success: true, driver: await TransportDriver.create({ ...picked(req.body, ["userId", "name", "phone", "driverCode", "assignedBranchId", "status"]), createdBy: req.user._id }) }); } catch (e) { res.status(400).json({ success: false, message: e.message }); } };
exports.updateDriver = async (req, res) => { try { const driver = await TransportDriver.findByIdAndUpdate(req.params.id, { ...picked(req.body, ["userId", "name", "phone", "driverCode", "assignedBranchId", "status"]) }, { new: true, runValidators: true }); if (!driver) return res.status(404).json({ success: false, message: "Driver not found." }); res.json({ success: true, driver }); } catch (e) { res.status(400).json({ success: false, message: e.message }); } };
exports.deleteDriver = async (req, res) => { const driver = await TransportDriver.findByIdAndUpdate(req.params.id, { status: "INACTIVE" }, { new: true }); if (!driver) return res.status(404).json({ success: false, message: "Driver not found." }); res.json({ success: true, driver, message: "Driver marked inactive." }); };
exports.createVehicle = async (req, res) => { try { res.status(201).json({ success: true, vehicle: await TransportVehicle.create({ ...picked(req.body, ["vehicleType", "registrationNumber", "capacityKg", "assignedBranchId", "status"]), createdBy: req.user._id }) }); } catch (e) { res.status(400).json({ success: false, message: e.message }); } };
exports.updateVehicle = async (req, res) => { try { const vehicle = await TransportVehicle.findByIdAndUpdate(req.params.id, { ...picked(req.body, ["vehicleType", "registrationNumber", "capacityKg", "assignedBranchId", "status"]) }, { new: true, runValidators: true }); if (!vehicle) return res.status(404).json({ success: false, message: "Vehicle not found." }); res.json({ success: true, vehicle }); } catch (e) { res.status(400).json({ success: false, message: e.message }); } };
exports.deleteVehicle = async (req, res) => { const vehicle = await TransportVehicle.findByIdAndUpdate(req.params.id, { status: "INACTIVE" }, { new: true }); if (!vehicle) return res.status(404).json({ success: false, message: "Vehicle not found." }); res.json({ success: true, vehicle, message: "Vehicle marked inactive." }); };
exports.createTrip = async (req, res) => {
  try {
    const b = req.body;
    const route = await LogisticsRoute.findOne({ _id: b.routeId, status: "ACTIVE" });
    if (!route) return res.status(400).json({ success: false, message: "An active Interstate route is required." });
    const driver = await TransportDriver.findOne({ _id: b.driverId, status: "ACTIVE" }); const vehicle = await TransportVehicle.findOne({ _id: b.vehicleId, status: "ACTIVE" });
    if (!driver || !vehicle) return res.status(400).json({ success: false, message: "Active driver and vehicle are required." });
    const shipmentIds = Array.isArray(b.shipmentIds) ? b.shipmentIds : [];
    if (!shipmentIds.length) return res.status(400).json({ success: false, message: "Select at least one eligible shipment." });
    const shipments = await Shipment.find({ _id: { $in: shipmentIds }, routeId: route._id, originBranchId: route.originBranchId, destinationBranchId: route.destinationBranchId, status: "READY_FOR_INTERSTATE_DISPATCH", transportTripId: null });
    if (shipments.length !== shipmentIds.length) return res.status(400).json({ success: false, message: "Every trip shipment must be ready for dispatch on this route." });
    const trip = await TransportTrip.create({ routeId: route._id, originBranchId: route.originBranchId, destinationBranchId: route.destinationBranchId, driverId: driver._id, vehicleId: vehicle._id, departureAt: b.departureAt, expectedArrivalAt: b.expectedArrivalAt, tripCode: b.tripCode || `TRP-${crypto.randomBytes(5).toString("hex").toUpperCase()}`, shipmentIds, createdBy: req.user._id });
    await Shipment.updateMany({ _id: { $in: shipmentIds } }, { $set: { transportTripId: trip._id } }); res.status(201).json({ success: true, trip });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};
exports.listTrips = async (req, res) => { res.json({ success: true, trips: await TransportTrip.find().populate("routeId", "name originState destinationState").populate("driverId", "name phone driverCode").populate("vehicleId", "registrationNumber vehicleType").sort({ departureAt: -1 }) }); };
exports.updateTripStatus = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const status = String(req.body.status || "").toUpperCase();
    const trip = await TransportTrip.findById(req.params.id).session(session);
    const valid = { PLANNED: ["LOADING", "CANCELLED"], LOADING: ["DEPARTED", "CANCELLED"], DEPARTED: ["IN_TRANSIT", "ARRIVED"], IN_TRANSIT: ["ARRIVED"], ARRIVED: ["COMPLETED"] };
    if (!trip) return res.status(404).json({ success: false, message: "Trip not found." });
    if (!(valid[trip.status] || []).includes(status)) return res.status(409).json({ success: false, message: "Invalid trip lifecycle transition." });
    session.startTransaction(); trip.status = status; await trip.save({ session });
    const shipmentStatus = ["DEPARTED", "IN_TRANSIT"].includes(status) ? "IN_TRANSIT" : status === "ARRIVED" ? "ARRIVED_AT_DESTINATION_HUB" : null;
    if (shipmentStatus) {
      await Shipment.updateMany({ _id: { $in: trip.shipmentIds }, transportTripId: trip._id }, { $set: { status: shipmentStatus } }, { session });
      const history = trip.shipmentIds.map((shipmentId) => ({
        shipmentId,
        status: shipmentStatus,
        actorId: req.user._id,
        actorRole: req.user.role,
        branchId: status === "ARRIVED" ? trip.destinationBranchId : trip.originBranchId,
        note: `Trip ${trip.tripCode} ${status.toLowerCase().replace("_", " ")}`,
      }));
      await History.insertMany(history, { session });
    }
    await session.commitTransaction(); return res.json({ success: true, data: trip, trip });
  } catch (e) { if (session.inTransaction()) await session.abortTransaction(); return res.status(400).json({ success: false, message: e.message }); } finally { session.endSession(); }
};
exports.myDriverTrips = async (req, res) => { const driver = await TransportDriver.findOne({ userId: req.user._id, status: "ACTIVE" }); if (!driver) return res.status(403).json({ success: false, message: "No active transport driver profile is assigned to this account." }); const trips = await TransportTrip.find({ driverId: driver._id, status: { $in: ["PLANNED", "LOADING", "DEPARTED", "IN_TRANSIT", "ARRIVED"] } }).select("-shipmentIds").sort({ departureAt: 1 }); res.json({ success: true, data: { trips }, trips }); };
exports.listDrivers = async (req, res) => { const drivers = await TransportDriver.find().sort({ createdAt: -1 }); res.json({ success: true, data: { drivers }, drivers }); };
exports.listVehicles = async (req, res) => { const vehicles = await TransportVehicle.find().sort({ createdAt: -1 }); res.json({ success: true, data: { vehicles }, vehicles }); };
exports.adminOverview = async (req, res) => {
  const total = await Shipment.countDocuments(); const today = new Date(); today.setHours(0, 0, 0, 0);
  const rows = await Shipment.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]); const s = Object.fromEntries(rows.map((row) => [row._id, row.count]));
  const overview = { totalShipments: total, todayShipments: await Shipment.countDocuments({ createdAt: { $gte: today } }), activeShipments: total - (s.DELIVERED || 0) - (s.CANCELLED || 0) - (s.RETURNED || 0), inTransit: s.IN_TRANSIT || 0, delivered: s.DELIVERED || 0, failed: (s.FAILED_DELIVERY || 0) + (s.DELIVERY_ATTEMPTED || 0), returned: s.RETURNED || 0, pendingPickup: s.AWAITING_PICKUP || 0, pendingHubVerification: (s.RECEIVED_AT_ORIGIN_HUB || 0) + (s.ARRIVED_AT_DESTINATION_HUB || 0) };
  res.json({ success: true, data: overview, overview });
};
exports.adminExceptions = async (req, res) => { const exceptions = await Shipment.find({ status: { $in: ["DELIVERY_ATTEMPTED", "FAILED_DELIVERY", "RETURN_INITIATED"] } }).sort({ updatedAt: -1 }); res.json({ success: true, data: { exceptions }, exceptions }); };
exports.adminReturns = async (req, res) => { const returns = await Shipment.find({ status: { $in: ["RETURN_INITIATED", "RETURN_IN_TRANSIT", "RETURNED"] } }).sort({ updatedAt: -1 }); res.json({ success: true, data: { returns }, returns }); };