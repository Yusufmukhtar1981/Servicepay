const mongoose = require("mongoose");
const AppSettings = require("../models/appSettings.model");
const Conversation = require("../models/aiSupportConversation.model");
const FintechCase = require("../models/fintechCase.model");
const AdminAuditLog = require("../models/adminAuditLog.model");
const smart = require("../services/smartSupport.service");
const { containsSensitiveCredential, SECURITY_WARNING } = require("../services/aiSupport.service");
const { getProviderConfig } = require("../services/aiProvider.service");

const id = req => req.user?._id || req.user?.id;
const response = (res, data) => res.json({ success: true, data });
const error = (res, code, message) => res.status(code).json({ success: false, message });
const safeHandler = handler => async (req, res) => {
  try {
    if (!id(req)) return error(res, 401, "Unauthorized.");
    return await handler(req, res);
  } catch (_) {
    // Never serialize request/provider/database error objects.
    console.error("Smart Support request failed.");
    return error(res, 503, "Support is temporarily unavailable. Please try again later.");
  }
};
const validMessage = body => typeof body?.message === "string" &&
  body.message.trim().length > 0 && body.message.length <= 2000 &&
  (!body.transactionLookupId || (typeof body.transactionLookupId === "string" && body.transactionLookupId.length <= 200)) &&
  (!body.language || ["auto", "en", "ha"].includes(body.language));
const audit = async (req, action, metadata, session) => AdminAuditLog.create([{
  actorId: id(req), actorRole: req.user.role, actorName: smart.clean(req.user.fullName, 200),
  action, reason: smart.clean(req.body?.reason || "Smart Support operation", 500),
  metadata, ipAddress: String(req.ip || "").slice(0, 100),
  requestMethod: req.method, requestPath: String(req.originalUrl || "").slice(0, 200),
}], session ? { session } : {});
const recentFilter = settings => ({ updatedAt: { $gte: new Date(Date.now() - settings.retentionDays * 86400000) } });
const messages = list => Array.from(list || []).map(m => ({ role: m.role, message: smart.clean(m.message, 4000), createdAt: m.createdAt }));
const publicSettings = s => ({
  enabled: s.enabled, retentionDays: s.retentionDays, dailyBudgetUsd: s.dailyBudgetUsd,
  approvedDailyBudgetUsd: s.approvedDailyBudgetUsd, englishVoiceEnabled: s.englishVoiceEnabled,
  englishVoiceVerified: process.env.AI_SUPPORT_ENGLISH_VOICE_VERIFIED === "true",
  hausaVoiceVerified: false,
  hausaVoiceEnabled: false, voiceMessage: s.voiceMessage,
});
const capabilities = s => ({
  smartSupportEnabled: s.enabled, languages: ["en", "ha"],
  englishVoiceEnabled: s.enabled && s.englishVoiceEnabled, hausaVoiceEnabled: false, voiceMessage: s.voiceMessage,
});

