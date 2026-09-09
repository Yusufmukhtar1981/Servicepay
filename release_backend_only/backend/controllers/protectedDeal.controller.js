const ProtectedDeal = require("../models/protectedDeal.model");
const User = require("../models/user.model");
const TrustDispute = require("../models/trustDispute.model");
const service = require("../services/protectedDeal.service");

const userId = (req) => req.user?._id || req.user?.id;
const idem = (req) => req.get?.("Idempotency-Key") || req.headers?.["idempotency-key"];
const send = (res, error, fallback) => res.status(error.status || 500).json({ success: false, message: error.status ? error.message : fallback });
const customerDispute = (dispute) => dispute ? ({
  id: String(dispute._id),
  _id: dispute._id,
  dealId: dispute.deal,
  status: dispute.status,
  reason: dispute.reason,
  details: dispute.description || "",
  resolution: dispute.resolution || "",
  createdAt: dispute.createdAt,
  resolvedAt: dispute.resolvedAt,
}) : null;
const privateDeal = (deal, viewerId, dispute = null) => ({
  id: String(deal._id), _id: deal._id, reference: deal.reference, buyerId: deal.buyer?._id || deal.buyer, sellerId: deal.seller?._id || deal.seller,
  buyer: { id: deal.buyer?._id || deal.buyer, displayName: deal.buyer?.fullName || "" }, seller: { id: deal.seller?._id || deal.seller, displayName: deal.seller?.fullName || "" }, amount: deal.amount,
  currency: deal.currency, title: deal.title, description: deal.description, status: deal.status,
  participantRole: String(deal.buyer?._id || deal.buyer) === String(viewerId) ? "BUYER" : "SELLER",
  events: deal.events, deadline: deal.deadline, dispute: customerDispute(dispute), createdAt: deal.createdAt, updatedAt: deal.updatedAt,
});
const hydrate = async (deal) => {
  if (deal?.populate) return deal.populate([{ path: "buyer", select: "fullName" }, { path: "seller", select: "fullName" }]);
  const users = await User.find({ _id: { $in: [deal.buyer, deal.seller] } }).select("fullName").lean();
  const byId = new Map(users.map((user) => [String(user._id), user]));
  return { ...deal, buyer: byId.get(String(deal.buyer)) || { _id: deal.buyer }, seller: byId.get(String(deal.seller)) || { _id: deal.seller } };
};

const create = async (req, res) => {
  try {
    const result = await service.createDeal({ buyerId: userId(req), sellerId: req.body?.sellerId, recipientServicePayId: req.body?.recipientServicePayId, amount: req.body?.amount, title: req.body?.title, description: req.body?.description, deadline: req.body?.deadline, idempotencyKey: idem(req) });
    return res.status(result.duplicate ? 200 : 201).json({ success: true, deal: privateDeal(await hydrate(result.deal), userId(req)), duplicate: result.duplicate });
  } catch (error) { return send(res, error, "Unable to create protected deal."); }
};
const fund = async (req, res) => {
  try {
    const result = await service.fundDeal({ dealId: req.params.dealId, buyerId: userId(req), idempotencyKey: idem(req) });
    return res.status(200).json({ success: true, deal: privateDeal(await hydrate(result.deal), userId(req)), duplicate: result.duplicate });
  } catch (error) { return send(res, error, "Unable to fund protected deal."); }
};
const delivered = async (req, res) => {
  try {
    const result = await service.transition({ dealId: req.params.dealId, actorId: userId(req), idempotencyKey: idem(req), from: ["IN_PROGRESS"], to: "DELIVERED", note: req.body?.note, requiredParticipant: "SELLER" });
    return res.status(200).json({ success: true, deal: privateDeal(await hydrate(result.deal), userId(req)), duplicate: result.duplicate });
  } catch (error) { return send(res, error, "Unable to update protected deal."); }
};
const start = async (req, res) => {
  try {
    const result = await service.transition({ dealId: req.params.dealId, actorId: userId(req), idempotencyKey: idem(req), from: ["FUNDED"], to: "IN_PROGRESS", note: req.body?.note, requiredParticipant: "SELLER" });
    return res.status(200).json({ success: true, deal: privateDeal(await hydrate(result.deal), userId(req)), duplicate: result.duplicate });
  } catch (error) { return send(res, error, "Unable to start protected deal."); }
};
const release = async (req, res) => {
  try {
    const result = await service.transition({ dealId: req.params.dealId, actorId: userId(req), idempotencyKey: idem(req), from: ["FUNDED", "DELIVERED"], to: "COMPLETED", note: req.body?.note, settlement: "RELEASE", requiredParticipant: "BUYER" });
    return res.status(200).json({ success: true, deal: privateDeal(await hydrate(result.deal), userId(req)), duplicate: result.duplicate });
  } catch (error) { return send(res, error, "Unable to release protected deal."); }
};
const listMine = async (req, res) => {
  try {
    const deals = await ProtectedDeal.find(service.dealFilterFor(userId(req))).sort({ createdAt: -1 }).limit(100).lean();
    const disputes = await TrustDispute.find({ deal: { $in: deals.map((deal) => deal._id) } }).lean();
    const disputesByDeal = new Map(disputes.map((item) => [String(item.deal), item]));
    const hydrated = await Promise.all(deals.map(hydrate));
    return res.json({ success: true, deals: hydrated.map((deal) => privateDeal(deal, userId(req), disputesByDeal.get(String(deal._id)) || null)) });
  } catch (error) { return send(res, error, "Unable to load protected deals."); }
};
const getMine = async (req, res) => {
  try {
    const deal = await ProtectedDeal.findOne({ _id: req.params.dealId, ...service.dealFilterFor(userId(req)) }).lean();
    if (!deal) throw service.fail("Protected deal not found.", 404);
    const linkedDispute = await TrustDispute.findOne({ deal: deal._id }).lean();
    return res.json({ success: true, deal: privateDeal(await hydrate(deal), userId(req), linkedDispute) });
  } catch (error) { return send(res, error, "Unable to load protected deal."); }
};
const dispute = async (req, res) => {
  try {
    const reason = String(req.body?.reason || "").trim();
    if (reason.length < 5) throw service.fail("Provide a dispute reason of at least 5 characters.");
    const evidenceReferences = Array.isArray(req.body?.evidenceReferences) ? req.body.evidenceReferences.map((value) => String(value).trim()).filter((value) => /^[A-Za-z0-9._:/-]{1,300}$/.test(value)) : [];
    const result = await service.openDispute({ dealId: req.params.dealId, userId: userId(req), reason, description: req.body?.description, evidenceReferences, idempotencyKey: idem(req) });
    return res.status(result.duplicate ? 200 : 201).json({ success: true, dispute: customerDispute(result.dispute), duplicate: result.duplicate });
  } catch (error) { return send(res, error, "Unable to open trust dispute."); }
};
module.exports = {
  create,
  fund,
  start,
  delivered,
  release,
  listMine,
  getMine,
  dispute,
  _customerDispute: customerDispute,
};