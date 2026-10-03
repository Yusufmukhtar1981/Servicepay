const mongoose = require("mongoose");
const crypto = require("crypto");
const Shipment = require("../models/interstateShipment.model");
const User = require("../models/user.model");
const Branch = require("../models/branch.model");
const History = require("../models/shipmentStatusHistory.model");
const AdminAudit = require("../models/adminAuditLog.model");
const BranchAudit = require("../models/branchAuditLog.model");
const { eligibleRiderFilter, riderSummary } = require("../services/riderEligibility.service");
const { trackingNumber, receiptHtml, attemptEmail } = require("../services/interstateTracking.service");
const { calculateInterstateQuote } = require("../services/interstatePricing.service");
const { statusOptions, originStatuses } = require("../services/interstateWorkflow.service");
const Notification = require("../models/notification.model");
const { statusLabel } = require("../services/interstateTracking.service");
const Route = require("../models/logisticsRoute.model");
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const isHead = (req) => req.staffAccess?.isHeadOffice || ["HEAD_OFFICE", "HEAD_OFFICE_ADMIN", "ADMIN", "SUPER_ADMIN", "SERVICEPAY_SUPER_ADMIN"].includes(req.user?.role);
const branchScope = (req) => {
  if (isHead(req)) return null;
  const id = req.staffAccess?.scope?.type === "BRANCH" ? req.staffAccess.scope.branchId : req.user?.branchId;
  if (!id) throw fail("An authorized ServicePay office branch is required.", 403);
  return String(id);
};
const permits = (req, id) => { const scope = branchScope(req); return !scope || scope === String(id); };
const scopedShipment = async (req) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw fail("Invalid shipment reference.");
  const scope = branchScope(req);
  const s = await Shipment.findOne({ _id: req.params.id, ...(scope ? { $or: [{ originBranchId: scope }, { destinationBranchId: scope }] } : {}) });
  if (!s) throw fail("Shipment not found for your office.", 404);
  return s;
};
const snapshotParty = (party = {}) => Object.fromEntries(["name", "phone", "email", "state", "lga", "address", "landmark"].map(key => [key, String(party[key] || "").trim()]));
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const bodyInput = (body) => ({
  routeId: String(body.routeId || ""),
  customerId: body.customerId ? String(body.customerId) : null,
  sender: snapshotParty(body.sender), receiver: snapshotParty(body.receiver),
  parcel: Object.fromEntries(["category", "description", "quantity", "weightKg", "declaredValue", "dimensions", "fragile", "specialHandlingNote"].filter(key => body.parcel?.[key] !== undefined).map(key => [key, body.parcel[key]])),
  pickupMethod: "BRANCH_DROP_OFF", deliveryMethod: body.deliveryMethod || "DOOR_DELIVERY",
  serviceType: body.serviceType || "STANDARD", protection: body.protection === true,
});
const resolveQuote = async (req, input, session) => {
  if (!mongoose.isValidObjectId(input.routeId)) throw fail("Select an active configured route.");
  const route = await Route.findOne({ _id: input.routeId, status: "ACTIVE", isArchived: { $ne: true } }).session(session || null);
  if (!route) throw fail("This Interstate route is unavailable.", 409);
  if (!permits(req, route.originBranchId)) throw fail("Only the route origin office may register this parcel.", 403);
  const branches = await Branch.find({ _id: { $in: [route.originBranchId, route.destinationBranchId] }, status: "ACTIVE" }).session(session || null);
  if (branches.length !== 2) throw fail("Both route offices must be active.", 409);
  for (const [party, state] of [[input.sender, route.originState], [input.receiver, route.destinationState]]) {
    if (!party.name || !/^[+\d ()-]{7,24}$/.test(party.phone) || !party.address || !party.lga) throw fail("Complete sender and receiver names, phone numbers, addresses and LGAs.");
    if (party.state.toUpperCase() !== String(state).toUpperCase()) throw fail("Sender and receiver states must match the configured route.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.sender.email)) throw fail("A valid sender email is required for shipment tracking.");
  if (!input.parcel.description || !Number.isInteger(Number(input.parcel.quantity)) || Number(input.parcel.quantity) < 1) throw fail("Complete parcel description and quantity.");
  const quote = calculateInterstateQuote(route, { ...input, ...input.parcel });
  if (!Number.isFinite(quote.total) || quote.total < 0) throw fail("The configured charge is invalid.");
  const supplied = req.body.amount ?? req.body.deliveryCharge;
  if (supplied !== undefined && Number(supplied) !== quote.total) throw fail("Delivery charge must match the approved route quote.");
  return { route, quote, office: branches.find(b => String(b._id) === String(route.originBranchId)) };
};
const errorResponse = (res, error) => res.status(error.status || (error.name === "ValidationError" ? 400 : 500)).json({ success: false, message: error.status || error.name === "ValidationError" ? error.message : "Unable to complete the Interstate operation." });
const withErrors = (handler) => async (req, res) => { try { return await handler(req, res); } catch (error) { return errorResponse(res, error); } };
const reply = (res, s, idempotent = false) => res.status(idempotent ? 200 : 201).json({
  success: true, idempotent, shipment: s, data: s,
  receipt: { url: `/api/admin/logistics/interstate/shipments/${s._id}/receipt` },
});
const auditEntry = async (req, s, action, session, reason) => {
  if (isHead(req)) await AdminAudit.create([{ actorId: req.user._id, actorRole: req.user.role, actorName: req.user.fullName || "", action, reason, metadata: { shipmentId: s._id, trackingNumber: s.trackingNumber } }], { session });
  else await BranchAudit.create([{ branchId: req.user.branchId, actorId: req.user._id, action, reason, metadata: { shipmentId: s._id, trackingNumber: s.trackingNumber } }], { session });
};
exports.officeQuote = withErrors(async (req, res) => { const { route, quote } = await resolveQuote(req, bodyInput(req.body)); res.json({ success: true, routeId: route._id, quote }); });
exports.customers = withErrors(async (req, res) => {
  branchScope(req);
  const term = String(req.query.search || "").trim().slice(0, 80);
  if (term.length < 2) return res.json({ success: true, customers: [] });
  const regex = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const customers = await User.find({ role: "CUSTOMER", status: "ACTIVE", $or: [{ phone: { $regex: `^${regex}`, $options: "i" } }, { email: { $regex: `^${regex}`, $options: "i" } }, { fullName: { $regex: `^${regex}`, $options: "i" } }] }).select("_id fullName phone email").limit(20).lean();
  res.json({ success: true, customers });
});
exports.routes = withErrors(async (req, res) => {
  const scope = branchScope(req);
  const routes = await Route.find({
    status: "ACTIVE", isArchived: { $ne: true },
    ...(scope ? { originBranchId: scope } : {}),
  }).sort({ name: 1 }).limit(100).lean();
  res.json({ success: true, routes });
});
exports.create = withErrors(async (req, res) => {
  branchScope(req);
  if (req.body.prohibitedItemsAcknowledged !== true) throw fail("Confirm the prohibited-items declaration.");
  const input = bodyInput(req.body);
  const key = String(req.get("Idempotency-Key") || req.body.idempotencyKey || "").trim();
  if (!/^[A-Za-z0-9:_.-]{8,100}$/.test(key)) throw fail("A valid persisted creation request key is required.");
  const officeIdempotencyKey = `office:${req.user._id}:${key}`;
  const officeFingerprint = crypto.createHash("sha256").update(JSON.stringify(canonical(input))).digest("hex");
  const existing = await Shipment.findOne({ officeIdempotencyKey }).select("+officeFingerprint");
  if (existing) {
    if (existing.officeFingerprint !== officeFingerprint) throw fail("This request key belongs to a different parcel.", 409);
    if (!permits(req, existing.originBranchId)) throw fail("Shipment belongs to a different office.", 403);
    existing.officeFingerprint = undefined;
    return reply(res, existing, true);
  }
  const session = await mongoose.startSession();
  let s;
  try {
    await session.withTransaction(async () => {
      const { route, quote, office } = await resolveQuote(req, input, session);
      let customer;
      if (input.customerId) {
        if (!mongoose.isValidObjectId(input.customerId)) throw fail("Select a valid existing customer.");
        customer = await User.findOne({ _id: input.customerId, role: "CUSTOMER", status: "ACTIVE" }).select("email phone fullName").session(session);
        if (!customer || customer.email?.toLowerCase() !== input.sender.email.toLowerCase() || String(customer.phone) !== input.sender.phone) throw fail("Sender details must match the selected ServicePay customer.");
      } else {
        const matches = await User.find({ role: "CUSTOMER", status: "ACTIVE", $or: [{ email: input.sender.email.toLowerCase() }, { phone: input.sender.phone }] }).select("email phone").limit(2).session(session);
        if (matches.length > 1 || (matches.length === 1 && (matches[0].email?.toLowerCase() !== input.sender.email.toLowerCase() || String(matches[0].phone) !== input.sender.phone))) throw fail("Select the existing customer and use their saved email and phone.");
        customer = matches[0];
      }
      const admitted = await Route.updateOne({ _id: route._id, status: "ACTIVE", isArchived: { $ne: true }, updatedAt: route.updatedAt }, { $inc: { shipmentAdmissionVersion: 1 } }, { session, timestamps: false });
      if (admitted.modifiedCount !== 1) throw fail("Route changed; recalculate the office quote.", 409);
      [s] = await Shipment.create([{
        ...input, customerId: customer?._id, creationChannel: "OFFICE", orderType: "INTERSTATE",
        createdBy: req.user._id, officeName: office.name || office.branchName || String(office._id),
        routeId: route._id, originBranchId: route.originBranchId, destinationBranchId: route.destinationBranchId,
        quote: { ...quote, routeVersion: String(route.updatedAt.getTime()) },
        trackingNumber: trackingNumber(), orderReference: `INTERSTATE-${crypto.randomUUID().toUpperCase()}`,
        officeIdempotencyKey, officeFingerprint, status: "RECEIVED_AT_ORIGIN_HUB", paymentStatus: "UNPAID",
        trackingEmail: { recipient: input.sender.email, status: "PENDING", nextAttemptAt: new Date() },
      }], { session });
      await History.create([{ shipmentId: s._id, status: s.status, actorId: req.user._id, actorRole: req.user.role, branchId: route.originBranchId, note: "Parcel received and registered at ServicePay office", publicVisible: true }], { session });
      await auditEntry(req, s, "INTERSTATE_OFFICE_CREATED", session, "Office received parcel; no rider prerequisite or wallet debit.");
    });
  } catch (error) {
    if (error.code === 11000) {
      const prior = await Shipment.findOne({ officeIdempotencyKey }).select("+officeFingerprint");
      if (prior && prior.officeFingerprint === officeFingerprint) { prior.officeFingerprint = undefined; return reply(res, prior, true); }
    }
    throw error;
  } finally { await session.endSession(); }
  s.officeIdempotencyKey = undefined;
  s.officeFingerprint = undefined;
  // Durable outbox is part of the committed shipment; mail cannot roll it back.
  void attemptEmail(s._id).catch(() => {});
  return reply(res, s);
});
exports.detail = withErrors(async (req, res) => {
  const s = await scopedShipment(req);
  const history = await History.find({ shipmentId: s._id }).sort({ createdAt: 1 }).lean();
  res.json({
    success: true, shipment: s, history, assignmentHistory: s.assignmentHistory || [],
    allowedStatusTransitions: statusOptions(s, id => permits(req, id)),
    deliveryConfirmationRequired: ["READY_FOR_COLLECTION", "OUT_FOR_DELIVERY", "DELIVERY_ATTEMPTED"].includes(s.status),
  });
});
exports.receipt = withErrors(async (req, res) => {
  const s = await scopedShipment(req);
  res.set("Cache-Control", "private, no-store").set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'");
  if (String(req.get("Accept") || "").includes("application/json")) {
    return res.json({ success: true, html: receiptHtml(s), trackingNumber: s.trackingNumber });
  }
  res.type("html").send(receiptHtml(s));
});
const legBranch = (s, leg) => leg === "ORIGIN" ? s.originBranchId : s.destinationBranchId;
exports.riders = withErrors(async (req, res) => {
  const s = await scopedShipment(req);
  const leg = String(req.query.leg || "DESTINATION").toUpperCase();
  if (!["ORIGIN", "DESTINATION"].includes(leg)) throw fail("Select an origin-hub or destination assignment.");
  if (!permits(req, legBranch(s, leg))) throw fail("Only the responsible office can assign this leg.", 403);
  const riders = await User.find(eligibleRiderFilter({ branchId: isHead(req) ? undefined : legBranch(s, leg), manual: true })).select("_id fullName riderId phone vehicleType availabilityStatus riderVerificationStatus").sort({ availabilityStatus: -1, _id: 1 }).limit(100).lean();
  res.json({ success: true, riders: riders.map(riderSummary), count: riders.length });
});
const terminal = ["DELIVERED", "CANCELLED", "RETURNED"];
exports.assign = withErrors(async (req, res) => {
  const initial = await scopedShipment(req);
  const leg = String(req.body.leg || "DESTINATION").toUpperCase();
  if (!["ORIGIN", "DESTINATION"].includes(leg) || !permits(req, legBranch(initial, leg))) throw fail("This assignment leg is not authorized for your office.", 403);
  if (!mongoose.isValidObjectId(req.body.riderId)) throw fail("Select a valid rider.");
  const allowed = leg === "ORIGIN"
    ? ["AWAITING_PICKUP", "PICKUP_ASSIGNED", "PICKED_UP", "RECEIVED_AT_ORIGIN_HUB", "VERIFIED_AT_ORIGIN_HUB", "READY_FOR_INTERSTATE_DISPATCH"]
    : ["DESTINATION_HUB_VERIFIED", "OUT_FOR_DELIVERY", "DELIVERY_ATTEMPTED"];
  const session = await mongoose.startSession();
  let s;
  try {
    await session.withTransaction(async () => {
      const current = await Shipment.findById(initial._id).session(session);
      if (!allowed.includes(current.status)) throw fail("Shipment is not ready for the selected rider leg.", 409);
      const rider = await User.findOne(eligibleRiderFilter({ riderId: req.body.riderId, branchId: isHead(req) ? undefined : legBranch(current, leg), manual: true })).session(session);
      if (!rider) throw fail("Select a verified, active eligible rider belonging to this office.", 409);
      if (String(current.assignedRiderId) === String(rider._id) && (current.assignmentLeg || "DESTINATION") === leg) { s = current; return; }
      const status = leg === "DESTINATION" ? "OUT_FOR_DELIVERY" : ["AWAITING_PICKUP", "RECEIVED_AT_ORIGIN_HUB"].includes(current.status) ? "PICKUP_ASSIGNED" : current.status;
      s = await Shipment.findOneAndUpdate({ _id: current._id, status: current.status, assignedRiderId: current.assignedRiderId }, {
        $set: { assignedRiderId: rider._id, assignmentLeg: leg, status },
        $push: { assignmentHistory: { riderId: rider._id, previousRiderId: current.assignedRiderId, actorId: req.user._id, leg, assignedAt: new Date() } },
      }, { new: true, runValidators: true, session });
      if (!s) throw fail("Assignment changed. Reload the shipment and retry.", 409);
      await History.create([{ shipmentId: s._id, status: s.status, actorId: req.user._id, actorRole: req.user.role, branchId: legBranch(s, leg), note: current.assignedRiderId ? "Rider reassigned" : "Rider assigned", publicVisible: true }], { session });
      await auditEntry(req, s, current.assignedRiderId ? "INTERSTATE_RIDER_REASSIGNED" : "INTERSTATE_RIDER_ASSIGNED", session, `Verified active rider assigned to ${leg} leg.`);
    });
  } finally { await session.endSession(); }
  res.json({ success: true, shipment: s, data: s });
});
exports.riderList = withErrors(async (req, res) => {
  const shipments = await Shipment.find({ assignedRiderId: req.user._id, status: { $nin: terminal } }).select("-officeFingerprint -officeIdempotencyKey -trackingEmail -sender.email").sort({ createdAt: -1 }).limit(100).lean();
  res.json({ success: true, shipments, deliveries: shipments, data: { shipments, deliveries: shipments } });
});
exports.riderDetail = withErrors(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw fail("Invalid shipment reference.");
  const s = await Shipment.findOne({ _id: req.params.id, assignedRiderId: req.user._id, status: { $nin: terminal } }).select("-officeFingerprint -officeIdempotencyKey -trackingEmail -sender.email").lean();
  if (!s) throw fail("Active assigned shipment not found.", 404);
  const history = await History.find({ shipmentId: s._id, publicVisible: true }).select("status locationText note createdAt").sort({ createdAt: 1 }).lean();
  res.json({ success: true, shipment: s, history });
});
exports.riderStatus = withErrors(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw fail("Invalid shipment reference.");
  const status = String(req.body.status || "").toUpperCase();
  const session = await mongoose.startSession();
  let s;
  try {
    await session.withTransaction(async () => {
      const current = await Shipment.findOne({ _id: req.params.id, assignedRiderId: req.user._id, status: { $nin: terminal } }).session(session);
      if (!current) throw fail("Active assigned shipment not found.", 404);
      const leg = current.assignmentLeg || "DESTINATION";
      const allowed = leg === "ORIGIN" ? {
        PICKUP_ASSIGNED: ["PICKED_UP"],
        RECEIVED_AT_ORIGIN_HUB: ["PICKED_UP"],
        PICKED_UP: ["RECEIVED_AT_ORIGIN_HUB"],
      } : { OUT_FOR_DELIVERY: ["DELIVERY_ATTEMPTED"] };
      if (!(allowed[current.status] || []).includes(status)) throw fail("Invalid rider status transition; office verification and delivery OTP remain required.", 409);
      s = await Shipment.findOneAndUpdate({ _id: current._id, assignedRiderId: req.user._id, status: current.status }, {
        $set: { status }, ...(status === "RECEIVED_AT_ORIGIN_HUB" ? { $unset: { assignedRiderId: 1, assignmentLeg: 1 } } : {}),
      }, { new: true, session, runValidators: true });
      if (!s) throw fail("Assignment changed; reload before updating.", 409);
      await History.create([{ shipmentId: s._id, status, actorId: req.user._id, actorRole: req.user.role, branchId: legBranch(s, leg), note: "Assigned rider updated shipment", publicVisible: true }], { session });
    });
  } finally { await session.endSession(); }
  res.json({ success: true, shipment: s });
});

