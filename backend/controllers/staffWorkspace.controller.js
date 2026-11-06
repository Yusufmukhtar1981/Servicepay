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
const safe = require("../services/supportWorkspace.service");

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
  kycStatus: v.kycVerified === true ? "VERIFIED" : "NOT_VERIFIED",
  createdAt: v.createdAt || null,
});
const transaction = (v) => ({
  id: id(v), reference: v.reference, type: v.serviceType || v.type, status: v.status,
  amount: v.amount, createdAt: v.createdAt, updatedAt: v.updatedAt,
  customerId: id(v.customerId), providerStatus: safe.safeCode(v.providerStatus),
  errorCode: safe.safeCode(v.providerResponse?.code || v.providerResponse?.errorCode),
  diagnostic: safe.diagnostic(safe.safeCode(v.providerResponse?.code || v.providerResponse?.errorCode), v.status),
});
const txFields = "_id reference serviceType type status amount createdAt updatedAt customerId providerStatus providerResponse.code providerResponse.errorCode";
const customerFields = "_id fullName phone email status kycVerified createdAt";
const customerSearch = (q) => {
  if (validId(q)) return [{ _id: q }];
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q)) return [{ email: q.toLowerCase() }];
  if (/^\+?\d{10,15}$/.test(q)) return [{ phone: q }];
  const regex = new RegExp(escape(q), "i");
  return [{ fullName: regex }, { phone: regex }, { email: regex }];
};
const customerFor = (req, v) => {
  const result = customer(v);
  if (!req.staffAccess?.isHeadOffice) {
    result.phone = safe.maskPhone(v.phone);
    result.email = safe.maskEmail(v.email);
  }
  return result;
};
const audit = (req, action, reason, metadata, session) => Audit.create([{
  actorId: req.user._id, actorRole: req.user.role,
  actorName: clean(req.user.fullName, 200), action, reason,
  metadata, requestMethod: req.method, requestPath: req.originalUrl,
}], { session });
const workspacePermissions = ["support.view", "support.assign", "support.resolve"];
const reliability = require("../services/transactionReliability.service").createTransactionReliabilityService();
exports.transactionReliability = async (req, res) => {
  if (!req.staffAccess?.isHeadOffice &&
      !req.staffAccess?.permissions?.includes("operations.workspace.view")) {
    return fail(res, 403, "Operations workspace permission required.");
  }
  try {
    const { page } = paging(req.query);
    // The queue is capped at 5,000 to bound diagnostics; do not return fake
    // empty pages beyond that explicit coverage bound.
    if (page > 250) return fail(res, 400, "Maximum diagnostic page is 250.");
    return ok(res, await reliability({ page, limit: 20 }));
  } catch (_) { return fail(res, 503, "Transaction reliability diagnostics are unavailable. Please retry."); }
};

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
        { name: "SUPPORT_MANAGER", displayName: "Support Manager", department: "CUSTOMER_SUPPORT", hierarchyLevel: 40, capability: "support.workspace.view" },
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
    if (q && q.length < 3) return fail(res, 400, "Enter at least three characters to search.");
    const { page, limit } = paging(req.query);
    const filter = { role: "CUSTOMER" };
    if (q) {
      const clauses = customerSearch(q);
      const match = await Transaction.findOne({ reference: q }).select("customerId").maxTimeMS(5000).lean();
      if (match?.customerId) clauses.push({ _id: match.customerId });
      filter.$or = clauses;
    }
    const status = clean(req.query.status, 30).toUpperCase();
    if (status) {
      if (!["ACTIVE", "SUSPENDED", "PENDING", "INACTIVE", "DEACTIVATED", "LOCKED"].includes(status))
        return fail(res, 400, "Invalid customer status.");
      filter.status = status;
    }
    const kyc = clean(req.query.kycStatus, 30).toUpperCase();
    if (kyc) {
      if (!["VERIFIED", "NOT_VERIFIED"].includes(kyc)) return fail(res, 400, "Invalid KYC status.");
      filter.kycVerified = kyc === "VERIFIED" ? true : { $ne: true };
    }
    const [rows, total] = await Promise.all([
      User.find(filter).select(customerFields).sort({ _id: -1 }).skip((page - 1) * limit).limit(limit).maxTimeMS(5000).lean(),
      User.countDocuments(filter).maxTimeMS(5000),
    ]);
    return ok(res, { items: rows.map((v) => customerFor(req, v)), total, page, limit });
  } catch (_) { return fail(res, 503, "Customer search is temporarily unavailable."); }
};

