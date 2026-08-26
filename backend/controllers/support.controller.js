const crypto = require("crypto");
const FintechCase = require("../models/fintechCase.model");
const User = require("../models/user.model");
const Notification = require("../models/notification.model");
const AdminAuditLog = require("../models/adminAuditLog.model");

const SUPPORT_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];
const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"];
const clean = (value, max = 500) => String(value || "").trim().slice(0, max);
const pageValues = (query) => ({ page: Math.max(1, Number(query.page) || 1), limit: Math.min(100, Math.max(1, Number(query.limit) || 25)) });
const value = (input) => clean(input).toUpperCase();
const error = (res, status, message) => res.status(status).json({ success: false, message });
const caseReference = () => `SUP-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
const customerId = (req) => req.user._id || req.user.id;
const MAX_PUBLIC_REPLIES = 200;
const MAX_INTERNAL_NOTES = 200;

const customerReply = (reply) => ({
  id: String(reply._id), message: reply.message,
  authorName: reply.authorName, authorRole: reply.authorRole, createdAt: reply.createdAt,
});
const adminReply = (reply) => ({
  id: String(reply._id), message: reply.message, authorId: String(reply.authorId),
  authorName: reply.authorName, authorRole: reply.authorRole, createdAt: reply.createdAt,
});
const customerCase = (item, withReplies = false) => {
  const data = {
    id: String(item._id), caseReference: item.caseReference, type: item.type,
    subject: item.subject, description: item.description, status: item.status,
    priority: item.priority, resolution: item.resolution || "", createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
  if (withReplies) data.replies = (item.publicReplies || []).map(customerReply);
  return data;
};
const adminCase = (item) => ({
  ...item.toObject(),
  id: String(item._id),
  publicReplies: (item.publicReplies || []).map(adminReply),
});
const audit = async (req, action, previousData, newData, metadata) => {
  await AdminAuditLog.create({
    actorId: customerId(req), actorRole: req.user.role, actorName: clean(req.user.fullName || req.user.name, 200),
    action, reason: "Updated customer support ticket.", previousData, newData, metadata,
    ipAddress: clean(req.ip, 100), userAgent: clean(req.get?.("user-agent") || req.headers?.["user-agent"], 500),
    requestMethod: req.method, requestPath: req.originalUrl,
  });
};
const notify = (ticket, title, message) => Notification.create({
  userId: ticket.customer, title, message, type: "GENERAL",
  referenceId: ticket._id, referenceType: "SUPPORT_TICKET",
});
const ticketFilter = (query, ownCustomer) => {
  const filter = ownCustomer ? { customer: ownCustomer, type: "COMPLAINT" } : { type: "COMPLAINT" };
  const status = value(query.status); const priority = value(query.priority);
  if (status && SUPPORT_STATUSES.includes(status)) filter.status = status;
  if (priority && PRIORITIES.includes(priority)) filter.priority = priority;
  if (query.assignedTo && !ownCustomer) filter.assignedTo = query.assignedTo;
  const search = clean(query.search, 200);
  if (search) filter.$or = [{ caseReference: { $regex: search, $options: "i" } }, { subject: { $regex: search, $options: "i" } }];
  return filter;
};
const addAdminCustomerSearch = async (filter, search) => {
  if (!search) return filter;
  const customers = await User.find({
    $or: [{ fullName: { $regex: search, $options: "i" } }, { phone: { $regex: search, $options: "i" } }, { email: { $regex: search, $options: "i" } }],
  }).select("_id");
  const terms = filter.$or || [];
  delete filter.$or;
  filter.$or = [...terms, { customer: { $in: customers.map((customer) => customer._id) } }];
  return filter;
};

exports.createTicket = async (req, res) => {
  try {
    const subject = clean(req.body.subject, 200), description = clean(req.body.description, 5000);
    const clientIdempotencyKey = clean(req.body.idempotencyKey, 120);
    const idempotencyKey = `support:${customerId(req)}:${clientIdempotencyKey}`;
    const priority = value(req.body.priority || "NORMAL");
    if (!subject || !description || !clientIdempotencyKey) return error(res, 400, "subject, description and idempotencyKey are required.");
    if (!PRIORITIES.includes(priority)) return error(res, 400, "Invalid priority.");
    const existing = await FintechCase.findOne({ idempotencyKey });
    if (existing) {
      if (String(existing.customer) !== String(customerId(req))) return error(res, 409, "Idempotency key already exists.");
      return res.json({ success: true, data: customerCase(existing), idempotent: true });
    }
    const ticket = await FintechCase.create({
      caseReference: caseReference(), idempotencyKey, type: "COMPLAINT", subject, description,
      priority, customer: customerId(req), createdBy: customerId(req),
    });
    return res.status(201).json({ success: true, data: customerCase(ticket) });
  } catch (err) {
    if (err?.code === 11000) {
      const ticket = await FintechCase.findOne({
        idempotencyKey:
          `support:${customerId(req)}:${clean(req.body.idempotencyKey, 120)}`,
      });
      if (ticket && String(ticket.customer) === String(customerId(req))) return res.json({ success: true, data: customerCase(ticket), idempotent: true });
      return error(res, 409, "Idempotency key already exists.");
    }
    return error(res, 500, "Unable to create support ticket.");
  }
};
exports.listCustomerTickets = async (req, res) => {
  try {
    const { page, limit } = pageValues(req.query); const filter = ticketFilter(req.query, customerId(req));
    const [items, total] = await Promise.all([FintechCase.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit), FintechCase.countDocuments(filter)]);
    res.json({ success: true, data: { page, limit, total, items: items.map((item) => customerCase(item)) } });
  } catch (_) { error(res, 500, "Unable to load support tickets."); }
};
exports.getCustomerTicket = async (req, res) => {
  try {
    const ticket = await FintechCase.findOne({ _id: req.params.id, customer: customerId(req), type: "COMPLAINT" });
    if (!ticket) return error(res, 404, "Support ticket not found.");
    return res.json({ success: true, data: customerCase(ticket, true) });
  } catch (_) { return error(res, 404, "Support ticket not found."); }
};
exports.customerReply = async (req, res) => {
  try {
    const message = clean(req.body.message, 2000);
    const clientKey = clean(req.body.idempotencyKey, 100);
    if (!message || !clientKey) return error(res, 400, "message and idempotencyKey are required.");
    const idempotencyKey = `customer_reply:${clientKey}`;
    const filter = { _id: req.params.id, customer: customerId(req), type: "COMPLAINT" };
    let ticket = await FintechCase.findOne(filter);
    if (!ticket) return error(res, 404, "Support ticket not found.");
    if (ticket.publicReplies.some((reply) => reply.idempotencyKey === idempotencyKey)) return res.json({ success: true, data: customerCase(ticket, true), idempotent: true });
    ticket = await FintechCase.findOneAndUpdate(
      { ...filter, publicReplies: { $not: { $elemMatch: { idempotencyKey } } }, $expr: { $lt: [{ $size: "$publicReplies" }, MAX_PUBLIC_REPLIES] } },
      { $push: { publicReplies: { message, authorId: customerId(req), authorName: clean(req.user.fullName, 200), authorRole: "CUSTOMER", idempotencyKey } } },
      { returnDocument: "after" },
    );
    if (!ticket) {
      ticket = await FintechCase.findOne(filter);
      if (ticket?.publicReplies.some((reply) => reply.idempotencyKey === idempotencyKey)) return res.json({ success: true, data: customerCase(ticket, true), idempotent: true });
      return error(res, 409, `A ticket can contain at most ${MAX_PUBLIC_REPLIES} public replies.`);
    }
    return res.status(201).json({ success: true, data: customerCase(ticket, true) });
  } catch (_) { return error(res, 400, "Unable to add support reply."); }
};

exports.metrics = async (req, res) => {
  try {
    const [statuses, priorities, total] = await Promise.all([
      FintechCase.aggregate([{ $match: { type: "COMPLAINT" } }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
      FintechCase.aggregate([{ $match: { type: "COMPLAINT" } }, { $group: { _id: "$priority", count: { $sum: 1 } } }]),
      FintechCase.countDocuments({ type: "COMPLAINT" }),
    ]);
    const counts = (rows, values) => Object.fromEntries(values.map((key) => [key, rows.find((row) => row._id === key)?.count || 0]));
    res.json({ success: true, data: { total, statuses: counts(statuses, SUPPORT_STATUSES), priorities: counts(priorities, PRIORITIES) } });
  } catch (_) { error(res, 500, "Unable to load support metrics."); }
};
exports.listAdminTickets = async (req, res) => {
  try {
    const { page, limit } = pageValues(req.query);
    const filter = await addAdminCustomerSearch(ticketFilter(req.query), clean(req.query.search, 200));
    const [items, total] = await Promise.all([
      FintechCase.find(filter).populate("customer", "fullName phone email").populate("assignedTo", "fullName phone email role").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      FintechCase.countDocuments(filter),
    ]);
    res.json({ success: true, data: { page, limit, total, items: items.map(adminCase) } });
  } catch (_) { error(res, 500, "Unable to load support tickets."); }
};
exports.getAdminTicket = async (req, res) => {
  try {
    const ticket = await FintechCase.findOne({ _id: req.params.id, type: "COMPLAINT" }).populate("customer", "fullName phone email").populate("assignedTo", "fullName phone email role").populate("notes.authorId", "fullName role");
    if (!ticket) return error(res, 404, "Support ticket not found.");
    return res.json({ success: true, data: adminCase(ticket) });
  } catch (_) { return error(res, 404, "Support ticket not found."); }
};
exports.updateTicket = async (req, res) => {
  try {
    const requestedStatus = req.body.status === undefined ? null : value(req.body.status);
    const priority = req.body.priority === undefined ? null : value(req.body.priority);
    if (requestedStatus && !SUPPORT_STATUSES.includes(requestedStatus)) return error(res, 400, "Invalid support status.");
    if (priority && !PRIORITIES.includes(priority)) return error(res, 400, "Invalid priority.");
    let assignee = null;
    if (req.body.assignedTo !== undefined && req.body.assignedTo) {
      assignee = await User.findOne({
        _id: req.body.assignedTo, status: "ACTIVE", role: { $ne: "CUSTOMER" },
        $or: [{ isStaff: true }, { role: "HEAD_OFFICE" }],
      });
      if (!assignee) return error(res, 400, "assignedTo must be an active non-customer staff or admin.");
    }
    const ticket = await FintechCase.findOne({ _id: req.params.id, type: "COMPLAINT" });
    if (!ticket) return error(res, 404, "Support ticket not found.");
    const previousData = { status: ticket.status, priority: ticket.priority, assignedTo: ticket.assignedTo, resolution: ticket.resolution };
    if (requestedStatus) ticket.status = requestedStatus;
    if (priority) ticket.priority = priority;
    if (req.body.assignedTo !== undefined) ticket.assignedTo = assignee ? assignee._id : null;
    if (req.body.resolution !== undefined) ticket.resolution = clean(req.body.resolution, 3000);
    await ticket.save();
    await audit(req, "FINTECH_CASE_UPDATED", previousData, { status: ticket.status, priority: ticket.priority, assignedTo: ticket.assignedTo, resolution: ticket.resolution }, { caseId: String(ticket._id) });
    if (requestedStatus && requestedStatus !== previousData.status) await notify(ticket, "Support ticket updated", `Your ticket ${ticket.caseReference} is now ${requestedStatus.replace("_", " ")}.`);
    return res.json({ success: true, data: adminCase(ticket) });
  } catch (_) { return error(res, 500, "Unable to update support ticket."); }
};
exports.adminReply = async (req, res) => {
  try {
    const message = clean(req.body.message, 2000), clientKey = clean(req.body.idempotencyKey, 100);
    if (!message || !clientKey) return error(res, 400, "message and idempotencyKey are required.");
    const idempotencyKey = `admin_reply:${clientKey}`, filter = { _id: req.params.id, type: "COMPLAINT" };
    let ticket = await FintechCase.findOne(filter); if (!ticket) return error(res, 404, "Support ticket not found.");
    if (ticket.publicReplies.some((reply) => reply.idempotencyKey === idempotencyKey)) return res.json({ success: true, data: adminCase(ticket), idempotent: true });
    ticket = await FintechCase.findOneAndUpdate(
      { ...filter, publicReplies: { $not: { $elemMatch: { idempotencyKey } } }, $expr: { $lt: [{ $size: "$publicReplies" }, MAX_PUBLIC_REPLIES] } },
      { $push: { publicReplies: { message, authorId: customerId(req), authorName: clean(req.user.fullName, 200), authorRole: req.user.role, idempotencyKey } } },
      { returnDocument: "after" },
    );
    if (!ticket) {
      ticket = await FintechCase.findOne(filter);
      if (ticket?.publicReplies.some((reply) => reply.idempotencyKey === idempotencyKey)) return res.json({ success: true, data: adminCase(ticket), idempotent: true });
      return error(res, 409, `A ticket can contain at most ${MAX_PUBLIC_REPLIES} public replies.`);
    }
    await notify(ticket, "New support reply", `Support replied to ticket ${ticket.caseReference}.`);
    return res.status(201).json({ success: true, data: adminCase(ticket) });
  } catch (_) { return error(res, 500, "Unable to add support reply."); }
};
exports.addNote = async (req, res) => {
  try {
    const body = clean(req.body.body, 2000), clientKey = clean(req.body.idempotencyKey, 100);
    if (!body || !clientKey) return error(res, 400, "body and idempotencyKey are required.");
    const idempotencyKey = `admin_note:${clientKey}`, filter = { _id: req.params.id, type: "COMPLAINT" };
    let ticket = await FintechCase.findOne(filter); if (!ticket) return error(res, 404, "Support ticket not found.");
    if (ticket.notes.some((note) => note.idempotencyKey === idempotencyKey)) return res.json({ success: true, data: adminCase(ticket), idempotent: true });
    ticket = await FintechCase.findOneAndUpdate(
      { ...filter, notes: { $not: { $elemMatch: { idempotencyKey } } }, $expr: { $lt: [{ $size: "$notes" }, MAX_INTERNAL_NOTES] } },
      { $push: { notes: { body, authorId: customerId(req), idempotencyKey } } },
      { returnDocument: "after" },
    );
    if (!ticket) {
      ticket = await FintechCase.findOne(filter);
      if (ticket?.notes.some((note) => note.idempotencyKey === idempotencyKey)) return res.json({ success: true, data: adminCase(ticket), idempotent: true });
      return error(res, 409, `A ticket can contain at most ${MAX_INTERNAL_NOTES} internal notes.`);
    }
    await audit(req, "FINTECH_CASE_UPDATED", null, { noteAdded: true }, { caseId: String(ticket._id) });
    return res.status(201).json({ success: true, data: adminCase(ticket) });
  } catch (_) { return error(res, 500, "Unable to add internal note."); }
};
exports.staff = async (req, res) => {
  try {
    const search = clean(req.query.search, 200);
    const filter = { status: "ACTIVE", role: { $ne: "CUSTOMER" }, $or: [{ isStaff: true }, { role: "HEAD_OFFICE" }] };
    if (search) filter.$and = [{ $or: [{ fullName: { $regex: search, $options: "i" } }, { phone: { $regex: search, $options: "i" } }, { email: { $regex: search, $options: "i" } }] }];
    const items = await User.find(filter).select("fullName phone email role isStaff department").sort({ fullName: 1 }).limit(100);
    res.json({ success: true, data: { items } });
  } catch (_) { error(res, 500, "Unable to load support staff."); }
};