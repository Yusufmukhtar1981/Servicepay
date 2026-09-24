const mongoose = require("mongoose");
const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const AdminAuditLog = require("../models/adminAuditLog.model");
const { getZonalScope } = require("../services/zonalScope.service");

const USER_FIELDS = "_id fullName phone email role status zone state lga zonalManagerId stateManagerId agentId promotionParentId createdAt updatedAt";
const TX_FIELDS = "_id customerId amount serviceType status reference createdAt updatedAt";
const clean = (u) => {
  if (!u) return null;
  const value = u.toObject ? u.toObject() : { ...u };
  return Object.fromEntries(Object.keys(value).filter((key) => USER_FIELDS.split(" ").includes(key)).map((key) => [key, value[key]]));
};
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").slice(0, 80);
const pageArgs = (q) => ({
  page: Math.max(1, parseInt(q.page, 10) || 1),
  limit: Math.min(100, Math.max(1, parseInt(q.limit, 10) || 25)),
});
const forbidden = (res) => res.status(403).json({ success: false, message: "Resource is outside your zonal scope." });
const allowedRole = (section) => ({ "state-managers": "STATE_MANAGER", aggregators: "AGENT", customers: "CUSTOMER" }[section]);
const lockHierarchyUsers = async (ids, session) => {
  for (const id of [...new Set(ids.filter(Boolean).map(String))].sort()) {
    const locked = await User.updateOne(
      { _id: id, isDeleted: { $ne: true } },
      { $inc: { hierarchyVersion: 1 } },
      { session }
    );
    if (locked.modifiedCount !== 1) {
      const conflict = new Error("The hierarchy changed during promotion; please retry.");
      conflict.statusCode = 409;
      throw conflict;
    }
  }
};

exports.list = async (req, res) => {
  try {
    const role = String(req.user?.role || "").toUpperCase();
    if (role !== "ZONAL_MANAGER") return res.status(403).json({ success: false, message: "Only a Zonal Manager can access zonal hierarchy." });
    const section = req.params.section;
    const targetRole = allowedRole(section);
    if (!targetRole) return res.status(404).json({ success: false, message: "Unknown hierarchy section." });
    const scope = await getZonalScope(req.user);
    const ids = targetRole === "STATE_MANAGER" ? scope.stateManagerIds : targetRole === "AGENT" ? scope.agentIds : scope.customerIds;
    const query = { _id: { $in: ids }, role: targetRole, isDeleted: { $ne: true } };
    if (req.query.state) query.state = String(req.query.state).trim();
    if (req.query.stateManagerId && targetRole !== "STATE_MANAGER") query.stateManagerId = req.query.stateManagerId;
    if (req.query.search) query.$or = ["fullName", "phone", "email", "state", "lga"].map((field) => ({ [field]: { $regex: escapeRegex(String(req.query.search).trim()), $options: "i" } }));
    const { page, limit } = pageArgs(req.query);
    const [items, total] = await Promise.all([
      User.find(query).select(USER_FIELDS).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      User.countDocuments(query),
    ]);
    return res.json({ items, total, page, limit });
  } catch (error) { return res.status(500).json({ success: false, message: "Unable to load zonal hierarchy." }); }
};

exports.detail = async (req, res) => {
  try {
    const scope = await getZonalScope(req.user);
    const id = String(req.params.id);
    const role = allowedRole(req.params.section);
    const ids = role === "STATE_MANAGER" ? scope.stateManagerIds : role === "AGENT" ? scope.agentIds : scope.customerIds;
    if (!role || !ids.includes(id)) return forbidden(res);
    const item = await User.findOne({ _id: req.params.id, role, isDeleted: { $ne: true } }).select(USER_FIELDS).lean();
    if (!item) return forbidden(res);
    const [customers, aggregators] = await Promise.all([
      User.countDocuments({ _id: { $in: scope.customerIds }, role: "CUSTOMER", isDeleted: { $ne: true }, ...(role === "AGENT" ? { agentId: item._id } : role === "STATE_MANAGER" ? { stateManagerId: item._id } : {}) }),
      role === "STATE_MANAGER" ? User.countDocuments({ _id: { $in: scope.agentIds }, role: "AGENT", stateManagerId: item._id, isDeleted: { $ne: true } }) : Promise.resolve(0),
    ]);
    return res.json({ item, counts: { customers, aggregators } });
  } catch (error) { return res.status(500).json({ success: false, message: "Unable to load hierarchy detail." }); }
};