exports.capabilities = capabilities;
exports.smartChat = safeHandler(async (req, res) => {
  const settings = await smart.getSettings();
  if (!settings.enabled) return error(res, 503, "Smart Support is not yet activated.");
  if (!validMessage(req.body)) return error(res, 400, "Enter a message of 1–2000 characters and a supported language.");
  const language = smart.languageOf(req.body.message, req.body.language);
  const message = smart.clean(req.body.message);
  if (containsSensitiveCredential(req.body.message)) {
    return res.json({ success: true, reply: SECURITY_WARNING, language, source: "security", escalationRecommended: false });
  }
  const evidence = await smart.investigate({ userId: id(req), message, transactionLookupId: req.body.transactionLookupId });
  if (evidence?.notFound) return error(res, 404, "The selected record was not found in your account.");
  const previous = await Conversation.findOne({ userId: id(req), ...recentFilter(settings) }).lean();
  const deterministic = smart.evidenceReply(evidence, language);
  const started = Date.now();
  const needsRecord = !evidence &&
    /\b(?:my|mine|nawa|na|ban|bai|me yasa)\b/i.test(message) &&
    /\b(?:pending|failed|transaction|transfer|payment|wallet|balance|data|airtime|ciniki|kudi|kuɗi)\b/i.test(message) &&
    !/\b(?:history|tarihin)\b/i.test(message);
  const result = deterministic
    ? { reply: deterministic, source: "backend_record", escalationRecommended: evidence.uncertain || evidence.status === "FAILED" }
    : needsRecord
      ? { reply: language === "ha" ? "Don Allah ka zabi cinikin daga jerin bayananka domin mu duba matsayin da ServicePay ya adana. Ba za a sake saye, cire kudi ko mayar da su ta wannan tattaunawar ba." : "Please select the transaction from your records so I can check its stored ServicePay status. This chat cannot retry purchases, debit wallets or issue refunds.", source: "selection_required", escalationRecommended: false }
      : await smart.reply({ message, language, history: previous?.messages, settings });
  let ticket;
  if (result.escalationRecommended && settings.escalationEnabled) {
    ticket = await smart.escalate({ userId: id(req), name: req.user.fullName, message, evidence, transactionLookupId: req.body.transactionLookupId });
    if (ticket.created) await audit(req, "SMART_SUPPORT_ESCALATED", { ticketId: ticket.id, reference: ticket.caseReference, assignedTo: ticket.assignedTo });
  }
  const now = new Date();
  // Do not resurrect expired messages when an inactive customer returns.
  if (!previous) await Conversation.deleteOne({ userId: id(req), updatedAt: { $lt: new Date(Date.now() - settings.retentionDays * 86400000) } });
  const conversation = await Conversation.findOneAndUpdate({ userId: id(req) }, {
    $push: { messages: { $each: [
      { role: "USER", message, language, createdAt: now },
      { role: "ASSISTANT", message: smart.clean(result.reply, 4000), language, createdAt: new Date() },
    ], $slice: -100 } },
    $set: { expiresAt: new Date(Date.now() + settings.retentionDays * 86400000), lastResponseMs: Date.now() - started },
    $setOnInsert: { userId: id(req) },
    $inc: { responseCount: 1, responseTotalMs: Date.now() - started },
  }, { returnDocument: "after", upsert: true });
  return res.json({
    success: true, reply: result.reply, conversationId: String(conversation._id),
    assistantMessageIndex: conversation.messages.length - 1,
    escalationRecommended: result.escalationRecommended, language, source: result.source,
    ...(evidence ? { evidence } : {}), ...(ticket ? { ticket } : {}),
  });
});

