const ProtectedDeal = require("../models/protectedDeal.model");
const TrustDispute = require("../models/trustDispute.model");
const TrustProfile = require("../models/trustProfile.model");
const AdminAuditLog = require("../models/adminAuditLog.model");
const { resolveDispute, fail } = require("../services/protectedDeal.service");
const key = (req) => req.get?.("Idempotency-Key") || req.headers?.["idempotency-key"];
const actorId = (req) => req.user?._id || req.user?.id;
const send = (res, error, fallback) => res.status(error.status || 500).json({ success: false, message: error.status ? error.message : fallback });
const party = (user) => ({
  id: user?._id || user || null,
  displayName: user?.fullName || "",
});
const adminDeal = (deal) => ({
  id: String(deal._id),
  _id: deal._id,
  reference: deal.reference,
  buyer: party(deal.buyer),
  seller: party(deal.seller),
  amount: deal.amount,
  currency: deal.currency,
  title: deal.title,
  description: deal.description,
  status: deal.status,
  deadline: deal.deadline,
  events: deal.events,
  createdAt: deal.createdAt,
  updatedAt: deal.updatedAt,
});
const adminDispute = (dispute) => ({
  id: String(dispute._id),
  _id: dispute._id,
  dealId: dispute.deal?._id || dispute.deal,
  deal: dispute.deal?._id
    ? { id: dispute.deal._id, reference: dispute.deal.reference, title: dispute.deal.title }
    : dispute.deal,
  openedBy: party(dispute.openedBy),
  buyer: party(dispute.buyer),
  seller: party(dispute.seller),
  reason: dispute.reason,
  details: dispute.description || "",
  evidenceReferences: dispute.evidenceReferences || [],
  status: dispute.status,
  resolution: dispute.resolution || "",
  resolutionNote: dispute.resolutionNote || "",
  resolvedBy: dispute.resolvedBy ? party(dispute.resolvedBy) : null,
  resolvedAt: dispute.resolvedAt,
  createdAt: dispute.createdAt,
  updatedAt: dispute.updatedAt,
});

const listDeals = async (req, res) => {
  try {
    const filter = req.query.status ? { status: String(req.query.status).toUpperCase() } : {};
    const deals = await ProtectedDeal.find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(Math.max(Number(req.query.limit) || 50, 1), 100))
      .populate([{ path: "buyer", select: "fullName" }, { path: "seller", select: "fullName" }])
      .lean();
    return res.json({ success: true, deals: deals.map(adminDeal) });
  } catch (error) { return send(res, error, "Unable to list protected deals."); }
};
const listDisputes = async (req, res) => {
  try {
    const filter = req.query.status ? { status: String(req.query.status).toUpperCase() } : {};
    const disputes = await TrustDispute.find(filter)
      .sort({ createdAt: -1 })
      .limit(100)
      .populate([
        { path: "deal", select: "reference title" },
        { path: "openedBy", select: "fullName" },
        { path: "buyer", select: "fullName" },
        { path: "seller", select: "fullName" },
        { path: "resolvedBy", select: "fullName" },
      ])
      .lean();
    return res.json({ success: true, disputes: disputes.map(adminDispute) });
  } catch (error) { return send(res, error, "Unable to list trust disputes."); }
};
const resolve = async (req, res) => {
  try {
    const result = await resolveDispute({ disputeId: req.params.disputeId, adminId: actorId(req), actor: req.user, resolution: req.body?.resolution, note: req.body?.note, idempotencyKey: key(req) });
    return res.json({ success: true, dispute: adminDispute(result.dispute), duplicate: result.duplicate });
  } catch (error) { return send(res, error, "Unable to resolve trust dispute."); }
};
const restrict = async (req, res) => {
  try {
    if (typeof req.body?.restricted !== "boolean") throw fail("restricted must be true or false.");
    const reason = String(req.body.reason || "").trim();
    if (req.body.restricted && !reason) throw fail("A restriction reason is required.");
    const profile = await TrustProfile.findOneAndUpdate({ servicePayId: String(req.params.servicePayId || "").toUpperCase() }, { $set: { restricted: req.body.restricted, restrictionReason: req.body.restricted ? String(req.body.reason || "").trim() : "" } }, { new: true }).select("+restrictionReason");
    if (!profile) throw fail("Trust profile not found.", 404);
    await AdminAuditLog.create({ actorId: actorId(req), actorRole: req.user?.role || "STAFF", actorName: req.user?.fullName || "", targetUserId: profile.user, action: "TRUST_PROFILE_RESTRICTED", reason: req.body.restricted ? profile.restrictionReason : "Trust restriction removed.", metadata: { restricted: req.body.restricted } });
    return res.json({ success: true, profile });
  } catch (error) { return send(res, error, "Unable to update trust restriction."); }
};
module.exports = {
  listDeals,
  listDisputes,
  resolve,
  restrict,
  _adminDeal: adminDeal,
  _adminDispute: adminDispute,
};