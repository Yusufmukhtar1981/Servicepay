const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const User = require("../models/user.model");
const Role = require("../models/role.model");
const AppSettings = require("../models/appSettings.model");
const Conversation = require("../models/aiSupportConversation.model");
const Case = require("../models/fintechCase.model");
const RateLimit = require("../models/aiSupportRateLimit.model");
const Audit = require("../models/adminAuditLog.model");
const Notification = require("../models/notification.model");
const Transaction = require("../models/transaction.model");
const smart = require("../services/smartSupport.service");
const controller = require("../controllers/smartSupport.controller");
const legacy = require("../controllers/aiSupport.controller");
const { getProviderReply } = require("../services/aiProvider.service");
const { loadStaffRole, requirePermission } = require("../middleware/staffPermission.middleware");
const { STAFF_PERMISSIONS: P } = require("../config/staffPermissions");

let mongo, sequence = 0;
const models = [User, Role, AppSettings, Conversation, Case, RateLimit, Audit, Notification, Transaction];
const actor = role => User.create({
  fullName: `Support Fixture ${++sequence}`, phone: `080${String(sequence).padStart(8, "0")}`,
  email: `fixture${sequence}@example.test`, password: "Example123!", role: role || "CUSTOMER", status: "ACTIVE",
});
const call = async (handler, user, body = {}, extra = {}) => {
  const result = { status: 200 };
  const req = { user, body, params: {}, query: {}, method: "POST", originalUrl: "/test", ...extra };
  const res = { status(s) { result.status = s; return this; }, json(b) { result.body = b; return this; } };
  await handler(req, res);
  return result;
};
const enable = async () => {
  const settings = await AppSettings.getGlobalSettings();
  await AppSettings.updateOne({ _id: settings._id }, { $set: { "support.smartSupportEnabled": true, "support.smartSupportDailyBudgetUsd": 2 } });
};
test.before(async () => {
  // Never use ambient production credentials, even if the suite is run manually.
  delete process.env.OPENAI_API_KEY;
  delete process.env.AI_API_KEY;
  process.env.AI_SUPPORT_APPROVED_DAILY_USD = "2";
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri(), { dbName: "smart-support-isolated-tests" });
  await Promise.all(models.map(m => m.init()));
});
// Direct collection cleanup is confined to this disposable in-memory database.
// Do not weaken the production append-only audit middleware for test fixtures.
test.beforeEach(async () => {
  delete process.env.AI_SUPPORT_ENGLISH_VOICE_VERIFIED;
  for (const model of models) await model.collection.deleteMany({});
});
test.after(async () => { await mongoose.disconnect(); await mongo?.stop(); });

