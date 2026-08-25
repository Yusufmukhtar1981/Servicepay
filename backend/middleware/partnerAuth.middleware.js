const crypto = require('crypto');
const Partner = require('../models/partner.model');

function hashSecret(secret) {
  return crypto
    .createHash('sha256')
    .update(String(secret || ''))
    .digest('hex');
}

function hasPartnerPermission(partner, permission) {
  const permissions = Array.isArray(partner?.permissions)
    ? partner.permissions.map((value) => String(value || "").trim().toUpperCase())
    : [];
  return permissions.includes("*") || permissions.includes(String(permission).toUpperCase());
}

async function partnerAuth(req, res, next) {
  try {
    const apiKey =
      req.headers['x-api-key'] ||
      req.headers['x-servicepay-api-key'];

    const apiSecret =
      req.headers['x-api-secret'] ||
      req.headers['x-servicepay-api-secret'];

    if (!apiKey || !apiSecret) {
      return res.status(401).json({
        success: false,
        message: 'API key and API secret are required.',
      });
    }

    const partner = await Partner.findOne({
      apiKey: String(apiKey).trim(),
    }).select("+apiSecretHash");

    if (!partner) {
      return res.status(401).json({
        success: false,
        message: 'Invalid API credentials.',
      });
    }

    if (partner.status !== 'ACTIVE') {
      return res.status(403).json({
        success: false,
        message: 'Partner API access is not active.',
      });
    }

    const receivedHash = hashSecret(apiSecret);

    const expectedBuffer = Buffer.from(
      partner.apiSecretHash,
      'utf8'
    );

    const receivedBuffer = Buffer.from(
      receivedHash,
      'utf8'
    );

    if (
      expectedBuffer.length !== receivedBuffer.length ||
      !crypto.timingSafeEqual(
        expectedBuffer,
        receivedBuffer
      )
    ) {
      return res.status(401).json({
        success: false,
        message: 'Invalid API credentials.',
      });
    }

    partner.lastUsedAt = new Date();
    partner.lastRequestAt = new Date();
    await partner.save();

    req.partner = partner;

    next();
  } catch (_) {
    return res.status(500).json({
      success: false,
      message: 'Partner authentication failed.',
    });
  }
}

function requirePartnerPermission(permission) {
  return function permissionMiddleware(
    req,
    res,
    next
  ) {
    if (hasPartnerPermission(req.partner, permission)) {
      return next();
    }

    return res.status(403).json({
      success: false,
      message:
        `Partner does not have ${permission} permission.`,
    });
  };
}

module.exports = {
  partnerAuth,
  requirePartnerPermission,
  hasPartnerPermission,
  hashSecret,
};
