const crypto = require('crypto');

const Partner = require(
  '../models/partner.model'
);
const PartnerTransaction = require("../models/partnerTransaction.model");
const PartnerAuditLog = require("../models/partnerAuditLog.model");

const {
  hashSecret,
} = require(
  '../middleware/partnerAuth.middleware'
);

function generateApiKey() {
  return (
    'sp_live_' +
    crypto.randomBytes(24).toString('hex')
  );
}

function generateApiSecret() {
  return (
    'sp_secret_' +
    crypto.randomBytes(32).toString('hex')
  );
}

const allowedPermissions = ["AIRTIME", "DATA"];

const normalizePermissions = (permissions) => [
  ...new Set((Array.isArray(permissions) ? permissions : [])
      .map((permission) => String(permission || "").trim().toUpperCase())
      .includes("*")
      ? allowedPermissions
      : (Array.isArray(permissions) ? permissions : [])
          .map((permission) => String(permission || "").trim().toUpperCase())
          .filter((permission) => allowedPermissions.includes(permission))),
];

const recordAudit = async ({ partner, action, actor = null, metadata = null }) =>
  PartnerAuditLog.create({ partner, action, actor, metadata });

const partnerForCustomer = async (req) => {
  const user = req.user || {};
  const userId = user._id || user.id;
  if (userId) {
    const ownedPartner = await Partner.findOne({ createdBy: userId });
    if (ownedPartner) return ownedPartner;
  }
  const email = String(user.email || "").trim().toLowerCase();
  const phone = String(user.phone || "").trim();
  if (!userId || !email || !phone) return null;
  const legacyPartner = await Partner.findOne({
    createdBy: null,
    email,
    phone,
  });
  if (!legacyPartner) return null;
  legacyPartner.createdBy = userId;
  await legacyPartner.save();
  return legacyPartner;
};

const serializePartner = (partner, { includeApiKey = false } = {}) => ({
  id: partner._id,
  partnerId: String(partner._id),
  businessName: partner.businessName,
  contactName: partner.contactName,
  email: partner.email,
  phone: partner.phone,
  status: partner.status,
  environment: partner.environment || "LIVE",
  ...(includeApiKey ? { apiKey: partner.apiKey || "" } : {}),
  permissions: normalizePermissions(partner.permissions),
  walletBalance: Number(partner.walletBalance || 0),
  dailyLimit: Number(partner.dailyLimit || 0),
  dailySpent: Number(partner.dailySpent || 0),
  dailyRemaining: Math.max(0, Number(partner.dailyLimit || 0) - Number(partner.dailySpent || 0)),
  perTransactionLimit: partner.perTransactionLimit == null ? null : Number(partner.perTransactionLimit),
  approvedAt: partner.approvedAt || partner.createdAt || null,
  lastRequestAt: partner.lastRequestAt || partner.lastUsedAt || null,
  lastUsedAt: partner.lastUsedAt || null,
  failedRequestCount: Number(partner.failedRequestCount || 0),
  initialCredentialDeliveryPending: Boolean(partner.initialCredentialDeliveryPending),
  createdAt: partner.createdAt,
});

const rotateCredentials = async ({ partner, actor = null, action = "CREDENTIALS_REGENERATED" }) => {
  const apiKey = generateApiKey();
  const apiSecret = generateApiSecret();
  partner.apiKey = apiKey;
  partner.apiSecretHash = hashSecret(apiSecret);
  partner.lastUsedAt = null;
  partner.lastRequestAt = null;
  await partner.save();
  await recordAudit({ partner: partner._id, action, actor });
  return { apiKey, apiSecret };
};