exports.transactions = async (req, res) => {
  try {
    const scope = await getZonalScope(req.user);
    if (!scope.customerIds.includes(String(req.params.id))) return forbidden(res);
    const { page, limit } = pageArgs(req.query);
    const query = { customerId: req.params.id };
    const [items, total] = await Promise.all([Transaction.find(query).select(TX_FIELDS).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(), Transaction.countDocuments(query)]);
    return res.json({ items, total, page, limit });
  } catch (error) { return res.status(500).json({ success: false, message: "Unable to load customer transactions." }); }
};

exports.promote = async (req, res) => {
  const key = String(req.get?.("Idempotency-Key") || req.body?.idempotencyKey || `zonal:${req.params.id}:STATE_MANAGER`).trim().slice(0, 160);
  if (String(req.user?.role || "").toUpperCase() !== "ZONAL_MANAGER") return res.status(403).json({ success: false, message: "Only a Zonal Manager can promote aggregators." });
  if (!mongoose.Types.ObjectId.isValid(req.params.id) || !mongoose.Types.ObjectId.isValid(req.body?.stateManagerId)) {
    // The management UI sends the assigned state name; it is resolved against
    // the target's current parent below. An ObjectId remains accepted for API
    // clients that send an explicit parent id.
    if (!String(req.body?.state || "").trim()) return res.status(403).json({ success: false, message: "Aggregator or state assignment is outside your zonal scope." });
  }
  if (req.body?.targetRole && String(req.body.targetRole).toUpperCase() !== "STATE_MANAGER") return res.status(400).json({ success: false, message: "Only AGENT to STATE_MANAGER promotion is supported." });
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const prior = await AdminAuditLog.findOne({ action: "USER_ROLE_UPDATED", "metadata.promotionKey": key }).session(session).lean();
      if (prior) {
        const metadata = prior.metadata || {};
        if (String(prior.actorId) !== String(req.user._id)) {
          const error = new Error("Promotion is outside your zonal scope.");
          error.statusCode = 403; throw error;
        }
        if (String(metadata.targetUserId) !== String(req.params.id) ||
          metadata.sourceRole !== "AGENT" || metadata.targetRole !== "STATE_MANAGER") {
          const e = new Error("This promotion key was already used for a different promotion.");
          e.statusCode = 409; throw e;
        }
        result = await User.findOne({ _id: req.params.id, role: "STATE_MANAGER", zonalManagerId: req.user._id }).session(session).select(USER_FIELDS);
        if (!result) {
          const error = new Error("Promotion is outside your zonal scope.");
          error.statusCode = 403; throw error;
        }
        return;
      }
      const actor = await User.findOne({ _id: req.user._id, role: "ZONAL_MANAGER", status: "ACTIVE", isDeleted: { $ne: true }, zone: { $exists: true, $ne: "" } }).session(session);
      const parentRef = req.body?.stateManagerId;
      const smFilter = { role: "STATE_MANAGER", zone: actor?.zone, zonalManagerId: actor?._id, status: "ACTIVE", isDeleted: { $ne: true } };
      if (mongoose.Types.ObjectId.isValid(parentRef)) smFilter._id = parentRef;
      else smFilter.state = String(req.body?.state || "").trim();
      const sm = await User.findOne(smFilter).session(session).lean();
      const target = await User.findOne({ _id: req.params.id, role: "AGENT", zone: actor?.zone, zonalManagerId: actor?._id, stateManagerId: sm?._id, status: "ACTIVE", isDeleted: { $ne: true } }).session(session);
      if (!actor || !sm || !target || target.zonalManagerId.toString() !== actor._id.toString() ||
        target.state !== sm.state || target.stateManagerId.toString() !== sm._id.toString()) { const e = new Error("Aggregator is not eligible for this zonal promotion."); e.statusCode = 403; throw e; }
      const children = await User.find({ role: "CUSTOMER", agentId: target._id, isDeleted: { $ne: true } }).session(session).lean();
      await lockHierarchyUsers([
        actor?._id, sm?._id, target?._id, target?.stateManagerId,
        ...children.map((child) => child._id),
      ], session);
      const refreshedActor = await User.findById(actor?._id).session(session);
      const refreshedTarget = await User.findById(target?._id).session(session);
      if (!refreshedActor || !refreshedTarget) {
        const error = new Error("The hierarchy changed during promotion; please retry.");
        error.statusCode = 409;
        throw error;
      }
      actor.$set(refreshedActor.toObject());
      target.$set(refreshedTarget.toObject());
      const validChildren = children.filter((child) => child.zone === actor.zone && child.state === target.state &&
        String(child.zonalManagerId) === String(actor._id) && String(child.stateManagerId) === String(target.stateManagerId));
      if (validChildren.length !== children.length) { const e = new Error("Aggregator has contradictory child lineage; promotion was not applied."); e.statusCode = 409; throw e; }
      const previous = { role: target.role, stateManagerId: target.stateManagerId, zonalManagerId: target.zonalManagerId, zone: target.zone, state: target.state };
      const childIds = validChildren.map((child) => child._id);
      target.role = "STATE_MANAGER"; target.stateManagerId = null; target.agentId = null; target.zonalManagerId = actor._id; target.promotionParentId = sm._id; target.authTokenVersion = (target.authTokenVersion || 0) + 1; target.hierarchyVersion = (target.hierarchyVersion || 0) + 1;
      await target.save({ session });
      const moved = await User.updateMany({ _id: { $in: childIds }, role: "CUSTOMER", agentId: target._id, zone: actor.zone, state: target.state, stateManagerId: previous.stateManagerId, zonalManagerId: actor._id, isDeleted: { $ne: true } }, { $set: { stateManagerId: target._id, agentId: null, zonalManagerId: actor._id } }, { session });
      if (moved.modifiedCount !== childIds.length) {
        const error = new Error("Customer hierarchy changed during promotion; please retry.");
        error.statusCode = 409;
        throw error;
      }
      await AdminAuditLog.create([{ actorId: actor._id, actorRole: "ZONAL_MANAGER", actorName: actor.fullName || "", targetUserId: target._id, targetUserName: target.fullName, action: "USER_ROLE_UPDATED", reason: "Zonal aggregator promotion.", previousData: { ...previous, childCount: children.length }, newData: { role: target.role, stateManagerId: null, zonalManagerId: actor._id, promotionParentId: sm._id, childCount: childIds.length }, metadata: { promotion: true, promotionKey: key, sourceRole: "AGENT", targetRole: "STATE_MANAGER", targetUserId: String(target._id), childIds: childIds.map(String), previousStateManagerId: String(previous.stateManagerId), childCount: childIds.length }, requestMethod: req.method, requestPath: req.originalUrl }], { session });
      result = target;
    });
    return res.json({ success: true, user: clean(result) });
  } catch (error) {
    if (error?.code === 11000) {
      const prior = await AdminAuditLog.findOne({ action: "USER_ROLE_UPDATED", "metadata.promotionKey": key }).lean();
      const metadata = prior?.metadata || {};
      if (prior && String(prior.actorId) !== String(req.user._id)) {
        return forbidden(res);
      }
      if (prior && String(metadata.targetUserId) === String(req.params.id) &&
        metadata.sourceRole === "AGENT" && metadata.targetRole === "STATE_MANAGER") {
        const current = await User.findOne({ _id: req.params.id, role: "STATE_MANAGER", zonalManagerId: req.user._id }).select(USER_FIELDS).lean();
        if (!current) return forbidden(res);
        return res.json({ success: true, duplicate: true, user: current });
      }
      return res.status(409).json({ success: false, code: "IDEMPOTENCY_INTENT_CONFLICT", message: "This promotion key was already used for a different promotion." });
    }
    return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : "Unable to promote aggregator." });
  }
  finally { await session.endSession(); }
};