const crypto = require("node:crypto");
const mongoose = require("mongoose");
const User = require("../models/user.model");
const Role = require("../models/role.model");
const Transaction = require("../models/transaction.model");
const FintechCase = require("../models/fintechCase.model");
const Branch = require("../models/branch.model");
const Delivery = require("../models/delivery.model");
const Audit = require("../models/adminAuditLog.model");
const LoginEvent = require("../models/loginSecurityEvent.model");
const AccessLog = require("../models/adminAccessLog.model");
const { getCustomerHistoryItem } = require("../services/customerHistory.service");

const clean = (v, max = 300) => String(v || "").trim().slice(0, max);
const validId = (v) => /^[a-f0-9]{24}$/i.test(String(v || ""));
const paging = (q = {}) => ({
  page: Math.max(1, Math.min(10000, Number.parseInt(q.page, 10) || 1)),
  limit: Math.max(1, Math.min(100, Number.parseInt(q.limit, 10) || 25)),
});
const escape = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const fail = (res, status, message) => res.status(status).json({ success: false, message });
const ok = (res, data) => res.json({ success: true, data });
const id = (v) => String(v?._id || v || "");
const customer = (v) => ({
  id: id(v), fullName: v.fullName, phone: v.phone, email: v.email, status: v.status,
});
const transaction = (v) => ({
  id: id(v), reference: v.reference, type: v.serviceType || v.type, status: v.status,
  amount: v.amount, createdAt: v.createdAt,
});
const txFields = "_id reference serviceType type status amount createdAt";
const customerFields = "_id fullName phone email status";
const audit = (req, action, reason, metadata, session) => Audit.create([{
  actorId: req.user._id, actorRole: req.user.role,
  actorName: clean(req.user.fullName, 200), action, reason,
  metadata, requestMethod: req.method, requestPath: req.originalUrl,
}], { session });
const workspacePermissions = ["support.view", "support.assign", "support.resolve"];

// Existing STAFF authentication, role lifecycle and token revocation remain authoritative.
// New capabilities never grant wallet/provider/reconciliation write permissions.
exports.provisionRoles = async (req, res) => {
  if (!req.staffAccess?.isHeadOffice) return fail(res, 403, "Head Office access required.");
  const session = await mongoose.startSession();
  try {
    const roles = [];
    await session.withTransaction(async () => {
      roles.length = 0;
      for (const definition of [
        { name: "OPERATIONS_MANAGER", displayName: "Operations Manager", department: "OPERATIONS", hierarchyLevel: 60, capability: "operations.workspace.view" },
        { name: "CUSTOMER_SUPPORT", displayName: "Customer Support", department: "CUSTOMER_SUPPORT", hierarchyLevel: 25, capability: "support.workspace.view" },
      ]) {
        let role = await Role.findOne({ name: definition.name }).session(session);
        if (!role) {
          [role] = await Role.create([{
            ...definition, scopeType: "GLOBAL", status: "ACTIVE",
            permissions: [...workspacePermissions, definition.capability],
            createdBy: req.user._id,
          }], { session });
        } else {
          // Preserve custom scope, existing permissions and disabled state.
          role.permissions = [...new Set([...role.permissions, ...workspacePermissions, definition.capability])];
          await role.save({ session });
        }
        roles.push({ id: id(role), name: role.name, status: role.status });
      }
      await audit(req, "USER_ROLE_UPDATED", "Provisioned operational staff dashboard roles.", { roles }, session);
    });
    return ok(res, { roles });
  } catch (_) { return fail(res, 500, "Unable to provision roles."); }
  finally { await session.endSession(); }
};