exports.escalate = safeHandler(async (req, res) => {
  const settings = await smart.getSettings();
  if (!settings.enabled || !settings.escalationEnabled) return error(res, 503, "Escalation is temporarily unavailable. Please use your existing support tickets.");
  if (!validMessage(req.body)) return error(res, 400, "Enter a description of 1–2000 characters.");
  const message = containsSensitiveCredential(req.body.message) ? "Customer requested secure human support. Sensitive input was not retained." : smart.clean(req.body.message);
  const evidence = await smart.investigate({ userId: id(req), message, transactionLookupId: req.body.transactionLookupId });
  if (evidence?.notFound) return error(res, 404, "The selected record was not found in your account.");
  const ticket = await smart.escalate({ userId: id(req), name: req.user.fullName, message, evidence, transactionLookupId: req.body.transactionLookupId });
  if (ticket.created) await audit(req, "SMART_SUPPORT_ESCALATED", { ticketId: ticket.id, reference: ticket.caseReference, assignedTo: ticket.assignedTo });
  return response(res, ticket);
});
exports.getFeedback = safeHandler(async (req, res) => {
  const conversation = await Conversation.findOne({ userId: id(req) }).select("feedback").lean();
  return response(res, conversation?.feedback || { rating: null, comment: "" });
});
exports.feedback = safeHandler(async (req, res) => {
  if (!Number.isInteger(req.body?.rating) || req.body.rating < 1 || req.body.rating > 5 ||
      (req.body.comment !== undefined && (typeof req.body.comment !== "string" || req.body.comment.length > 500))) {
    return error(res, 400, "Choose a rating from 1 to 5 and an optional comment of at most 500 characters.");
  }
  const feedback = { rating: req.body.rating, comment: smart.clean(req.body.comment, 500), updatedAt: new Date() };
  const conversation = await Conversation.findOneAndUpdate({ userId: id(req) }, { $set: { feedback } }, { returnDocument: "after" });
  if (!conversation) return error(res, 404, "Start a support conversation before sending feedback.");
  return response(res, feedback);
});
exports.getSettings = safeHandler(async (req, res) => response(res, publicSettings(await smart.getSettings())));
exports.updateSettings = safeHandler(async (req, res) => {
  const body = req.body || {};
  const cap = smart.approvedBudget();
  if (typeof body.enabled !== "boolean" || !Number.isInteger(body.retentionDays) ||
      body.retentionDays < 1 || body.retentionDays > 90 ||
      typeof body.dailyBudgetUsd !== "number" || !Number.isFinite(body.dailyBudgetUsd) ||
      body.dailyBudgetUsd < 0 || body.dailyBudgetUsd > cap) {
    return error(res, 400, "Provide an enabled flag, retention of 1–90 days, and a daily budget within the approved limit.");
  }
  if ((body.englishVoiceEnabled === true && process.env.AI_SUPPORT_ENGLISH_VOICE_VERIFIED !== "true") || body.hausaVoiceEnabled === true) {
    return error(res, 409, smart.VOICE_MESSAGE);
  }
  const config = getProviderConfig();
  if (body.enabled && (!config.apiKey || body.dailyBudgetUsd < 0.1 ||
      config.provider !== "openai" || config.model !== "gpt-4o-mini" ||
      config.apiUrl !== "https://api.openai.com/v1/chat/completions")) {
    return error(res, 409, "Activation requires configured OpenAI credentials, an approved supported model and a funded daily cap.");
  }
  const settings = await smart.getSettings();
  await mongoose.connection.transaction(async session => {
    await AppSettings.updateOne({ _id: settings.document._id }, { $set: {
      "support.smartSupportEnabled": body.enabled,
      "support.smartSupportRetentionDays": body.retentionDays,
      "support.smartSupportDailyBudgetUsd": body.dailyBudgetUsd,
      "support.smartSupportEnglishVoiceEnabled": body.englishVoiceEnabled === true,
    } }, { session, runValidators: true });
    await audit(req, "SMART_SUPPORT_SETTINGS_UPDATED", { enabled: body.enabled, retentionDays: body.retentionDays, dailyBudgetUsd: body.dailyBudgetUsd }, session);
  });
  return response(res, publicSettings(await smart.getSettings()));
});
exports.getKnowledge = safeHandler(async (req, res) => {
  const settings = await smart.getSettings();
  return response(res, { revision: settings.revision, articles: settings.document.support.smartSupportKnowledge || [] });
});
exports.updateKnowledge = safeHandler(async (req, res) => {
  const { articles, revision, reason } = req.body || {};
  if (!Number.isInteger(revision) || revision < 0 || typeof reason !== "string" || reason.trim().length < 5 ||
      !Array.isArray(articles) || articles.length > 30 || articles.some(a =>
        typeof a.id !== "string" || !/^[a-z0-9_-]{1,80}$/i.test(a.id) ||
        typeof a.title !== "string" || !a.title.trim() || a.title.length > 160 ||
        typeof a.body !== "string" || !a.body.trim() || a.body.length > 2000 ||
        !["en", "ha"].includes(a.language) || typeof a.approved !== "boolean" ||
        containsSensitiveCredential(a.body) || containsSensitiveCredential(a.title)) ||
      new Set(articles.map(a => a.id)).size !== articles.length) {
    return error(res, 400, "Provide unique valid articles, the current revision, and a reason. Do not include secrets.");
  }
  const settings = await smart.getSettings();
  let updated;
  await mongoose.connection.transaction(async session => {
    updated = await AppSettings.findOneAndUpdate({
      _id: settings.document._id,
      ...(revision === 0 ? { $or: [{ "support.smartSupportKnowledgeRevision": 0 }, { "support.smartSupportKnowledgeRevision": { $exists: false } }] } : { "support.smartSupportKnowledgeRevision": revision }),
    }, {
      $set: { "support.smartSupportKnowledge": articles.map(a => ({ id: a.id, title: smart.clean(a.title, 160), body: smart.clean(a.body), language: a.language, approved: a.approved })) },
      $inc: { "support.smartSupportKnowledgeRevision": 1 },
    }, { returnDocument: "after", session, runValidators: true });
    if (updated) await audit(req, "SMART_SUPPORT_KNOWLEDGE_UPDATED", { previousRevision: revision, revision: revision + 1, articleCount: articles.length }, session);
  });
  if (!updated) return error(res, 409, "The knowledge base changed. Reload before saving.");
  return response(res, { revision: revision + 1, articles: updated.support.smartSupportKnowledge });
});
exports.metrics = safeHandler(async (req, res) => {
  const settings = await smart.getSettings();
  const [conversations, complaintRows, stats, budgetReservedUsd, resolutionStats] = await Promise.all([
    Conversation.countDocuments(recentFilter(settings)),
    FintechCase.aggregate([{ $match: { type: "COMPLAINT" } }, { $group: {
      _id: "$status", total: { $sum: 1 }, escalated: { $sum: { $cond: ["$aiEscalated", 1, 0] } },
    } }]),
    Conversation.aggregate([{ $match: recentFilter(settings) }, { $group: {
      _id: null, feedbackAverage: { $avg: "$feedback.rating" },
      feedbackCount: { $sum: { $cond: [{ $gte: ["$feedback.rating", 1] }, 1, 0] } },
      responseCount: { $sum: "$responseCount" }, responseMs: { $sum: "$responseTotalMs" },
    } }]),
    smart.budgetReservedUsd(),
    FintechCase.aggregate([
      { $match: { type: "COMPLAINT", status: { $in: ["RESOLVED", "CLOSED"] } } },
      { $project: {
        createdAt: 1,
        resolvedAt: { $min: { $map: {
          input: { $filter: { input: { $ifNull: ["$statusEvents", []] }, as: "event", cond: { $in: ["$$event.status", ["RESOLVED", "CLOSED"]] } } },
          as: "event", in: "$$event.createdAt",
        } } },
      } },
      { $match: { resolvedAt: { $ne: null }, $expr: { $gte: ["$resolvedAt", "$createdAt"] } } },
      { $group: { _id: null, averageMs: { $avg: { $subtract: ["$resolvedAt", "$createdAt"] } }, count: { $sum: 1 } } },
    ]),
  ]);
  const counts = Object.fromEntries(complaintRows.map(r => [r._id, r.total]));
  const resolved = (counts.RESOLVED || 0) + (counts.CLOSED || 0);
  return response(res, {
    conversations, complaints: complaintRows.reduce((n, r) => n + r.total, 0),
    open: counts.OPEN || 0, pending: (counts.IN_PROGRESS || 0) + (counts.IN_REVIEW || 0) + (counts.WAITING_ON_CUSTOMER || 0),
    resolved, escalated: complaintRows.reduce((n, r) => n + r.escalated, 0),
    averageResponseSeconds: stats[0]?.responseCount ? stats[0].responseMs / stats[0].responseCount / 1000 : null,
    // Only use a recorded terminal status event, never mutable updatedAt.
    averageResolutionSeconds: resolutionStats[0]?.count ? resolutionStats[0].averageMs / 1000 : null,
    resolutionTimingAvailable: !!resolutionStats[0]?.count,
    satisfactionAverage: stats[0]?.feedbackAverage ?? null, satisfactionCount: stats[0]?.feedbackCount || 0,
    budgetReservedUsd, dailyBudgetUsd: settings.dailyBudgetUsd,
  });
});
exports.conversations = safeHandler(async (req, res) => {
  const page = Math.max(1, Math.min(10000, Math.floor(Number(req.query.page) || 1)));
  const limit = Math.max(1, Math.min(50, Math.floor(Number(req.query.limit) || 20)));
  const filter = recentFilter(await smart.getSettings());
  const [items, total] = await Promise.all([
    Conversation.find(filter).select("userId updatedAt messages").populate("userId", "fullName").sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Conversation.countDocuments(filter),
  ]);
  return response(res, { page, pages: Math.ceil(total / limit), total, items: items.map(c => ({
    id: String(c._id), customer: c.userId ? { id: String(c.userId._id), fullName: smart.clean(c.userId.fullName, 200) } : null,
    updatedAt: c.updatedAt, messageCount: c.messages?.length || 0,
  })) });
});
exports.conversation = safeHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return error(res, 404, "Conversation not found.");
  const conversation = await Conversation.findOne({ _id: req.params.id, ...recentFilter(await smart.getSettings()) }).populate("userId", "fullName").lean();
  if (!conversation) return error(res, 404, "Conversation not found.");
  await audit(req, "SMART_SUPPORT_CONVERSATION_VIEWED", { conversationId: String(conversation._id) });
  return response(res, {
    id: String(conversation._id), customer: conversation.userId ? { id: String(conversation.userId._id), fullName: smart.clean(conversation.userId.fullName, 200) } : null,
    messages: messages(conversation.messages), updatedAt: conversation.updatedAt,
  });
});
exports.voiceUnavailable = safeHandler(async (req, res) => error(res, 409, smart.VOICE_MESSAGE));

