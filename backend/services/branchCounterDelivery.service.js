const crypto = require("crypto");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const Delivery = require("../models/delivery.model");
const Shipment = require("../models/interstateShipment.model");
const Branch = require("../models/branch.model");
const Route = require("../models/logisticsRoute.model");
const User = require("../models/user.model");
const Audit = require("../models/branchAuditLog.model");
const History = require("../models/shipmentStatusHistory.model");
const Coverage = require("../models/deliveryCoverage.model");
const { calculateInterstateQuote } = require("./interstatePricing.service");

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const same = (a, b) => String(a) === String(b);
const state = value => String(value || "").trim().toUpperCase().replace(/[_-]+/g, " ");
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object"
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const hash = value => crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const text = (v, max = 160) => String(v || "").trim().slice(0, max);
const kinds = { DELIVERY: Delivery, INTERSTATE: Shipment };
const visibleFees = (fee, breakdown) => {
  const deliveryFee = Number.isFinite(breakdown?.transportFee) ? breakdown.transportFee : fee;
  return { deliveryFee, charges: Number((fee - deliveryFee).toFixed(2)) };
};
const branchId = req => {
  const own = req.staffAccess?.scope?.branchId || req.user.branchId;
  const requested = req.query?.branchId || req.body?.branchId;
  if (!req.staffAccess?.isHeadOffice && requested && !same(own, requested))
    throw fail("This branch is outside your authorized scope.", 403);
  const result = req.staffAccess?.isHeadOffice ? requested : own;
  if (!mongoose.isValidObjectId(result)) throw fail("Select an authorized branch.", 403);
  return result;
};
async function office(req, session = null) {
  const b = await Branch.findOne({ _id: branchId(req), status: "ACTIVE", assignedModules: "DELIVERY" }).session(session);
  if (!b) throw fail("An active branch with Delivery assigned is required.", 403);
  return b;
}
const isManager = (req, b) => req.user.role === "BRANCH_MANAGER" &&
  same(req.user.branchId, b._id) && (!b.managerId || same(b.managerId, req.user._id));