exports.overview = async (req, res) => {
  try {
    const operations = req.staffAccess.isHeadOffice ||
      req.staffAccess.permissions.includes("operations.workspace.view");
    const start = new Date(); start.setUTCHours(0, 0, 0, 0);
    const group = { $group: { _id: "$status", count: { $sum: 1 }, amount: { $sum: "$amount" } } };
    const ticketGroups = await FintechCase.aggregate([
      { $match: { type: "COMPLAINT" } },
      { $facet: {
        byStatus: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
        byAgent: [
          { $group: { _id: "$assignedTo", count: { $sum: 1 },
            resolved: { $sum: { $cond: [{ $in: ["$status", ["RESOLVED", "CLOSED"]] }, 1, 0] } } } },
          { $sort: { count: -1 } }, { $limit: 100 },
          { $lookup: { from: User.collection.name, localField: "_id", foreignField: "_id", as: "agent" } },
          { $project: { _id: 1, count: 1, resolved: 1, name: { $ifNull: [{ $arrayElemAt: ["$agent.fullName", 0] }, "Unassigned"] } } },
        ],
      } },
    ]).option({ maxTimeMS: 10000 });
    const data = { role: req.staffAccess.roleName, tickets: ticketGroups[0] || { byStatus: [], byAgent: [] } };
    if (operations) {
      const [summary, branches, accounts, deliveries, branchTotals] = await Promise.all([
        Transaction.aggregate([{ $facet: {
          byStatus: [group],
          today: [{ $match: { createdAt: { $gte: start } } }, group],
          services: [{ $match: { createdAt: { $gte: start } } },
            { $group: { _id: { $ifNull: ["$serviceType", "$type"] }, count: { $sum: 1 }, amount: { $sum: "$amount" } } }],
          revenue: [
            { $match: { createdAt: { $gte: start }, status: { $in: ["SUCCESSFUL", "SUCCESS"] } } },
            { $group: { _id: null, recordedServicepayProfit: { $sum: {
              $convert: { input: "$servicepayProfit", to: "double", onError: 0, onNull: 0 },
            } }, completedTransactions: { $sum: 1 } } },
          ],
        } }]).option({ maxTimeMS: 10000 }),
        Branch.find().select("_id name branchName").limit(100).lean(),
        User.find({ role: "CUSTOMER", "virtualAccount.status": { $in: ["FAILED", "UNKNOWN", "PENDING"] } })
          .select("_id virtualAccount.status updatedAt").sort({ updatedAt: -1 }).limit(25).lean(),
        Delivery.find({ status: { $nin: ["DELIVERED", "CANCELLED", "COMPLETED"] } })
          .select("_id status createdAt").sort({ createdAt: -1 }).limit(25).lean(),
        Transaction.aggregate([
          { $match: { createdAt: { $gte: start }, branchId: { $ne: null } } },
          { $group: { _id: "$branchId", count: { $sum: 1 }, grossAmount: { $sum: "$amount" },
            successful: { $sum: { $cond: [{ $in: ["$status", ["SUCCESSFUL", "SUCCESS"]] }, 1, 0] } } } },
        ]).option({ maxTimeMS: 10000 }),
      ]);
      data.transactions = summary[0];
      data.revenue = summary[0].revenue[0] || { recordedServicepayProfit: 0, completedTransactions: 0 };
      data.revenueNotice = "Gross transaction amounts only; not recognized revenue, provider cost or net profit. UTC day.";
      data.branches = branches.map((v) => {
        const totals = branchTotals.find((t) => id(t) === id(v));
        return { id: id(v), name: v.name || v.branchName || "Branch",
          count: totals?.count || 0, successful: totals?.successful || 0, grossAmount: totals?.grossAmount || 0 };
      });
      data.issues = {
        virtualAccounts: accounts.map((v) => ({ id: id(v), status: v.virtualAccount?.status, updatedAt: v.updatedAt })),
        delivery: deliveries.map((v) => ({ id: id(v), status: v.status, createdAt: v.createdAt })),
      };
    }
    return ok(res, data);
  } catch (_) { return fail(res, 503, "Operational summary is temporarily unavailable."); }
};

exports.customers = async (req, res) => {
  try {
    const q = clean(req.query.q, 100);
    if (q.length < 3) return fail(res, 400, "Enter at least three characters to search.");
    const { page, limit } = paging(req.query);
    const regex = new RegExp(escape(q), "i");
    const clauses = [{ fullName: regex }, { phone: regex }, { email: regex }];
    if (validId(q)) clauses.push({ _id: q });
    const match = await Transaction.findOne({ reference: q }).select("customerId").lean();
    if (match?.customerId) clauses.push({ _id: match.customerId });
    const filter = { role: "CUSTOMER", $or: clauses };
    const [rows, total] = await Promise.all([
      User.find(filter).select(customerFields).sort({ _id: -1 }).skip((page - 1) * limit).limit(limit).maxTimeMS(5000).lean(),
      User.countDocuments(filter).maxTimeMS(5000),
    ]);
    return ok(res, { items: rows.map(customer), total, page, limit });
  } catch (_) { return fail(res, 503, "Customer search is temporarily unavailable."); }
};