exports.createPartner = async (
  req,
  res
) => {
  try {
    const {
      businessName,
      contactName,
      email,
      phone,
      permissions,
      dailyLimit,
    } = req.body || {};

    if (
      !businessName ||
      !contactName ||
      !email
    ) {
      return res.status(400).json({
        success: false,
        message:
          'businessName, contactName and email are required.',
      });
    }

    const exists = await Partner.findOne({
      email: String(email)
        .trim()
        .toLowerCase(),
    });

    if (exists) {
      return res.status(409).json({
        success: false,
        message:
          'A partner with this email already exists.',
      });
    }

    const apiKey = generateApiKey();
    const apiSecret = generateApiSecret();

    const partner = await Partner.create({
      businessName:
        String(businessName).trim(),

      contactName:
        String(contactName).trim(),

      email:
        String(email)
          .trim()
          .toLowerCase(),

      phone:
        String(phone || '').trim(),

      apiKey,

      apiSecretHash:
        hashSecret(apiSecret),

      permissions: normalizePermissions(permissions),

      dailyLimit:
        Number(dailyLimit) > 0
          ? Number(dailyLimit)
          : 1000000,

      createdBy:
        req.user?._id ||
        req.user?.id ||
        null,
    });
    await recordAudit({
      partner: partner._id,
      action: "CREDENTIALS_CREATED",
      actor: req.user?._id || req.user?.id || null,
    });

    return res.status(201).json({
      success: true,

      message:
        'Partner created successfully. Save the API secret now because it will not be shown again.',

      partner: {
        id: partner._id,
        businessName:
          partner.businessName,
        contactName:
          partner.contactName,
        email: partner.email,
        status: partner.status,
        permissions:
          partner.permissions,
        walletBalance:
          partner.walletBalance,
        dailyLimit:
          partner.dailyLimit,
        apiKey,
        apiSecret,
      },
    });
  } catch (error) {
    console.error(
      'Create partner error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error.message ||
        'Unable to create partner.',
    });
  }
};


exports.regenerateCredentials = async (req, res) => {
  try {
    const partner = await Partner.findById(req.params.id);

    if (!partner) {
      return res.status(404).json({
        success: false,
        message: 'Partner not found.',
      });
    }

    const { apiKey, apiSecret } = await rotateCredentials({
      partner,
      actor: req.user?._id || req.user?.id || null,
    });

    return res.status(200).json({
      success: true,
      message:
        'API credentials regenerated successfully. Save the API Secret now because it will not be shown again.',
      partner: {
        id: partner._id,
        businessName: partner.businessName,
        contactName: partner.contactName,
        email: partner.email,
        status: partner.status,
      },
      credentials: {
        apiKey,
        apiSecret,
      },
    });
  } catch (error) {
    console.error('Regenerate Partner API credentials error:', error);

    return res.status(500).json({
      success: false,
      message:
        error.message ||
        'Unable to regenerate Partner API credentials.',
    });
  }
};


exports.getPartners = async (
  req,
  res
) => {
  try {
    const partners =
      await Partner.find({})
        .select('-apiSecretHash')
        .sort({ createdAt: -1 });

    return res.json({
      success: true,
      total: partners.length,
      partners,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message:
        error.message ||
        'Unable to load partners.',
    });
  }
};

exports.getMyProfile = async (
  req,
  res
) => {
  return res.json({
    success: true,

    partner: serializePartner(req.partner),
  });
};


/*
 * Customer-facing Partner profile.
 * Uses the normal ServicePay login token.
 * API Secret is intentionally never returned here.
 */
exports.getCustomerPartnerProfile = async (req, res) => {
  try {
    const partner = await partnerForCustomer(req);

    if (!partner) {
      return res.status(404).json({
        success: false,
        message: 'Partner account not found for this customer.',
      });
    }

    return res.json({
      success: true,
      partner: serializePartner(partner, { includeApiKey: true }),
    });
  } catch (error) {
    console.error(
      'Customer Partner profile error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error.message ||
        'Unable to load Partner API profile.',
    });
  }
};

exports.getCustomerTransactions = async (req, res) => {
  try {
    const partner = await partnerForCustomer(req);
    if (!partner) return res.status(404).json({ success: false, message: "Partner account not found for this customer." });
    const transactions = await PartnerTransaction.find({ partner: partner._id })
      .select("-requestPayload -responsePayload -providerResponse")
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    return res.json({ success: true, transactions });
  } catch (_) {
    return res.status(500).json({ success: false, message: "Unable to load Partner API activity." });
  }
};

