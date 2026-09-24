const mongoose = require("mongoose");
const User = require("../models/user.model");
const AdminAuditLog = require("../models/adminAuditLog.model");
const Transaction = require("../models/transaction.model");

const ROLES = new Set(["ZONAL_MANAGER", "STATE_MANAGER", "AGENT", "CUSTOMER"]);
const TARGET_PARENT = { STATE_MANAGER: "ZONAL_MANAGER", AGENT: "STATE_MANAGER", CUSTOMER: "AGENT" };
const FIELDS = "_id fullName phone email role status zone state zonalManagerId stateManagerId agentId";
const oid = (value) => mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : null;
const pageArgs = (query = {}) => ({
  page: Math.max(1, Number.parseInt(query.page, 10) || 1),
  limit: Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 25)),
});
const cleanId = (value) => value ? String(value) : null;
const error = (statusCode, message, code) => Object.assign(new Error(message), { statusCode, code });
const active = { status: "ACTIVE", isDeleted: { $ne: true } };
let hierarchyIndexReady;
const ensureHierarchyRequestIndex = async () => {
  if (!hierarchyIndexReady) {
    hierarchyIndexReady = (async () => {
      const indexes = await AdminAuditLog.collection.listIndexes().toArray();
      const found = indexes.find((index) => index.name === "uniq_hierarchy_request_id");
      if (found) {
        if (!found.unique || found.key?.["metadata.hierarchyRequestId"] !== 1) {
          throw error(503, "Hierarchy idempotency storage is not configured safely.");
        }
        return;
      }
      await AdminAuditLog.collection.createIndex(
        { "metadata.hierarchyRequestId": 1 },
        { unique: true, sparse: true, name: "uniq_hierarchy_request_id" }
      );
    })().catch((err) => {
      hierarchyIndexReady = null;
      throw err;
    });
  }
  return hierarchyIndexReady;
};
const intentFor = (userId, parentId, reason) => ({
  userId: String(userId), parentId: String(parentId), reason: String(reason),
});
const parentFor = (user) => user.role === "STATE_MANAGER" ? user.zonalManagerId
  : user.role === "AGENT" ? user.stateManagerId : user.agentId;
const parentName = async (id, session) => {
  if (!id) return null;
  const query = User.findOne({ _id: id }).select("_id fullName role");
  if (session) query.session(session);
  const value = await query.lean();
  return value || null;
};
const verifiedDestination = async (parent, session) => {
  if (!parent.zone) throw error(409, "The destination parent has no verified operational zone.");
  if (parent.role === "ZONAL_MANAGER") return;
  if (!parent.state || !parent.zonalManagerId) throw error(409, "The destination parent has incomplete hierarchy lineage.");
  const zonal = await User.findOne({ _id: parent.zonalManagerId, role: "ZONAL_MANAGER", ...active, zone: parent.zone }).session(session).select("_id").lean();
  if (!zonal) throw error(409, "The destination parent has no verified active Zonal Manager lineage.");
  if (parent.role === "STATE_MANAGER") return;
  if (parent.role !== "AGENT" || !parent.stateManagerId) throw error(409, "The destination parent has incomplete hierarchy lineage.");
  const state = await User.findOne({
    _id: parent.stateManagerId, role: "STATE_MANAGER", ...active,
    zone: parent.zone, state: parent.state, zonalManagerId: parent.zonalManagerId,
  }).session(session).select("_id").lean();
  if (!state) throw error(409, "The destination Aggregator has no verified active State Manager lineage.");
};
const dto = (user, currentParent = null) => ({
  _id: user._id, fullName: user.fullName, phone: user.phone, email: user.email,
  role: user.role, status: user.status, zone: user.zone || null, state: user.state || null,
  zonalManagerId: user.zonalManagerId || null, stateManagerId: user.stateManagerId || null,
  agentId: user.agentId || null, currentParent: currentParent ? {
    _id: currentParent._id, fullName: currentParent.fullName, role: currentParent.role,
  } : null,
});

