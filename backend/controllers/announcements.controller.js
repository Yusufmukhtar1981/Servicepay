const mongoose = require("mongoose");
const Announcement = require("../models/announcement.model");
const AnnouncementInteraction = require("../models/announcementInteraction.model");
const AnnouncementCampaignWinner = require("../models/announcementCampaignWinner.model");
const Transaction = require("../models/transaction.model");
const User = require("../models/user.model");
const KycProfile = require("../models/kycProfile.model");

const ENUMS = {
  type: ["INFO", "SUCCESS", "WARNING", "CRITICAL", "PROMOTION", "MAINTENANCE", "SECURITY"],
  style: ["POPUP", "BANNER", "BOTH"],
  audience: ["ALL", "ACTIVE", "KYC_PENDING", "KYC_VERIFIED", "SELECTED_CUSTOMERS", "SELECTED_ROLE"],
  visibility: ["ONCE", "EVERY_LOGIN", "UNTIL_DISMISSED", "MANDATORY"],
  campaignStatus: ["DRAFT", "ACTIVE", "ENDED"],
};
const ELIGIBLE_TRANSACTION_TYPES = [
  "AIRTIME", "DATA", "CABLE", "ELECTRICITY", "EXAM_PIN",
  "BANK_TRANSFER", "DELIVERY", "ID_VERIFICATION", "AMANA", "MARKETPLACE",
  "SOLAR_DEPOSIT", "SOLAR_INSTALLMENT", "PHONE_FINANCING_DEPOSIT",
  "PHONE_FINANCING_INSTALLMENT", "PROTECTED_DEAL", "INTERSTATE_LOGISTICS",
];
const EXCLUDED_TRANSACTION_TYPES = new Set([
  "WALLET_FUNDING", "TRANSFER", "REFERRAL_BONUS", "EMPOWERMENT_FUNDING",
  "EMPOWERMENT_DISBURSEMENT", "PHONE_FINANCING_REFUND",
]);
// Customer delivery currently evaluates customer accounts only. Staff,
// rider, partner, and other internal roles are never valid customer targets.
const CUSTOMER_DELIVERY_ROLES = new Set(["CUSTOMER"]);
const KYC_PENDING_STATES = new Set(["PENDING", "UNDER_REVIEW", "NEEDS_MORE_INFORMATION"]);
const REFUND_MARKER_MAX_DEPTH = 12;
const MAX_CAMPAIGN_KOBO = Number.MAX_SAFE_INTEGER;
const MAX_CAMPAIGN_AMOUNT = MAX_CAMPAIGN_KOBO / 100;

// Keep the customer and admin paths on one bounded predicate. Both paths
// apply this bounded helper in Node after a tier-compatible Mongo query.
const refundMarkerBody = function refundMarkerBody(value, key, depth, maxDepth) {
  key = key || "";
  depth = depth || 0;
  maxDepth = maxDepth || 12;
  if (value === null || value === undefined || depth > maxDepth) return false;
  if (/refund|revers/i.test(key)) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") return value.trim() !== "";
    if (value) return true;
  }
  if (Array.isArray(value)) {
    return value.some((item) => refundMarkerBody(item, key, depth + 1, maxDepth));
  }
  if (typeof value === "object") {
    return Object.keys(value).some((childKey) =>
      refundMarkerBody(value[childKey], childKey, depth + 1, maxDepth));
  }
  return false;
};

const asUpper = (value) => String(value || "").trim().toUpperCase();
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const validId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

