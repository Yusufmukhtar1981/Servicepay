"use strict";
const mongoose = require("mongoose");
const c = require("./expenseManagement.common");
const a = require("./expenseRequests.access");
const policies = require("./expenseRequests.policies");
const { r, Expense, Registry, Event } = c;
const EDITABLE = ["DRAFT", "CHANGES_REQUESTED", "REJECTED"];
async function find(id, actor, session) {
  const query = Expense.findOne({ _id: r.id(id), recordType: a.TYPE });
  if (session) query.session(session);
  const item = await query.lean();
  if (!item) throw r.fail("Expense request was not found.", 404);
  a.view(item, actor);
  return item;
}
async function publicItem(row, actor) {
  const ids = [...(row.documentIds || []), ...(row.payment?.evidenceDocumentIds || [])];
  const documents = ids.length ? await c.Document.find({ _id: { $in: ids } }).lean() : [];
  return { ...c.snapshot(row), _id: undefined, id: String(row._id),
    createdBy: String(row.createdBy), categoryId: row.categoryId ? String(row.categoryId) : null,
    vendorId: row.vendorId ? String(row.vendorId) : null, documents: documents.map(c.documentMetadata),
    evidenceExceptionReason: row.evidenceException?.reason || "",
    payment: row.payment?.recordedBy ? { ...c.snapshot(row.payment), date: row.payment.paidDate,
      evidenceDocuments: documents.filter(document => (row.payment.evidenceDocumentIds || [])
        .map(String).includes(String(document._id))).map(c.documentMetadata) } : null,
    actions: a.actions(row, actor) };
}
async function details(input, actor, id, session, complete) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw r.fail("Expense request details are required.");
  const allowed = new Set(["title", "department", "amount", "categoryId", "businessPurpose", "description",
    "requiredDate", "vendorId", "beneficiary", "documentIds", "evidenceExceptionReason", "submit"]);
  if (Object.keys(input).some(key => !allowed.has(key))) throw r.fail("Unsupported request field.");
  const access = a.capabilities(actor), department = a.department(input.department || access.department);
  if (!(actor.role === "HEAD_OFFICE" && access.financeAccess) && department !== access.department) {
    throw r.fail("You can submit requests only for your assigned department.", 403);
  }
  const requiredDate = input.requiredDate ? r.date(input.requiredDate, "Required date") : "";
  if (complete && !requiredDate) throw r.fail("Required date is required.");
  const categoryId = input.categoryId ? r.id(input.categoryId, "Category") : null;
  const vendorId = input.vendorId ? r.id(input.vendorId, "Vendor") : null;
  const category = categoryId && await Registry.findOne({ _id: categoryId, kind: "CATEGORY", active: true }).session(session).lean();
  const vendor = vendorId && await Registry.findOne({ _id: vendorId, kind: "VENDOR", active: true }).session(session).lean();
  if ((categoryId && !category) || (complete && !category)) throw r.fail("Select an active expense category.");
  if (vendorId && !vendor) throw r.fail("Select an active vendor.");
  const beneficiary = r.text(input.beneficiary, "Beneficiary", 180, false);
  if (complete && !vendorId && !beneficiary) throw r.fail("Select a vendor or provide a beneficiary.");
  const documentIds = r.ids(input.documentIds, "Supporting documents");
  await c.documents(documentIds, actor, id, session);
  const exception = r.text(input.evidenceExceptionReason, "Evidence exception reason", 2000, false);
  if (exception) { c.allow(actor, r.PERMISSIONS.exception); c.reason(exception); }
  if (complete && !documentIds.length && !exception) throw r.fail("Attach a quotation or supporting document.");
  const amountMinor = input.amount !== undefined && input.amount !== "" ? r.amountMinor(input.amount) : null;
  if (complete && !amountMinor) throw r.fail("Requested NGN amount is required.");
  return { title: r.text(input.title, "Request title", 180, complete),
    description: r.text(input.description, "Detailed description", 4000, complete),
    businessPurpose: r.text(input.businessPurpose, "Business justification", 2000, complete),
    department, requiredDate, expenseDate: requiredDate, amountMinor, currency: "NGN",
    categoryId, categoryName: category?.name || "", vendorId, vendorName: vendor?.name || "", beneficiary,
    documentIds, evidenceException: exception ? { reason: exception, authorizedBy: actor.id, authorizedAt: new Date() } : {} };
}
const inputFrom = item => ({ title: item.title, department: item.department,
  amount: item.amountMinor == null ? "" : `${Math.floor(item.amountMinor / 100)}.${String(item.amountMinor % 100).padStart(2, "0")}`,
  categoryId: item.categoryId ? String(item.categoryId) : "", businessPurpose: item.businessPurpose,
  description: item.description, requiredDate: item.requiredDate,
  vendorId: item.vendorId ? String(item.vendorId) : "", beneficiary: item.beneficiary,
  documentIds: (item.documentIds || []).map(String), evidenceExceptionReason: item.evidenceException?.reason || "" });