exports.regenerateCustomerCredentials = async (req, res) => {
  try {
    const partner = await partnerForCustomer(req);
    if (!partner) return res.status(404).json({ success: false, message: "Partner account not found for this customer." });
    if (partner.status !== "ACTIVE") {
      return res.status(409).json({ success: false, message: "Only an active Partner API account can regenerate credentials." });
    }
    const credentials = await rotateCredentials({
      partner,
      actor: req.user?._id || req.user?.id || null,
    });
    return res.json({
      success: true,
      message: "Credentials regenerated. Save the API Secret now; ServicePay will not display it again.",
      credentials,
    });
  } catch (_) {
    return res.status(500).json({ success: false, message: "Unable to regenerate credentials." });
  }
};

exports.activateCustomerCredentials = async (req, res) => {
  try {
    const partner = await partnerForCustomer(req);
    if (!partner) return res.status(404).json({ success: false, message: "Partner account not found for this customer." });
    if (partner.status !== "ACTIVE") {
      return res.status(409).json({ success: false, message: "Only an active Partner API account can activate credentials." });
    }
    if (!partner.initialCredentialDeliveryPending) {
      return res.status(409).json({ success: false, message: "Initial credential delivery is not pending for this account." });
    }
    const credentials = await rotateCredentials({
      partner,
      actor: req.user?._id || req.user?.id || null,
      action: "CREDENTIALS_CREATED",
    });
    partner.initialCredentialDeliveryPending = false;
    await partner.save();
    return res.json({
      success: true,
      message: "Credentials activated. Save the API Secret now; ServicePay will not display it again.",
      credentials,
    });
  } catch (_) {
    return res.status(500).json({ success: false, message: "Unable to activate credentials." });
  }
};

exports.revokeCustomerAccess = async (req, res) => {
  try {
    const partner = await partnerForCustomer(req);
    if (!partner) return res.status(404).json({ success: false, message: "Partner account not found for this customer." });
    partner.status = "REVOKED";
    await partner.save();
    await recordAudit({
      partner: partner._id,
      action: "ACCESS_REVOKED",
      actor: req.user?._id || req.user?.id || null,
      metadata: { source: "PARTNER_PORTAL" },
    });
    return res.json({ success: true, message: "Partner API access has been revoked.", partner: serializePartner(partner) });
  } catch (_) {
    return res.status(500).json({ success: false, message: "Unable to revoke Partner API access." });
  }
};

exports.getDocumentation = (req, res) => {
  const baseUrl = `${req.protocol}://${req.get("host")}/api/partner`;
  return res.json({
    success: true,
    baseUrl,
    authentication: {
      headers: ["X-API-Key: sp_live_...", "X-API-Secret: supplied secret", "Idempotency-Key: unique request value"],
      note: "Use only services enabled in your approved permissions. Never send credentials in a URL.",
    },
    limits: "Daily and per-transaction limits are enforced server-side against the partner wallet.",
    endpoints: [
      { method: "GET", path: "/profile", permission: "Authenticated partner", description: "Retrieve current partner profile and limits." },
      { method: "GET", path: "/balance", permission: "Authenticated partner", description: "Retrieve available partner wallet balance." },
      { method: "GET", path: "/transactions", permission: "Authenticated partner", description: "List your API transaction records." },
      { method: "GET", path: "/data-plans/:network", permission: "DATA", description: "List current purchasable data plans." },
      { method: "POST", path: "/airtime", permission: "AIRTIME", description: "Buy airtime. Body: network, phone, amount. Requires Idempotency-Key." },
      { method: "POST", path: "/data", permission: "DATA", description: "Buy data. Body: network, phone, planCode. Requires Idempotency-Key." },
    ],
    examples: {
      airtime: {
        headers: { "X-API-Key": "sp_live_...", "X-API-Secret": "sp_secret_...", "Idempotency-Key": "unique-request-id" },
        body: { network: "MTN", phone: "08030000000", amount: 100 },
      },
      data: {
        headers: { "X-API-Key": "sp_live_...", "X-API-Secret": "sp_secret_...", "Idempotency-Key": "unique-request-id" },
        body: { network: "MTN", phone: "08030000000", planCode: "provider-plan-code" },
      },
    },
    successResponse: { success: true, data: { reference: "SPP-AIRTIME-...", status: "SUCCESSFUL" } },
    errorResponse: { success: false, message: "Safe error message", reference: "SPP-AIRTIME-..." },
  });
};

