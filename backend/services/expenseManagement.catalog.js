"use strict";
const mongoose = require("mongoose");
const c = require("./expenseManagement.common");
const Role = require("../models/role.model");
const User = require("../models/user.model");
const { Registry, Event, r } = c;
function publicItem(row) {
  if (!row) return null;
  return { ...c.snapshot(row), id: String(row._id), _id: undefined };
}
const kindPermission = kind => kind === "CATEGORY" ? r.PERMISSIONS.categories :
  kind === "VENDOR" ? r.PERMISSIONS.vendors : r.PERMISSIONS.policy;
async function reviewerReferences() {
  const roles = await Role.find({
    status: "ACTIVE", scopeType: "GLOBAL", permissions: r.PERMISSIONS.approve,
  }).select("_id name").limit(200).lean();
  const users = await User.find({
    status: "ACTIVE", staffRoleId: { $in: roles.map(row => row._id) },
    role: { $in: ["HEAD_OFFICE", "STAFF"] },
    $or: [{ role: "HEAD_OFFICE" }, { isStaff: true }],
  }).select("_id fullName role staffRoleId").limit(500).lean();
  return {
    users: users.map(row => ({ id: String(row._id), fullName: row.fullName,
      role: row.role, staffRoleId: String(row.staffRoleId) })),
    roles: roles.map(row => ({ id: String(row._id), name: row.name })),
  };
}
function canAllocateReviewers(steps, reviewers, excludedIds) {
  const assigned = new Map(), excluded = new Set(excludedIds.map(String));
  function assign(stepIndex, seen) {
    const step = steps[stepIndex];
    for (const person of reviewers) {
      if (excluded.has(person.id) || seen.has(person.id) ||
          !(step.userIds.some(id => String(id) === person.id) ||
            step.roleIds.some(id => String(id) === person.staffRoleId))) continue;
      seen.add(person.id);
      if (!assigned.has(person.id) || assign(assigned.get(person.id), seen)) {
        assigned.set(person.id, stepIndex);
        return true;
      }
    }
    return false;
  }
  return steps.every((_step, index) => assign(index, new Set()));
}
async function references(actor) {
  c.allow(actor, r.PERMISSIONS.view);
  await c.storage.requireReady();
  const rows = await Registry.find({ kind: { $in: ["CATEGORY", "VENDOR"] } }).sort({ name: 1 }).limit(2000).lean();
  return {
    categories: rows.filter(row => row.kind === "CATEGORY").map(publicItem),
    vendors: rows.filter(row => row.kind === "VENDOR").map(publicItem),
    approvers: actor.role === "HEAD_OFFICE" && actor.permissions.includes(r.PERMISSIONS.policy)
      ? await reviewerReferences() : { users: [], roles: [] },
  };
}
async function list(kind, actor) {
  if (!["CATEGORY", "VENDOR"].includes(kind)) throw r.fail("Invalid registry type.");
  c.allow(actor, r.PERMISSIONS.view);
  await c.storage.requireReady();
  return { items: (await Registry.find({ kind }).sort({ name: 1 }).limit(2000).lean()).map(publicItem) };
}
async function policy(actor) {
  c.allow(actor, r.PERMISSIONS.view);
  await c.storage.requireReady();
  return { policy: publicItem(await Registry.findOne({ kind: "POLICY", key: "APPROVAL" }).lean()) };
}
function registryInput(kind, input) {
  const active = input.active === undefined ? true : input.active;
  if (typeof active !== "boolean") throw r.fail("Active must be true or false.");
  const data = {
    kind, name: r.text(input.name, kind === "CATEGORY" ? "Category name" : "Vendor name", 180),
    description: r.text(input.description, "Description", 2000, false), active,
  };
  data.key = r.normalizedKey(data.name);
  if (kind === "VENDOR") {
    for (const [field, maximum] of [["contactName", 180], ["email", 254], ["phone", 40], ["address", 1000]]) {
      data[field] = r.text(input[field], field, maximum, false);
    }
    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) throw r.fail("Vendor email is invalid.");
  }
  return data;
}
async function write(kind, id, input, actor, key) {
  c.allow(actor, kindPermission(kind));
  if (!["CATEGORY", "VENDOR", "POLICY"].includes(kind)) throw r.fail("Invalid registry type.");
  if (kind === "POLICY" && actor.role !== "HEAD_OFFICE") throw r.fail("Only authorized Head Office can configure expense approvals.", 403);
  const note = c.reason(input.reason);
  const data = kind === "POLICY"
    ? { kind, key: "APPROVAL", name: "Expense approval policy", active: true,
      approvalSteps: r.approvalSteps(input.approvalSteps) }
    : registryInput(kind, input);
  if (kind === "POLICY") {
    const reviewers = await reviewerReferences();
    const users = new Set(reviewers.users.map(row => row.id)), roles = new Set(reviewers.roles.map(row => row.id));
    if (data.approvalSteps.some(step => step.userIds.some(value => !users.has(value)) ||
        step.roleIds.some(value => !roles.has(value)))) {
      throw r.fail("Every selected reviewer must be active and explicitly authorized to approve expenses.");
    }
  }
  const requestKey = r.requestKey(key, actor.id), requestHash = r.hash({ kind, id, input });
  let result;
  try {
    result = await c.atomic(async session => {
      const prior = await Event.findOne({ requestKey }).session(session).lean();
      if (prior) {
        if (prior.requestHash !== requestHash) throw r.fail("This registry request key has different details.", 409);
        return Registry.findById(prior.subjectId).session(session).lean();
      }
      const before = kind === "POLICY"
        ? await Registry.findOne({ kind, key: "APPROVAL" }).session(session).lean()
        : id ? await Registry.findOne({ _id: r.id(id), kind }).session(session).lean() : null;
      if (id && !before) throw r.fail("Registry record was not found.", 404);
      if (before && before.revision !== r.expectedVersion(input.expectedVersion)) throw r.fail("This registry record changed; refresh first.", 409);
      if (!before && kind === "POLICY" && input.expectedVersion !== -1) throw r.fail("Refresh the unconfigured approval policy first.", 409);
      const next = { ...before, ...data, _id: before?._id || new mongoose.Types.ObjectId(),
        createdBy: before?.createdBy || actor.id, updatedBy: actor.id, createdAt: before?.createdAt || new Date(),
        updatedAt: new Date(), revision: before ? before.revision + 1 : 0 };
      const audit = await c.append({
        subjectType: "REGISTRY", subjectId: next._id, version: next.revision,
        action: `EXPENSE_${kind}_${before ? "UPDATED" : "CREATED"}`, actor, reason: note,
        before, after: next, previousHash: before?.lastAuditHash || c.ZERO_HASH, requestKey, requestHash,
      }, session);
      next.lastAuditHash = audit.eventHash;
      if (!before) await Registry.create([next], { session });
      else {
        const { _id, __v, createdAt, ...fields } = next;
        const changed = await Registry.updateOne({ _id: next._id, revision: before.revision },
          { $set: fields }, { session, runValidators: true });
        if (changed.matchedCount !== 1) throw r.fail("Registry was changed concurrently.", 409);
      }
      return next;
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    const prior = await Event.findOne({ requestKey }).lean();
    if (prior?.requestHash === requestHash) result = await Registry.findById(prior.subjectId).lean();
    else throw r.fail("A matching category, vendor or approval policy already exists.", 409);
  }
  return kind === "POLICY" ? { policy: publicItem(result) } : { item: publicItem(result) };
}
module.exports = { references, list, policy, write, publicItem, reviewerReferences, canAllocateReviewers };