exports.listUsers = async (req, res) => {
  try {
    const role = String(req.query.role || "").trim().toUpperCase();
    if (!ROLES.has(role)) return res.status(400).json({ success: false, message: "A valid hierarchy role is required." });
    const { page, limit } = pageArgs(req.query);
    const query = { ...(req.query.includeInactive === "true" ? { isDeleted: { $ne: true } } : active), role };
    if (req.query.parentId) {
      const parentId = oid(req.query.parentId);
      if (!parentId) return res.status(400).json({ success: false, message: "Invalid hierarchy parent ID." });
      const parent = await User.findOne({ _id: parentId, isDeleted: { $ne: true } }).select("role").lean();
      if (!parent) return res.status(404).json({ success: false, message: "Hierarchy parent not found." });
      const expected = TARGET_PARENT[role];
      if (parent.role === expected) {
        query[{ STATE_MANAGER: "zonalManagerId", AGENT: "stateManagerId", CUSTOMER: "agentId" }[role]] = parentId;
      } else if (role === "CUSTOMER" && parent.role === "STATE_MANAGER") {
        query.stateManagerId = parentId;
        query.agentId = null; // Legacy customers linked directly to State Managers.
      } else {
        return res.status(400).json({ success: false, message: "This role cannot report to the selected parent." });
      }
    }
    const search = String(req.query.search || "").trim().slice(0, 80);
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.$or = ["fullName", "phone", "email", "state", "zone", "_id"].map((field) =>
        field === "_id" && mongoose.Types.ObjectId.isValid(search)
          ? { _id: search } : field === "_id" ? { _id: null } : { [field]: { $regex: escaped, $options: "i" } });
    }
    const [rows, total] = await Promise.all([
      User.find(query).select(FIELDS).sort({ fullName: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
      User.countDocuments(query),
    ]);
    const parentIds = [...new Set(rows.map(parentFor).filter(Boolean).map(String))];
    const parents = await User.find({ _id: { $in: parentIds } }).select("_id fullName role").lean();
    const parentMap = new Map(parents.map((parent) => [String(parent._id), parent]));
    return res.json({
      success: true, users: rows.map((row) => dto(row, parentMap.get(String(parentFor(row))))),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Unable to load hierarchy users." });
  }
};

const loadAssignment = async (req, session) => {
  const userId = oid(req.body?.userId);
  const parentId = oid(req.body?.parentId);
  if (!userId || !parentId) throw error(400, "Valid userId and parentId are required.");
  if (userId.equals(parentId)) throw error(400, "A user cannot be assigned to itself.");
  const target = await User.findOne({ _id: userId, ...active }).session(session);
  const parent = await User.findOne({ _id: parentId, ...active }).session(session);
  if (!target || !parent) throw error(404, "The active hierarchy user or parent was not found.");
  const expected = TARGET_PARENT[target.role];
  if (!expected || parent.role !== expected) throw error(400, `An ${target.role} must be assigned to an active ${expected || "valid parent"}.`);
  await verifiedDestination(parent, session);
  if (target.role === "STATE_MANAGER" && (!target.state || !target.state.trim())) throw error(409, "The State Manager has no verified state lineage.");
  if (target.zone && target.zone.trim().toUpperCase() !== parent.zone.trim().toUpperCase()) {
    throw error(409, "The destination is outside this user's assigned zone.", "HIERARCHY_CROSS_ZONE");
  }
  if (target.role !== "STATE_MANAGER" && target.state && target.state.trim().toUpperCase() !== parent.state.trim().toUpperCase()) {
    throw error(409, "The destination is outside this user's assigned state.", "HIERARCHY_CROSS_STATE");
  }
  return { target, parent };
};
const lock = async (ids, session) => {
  for (const id of [...new Set(ids.map(String))].sort()) {
    const result = await User.updateOne({ _id: id, isDeleted: { $ne: true } }, { $inc: { hierarchyVersion: 1 } }, { session });
    if (result.modifiedCount !== 1) throw error(409, "The hierarchy changed during this assignment; please retry.");
  }
};
const lineage = (target, parent) => {
  if (target.role === "STATE_MANAGER") return { zone: parent.zone, state: target.state, zonalManagerId: parent._id, stateManagerId: null, agentId: null };
  if (target.role === "AGENT") return { zone: parent.zone, state: parent.state, zonalManagerId: parent.zonalManagerId, stateManagerId: parent._id, agentId: null };
  return { zone: parent.zone, state: parent.state, zonalManagerId: parent.zonalManagerId, stateManagerId: parent.stateManagerId, agentId: parent._id };
};
const subtree = async (target, session) => {
  const retained = { isDeleted: { $ne: true } };
  if (target.role === "STATE_MANAGER") {
    const agents = await User.find({ ...retained, role: "AGENT", stateManagerId: target._id }).session(session).lean();
    const agentIds = agents.map((x) => x._id);
    const customers = await User.find({
      ...retained, role: "CUSTOMER",
      $or: [
        ...(agentIds.length ? [{ agentId: { $in: agentIds } }] : []),
        { stateManagerId: target._id, agentId: null },
      ],
    }).session(session).lean();
    return { agents, customers };
  }
  if (target.role === "AGENT") return { agents: [], customers: await User.find({ ...retained, role: "CUSTOMER", agentId: target._id }).session(session).lean() };
  return { agents: [], customers: [] };
};

exports.assign = async (req, res) => {
  const requestId = String(req.body?.requestId || "").trim().slice(0, 160);
  const reason = String(req.body?.reason || "").trim();
  if (!requestId) return res.status(400).json({ success: false, message: "requestId is required." });
  if (!reason || reason.length > 500) return res.status(400).json({ success: false, message: "A reason between 1 and 500 characters is required." });
  const expectedTargetId = oid(req.body?.userId);
  if (!expectedTargetId) return res.status(400).json({ success: false, message: "A valid userId is required." });
  const requestedParentId = oid(req.body?.parentId);
  if (!requestedParentId) return res.status(400).json({ success: false, message: "A valid parentId is required." });
  try {
    await ensureHierarchyRequestIndex();
  } catch (indexError) {
    return res.status(indexError.statusCode || 503).json({ success: false, message: "Hierarchy idempotency storage is unavailable." });
  }
  const requestedIntent = intentFor(expectedTargetId, requestedParentId, reason);
  const existingRequest = await AdminAuditLog.findOne({ "metadata.hierarchyRequestId": requestId }).lean();
  if (existingRequest) {
    if (String(existingRequest.actorId) !== String(req.user._id)) return res.status(403).json({ success: false, message: "This request ID belongs to another administrator." });
    const priorIntent = existingRequest.metadata?.hierarchyIntent;
    if (!priorIntent || JSON.stringify(priorIntent) !== JSON.stringify(requestedIntent)) {
      return res.status(409).json({ success: false, code: "HIERARCHY_REQUEST_INTENT_MISMATCH", message: "This request ID was already used for a different assignment intent." });
    }
    const replayUser = await User.findById(existingRequest.targetUserId).select(FIELDS).lean();
    return res.json({ success: true, duplicate: true, user: dto(replayUser, await parentName(parentFor(replayUser))), affectedCount: Number(existingRequest.metadata?.affectedCount || 0) });
  }
  const expectedTarget = await User.findOne({ _id: expectedTargetId, ...active }).select("_id role zonalManagerId stateManagerId agentId").lean();
  if (!expectedTarget) return res.status(404).json({ success: false, message: "The active hierarchy user was not found." });
  const expectedParentId = parentFor(expectedTarget);
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const prior = await AdminAuditLog.findOne({ "metadata.hierarchyRequestId": requestId }).session(session).lean();
      if (prior) {
        if (String(prior.actorId) !== String(req.user._id)) throw error(403, "This request ID belongs to another administrator.");
        if (JSON.stringify(prior.metadata?.hierarchyIntent) !== JSON.stringify(requestedIntent)) throw error(409, "This request ID was already used for a different assignment intent.");
        result = { duplicate: true, targetId: prior.targetUserId, affectedCount: Number(prior.metadata?.affectedCount || 1) };
        return;
      }
      const { target, parent } = await loadAssignment(req, session);
      if (String(parentFor(target) || "") !== String(expectedParentId || "")) {
        throw error(409, "The hierarchy changed during this assignment; please retry.");
      }
      const oldParent = await parentName(parentFor(target), session);
      const previousParentId = parentFor(target);
      const same = previousParentId && String(previousParentId) === String(parent._id);
      const tree = await subtree(target, session);
      const lockIds = [target._id, parent._id, previousParentId, parent.zonalManagerId, parent.stateManagerId,
        ...tree.agents.map((x) => x._id), ...tree.customers.map((x) => x._id)].filter(Boolean);
      await lock(lockIds, session);
      if (same) {
        result = { duplicate: true, targetId: target._id, affectedCount: 0 };
        await AdminAuditLog.create([{
          actorId: req.user._id, actorRole: req.user.role, actorName: req.user.fullName || "",
          targetUserId: target._id, targetUserName: target.fullName, action: "HIERARCHY_ASSIGNMENT_UPDATED",
          reason, previousData: { parentId: previousParentId }, newData: { parentId: parent._id },
          metadata: { hierarchyRequestId: requestId, hierarchyIntent: requestedIntent, assignmentType: "NO_OP", affectedCount: 0 },
          requestMethod: req.method, requestPath: req.originalUrl,
        }], { session });
        return;
      }
      const next = lineage(target, parent);
      const affectedCustomers = target.role === "CUSTOMER" ? [target] : tree.customers;
      const changedLineage = ["agentId", "stateManagerId", "zonalManagerId"].filter((field) =>
        String(target[field] || "") !== String(next[field] || ""));
      if (affectedCustomers.length && changedLineage.length) {
        const unattributed = await Transaction.exists({
          customerId: { $in: affectedCustomers.map((customer) => customer._id) },
          hierarchyCapturedAt: null,
        }).session(session);
        if (unattributed) {
          throw error(409, "This downline has legacy transactions without verified manager attribution. Reconcile its reporting history before reassignment.", "HIERARCHY_HISTORY_UNVERIFIED");
        }
      }
      const movedIds = [target._id, ...tree.agents.map((x) => x._id), ...tree.customers.map((x) => x._id)];
      const targetUpdate = await User.updateOne({ _id: target._id, ...active }, { $set: next }, { session });
      if (targetUpdate.modifiedCount !== 1) throw error(409, "The hierarchy changed during this assignment; please retry.");
      if (target.role === "STATE_MANAGER") {
        const agents = await User.updateMany({ _id: { $in: tree.agents.map((x) => x._id) }, isDeleted: { $ne: true } }, { $set: { zone: parent.zone, zonalManagerId: parent._id, stateManagerId: target._id } }, { session });
        const customers = await User.updateMany({ _id: { $in: tree.customers.map((x) => x._id) }, isDeleted: { $ne: true } }, { $set: { zone: parent.zone, zonalManagerId: parent._id, stateManagerId: target._id } }, { session });
        if (agents.matchedCount !== tree.agents.length || customers.matchedCount !== tree.customers.length) {
          throw error(409, "The downline changed while it was being reassigned.");
        }
      } else if (target.role === "AGENT") {
        const customers = await User.updateMany({ _id: { $in: tree.customers.map((x) => x._id) }, isDeleted: { $ne: true } }, { $set: { zone: parent.zone, state: parent.state, zonalManagerId: parent.zonalManagerId, stateManagerId: parent._id, agentId: target._id } }, { session });
        if (customers.matchedCount !== tree.customers.length) {
          throw error(409, "The downline changed while it was being reassigned.");
        }
      }
      const affectedCount = movedIds.length;
      await AdminAuditLog.create([{
        actorId: req.user._id, actorRole: req.user.role, actorName: req.user.fullName || "",
        targetUserId: target._id, targetUserName: target.fullName, action: "HIERARCHY_ASSIGNMENT_UPDATED",
        reason, previousData: { parentId: previousParentId, parentName: oldParent?.fullName || null, role: target.role },
        newData: { parentId: parent._id, parentName: parent.fullName, role: target.role },
        metadata: { hierarchyRequestId: requestId, hierarchyIntent: requestedIntent, assignmentType: previousParentId ? "REASSIGNMENT" : "ASSIGNMENT", affectedCount, affectedUserIds: movedIds.map(String) },
        requestMethod: req.method, requestPath: req.originalUrl,
      }], { session });
      result = { duplicate: false, targetId: target._id, affectedCount };
    });
    const user = await User.findById(result.targetId).select(FIELDS).lean();
    return res.json({ success: true, duplicate: result.duplicate, user: dto(user, await parentName(parentFor(user))), affectedCount: result.affectedCount });
  } catch (err) {
    if (err?.code === 11000) {
      const prior = await AdminAuditLog.findOne({ "metadata.hierarchyRequestId": requestId }).lean();
      if (prior && String(prior.actorId) === String(req.user._id)) {
        if (JSON.stringify(prior.metadata?.hierarchyIntent) !== JSON.stringify(requestedIntent)) {
          return res.status(409).json({ success: false, code: "HIERARCHY_REQUEST_INTENT_MISMATCH", message: "This request ID was already used for a different assignment intent." });
        }
        const user = await User.findById(prior.targetUserId).select(FIELDS).lean();
        return res.json({
          success: true, duplicate: true, user: dto(user, await parentName(parentFor(user))),
          affectedCount: Number(prior.metadata?.affectedCount || 0),
        });
      }
      return res.status(409).json({ success: false, code: "HIERARCHY_REQUEST_CONFLICT", message: "This assignment request conflicts with another operation; please retry." });
    }
    return res.status(err.statusCode || 500).json({ success: false, code: err.code, message: err.statusCode ? err.message : "Unable to assign hierarchy user." });
  } finally { await session.endSession(); }
};

