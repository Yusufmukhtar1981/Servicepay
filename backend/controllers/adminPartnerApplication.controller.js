const crypto = require('crypto');

const PartnerApplication = require(
  '../models/partnerApplication.model'
);

const Partner = require(
  '../models/partner.model'
);
const PartnerAuditLog = require("../models/partnerAuditLog.model");

function generateApiKey() {
  return `sp_live_${crypto.randomBytes(18).toString('hex')}`;
}

function generateApiSecret() {
  return `sp_secret_${crypto.randomBytes(32).toString('hex')}`;
}

function hashSecret(secret) {
  return crypto
    .createHash('sha256')
    .update(secret)
    .digest('hex');
}

exports.getApplications = async (req, res) => {
  try {
    const status = String(
      req.query.status || ''
    ).trim().toUpperCase();

    const filter = {};

    if (
      status &&
      ['PENDING', 'APPROVED', 'REJECTED'].includes(status)
    ) {
      filter.status = status;
    }

    const applications = await PartnerApplication
      .find(filter)
      .populate(
        'user',
        'fullName email phone role status'
      )
      .sort({ createdAt: -1 });

    return res.json({
      success: true,
      total: applications.length,
      applications,
    });
  } catch (error) {
    console.error(
      'Get partner applications error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error.message ||
        'Unable to load partner applications.',
    });
  }
};

exports.approveApplication = async (req, res) => {
  try {
    const application =
      await PartnerApplication.findById(
        req.params.id
      );

    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Partner application not found.',
      });
    }

    if (
      String(application.status).toUpperCase() ===
      'APPROVED'
    ) {
      return res.status(400).json({
        success: false,
        message:
          'This application has already been approved.',
      });
    }

    const existingPartner =
      await Partner.findOne({
        email: String(
          application.email || ''
        )
          .trim()
          .toLowerCase(),
      });

    if (existingPartner) {
      return res.status(409).json({
        success: false,
        message:
          'A Partner account with this email already exists.',
      });
    }

    const apiKey = generateApiKey();
    const apiSecret = generateApiSecret();

    const partner = await Partner.create({
      businessName:
        application.businessName,
      contactName:
        application.contactName,
      email: String(
        application.email
      )
        .trim()
        .toLowerCase(),
      phone:
        application.phone || '',
      apiKey,
      apiSecretHash:
        hashSecret(apiSecret),
      status: 'ACTIVE',
      permissions: [],
      walletBalance: 0,
      dailyLimit: 1000000,
      perTransactionLimit: null,
      approvedAt: new Date(),
      initialCredentialDeliveryPending: true,
      createdBy:
        application.user || null,
    });

    await PartnerAuditLog.create({
      partner: partner._id,
      action: "CREDENTIALS_CREATED",
      actor: req.user?._id || req.user?.id || null,
      metadata: { source: "APPLICATION_APPROVAL" },
    });

    application.status = 'APPROVED';

    if (
      application.schema.path('reviewedAt')
    ) {
      application.reviewedAt = new Date();
    }

    if (
      application.schema.path('reviewedBy')
    ) {
      application.reviewedBy =
        req.user?._id ||
        req.user?.id ||
        null;
    }

    if (
      application.schema.path('partner')
    ) {
      application.partner = partner._id;
    }

    await application.save();

    return res.json({
      success: true,
      message:
        'Partner application approved successfully.',
      partner: {
        id: partner._id,
        businessName:
          partner.businessName,
        contactName:
          partner.contactName,
        email: partner.email,
        phone: partner.phone,
        status: partner.status,
        permissions:
          partner.permissions,
        walletBalance:
          partner.walletBalance,
        dailyLimit:
          partner.dailyLimit,
      },

    });
  } catch (error) {
    console.error(
      'Approve partner application error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error.message ||
        'Unable to approve partner application.',
    });
  }
};

exports.rejectApplication = async (req, res) => {
  try {
    const application =
      await PartnerApplication.findById(
        req.params.id
      );

    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Partner application not found.',
      });
    }

    if (
      String(application.status).toUpperCase() ===
      'APPROVED'
    ) {
      return res.status(400).json({
        success: false,
        message:
          'An approved Partner application cannot be rejected.',
      });
    }

    application.status = 'REJECTED';

    if (
      application.schema.path('rejectionReason')
    ) {
      application.rejectionReason =
        String(
          req.body?.reason || ''
        ).trim();
    }

    if (
      application.schema.path('reviewedAt')
    ) {
      application.reviewedAt =
        new Date();
    }

    if (
      application.schema.path('reviewedBy')
    ) {
      application.reviewedBy =
        req.user?._id ||
        req.user?.id ||
        null;
    }

    await application.save();

    return res.json({
      success: true,
      message:
        'Partner application rejected successfully.',
      application,
    });
  } catch (error) {
    console.error(
      'Reject partner application error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error.message ||
        'Unable to reject partner application.',
    });
  }
};