// Campaign values are stored by the API in naira, but are normalized to
// integer kobo before comparison/summing. Ties at half a kobo use round-half-
// even, matching MongoDB's $round behavior.
const normalizeCampaignAmountToKobo = (amount) => {
  if (typeof amount !== "number" || !Number.isFinite(amount) ||
      amount < 0 || amount > MAX_CAMPAIGN_AMOUNT) return null;
  const source = String(amount).toLowerCase();
  const match = source.match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/);
  if (!match) return null;
  const whole = match[1];
  const fraction = match[2] || "";
  const exponent = Number(match[3] || 0);
  const digits = BigInt(`${whole}${fraction}` || "0");
  const decimalPlaces = fraction.length - exponent;
  let kobo;
  if (decimalPlaces <= 2) {
    kobo = digits * (10n ** BigInt(2 - decimalPlaces));
  } else {
    const divisor = 10n ** BigInt(decimalPlaces - 2);
    kobo = digits / divisor;
    const remainder = digits % divisor;
    const half = divisor / 2n;
    if (remainder > half || (remainder === half && (kobo % 2n) === 1n)) kobo += 1n;
  }
  return kobo <= BigInt(MAX_CAMPAIGN_KOBO) ? Number(kobo) : null;
};

const campaignRequirementToKobo = (value) => {
  if (value === null || value === undefined) return null;
  const kobo = BigInt(value) * 100n;
  return kobo <= BigInt(MAX_CAMPAIGN_KOBO) ? Number(kobo) : null;
};

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
  const campaignStatus = asUpper(source.campaignStatus || "DRAFT");
  if (!ENUMS.type.includes(type)) throw new Error("Invalid announcement type.");
  if (!ENUMS.style.includes(style)) throw new Error("Invalid announcement style.");
  if (!ENUMS.audience.includes(audience)) throw new Error("Invalid announcement audience.");
  if (!ENUMS.visibility.includes(visibility)) throw new Error("Invalid announcement visibility.");
  if (!ENUMS.campaignStatus.includes(campaignStatus)) throw new Error("Invalid campaign status.");

  const title = String(source.title || "").trim();
  const message = String(source.message || "").trim();
  if (!title) throw new Error("Announcement title is required.");
  if (!message) throw new Error("Announcement message is required.");
  if (title.length > 100) throw new Error("Announcement title is too long.");
  if (message.length > 500) throw new Error("Announcement message is too long.");

  const startAt = parseDate(source.startAt ?? source.start, "Start date");
  const endAt = parseDate(source.endAt ?? source.end, "End date");
  if (startAt && endAt && endAt <= startAt) throw new Error("End date must be after start date.");

  const eligibilityStartAt = parseDate(source.eligibilityStartAt, "Eligibility start date");
  const eligibilityEndAt = parseDate(source.eligibilityEndAt, "Eligibility end date");
  if (eligibilityStartAt && eligibilityEndAt && eligibilityEndAt <= eligibilityStartAt) {
    throw new Error("Eligibility end date must be after eligibility start date.");
  }

  const campaignTrackingEnabled = source.campaignTrackingEnabled === true ||
    String(source.campaignTrackingEnabled || "").toLowerCase() === "true";
  const parseRequirement = (value, name, { minimum }) => {
    if (value === null || value === undefined || String(value).trim() === "") return null;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < minimum) {
      throw new Error(`${name} must be a ${minimum ? "positive" : "nonnegative"} integer.`);
    }
    if (name === "Qualifying transaction value" && parsed > MAX_CAMPAIGN_AMOUNT) {
      throw new Error(`${name} must fit within the safe kobo range.`);
    }
    return parsed;
  };
  const qualifyingTransactionCount = parseRequirement(
    source.qualifyingTransactionCount,
    "Qualifying transaction count",
    { minimum: 1 },
  );
  const qualifyingTransactionValue = parseRequirement(
    source.qualifyingTransactionValue,
    "Qualifying transaction value",
    { minimum: 0 },
  );
  let eligibleTransactionTypes = Array.isArray(source.eligibleTransactionTypes)
    ? [...new Set(source.eligibleTransactionTypes.map(asUpper))]
    : [];
  if (eligibleTransactionTypes.some((type) =>
    !ELIGIBLE_TRANSACTION_TYPES.includes(type) || EXCLUDED_TRANSACTION_TYPES.has(type))) {
    throw new Error("Eligible transaction types contain an unsupported service type.");
  }
  const rewardDescription = String(source.rewardDescription || "").trim();
  if (rewardDescription.length > 500) throw new Error("Reward description is too long.");

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
    campaignTrackingEnabled,
    qualifyingTransactionCount,
    qualifyingTransactionValue,
    eligibilityStartAt,
    eligibilityEndAt,
    eligibleTransactionTypes,
    campaignStatus,
    rewardDescription,
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
  if (announcement.campaignTrackingEnabled && announcement.campaignStatus !== "ACTIVE") return false;
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
  if (announcement.campaignTrackingEnabled && announcement.campaignStatus !== "ACTIVE") return false;
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