exports.status = withErrors(async (req, res) => {
  // Preserve the established weight-adjustment accounting path.
  if (req.body.verifiedWeightKg !== undefined) {
    return require("./interstateLogistics.controller").branchStatus(req, res);
  }
  const initial = await scopedShipment(req);
  const next = String(req.body.status || "").toUpperCase();
  if (!statusOptions(initial).some(option => option.status === next)) throw fail("Invalid shipment status transition. Delivered requires receiver OTP or the existing audited fallback; paid cancellation requires the refund workflow.", 409);
  const origin = originStatuses.has(next);
  if (!permits(req, origin ? initial.originBranchId : initial.destinationBranchId)) throw fail("This status belongs to the other office.", 403);
  const session = await mongoose.startSession();
  let s;
  try {
    await session.withTransaction(async () => {
      s = await Shipment.findOneAndUpdate({ _id: initial._id, status: initial.status, assignedRiderId: initial.assignedRiderId }, {
        $set: { status: next, ...(next === "CANCELLED" ? { cancelledAt: new Date() } : {}) },
        ...(["RECEIVED_AT_ORIGIN_HUB", "IN_TRANSIT", "READY_FOR_COLLECTION", "RETURNED", "CANCELLED"].includes(next) ? { $unset: { assignedRiderId: 1, assignmentLeg: 1 } } : {}),
      }, { new: true, session, runValidators: true });
      if (!s) throw fail("Shipment changed. Reload and retry.", 409);
      await History.create([{ shipmentId: s._id, status: next, actorId: req.user._id, actorRole: req.user.role, branchId: origin ? s.originBranchId : s.destinationBranchId, note: "Authorized office status update", publicVisible: true }], { session });
      await auditEntry(req, s, "INTERSTATE_STATUS_UPDATED", session, `Status changed to ${next}`);
      if (s.customerId) await Notification.create([{
        userId: s.customerId, type: "DELIVERY", category: "OTHER",
        title: "Interstate shipment update",
        message: `Shipment ${s.trackingNumber}: ${statusLabel(next)}.`,
        referenceId: s._id, referenceType: "INTERSTATE_SHIPMENT",
        reference: s.trackingNumber, relatedStatus: next,
      }], { session });
    });
  } finally { await session.endSession(); }
  res.json({ success: true, shipment: s, allowedStatusTransitions: statusOptions(s, id => permits(req, id)) });
});