exports.customerDetail = async (req, res) => {
  try {
    if (!validId(req.params.id)) return fail(res, 404, "Customer not found.");
    const user = await User.findOne({ _id: req.params.id, role: "CUSTOMER" }).select(customerFields).lean();
    if (!user) return fail(res, 404, "Customer not found.");
    const [rows, tickets] = await Promise.all([
      Transaction.find({ customerId: user._id }).select(txFields).sort({ createdAt: -1 }).limit(50).lean(),
      FintechCase.find({ customer: user._id, type: "COMPLAINT" })
        .select("_id caseReference subject status priority").sort({ createdAt: -1 }).limit(50).lean(),
    ]);
    return ok(res, { customer: customer(user), transactions: rows.map(transaction),
      tickets: tickets.map((v) => ({ id: id(v), caseReference: v.caseReference, subject: v.subject, status: v.status, priority: v.priority })) });
  } catch (_) { return fail(res, 503, "Customer details are temporarily unavailable."); }
};

exports.transactions = async (req, res) => {
  try {
    const { page, limit } = paging(req.query);
    const filter = {};
    for (const field of ["status", "type"]) {
      const input = clean(req.query[field], 80);
      if (input) {
        if (!/^[A-Z_0-9]+$/.test(input)) return fail(res, 400, "Invalid transaction filter.");
        filter[field === "type" ? "serviceType" : field] = field === "status" && ["SUCCESS", "SUCCESSFUL"].includes(input)
          ? { $in: ["SUCCESS", "SUCCESSFUL"] } : input;
      }
    }
    const [rows, total] = await Promise.all([
      Transaction.find(filter).select(txFields).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).maxTimeMS(5000).lean(),
      Transaction.countDocuments(filter).maxTimeMS(5000),
    ]);
    return ok(res, { items: rows.map(transaction), total, page, limit });
  } catch (_) { return fail(res, 503, "Transactions are temporarily unavailable."); }
};

exports.createTicket = async (req, res) => {
  try {
    const body = req.body || {};
    if (!validId(body.customerId)) return fail(res, 400, "Select a customer.");
    const user = await User.findOne({ _id: body.customerId, role: "CUSTOMER" }).select("_id").lean();
    if (!user) return fail(res, 404, "Customer not found.");
    const subject = clean(body.subject, 200), description = clean(body.description, 3000);
    const requestKey = clean(body.idempotencyKey, 120);
    if (!subject || !description || requestKey.length < 8) return fail(res, 400, "Subject, description and a stable request key are required.");
    const categories = FintechCase.schema.path("category").enumValues;
    const priorities = FintechCase.schema.path("priority").enumValues;
    const category = clean(body.category || "OTHER").toUpperCase();
    const priority = clean(body.priority || "NORMAL").toUpperCase();
    if (!categories.includes(category) || !priorities.includes(priority)) return fail(res, 400, "Invalid complaint category or priority.");
    let context;
    if (body.transactionId) {
      const lookup = clean(body.transactionId, 200);
      const record = validId(lookup)
        ? await Transaction.findOne({ _id: lookup, customerId: user._id }).select(txFields).lean()
        : null;
      const item = validId(lookup) ? record && {
        ...record, id: `transaction:${id(record)}`, type: record.serviceType || record.type, source: "transaction", sourceId: id(record),
      } : await getCustomerHistoryItem({ userId: id(user), lookupId: lookup });
      if (!item) return fail(res, 404, "Customer transaction not found.");
      context = { lookupId: clean(item.id), reference: clean(item.reference), status: clean(item.status),
        transactionType: clean(item.type), amount: Number(item.amount) || 0, source: clean(item.source),
        sourceId: clean(item.sourceId), occurredAt: item.createdAt };
    }
    const key = `staff-support:${id(req.user)}:${id(user)}:${requestKey}`;
    const fingerprint = crypto.createHash("sha256").update(JSON.stringify({ subject, description, category, priority, transactionId: body.transactionId || "" })).digest("hex");
    const existing = await FintechCase.findOne({ idempotencyKey: key }).lean();
    if (existing) {
      if (existing.staffRequestFingerprint !== fingerprint) return fail(res, 409, "Request key already belongs to a different complaint.");
      return ok(res, { id: id(existing), caseReference: existing.caseReference, status: existing.status });
    }
    const session = await mongoose.startSession();
    let ticket;
    try {
      await session.withTransaction(async () => {
        [ticket] = await FintechCase.create([{
          caseReference: `SPT-${Date.now()}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`,
          idempotencyKey: key, type: "COMPLAINT", customer: user._id, subject, description,
          category, priority, status: "OPEN", transactionContext: context,
          createdBy: req.user._id, staffRequestFingerprint: fingerprint,
          statusEvents: [{ status: "OPEN", actorId: req.user._id, actorName: clean(req.user.fullName), actorRole: req.user.role }],
        }], { session });
        await audit(req, "FINTECH_CASE_UPDATED", "Staff created customer complaint.", { caseId: id(ticket), customerId: id(user) }, session);
      });
    } finally { await session.endSession(); }
    return ok(res, { id: id(ticket), caseReference: ticket.caseReference, status: ticket.status });
  } catch (err) {
    if (err.code === 11000) return fail(res, 409, "Complaint creation is already recorded. Refresh tickets.");
    return fail(res, 500, "Unable to create complaint.");
  }
};