test("detects English and Hausa and respects explicit selection", () => {
  assert.equal(smart.languageOf("Sannu, ina son taimako"), "ha");
  assert.equal(smart.languageOf("Why is my data pending?"), "en");
  assert.equal(smart.languageOf("Hello", "ha"), "ha");
});
test("redacts secrets, identity numbers and contact details before storage/provider context", () => {
  const text = smart.clean("email me at test@example.test, phone 08012345678, my pin is 1234");
  assert.doesNotMatch(text, /test@example|08012345678|1234/);
});
test("new feature is disabled by default and voice remains server-disabled", async () => {
  const settings = await smart.getSettings();
  assert.equal(settings.enabled, false);
  assert.equal(settings.englishVoiceEnabled, false);
  assert.equal(settings.hausaVoiceEnabled, false);
});
test("global budget reserves at most the approved $2 under concurrent requests", async () => {
  const results = await Promise.all(Array.from({ length: 30 }, () => smart.reserveTextBudget({ dailyBudgetUsd: 2 })));
  assert.equal(results.filter(Boolean).length, 20);
  assert.equal(await smart.budgetReservedUsd(), 2);
  assert.equal(await smart.reserveTextBudget({ dailyBudgetUsd: 0 }), false);
});
test("paid provider cannot be called through the legacy path without budget authorization", async () => {
  let called = false;
  assert.equal(await getProviderReply({ requester: { post() { called = true; } } }), null);
  assert.equal(called, false);
});
test("investigation always uses authenticated ownership and never serializes private recipient data", async () => {
  const customer = await actor(), stranger = await actor();
  const transaction = await Transaction.create({
    customerId: customer._id, reference: "DATA-FIXTURE-1", serviceType: "DATA",
    provider: "TEST_PROVIDER", phone: "08012345678", amount: 1500, status: "PENDING",
  });
  const before = JSON.stringify(await Transaction.findById(transaction._id).lean());
  const own = await smart.investigate({ userId: customer._id, transactionLookupId: `transaction:${transaction._id}`, message: "pending data" });
  assert.equal(own.status, "PENDING");
  assert.equal(own.uncertain, true);
  assert.doesNotMatch(JSON.stringify(own), /08012345678|TEST_PROVIDER|1500/);
  const other = await smart.investigate({ userId: stranger._id, transactionLookupId: `transaction:${transaction._id}`, message: "pending data" });
  assert.deepEqual(other, { notFound: true });
  assert.equal(JSON.stringify(await Transaction.findById(transaction._id).lean()), before);
});
test("virtual account investigation is read-only and returns no account or provider details", async () => {
  const customer = await actor();
  await User.updateOne({ _id: customer._id }, { $set: {
    virtualAccount: { accountNumber: "1234567890", accountName: "PRIVATE FIXTURE", status: "ACTIVE", customerReference: "PRIVATE" },
  } });
  const before = JSON.stringify(await User.findById(customer._id).lean());
  const result = await smart.investigate({ userId: customer._id, message: "virtual account" });
  assert.equal(result.status, "ACTIVE");
  assert.equal(result.uncertain, false);
  assert.doesNotMatch(JSON.stringify(result), /1234567890|PRIVATE/);
  assert.equal(JSON.stringify(await User.findById(customer._id).lean()), before);
});
test("failed transaction returns deterministic stored evidence without a provider request", async () => {
  await enable();
  const customer = await actor();
  const tx = await Transaction.create({ customerId: customer._id, reference: "FAILED-FIXTURE", serviceType: "AIRTIME", amount: 100, status: "FAILED" });
  const result = await call(controller.smartChat, customer, { message: "Why did airtime fail?", transactionLookupId: `transaction:${tx._id}` });
  assert.equal(result.status, 200);
  assert.equal(result.body.source, "backend_record");
  assert.match(result.body.reply, /FAILED/);
  assert.match(result.body.reply, /not a fresh provider confirmation/);
  assert.equal(await smart.budgetReservedUsd(), 0);
});
test("uncertain transaction creates one owned complaint on repeated messages without financial changes", async () => {
  await enable();
  const customer = await actor();
  const tx = await Transaction.create({ customerId: customer._id, reference: "PENDING-FIXTURE", serviceType: "DATA", amount: 100, status: "PENDING" });
  const payload = { message: "My data is pending", transactionLookupId: `transaction:${tx._id}` };
  const first = await call(controller.smartChat, customer, payload);
  const again = await call(controller.smartChat, customer, payload);
  assert.equal(first.status, 200);
  assert.equal(again.body.ticket.id, first.body.ticket.id);
  assert.equal(await Case.countDocuments(), 1);
  assert.equal(await Audit.countDocuments({ action: "SMART_SUPPORT_ESCALATED" }), 1);
  assert.equal((await Transaction.findById(tx._id)).status, "PENDING");
});
test("English and Hausa fallback is explicit and creates a real ticket without a key", async () => {
  await enable();
  const customer = await actor();
  const result = await call(controller.smartChat, customer, { message: "Sannu ina son taimako", language: "auto" });
  assert.equal(result.status, 200);
  assert.equal(result.body.language, "ha");
  assert.equal(result.body.source, "fallback");
  assert.ok(result.body.ticket.caseReference);
});
test("chat rejects invalid input, foreign records, and does not store disclosed credentials", async () => {
  await enable();
  const customer = await actor();
  assert.equal((await call(controller.smartChat, null, { message: "Hello" })).status, 401);
  assert.equal((await call(controller.smartChat, customer, { message: "" })).status, 400);
  assert.equal((await call(controller.smartChat, customer, { message: "x".repeat(2001) })).status, 400);
  const result = await call(controller.smartChat, customer, { message: "my pin is 1234" });
  assert.equal(result.status, 200);
  assert.equal(await Conversation.countDocuments(), 0);
});
test("customer feedback and history deletion are isolated to the signed-in customer", async () => {
  const customer = await actor(), stranger = await actor();
  await Conversation.create({ userId: customer._id, messages: [{ role: "USER", message: "Help" }] });
  assert.equal((await call(controller.feedback, stranger, { rating: 5 })).status, 404);
  assert.equal((await call(controller.feedback, customer, { rating: 6 })).status, 400);
  assert.equal((await call(controller.feedback, customer, { rating: 4, comment: "Helpful" })).status, 200);
  assert.equal((await call(controller.getFeedback, customer)).body.data.rating, 4);
  await call(legacy.deleteHistory, stranger);
  assert.equal(await Conversation.countDocuments(), 1);
  await call(legacy.deleteHistory, customer);
  assert.equal(await Conversation.countDocuments(), 0);
});
test("knowledge updates require valid revision, sanitize fields and persist an audit atomically", async () => {
  const head = await actor("HEAD_OFFICE");
  const body = { revision: 0, reason: "Approved support guidance", articles: [
    { id: "data-help", title: "Data help", body: "Check Transaction History for stored status.", language: "en", approved: true },
  ] };
  assert.equal((await call(controller.updateKnowledge, head, body)).status, 200);
  assert.equal((await call(controller.updateKnowledge, head, body)).status, 409);
  assert.equal((await call(controller.getKnowledge, head)).body.data.revision, 1);
  assert.equal(await Audit.countDocuments({ action: "SMART_SUPPORT_KNOWLEDGE_UPDATED" }), 1);
});
test("settings reject overspending, unverified voice and activation without credentials", async () => {
  const head = await actor("HEAD_OFFICE");
  const body = { enabled: false, retentionDays: 30, dailyBudgetUsd: 2 };
  assert.equal((await call(controller.updateSettings, head, { ...body, dailyBudgetUsd: 3 })).status, 400);
  assert.equal((await call(controller.updateSettings, head, { ...body, englishVoiceEnabled: true })).status, 409);
  assert.equal((await call(controller.updateSettings, head, { ...body, enabled: true })).status, 409);
  assert.equal((await call(controller.updateSettings, head, body)).status, 200);
  assert.equal(await Audit.countDocuments({ action: "SMART_SUPPORT_SETTINGS_UPDATED" }), 1);
});
test("admin conversation review is audited; metrics do not fabricate unknown response times", async () => {
  const customer = await actor(), head = await actor("HEAD_OFFICE");
  const conversation = await Conversation.create({ userId: customer._id, messages: [{ role: "USER", message: "Help" }] });
  const result = await call(controller.conversation, head, {}, { params: { id: String(conversation._id) } });
  assert.equal(result.status, 200);
  assert.equal(await Audit.countDocuments({ action: "SMART_SUPPORT_CONVERSATION_VIEWED" }), 1);
  const metrics = (await call(controller.metrics, head)).body.data;
  assert.equal(metrics.conversations, 1);
  assert.equal(metrics.averageResponseSeconds, null);
  assert.equal(metrics.averageResolutionSeconds, null);
});
test("existing support permission middleware denies customers and unauthorized staff", async () => {
  const customer = await actor(), staff = await actor("STAFF");
  for (const user of [customer, staff]) {
    const req = { user };
    let passed = false, denied = false;
    const res = { status() { denied = true; return this; }, json() {} };
    await loadStaffRole(req, res, () => {});
    await requirePermission(P.SUPPORT_VIEW)(req, res, () => { passed = true; });
    assert.equal(passed, false);
    assert.equal(denied, true);
  }
});

