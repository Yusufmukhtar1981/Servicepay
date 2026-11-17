"use strict";
const crypto = require("crypto");
const mongoose = require("mongoose");
const Case = require("../models/fintechCase.model");
const Transaction = require("../models/transaction.model");
const User = require("../models/user.model");
const Audit = require("../models/adminAuditLog.model");
const a = require("./managementAnalytics.service");
const policy = require("./managementWorkspacePolicy.service");
const workspace = require("./managementWorkspace.service");
const { fail } = policy;
const id = value => a.objectId(value);
const queryOptions = { maxTimeMS: 15000 };
async function indexesReady() {
  let indexes;
  try { indexes = await Case.collection.indexes(); } catch (_) {
    throw fail("Support storage readiness could not be verified. No ticket was created.", 503, "SUPPORT_INDEXES_NOT_READY");
  }
  for (const key of ["idempotencyKey", "caseReference"]) {
    if (!indexes.some(i => i.unique === true && !i.sparse && !i.partialFilterExpression &&
      Object.keys(i.key).length === 1 && i.key[key] === 1)) {
      throw fail("Existing Support unique indexes must be verified before accepting complaints.", 503, "SUPPORT_INDEXES_NOT_READY");
    }
  }
}
function ticketView(ticket, detail = false) {
  const customer = ticket.customer && ticket.customer._id ? ticket.customer : null;
  return {
    id: String(ticket._id), caseReference: ticket.caseReference, subject: ticket.subject,
    description: ticket.description, status: ticket.status, category: ticket.category,
    issueCategory: ticket.managementIssueCategory, createdAt: ticket.createdAt, updatedAt: ticket.updatedAt,
    customer: customer ? { id: String(customer._id), fullName: customer.fullName, phone: customer.phone } : null,
    transactionContext: ticket.transactionContext, resolution: ticket.resolution || "",
    ...(detail ? {
      replies: (ticket.publicReplies || []).map(r => ({
        message: r.message, authorRole: r.authorRole, authorName: r.authorName, createdAt: r.createdAt,
      })),
      attachments: (ticket.managementAttachments || []).map(({ id, name, mimeType, dataUrl, createdAt }) => ({ id, name, mimeType, dataUrl, createdAt })),
    } : {}),
  };
}
const ownFilter = (s, ticketId) => ({
  ...(ticketId ? { _id: id(ticketId) } : {}),
  type: "COMPLAINT", createdBy: s.actor._id,
  customer: { $in: s.customerIds }, managementIssueCategory: { $exists: true },
});
async function list(actor, query = {}) {
  const s = await a.scope(actor), { page, limit } = workspace.pagination(query);
  const status = query.status || "";
  if (status && !["OPEN", "IN_REVIEW", "IN_PROGRESS", "ESCALATED", "RESOLVED", "REJECTED", "CLOSED", "WAITING_ON_CUSTOMER"].includes(status)) throw fail("Invalid complaint status.");
  const filter = { ...ownFilter(s), ...(status ? { status } : {}) };
  const [items, total] = await Promise.all([
    Case.find(filter).select("-managementAttachments -notes -publicReplies -managementRequestFingerprint -idempotencyKey")
      .populate("customer", "fullName phone").sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean().maxTimeMS(15000),
    Case.countDocuments(filter).maxTimeMS(15000),
  ]);
  return { items: items.map(t => ticketView(t)), total, page, limit, totalPages: Math.ceil(total / limit) };
}
async function detail(actor, ticketId) {
  const s = await a.scope(actor);
  const ticket = await Case.findOne(ownFilter(s, ticketId)).populate("customer", "fullName phone").lean().maxTimeMS(15000);
  if (!ticket) throw fail("Complaint not found in your authorized hierarchy.", 404);
  return ticketView(ticket, true);
}
function duplicateResult(existing, actorId, intent) {
  if (!existing || String(existing.createdBy) !== String(actorId)) throw fail("This transaction issue has already been reported to Support.", 409, "ISSUE_ALREADY_REPORTED");
  if (existing.idempotencyKey === intent.idempotencyKey && existing.managementRequestFingerprint !== intent.fingerprint) {
    throw fail("This request key was already used for different complaint details.", 409, "IDEMPOTENCY_INTENT_CONFLICT");
  }
  if (existing.idempotencyKey !== intent.idempotencyKey && workspace.CLOSED.includes(existing.status)) {
    throw fail("Support already closed this transaction issue. Contact Support using its existing reference.", 409, "ISSUE_ALREADY_CLOSED");
  }
  return { ticket: existing, duplicate: true };
}
async function create(actor, body) {
  const s = await a.scope(actor);
  const customerId = id(body.customerId), transactionId = id(body.transactionId);
  if (!s.ids.customerIds.includes(String(customerId))) throw fail("Customer not found in your hierarchy.", 404);
  const intent = policy.complaintIntent(s.actor._id, body, customerId, transactionId);
  const customer = await User.findOne(a.and(s.customers, { _id: customerId })).select("_id fullName phone").lean().maxTimeMS(15000);
  if (!customer) throw fail("Customer not found.", 404);
  const tx = await Transaction.findOne(a.and(workspace.matchTransactions(s), { _id: transactionId, customerId }))
    .select("_id reference serviceType amount status provider createdAt").lean().maxTimeMS(15000);
  if (!tx) throw fail("Transaction not found in your authorized customer history. Unverified legacy custody cannot be used.", 404);
  await indexesReady();
  let result;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const existing = await Case.findOne({ idempotencyKey: intent.idempotencyKey }).session(session)
        || await Case.findOne({ caseReference: intent.caseReference }).session(session);
      if (existing) { result = duplicateResult(existing, s.actor._id, intent); return; }
      const [ticket] = await Case.create([{
        caseReference: intent.caseReference, idempotencyKey: intent.idempotencyKey,
        managementRequestFingerprint: intent.fingerprint, managementIssueCategory: intent.issue,
        managementAttachments: intent.attachments.map(image => ({ ...image, id: crypto.randomBytes(12).toString("hex"),
          addedBy: s.actor._id, createdAt: new Date() })),
        type: "COMPLAINT", category: "TRANSACTION", priority: "NORMAL", status: "OPEN",
        subject: policy.ISSUES[intent.issue], description: intent.description,
        customer: customerId, transaction: transactionId, createdBy: s.actor._id,
        transactionContext: { lookupId: String(transactionId), source: "TRANSACTION", sourceId: String(transactionId),
          reference: tx.reference, transactionType: tx.serviceType, amount: tx.amount, occurredAt: tx.createdAt,
          status: tx.status, provider: tx.provider || "" },
        statusEvents: [{ status: "OPEN", actorId: s.actor._id, actorName: s.actor.fullName, actorRole: s.actor.role }],
      }], { session });
      await Audit.create([{ actorId: s.actor._id, actorRole: s.actor.role, actorName: s.actor.fullName,
        action: "FINTECH_CASE_CREATED", reason: "Submitted a transaction complaint on behalf of an authorized customer.",
        targetUserId: customerId, metadata: { caseId: String(ticket._id), transactionId: String(transactionId), issueCategory: intent.issue } }], { session });
      result = { ticket, duplicate: false };
    });
  } catch (e) {
    if (e.code !== 11000) throw e;
    const existing = await Case.findOne({ idempotencyKey: intent.idempotencyKey })
      || await Case.findOne({ caseReference: intent.caseReference });
    result = duplicateResult(existing, s.actor._id, intent);
  } finally { await session.endSession(); }
  return { ...await detail(actor, result.ticket._id), duplicate: result.duplicate };
}
async function reply(actor, ticketId, body) {
  const s = await a.scope(actor), filter = ownFilter(s, ticketId);
  const message = policy.text(body.message, 2000), requestKey = policy.key(body.idempotencyKey);
  if (!message) throw fail("A reply is required.");
  const images = policy.attachments(body.attachments);
  const fingerprint = policy.hash([message, images]);
  // Bind the request key itself to the actor; compare payload separately.
  const idempotencyKey = `management:${s.actor._id}:${requestKey}`;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      let ticket = await Case.findOne(filter).session(session);
      if (!ticket) throw fail("Complaint not found in your authorized hierarchy.", 404);
      const existing = ticket.publicReplies.find(r => r.idempotencyKey === idempotencyKey);
      if (existing) {
        if (existing.managementFingerprint !== fingerprint) throw fail("This reply request key was used for different contents.", 409);
        return;
      }
      if (workspace.CLOSED.includes(ticket.status)) throw fail("This complaint is closed for replies.", 409);
      const maxReplies = 200, maxAttachments = 8;
      if (ticket.publicReplies.length >= maxReplies || (ticket.managementAttachments || []).length + images.length > maxAttachments) {
        throw fail("This complaint has reached its reply or screenshot limit.", 409);
      }
      ticket = await Case.findOneAndUpdate({
        ...filter, status: { $nin: workspace.CLOSED },
        publicReplies: { $not: { $elemMatch: { idempotencyKey } } },
        $expr: { $and: [
          { $lt: [{ $size: { $ifNull: ["$publicReplies", []] } }, maxReplies] },
          { $lte: [{ $size: { $ifNull: ["$managementAttachments", []] } }, maxAttachments - images.length] },
        ] },
      }, { $push: {
        publicReplies: { message, authorId: s.actor._id, authorName: s.actor.fullName, authorRole: s.actor.role,
          idempotencyKey, managementFingerprint: fingerprint },
        ...(images.length ? { managementAttachments: { $each: images.map(image => ({ ...image, id: crypto.randomBytes(12).toString("hex"),
          addedBy: s.actor._id, createdAt: new Date() })) } } : {}),
      } }, { returnDocument: "after", session, runValidators: true });
      if (!ticket) throw fail("Complaint changed. Reload before replying.", 409);
      await Audit.create([{ actorId: s.actor._id, actorRole: s.actor.role, action: "FINTECH_CASE_UPDATED",
        targetUserId: ticket.customer, reason: "Added a public manager reply to the customer complaint.",
        metadata: { caseId: String(ticket._id), screenshotCount: images.length } }], { session });
    }, { ...queryOptions });
  } finally { await session.endSession(); }
  return detail(actor, ticketId);
}
module.exports = { list, detail, create, reply, indexesReady, duplicateResult, ticketView };