exports.records = safeHandler(async (req, res) => {
  const settings = await smart.getSettings();
  if (!settings.enabled) return error(res, 503, "Smart Support is not yet activated.");
  const limit = Math.min(30, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
  const cursor = String(req.query.cursor || "").slice(0, 2000);
  const deliveriesOnly = cursor.startsWith("deliveries:");
  const Delivery = require("../models/delivery.model");
  if (deliveriesOnly) {
    const last = cursor.slice(11);
    if (last && !mongoose.isValidObjectId(last)) return error(res, 400, "Invalid record cursor.");
    const rows = await Delivery.find({ customerId: id(req), ...(last ? { _id: { $lt: last } } : {}) })
      .select("trackingNumber status createdAt").sort({ _id: -1 }).limit(limit + 1).lean();
    return response(res, {
      items: rows.slice(0, limit).map(row => ({ id: `delivery:${row._id}`, type: "DELIVERY", status: row.status, reference: smart.clean(row.trackingNumber, 200), createdAt: row.createdAt })),
      nextCursor: rows.length > limit ? `deliveries:${rows[limit - 1]._id}` : null,
    });
  }
  const { getCustomerHistory } = require("../services/customerHistory.service");
  const history = await getCustomerHistory({ userId: id(req), limit, before: cursor || null });
  return response(res, {
    items: history.transactions.map(row => ({ id: row.id, type: row.type, status: row.status, reference: smart.clean(row.reference, 200), createdAt: row.createdAt })),
    nextCursor: history.pagination.nextCursor || "deliveries:",
  });
});
const voiceReady = async (req, res) => {
  const settings = await smart.getSettings();
  if (!settings.enabled || !settings.englishVoiceEnabled || req.body?.language !== "en") {
    error(res, 409, settings.voiceMessage); return null;
  }
  if (req.body?.consent !== true) { error(res, 400, "Explicit consent is required for voice processing."); return null; }
  return settings;
};
exports.transcribe = safeHandler(async (req, res) => {
  const settings = await voiceReady(req, res);
  if (!settings) return;
  const voice = require("../services/smartSupportVoice.service");
  let recording;
  try { recording = voice.decodeRecording(req.body.audioBase64); }
  catch (_) { return error(res, 400, "Use a valid mono PCM16 WAV recording of 0.15–30 seconds."); }
  if (!await smart.reserveTextBudget(settings)) return error(res, 429, "The daily AI limit has been reached. Text tickets remain available.");
  const text = await voice.transcribe(recording.data, "en");
  return response(res, { text, language: "en" });
});
exports.speech = safeHandler(async (req, res) => {
  const settings = await voiceReady(req, res);
  if (!settings) return;
  const index = req.body.messageIndex;
  if (!Number.isInteger(index) || index < 0 || index > 99) return error(res, 400, "Select a saved assistant reply.");
  const conversation = await Conversation.findOne({ userId: id(req), ...recentFilter(settings) }).lean();
  const message = conversation?.messages?.[index];
  if (!message || message.role !== "ASSISTANT") return error(res, 404, "Saved assistant reply not found.");
  if (message.language === "ha" || smart.languageOf(message.message) === "ha") return error(res, 409, "Hausa voice is awaiting quality verification. Please read the Hausa text.");
  if (req.body.messageText !== message.message) return error(res, 409, "The conversation changed. Reload before playing this reply.");
  if (message.message.length > 600) return error(res, 400, "This reply is too long for voice. Please read the text.");
  if (!await smart.reserveTextBudget(settings)) return error(res, 429, "The daily AI limit has been reached. Text tickets remain available.");
  return response(res, await require("../services/smartSupportVoice.service").speak(message.message));
});
