const User = require("../models/user.model");
const Notification = require("../models/notification.model");
const Campaign = require("../models/communicationCampaign.model");
const Recipient = require("../models/communicationRecipient.model");
const AdminAuditLog = require("../models/adminAuditLog.model");
const emailService = require("../services/email.service");
const { baseTemplate } = require("../templates/emailTemplates");
const { resolveAudience } = require("../services/communicationAudience.service");
const { scheduleCampaign } = require("../services/communicationCampaign.service");

const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
const bounded = (value, max) => typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;
const pageOptions = (query) => {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 25));
  return { page, limit, skip: (page - 1) * limit };
};
const campaignView = (campaign) => ({
  id: campaign._id,
  channel: campaign.channel,
  kind: campaign.kind,
  subject: campaign.subject,
  title: campaign.title,
  message: campaign.message,
  audience: campaign.audience,
  status: campaign.status,
  recipientCount: campaign.recipientCount,
  sentCount: campaign.sentCount,
  deliveredCount: campaign.deliveredCount,
  failedCount: campaign.failedCount,
  skippedCount: campaign.skippedCount,
  createdAt: campaign.createdAt,
  completedAt: campaign.completedAt,
  sender: campaign.createdBy && {
    id: campaign.createdBy._id,
    fullName: campaign.createdBy.fullName,
    email: campaign.createdBy.email,
  },
});
const completeCampaign = async (campaign, counts) => Campaign.findByIdAndUpdate(
  campaign._id,
  {
    $set: {
      ...counts,
      status: counts.failedCount ? "COMPLETED_WITH_ERRORS" : "COMPLETED",
      completedAt: new Date(),
    },
  },
  { returnDocument: "after" }
);
const createBroadcastWithRecipients = async ({ campaignData, users }) => {
  const session = await Campaign.db.startSession();
  let campaign;
  try {
    await session.withTransaction(async () => {
      [campaign] = await Campaign.create([campaignData], { session });
      await Recipient.insertMany(users.map((user) => ({
        campaignId: campaign._id,
        userId: user._id,
        recipientKey: String(user._id),
        email: String(user.email || "").trim().toLowerCase() || null,
        outcome: "PENDING",
      })), { session });
    });
    return campaign;
  } finally {
    await session.endSession();
  }
};

exports.capabilities = (req, res) => res.json({
  success: true,
  capabilities: {
    email: { provider: "RESEND", configured: emailService.emailEnabled() },
    inAppNotification: { configured: true },
    devicePush: { configured: false },
  },
});

exports.customers = async (req, res, next) => {
  try {
    const { page, limit, skip } = pageOptions(req.query);
    const filter = {};
    if (req.query.role) filter.role = String(req.query.role).trim().toUpperCase();
    if (req.query.status) filter.status = String(req.query.status).trim().toUpperCase();
    if (req.query.search && String(req.query.search).trim()) {
      const expression = new RegExp(String(req.query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ fullName: expression }, { email: expression }, { phone: expression }];
    }
    const [users, total, roles] = await Promise.all([
      User.find(filter).select("_id fullName email phone role status").sort({ fullName: 1 }).skip(skip).limit(limit).lean(),
      User.countDocuments(filter),
      User.distinct("role"),
    ]);
    return res.json({ success: true, page, limit, total, roles: roles.sort(), customers: users.map((user) => ({ id: user._id, fullName: user.fullName, email: user.email, phone: user.phone, role: user.role, status: user.status })) });
  } catch (error) { return next(error); }
};

exports.previewAudience = async (req, res) => {
  try {
    if (!["EMAIL", "IN_APP"].includes(String(req.body.channel || "").toUpperCase())) throw new Error("Invalid channel.");
    const resolved = await resolveAudience(req.body.audience);
    return res.json({ success: true, audience: resolved.audience, count: resolved.users.length });
  } catch (error) { return res.status(400).json({ success: false, message: error.message }); }
};