const campaignPeriod = (announcement) => ({
  start: announcement.eligibilityStartAt || announcement.startAt || null,
  end: announcement.eligibilityEndAt || announcement.endAt || null,
});

const trustedTransactionAmountExpression = () => ({
  $expr: {
    $and: [
      {
        $cond: [
          { $isNumber: "$amount" },
          {
            $and: [
              { $gte: ["$amount", 0] },
              { $lte: ["$amount", MAX_CAMPAIGN_AMOUNT] },
              {
                $lte: [
                  { $round: [{ $multiply: [{ $toDecimal: "$amount" }, { $toDecimal: "100" }] }, 0] },
                  { $toDecimal: String(MAX_CAMPAIGN_KOBO) },
                ],
              },
            ],
          },
          false,
        ],
      },
    ],
  },
});

const trustedEligibleTransactionTypes = (announcement) => [
  ...new Set((announcement.eligibleTransactionTypes || [])
    .map(asUpper)
    .filter((type) => ELIGIBLE_TRANSACTION_TYPES.includes(type) && !EXCLUDED_TRANSACTION_TYPES.has(type))),
];

const trackingTransactionMatch = (announcement, customerId, excludedTransactionIds = []) => {
  const period = campaignPeriod(announcement);
  const match = {
    ...(customerId === undefined ? {} : { customerId }),
    status: "SUCCESSFUL",
    serviceType: { $in: trustedEligibleTransactionTypes(announcement) },
    $and: [
      { $or: [{ reversalTransactionId: null }, { reversalTransactionId: { $exists: false } }] },
      { $or: [{ reversedTransactionId: null }, { reversedTransactionId: { $exists: false } }] },
      { $or: [{ reversalReference: "" }, { reversalReference: null }, { reversalReference: { $exists: false } }] },
      trustedTransactionAmountExpression(),
    ],
  };
  if (excludedTransactionIds.length) match._id = { $nin: excludedTransactionIds };
  if (period.start) match.createdAt = { ...(match.createdAt || {}), $gte: period.start };
  if (period.end) match.createdAt = { ...(match.createdAt || {}), $lt: period.end };
  return match;
};

const containsRefundOrReversalMarker = (value, key = "") =>
  refundMarkerBody(value, key, 0, REFUND_MARKER_MAX_DEPTH);

const trustedCampaignTransactions = async (announcement, customerId) => {
  if (!announcement.campaignTrackingEnabled || !trustedEligibleTransactionTypes(announcement).length) return [];
  const docs = await Transaction.find(trackingTransactionMatch(announcement, customerId))
    .select("_id amount createdAt providerResponse reversalReference reversalTransactionId reversedTransactionId")
    .sort({ createdAt: 1, _id: 1 })
    .lean();
  const seen = new Set();
  return docs.filter((transaction) => {
    const id = String(transaction._id);
    if (seen.has(id) || containsRefundOrReversalMarker(transaction.providerResponse)) return false;
    seen.add(id);
    const amountKobo = normalizeCampaignAmountToKobo(transaction.amount);
    if (amountKobo === null) return false;
    transaction.amountKobo = amountKobo;
    return true;
  });
};

