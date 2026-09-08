const test = require("node:test");
const assert = require("node:assert/strict");
const CallSession = require("../models/callSession.model");
const CallPrivacy = require("../models/callPrivacy.model");
const CallLock = require("../models/callLock.model");
const Notification = require("../models/notification.model");
const calls = require("../services/call.service");

const A = "507f1f77bcf86cd799439011";
const B = "507f1f77bcf86cd799439012";
let n = 0;
const oid = () => ({ toString: () => `507f1f77bcf86cd7994390${String(++n).padStart(2, "0")}` });
const lean = (value) => ({ lean: async () => value });
const originals = {};
for (const model of [CallSession, CallPrivacy, CallLock, Notification]) {
  originals[model.modelName] = {};
  for (const key of ["find", "findOne", "findById", "findOneAndUpdate", "create", "deleteOne", "deleteMany", "updateOne"]) originals[model.modelName][key] = model[key];
}
CallLock.find = () => lean([]);
test.after(() => {
  for (const model of [CallSession, CallPrivacy, CallLock, Notification]) Object.assign(model, originals[model.modelName]);
  calls.__resetTransactionRunnerForTests();
});

test("create rejects self calls before persistence", async () => {
  await assert.rejects(() => calls.createCall(A, A), { status: 400 });
});

test("create honours disabled privacy and bidirectional blocks", async () => {
  CallPrivacy.find = () => lean([{ userId: B, callsEnabled: false, blockedUserIds: [] }]);
  await assert.rejects(() => calls.createCall(A, B), { status: 403 });
  CallPrivacy.find = () => lean([{ userId: B, callsEnabled: true, blockedUserIds: [A] }]);
  await assert.rejects(() => calls.createCall(A, B), { status: 403 });
});

test("busy lock failure removes partial lock and orphan session", async () => {
  let deletedLocks = 0; let deletedSessions = 0;
  CallPrivacy.find = () => lean([]);
  CallSession.findOne = async () => null;
  CallSession.create = async (v) => ({ _id: oid(), ...v });
  CallLock.create = async () => { const e = new Error("duplicate"); e.code = 11000; throw e; };
  CallLock.deleteMany = async () => { deletedLocks++; };
  CallSession.deleteOne = async () => { deletedSessions++; };
  await assert.rejects(() => calls.createCall(A, B), { status: 409 });
  assert.equal(deletedLocks, 1); assert.equal(deletedSessions, 1);
});

test("acceptance extends both participant locks past the ringing deadline", async () => {
  // Keep this safely in the future: a 1ms deadline can legitimately expire
  // between fixture construction and transition(), which correctly invokes the
  // missed-call notification path and previously reached real Mongoose I/O.
  const call = { _id: oid(), callerId: A, calleeId: B, state: "RINGING", expiresAt: new Date(Date.now() + 60_000) };
  CallSession.findById = async () => call;
  CallSession.findOneAndUpdate = async (_filter, update) => ({ ...call, ...update.$set });
  Notification.updateOne = async () => {};
  const transactionSession = { marker: "transaction-session" };
  let committed = false;
  calls.__setTransactionRunnerForTests(async (work) => {
    const result = await work(transactionSession);
    committed = true;
    return result;
  });
  let lockUpdate;
  CallLock.updateMany = async (filter, update, options) => { lockUpdate = { filter, update, options }; return { matchedCount: 2, modifiedCount: 2 }; };
  const accepted = await calls.transition(call._id, B, "ACCEPTED");
  assert.equal(accepted.state, "ACCEPTED");
  assert.equal(committed, true);
  assert.equal(lockUpdate.options.session, transactionSession);
  assert.ok(lockUpdate.update.$set.expiresAt > call.expiresAt);
  assert.equal(lockUpdate.filter.userId.$in.length, 2);
});

test("acceptance transaction rejects and rolls back when both locks are not updated", async () => {
  const call = { _id: oid(), callerId: A, calleeId: B, state: "RINGING", expiresAt: new Date(Date.now() + 60_000) };
  CallSession.findById = async () => call;
  CallSession.findOneAndUpdate = async (_filter, update) => ({ ...call, ...update.$set });
  CallLock.updateMany = async () => ({ matchedCount: 1, modifiedCount: 1 });
  let rolledBack = false;
  calls.__setTransactionRunnerForTests(async (work) => {
    try { return await work({}); } catch (error) { rolledBack = true; throw error; }
  });
  await assert.rejects(() => calls.transition(call._id, B, "ACCEPTED"), { status: 409 });
  assert.equal(rolledBack, true);
});

test("expired ringing lock cleanup resolves its call before a new lease", async () => {
  const stale = { callId: oid() };
  const expired = { _id: stale.callId, callerId: A, calleeId: B, state: "RINGING", expiresAt: new Date(Date.now() - 1) };
  CallLock.find = () => lean([stale]);
  CallSession.findById = async () => expired;
  CallSession.findOneAndUpdate = async () => ({ ...expired, state: "MISSED" });
  let removed = 0; CallLock.deleteMany = async () => { removed++; };
  Notification.updateOne = async () => {};
  await calls.clearExpiredLocks([A, B]);
  assert.equal(removed, 1);
  CallLock.find = () => lean([]);
});

test("expired accepted lease is conditionally ended and released", async () => {
  const stale = { callId: oid() };
  const accepted = { _id: stale.callId, callerId: A, calleeId: B, state: "ACCEPTED", expiresAt: new Date(Date.now() - 9999), activeExpiresAt: new Date(Date.now() - 1) };
  CallLock.find = () => lean([stale]);
  CallSession.findById = async () => accepted;
  CallSession.findOneAndUpdate = async (_filter, update) => ({ ...accepted, ...update.$set });
  let removed = 0; CallLock.deleteMany = async () => { removed++; };
  const changed = await calls.clearExpiredLocks([A, B]);
  assert.equal(changed, undefined);
  assert.equal(removed, 1);
  CallLock.find = () => lean([]);
});

test("idempotency returns existing call without acquiring locks", async () => {
  const existing = { _id: oid(), callerId: A, calleeId: B, state: "RINGING" };
  CallPrivacy.find = () => lean([]);
  CallSession.findOne = async () => existing;
  let locks = 0; CallLock.create = async () => { locks++; };
  const result = await calls.createCall(A, B, "client-key");
  assert.equal(result.call, existing); assert.equal(result.idempotent, true); assert.equal(locks, 0);
});

test("only a participant may transition and invalid lifecycle transitions fail", async () => {
  const call = { _id: oid(), callerId: A, calleeId: B, state: "RINGING", expiresAt: new Date(Date.now() + 99999) };
  CallSession.findById = async () => call;
  await assert.rejects(() => calls.transition(call._id, "507f1f77bcf86cd799439099", "ACCEPTED"), { status: 404 });
  await assert.rejects(() => calls.transition(call._id, A, "ACCEPTED"), { status: 409 });
});

test("expired ringing call becomes missed and notification is deduped", async () => {
  const call = { _id: oid(), callerId: A, calleeId: B, state: "RINGING", expiresAt: new Date(Date.now() - 1) };
  const updates = []; let lockCleanup = 0;
  CallSession.findOneAndUpdate = async () => ({ ...call, state: "MISSED" });
  CallLock.deleteMany = async () => { lockCleanup++; };
  Notification.updateOne = async (filter) => { updates.push(filter); };
  const result = await calls.expire(call);
  assert.equal(result.state, "MISSED"); assert.equal(lockCleanup, 1);
  // updateOne is the idempotent notification write; the model's unique
  // dedupeKey index is asserted in the metadata contract test.
  assert.equal(updates.length, 1);
});