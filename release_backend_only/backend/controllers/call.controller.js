const mongoose = require("mongoose");
const User = require("../models/user.model");
const CallSession = require("../models/callSession.model");
const CallPrivacy = require("../models/callPrivacy.model");
const calls = require("../services/call.service");
const { scopeFilterFor } = require("../middleware/staffPermission.middleware");
const { isOnline } = require("../services/callPresence.service");
const { getCallConfig } = require("../services/turnCredential.service");

const starts = new Map();
const startAllowed = (userId) => {
  const now = Date.now(); const key = String(userId); const entries = (starts.get(key) || []).filter((at) => now - at < 60_000);
  if (entries.length >= 8) return false; entries.push(now); starts.set(key, entries); return true;
};
const peerSummary = (user) => ({ id: String(user._id), fullName: user.fullName, profilePhotoUrl: user.profilePhotoUrl || "", online: isOnline(user._id) });

exports.config = async (_req, res) => res.json({ success: true, ...(await getCallConfig()), ringTimeoutMs: calls.RING_MS });
exports.search = async (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 80);
  if (q.length < 2) return res.status(400).json({ success: false, message: "Search needs at least two characters." });
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const exact = [{ phone: q }, { "virtualAccount.accountNumber": q }];
  if (mongoose.Types.ObjectId.isValid(q)) exact.push({ _id: q });
  const users = await User.find({ _id: { $ne: req.user._id }, role: "CUSTOMER", status: "ACTIVE", $or: [...exact, { fullName: { $regex: escaped, $options: "i" } }] })
    .select("fullName profilePhotoUrl").limit(20).lean();
  const privacy = await CallPrivacy.find({ $or: [{ userId: req.user._id }, { userId: { $in: users.map((u) => u._id) } }] }).lean();
  const mine = privacy.find((p) => String(p.userId) === String(req.user._id));
  const visible = users.filter((u) => {
    const their = privacy.find((p) => String(p.userId) === String(u._id));
    return mine?.callsEnabled !== false && their?.callsEnabled !== false &&
      !mine?.blockedUserIds?.some((v) => String(v) === String(u._id)) &&
      !their?.blockedUserIds?.some((v) => String(v) === String(req.user._id));
  });
  res.json({ success: true, users: visible.map(peerSummary) });
};
exports.create = async (req, res) => {
  const calleeId = req.body?.calleeId;
  const target = await User.findOne({ _id: calleeId, role: "CUSTOMER", status: "ACTIVE" }).select("_id");
  if (!target) return res.status(404).json({ success: false, message: "Customer not found or unavailable." });
  if (!startAllowed(req.user._id)) return res.status(429).json({ success: false, message: "Too many call attempts. Please try again shortly." });
  try {
    const { call, idempotent } = await calls.createCall(req.user._id, target._id, req.get("Idempotency-Key"));
    if (!idempotent) {
      const caller = await User.findById(req.user._id).select("fullName profilePhotoUrl").lean();
      req.app.get("io")?.to(`call-user:${target._id}`).emit("call:incoming", { ...calls.publicCall(call, target._id), caller: peerSummary(caller) });
    }
    res.status(idempotent ? 200 : 201).json({ success: true, idempotent, call: calls.publicCall(call, req.user._id) });
  }
  catch (e) { res.status(e.status || 500).json({ success: false, message: e.message }); }
};
exports.action = (state) => async (req, res) => {
  try {
    const call = await calls.transition(req.params.callId, req.user._id, state, req.body?.reason);
    const peerId = String(call.callerId) === String(req.user._id) ? call.calleeId : call.callerId;
    req.app.get("io")?.to(`call-user:${peerId}`).emit("call:state", { callId: String(call._id), state: call.state, endReason: call.endReason || "" });
    res.json({ success: true, call: calls.publicCall(call, req.user._id) });
  }
  catch (e) { res.status(e.status || 500).json({ success: false, message: e.message }); }
};
exports.history = async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
  const list = await CallSession.find(calls.participantQuery(req.user._id)).sort({ createdAt: -1 }).limit(limit).lean();
  const peerIds = [...new Set(list.map((c) => String(c.callerId) === String(req.user._id) ? String(c.calleeId) : String(c.callerId)))];
  const peers = await User.find({ _id: { $in: peerIds } }).select("fullName profilePhotoUrl").lean();
  res.json({ success: true, calls: list.map((call) => ({ ...calls.publicCall(call, req.user._id), peer: peerSummary(peers.find((u) => String(u._id) === (String(call.callerId) === String(req.user._id) ? String(call.calleeId) : String(call.callerId))) || { _id: call.calleeId, fullName: "Customer" }) })) });
};
exports.getPrivacy = async (req, res) => {
  const privacy = await CallPrivacy.findOne({ userId: req.user._id }).lean();
  res.json({ success: true, privacy: { callsEnabled: privacy?.callsEnabled !== false, blockedUserIds: (privacy?.blockedUserIds || []).map(String) } });
};
exports.updatePrivacy = async (req, res) => {
  const enabled = req.body?.callsEnabled;
  if (typeof enabled !== "boolean") return res.status(400).json({ success: false, message: "callsEnabled must be boolean." });
  const privacy = await CallPrivacy.findOneAndUpdate({ userId: req.user._id }, { $set: { callsEnabled: enabled } }, { upsert: true, new: true });
  if (!enabled) {
    const terminated = (await calls.terminateForUser(req.user._id, "CALLS_DISABLED")).filter(Boolean);
    for (const call of terminated) {
      const peerId = String(call.callerId) === String(req.user._id) ? call.calleeId : call.callerId;
      req.app.get("io")?.to(`call-user:${peerId}`).emit("call:state", { callId: String(call._id), state: call.state, endReason: "CALLS_DISABLED" });
    }
  }
  res.json({ success: true, privacy: { callsEnabled: privacy.callsEnabled, blockedUserIds: privacy.blockedUserIds.map(String) } });
};
exports.block = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.userId) || String(req.params.userId) === String(req.user._id)) return res.status(400).json({ success: false, message: "A different valid customer is required." });
  const target = await User.exists({ _id: req.params.userId, role: "CUSTOMER" });
  if (!target) return res.status(404).json({ success: false, message: "Customer not found." });
  await CallPrivacy.updateOne({ userId: req.user._id }, { $addToSet: { blockedUserIds: req.params.userId } }, { upsert: true });
  const active = await CallSession.find({ state: { $in: calls.ACTIVE }, $or: [{ callerId: req.user._id, calleeId: req.params.userId }, { callerId: req.params.userId, calleeId: req.user._id }] });
  for (const session of active) {
    const call = await calls.transition(session._id, req.user._id, session.state === "RINGING" && String(session.calleeId) === String(req.user._id) ? "DECLINED" : (session.state === "RINGING" ? "CANCELLED" : "ENDED"), "BLOCKED");
    const peerId = String(call.callerId) === String(req.user._id) ? call.calleeId : call.callerId;
    req.app.get("io")?.to(`call-user:${peerId}`).emit("call:state", { callId: String(call._id), state: call.state, endReason: "BLOCKED" });
  }
  res.json({ success: true });
};
exports.unblock = async (req, res) => { await CallPrivacy.updateOne({ userId: req.user._id }, { $pull: { blockedUserIds: req.params.userId } }); res.json({ success: true }); };
exports.adminList = async (req, res) => {
  const filter = {}; const state = String(req.query.state || "").toUpperCase();
  const parseDate = (value) => {
    if (!value) return null;
    if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(String(value))) return "INVALID";
    const date = new Date(value); return Number.isNaN(date.getTime()) ? "INVALID" : date;
  };
  const from = parseDate(req.query.from); const to = parseDate(req.query.to);
  if (from === "INVALID" || to === "INVALID" || (from && to && from > to)) return res.status(400).json({ success: false, message: "from/to must be valid ISO dates with from before to." });
  if (from || to) filter.createdAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  if (["RINGING", "ACCEPTED", "DECLINED", "CANCELLED", "ENDED", "MISSED", "FAILED"].includes(state)) filter.state = state;
  const scope = scopeFilterFor(req.staffAccess);
  const scopedUsers = await User.find({ role: "CUSTOMER", ...scope }).select("_id").lean();
  const scopedIds = scopedUsers.map((u) => u._id);
  if (mongoose.Types.ObjectId.isValid(req.query.userId)) {
    if (!scopedIds.some((value) => String(value) === String(req.query.userId))) return res.status(403).json({ success: false, message: "This record is outside your authorized data scope." });
    Object.assign(filter, calls.participantQuery(req.query.userId));
  } else if (req.staffAccess?.scope?.type !== "GLOBAL") {
    filter.$or = [{ callerId: { $in: scopedIds } }, { calleeId: { $in: scopedIds } }];
  }
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  if (mongoose.Types.ObjectId.isValid(req.query.before)) filter._id = { $lt: req.query.before };
  const list = await CallSession.find(filter).select("callerId calleeId state startedAt answeredAt endedAt endReason expiresAt createdAt").sort({ _id: -1 }).limit(limit + 1).lean();
  const page = list.slice(0, limit);
  const ids = [...new Set(page.flatMap((c) => [String(c.callerId), String(c.calleeId)]))];
  const users = await User.find({ _id: { $in: ids } }).select("fullName profilePhotoUrl").lean();
  const summary = (userId) => peerSummary(users.find((u) => String(u._id) === String(userId)) || { _id: userId, fullName: "Customer" });
  res.json({ success: true, calls: page.map((c) => ({ id: String(c._id), state: c.state, startedAt: c.startedAt, answeredAt: c.answeredAt, endedAt: c.endedAt, endReason: c.endReason || "", expiresAt: c.expiresAt, durationSeconds: c.answeredAt && c.endedAt ? Math.max(0, Math.floor((new Date(c.endedAt) - new Date(c.answeredAt)) / 1000)) : 0, caller: summary(c.callerId), callee: summary(c.calleeId) })), pagination: { limit, hasMore: list.length > limit, nextBefore: list.length > limit ? String(page[page.length - 1]._id) : null } });
};