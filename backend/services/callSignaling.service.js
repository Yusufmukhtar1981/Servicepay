const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const User = require("../models/user.model");
const CallSession = require("../models/callSession.model");
const calls = require("./call.service");
const presence = require("./callPresence.service");

const MAX_SDP = 16 * 1024;
const MAX_ICE = 8 * 1024;
const validId = (v) => /^[a-f\d]{24}$/i.test(String(v || ""));
const size = (v) => { try { return Buffer.byteLength(JSON.stringify(v)); } catch (_) { return Infinity; } };
const failure = (ack, message) => typeof ack === "function" && ack({ ok: false, message });

function assertSignalingTopology(env = process.env, { log = console.info } = {}) {
  if (String(env.CALL_SIGNALING_MULTI_INSTANCE || "").toLowerCase() === "true") {
    throw new Error("Legacy CALL_SIGNALING_MULTI_INSTANCE=true is unsupported without a real shared Socket.IO adapter.");
  }
  const production = env.NODE_ENV === "production";
  const configured = String(env.CALL_SIGNALING_MODE || "").trim().toLowerCase();
  if (production && !configured) {
    throw new Error("Production calling requires explicit CALL_SIGNALING_MODE=single-instance.");
  }
  const mode = configured || "single-instance";
  // Only this topology is implemented. Do not accept aspirational shared modes.
  if (mode !== "single-instance") {
    throw new Error(`Unsupported CALL_SIGNALING_MODE=${mode}; no shared Socket.IO adapter is configured.`);
  }
  if (!production && !configured) {
    log("[CALLING] Development signaling mode: single-instance.");
  }
  return mode;
}

function attachCallSignaling(server) {
  assertSignalingTopology();
  const io = new Server(server, { cors: { origin: process.env.SOCKET_CORS_ORIGIN ? process.env.SOCKET_CORS_ORIGIN.split(",") : true, credentials: true }, maxHttpBufferSize: 32 * 1024 });
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || String(socket.handshake.headers?.authorization || "").replace(/^Bearer\s+/i, "");
      if (!token || !process.env.JWT_SECRET) return next(new Error("Unauthorized"));
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const userId = decoded.id || decoded.userId || decoded._id;
      const user = await User.findById(userId).select("role status authTokenVersion");
      if (!user || user.role !== "CUSTOMER" || user.status !== "ACTIVE" || Number(decoded.authTokenVersion ?? 0) !== Number(user.authTokenVersion || 0)) return next(new Error("Unauthorized"));
      socket.userId = String(user._id);
      next();
    } catch (_) { next(new Error("Unauthorized")); }
  });
  io.on("connection", (socket) => {
    presence.add(socket.userId);
    socket.join(`call-user:${socket.userId}`);
    const relay = (event, validator) => async (payload = {}, ack) => {
      try {
        if (!validId(payload.callId) || !validator(payload)) return failure(ack, "Invalid signaling payload.");
        let call = await CallSession.findById(payload.callId).lean();
        if (!call || ![String(call.callerId), String(call.calleeId)].includes(socket.userId)) return failure(ack, "Call not found.");
        call = await calls.expire(call);
        if (!calls.ACTIVE.includes(call.state)) return failure(ack, "Call is not active.");
        const peerId = String(call.callerId) === socket.userId ? String(call.calleeId) : String(call.callerId);
        // Only the ephemeral signal is emitted. It is never written to MongoDB/logs.
        io.to(`call-user:${peerId}`).emit(event, { callId: String(call._id), [event === "call:sdp" ? "description" : "candidate"]: event === "call:sdp" ? payload.description : payload.candidate });
        if (typeof ack === "function") ack({ ok: true });
      } catch (_) { failure(ack, "Unable to relay signaling."); }
    };
    socket.on("call:sdp", relay("call:sdp", (p) => p.description && typeof p.description === "object" && ["offer", "answer", "rollback"].includes(p.description.type) && typeof p.description.sdp === "string" && p.description.sdp.length <= MAX_SDP && size(p.description) <= MAX_SDP));
    socket.on("call:ice", relay("call:ice", (p) => p.candidate && typeof p.candidate === "object" && typeof p.candidate.candidate === "string" && p.candidate.candidate.length <= MAX_ICE && size(p.candidate) <= MAX_ICE));
    socket.on("call:state", async (payload = {}, ack) => {
      if (!validId(payload.callId) || !["ACCEPTED", "DECLINED", "CANCELLED", "ENDED"].includes(payload.state)) return failure(ack, "Invalid call state.");
      try {
        const call = await calls.transition(payload.callId, socket.userId, payload.state, "SOCKET");
        const peerId = String(call.callerId) === socket.userId ? String(call.calleeId) : String(call.callerId);
        io.to(`call-user:${peerId}`).emit("call:state", { callId: String(call._id), state: call.state, endReason: call.endReason || "" });
        if (typeof ack === "function") ack({ ok: true, state: call.state });
      } catch (e) { failure(ack, e.message); }
    });
    socket.on("disconnect", async () => {
      presence.remove(socket.userId);
      // Keep multi-device users connected; otherwise close their active calls so
      // participant locks cannot survive a lost signaling connection.
      if (io.sockets.adapter.rooms.get(`call-user:${socket.userId}`)?.size) return;
      const active = await CallSession.find({ ...calls.participantQuery(socket.userId), state: { $in: calls.ACTIVE } }).select("_id callerId calleeId").lean();
      await Promise.all(active.map(async (call) => {
        try {
          const ended = await calls.transition(call._id, socket.userId, call.state === "RINGING" && String(call.calleeId) === socket.userId ? "DECLINED" : (call.state === "RINGING" ? "CANCELLED" : "ENDED"), "DISCONNECTED");
          const peerId = String(ended.callerId) === socket.userId ? String(ended.calleeId) : String(ended.callerId);
          io.to(`call-user:${peerId}`).emit("call:state", { callId: String(ended._id), state: ended.state, endReason: "DISCONNECTED" });
        } catch (_) { /* competing lifecycle action already resolved this call */ }
      }));
    });
  });
  const timer = setInterval(() => calls.cleanupExpired().then((changed) => {
    changed.forEach((call) => {
      const event = { callId: String(call._id), state: call.state, endReason: call.endReason || "" };
      io.to(`call-user:${call.callerId}`).emit("call:state", event);
      io.to(`call-user:${call.calleeId}`).emit("call:state", event);
    });
  }).catch(() => {}), Math.min(calls.RING_MS, 30_000));
  timer.unref();
  return io;
}
module.exports = { attachCallSignaling, assertSignalingTopology };