exports.testEmail = async (req, res) => {
  try {
    const { subject, message } = req.body;
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!bounded(subject, 160) || !bounded(message, 10000) || !validEmail(email)) {
      return res.status(400).json({ success: false, message: "A valid test recipient email, subject, and message are required." });
    }
    const campaign = await Campaign.create({ channel: "EMAIL", kind: "TEST", subject: subject.trim(), message: message.trim(), audience: { kind: "TEST" }, createdBy: req.user._id, recipientCount: 1 });
    const result = await emailService.sendEmail({ to: email, subject: subject.trim(), text: message.trim(), html: baseTemplate({ title: subject.trim(), greeting: `Hello ${req.user.fullName || "Administrator"}`, message: message.trim() }), idempotencyKey: `communications-test-${campaign._id}` });
    const outcome = result.success ? "SENT" : result.skipped ? "SKIPPED" : "FAILED";
    await Recipient.create({ campaignId: campaign._id, userId: email === req.user.email ? req.user._id : null, recipientKey: email, email, outcome, providerMessageId: result.messageId || null, error: result.error || result.reason || null });
    const completed = await completeCampaign(campaign, { sentCount: outcome === "SENT" ? 1 : 0, failedCount: outcome === "FAILED" ? 1 : 0, skippedCount: outcome === "SKIPPED" ? 1 : 0 });
    const reference = String(campaign._id);
    await AdminAuditLog.create({
      actorId: req.user._id,
      actorRole: String(req.user.role || "HEAD_OFFICE").toUpperCase(),
      actorName: req.user.fullName || req.user.name || "",
      targetUserName: `TEST EMAIL ${reference}`,
      action: "EMAIL_CAMPAIGN_TESTED",
      reason: result.success ? "Test email accepted by provider" : "Test email rejected by provider",
      metadata: {
        channel: "EMAIL",
        testRecipient: email,
        outcome,
        provider: "RESEND",
        providerMessageId: result.messageId || null,
        testedAt: new Date().toISOString(),
      },
      ipAddress: String(req.ip || ""),
      userAgent: String(req.headers?.["user-agent"] || ""),
      requestMethod: req.method || "",
      requestPath: req.originalUrl || "",
      status: "SUCCESSFUL",
    });
    if (!result.success) {
      return res.status(result.skipped ? 503 : 502).json({
        success: false,
        message: "Unable to send test email. Please try again.",
        reference,
        provider: {
          name: "RESEND",
          status: result.skipped ? "UNAVAILABLE" : "REJECTED",
        },
      });
    }
    return res.status(201).json({
      success: true,
      message: "Test email sent successfully",
      reference,
      provider: {
        name: "RESEND",
        status: "ACCEPTED",
        messageId: result.messageId || null,
      },
      campaign: campaignView(completed),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Unable to send test email. Please try again.",
    });
  }
};

exports.broadcastEmail = async (req, res) => {
  try {
    const { subject, message, audience, confirmation, idempotencyKey } = req.body;
    if (confirmation !== true || !bounded(subject, 160) || !bounded(message, 10000) || !bounded(idempotencyKey, 200)) return res.status(400).json({ success: false, message: "Confirmation, bounded content, and idempotencyKey are required." });
    let campaign = await Campaign.findOne({ channel: "EMAIL", idempotencyKey: idempotencyKey.trim() }).populate("createdBy", "fullName email");
    if (campaign) {
      if (campaign.status === "PROCESSING") scheduleCampaign(campaign._id);
      return res.status(202).json({ success: true, duplicate: true, campaign: campaignView(campaign) });
    }
    const resolved = await resolveAudience(audience);
    try {
      campaign = await createBroadcastWithRecipients({
        campaignData: { channel: "EMAIL", kind: "BROADCAST", subject: subject.trim(), message: message.trim(), audience: { kind: resolved.audience.kind, role: resolved.audience.role || null }, createdBy: req.user._id, idempotencyKey: idempotencyKey.trim(), recipientCount: resolved.users.length },
        users: resolved.users,
      });
    } catch (error) {
      if (error.code === 11000) {
        campaign = await Campaign.findOne({ channel: "EMAIL", idempotencyKey: idempotencyKey.trim() }).populate("createdBy", "fullName email");
        if (campaign) {
          if (campaign.status === "PROCESSING") scheduleCampaign(campaign._id);
          return res.status(202).json({ success: true, duplicate: true, campaign: campaignView(campaign) });
        }
      }
      throw error;
    }
    scheduleCampaign(campaign._id);
    return res.status(202).json({ success: true, campaign: campaignView(campaign) });
  } catch (error) { return res.status(400).json({ success: false, message: error.message || "Unable to send email broadcast." }); }
};

