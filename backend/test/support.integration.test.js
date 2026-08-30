const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const User = require("../models/user.model");
const FintechCase = require("../models/fintechCase.model");
const Notification = require("../models/notification.model");
const AdminAuditLog = require("../models/adminAuditLog.model");
const Transaction = require("../models/transaction.model");
const support = require("../controllers/support.controller");

let mongo; let n = 0;
const models = [User, FintechCase, Notification, AdminAuditLog, Transaction];
const user = (role = "CUSTOMER", extra = {}) => User.create({
  fullName: `${role} ${++n}`, phone: `080${String(n).padStart(8, "0")}`,
  email: `${role.toLowerCase()}${n}@test.local`, password: "Passw0rd!", role,
  isStaff: role !== "CUSTOMER", ...extra,
});
const req = ({ user: actor, body = {}, query = {}, params = {}, method = "POST" }) => ({
  user: actor, body, query, params, method, originalUrl: "/test", ip: "127.0.0.1", headers: { "user-agent": "test" },
});
const call = async (handler, options) => {
  const result = { status: 200 };
  await handler(req(options), { status(code) { result.status = code; return this; }, json(body) { result.body = body; return this; } });
  return result;
};

test.before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(mongo.getUri(), { dbName: "support-tests" });
  await Promise.all(models.map((model) => model.init()));
});
test.after(async () => { await mongoose.disconnect(); await mongo?.stop(); });
test.beforeEach(async () => { await Promise.all(models.map((model) => model.collection.deleteMany({}))); });

test("customer tickets isolate ownership, are idempotent, and omit internal notes", async () => {
  const alice = await user(); const bob = await user();
  const payload = { subject: "Missing transfer", description: "My payment is missing.", idempotencyKey: "alice-create-1", priority: "HIGH" };
  const created = await call(support.createTicket, { user: alice, body: payload });
  assert.equal(created.status, 201); assert.equal(created.body.data.priority, "HIGH");
  const duplicate = await call(support.createTicket, { user: alice, body: payload });
  assert.equal(duplicate.status, 200); assert.equal(duplicate.body.idempotent, true);
  const id = created.body.data.id;
  assert.equal((await call(support.getCustomerTicket, { user: bob, params: { id } })).status, 404);
  const ticket = await FintechCase.findById(id);
  ticket.notes.push({ body: "Internal only", authorId: alice._id, idempotencyKey: "legacy-note" }); await ticket.save();
  const visible = await call(support.getCustomerTicket, { user: alice, params: { id } });
  assert.equal(visible.status, 200); assert.equal("notes" in visible.body.data, false);
  const reply = await call(support.customerReply, { user: alice, params: { id }, body: { message: "Please investigate.", idempotencyKey: "customer-reply-1" } });
  assert.equal(reply.status, 201); assert.equal(reply.body.data.replies[0].authorRole, "CUSTOMER");
  assert.equal("authorId" in reply.body.data.replies[0], false);
});

test("different customers may safely reuse the same client idempotency key", async () => {
  const firstCustomer = await user();
  const secondCustomer = await user();

  const first = await call(support.createTicket, {
    user: firstCustomer,
    body: {
      subject: "First customer issue",
      description: "A persisted support request.",
      idempotencyKey: "shared-client-key",
    },
  });
  const second = await call(support.createTicket, {
    user: secondCustomer,
    body: {
      subject: "Second customer issue",
      description: "A separate persisted support request.",
      idempotencyKey: "shared-client-key",
    },
  });

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.notEqual(first.body.data.id, second.body.data.id);
  assert.equal(await FintechCase.countDocuments(), 2);
});

test("transaction issue persists trusted context and remains idempotent", async () => {
  const customer = await user();
  const admin = await user("HEAD_OFFICE");
  const transaction = await Transaction.create({
    customerId: customer._id,
    reference: "DATA-ISSUE-001",
    serviceType: "DATA",
    provider: "CLUBKONNECT",
    phone: "08031234567",
    amount: 1500,
    status: "PENDING",
  });
  const payload = {
    subject: "Issue with Data",
    description: "Paid but service was not received",
    idempotencyKey: "data-issue-once",
    transactionLookupId: `transaction:${transaction._id}`,
  };

  const created = await call(support.createTicket, {
    user: customer,
    body: payload,
  });
  const duplicate = await call(support.createTicket, {
    user: customer,
    body: payload,
  });

  assert.equal(created.status, 201);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.idempotent, true);
  assert.equal(created.body.data.transactionContext.reference, "DATA-ISSUE-001");
  assert.equal(created.body.data.transactionContext.transactionType, "DATA");
  assert.equal(created.body.data.transactionContext.status, "PENDING");
  assert.match(created.body.data.description, /Transaction reference: DATA-ISSUE-001/);
  assert.equal(await FintechCase.countDocuments(), 1);

  const listed = await call(support.listAdminTickets, {
    user: admin,
    method: "GET",
    query: { search: "Issue with Data" },
  });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.data.items[0].transactionContext.reference, "DATA-ISSUE-001");
});

