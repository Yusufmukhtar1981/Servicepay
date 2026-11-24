"use strict";
const mongoose = require("mongoose");
const c = require("./expenseManagement.common");
const access = require("./expenseRequests.access");
const Role = require("../models/role.model");
const User = require("../models/user.model");
const expenseGrants = require("./expenseRequests.grants");
const { r, Registry, Event } = c;
const PREFIX = "DEPARTMENT:";
function authorize(actor) {
  if (!access.capabilities(actor).canConfigurePolicies) throw r.fail("Explicit Head Office approval-policy permission is required.", 403);
}
async function people() {
  const roles = await Role.find({ status: "ACTIVE" }).select("_id name scopeType department permissions").limit(1001).lean();
  if (roles.length > 1000) throw r.fail("Narrow staff assignments before configuring policies.", 422);
  const byId = new Map(roles.map(role => [String(role._id), role]));
  const users = await User.find({ status: "ACTIVE", staffRoleId: { $in: roles.map(role => role._id) },
    role: { $in: ["HEAD_OFFICE", "STAFF"] }, $or: [{ role: "HEAD_OFFICE" }, { isStaff: true }] })
    .select("_id fullName role staffRoleId").limit(1001).lean();
  if (users.length > 1000) throw r.fail("Narrow staff assignments before configuring policies.", 422);
  const overrides = await Registry.find({ kind: "POLICY", active: true,
    key: { $in: users.map(user => expenseGrants.keyFor(String(user._id))) } }).lean();
  const grantsByUser = new Map(overrides.map(row => [String(row.staffUserId), row]));
  return users.map(user => {
    const role = byId.get(String(user.staffRoleId));
    const permissions = [...new Set([...(role.permissions || []),
      ...expenseGrants.permissions(grantsByUser.get(String(user._id)), role._id)])];
    const global = role.scopeType === "GLOBAL";
    return { id: String(user._id), fullName: user.fullName, roleId: String(role._id),
      department: role.department ? access.department(role.department) : "", scope: role.scopeType,
      capabilities: {
        requester: permissions.includes(r.PERMISSIONS.request) || (global && permissions.includes(r.PERMISSIONS.create)),
        departmentManager: global && permissions.includes(r.PERMISSIONS.department),
        approver: global && permissions.includes(r.PERMISSIONS.approve),
        finance: global && permissions.includes(r.PERMISSIONS.pay),
      } };
  });
}
async function list(actor) {
  authorize(actor);
  await c.storage.requireReady();
  const [items, staff] = await Promise.all([
    Registry.find({ kind: "POLICY", key: { $regex: `^${PREFIX}` } }).sort({ name: 1 }).limit(1001).lean(), people(),
  ]);
  if (items.length > 1000) throw r.fail("Narrow approval policies before configuring more.", 422);
  return { items: items.map(publicPolicy), people: staff,
    departments: [...new Set([...access.DEPARTMENTS, ...staff.map(person => person.department).filter(Boolean),
      ...items.flatMap(item => item.departments || [])])] };
}
const publicPolicy = row => ({ ...c.snapshot(row), id: String(row._id), _id: undefined });
function validate(input, staff) {
  if (typeof input.active !== "boolean") throw r.fail("Choose whether this policy is active.");
  const departments = input.departments || [];
  if (!Array.isArray(departments) || departments.length > 50) throw r.fail("Select valid policy departments.");
  const data = { name: r.text(input.name, "Policy name", 180),
    description: r.text(input.description, "Description", 2000, false), active: input.active,
    departments: [...new Set(departments.map(access.department))],
    minimumAmountMinor: input.minimumAmount ? r.amountMinor(input.minimumAmount) : null,
    maximumAmountMinor: input.maximumAmount ? r.amountMinor(input.maximumAmount) : null,
    approvalSteps: [],
  };
  if (!Array.isArray(input.approvalSteps) || input.approvalSteps.length > 8) throw r.fail("Configure at most eight approval levels.");
  const eligible = new Set(staff.filter(person => person.capabilities.approver).map(person => person.id));
  data.approvalSteps = input.approvalSteps.map(step => {
    const userIds = r.ids(step.userIds, "Primary reviewers", 50), backupUserIds = r.ids(step.backupUserIds, "Backup reviewers", 50);
    if (step.roleIds?.length) throw r.fail("Assign named independent reviewers to department policies.");
    if (new Set([...userIds, ...backupUserIds]).size !== userIds.length + backupUserIds.length) throw r.fail("Primary and backup reviewers must be different.");
    if ([...userIds, ...backupUserIds].some(id => !eligible.has(id))) throw r.fail("Selected reviewers must be active with explicit global approval permission.");
    if (data.active && !userIds.length) throw r.fail("Every active approval level needs an authorized primary reviewer.");
    return { label: r.text(step.label, "Approval level", 100), userIds, backupUserIds, roleIds: [] };
  });
  if (data.minimumAmountMinor && data.maximumAmountMinor && data.minimumAmountMinor > data.maximumAmountMinor) throw r.fail("Minimum approval limit exceeds maximum.");
  if (data.active && (!data.departments.length || !data.minimumAmountMinor || !data.maximumAmountMinor || !data.approvalSteps.length)) {
    throw r.fail("Activation requires departments, explicit NGN limits and independently authorized reviewers.");
  }
  if (data.active && !require("./expenseManagement.catalog").canAllocateReviewers(
    data.approvalSteps.map(step => ({ ...step, userIds: [...step.userIds, ...step.backupUserIds] })),
    staff.filter(person => person.capabilities.approver).map(person => ({ ...person, staffRoleId: person.roleId })), [])) {
    throw r.fail("Configure enough distinct independent reviewers for all approval levels.");
  }
  return data;
}
async function write(id, input, actor, key) {
  authorize(actor);
  const note = c.reason(input.reason), staff = await people(), data = validate(input, staff);
  const requestKey = r.requestKey(key, actor.id), requestHash = r.hash({ id, input });
  const result = await c.atomic(async session => {
    const prior = await Event.findOne({ requestKey }).session(session).lean();
    if (prior) {
      if (prior.requestHash !== requestHash) throw r.fail("Policy request key has different details.", 409);
      return Registry.findById(prior.subjectId).session(session).lean();
    }
    // Serialize interval validation with the existing registry unique key. This
    // does not create indexes, backfill old policies, or change any balances.
    await Registry.findOneAndUpdate({ kind: "POLICY", key: "DEPARTMENT_POLICY_GATE" },
      { $inc: { policyEpoch: 1 }, $setOnInsert: {
        name: "Department policy concurrency guard", active: false, revision: 0,
        createdBy: actor.id, updatedBy: actor.id, lastAuditHash: c.ZERO_HASH,
      } }, { upsert: true, session, setDefaultsOnInsert: false });
    const before = id ? await Registry.findOne({ _id: r.id(id), kind: "POLICY",
      key: { $regex: `^${PREFIX}` } }).session(session).lean() : null;
    if (id && !before) throw r.fail("Approval policy was not found.", 404);
    if (input.expectedVersion !== (before?.revision ?? -1)) throw r.fail("Approval policy changed; refresh first.", 409);
    if (data.active) {
      const conflict = await Registry.findOne({ kind: "POLICY", key: { $regex: `^${PREFIX}` },
        _id: { $ne: before?._id || new mongoose.Types.ObjectId() }, active: true,
        departments: { $in: data.departments }, minimumAmountMinor: { $lte: data.maximumAmountMinor },
        maximumAmountMinor: { $gte: data.minimumAmountMinor } }).session(session).lean();
      if (conflict) throw r.fail("An active policy already covers these department and amount limits. Deactivate or adjust it first.", 409);
    }
    const _id = before?._id || new mongoose.Types.ObjectId();
    const next = { ...before, ...data, _id, kind: "POLICY", key: `${PREFIX}${_id}`,
      revision: before ? before.revision + 1 : 0, createdBy: before?.createdBy || actor.id,
      updatedBy: actor.id, createdAt: before?.createdAt || new Date(), updatedAt: new Date() };
    const audit = await c.append({ subjectType: "REGISTRY", subjectId: _id,
      version: next.revision, action: "DEPARTMENT_APPROVAL_POLICY_SAVED", actor, reason: note,
      before, after: next, previousHash: before?.lastAuditHash || c.ZERO_HASH, requestKey, requestHash }, session);
    next.lastAuditHash = audit.eventHash;
    if (!before) await Registry.create([next], { session });
    else {
      const { _id: ignored, __v, createdAt, ...fields } = next;
      const changed = await Registry.updateOne({ _id, revision: before.revision }, { $set: fields }, { session, runValidators: true });
      if (changed.matchedCount !== 1) throw r.fail("Policy changed concurrently.", 409);
    }
    return next;
  });
  return { policy: publicPolicy(result) };
}
async function assignment(input, actor, key) {
  authorize(actor);
  const note = c.reason(input.reason), userId = r.id(input.userId, "Staff member");
  const requested = input.capabilities;
  const grants = {
    requester: [r.PERMISSIONS.request], departmentManager: [r.PERMISSIONS.department],
    approver: [r.PERMISSIONS.approve],
    finance: [r.PERMISSIONS.view, r.PERMISSIONS.pay, r.PERMISSIONS.documents],
  };
  if (!requested || Object.keys(requested).some(value => !Object.hasOwn(grants, value) || typeof requested[value] !== "boolean") ||
      !Object.values(requested).some(Boolean)) throw r.fail("Select the expense capabilities to grant.");
  const permissions = [...new Set(Object.keys(grants).filter(value => requested[value]).flatMap(value => grants[value]))];
  if (permissions.some(permission => {
    if (permission === r.PERMISSIONS.request) return !access.has(actor, permission) && !access.has(actor, r.PERMISSIONS.create);
    if (permission === r.PERMISSIONS.department) return !access.has(actor, permission) && !access.has(actor, r.PERMISSIONS.view);
    return !access.has(actor, permission);
  })) throw r.fail("Head Office cannot delegate expense authority it does not explicitly hold.", 403);
  const requestKey = r.requestKey(key, actor.id), requestHash = r.hash(input);
  return c.atomic(async session => {
    const prior = await Event.findOne({ requestKey }).session(session).lean();
    if (prior) {
      if (prior.requestHash !== requestHash) throw r.fail("Assignment key has different details.", 409);
      return { assigned: true, idempotent: true };
    }
    const user = await User.findOne({ _id: userId, status: "ACTIVE", role: { $in: ["HEAD_OFFICE", "STAFF"] },
      $or: [{ role: "HEAD_OFFICE" }, { isStaff: true }] }).session(session).lean();
    const role = user && await Role.findOne({ _id: user.staffRoleId, status: "ACTIVE" }).session(session).lean();
    if (!role || String(role._id) !== input.expectedRoleId) throw r.fail("Staff assignment changed or is inactive; refresh first.", 409);
    if ((requested.approver || requested.finance || requested.departmentManager) && role.scopeType !== "GLOBAL") {
      throw r.fail("This capability requires an existing GLOBAL staff role. No role scope was changed.", 409);
    }
    if (!role.department && requested.departmentManager) throw r.fail("Assign a department in Staff Management first.");
    // Bind expense-only grants to this person AND their current role. Never
    // clone/rename canonical roles or broaden a shared role's permissions.
    const recordKey = expenseGrants.keyFor(userId);
    const before = await Registry.findOne({ kind: "POLICY", key: recordKey }).session(session).lean();
    const previous = expenseGrants.permissions(before, role._id);
    const next = { ...before, _id: before?._id || new mongoose.Types.ObjectId(),
      kind: "POLICY", key: recordKey, name: "Individual expense capabilities", active: true,
      staffUserId: user._id, staffRoleId: role._id,
      expenseGrants: [...new Set([...previous, ...permissions])],
      createdBy: before?.createdBy || actor.id, updatedBy: actor.id,
      revision: before ? before.revision + 1 : 0,
      createdAt: before?.createdAt || new Date(), updatedAt: new Date() };
    const audit = await c.append({ subjectType: "REGISTRY", subjectId: next._id, version: next.revision,
      action: "EXPENSE_STAFF_CAPABILITIES_GRANTED", actor, reason: note, before, after: next,
      previousHash: before?.lastAuditHash || c.ZERO_HASH, requestKey, requestHash }, session);
    next.lastAuditHash = audit.eventHash;
    if (!before) await Registry.create([next], { session });
    else {
      const { _id, __v, createdAt, ...fields } = next;
      const changed = await Registry.updateOne({ _id, revision: before.revision }, { $set: fields },
        { session, runValidators: true });
      if (changed.matchedCount !== 1) throw r.fail("Expense assignment changed concurrently.", 409);
    }
    return { assigned: true, navigationRefreshRequired: true };
  });
}
async function forRequest(item, actor, session) {
  const policies = await Registry.find({ kind: "POLICY", key: { $regex: `^${PREFIX}` }, active: true,
    departments: item.department, minimumAmountMinor: { $lte: item.amountMinor },
    maximumAmountMinor: { $gte: item.amountMinor } }).limit(2).session(session).lean();
  if (policies.length !== 1) throw r.fail("Head Office must configure one active approval policy covering this department and amount.", 409);
  const policy = policies[0], staff = await people();
  const eligible = staff.filter(person => person.capabilities.approver);
  const steps = policy.approvalSteps.map(step => ({ ...step,
    userIds: [...(step.userIds || []), ...(step.backupUserIds || [])], roleIds: [] }));
  if (!require("./expenseManagement.catalog").canAllocateReviewers(steps,
    eligible.map(person => ({ ...person, staffRoleId: person.roleId })), [item.createdBy, actor.id])) {
    throw r.fail("There are not enough active independent reviewers for this request. No payment was initiated.", 409);
  }
  return { policyId: policy._id, policyName: policy.name, policyVersion: policy.revision,
    steps: policy.approvalSteps };
}
module.exports = { list, write, assignment, forRequest, people, authorize, validate };
