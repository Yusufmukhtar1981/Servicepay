const crypto = require('crypto');

const Partner = require(
  '../models/partner.model'
);

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

      permissions:
        Array.isArray(permissions)
          ? permissions
          : [],

      dailyLimit:
        Number(dailyLimit) > 0
          ? Number(dailyLimit)
          : 1000000,

      createdBy:
        req.user?._id ||
        req.user?.id ||
        null,
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

    partner: {
      id: req.partner._id,
      businessName:
        req.partner.businessName,
      contactName:
        req.partner.contactName,
      email:
        req.partner.email,
      phone:
        req.partner.phone,
      status:
        req.partner.status,
      permissions:
        req.partner.permissions,
      walletBalance:
        req.partner.walletBalance,
      dailyLimit:
        req.partner.dailyLimit,
    },
  });
};