const campaignProgressFor = async (announcement, customerId) => {
  const transactions = await trustedCampaignTransactions(announcement, customerId);
  let count = 0;
  let value = 0;
  let valueKobo = 0;
  let qualifiedAt = null;
  const countRequirement = announcement.qualifyingTransactionCount;
  const valueRequirement = announcement.qualifyingTransactionValue;
  const hasCountRequirement = countRequirement !== null && countRequirement !== undefined;
  const hasValueRequirement = valueRequirement !== null && valueRequirement !== undefined;
  const valueRequirementKobo = campaignRequirementToKobo(valueRequirement);
  if (hasValueRequirement && valueRequirementKobo === null) {
    throw new Error("Campaign value requirement exceeds the safe kobo range.");
  }
  for (const transaction of transactions) {
    if (!Number.isSafeInteger(count + 1)) throw new Error("Campaign transaction count exceeds safe integer range.");
    count += 1;
    if (!Number.isSafeInteger(valueKobo + transaction.amountKobo)) {
      throw new Error("Campaign amount exceeds safe integer range.");
    }
    valueKobo += transaction.amountKobo;
    value = valueKobo / 100;
    const countMet = !hasCountRequirement || count >= countRequirement;
    const valueMet = !hasValueRequirement || valueKobo >= valueRequirementKobo;
    if (!qualifiedAt && (hasCountRequirement || hasValueRequirement) && countMet && valueMet) {
      qualifiedAt = transaction.createdAt;
    }
  }
  const countPercentage = countRequirement
    ? Math.min(100, Math.floor((count / countRequirement) * 100)) : 0;
  const valuePercentage = !hasValueRequirement
    ? 0 : valueRequirement === 0 ? 100
      : Math.min(100, Math.floor((valueKobo / valueRequirementKobo) * 100));
  const qualified = Boolean(qualifiedAt);
  return {
    count,
    value,
    transactionCount: count,
    transactionValue: value,
    requiredTransactionCount: countRequirement ?? null,
    requiredTransactionValue: valueRequirement ?? null,
    qualified,
    qualifiedAt,
    remainingCount: countRequirement ? Math.max(0, countRequirement - count) : null,
    remainingValue: valueRequirement ? Math.max(0, valueRequirementKobo - valueKobo) / 100 : null,
    remainingTransactions: countRequirement ? Math.max(0, countRequirement - count) : null,
    transactionCountPercent: countPercentage,
    transactionValuePercent: valuePercentage,
    countPercentage,
    valuePercentage,
  };
};

const campaignRequirements = (announcement) => ({
  qualifyingTransactionCount: announcement.qualifyingTransactionCount ?? null,
  qualifyingTransactionValue: announcement.qualifyingTransactionValue ?? null,
  eligibleTransactionTypes: trustedEligibleTransactionTypes(announcement),
  eligibilityStartAt: announcement.eligibilityStartAt || announcement.startAt || null,
  eligibilityEndAt: announcement.eligibilityEndAt || announcement.endAt || null,
});

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
  campaignTrackingEnabled: Boolean(announcement.campaignTrackingEnabled),
  qualifyingTransactionCount: announcement.qualifyingTransactionCount ?? null,
  qualifyingTransactionValue: announcement.qualifyingTransactionValue ?? null,
  eligibilityStartAt: announcement.eligibilityStartAt || null,
  eligibilityEndAt: announcement.eligibilityEndAt || null,
  eligibleTransactionTypes: trustedEligibleTransactionTypes(announcement),
  campaignStatus: announcement.campaignStatus || "DRAFT",
  rewardDescription: announcement.rewardDescription || "",
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
      if (announcement.campaignTrackingEnabled && announcement.campaignStatus !== "ACTIVE") continue;
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

