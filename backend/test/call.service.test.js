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
test.after(() => {
  for (const model of [CallSession, CallPrivacy, CallLock, Notification]) Object.assign(model, originals[model.modelName]);
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