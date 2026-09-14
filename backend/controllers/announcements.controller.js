const mongoose = require("mongoose");
const Announcement = require("../models/announcement.model");
const AnnouncementInteraction = require("../models/announcementInteraction.model");
const User = require("../models/user.model");
const KycProfile = require("../models/kycProfile.model");

const ENUMS = {
  type: ["INFO", "SUCCESS", "WARNING", "CRITICAL", "PROMOTION", "MAINTENANCE", "SECURITY"],
  style: ["POPUP", "BANNER", "BOTH"],
  audience: ["ALL", "ACTIVE", "KYC_PENDING", "KYC_VERIFIED", "SELECTED_CUSTOMERS", "SELECTED_ROLE"],
  visibility: ["ONCE", "EVERY_LOGIN", "UNTIL_DISMISSED", "MANDATORY"],
};
// Customer delivery currently evaluates customer accounts only. Staff,
// rider, partner, and other internal roles are never valid customer targets.
const CUSTOMER_DELIVERY_ROLES = new Set(["CUSTOMER"]);
const KYC_PENDING_STATES = new Set(["PENDING", "UNDER_REVIEW", "NEEDS_MORE_INFORMATION"]);

const asUpper = (value) => String(value || "").trim().toUpperCase();
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const validId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

const safeUrl = (value, { required = false } = {}) => {
  if (value === null || value === undefined || String(value).trim() === "") {
    if (required) throw new Error("CTA URL is required.");
    return null;
  }
  const raw = String(value).trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (error) {
    throw new Error("CTA URL must be a valid URL.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("CTA URL must use http or https.");
  }
  return raw;
};

const parseDate = (value, name) => {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${name} must be a valid date.`);
  return parsed;
};

const readPayload = (body = {}, existing = {}) => {
  const source = { ...existing, ...body };
  const type = asUpper(source.type || "INFO");
  const style = asUpper(source.style || "BANNER");
  const audience = asUpper(source.audience || "ALL");
  const visibility = asUpper(source.visibility || "ONCE");
  if (!ENUMS.type.includes(type)) throw new Error("Invalid announcement type.");
  if (!ENUMS.style.includes(style)) throw new Error("Invalid announcement style.");
  if (!ENUMS.audience.includes(audience)) throw new Error("Invalid announcement audience.");
  if (!ENUMS.visibility.includes(visibility)) throw new Error("Invalid announcement visibility.");

  const title = String(source.title || "").trim();
  const message = String(source.message || "").trim();
  if (!title) throw new Error("Announcement title is required.");
  if (!message) throw new Error("Announcement message is required.");
  if (title.length > 100) throw new Error("Announcement title is too long.");
  if (message.length > 500) throw new Error("Announcement message is too long.");

  const startAt = parseDate(source.startAt ?? source.start, "Start date");
  const endAt = parseDate(source.endAt ?? source.end, "End date");
  if (startAt && endAt && endAt <= startAt) throw new Error("End date must be after start date.");

  const priority = Number(source.priority ?? 0);
  if (!Number.isInteger(priority)) throw new Error("Priority must be an integer.");

  const rawCta = source.cta && typeof source.cta === "object"
    ? source.cta
    : source.cta !== null && source.cta !== undefined ? { url: source.cta } : {};
  const ctaUrl = safeUrl(rawCta.url ?? rawCta.link ?? source.ctaUrl);
  const ctaLabel = String(rawCta.label ?? rawCta.text ?? source.ctaLabel ?? source.ctaText ?? "").trim() || null;
  if (ctaLabel && !ctaUrl) throw new Error("CTA URL is required when a CTA label is provided.");
  if (ctaUrl && !ctaLabel) throw new Error("CTA label is required when a CTA URL is provided.");

  const rawImageUrl = source.imageUrl === null || source.imageUrl === undefined
    ? null
    : String(source.imageUrl).trim() || null;
  if (rawImageUrl) safeUrl(rawImageUrl);

  let selectedCustomerIds = Array.isArray(source.selectedCustomerIds)
    ? source.selectedCustomerIds
    : Array.isArray(source.customerIds) ? source.customerIds : [];
  selectedCustomerIds = [...new Set(selectedCustomerIds.map(String))];
  if (selectedCustomerIds.some((id) => !validId(id))) {
    throw new Error("Selected customer IDs must be valid.");
  }
  if (audience === "SELECTED_CUSTOMERS" && selectedCustomerIds.length === 0) {
    throw new Error("At least one selected customer is required.");
  }
  if (audience !== "SELECTED_CUSTOMERS") selectedCustomerIds = [];

  const selectedRole = audience === "SELECTED_ROLE"
    ? asUpper(source.selectedRole ?? source.role)
    : null;
  if (audience === "SELECTED_ROLE" && !selectedRole) {
    throw new Error("A selected role is required.");
  }
  if (audience === "SELECTED_ROLE" && !CUSTOMER_DELIVERY_ROLES.has(selectedRole)) {
    throw new Error("Selected role is not supported for customer delivery.");
  }

  return {
    title,
    message,
    type,
    style,
    audience,
    selectedCustomerIds,
    selectedRole,
    visibility,
    imageUrl: rawImageUrl,
    cta: { label: ctaLabel, url: ctaUrl },
    startAt,
    endAt,
    priority,
    isActive: hasOwn(body, "isActive") || hasOwn(body, "active")
      ? ((body.isActive ?? body.active) === true || String(body.isActive ?? body.active).toLowerCase() === "true")
      : (existing.isActive ?? false),
  };
};

const scheduledFilter = (now = new Date()) => ({
  isActive: true,
  $and: [
    { $or: [{ startAt: null }, { startAt: { $lte: now } }, { startAt: { $exists: false } }] },
    { $or: [{ endAt: null }, { endAt: { $gt: now } }, { endAt: { $exists: false } }] },
  ],
});

const kycIsVerified = async (userId, user) => {
  if (user?.kycVerified === true) return true;
  const profile = await KycProfile.findOne({ user: userId }).select("status").lean();
  return profile?.status === "VERIFIED";
};

const kycIsPending = async (userId) => {
  const profile = await KycProfile.findOne({ user: userId }).select("status").lean();
  return Boolean(profile && KYC_PENDING_STATES.has(asUpper(profile.status)));
};

const matchesAudience = async (announcement, user) => {
  if (!user || asUpper(user.role) !== "CUSTOMER" || asUpper(user.status) !== "ACTIVE") return false;
  switch (announcement.audience || "ALL") {
    case "ALL":
    case "ACTIVE":
      return true;
    case "SELECTED_CUSTOMERS":
      return (announcement.selectedCustomerIds || []).some((id) => String(id) === String(user._id));
    case "SELECTED_ROLE":
      return asUpper(user.role) === asUpper(announcement.selectedRole);
    case "KYC_VERIFIED":
      return kycIsVerified(user._id, user);
    case "KYC_PENDING":
      return kycIsPending(user._id);
    default:
      return false;
  }
};

const interactionFor = async (announcementId, customerId) =>
  AnnouncementInteraction.findOne({ announcementId, customerId }).lean();

const visibleForCustomer = async (announcement, user, interaction, loginKey) => {
  if (!await matchesAudience(announcement, user)) return false;
  const visibility = announcement.visibility || "ONCE";
  if (visibility === "MANDATORY") return !interaction?.acknowledgedAt;
  if (visibility === "ONCE") {
    return !interaction?.viewedAt && !interaction?.dismissedAt && !interaction?.acknowledgedAt;
  }
  if (visibility === "UNTIL_DISMISSED") return !interaction?.dismissedAt;
  if (visibility === "EVERY_LOGIN") {
    return !loginKey || interaction?.lastLoginKey !== loginKey;
  }
  return false;
};

const markPresentedForLogin = async (announcementId, customerId, loginKey) => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const session = await Announcement.db.startSession();
    try {
      await session.withTransaction(async () => {
        const current = await Announcement.findOne({
          _id: announcementId,
          ...scheduledFilter(),
        }).session(session).lean();
        if (!current) return;
        const existing = await AnnouncementInteraction.findOne({
          announcementId,
          customerId,
        }).session(session).lean();
        if (existing) {
          await AnnouncementInteraction.updateOne(
            { announcementId, customerId },
            { $set: { lastLoginKey: String(loginKey) } },
            { session },
          );
        } else {
          await AnnouncementInteraction.create([{
            announcementId,
            customerId,
            lastLoginKey: String(loginKey),
          }], { session });
        }
      });
      return;
    } catch (error) {
      const retryable = error?.code === 11000 ||
        error?.errorLabels?.includes("TransientTransactionError") ||
        error?.errorLabels?.includes("UnknownTransactionCommitResult") ||
        error?.codeName === "WriteConflict";
      if (!retryable || attempt === 7) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
    } finally {
      await session.endSession();
    }
  }
};

const publicView = (announcement) => ({
  id: announcement._id,
  title: announcement.title,
  message: announcement.message,
  type: announcement.type || "INFO",
  style: announcement.style || "BANNER",
  visibility: announcement.visibility || "ONCE",
  imageUrl: announcement.imageUrl || null,
  cta: announcement.cta?.url ? { label: announcement.cta.label, url: announcement.cta.url } : null,
  startAt: announcement.startAt || null,
  endAt: announcement.endAt || null,
  priority: Number(announcement.priority || 0),
  createdAt: announcement.createdAt || null,
});

const adminView = (announcement) => ({
  ...publicView(announcement),
  isActive: Boolean(announcement.isActive),
  active: Boolean(announcement.isActive),
  audience: announcement.audience || "ALL",
  selectedCustomerIds: (announcement.selectedCustomerIds || []).map(String),
  selectedRole: announcement.selectedRole || null,
  metrics: {
    views: Number(announcement.metrics?.views || 0),
    acknowledgements: Number(announcement.metrics?.acknowledgements || 0),
    dismissals: Number(announcement.metrics?.dismissals || 0),
    clicks: Number(announcement.metrics?.clicks || 0),
  },
  updatedBy: announcement.updatedBy || null,
  updatedAt: announcement.updatedAt,
});

const validateCustomerTargets = async (payload) => {
  if (payload.audience !== "SELECTED_CUSTOMERS") return;
  const expected = payload.selectedCustomerIds.length;
  const count = await User.countDocuments({
    _id: { $in: payload.selectedCustomerIds },
    role: "CUSTOMER",
  });
  if (count !== expected) {
    throw new Error("Selected customer IDs must belong to customer accounts.");
  }
};

exports.getActive = async (req, res) => {
  try {
    const now = new Date();
    const announcements = await Announcement.find(scheduledFilter(now))
      .sort({ priority: -1, createdAt: -1 })
      .lean();
    const ids = announcements.map((announcement) => announcement._id);
    const interactions = await AnnouncementInteraction.find({
      announcementId: { $in: ids },
      customerId: req.user._id,
    }).lean();
    const byId = new Map(interactions.map((item) => [String(item.announcementId), item]));
    const loginKey = req.authTokenIssuedAt || null;
    const active = [];
    for (const announcement of announcements) {
      if (await visibleForCustomer(announcement, req.user, byId.get(String(announcement._id)), loginKey)) {
        active.push(publicView(announcement));
        if (announcement.visibility === "EVERY_LOGIN" && loginKey) {
          // Presentation is tracked separately from view metrics so repeated
          // dashboard polling during one login does not re-show the notice.
          await markPresentedForLogin(announcement._id, req.user._id, loginKey);
        }
      }
    }
    return res.json({ success: true, data: { announcements: active } });
  } catch (error) {
    console.error("Get active announcements error:", error);
    return res.status(500).json({ success: false, message: "Failed to load announcements." });
  }
};

const record = async (announcement, req, field) => {
  const metric = {
    viewedAt: "views",
    acknowledgedAt: "acknowledgements",
    dismissedAt: "dismissals",
    clickedAt: "clicks",
  }[field];
  let lastError;

  // The interaction marker and its aggregate counter must commit together.
  // Retrying the whole transaction is safe because the action predicate
  // remains null until one winner records it.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const session = await Announcement.db.startSession();
    try {
      let recorded = false;
      await session.withTransaction(async () => {
        const current = await Announcement.findOne({
          _id: announcement._id,
          ...scheduledFilter(),
        }).session(session).lean();
        if (!current || !await matchesAudience(current, req.user)) {
          const gone = new Error("Announcement is no longer available.");
          gone.code = "ANNOUNCEMENT_GONE";
          throw gone;
        }
        if (field === "dismissedAt" && current.visibility === "MANDATORY") {
          const mandatory = new Error("Mandatory announcements cannot be dismissed.");
          mandatory.code = "MANDATORY_ANNOUNCEMENT";
          throw mandatory;
        }

        const existing = await AnnouncementInteraction.findOne({
          announcementId: current._id,
          customerId: req.user._id,
        }).session(session).lean();
        if (existing && existing[field]) {
          recorded = false;
        } else if (existing) {
          const result = await AnnouncementInteraction.updateOne(
            {
              announcementId: current._id,
              customerId: req.user._id,
              [field]: null,
            },
            {
              $set: {
                [field]: new Date(),
                ...(req.authTokenIssuedAt ? { lastLoginKey: String(req.authTokenIssuedAt) } : {}),
              },
            },
            { session },
          );
          recorded = Number(result.modifiedCount || 0) > 0;
        } else {
          await AnnouncementInteraction.create([{
            announcementId: current._id,
            customerId: req.user._id,
            [field]: new Date(),
            ...(req.authTokenIssuedAt ? { lastLoginKey: String(req.authTokenIssuedAt) } : {}),
          }], { session });
          recorded = true;
        }
        if (recorded) {
          await Announcement.updateOne(
            { _id: current._id },
            { $inc: { [`metrics.${metric}`]: 1 } },
            { session },
          );
        }
      });
      return recorded;
    } catch (error) {
      lastError = error;
      const retryable = error?.code === 11000 ||
        error?.errorLabels?.includes("TransientTransactionError") ||
        error?.errorLabels?.includes("UnknownTransactionCommitResult") ||
        error?.codeName === "WriteConflict";
      if (!retryable || attempt === 7) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
    } finally {
      await session.endSession();
    }
  }
  throw lastError;
};

const interaction = (field) => async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.status(404).json({ success: false, message: "Announcement not found." });
    const announcement = await Announcement.findOne({ _id: req.params.id, ...scheduledFilter() }).lean();
    if (!announcement || !await matchesAudience(announcement, req.user)) {
      return res.status(404).json({ success: false, message: "Announcement not found." });
    }
    if (field === "dismissedAt" && announcement.visibility === "MANDATORY") {
      return res.status(409).json({ success: false, code: "MANDATORY_ANNOUNCEMENT", message: "Mandatory announcements cannot be dismissed." });
    }
    const recorded = await record(announcement, req, field);
    return res.json({ success: true, data: { recorded, announcement: publicView(announcement) } });
  } catch (error) {
    if (error?.code === "ANNOUNCEMENT_GONE") {
      return res.status(404).json({ success: false, message: "Announcement not found." });
    }
    if (error?.code === "MANDATORY_ANNOUNCEMENT") {
      return res.status(409).json({ success: false, code: "MANDATORY_ANNOUNCEMENT", message: "Mandatory announcements cannot be dismissed." });
    }
    console.error("Announcement interaction error:", error);
    return res.status(500).json({ success: false, message: "Failed to record announcement interaction." });
  }
};

exports.view = interaction("viewedAt");
exports.acknowledge = interaction("acknowledgedAt");
exports.dismiss = interaction("dismissedAt");
exports.click = interaction("clickedAt");

exports.listAdmin = async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
    const filter = {};
    if (hasOwn(req.query, "isActive")) filter.isActive = req.query.isActive === "true";
    if (req.query.audience) filter.audience = asUpper(req.query.audience);
    const [items, total] = await Promise.all([
      Announcement.find(filter).sort({ priority: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Announcement.countDocuments(filter),
    ]);
    return res.json({ success: true, data: { announcements: items.map(adminView), page, limit, total } });
  } catch (error) {
    console.error("List announcements error:", error);
    return res.status(500).json({ success: false, message: "Failed to list announcements." });
  }
};

exports.getAdmin = async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ success: false, message: "Announcement not found." });
  const announcement = await Announcement.findById(req.params.id).lean();
  if (!announcement) return res.status(404).json({ success: false, message: "Announcement not found." });
  return res.json({ success: true, data: { announcement: adminView(announcement) } });
};

exports.create = async (req, res) => {
  try {
    const payload = readPayload(req.body);
    payload.legacyEligible = false;
    await validateCustomerTargets(payload);
    payload.updatedBy = req.user._id;
    const announcement = await Announcement.create(payload);
    return res.status(201).json({ success: true, data: { announcement: adminView(announcement.toObject()) } });
  } catch (error) {
    if (error.message?.startsWith("Invalid") || /required|too long|valid|Priority|after|CTA|Selected customer|supported/i.test(error.message || "")) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error("Create announcement error:", error);
    return res.status(500).json({ success: false, message: "Failed to create announcement." });
  }
};

exports.update = async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.status(404).json({ success: false, message: "Announcement not found." });
    const current = await Announcement.findById(req.params.id);
    if (!current) return res.status(404).json({ success: false, message: "Announcement not found." });
    const payload = readPayload(req.body, current.toObject());
    payload.legacyEligible = false;
    await validateCustomerTargets(payload);
    Object.assign(current, payload, { updatedBy: req.user._id });
    await current.save();
    return res.json({ success: true, data: { announcement: adminView(current.toObject()) } });
  } catch (error) {
    if (/Invalid|required|too long|valid|Priority|after|CTA|Selected customer|supported/i.test(error.message || "")) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error("Update announcement error:", error);
    return res.status(500).json({ success: false, message: "Failed to update announcement." });
  }
};

exports.setStatus = async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.status(404).json({ success: false, message: "Announcement not found." });
    const active = req.body.isActive === true || req.body.isActive === "true" ||
      req.body.active === true || req.body.active === "true" ||
      String(req.body.status || "").toUpperCase() === "ACTIVE" ||
      req.path.endsWith("/activate");
    const announcement = await Announcement.findByIdAndUpdate(
      req.params.id,
      { $set: { isActive: active, updatedBy: req.user._id } },
      { new: true, runValidators: true }
    ).lean();
    if (!announcement) return res.status(404).json({ success: false, message: "Announcement not found." });
    return res.json({ success: true, data: { announcement: adminView(announcement) } });
  } catch (error) {
    return res.status(400).json({ success: false, message: "Invalid announcement status." });
  }
};

exports.remove = async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.status(404).json({ success: false, message: "Announcement not found." });
    let deleted = false;
    for (let attempt = 0; attempt < 8 && !deleted; attempt += 1) {
      const session = await Announcement.db.startSession();
      try {
        let removedThisAttempt = false;
        let foundThisAttempt = false;
        await session.withTransaction(async () => {
          const announcement = await Announcement.findById(req.params.id).session(session);
          if (!announcement) return;
          foundThisAttempt = true;
          // Both collections commit together. An interaction transaction that
          // races this delete is forced to retry and then observes no active
          // announcement, so it cannot recreate an orphan row.
          await AnnouncementInteraction.deleteMany(
            { announcementId: announcement._id },
            { session },
          );
          await Announcement.deleteOne({ _id: announcement._id }, { session });
          removedThisAttempt = true;
        });
        if (!foundThisAttempt) {
          return res.status(404).json({ success: false, message: "Announcement not found." });
        }
        deleted = removedThisAttempt;
      } catch (error) {
        const retryable = error?.code === 11000 ||
          error?.errorLabels?.includes("TransientTransactionError") ||
          error?.errorLabels?.includes("UnknownTransactionCommitResult") ||
          error?.codeName === "WriteConflict";
        if (!retryable || attempt === 7) throw error;
        await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
      } finally {
        await session.endSession();
      }
    }
    if (!deleted) return res.status(404).json({ success: false, message: "Announcement not found." });
    return res.json({ success: true, message: "Announcement deleted." });
  } catch (error) {
    console.error("Delete announcement error:", error);
    return res.status(500).json({ success: false, message: "Failed to delete announcement." });
  }
};

exports.summary = async (req, res) => {
  try {
    const now = new Date();
    const [totals] = await Announcement.aggregate([{
      $group: {
        _id: null,
        total: { $sum: 1 },
        active: {
          $sum: {
            $cond: [
              {
                $and: [
                  "$isActive",
                  {
                    $or: [
                      { $eq: [{ $ifNull: ["$startAt", null] }, null] },
                      { $lte: ["$startAt", now] },
                    ],
                  },
                  {
                    $or: [
                      { $eq: [{ $ifNull: ["$endAt", null] }, null] },
                      { $gt: ["$endAt", now] },
                    ],
                  },
                ],
              },
              1,
              0,
            ],
          },
        },
        scheduled: {
          $sum: {
            $cond: [
              { $and: ["$isActive", { $gt: ["$startAt", now] }] },
              1,
              0,
            ],
          },
        },
        expired: {
          $sum: {
            $cond: [
              { $and: [{ $ne: ["$endAt", null] }, { $lte: ["$endAt", now] }] },
              1,
              0,
            ],
          },
        },
        views: { $sum: { $ifNull: ["$metrics.views", 0] } },
        acknowledgements: { $sum: { $ifNull: ["$metrics.acknowledgements", 0] } },
        dismissals: { $sum: { $ifNull: ["$metrics.dismissals", 0] } },
        clicks: { $sum: { $ifNull: ["$metrics.clicks", 0] } },
      },
    }]);
    const summary = totals || {
      total: 0, active: 0, scheduled: 0, expired: 0,
      views: 0, acknowledgements: 0, dismissals: 0, clicks: 0,
    };
    // Aggregation's grouping key is internal and is not part of the API
    // contract. Keep the metric names stable for existing admin clients.
    delete summary._id;
    return res.json({ success: true, data: { summary } });
  } catch (error) {
    console.error("Announcement summary error:", error);
    return res.status(500).json({ success: false, message: "Failed to load announcement summary." });
  }
};