exports.progress = async (req, res) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(404).json({ success: false, message: "Announcement not found." });
    }
    const announcement = await Announcement.findOne({
      _id: req.params.id,
      ...scheduledFilter(),
      campaignTrackingEnabled: true,
      campaignStatus: "ACTIVE",
    }).lean();
    if (!announcement || !await matchesAudience(announcement, req.user)) {
      return res.status(404).json({ success: false, message: "Announcement not found." });
    }
    const progress = await campaignProgressFor(announcement, req.user._id);
    return res.json({
      success: true,
      data: {
        announcement: publicView(announcement),
        requirements: campaignRequirements(announcement),
        progress,
        ...progress,
      },
    });
  } catch (error) {
    console.error("Announcement campaign progress error:", error);
    return res.status(500).json({ success: false, message: "Failed to load campaign progress." });
  }
};

const participantRows = async (announcement, query = {}) => {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 25));
  const skip = (page - 1) * limit;
  const hasCount = announcement.qualifyingTransactionCount !== null &&
    announcement.qualifyingTransactionCount !== undefined;
  const hasValue = announcement.qualifyingTransactionValue !== null &&
    announcement.qualifyingTransactionValue !== undefined;
  const hasRequirement = hasCount || hasValue;
  const valueRequirementKobo = campaignRequirementToKobo(announcement.qualifyingTransactionValue);
  if (hasValue && valueRequirementKobo === null) {
    throw new Error("Campaign value requirement exceeds the safe kobo range.");
  }
  const valueRequirementDecimal = valueRequirementKobo === null
    ? null
    : mongoose.Types.Decimal128.fromString(String(valueRequirementKobo));
  const maxKoboDecimal = mongoose.Types.Decimal128.fromString(String(MAX_CAMPAIGN_KOBO));
  const sentinel = new Date("9999-12-31T23:59:59.999Z");
  const qualificationExpression = {
    $and: [
      hasCount ? { $gte: ["$customerTransactionCount", announcement.qualifyingTransactionCount] } : true,
      hasValue ? { $gte: ["$customerTransactionValue", valueRequirementDecimal] } : true,
      hasRequirement,
    ],
  };
  const rowQualificationExpression = {
    $and: [
      hasCount ? { $gte: ["$transactionCount", announcement.qualifyingTransactionCount] } : true,
      hasValue ? { $gte: ["$transactionValueKobo", valueRequirementDecimal] } : true,
      hasRequirement,
    ],
  };
  const safeSearch = String(query.search || "").trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const userSearch = [
    { $expr: { $eq: ["$_id", "$$customerId"] } },
    { role: "CUSTOMER" },
  ];
  const sort = String(query.sort || "qualifiedAt").toLowerCase();
  const direction = String(query.order || "desc").toLowerCase() === "asc" ? 1 : -1;
  const sortField = {
    count: "transactionCount",
    value: "transactionValue",
    transactioncount: "transactionCount",
    transactionvalue: "transactionValue",
    qualifiedat: "qualifiedAt",
    progress: "progress",
    progresspercent: "progressPercent",
    name: "fullName",
  }[sort] || "qualifiedAt";
  const sortSpec = { [sortField]: direction, customerId: 1 };
  const statusFilter = String(query.status || "").trim().toUpperCase();
  const rowFilter = {};
  if (statusFilter === "QUALIFIED") rowFilter.isQualified = true;
  if (statusFilter === "NOT_QUALIFIED" || statusFilter === "IN_PROGRESS") rowFilter.isQualified = false;
  if (statusFilter && !["QUALIFIED", "NOT_QUALIFIED", "IN_PROGRESS"].includes(statusFilter)) {
    rowFilter.customerStatus = statusFilter;
  }
  if (safeSearch) {
    rowFilter.$or = [
      { fullName: { $regex: safeSearch, $options: "i" } },
      { phone: { $regex: safeSearch, $options: "i" } },
      { email: { $regex: safeSearch, $options: "i" } },
    ];
  }
  // Atlas tiers without server-side JavaScript still need the same bounded,
  // recursive provider marker semantics as customer progress. Read only the
  // candidate IDs and provider payloads, then keep all aggregation work
  // (grouping, filtering, sorting, and pagination) in MongoDB.
  const candidateTransactions = await Transaction.find(trackingTransactionMatch(announcement))
    .select("_id providerResponse")
    .lean();
  const excludedTransactionIds = candidateTransactions
    .filter((transaction) => containsRefundOrReversalMarker(transaction.providerResponse))
    .map((transaction) => transaction._id);
  const pipeline = [
    { $match: trackingTransactionMatch(announcement, undefined, excludedTransactionIds) },
    {
      $set: {
        // Decimal128 plus $round implements exact half-even kobo rounding.
        campaignAmountKobo: {
          $round: [
            { $multiply: [{ $toDecimal: "$amount" }, { $toDecimal: "100" }] },
            0,
          ],
        },
      },
    },
    {
      $setWindowFields: {
        partitionBy: "$customerId",
        sortBy: { createdAt: 1, _id: 1 },
        output: {
          customerTransactionCount: {
            $count: {},
            window: { documents: ["unbounded", "current"] },
          },
          customerTransactionValue: {
            $sum: "$campaignAmountKobo",
            window: { documents: ["unbounded", "current"] },
          },
        },
      },
    },
    {
      $set: {
        // Deliberately raise on overflow rather than silently dropping or
        // converting an imprecise cumulative value.
        customerTransactionValue: {
          $cond: [
            { $lte: ["$customerTransactionValue", maxKoboDecimal] },
            "$customerTransactionValue",
            {
              $divide: [
                { $toDecimal: "$customerTransactionValue" },
                { $subtract: ["$customerTransactionValue", "$customerTransactionValue"] },
              ],
            },
          ],
        },
      },
    },
    {
      $set: {
        qualifiedAtCandidate: {
          $cond: [qualificationExpression, "$createdAt", sentinel],
        },
      },
    },
    {
      $group: {
        _id: "$customerId",
        transactionCount: { $sum: 1 },
        transactionValueKobo: { $sum: "$campaignAmountKobo" },
        qualifiedAtCandidate: { $min: "$qualifiedAtCandidate" },
      },
    },
    {
      $set: {
        transactionValue: {
          $toDouble: { $divide: ["$transactionValueKobo", { $toDecimal: "100" }] },
        },
        qualifiedAt: {
          $cond: [
            { $eq: ["$qualifiedAtCandidate", sentinel] },
            null,
            "$qualifiedAtCandidate",
          ],
        },
      },
    },
    {
      $lookup: {
        from: User.collection.name,
        let: { customerId: "$_id" },
        pipeline: [{ $match: { $and: userSearch } }],
        as: "customer",
      },
    },
    { $unwind: "$customer" },
    {
      $set: {
        customerId: "$_id",
        fullName: "$customer.fullName",
        phone: "$customer.phone",
        email: { $ifNull: ["$customer.email", null] },
        customerStatus: "$customer.status",
        isQualified: rowQualificationExpression,
      },
    },
    {
      $set: {
        countPercentage: hasCount
          ? { $toDouble: { $min: [100, { $floor: { $multiply: [{ $divide: ["$transactionCount", announcement.qualifyingTransactionCount] }, 100] } }] } }
          : 0,
        valuePercentage: !hasValue
          ? 0
          : announcement.qualifyingTransactionValue === 0
            ? 100
            : { $toDouble: { $min: [100, { $floor: { $multiply: [{ $divide: ["$transactionValueKobo", valueRequirementDecimal] }, 100] } }] } },
      },
    },
    {
      $set: {
        progress: { $max: ["$countPercentage", "$valuePercentage"] },
        progressPercent: { $max: ["$countPercentage", "$valuePercentage"] },
        status: { $cond: ["$isQualified", "QUALIFIED", "NOT_QUALIFIED"] },
        progressStatus: { $cond: ["$isQualified", "QUALIFIED", "IN_PROGRESS"] },
        qualifiedAt: { $cond: ["$isQualified", "$qualifiedAt", null] },
      },
    },
  ];
  // Summary deliberately runs beside the filtered row branch. This keeps the
  // campaign totals stable when search/status filters or pagination change.
  const summaryPipeline = pipeline.concat([
    {
      $facet: {
        summary: [
          {
            $group: {
              _id: null,
              totalParticipants: { $sum: 1 },
              qualifiedCustomers: { $sum: { $cond: ["$isQualified", 1, 0] } },
              totalQualifyingTransactionValueKobo: { $sum: "$transactionValueKobo" },
            },
          },
          {
            $set: {
              inProgressCustomers: { $subtract: ["$totalParticipants", "$qualifiedCustomers"] },
              qualificationRate: {
                $cond: [
                  { $gt: ["$totalParticipants", 0] },
                  { $min: [100, { $multiply: [{ $divide: ["$qualifiedCustomers", "$totalParticipants"] }, 100] }] },
                  0,
                ],
              },
              totalQualifyingTransactionValue: {
                $toDouble: {
                  $divide: ["$totalQualifyingTransactionValueKobo", { $toDecimal: "100" }],
                },
              },
            },
          },
        ],
        rows: [
          { $match: rowFilter },
          { $sort: sortSpec },
          { $skip: skip },
          { $limit: limit },
          {
            $project: {
              _id: 0,
              customerId: 1,
              fullName: 1,
              phone: 1,
              email: 1,
              customerStatus: 1,
              transactionCount: 1,
              transactionValue: 1,
              countPercentage: 1,
              valuePercentage: 1,
              progress: 1,
              progressPercent: 1,
              status: 1,
              progressStatus: 1,
              qualifiedAt: 1,
            },
          },
        ],
        filteredTotal: [{ $match: rowFilter }, { $count: "value" }],
      },
    },
  ]);
  const [result] = await Transaction.aggregate(summaryPipeline);
  const summary = result?.summary?.[0] || {
    totalParticipants: 0,
    qualifiedCustomers: 0,
    inProgressCustomers: 0,
    totalQualifyingTransactionValue: 0,
    qualificationRate: 0,
  };
  delete summary._id;
  delete summary.totalQualifyingTransactionValueKobo;
  return {
    rows: result?.rows || [],
    total: result?.filteredTotal?.[0]?.value || 0,
    summary,
    page,
    limit,
  };
};

