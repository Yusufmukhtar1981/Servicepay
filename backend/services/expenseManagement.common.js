"use strict";
const mongoose = require("mongoose");
const models = require("../models/expenseManagement.models");
const r = require("./expenseManagement.rules");
const storage = require("./expenseManagement.storage");
const ZERO_HASH = "0".repeat(64);
function allow(actor, permission) {
  if (!actor?.id || actor.scope !== "GLOBAL" || !actor.permissions?.includes(permission)) {
    throw r.fail("Explicit global finance permission is required.", 403, "EXPENSE_PERMISSION_REQUIRED");
  }
}
function context(req) {
  return {
    id: String(req.user?._id || ""),
    name: String(req.user?.fullName || req.user?.name || "Staff"),
    role: String(req.user?.role || ""),
    roleId: req.staffRole?._id ? String(req.staffRole._id) : null,
    scope: req.staffAccess?.scope?.type,
    permissions: (req.staffRole?.permissions || []).filter(value => Object.values(r.PERMISSIONS).includes(value)),
  };
}
function reason(value) {
  const result = r.text(value, "Audit reason", 2000);
  if (result.length < 10) throw r.fail("Provide an audit reason of at least 10 characters.");
  return result;
}
function plain(value) { return value?.toObject ? value.toObject() : value; }
function snapshot(value) {
  if (!value) return null;
  const { requestKey, requestHash, dedupKey, uploadRequestKey, storageKey, lastAuditHash, __v, ...safe } = plain(value);
  return r.canonical(safe);
}
function event({ subjectType, subjectId, version, action, actor, reason: note, before, after,
  previousHash = ZERO_HASH, requestKey, requestHash, at = new Date() }) {
  const result = {
    subjectType, subjectId: String(subjectId), action, actorId: actor.id,
    actorRole: actor.role, actorName: actor.name, reason: note, at, previousHash,
    before: snapshot(before), after: snapshot(after),
  };
  if (version !== undefined) result.version = version;
  if (requestKey) { result.requestKey = requestKey; result.requestHash = requestHash; }
  return { ...result, eventHash: r.hash(result) };
}
async function atomic(callback) {
  await storage.requireReady();
  const session = await mongoose.startSession();
  try { return await session.withTransaction(() => callback(session)); }
  finally { await session.endSession(); }
}
async function append(input, session) {
  const row = event(input);
  await models.Event.create([row], session ? { session } : {});
  return row;
}
async function documents(ids, actor, expenseId, session) {
  if (!ids.length) return [];
  const query = models.Document.find({ _id: { $in: ids } });
  if (session) query.session(session);
  const rows = await query.lean();
  if (rows.length !== ids.length || rows.some(row => {
    if (!["READY", "ATTACHED"].includes(row.state)) return true;
    if (row.expenseId) return String(row.expenseId) !== String(expenseId);
    return String(row.uploadedBy) !== String(actor.id);
  })) throw r.fail("A supporting document is unavailable or belongs to another expense.", 409, "EXPENSE_DOCUMENT_CONFLICT");
  return rows;
}
async function attach(ids, expenseId, session) {
  if (!ids.length) return;
  await models.Document.updateMany({ _id: { $in: ids } },
    { $set: { expenseId, state: "ATTACHED" } }, { session });
}
function documentMetadata(row) {
  return { id: String(row._id), name: row.name, mimeType: row.mimeType, size: row.size,
    sha256: row.sha256, state: row.state };
}
function actions(item, actor) {
  const granted = permission => actor.permissions.includes(permission);
  const result = [];
  if (["SUBMITTED", "REJECTED"].includes(item.status)) {
    if (granted(r.PERMISSIONS.update)) result.push("EDIT");
    if (granted(r.PERMISSIONS.create)) result.push("SUBMIT");
  }
  if (granted(r.PERMISSIONS.approve) && r.canApprove(item, actor)) result.push("APPROVE", "REJECT");
  if (item.status === "APPROVED" && granted(r.PERMISSIONS.pay)) result.push("PAY");
  if (!["PAID", "REVERSED", "CANCELLED"].includes(item.status) && granted(r.PERMISSIONS.cancel)) result.push("CANCEL");
  if (item.status === "PAID" && granted(r.PERMISSIONS.cancel) && granted(r.PERMISSIONS.pay)) result.push("REVERSE");
  return result;
}
async function publicExpense(value, actor) {
  const item = plain(value);
  const rows = item.documentIds?.length
    ? await models.Document.find({ _id: { $in: item.documentIds } }).lean() : [];
  return {
    ...snapshot(item), id: String(item._id), _id: undefined,
    categoryId: String(item.categoryId), vendorId: item.vendorId ? String(item.vendorId) : null,
    createdBy: String(item.createdBy), submittedBy: item.submittedBy ? String(item.submittedBy) : null,
    documents: rows.map(documentMetadata), actions: actions(item, actor),
  };
}
module.exports = { ...models, r, storage, ZERO_HASH, allow, context, reason, plain, snapshot,
  event, atomic, append, documents, attach, documentMetadata, actions, publicExpense };