const wav = (seconds = 1) => {
  const data = Buffer.alloc(44 + Math.floor(seconds * 16000) * 2);
  data.write("RIFF"); data.writeUInt32LE(data.length - 8, 4); data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(16000, 24); data.writeUInt32LE(32000, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write("data", 36); data.writeUInt32LE(data.length - 44, 40);
  return data;
};
test("recording parser enforces actual format, sample rate and duration, not client claims", () => {
  const voice = require("../services/smartSupportVoice.service");
  assert.equal(voice.decodeRecording(wav().toString("base64")).duration, 1);
  for (const bytes of [Buffer.from("not audio"), wav(31), wav(0.1)]) {
    assert.throws(() => voice.decodeRecording(bytes.toString("base64")));
  }
  const wrongRate = wav(); wrongRate.writeUInt32LE(8000, 24);
  assert.throws(() => voice.decodeRecording(wrongRate.toString("base64")));
});
test("voice requires activation, verified language and explicit consent before spending", async () => {
  const customer = await actor();
  await enable();
  const payload = { language: "en", consent: true, audioBase64: wav().toString("base64") };
  assert.equal((await call(controller.transcribe, customer, payload)).status, 409);
  process.env.AI_SUPPORT_ENGLISH_VOICE_VERIFIED = "true";
  await AppSettings.updateOne({}, { $set: { "support.smartSupportEnglishVoiceEnabled": true } });
  assert.equal((await call(controller.transcribe, customer, { ...payload, consent: false })).status, 400);
  assert.equal((await call(controller.transcribe, customer, { ...payload, language: "ha" })).status, 409);
  assert.equal((await call(controller.transcribe, customer, { ...payload, audioBase64: "broken" })).status, 400);
  assert.equal(await smart.budgetReservedUsd(), 0);
});
test("speech cannot read another customer's reply, user messages, or shifted history indices", async () => {
  const customer = await actor(), other = await actor();
  await enable();
  process.env.AI_SUPPORT_ENGLISH_VOICE_VERIFIED = "true";
  await AppSettings.updateOne({}, { $set: { "support.smartSupportEnglishVoiceEnabled": true } });
  await Conversation.create({ userId: customer._id, messages: [{ role: "USER", message: "Question" }, { role: "ASSISTANT", message: "Safe reply." }] });
  const payload = { language: "en", consent: true, messageIndex: 1, messageText: "Safe reply." };
  assert.equal((await call(controller.speech, other, payload)).status, 404);
  assert.equal((await call(controller.speech, customer, { ...payload, messageIndex: 0 })).status, 404);
  assert.equal((await call(controller.speech, customer, { ...payload, messageText: "Different reply" })).status, 409);
  await Conversation.updateOne({ userId: customer._id }, { $set: { "messages.1.language": "ha" } });
  assert.equal((await call(controller.speech, customer, payload)).status, 409);
  assert.equal(await smart.budgetReservedUsd(), 0);
});
test("voice endpoints reserve budget and return only sanitized text or bounded audio with mocked providers", async () => {
  const customer = await actor();
  await enable();
  process.env.AI_SUPPORT_ENGLISH_VOICE_VERIFIED = "true";
  await AppSettings.updateOne({}, { $set: { "support.smartSupportEnglishVoiceEnabled": true } });
  const voice = require("../services/smartSupportVoice.service");
  const originalTranscribe = voice.transcribe, originalSpeak = voice.speak;
  voice.transcribe = async () => "Safe transcript.";
  voice.speak = async () => ({ audioBase64: "fixture", mimeType: "audio/mpeg", disclosure: "AI-generated" });
  try {
    assert.equal((await call(controller.transcribe, customer, { language: "en", consent: true, audioBase64: wav().toString("base64") })).body.data.text, "Safe transcript.");
    await Conversation.create({ userId: customer._id, messages: [{ role: "ASSISTANT", message: "Safe reply." }] });
    const result = await call(controller.speech, customer, { language: "en", consent: true, messageIndex: 0, messageText: "Safe reply." });
    assert.equal(result.status, 200);
    assert.equal(result.body.data.mimeType, "audio/mpeg");
    assert.equal(await smart.budgetReservedUsd(), 0.2);
  } finally { voice.transcribe = originalTranscribe; voice.speak = originalSpeak; }
});
test("customer record selector returns only owned history and follows the delivery cursor", async () => {
  await enable();
  const customer = await actor(), other = await actor();
  await Transaction.create({ customerId: customer._id, reference: "OWN-RECORD", serviceType: "DATA", amount: 100, status: "PENDING" });
  await Transaction.create({ customerId: other._id, reference: "OTHER-RECORD", serviceType: "DATA", amount: 100, status: "PENDING" });
  const result = await call(controller.records, customer);
  assert.equal(result.status, 200);
  assert.ok(result.body.data.items.some(row => row.reference === "OWN-RECORD"));
  assert.equal(result.body.data.items.some(row => row.reference === "OTHER-RECORD"), false);
  assert.equal(result.body.data.nextCursor, "deliveries:");
  assert.equal((await call(controller.records, customer, {}, { query: { cursor: "deliveries:invalid" } })).status, 400);
});
test("history exposes actual stored message indices rather than screen welcome-message indices", async () => {
  const customer = await actor();
  await Conversation.create({ userId: customer._id, messages: [{ role: "USER", message: "Help" }, { role: "ASSISTANT", message: "Safe reply" }] });
  const result = await call(legacy.getHistory, customer);
  assert.equal(result.body.messages[1].messageIndex, 1);
});
test("unresolved escalation deduplication survives concurrent requests", async () => {
  const customer = await actor();
  const requests = Array.from({ length: 8 }, () => smart.escalate({ userId: customer._id, name: customer.fullName, message: "My data is pending" }));
  const tickets = await Promise.all(requests);
  assert.equal(new Set(tickets.map(t => t.id)).size, 1);
  assert.equal(await Case.countDocuments(), 1);
});
test("automatic escalation assigns only active authorized support and notifies the customer", async () => {
  const customer = await actor(), head = await actor("HEAD_OFFICE");
  const unauthorized = await actor("STAFF");
  const ticket = await smart.escalate({ userId: customer._id, name: customer.fullName, message: "My data failed" });
  assert.equal(ticket.assignedTo, String(head._id));
  assert.ok(await Notification.countDocuments({ userId: customer._id }));
  assert.equal(await Notification.countDocuments({ userId: unauthorized._id }), 0);
});