exports.participants = async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.status(404).json({ success: false, message: "Announcement not found." });
    const announcement = await Announcement.findById(req.params.id).lean();
    if (!announcement) return res.status(404).json({ success: false, message: "Announcement not found." });
    const participantResult = await participantRows(announcement, req.query);
    const allRows = participantResult.rows;
    const winners = await AnnouncementCampaignWinner.find({
      announcementId: announcement._id,
      customerId: { $in: allRows.map((row) => row.customerId) },
    }).select("customerId markedAt").lean();
    const winnerByCustomer = new Map(winners.map((winner) => [String(winner.customerId), winner]));
    const rows = allRows.map((row) => ({
      ...row,
      winner: winnerByCustomer.has(String(row.customerId)),
      winnerMarkedAt: winnerByCustomer.get(String(row.customerId))?.markedAt || null,
    }));
    const summary = {
      ...participantResult.summary,
      participants: participantResult.summary.totalParticipants,
      qualified: participantResult.summary.qualifiedCustomers,
      qualifiedCount: participantResult.summary.qualifiedCustomers,
      inProgress: participantResult.summary.inProgressCustomers,
      inProgressCount: participantResult.summary.inProgressCustomers,
      total: participantResult.summary.totalParticipants,
      totalTransactionValue: participantResult.summary.totalQualifyingTransactionValue,
    };
    return res.json({
      success: true,
      data: {
        summary,
        requirements: campaignRequirements(announcement),
        participants: rows,
        rows,
        page: participantResult.page,
        limit: participantResult.limit,
        total: participantResult.total,
      },
    });
  } catch (error) {
    console.error("Announcement campaign participants error:", error);
    return res.status(500).json({ success: false, message: "Failed to load campaign participants." });
  }
};