exports.updatePartnerStatus = async (req, res) => {
  try {
    const status = String(req.body?.status || "").trim().toUpperCase();
    if (!["ACTIVE", "SUSPENDED", "REVOKED"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid partner status." });
    }
    const partner = await Partner.findById(req.params.id);
    if (!partner) return res.status(404).json({ success: false, message: "Partner not found." });
    partner.status = status;
    if (status === "ACTIVE" && !partner.approvedAt) partner.approvedAt = new Date();
    await partner.save();
    await recordAudit({
      partner: partner._id,
      action: status === "ACTIVE" ? "ACCESS_RESTORED" : "STATUS_CHANGED",
      actor: req.user?._id || req.user?.id || null,
      metadata: { status },
    });
    return res.json({ success: true, message: "Partner status updated.", partner: serializePartner(partner) });
  } catch (_) {
    return res.status(500).json({ success: false, message: "Unable to update partner status." });
  }
};

exports.updatePartnerPermissions = async (req, res) => {
  try {
    if (!Array.isArray(req.body?.permissions)) {
      return res.status(400).json({ success: false, message: "Permissions must be an array of supported API services." });
    }
    const unsupported = req.body.permissions
      .map((permission) => String(permission || "").trim().toUpperCase())
      .filter((permission) => !allowedPermissions.includes(permission));
    if (unsupported.length) {
      return res.status(400).json({ success: false, message: "Only currently supported Partner API services can be assigned." });
    }
    const partner = await Partner.findById(req.params.id);
    if (!partner) return res.status(404).json({ success: false, message: "Partner not found." });
    partner.permissions = normalizePermissions(req.body.permissions);
    await partner.save();
    await recordAudit({
      partner: partner._id,
      action: "PERMISSIONS_CHANGED",
      actor: req.user?._id || req.user?.id || null,
      metadata: { permissions: partner.permissions },
    });
    return res.json({ success: true, message: "Partner permissions updated.", partner: serializePartner(partner) });
  } catch (_) {
    return res.status(500).json({ success: false, message: "Unable to update partner permissions." });
  }
};

exports.updatePartnerLimits = async (req, res) => {
  try {
    const partner = await Partner.findById(req.params.id);
    if (!partner) return res.status(404).json({ success: false, message: "Partner not found." });
    const dailyLimit = Number(req.body?.dailyLimit);
    const perTransactionLimit = req.body?.perTransactionLimit;
    if (!Number.isFinite(dailyLimit) || dailyLimit < 0) {
      return res.status(400).json({ success: false, message: "Daily limit must be a valid non-negative amount." });
    }
    if (perTransactionLimit !== null && perTransactionLimit !== undefined) {
      const parsed = Number(perTransactionLimit);
      if (!Number.isFinite(parsed) || parsed <= 0 || (dailyLimit > 0 && parsed > dailyLimit)) {
        return res.status(400).json({ success: false, message: "Per-transaction limit must be positive and cannot exceed the daily limit." });
      }
      partner.perTransactionLimit = parsed;
    } else {
      partner.perTransactionLimit = null;
    }
    partner.dailyLimit = dailyLimit;
    await partner.save();
    await recordAudit({
      partner: partner._id,
      action: "LIMITS_CHANGED",
      actor: req.user?._id || req.user?.id || null,
      metadata: { dailyLimit: partner.dailyLimit, perTransactionLimit: partner.perTransactionLimit },
    });
    return res.json({ success: true, message: "Partner limits updated.", partner: serializePartner(partner) });
  } catch (_) {
    return res.status(500).json({ success: false, message: "Unable to update partner limits." });
  }
};

exports.getPartnerUsage = async (req, res) => {
  try {
    const partner = await Partner.findById(req.params.id);
    if (!partner) return res.status(404).json({ success: false, message: "Partner not found." });
    const [transactions, audits] = await Promise.all([
      PartnerTransaction.find({ partner: partner._id })
        .select("-requestPayload -responsePayload")
        .sort({ createdAt: -1 })
        .limit(100)
        .lean(),
      PartnerAuditLog.find({ partner: partner._id }).sort({ createdAt: -1 }).limit(100).lean(),
    ]);
    return res.json({
      success: true,
      partner: serializePartner(partner),
      transactions,
      auditEvents: audits,
    });
  } catch (_) {
    return res.status(500).json({ success: false, message: "Unable to load partner usage." });
  }
};
