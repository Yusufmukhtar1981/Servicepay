const mongoose = require("mongoose");
const CallSession = require("../models/callSession.model");
const CallPrivacy = require("../models/callPrivacy.model");
const CallLock = require("../models/callLock.model");
const Notification = require("../models/notification.model");

const RING_MS = Math.max(10_000, Number(process.env.CALL_RING_TIMEOUT_MS) || 45_000);
const MAX_DURATION_MS = Math.min(4 * 60 * 60 * 1000, Math.max(60_000, Number(process.env.CALL_MAX_DURATION_MS) || 60 * 60 * 1000));
const ACTIVE = ["RINGING", "ACCEPTED"];
const id = (value) => String(value);
const participantQuery = (userId) => ({ $or: [{ callerId: userId }, { calleeId: userId }] });
let transactionRunner = async (work) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await work(session); });
    return result;
  } finally {
    await session.endSession();
  }
};

const publicCall = (call, viewer) => ({
  id: id(call._id), state: call.state, startedAt: call.startedAt, answeredAt: call.answeredAt,
  endedAt: call.endedAt, endReason: call.endReason || "", expiresAt: call.expiresAt,
  direction: id(call.callerId) === id(viewer) ? "OUTGOING" : "INCOMING",
  peerId: id(call.callerId) === id(viewer) ? id(call.calleeId) : id(call.callerId),
});