async function submit(item, actor, session) {
  const data = await details(inputFrom(item), actor, item._id, session, true);
  const approvalSnapshot = await policies.forRequest({ ...item, ...data }, actor, session);
  return { ...item, ...data, status: "SUBMITTED", submittedBy: actor.id,
    submittedAt: new Date(), approvalSnapshot, approvals: [] };
}
async function create(input, actor, key) {
  if (!a.capabilities(actor).canCreateRequests) throw r.fail("Request submission permission is required.", 403);
  if (input.submit !== undefined && typeof input.submit !== "boolean") throw r.fail("Submit must be true or false.");
  const requestKey = r.requestKey(key, actor.id), requestHash = r.hash(input);
  let result;
  try {
    result = await c.atomic(async session => {
      const prior = await Expense.findOne({ requestKey }).session(session).lean();
      if (prior) {
        if (prior.requestHash !== requestHash || prior.recordType !== a.TYPE) throw r.fail("Request key has different details.", 409);
        return { item: prior, idempotent: true };
      }
      const _id = new mongoose.Types.ObjectId(), now = new Date();
      const data = await details(input, actor, _id, session, input.submit === true);
      let next = { ...data, _id, recordType: a.TYPE, status: "DRAFT",
        createdBy: actor.id, createdByName: actor.name, createdAt: now, updatedAt: now,
        revision: 0, requestKey, requestHash, dedupKey: r.hash({ departmentRequest: String(_id) }),
        approvals: [], reviewHistory: [] };
      if (input.submit) next = await submit(next, actor, session);
      const audit = await c.append({ subjectType: "EXPENSE", subjectId: _id, version: 0,
        action: input.submit ? "EXPENSE_REQUEST_SUBMITTED" : "EXPENSE_REQUEST_DRAFT_CREATED", actor,
        reason: "Staff expense request recorded. No bank transfer or customer wallet action.",
        before: null, after: next }, session);
      next.lastAuditHash = audit.eventHash;
      await Expense.create([next], { session });
      await c.attach(data.documentIds, _id, session);
      return { item: next, idempotent: false };
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    const prior = await Expense.findOne({ requestKey, recordType: a.TYPE }).lean();
    if (prior?.requestHash !== requestHash) throw r.fail("Expense request conflicts with a completed request.", 409);
    result = { item: prior, idempotent: true };
  }
  return { ...result, item: await publicItem(result.item, actor) };
}
async function mutate(id, input, actor, key, action, change) {
  a.portal(actor);
  const note = c.reason(input.reason), requestKey = r.requestKey(key, actor.id);
  const requestHash = r.hash({ id, input, action });
  let result;
  try {
    result = await c.atomic(async session => {
      const before = await find(id, actor, session);
      const prior = await Event.findOne({ requestKey }).session(session).lean();
      if (prior) {
        if (prior.requestHash !== requestHash) throw r.fail("Action key has different details.", 409);
        return { item: before, idempotent: true };
      }
      if (before.revision !== r.expectedVersion(input.expectedVersion)) throw r.fail("Request changed; refresh before acting.", 409);
      let next = await change(before, session);
      next = { ...next, revision: before.revision + 1, updatedAt: new Date() };
      const audit = await c.append({ subjectType: "EXPENSE", subjectId: id, version: next.revision,
        action: `EXPENSE_REQUEST_${action}`, actor, reason: note, before, after: next,
        previousHash: before.lastAuditHash, requestKey, requestHash }, session);
      next.lastAuditHash = audit.eventHash;
      const { _id, __v, createdAt, ...fields } = next;
      const changed = await Expense.updateOne({ _id: id, revision: before.revision, recordType: a.TYPE },
        { $set: fields }, { session, runValidators: true });
      if (changed.matchedCount !== 1) throw r.fail("Request changed concurrently.", 409);
      return { item: next, idempotent: false };
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    const prior = await Event.findOne({ requestKey }).lean();
    if (prior?.requestHash !== requestHash) throw r.fail("This action or payment reference is already recorded.", 409);
    result = { item: await find(id, actor), idempotent: true };
  }
  return { ...result, item: await publicItem(result.item, actor) };
}
async function update(id, input, actor, key) {
  return mutate(id, input, actor, key, "EDITED", async (before, session) => {
    if (!a.actions(before, actor).includes("EDIT")) throw r.fail("Only the requester can edit a draft or returned request.", 403);
    const data = await details(input.request, actor, id, session, false);
    await c.attach(data.documentIds, id, session);
    return { ...before, ...data };
  });
}
async function act(id, input, actor, key) {
  const allowed = ["SUBMIT", "BEGIN_REVIEW", "SEND_FOR_APPROVAL", "APPROVE", "REJECT", "REQUEST_CHANGES", "CANCEL", "PAY"];
  if (!allowed.includes(input.action)) throw r.fail("Unsupported request action.");
  return mutate(id, input, actor, key, input.action, async (before, session) => {
    const action = input.action, at = new Date();
    if (!a.actions(before, actor).includes(action)) throw r.fail("You are not assigned or authorized for this action.", 403);
    if (action === "SUBMIT") return submit(before, actor, session);
    const next = { ...before };
    if (action === "BEGIN_REVIEW") next.status = "UNDER_REVIEW";
    else if (action === "SEND_FOR_APPROVAL") next.status = "PENDING_APPROVAL";
    else if (action === "REQUEST_CHANGES") next.status = "CHANGES_REQUESTED";
    else if (action === "REJECT") {
      next.status = "REJECTED";
      next.rejection = { actorId: actor.id, at, reason: c.reason(input.reason) };
    } else if (action === "CANCEL") {
      next.status = "CANCELLED";
      next.cancellation = { actorId: actor.id, at, reason: c.reason(input.reason) };
    } else if (action === "APPROVE") {
      const step = before.approvals.length, level = before.approvalSnapshot.steps[step];
      next.approvals = [...before.approvals, { step, label: level.label, actorId: actor.id,
        actorName: actor.name, actorRoleId: actor.roleId, at,
        comments: r.text(input.comments || input.reason, "Approval comments", 2000) }];
      next.status = next.approvals.length === before.approvalSnapshot.steps.length ? "APPROVED" : "PENDING_APPROVAL";
    } else if (action === "PAY") {
      const payment = input.payment || {};
      if (input.confirmExternalPayment !== true) throw r.fail("Confirm the external company payment actually occurred.");
      if (!r.PAYMENT_METHODS.includes(payment.method)) throw r.fail("Select a valid payment method.");
      const amountMinor = r.amountMinor(payment.amount);
      if (amountMinor > before.amountMinor) throw r.fail("Payment exceeds the approved request. Obtain a revised approval first.");
      const recipient = r.text(payment.recipient, "Recipient", 180);
      if (r.normalizedKey(recipient) !== r.normalizedKey(before.beneficiary || before.vendorName)) throw r.fail("Payment recipient must match the approved vendor or beneficiary.");
      const evidenceDocumentIds = r.ids(payment.evidenceDocumentIds, "Payment evidence");
      if (!evidenceDocumentIds.length) throw r.fail("Separate proof of the completed external payment is required.");
      const evidence = await c.documents(evidenceDocumentIds, actor, id, session);
      const supporting = before.documentIds.length
        ? await c.Document.find({ _id: { $in: before.documentIds } }).session(session).lean() : [];
      if (evidence.some(row => String(row.uploadedBy) !== actor.id || supporting.some(quote => quote.sha256 === row.sha256))) {
        throw r.fail("Upload separate payment proof using your Finance session; a quotation is not payment evidence.");
      }
      const reference = r.text(payment.reference, "External payment reference", 180);
      const existingReference = new RegExp(`^\\s*${r.normalizedKey(reference).split(" ").map(
        token => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+")}\\s*$`, "i");
      if (await Expense.exists({ _id: { $ne: before._id }, "payment.reference": existingReference,
        "payment.method": payment.method }).session(session)) throw r.fail("This external payment reference is already recorded.", 409);
      // Existing unique dedup index prevents two departmental requests from
      // concurrently recording the same external payment reference.
      next.dedupKey = r.hash({ companyPayment: payment.method, reference: r.normalizedKey(reference) });
      const paidDate = r.date(payment.date, "Payment date");
      if (paidDate > new Date(Date.now() + 3600000).toISOString().slice(0, 10)) throw r.fail("A completed payment cannot have a future date.");
      next.payment = { amountMinor, recipient, recordedBy: actor.id, recordedByName: actor.name, recordedAt: at, paidDate,
        method: payment.method, reference, comments: c.reason(input.reason), evidenceDocumentIds,
        attestation: "MANUAL_COMPANY_PAYMENT_RECORD" };
      next.expenseDate = paidDate;
      next.status = "PAID";
      await c.attach(evidenceDocumentIds, id, session);
    }
    const level = before.approvalSnapshot?.steps?.[(before.approvals || []).length];
    next.reviewHistory = [...(before.reviewHistory || []), { actorId: actor.id, actorName: actor.name,
      action, comments: r.text(input.comments || input.reason, "Comments", 2000), at,
      reviewerKind: level?.backupUserIds?.map(String).includes(actor.id) ? "BACKUP" : "PRIMARY" }];
    if (next.reviewHistory.length > 500) throw r.fail("Request history reached its safe limit; contact Head Office.", 409);
    return next;
  });
}
function visibility(actor) {
  const access = a.capabilities(actor);
  if (access.financeAccess) return {};
  const choices = [{ createdBy: actor.id }];
  if (access.canViewDepartmentRequests) choices.push({ department: access.department });
  if (access.canReviewRequests) choices.push({ "approvalSnapshot.steps.userIds": actor.id }, { "approvalSnapshot.steps.backupUserIds": actor.id });
  return { $or: choices };
}
async function list(query, actor) {
  const access = a.capabilities(actor), scope = query.scope || "my";
  const clauses = [{ recordType: a.TYPE }, visibility(actor)];
  if (scope === "my") clauses.push({ createdBy: actor.id });
  else if (scope === "department") {
    if (!access.canViewDepartmentRequests) throw r.fail("Department request history permission is required.", 403);
    if (!access.financeAccess) clauses.push({ department: access.department });
  } else if (scope === "assigned") {
    if (!access.canReviewRequests) throw r.fail("Independent review permission is required.", 403);
    clauses.push({ status: { $in: ["SUBMITTED", "UNDER_REVIEW", "PENDING_APPROVAL"] },
      $or: [{ "approvalSnapshot.steps.userIds": actor.id }, { "approvalSnapshot.steps.backupUserIds": actor.id }] });
  } else if (scope === "approved") clauses.push({ status: "APPROVED" });
  else if (scope === "payments") {
    if (!access.financeAccess && !access.canRecordPayments) throw r.fail("Finance payment history permission is required.", 403);
    clauses.push({ status: "PAID" });
  } else throw r.fail("Invalid expense request scope.");
  if (query.status) {
    if (!r.STATES.includes(query.status)) throw r.fail("Invalid request status.");
    clauses.push({ status: query.status });
  }
  if (query.department) clauses.push({ department: a.department(query.department) });
  const page = Math.min(10000, Math.max(1, parseInt(query.page || "1", 10) || 1));
  const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize || "25", 10) || 25));
  const match = { $and: clauses };
  const [rows, total] = await Promise.all([
    Expense.find(match).sort({ _id: -1 }).skip((page - 1) * pageSize).limit(pageSize).maxTimeMS(10000).lean(),
    Expense.countDocuments(match).maxTimeMS(10000),
  ]);
  return { items: await Promise.all(rows.map(row => publicItem(row, actor))), total, page, pageSize,
    hasMore: page * pageSize < total, pendingCount: await pendingCount(actor) };
}
async function pendingCount(actor) {
  if (!a.capabilities(actor).canReviewRequests) return 0;
  const rows = await Expense.find({ recordType: a.TYPE, status: { $in: ["SUBMITTED", "UNDER_REVIEW", "PENDING_APPROVAL"] },
    $or: [{ "approvalSnapshot.steps.userIds": actor.id }, { "approvalSnapshot.steps.backupUserIds": actor.id }] })
    .select("status createdBy submittedBy approvals approvalSnapshot").limit(2001).maxTimeMS(10000).lean();
  if (rows.length > 2000) throw r.fail("Narrow pending approvals before loading counts.", 422);
  return rows.filter(row => a.canReview(row, actor)).length;
}
async function references(actor) {
  const access = a.capabilities(actor);
  const items = await Registry.find({ kind: { $in: ["CATEGORY", "VENDOR"] }, active: true })
    .select("_id kind name active").sort({ name: 1 }).limit(2000).lean();
  return { categories: items.filter(item => item.kind === "CATEGORY").map(item => ({ id: String(item._id), name: item.name, active: item.active })),
    vendors: items.filter(item => item.kind === "VENDOR").map(item => ({ id: String(item._id), name: item.name, active: item.active })),
    departments: access.departments };
}
async function notifications(actor) {
  a.portal(actor);
  const rows = await Expense.find({ $and: [{ recordType: a.TYPE }, visibility(actor)] })
    .sort({ updatedAt: -1 }).limit(20).maxTimeMS(10000).lean();
  return { pendingCount: await pendingCount(actor), items: rows.map(row => ({
    id: `${row._id}-${row.revision}`, requestId: String(row._id), title: row.title || "Draft expense request",
    status: row.status, updatedAt: row.updatedAt, type: a.canReview(row, actor) ? "ACTION_REQUIRED" : "STATUS_UPDATE",
  })) };
}
async function audit(id, actor) {
  await find(id, actor);
  const rows = await Event.find({ subjectType: "EXPENSE", subjectId: r.id(id) }).sort({ version: 1 }).limit(1000).lean();
  return { items: rows.map(({ requestKey, requestHash, _id, ...row }) => ({ ...row, id: String(_id) })) };
}
module.exports = { find, publicItem, create, update, act, list, pendingCount, references, notifications, audit };