exports.escalate = async (req, res) => {
  if (!validId(req.params.id)) return fail(res, 404, "Ticket not found.");
  const reason = clean(req.body?.reason, 2000);
  if (reason.length < 5) return fail(res, 400, "Provide an escalation reason.");
  const session = await mongoose.startSession();
  try {
    let ticket;
    await session.withTransaction(async () => {
      ticket = await FintechCase.findOne({ _id: req.params.id, type: "COMPLAINT" }).session(session);
      if (!ticket) throw Object.assign(new Error("Ticket not found."), { httpStatus: 404 });
      if (["RESOLVED", "CLOSED", "REJECTED"].includes(ticket.status)) throw Object.assign(new Error("Closed complaints cannot be escalated."), { httpStatus: 409 });
      if (ticket.status === "ESCALATED") return;
      ticket.status = "ESCALATED";
      ticket.statusEvents.push({ status: "ESCALATED", actorId: req.user._id, actorRole: req.user.role, actorName: clean(req.user.fullName) });
      ticket.notes.push({ body: reason, authorId: req.user._id });
      await ticket.save({ session });
      await audit(req, "FINTECH_CASE_UPDATED", reason, { caseId: id(ticket), escalatedTo: "HEAD_OFFICE" }, session);
    });
    return ok(res, { id: id(ticket), caseReference: ticket.caseReference, status: ticket.status });
  } catch (err) { return fail(res, err.httpStatus || 500, err.httpStatus ? err.message : "Unable to escalate ticket."); }
  finally { await session.endSession(); }
};

exports._test = { paging, customer, transaction, validId, escape };

exports.staffHistory = async (req, res) => {
  if (!req.staffAccess?.isHeadOffice) return fail(res, 403, "Head Office access required.");
  if (!validId(req.params.id)) return fail(res, 404, "Staff member not found.");
  try {
    const member = await User.findOne({ _id: req.params.id, isStaff: true }).select("_id fullName status").lean();
    if (!member) return fail(res, 404, "Staff member not found.");
    const [logins, activities, access] = await Promise.all([
      LoginEvent.find({ user: member._id }).select("_id outcome eventType createdAt").sort({ createdAt: -1 }).limit(50).lean(),
      Audit.find({ $or: [{ actorId: member._id }, { targetUserId: member._id }] })
        .select("_id action reason createdAt").sort({ createdAt: -1 }).limit(50).lean(),
      AccessLog.find({ actorId: member._id }).select("_id method path statusCode createdAt").sort({ createdAt: -1 }).limit(50).lean(),
    ]);
    return ok(res, { staff: { id: id(member), fullName: member.fullName, status: member.status }, logins, activities, access });
  } catch (_) { return fail(res, 503, "Staff history is temporarily unavailable."); }
};