exports.customerDetail = async (req, res) => {
  try {
    if (!validId(req.params.id)) return fail(res, 404, "Customer not found.");
    const user = await User.findOne({ _id: req.params.id, role: "CUSTOMER" })
      .select(`${customerFields} kycVerified walletBalance virtualAccount.status virtualAccount.bankName virtualAccount.accountNumber virtualAccount.failureReason virtualAccount.updatedAt virtualAccount.createdAt`).lean();
    if (!user) return fail(res, 404, "Customer not found.");
    const [rows, tickets] = await Promise.all([
      Transaction.find({ customerId: user._id }).select(txFields).sort({ createdAt: -1 }).limit(50).lean(),
      FintechCase.find({ customer: user._id, type: "COMPLAINT" })
        .select("_id caseReference subject status priority").sort({ createdAt: -1 }).limit(50).lean(),
    ]);
    return ok(res, { customer: { ...customerFor(req, user), kycStatus: user.kycVerified ? "VERIFIED" : "NOT_VERIFIED", walletBalance: user.walletBalance },
      virtualAccount: safe.account(user.virtualAccount), transactions: rows.map(v => ({ ...transaction(v), customerName: user.fullName })),
      tickets: tickets.map((v) => ({ id: id(v), caseReference: v.caseReference, subject: v.subject, status: v.status, priority: v.priority })) });
  } catch (_) { return fail(res, 503, "Customer details are temporarily unavailable."); }
};

exports.transactions = async (req, res) => {
  try {
    const { page, limit } = paging(req.query);
    const filter = {};
    for (const [key, operator] of [["from", "$gte"], ["to", "$lte"]]) {
      if (req.query[key]) {
        const raw = String(req.query[key]);
        if (!/^\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z)?$/.test(raw) || !Number.isFinite(Date.parse(raw)))
          return fail(res, 400, "Invalid transaction date.");
        const value = new Date(raw.length === 10 ? `${raw}T${key === "to" ? "23:59:59.999" : "00:00:00.000"}Z` : raw);
        if (value.toISOString().slice(0, 10) !== raw.slice(0, 10)) return fail(res, 400, "Invalid calendar date.");
        filter.createdAt = { ...filter.createdAt, [operator]: value };
      }
    }
    if (filter.createdAt?.$gte > filter.createdAt?.$lte) return fail(res, 400, "Date range is reversed.");
    for (const [key, operator] of [["minAmount", "$gte"], ["maxAmount", "$lte"]]) {
      if (req.query[key] !== undefined && req.query[key] !== "") {
        const value = Number(req.query[key]);
        if (!Number.isFinite(value) || value < 0 || value > 1e12) return fail(res, 400, "Invalid amount filter.");
        filter.amount = { ...filter.amount, [operator]: value };
      }
    }
    if (filter.amount?.$gte > filter.amount?.$lte) return fail(res, 400, "Amount range is reversed.");
    const query = clean(req.query.q, 100);
    if (query) {
      if (query.length < 3) return fail(res, 400, "Enter at least three characters.");
      const regex = new RegExp(escape(query), "i");
      const exact = await Transaction.findOne(validId(query) ? { $or: [{ _id: query }, { reference: query }] } : { reference: query }).select("_id").maxTimeMS(5000).lean();
      if (exact) filter._id = exact._id;
      else {
        // Only matching IDs are read internally; actual records remain paged.
        // No silent first-100-customer truncation of transaction searches.
        const customers = await User.distinct("_id", { role: "CUSTOMER", $or: customerSearch(query) }).maxTimeMS(5000);
        filter.$or = [{ reference: regex }, { customerId: { $in: customers } }];
      }
    }
    if (req.query.customerId) {
      if (!validId(req.query.customerId)) return fail(res, 400, "Invalid customer.");
      filter.customerId = req.query.customerId;
    }
    for (const field of ["status", "type"]) {
      const input = clean(req.query[field], 80);
      if (input) {
        if (!/^[A-Z_0-9]+$/.test(input)) return fail(res, 400, "Invalid transaction filter.");
        filter[field === "type" ? "serviceType" : field] = field === "status" && ["SUCCESS", "SUCCESSFUL"].includes(input)
          ? { $in: ["SUCCESS", "SUCCESSFUL"] } : input;
      }
    }
    const [rows, total] = await Promise.all([
      Transaction.find(filter).select(txFields).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).maxTimeMS(5000).lean(),
      Transaction.countDocuments(filter).maxTimeMS(5000),
    ]);
    const names = await User.find({ _id: { $in: rows.map(v => v.customerId).filter(Boolean) } })
      .select("_id fullName").maxTimeMS(5000).lean();
    const byId = new Map(names.map(v => [id(v), v.fullName]));
    return ok(res, { items: rows.map(v => ({ ...transaction(v), customerName: byId.get(id(v.customerId)) || "Customer unavailable" })), total, page, limit });
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
      await audit(req, "FINTECH_CASE_UPDATED", reason, { caseId: id(ticket), escalatedTo: "OPERATIONS_MANAGER" }, session);
    });
    return ok(res, { id: id(ticket), caseReference: ticket.caseReference, status: ticket.status });
  } catch (err) { return fail(res, err.httpStatus || 500, err.httpStatus ? err.message : "Unable to escalate ticket."); }
  finally { await session.endSession(); }
};

