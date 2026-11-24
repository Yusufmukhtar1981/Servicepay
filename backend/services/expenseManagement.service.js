"use strict";
const mongoose = require("mongoose");
const c = require("./expenseManagement.common");
const { Expense, Registry, Event, r } = c;
const permissionForAction = {
  SUBMIT: r.PERMISSIONS.create, APPROVE: r.PERMISSIONS.approve,
  REJECT: r.PERMISSIONS.approve, PAY: r.PERMISSIONS.pay,
  CANCEL: r.PERMISSIONS.cancel, REVERSE: r.PERMISSIONS.cancel,
};
async function find(id, session) {
  const query = Expense.findById(r.id(id, "Expense ID"));
  if (session) query.session(session);
  const item = await query.lean();
  if (!item) throw r.fail("Expense was not found.", 404, "EXPENSE_NOT_FOUND");
  if (item.recordType === "DEPARTMENT_REQUEST") {
    throw r.fail("Use Expense Requests for this record; legacy expense actions cannot modify it.", 409);
  }
  return item;
}
async function normalizedDetails(input, actor, expenseId, session) {
  const data = r.expense(input);
  const Audit = require("../models/adminAuditLog.model");
  const legacy = require("./financialControl.rules");
  if (await Audit.findOne({ _id: legacy.expenseReferenceId(data.reference),
    action: "FINANCIAL_EXPENSE_RECORDED" }).select("_id").session(session).lean()) {
    throw r.fail("This reference is already recorded in historical expenses. Review that record instead of recording it again.",
      409, "EXPENSE_LEGACY_DUPLICATE");
  }
  if (data.evidenceExceptionReason) c.allow(actor, r.PERMISSIONS.exception);
  const category = await Registry.findOne({ _id: data.categoryId, kind: "CATEGORY", active: true }).session(session).lean();
  if (!category) throw r.fail("Select an active expense category.");
  const vendor = data.vendorId
    ? await Registry.findOne({ _id: data.vendorId, kind: "VENDOR", active: true }).session(session).lean() : null;
  if (data.vendorId && !vendor) throw r.fail("Select an active vendor.");
  await c.documents(data.documentIds, actor, expenseId, session);
  const { evidenceExceptionReason, ...details } = data;
  return {
    ...details, categoryName: category.name, vendorName: vendor?.name || "",
    evidenceException: evidenceExceptionReason ? {
      reason: evidenceExceptionReason, authorizedBy: actor.id, authorizedAt: new Date(),
    } : undefined,
    dedupKey: r.hash({ vendor: data.vendorId || r.normalizedKey(data.beneficiary),
      reference: r.normalizedKey(data.reference) }),
  };
}
async function create(input, actor, key) {
  c.allow(actor, r.PERMISSIONS.create);
  const requestKey = r.requestKey(key, actor.id), requestHash = r.hash(r.expense(input));
  let outcome;
  try {
    outcome = await c.atomic(async session => {
      const prior = await Expense.findOne({ requestKey }).session(session).lean();
      if (prior) {
        if (prior.requestHash !== requestHash) throw r.fail("This request key was already used with different expense details.", 409);
        return { item: prior, idempotent: true };
      }
      const id = new mongoose.Types.ObjectId();
      const data = await normalizedDetails(input, actor, id, session);
      const item = {
        _id: id, ...data, createdBy: actor.id, createdByName: actor.name,
        status: "SUBMITTED", revision: 0, requestKey, requestHash,
        createdAt: new Date(), updatedAt: new Date(),
      };
      const audit = await c.append({ subjectType: "EXPENSE", subjectId: id, version: 0,
        action: "EXPENSE_CREATED", actor, reason: "Company expense submitted; no payment or wallet action initiated.",
        before: null, after: item }, session);
      item.lastAuditHash = audit.eventHash;
      await Expense.create([item], { session });
      await c.attach(data.documentIds, id, session);
      return { item, idempotent: false };
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    const prior = await Expense.findOne({ requestKey }).lean();
    if (prior?.requestHash === requestHash) return { item: await c.publicExpense(prior, actor), idempotent: true };
    throw r.fail("This invoice or expense request has already been recorded. No duplicate was created.", 409, "EXPENSE_DUPLICATE");
  }
  return { ...outcome, item: await c.publicExpense(outcome.item, actor) };
}
async function mutate(id, input, actor, key, action, change) {
  const requestKey = r.requestKey(key, actor.id);
  const requestHash = r.hash({ id, action, input });
  const note = c.reason(input.reason);
  let outcome;
  try {
    outcome = await c.atomic(async session => {
      const prior = await Event.findOne({ requestKey }).session(session).lean();
      if (prior) {
        if (prior.requestHash !== requestHash) throw r.fail("This action key was used with different details.", 409);
        return { item: await find(id, session), idempotent: true };
      }
      const before = await find(id, session);
      if (before.revision !== r.expectedVersion(input.expectedVersion)) {
        throw r.fail("This expense changed. Refresh it before taking another action.", 409, "EXPENSE_STALE_REVISION");
      }
      const next = await change(before, session);
      next.revision = before.revision + 1;
      next.updatedAt = new Date();
      const audit = await c.append({
        subjectType: "EXPENSE", subjectId: id, version: next.revision,
        action: `EXPENSE_${action}`, actor, reason: note, before, after: next,
        previousHash: before.lastAuditHash, requestKey, requestHash,
      }, session);
      next.lastAuditHash = audit.eventHash;
      const { _id, __v, createdAt, ...fields } = next;
      const result = await Expense.updateOne({ _id: id, revision: before.revision }, { $set: fields },
        { session, runValidators: true });
      if (result.matchedCount !== 1) throw r.fail("Expense was changed concurrently.", 409);
      return { item: next, idempotent: false };
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    const prior = await Event.findOne({ requestKey }).lean();
    if (prior?.requestHash === requestHash) return { item: await c.publicExpense(await find(id), actor), idempotent: true };
    throw r.fail("This expense action conflicts with a completed request.", 409);
  }
  return { ...outcome, item: await c.publicExpense(outcome.item, actor) };
}
async function update(id, input, actor, key) {
  c.allow(actor, r.PERMISSIONS.update);
  return mutate(id, input, actor, key, "EDITED", async (before, session) => {
    if (!["SUBMITTED", "REJECTED"].includes(before.status)) throw r.fail("Only submitted or rejected expenses can be edited.", 409);
    const details = await normalizedDetails(input.expense, actor, id, session);
    await c.attach(details.documentIds, id, session);
    return { ...before, ...details, evidenceException: details.evidenceException || {} };
  });
}
async function act(id, input, actor, key) {
  const action = input.action;
  if (!Object.hasOwn(permissionForAction, action)) throw r.fail("Unsupported expense action.");
  c.allow(actor, permissionForAction[action]);
  if (action === "REVERSE") c.allow(actor, r.PERMISSIONS.pay);
  return mutate(id, input, actor, key, action, async (before, session) => {
    const next = { ...before };
    const at = new Date();
    if (action === "SUBMIT") {
      if (!["SUBMITTED", "REJECTED"].includes(before.status)) throw r.fail("This expense cannot be submitted.", 409);
      const policy = await Registry.findOne({ kind: "POLICY", key: "APPROVAL", active: true }).session(session).lean();
      if (!policy?.approvalSteps?.length) throw r.fail("Head Office must configure the approval hierarchy first.", 409, "EXPENSE_POLICY_REQUIRED");
      const catalog = require("./expenseManagement.catalog");
      const reviewers = await catalog.reviewerReferences();
      if (!catalog.canAllocateReviewers(policy.approvalSteps, reviewers.users, [before.createdBy, actor.id])) {
        throw r.fail("Configure enough active independent reviewers before submitting. The expense remains editable and no payment was initiated.",
          409, "EXPENSE_APPROVERS_UNAVAILABLE");
      }
      if (!before.documentIds.length && !before.evidenceException?.authorizedBy) throw r.fail("Supporting evidence or an authorized exception is required.");
      await c.documents(before.documentIds.map(String), actor, id, session);
      next.status = "PENDING_APPROVAL";
      next.submittedBy = actor.id;
      next.submittedAt = at;
      next.approvalSnapshot = { policyVersion: policy.revision, steps: policy.approvalSteps };
      next.approvals = [];
    } else if (action === "APPROVE" || action === "REJECT") {
      if (!r.canApprove(before, actor)) throw r.fail("You cannot review your own request or an unassigned approval step.", 403, "EXPENSE_REVIEW_FORBIDDEN");
      if (action === "REJECT") {
        next.status = "REJECTED";
        next.rejection = { actorId: actor.id, at, reason: c.reason(input.reason) };
      } else {
        const step = before.approvals.length;
        next.approvals = [...before.approvals, { step, label: before.approvalSnapshot.steps[step].label,
          actorId: actor.id, actorName: actor.name, actorRoleId: actor.roleId,
          at, comments: r.text(input.comments || input.reason, "Approval comments", 2000) }];
        next.status = next.approvals.length === before.approvalSnapshot.steps.length ? "APPROVED" : "PENDING_APPROVAL";
      }
    } else if (action === "PAY") {
      if (before.status !== "APPROVED") throw r.fail("Only fully approved expenses can be marked paid.", 409);
      if (input.confirmExternalPayment !== true) throw r.fail("Confirm that the external company payment was actually completed.");
      const payment = input.payment || {};
      if (!r.PAYMENT_METHODS.includes(payment.method)) throw r.fail("Select a valid payment method.");
      const evidenceDocumentIds = r.ids(payment.evidenceDocumentIds, "Payment evidence");
      await c.documents(evidenceDocumentIds, actor, id, session);
      await c.attach(evidenceDocumentIds, id, session);
      next.payment = { recordedBy: actor.id, recordedAt: at, paidDate: r.date(payment.date, "Payment date"),
        method: payment.method, reference: r.text(payment.reference, "External payment reference", 180),
        comments: c.reason(input.reason), evidenceDocumentIds, attestation: "MANUAL_COMPANY_PAYMENT_RECORD" };
      next.status = "PAID";
    } else if (action === "CANCEL") {
      if (["PAID", "CANCELLED", "REVERSED"].includes(before.status)) throw r.fail("Paid expenses require reversal; closed expenses cannot be cancelled again.", 409);
      next.status = "CANCELLED";
      next.cancellation = { actorId: actor.id, at, reason: c.reason(input.reason) };
    } else {
      if (before.status !== "PAID") throw r.fail("Only a paid expense can have an external reversal recorded.", 409);
      if (input.confirmExternalReversal !== true) throw r.fail("Confirm that the external reversal actually occurred.");
      const reversal = input.reversal || {};
      const evidenceDocumentIds = r.ids(reversal.evidenceDocumentIds, "Reversal evidence");
      if (!evidenceDocumentIds.length) throw r.fail("Supporting evidence of the external reversal is required.");
      await c.documents(evidenceDocumentIds, actor, id, session);
      await c.attach(evidenceDocumentIds, id, session);
      next.reversal = { recordedBy: actor.id, recordedAt: at,
        date: r.date(reversal.date, "Reversal date"),
        reference: r.text(reversal.reference, "External reversal reference", 180),
        reason: c.reason(input.reason), evidenceDocumentIds, attestation: "MANUAL_COMPANY_REVERSAL_RECORD" };
      next.status = "REVERSED";
    }
    return next;
  });
}
async function get(id, actor) {
  c.allow(actor, r.PERMISSIONS.view);
  await c.storage.requireReady();
  return { item: await c.publicExpense(await find(id), actor) };
}
async function list(query, actor) {
  c.allow(actor, r.PERMISSIONS.view);
  await c.storage.requireReady();
  const filter = { ...r.filters(query), recordType: { $ne: "DEPARTMENT_REQUEST" } };
  const page = Math.max(1, Math.min(Number.parseInt(query.page || "1", 10) || 1, 100000));
  const pageSize = Math.max(1, Math.min(Number.parseInt(query.pageSize || "30", 10) || 30, 100));
  if (query.search) {
    const search = r.text(query.search, "Search", 80).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [{ title: new RegExp(search, "i") }, { reference: new RegExp(search, "i") }];
  }
  const [rows, total] = await Promise.all([
    Expense.find(filter).sort({ expenseDate: -1, _id: -1 }).skip((page - 1) * pageSize).limit(pageSize).maxTimeMS(10000).lean(),
    Expense.countDocuments(filter).maxTimeMS(10000),
  ]);
  return { items: await Promise.all(rows.map(row => c.publicExpense(row, actor))), total,
    page, pageSize, hasMore: page * pageSize < total, currency: "NGN" };
}
module.exports = { create, update, act, get, list, find, permissionForAction };