test("admin support validates updates, creates notifications, and filters tickets", async () => {
  const customer = await user(); const headOffice = await user("HEAD_OFFICE");
  const inactiveStaff = await user("STAFF", { status: "SUSPENDED" });
  const activeStaff = await user("STAFF");
  const created = await call(support.createTicket, { user: customer, body: { subject: "Searchable issue", description: "Need help.", idempotencyKey: "support-create-2" } });
  const id = created.body.data.id;
  assert.equal((await call(support.updateTicket, { user: headOffice, params: { id }, body: { status: "REJECTED" } })).status, 400);
  assert.equal((await call(support.updateTicket, { user: headOffice, params: { id }, body: { priority: "ASAP" } })).status, 400);
  assert.equal((await call(support.updateTicket, { user: headOffice, params: { id }, body: { assignedTo: inactiveStaff._id } })).status, 400);
  const updated = await call(support.updateTicket, { user: headOffice, params: { id }, body: { status: "IN_PROGRESS", priority: "URGENT", assignedTo: activeStaff._id } });
  assert.equal(updated.status, 200); assert.equal(updated.body.data.status, "IN_PROGRESS");
  assert.equal(await Notification.countDocuments({ userId: customer._id }), 1);
  const reply = await call(support.adminReply, { user: headOffice, params: { id }, body: { message: "We are reviewing this now.", idempotencyKey: "admin-reply-1" } });
  assert.equal(reply.status, 201); assert.equal(await Notification.countDocuments({ userId: customer._id }), 2);
  const listed = await call(support.listAdminTickets, { user: headOffice, method: "GET", query: { search: customer.email, status: "IN_PROGRESS", priority: "URGENT" } });
  assert.equal(listed.status, 200); assert.equal(listed.body.data.total, 1);
  assert.equal(await AdminAuditLog.countDocuments({ action: "FINTECH_CASE_UPDATED" }), 1);
});

test("FintechCase keeps legacy status support while adding support workflow fields", () => {
  assert.ok(FintechCase.schema.path("status").enumValues.includes("IN_REVIEW"));
  assert.ok(FintechCase.schema.path("status").enumValues.includes("IN_PROGRESS"));
  assert.equal(FintechCase.schema.path("priority").options.default, "NORMAL");
  assert.equal(FintechCase.schema.path("publicReplies").schema.path("authorRole").options.required, true);
  assert.equal(FintechCase.schema.path("publicReplies").schema.path("idempotencyKey").options.maxlength, 120);
  assert.equal(FintechCase.schema.path("notes").schema.path("idempotencyKey").options.maxlength, 120);
});

test("reply and note actions are idempotent and history is capped", async () => {
  const customer = await user(); const admin = await user("HEAD_OFFICE");
  const created = await call(support.createTicket, { user: customer, body: { subject: "Cap test", description: "Need help", idempotencyKey: "cap-ticket" } });
  const id = created.body.data.id;
  assert.equal((await call(support.customerReply, { user: customer, params: { id }, body: { message: "No key" } })).status, 400);
  assert.equal((await call(support.adminReply, { user: admin, params: { id }, body: { message: "No key" } })).status, 400);
  assert.equal((await call(support.addNote, { user: admin, params: { id }, body: { body: "No key" } })).status, 400);
  const firstReply = await call(support.customerReply, { user: customer, params: { id }, body: { message: "One reply", idempotencyKey: "reply-once" } });
  const duplicateReply = await call(support.customerReply, { user: customer, params: { id }, body: { message: "Changed message", idempotencyKey: "reply-once" } });
  assert.equal(firstReply.status, 201); assert.equal(duplicateReply.status, 200);
  assert.equal(duplicateReply.body.idempotent, true);
  assert.equal((await FintechCase.findById(id)).publicReplies.length, 1);

  const firstAdminReply = await call(support.adminReply, { user: admin, params: { id }, body: { message: "Support response", idempotencyKey: "admin-reply-once" } });
  const duplicateAdminReply = await call(support.adminReply, { user: admin, params: { id }, body: { message: "Changed support response", idempotencyKey: "admin-reply-once" } });
  assert.equal(firstAdminReply.status, 201); assert.equal(duplicateAdminReply.status, 200);
  assert.equal(duplicateAdminReply.body.idempotent, true);
  assert.ok(firstAdminReply.body.data.publicReplies[1].authorId);
  assert.equal((await FintechCase.findById(id)).publicReplies.length, 2);

  const firstNote = await call(support.addNote, { user: admin, params: { id }, body: { body: "Private note", idempotencyKey: "note-once" } });
  const duplicateNote = await call(support.addNote, { user: admin, params: { id }, body: { body: "Changed private note", idempotencyKey: "note-once" } });
  assert.equal(firstNote.status, 201); assert.equal(duplicateNote.status, 200);
  assert.equal(duplicateNote.body.idempotent, true);
  assert.equal((await FintechCase.findById(id)).notes.length, 1);

  const ticket = await FintechCase.findById(id);
  ticket.publicReplies = Array.from({ length: 200 }, (_, index) => ({
    message: `Reply ${index}`, authorId: customer._id, authorName: "Customer",
    authorRole: "CUSTOMER", idempotencyKey: `filled-reply-${index}`,
  }));
  ticket.notes = Array.from({ length: 200 }, (_, index) => ({
    body: `Note ${index}`, authorId: admin._id, idempotencyKey: `filled-note-${index}`,
  }));
  await ticket.save();
  assert.equal((await call(support.adminReply, { user: admin, params: { id }, body: { message: "Over cap", idempotencyKey: "over-cap-reply" } })).status, 409);
  assert.equal((await call(support.addNote, { user: admin, params: { id }, body: { body: "Over cap", idempotencyKey: "over-cap-note" } })).status, 409);
});