exports.markWinner = async (req, res) => {
  try {
    if (!validId(req.params.id) || !validId(req.params.customerId)) {
      return res.status(404).json({ success: false, message: "Announcement or customer not found." });
    }
    const announcement = await Announcement.findById(req.params.id).lean();
    const customer = await User.findOne({ _id: req.params.customerId, role: "CUSTOMER" }).select("_id").lean();
    if (!announcement || !customer || !announcement.campaignTrackingEnabled) {
      return res.status(404).json({ success: false, message: "Campaign or customer not found." });
    }
    const progress = await campaignProgressFor(announcement, customer._id);
    if (!progress.qualified) {
      return res.status(409).json({
        success: false,
        code: "CUSTOMER_NOT_QUALIFIED",
        message: "Only qualified participants can be marked as winners.",
      });
    }
    try {
      const winner = await AnnouncementCampaignWinner.create({
        announcementId: announcement._id,
        customerId: customer._id,
        markedBy: req.user._id,
      });
      return res.status(201).json({ success: true, data: { winner, alreadyMarked: false } });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      const winner = await AnnouncementCampaignWinner.findOne({
        announcementId: announcement._id,
        customerId: customer._id,
      }).lean();
      return res.json({ success: true, data: { winner, alreadyMarked: true } });
    }
  } catch (error) {
    console.error("Mark announcement campaign winner error:", error);
    return res.status(500).json({ success: false, message: "Failed to mark campaign winner." });
  }
};