exports.history = async (req, res) => {
  try {
    const { page, limit } = pageArgs(req.query);
    const query = { action: "HIERARCHY_ASSIGNMENT_UPDATED" };
    for (const [key, value] of [["targetUserId", req.query.userId], ["actorId", req.query.actorId]]) if (value) {
      if (!oid(value)) return res.status(400).json({ success: false, message: `Invalid ${key}.` });
      query[key] = value;
    }
    if (req.query.role) query["previousData.role"] = String(req.query.role).toUpperCase();
    if (req.query.type) query["metadata.assignmentType"] = String(req.query.type).toUpperCase();
    if (req.query.from || req.query.to) query.createdAt = {};
    if (req.query.from) {
      const from = new Date(req.query.from);
      if (Number.isNaN(from.getTime())) return res.status(400).json({ success: false, message: "Invalid from date." });
      query.createdAt.$gte = from;
    }
    if (req.query.to) {
      const to = new Date(req.query.to);
      if (Number.isNaN(to.getTime())) return res.status(400).json({ success: false, message: "Invalid to date." });
      query.createdAt.$lte = to;
    }
    const [rows, total] = await Promise.all([
      AdminAuditLog.find(query).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      AdminAuditLog.countDocuments(query),
    ]);
    const ids = [...new Set(rows.flatMap((row) => [row.actorId, row.targetUserId, row.previousData?.parentId, row.newData?.parentId].filter(Boolean).map(String)))];
    const users = await User.find({ _id: { $in: ids } }).select("_id fullName role").lean();
    const names = new Map(users.map((u) => [String(u._id), u]));
    return res.json({ success: true, records: rows.map((row) => ({
      _id: row._id, actorId: row.actorId, actorName: row.actorName, targetUserId: row.targetUserId,
      targetUserName: row.targetUserName, affectedRole: row.previousData?.role || null,
      previousParentId: row.previousData?.parentId || null, previousParentName: row.previousData?.parentName || names.get(String(row.previousData?.parentId))?.fullName || null,
      newParentId: row.newData?.parentId || null, newParentName: row.newData?.parentName || names.get(String(row.newData?.parentId))?.fullName || null,
      assignmentType: row.metadata?.assignmentType || null, reason: row.reason, requestId: row.metadata?.hierarchyRequestId || null,
      affectedCount: Number(row.metadata?.affectedCount || 0), createdAt: row.createdAt,
    })), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) { return res.status(500).json({ success: false, message: "Unable to load hierarchy assignment history." }); }
};