exports._test = { paging, customer, transaction, validId, escape };

exports.staffHistory = async (req, res) => {
  if (!req.staffAccess?.isHeadOffice &&
      !(req.staffAccess?.roleName === "OPERATIONS_MANAGER" && req.staffAccess?.scope?.type === "GLOBAL" &&
        req.staffAccess.permissions?.includes("operations.staff.view"))) return fail(res, 403, "Staff activity permission required.");
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

exports.virtualAccounts = async (req, res) => {
  try {
    const { page, limit } = paging(req.query);
    const filter = { role: "CUSTOMER" };
    const query = clean(req.query.q, 100);
    if (query) {
      if (query.length < 3) return fail(res, 400, "Enter at least three characters.");
      filter.$or = [...customerSearch(query), { "virtualAccount.accountNumber": query }];
    }
    const status = clean(req.query.status, 30).toUpperCase();
    if (status) {
      if (!["NOT_CREATED", "ACTIVE", "PENDING", "FAILED", "DISABLED", "UNKNOWN"].includes(status))
        return fail(res, 400, "Invalid account status.");
      filter["virtualAccount.status"] = status === "NOT_CREATED"
        ? { $in: ["NOT_CREATED", null] } : status;
    } else {
      // Never-created user defaults are not virtual-account records. Include
      // genuine provisioning failures/pending attempts for support investigation.
      filter.$and = [{ $or: [
        { "virtualAccount.accountNumber": { $type: "string", $ne: "" } },
        { "virtualAccount.status": { $in: ["ACTIVE", "PENDING", "FAILED", "DISABLED", "UNKNOWN"] } },
      ] }];
    }
    const [rows, total] = await Promise.all([
      User.find(filter).select("_id fullName virtualAccount.status virtualAccount.bankName virtualAccount.accountNumber virtualAccount.accountName virtualAccount.failureReason virtualAccount.updatedAt virtualAccount.createdAt")
        .sort({ _id: -1 }).skip((page - 1) * limit).limit(limit).maxTimeMS(5000).lean(),
      User.countDocuments(filter).maxTimeMS(5000),
    ]);
    return ok(res, { items: rows.map((v) => ({ id: id(v), fullName: v.fullName,
      ...safe.account(v.virtualAccount), accountNumber: v.virtualAccount?.accountNumber || "",
      accountName: v.virtualAccount?.accountName || "", createdAt: v.virtualAccount?.createdAt || null,
    })), total, page, limit });
  } catch (_) { return fail(res, 503, "Virtual account records are temporarily unavailable."); }
};

exports.supportSummary = async (req, res) => {
  try {
    const start = new Date(); start.setUTCHours(0, 0, 0, 0);
    // Derive timing from recorded events, never updatedAt (notes can change it).
    const timing = [
      { $match: { type: "COMPLAINT" } },
      { $set: {
        resolutionAt: { $min: { $map: {
          input: { $filter: { input: { $ifNull: ["$statusEvents", []] }, as: "e", cond: { $in: ["$$e.status", ["RESOLVED", "CLOSED"]] } } },
          as: "e", in: "$$e.createdAt",
        } } },
        firstResponseAt: { $min: { $map: {
          input: { $filter: { input: { $ifNull: ["$publicReplies", []] }, as: "r", cond: { $ne: ["$$r.authorRole", "CUSTOMER"] } } },
          as: "r", in: "$$r.createdAt",
        } } },
      } },
      { $set: {
        resolutionSeconds: { $cond: [{ $and: [{ $in: ["$status", ["RESOLVED", "CLOSED"]] }, { $gte: ["$resolutionAt", "$createdAt"] }] }, { $divide: [{ $subtract: ["$resolutionAt", "$createdAt"] }, 1000] }, null] },
        responseSeconds: { $cond: [{ $gte: ["$firstResponseAt", "$createdAt"] }, { $divide: [{ $subtract: ["$firstResponseAt", "$createdAt"] }, 1000] }, null] },
      } },
      { $facet: {
        totals: [{ $group: { _id: null,
          open: { $sum: { $cond: [{ $in: ["$status", ["OPEN", "IN_PROGRESS", "IN_REVIEW", "WAITING_ON_CUSTOMER", "ESCALATED"]] }, 1, 0] } },
          resolved: { $sum: { $cond: [{ $in: ["$status", ["RESOLVED", "CLOSED"]] }, 1, 0] } },
          resolution: { $avg: "$resolutionSeconds" }, response: { $avg: "$responseSeconds" },
        } }],
        team: [
          { $group: { _id: "$assignedTo", assigned: { $sum: 1 },
            resolved: { $sum: { $cond: [{ $in: ["$status", ["RESOLVED", "CLOSED"]] }, 1, 0] } },
            averageResolutionSeconds: { $avg: "$resolutionSeconds" },
            averageFirstResponseSeconds: { $avg: "$responseSeconds" } } },
          { $sort: { assigned: -1 } }, { $limit: 100 },
          { $lookup: { from: User.collection.name, localField: "_id", foreignField: "_id", as: "agent" } },
          { $project: { assigned: 1, resolved: 1, averageResolutionSeconds: 1, averageFirstResponseSeconds: 1,
            name: { $ifNull: [{ $arrayElemAt: ["$agent.fullName", 0] }, "Unassigned"] } } },
        ],
        activity: [
          { $project: { count: { $add: [
            { $size: { $filter: { input: { $ifNull: ["$statusEvents", []] }, as: "e",
              cond: { $and: [{ $gte: ["$$e.createdAt", start] }, { $ne: ["$$e.actorRole", "CUSTOMER"] }] } } } },
            { $size: { $filter: { input: { $ifNull: ["$notes", []] }, as: "n", cond: { $gte: ["$$n.createdAt", start] } } } },
            { $size: { $filter: { input: { $ifNull: ["$publicReplies", []] }, as: "r",
              cond: { $and: [{ $gte: ["$$r.createdAt", start] }, { $ne: ["$$r.authorRole", "CUSTOMER"] }] } } } },
          ] } } },
          { $group: { _id: null, count: { $sum: "$count" } } },
        ],
      } },
    ];
    const [totalCustomers, tx, tickets, roles] = await Promise.all([
      User.countDocuments({ role: "CUSTOMER" }).maxTimeMS(10000),
      Transaction.aggregate([{ $match: { status: { $in: ["PENDING", "FAILED"] } } }, { $group: { _id: "$status", count: { $sum: 1 } } }]).option({ maxTimeMS: 10000 }),
      FintechCase.aggregate(timing).option({ maxTimeMS: 10000 }),
      Role.find({ status: "ACTIVE", scopeType: "GLOBAL", permissions: "support.workspace.view" }).select("_id").lean(),
    ]);
    const activeSupportAgents = await User.countDocuments({
      status: "ACTIVE", isStaff: true, staffRoleId: { $in: roles.map((v) => v._id) },
    }).maxTimeMS(10000);
    const summary = tickets[0]?.totals[0] || {};
    const manager = req.staffAccess.isHeadOffice || req.staffAccess.roleName === "SUPPORT_MANAGER" ||
      req.staffAccess.permissions.includes("operations.workspace.view");
    return ok(res, {
      totalCustomers, pendingTransactions: tx.find((v) => v._id === "PENDING")?.count || 0,
      failedTransactions: tx.find((v) => v._id === "FAILED")?.count || 0,
      openComplaints: summary.open || 0, resolvedTickets: summary.resolved || 0,
      averageResolutionSeconds: summary.resolution ?? null,
      averageFirstResponseSeconds: summary.response ?? null,
      activeSupportAgents, todaySupportActivity: tickets[0]?.activity[0]?.count || 0, dayTimezone: "UTC",
      timingNotice: "Recorded ticket events only; unavailable timing is not zero. Team results reflect current assignment. Today's activity counts staff status events, notes and public replies in UTC.",
      canManageTeam: manager,
      team: manager ? (tickets[0]?.team || []).map((v) => ({ ...v, id: id(v) })) : [],
    });
  } catch (_) { return fail(res, 503, "Support metrics are temporarily unavailable."); }
};