exports.winners = async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.status(404).json({ success: false, message: "Announcement not found." });
    const announcement = await Announcement.findById(req.params.id).select("_id").lean();
    if (!announcement) return res.status(404).json({ success: false, message: "Announcement not found." });
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
    const [winners, total] = await Promise.all([
      AnnouncementCampaignWinner.find({ announcementId: announcement._id })
        .sort({ markedAt: 1, _id: 1 }).skip((page - 1) * limit).limit(limit)
        .populate("customerId", "fullName phone email status")
        .populate("markedBy", "fullName email").lean(),
      AnnouncementCampaignWinner.countDocuments({ announcementId: announcement._id }),
    ]);
    return res.json({ success: true, data: { winners, page, limit, total } });
  } catch (error) {
    console.error("Announcement campaign winners error:", error);
    return res.status(500).json({ success: false, message: "Failed to load campaign winners." });
  }
};

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
    if (error.message?.startsWith("Invalid") || /required|too long|valid|Priority|integer|safe kobo|after|CTA|Selected customer|supported|Eligibility|campaign/i.test(error.message || "")) {
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
    if (/Invalid|required|too long|valid|Priority|integer|safe kobo|after|CTA|Selected customer|supported|Eligibility|campaign/i.test(error.message || "")) {
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
          const hasWinnerHistory = await AnnouncementCampaignWinner.exists({
            announcementId: announcement._id,
          }).session(session);
          if (hasWinnerHistory) {
            const conflict = new Error("Campaign winner history must be preserved.");
            conflict.code = "CAMPAIGN_HAS_WINNER_HISTORY";
            throw conflict;
          }
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
    if (error?.code === "CAMPAIGN_HAS_WINNER_HISTORY") {
      return res.status(409).json({
        success: false,
        code: "CAMPAIGN_HAS_WINNER_HISTORY",
        message: "Campaigns with winner history cannot be deleted.",
      });
    }
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