exports.broadcastNotifications = async (req, res) => {
  try {
    const { title, message, audience, idempotencyKey } = req.body;
    if (!bounded(title, 160) || !bounded(message, 10000) || !bounded(idempotencyKey, 200)) return res.status(400).json({ success: false, message: "Bounded title, message, and idempotencyKey are required." });
    let campaign = await Campaign.findOne({ channel: "IN_APP", idempotencyKey: idempotencyKey.trim() }).populate("createdBy", "fullName email");
    if (campaign) {
      if (campaign.status === "PROCESSING") scheduleCampaign(campaign._id);
      return res.status(202).json({ success: true, duplicate: true, campaign: campaignView(campaign) });
    }
    const resolved = await resolveAudience(audience);
    try {
      campaign = await createBroadcastWithRecipients({
        campaignData: { channel: "IN_APP", kind: "BROADCAST", title: title.trim(), message: message.trim(), audience: { kind: resolved.audience.kind, role: resolved.audience.role || null }, createdBy: req.user._id, idempotencyKey: idempotencyKey.trim(), recipientCount: resolved.users.length },
        users: resolved.users,
      });
    } catch (error) {
      if (error.code === 11000) {
        campaign = await Campaign.findOne({ channel: "IN_APP", idempotencyKey: idempotencyKey.trim() }).populate("createdBy", "fullName email");
        if (campaign) {
          if (campaign.status === "PROCESSING") scheduleCampaign(campaign._id);
          return res.status(202).json({ success: true, duplicate: true, campaign: campaignView(campaign) });
        }
      }
      throw error;
    }
    scheduleCampaign(campaign._id);
    return res.status(202).json({ success: true, campaign: campaignView(campaign) });
  } catch (error) { return res.status(400).json({ success: false, message: error.message || "Unable to send notification broadcast." }); }
};

exports.history = async (req, res) => {
  try {
    const { page, limit, skip } = pageOptions(req.query);
    const filter = { channel: req.params.channel };
    const [campaigns, total] = await Promise.all([Campaign.find(filter).populate("createdBy", "fullName email").sort({ createdAt: -1 }).skip(skip).limit(limit), Campaign.countDocuments(filter)]);
    return res.json({ success: true, page, limit, total, campaigns: campaigns.map(campaignView) });
  } catch (error) { return res.status(500).json({ success: false, message: "Unable to load history." }); }
};

exports.historyDetail = async (req, res) => {
  try {
    const { page, limit, skip } = pageOptions(req.query);
    const campaign = await Campaign.findOne({ _id: req.params.id, channel: req.params.channel }).populate("createdBy", "fullName email");
    if (!campaign) return res.status(404).json({ success: false, message: "Campaign not found." });
    const [recipients, total] = await Promise.all([Recipient.find({ campaignId: campaign._id }).populate("userId", "fullName email role").sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), Recipient.countDocuments({ campaignId: campaign._id })]);
    return res.json({ success: true, campaign: campaignView(campaign), page, limit, total, recipients: recipients.map((item) => ({ user: item.userId && { id: item.userId._id, fullName: item.userId.fullName, email: item.userId.email, role: item.userId.role }, email: item.email, outcome: item.outcome, error: item.error, createdAt: item.createdAt })) });
  } catch (error) { return res.status(400).json({ success: false, message: "Unable to load campaign." }); }
};