async function releaseLocks(call) {
  await CallLock.deleteMany({ callId: call._id });
}
async function clearExpiredLocks(userIds) {
  const locks = await CallLock.find({ userId: { $in: userIds }, expiresAt: { $lte: new Date() } }).lean();
  for (const lock of locks) {
    const call = await CallSession.findById(lock.callId);
    if (!call || ["DECLINED", "CANCELLED", "ENDED", "MISSED", "FAILED"].includes(call.state)) {
      await CallLock.deleteMany({ callId: lock.callId });
    } else if (call.state === "RINGING" && call.expiresAt <= new Date()) {
      await missed(call);
    } else if (call.state === "ACCEPTED" && call.activeExpiresAt && call.activeExpiresAt <= new Date()) {
      // An accepted call may only be displaced when its bounded active lease is
      // itself expired. transition() conditionally ends it and releases both locks.
      await transition(call._id, call.callerId, "ENDED", "MAX_DURATION").catch(() => {});
    }
  }
}
async function missed(call) {
  if (call.state !== "RINGING") return call;
  const changed = await CallSession.findOneAndUpdate(
    { _id: call._id, state: "RINGING" },
    { $set: { state: "MISSED", endedAt: new Date(), endReason: "NO_ANSWER" } },
    { new: true }
  );
  if (!changed) return call;
  await releaseLocks(changed);
  await Notification.updateOne(
    { dedupeKey: `missed-call:${changed._id}` },
    { $setOnInsert: { userId: changed.calleeId, title: "Missed call", message: "You missed a ServicePay call.", type: "CALL", category: "OTHER", referenceId: changed._id, referenceType: "CALL_SESSION", reference: String(changed._id), dedupeKey: `missed-call:${changed._id}` } },
    { upsert: true }
  );
  return changed;
}
async function expire(call) {
  if (call.state === "RINGING" && new Date(call.expiresAt) <= new Date()) return missed(call);
  return call;
}
async function createCall(callerId, calleeId, requestKey = "") {
  if (!mongoose.Types.ObjectId.isValid(calleeId) || id(callerId) === id(calleeId)) {
    const error = new Error("A different valid customer is required."); error.status = 400; throw error;
  }
  const privacy = await CallPrivacy.find({ userId: { $in: [callerId, calleeId] } }).lean();
  const mine = privacy.find((p) => id(p.userId) === id(callerId));
  const theirs = privacy.find((p) => id(p.userId) === id(calleeId));
  if (mine?.callsEnabled === false || theirs?.callsEnabled === false ||
    mine?.blockedUserIds?.some((u) => id(u) === id(calleeId)) ||
    theirs?.blockedUserIds?.some((u) => id(u) === id(callerId))) {
    const error = new Error("This customer is unavailable for calls."); error.status = 403; throw error;
  }
  const cleanKey = String(requestKey || "").trim().slice(0, 120);
  if (cleanKey) {
    const prior = await CallSession.findOne({ callerId, requestKey: cleanKey });
    if (prior) return { call: prior, idempotent: true };
  }
  // TTL deletion is asynchronous. Resolve only demonstrably expired ringing
  // calls/terminal remnants before the unique participant locks are acquired.
  await clearExpiredLocks([callerId, calleeId]);
  const now = new Date(); const expiresAt = new Date(now.getTime() + RING_MS);
  let call;
  try { call = await CallSession.create({ callerId, calleeId, expiresAt, requestKey: cleanKey || undefined }); }
  catch (error) {
    if (error?.code === 11000 && cleanKey) return { call: await CallSession.findOne({ callerId, requestKey: cleanKey }), idempotent: true };
    throw error;
  }
  try {
    await CallLock.create([{ userId: callerId, callId: call._id, expiresAt }, { userId: calleeId, callId: call._id, expiresAt }]);
  } catch (error) {
    // insertMany can have inserted the first lock before a duplicate on the
    // second participant; remove it before reporting the conflict.
    await CallLock.deleteMany({ callId: call._id });
    await CallSession.deleteOne({ _id: call._id });
    if (error?.code === 11000) { const busy = new Error("One of the participants is already in a call."); busy.status = 409; throw busy; }
    throw error;
  }
  return { call, idempotent: false };
}
async function transition(callId, userId, next, reason = "") {
  let call = await CallSession.findById(callId);
  if (!call || ![id(call.callerId), id(call.calleeId)].includes(id(userId))) { const e = new Error("Call not found."); e.status = 404; throw e; }
  call = await expire(call);
  const isCallee = id(call.calleeId) === id(userId);
  const permitted = (next === "ACCEPTED" && isCallee && call.state === "RINGING") ||
    (next === "DECLINED" && isCallee && call.state === "RINGING") ||
    (next === "CANCELLED" && !isCallee && call.state === "RINGING") ||
    (next === "ENDED" && ACTIVE.includes(call.state));
  if (!permitted) { const e = new Error("Invalid call state transition."); e.status = 409; throw e; }
  const terminal = !["ACCEPTED"].includes(next);
  const acceptedUntil = new Date(Date.now() + MAX_DURATION_MS);
  const update = { state: next, ...(next === "ACCEPTED" ? { answeredAt: new Date(), activeExpiresAt: acceptedUntil } : {}), ...(terminal ? { endedAt: new Date(), endReason: String(reason).slice(0, 80) } : {}) };
  if (next === "ACCEPTED") {
    return transactionRunner(async (session) => {
      const accepted = await CallSession.findOneAndUpdate(
        { _id: call._id, state: "RINGING" },
        { $set: update },
        { new: true, session }
      );
      if (!accepted) {
        const error = new Error("Call changed; retry.");
        error.status = 409;
        throw error;
      }
      const refreshed = await CallLock.updateMany(
        { callId: call._id, userId: { $in: [call.callerId, call.calleeId] } },
        { $set: { expiresAt: acceptedUntil } },
        { session }
      );
      if (refreshed.matchedCount !== 2 || refreshed.modifiedCount !== 2) {
        const error = new Error("Unable to secure both participant leases.");
        error.status = 409;
        throw error;
      }
      return accepted;
    });
  }
  call = await CallSession.findOneAndUpdate({ _id: call._id, state: call.state }, { $set: update }, { new: true });
  if (!call) { const e = new Error("Call changed; retry."); e.status = 409; throw e; }
  if (terminal) await releaseLocks(call);
  return call;
}
async function cleanupExpired() {
  const calls = await CallSession.find({ state: "RINGING", expiresAt: { $lte: new Date() } });
  const missedCalls = await Promise.all(calls.map(missed));
  const active = await CallSession.find({ state: "ACCEPTED", activeExpiresAt: { $lte: new Date() } });
  const ended = await Promise.all(active.map((call) => transition(call._id, call.callerId, "ENDED", "MAX_DURATION").catch(() => null)));
  return [...missedCalls, ...ended].filter(Boolean);
}
async function terminateForUser(userId, reason = "PRIVACY_CHANGED") {
  const active = await CallSession.find({ ...participantQuery(userId), state: { $in: ACTIVE } });
  return Promise.all(active.map((call) => transition(call._id, userId, call.state === "RINGING" && String(call.calleeId) === String(userId) ? "DECLINED" : (call.state === "RINGING" ? "CANCELLED" : "ENDED"), reason).catch(() => null)));
}
function __setTransactionRunnerForTests(runner) { transactionRunner = runner; }
function __resetTransactionRunnerForTests() {
  transactionRunner = async (work) => {
    const session = await mongoose.startSession();
    try {
      let result;
      await session.withTransaction(async () => { result = await work(session); });
      return result;
    } finally { await session.endSession(); }
  };
}
module.exports = { RING_MS, MAX_DURATION_MS, ACTIVE, publicCall, createCall, transition, cleanupExpired, expire, participantQuery, missed, clearExpiredLocks, terminateForUser, __setTransactionRunnerForTests, __resetTransactionRunnerForTests };