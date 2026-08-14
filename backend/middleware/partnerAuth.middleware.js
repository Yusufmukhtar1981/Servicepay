const crypto = require('crypto');
const Partner = require('../models/partner.model');

function hashSecret(secret) {
  return crypto
    .createHash('sha256')
    .update(String(secret || ''))
    .digest('hex');
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
    });

    if (!partner) {
      return res.status(401).json({
        success: false,
        message: 'Invalid API credentials.',
      });
    }

    if (partner.status !== 'ACTIVE') {
      return res.status(403).json({
        success: false,
        message: `Partner account is ${partner.status}.`,
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
    await partner.save();

    req.partner = partner;

    next();
  } catch (error) {
    console.error(
      'Partner authentication error:',
      error
    );

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
    const permissions =
      req.partner?.permissions || [];

    if (
      permissions.includes('*') ||
      permissions.includes(permission)
    ) {
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
  hashSecret,
};
