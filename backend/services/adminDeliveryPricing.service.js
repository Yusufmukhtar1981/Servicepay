const mongoose = require("mongoose");
const Settings = require("../models/appSettings.model");
const Route = require("../models/logisticsRoute.model");
const Branch = require("../models/branch.model");
const Audit = require("../models/adminAuditLog.model");
const Shipment = require("../models/interstateShipment.model");
const Quote = require("../models/logisticsQuote.model");
const Trip = require("../models/transportTrip.model");
const pricing = require("./deliveryPricing.service");

const fail = pricing.fail;
let indexPromise;
async function ensureDirectionIndex() {
  if (!indexPromise) {
    indexPromise = Route.collection.createIndex(
      { originState: 1, destinationState: 1 },
      { name: "active_directional_state_route", unique: true,
        partialFilterExpression: { status: "ACTIVE", isArchived: false } }
    ).catch(error => { indexPromise = null; throw error; });
  }
  await indexPromise;
}
function confirmed(body) {
  if (body.confirmed !== true) throw fail("Confirm this price or route change before applying it.", 400, "CONFIRMATION_REQUIRED");
}
async function atomic(work) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await work(session); });
    return result;
  } finally { await session.endSession(); }
}
async function audit(req, operation, previous, next, session) {
  const route = next?.originState ? next : previous?.originState ? previous : null;
  await Audit.create([{
    actorId: req.user._id, actorRole: req.user.role,
    actorName: req.user.fullName || req.user.name || "",
    action: "FINTECH_OPERATION", reason: `Confirmed Delivery Pricing operation: ${operation}`,
    previousData: previous, newData: next,
    metadata: { category: "DELIVERY_PRICING", operation,
      routeId: route?._id ? String(route._id) : null,
      originState: route?.originState || null, destinationState: route?.destinationState || null,
      oldPrice: previous?.baseFare ?? previous?.price ?? null,
      newPrice: next?.baseFare ?? next?.price ?? null },
  }], { session });
}
function stale(route, body) {
  if (body.expectedUpdatedAt !== undefined &&
      new Date(body.expectedUpdatedAt).getTime() !== new Date(route.updatedAt).getTime()) {
    throw fail("This route changed. Refresh before editing it.", 409, "PRICE_CONFLICT");
  }
}
async function overview() {
  const [intraState, routes, branches, auditRows] = await Promise.all([
    pricing.intraState(),
    Route.find({ isArchived: { $ne: true } }).sort({ originState: 1, destinationState: 1 }).lean(),
    Branch.find({ status: "ACTIVE" }).select("_id name code state").sort({ state: 1, name: 1 }).lean(),
    Audit.find({ "metadata.category": "DELIVERY_PRICING" })
      .select("actorName actorRole createdAt metadata").sort({ createdAt: -1 }).limit(100).lean(),
  ]);
  return { intraState, routes, branches, audit: auditRows,
    summary: { activeRoutes: routes.filter(r => r.status === "ACTIVE").length,
      inactiveRoutes: routes.filter(r => r.status !== "ACTIVE").length } };
}
async function changeIntraState(req) {
  confirmed(req.body);
  const price = pricing.validPrice(req.body.price);
  if (!Number.isSafeInteger(req.body.expectedVersion) || req.body.expectedVersion < 0)
    throw fail("Refresh the current delivery price before editing it.", 400, "PRICE_VERSION_REQUIRED");
  return atomic(async session => {
    const settings = await Settings.findOne({ key: "GLOBAL_SETTINGS" }).session(session);
    if (!settings) throw fail("Company settings must be initialized before changing delivery prices.", 503, "SETTINGS_NOT_INITIALIZED");
    const previous = await pricing.intraState(session);
    if (previous.version !== req.body.expectedVersion) throw fail("Delivery pricing changed. Refresh before editing.", 409, "PRICE_CONFLICT");
    if (previous.price === price) return previous;
    const next = { price, version: previous.version + 1, updatedAt: new Date(), updatedBy: req.user._id };
    const filter = settings.deliveryPricing ?
      { _id: settings._id, "deliveryPricing.version": previous.version } :
      { _id: settings._id, "deliveryPricing.version": { $exists: false } };
    const updated = await Settings.findOneAndUpdate(filter, { $set: { deliveryPricing: next } },
      { new: true, session, runValidators: true });
    if (!updated) throw fail("Delivery pricing changed. Refresh before editing.", 409, "PRICE_CONFLICT");
    await audit(req, "INTRA_STATE_PRICE_UPDATED", previous, next, session);
    return next;
  });
}
async function createRoute(req, input) {
  if (input.pricingMode === "FIXED" || req.body.applySamePriceToReverse) confirmed(req.body);
  if (req.body.applySamePriceToReverse !== undefined && typeof req.body.applySamePriceToReverse !== "boolean")
    throw fail("Reverse-direction pricing must be ON or OFF.");
  if (input.pricingMode === "FIXED") {
    pricing.validPrice(input.baseFare);
    input.weightPricingMode = input.weightPricingMode || "LEGACY";
    if (input.originState.toUpperCase() === input.destinationState.toUpperCase())
      throw fail("Interstate pricing requires different origin and destination states.");
  }
  await ensureDirectionIndex();
  return atomic(async session => {
    const [route] = await Route.create([{ customerVisible: false, ...input,
      isArchived: false, createdBy: req.user._id }], { session });
    await audit(req, "ROUTE_CREATED", null, route.toObject(), session);
    let reverseRoute;
    if (req.body.applySamePriceToReverse) {
      [reverseRoute] = await Route.create([{ ...input,
        name: `${input.destinationState} → ${input.originState}`,
        originState: input.destinationState, destinationState: input.originState,
        originBranchId: input.destinationBranchId, destinationBranchId: input.originBranchId,
        isArchived: false, createdBy: req.user._id }], { session });
      await audit(req, "REVERSE_ROUTE_CREATED", null, reverseRoute.toObject(), session);
    }
    return { route, ...(reverseRoute ? { reverseRoute } : {}) };
  });
}
async function updateRoute(req, input) {
  if (Object.hasOwn(input, "baseFare") || Object.hasOwn(input, "pricingMode")) confirmed(req.body);
  if (input.pricingMode === "FIXED") pricing.validPrice(input.baseFare);
  await ensureDirectionIndex();
  return atomic(async session => {
    const existing = await Route.findById(req.params.id).session(session);
    if (!existing) throw fail("Route not found.", 404, "ROUTE_NOT_FOUND");
    if (existing.isArchived) throw fail("Restore this route before editing it.", 409, "ROUTE_ARCHIVED");
    stale(existing, req.body);
    const previous = existing.toObject();
    Object.assign(existing, input, { updatedBy: req.user._id });
    await existing.save({ session });
    await audit(req, "ROUTE_UPDATED", previous, existing.toObject(), session);
    return existing;
  });
}
async function status(req, status) {
  confirmed(req.body);
  await ensureDirectionIndex();
  return updateRoute(req, { status });
}
async function remove(req) {
  confirmed(req.body);
  return atomic(async session => {
    const route = await Route.findById(req.params.id).session(session);
    if (!route) throw fail("Route not found.", 404, "ROUTE_NOT_FOUND");
    stale(route, req.body);
    const references = [
      await Shipment.exists({ routeId: route._id }).session(session),
      await Quote.exists({ routeId: route._id }).session(session),
      await Trip.exists({ routeId: route._id }).session(session),
    ];
    if (references.some(Boolean)) throw fail("This route has booking or quote history. Disable it instead of deleting it.", 409, "ROUTE_IN_USE");
    // The route write conflicts with concurrent admission's route-version write.
    await Route.deleteOne({ _id: route._id }, { session });
    await audit(req, "ROUTE_DELETED", route.toObject(), null, session);
    return { deleted: true };
  });
}
module.exports = { overview, changeIntraState, createRoute, updateRoute, status, remove, ensureDirectionIndex };