const party = p => {
  if (!p || typeof p !== "object" || Array.isArray(p)) throw fail("Complete sender and receiver information.");
  const result = Object.fromEntries(["name", "phone", "email", "address", "state", "lga"]
    .map(k => [k, text(p[k], k === "address" ? 500 : 160)]));
  if (!result.name || !/^[+\d ()-]{7,24}$/.test(result.phone) || !result.address || !result.state || !result.lga)
    throw fail("Names, phone numbers, addresses, states and cities/LGAs are required.");
  if (result.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) throw fail("Enter a valid optional email.");
  return result;
};
function draft(body) {
  if (!kinds[body.kind]) throw fail("Select intra-state Delivery or Interstate Logistics.");
  if (!["CASH", "POS", "BANK_TRANSFER", "WALLET"].includes(body.paymentMethod)) throw fail("Select an approved payment method.");
  const p = body.parcel || {};
  const parcel = { description: text(p.description, 1000), quantity: Number(p.quantity),
    category: text(p.category || "OTHER"), weightKg: Number(p.weightKg || 0),
    specialHandlingNote: text(p.specialHandlingNote, 500), declaredValue: 0 };
  const categories = Shipment.schema.path("parcel.category").enumValues;
  if (!parcel.description || !Number.isSafeInteger(parcel.quantity) || parcel.quantity < 1 ||
      parcel.quantity > 10000 || !Number.isFinite(parcel.weightKg) || parcel.weightKg < 0 ||
      !categories.includes(parcel.category)) throw fail("Enter a valid parcel description, quantity, package type and weight.");
  if (body.kind === "INTERSTATE" && parcel.weightKg <= 0) throw fail("Interstate pricing requires the parcel weight.");
  if (body.customerId && !mongoose.isValidObjectId(body.customerId)) throw fail("Invalid linked customer.");
  return { kind: body.kind, sender: party(body.sender), receiver: party(body.receiver), parcel,
    routeId: body.kind === "INTERSTATE" ? text(body.routeId) : null,
    paymentMethod: body.paymentMethod, customerId: body.customerId ? String(body.customerId) : null };
}
async function price(req, input, session = null) {
  const b = await office(req, session);
  if (state(input.sender.state) !== state(b.state)) throw fail("Origin state must match this branch.");
  let route, fee, breakdown;
  if (input.kind === "DELIVERY") {
    if (state(input.receiver.state) !== state(b.state)) throw fail("Choose Interstate Logistics for different states.");
    const live = await Coverage.findOne({ stateCode: state(b.state).replace(/ /g, "_"), isLive: true }).session(session);
    if (!live) throw fail("Delivery is not active in this state.", 409);
    fee = (await require("./deliveryPricing.service").intraState(session, { admit: Boolean(session) })).price;
    breakdown = { deliveryFee: fee };
  } else {
    if (!mongoose.isValidObjectId(input.routeId)) throw fail("Select a configured Interstate route.");
    route = await Route.findOne({ _id: input.routeId, originBranchId: b._id,
      status: "ACTIVE", isArchived: { $ne: true } }).session(session);
    if (!route || state(route.originState) !== state(input.sender.state) ||
        state(route.destinationState) !== state(input.receiver.state)) throw fail("Select an active matching route from this office.", 409);
    const destination = await Branch.findOne({ _id: route.destinationBranchId, status: "ACTIVE" }).session(session);
    if (!destination) throw fail("The destination branch is not active.", 409);
    const calculated = calculateInterstateQuote(route, { ...input.parcel,
      serviceType: "STANDARD", pickupMethod: "BRANCH_DROP_OFF", deliveryMethod: "DOOR_DELIVERY", protection: false });
    fee = calculated.total; breakdown = calculated.breakdown;
  }
  if (!Number.isFinite(fee) || fee <= 0) throw fail("Approved Delivery pricing is unavailable.", 409);
  return { b, route, fee, breakdown };
}
const tracking = kind => `SPDL-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${kind === "DELIVERY" ? "D" : "I"}${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
const audit = (req, b, action, metadata, session) => Audit.create([{
  branchId: b._id, actorId: req.user._id, action, reason: "Branch Delivery counter operation.", metadata,
}], session ? { session } : {});
function output(s, kind) {
  const c = s.counter;
  return { _id: s._id, kind, trackingNumber: s.trackingNumber, receiptNumber: s.trackingNumber,
    sender: c.sender, receiver: c.receiver, parcel: c.parcel, branch: c.branch,
    createdByName: c.createdByName, createdAt: s.createdAt,
    deliveryFee: c.deliveryFee ?? c.total, charges: c.charges || 0,
    total: kind === "DELIVERY" ? s.deliveryFee : s.quote.total,
    paymentStatus: s.paymentStatus, amountPaid: s.paymentStatus === "PAID" ? c.total : 0,
    status: s.status, payment: { ...c.payment, paidAt: s.paidAt || null },
    route: { originState: c.sender.state, originLga: c.sender.lga,
      destinationState: c.receiver.state, destinationLga: c.receiver.lga } };
}
async function scoped(req, session = null) {
  const b = await office(req, session), Model = kinds[req.params.kind];
  if (!Model || !mongoose.isValidObjectId(req.params.id)) throw fail("Invalid delivery reference.");
  const s = await Model.findOne({ _id: req.params.id, "counter.branch._id": b._id }).session(session);
  if (!s) throw fail("Branch counter order not found.", 404);
  return { b, s, Model, kind: req.params.kind };
}
async function quote(req) {
  const input = draft(req.body), { b, route, fee, breakdown } = await price(req, input);
  const quoteToken = jwt.sign({ purpose: "BRANCH_COUNTER_QUOTE", branch: String(b._id),
    actor: String(req.user._id), input: hash(input), fee,
    routeVersion: route ? String(route.updatedAt.getTime()) : null }, process.env.JWT_SECRET, { expiresIn: "15m" });
  return { ...visibleFees(fee, breakdown), total: fee, quoteToken, expiresAt: new Date(Date.now() + 900000) };
}
async function create(req) {
  const input = draft(req.body), b = await office(req);
  if (input.kind === "INTERSTATE" && req.body.prohibitedItemsAcknowledged !== true)
    throw fail("Confirm the Interstate prohibited-items declaration.");
  if (req.body.paymentStatus && req.body.paymentStatus !== "UNPAID") throw fail("Only confirmed payment workflows may mark an order paid.");
  const key = text(req.get("Idempotency-Key") || req.body.idempotencyKey, 140);
  if (!/^[A-Za-z0-9:_.-]{8,64}$/.test(key)) throw fail("A persisted creation request key of 8–64 characters is required.");
  const fullKey = `counter:${req.user._id}:${key}`, fingerprint = hash(input);
  const Model = kinds[input.kind], keyField = input.kind === "DELIVERY" ? "idempotencyKey" : "officeIdempotencyKey";
  const fingerprintField = input.kind === "DELIVERY" ? "idempotencyFingerprint" : "officeFingerprint";
  const lookup = () => Model.findOne({ [keyField]: fullKey }).select(`+${fingerprintField}`);
  const otherModel = input.kind === "DELIVERY" ? Shipment : Delivery;
  const otherKey = input.kind === "DELIVERY" ? "officeIdempotencyKey" : "idempotencyKey";
  const crossKind = session => otherModel.findOne({ [otherKey]: fullKey }).session(session || null);
  const replay = s => {
    if (!same(s.counter.branch._id, b._id)) throw fail("This pending request belongs to your previous branch. Ask authorized management to reconcile it.", 403);
    if (s[fingerprintField] !== fingerprint) throw fail("This request key belongs to a different order.", 409);
    return { order: output(s, input.kind), idempotent: true };
  };
  const prior = await lookup();
  if (prior) return replay(prior);
  if (await crossKind()) throw fail("This request key already belongs to a different delivery type.", 409);
  let verified;
  try { verified = jwt.verify(req.body.quoteToken, process.env.JWT_SECRET); }
  catch (_) { throw fail("The quote expired. Recalculate the delivery charge.", 409); }
  if (verified.purpose !== "BRANCH_COUNTER_QUOTE" || verified.branch !== String(b._id) ||
      verified.actor !== String(req.user._id) || verified.input !== fingerprint)
    throw fail("The order changed. Recalculate its quote.", 409);
  const session = await mongoose.startSession(); let s, replayResult;
  try {
    await session.withTransaction(async () => {
      const current = await price(req, input, session);
      if (current.fee !== verified.fee || (current.route &&
          String(current.route.updatedAt.getTime()) !== verified.routeVersion)) throw fail("Approved pricing changed. Recalculate the quote.", 409);
      // Lock branch/route admission against concurrent suspension/repricing.
      const lock = await Branch.updateOne({ _id: b._id, status: "ACTIVE", assignedModules: "DELIVERY" },
        { $inc: { deliveryCounterAdmissionVersion: 1 } }, { session, timestamps: false, strict: false });
      if (lock.modifiedCount !== 1) throw fail("Branch authorization changed.", 409);
      if (await crossKind(session)) throw fail("This request key already belongs to a different delivery type.", 409);
      const admittedPrior = await Model.findOne({ [keyField]: fullKey }).select(`+${fingerprintField}`).session(session);
      if (admittedPrior) { replayResult = replay(admittedPrior); return; }
      if (current.route) {
        const admission = await Route.updateOne({ _id: current.route._id, status: "ACTIVE",
          isArchived: { $ne: true }, updatedAt: current.route.updatedAt },
          { $inc: { shipmentAdmissionVersion: 1 } }, { session, timestamps: false });
        if (admission.modifiedCount !== 1) throw fail("Route changed. Recalculate the quote.", 409);
      }
      if (input.customerId) {
        const customer = await User.findOne({ _id: input.customerId, role: "CUSTOMER", status: "ACTIVE" }).session(session);
        if (!customer || String(customer.phone) !== input.sender.phone ||
            (input.sender.email && customer.email?.toLowerCase() !== input.sender.email.toLowerCase()))
          throw fail("Linked customer must match the sender's saved contact details.");
      }
      if (input.paymentMethod === "WALLET" && !input.customerId)
        throw fail("Wallet payment requires an existing linked sender account; no wallet debit has been made.");
      const counter = { sender: input.sender, receiver: input.receiver, parcel: input.parcel,
        branch: { _id: b._id, name: b.name, address: b.address }, createdBy: req.user._id,
        createdByName: req.user.fullName || "", total: current.fee,
        ...visibleFees(current.fee, current.breakdown),
        prohibitedItemsAcknowledged: input.kind === "INTERSTATE",
        payment: { method: input.paymentMethod, reference: "", note: "", recordedByName: "", approvedByName: "" } };
      const common = { customerId: input.customerId || undefined, trackingNumber: tracking(input.kind),
        counter, paymentStatus: "UNPAID", [keyField]: fullKey, [fingerprintField]: fingerprint };
      const record = input.kind === "DELIVERY" ? {
        ...common, branchId: b._id, pickupState: input.sender.state, deliveryState: input.receiver.state,
        pickupAddress: b.address || input.sender.address, deliveryAddress: input.receiver.address,
        senderName: input.sender.name, senderPhone: input.sender.phone,
        receiverName: input.receiver.name, receiverPhone: input.receiver.phone,
        packageName: input.parcel.category, packageDescription: input.parcel.description +
          (input.parcel.specialHandlingNote ? `\nHandling instructions: ${input.parcel.specialHandlingNote}` : ""),
        packageWeight: input.parcel.weightKg, deliveryFee: current.fee, pricingType: "STANDARD",
        riderCommissionType: "PERCENTAGE", riderCommissionValue: 30, status: "PENDING",
      } : {
        ...common, sender: input.sender, receiver: input.receiver, parcel: input.parcel,
        creationChannel: "OFFICE", createdBy: req.user._id, officeName: b.name,
        orderReference: common.trackingNumber, originBranchId: b._id,
        destinationBranchId: current.route.destinationBranchId, routeId: current.route._id,
        pricingSnapshot: require("./interstatePricing.service").snapshotPricing(current.route),
        pickupMethod: "BRANCH_DROP_OFF", deliveryMethod: "DOOR_DELIVERY", serviceType: "STANDARD",
        quote: { total: current.fee, breakdown: current.breakdown,
          routeVersion: verified.routeVersion }, status: "RECEIVED_AT_ORIGIN_HUB",
      };
      [s] = await Model.create([record], { session });
      if (input.kind === "INTERSTATE") await History.create([{ shipmentId: s._id, status: s.status,
        actorId: req.user._id, actorRole: req.user.role, branchId: b._id,
        note: "Parcel received at branch counter.", publicVisible: true }], { session });
      await audit(req, b, "BRANCH_DELIVERY_CREATED", { orderId: s._id, kind: input.kind }, session);
    });
    return replayResult || { order: output(s, input.kind), idempotent: false };
  } catch (e) {
    if (e.code === 11000) { const old = await lookup(); if (old) return replay(old); }
    throw e;
  } finally { await session.endSession(); }
}
async function payment(req, confirm) {
  const session = await mongoose.startSession(); let result;
  try {
    await session.withTransaction(async () => {
      const { b, s, Model, kind } = await scoped(req, session);
      if (confirm && !isManager(req, b)) throw fail("Only this branch's manager may confirm counter payments.", 403);
      if (confirm && !await User.exists({ _id: req.user._id, role: "BRANCH_MANAGER",
        branchId: b._id, status: "ACTIVE" }).session(session)) throw fail("Manager authorization is no longer active.", 403);
      if (s.counter.payment.method === "WALLET") throw fail("Wallet payment requires customer authorization in the existing payment flow.", 409);
      if (["CANCELLED", "FAILED", "RETURNED"].includes(s.status)) throw fail("This order cannot accept payment.", 409);
      if (s.paymentStatus === "PAID") { result = output(s, kind); return; }
      if (s.paymentStatus !== "UNPAID") throw fail("This payment requires financial review.", 409);
      if (Number(kind === "DELIVERY" ? s.deliveryFee : s.quote.total) !== Number(s.counter.total))
        throw fail("The verified delivery charge changed. Financial review is required before confirmation.", 409);
      const reference = text(req.body.reference, 100), note = text(req.body.note, 500);
      if (["POS", "BANK_TRANSFER"].includes(s.counter.payment.method) && !reference)
        throw fail("Record the verified POS or Bank Transfer payment reference.");
      if (confirm && req.body.confirmed !== true) throw fail("Explicitly confirm actual receipt of the full delivery charge.");
      let confirmationKey;
      if (confirm) {
        await Branch.updateOne({ _id: b._id, status: "ACTIVE" },
          { $inc: { deliveryCounterAdmissionVersion: 1 } }, { session, timestamps: false, strict: false });
        if (["POS", "BANK_TRANSFER"].includes(s.counter.payment.method)) {
          confirmationKey = crypto.createHmac("sha256", process.env.JWT_SECRET)
            .update(`${b._id}:${s.counter.payment.method}:${reference.toUpperCase()}`).digest("hex");
          if (await Audit.exists({ branchId: b._id, action: "BRANCH_DELIVERY_PAYMENT_CONFIRMED",
            "metadata.confirmationKey": confirmationKey }).session(session))
            throw fail("This payment reference was already confirmed for another branch order.", 409);
        }
      }
      const updated = { ...s.counter, payment: { ...s.counter.payment, reference, note,
        recordedBy: s.counter.payment.recordedBy || req.user._id,
        recordedByName: s.counter.payment.recordedByName || req.user.fullName || "",
        recordedAt: s.counter.payment.recordedAt || new Date(), ...(confirm ? { approvedBy: req.user._id,
          approvedByName: req.user.fullName || "", approvedAt: new Date(),
          confirmation: "MANAGER_MANUAL_CONFIRMATION", amount: s.counter.total } : {}) } };
      const commission = {};
      if (confirm && kind === "DELIVERY") {
        // Reuse the existing STANDARD split; never synthesize a wallet debit.
        s.calculateCommission();
        Object.assign(commission, { riderCommissionAmount: s.riderCommissionAmount,
          servicepayProfit: s.servicepayProfit, commissionCalculatedAt: s.commissionCalculatedAt });
      }
      const changed = await Model.findOneAndUpdate({ _id: s._id, paymentStatus: "UNPAID",
        status: s.status, updatedAt: s.updatedAt }, { $set: { counter: updated,
        ...commission, ...(confirm ? { paymentStatus: "PAID", paidAt: new Date() } : {}) } },
        { session, returnDocument: "after", runValidators: true });
      if (!changed) throw fail("Order changed; reload before recording payment.", 409);
      await audit(req, b, confirm ? "BRANCH_DELIVERY_PAYMENT_CONFIRMED" : "BRANCH_DELIVERY_PAYMENT_EVIDENCE",
        { orderId: s._id, kind, amount: s.counter.total, method: s.counter.payment.method,
          ...(confirmationKey ? { confirmationKey } : {}) }, session);
      result = output(changed, kind);
    });
    return result;
  } finally { await session.endSession(); }
}
module.exports = { fail, office, isManager, kinds, output, scoped, draft, quote, create, payment, audit };