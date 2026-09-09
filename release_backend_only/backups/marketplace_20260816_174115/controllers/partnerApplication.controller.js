const PartnerApplication = require(
  '../models/partnerApplication.model'
);

exports.apply = async (req, res) => {
  try {
    const userId =
      req.user?._id ||
      req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    const {
      businessName,
      contactName,
      email,
      phone,
      website,
      purpose,
    } = req.body || {};

    if (
      !String(businessName || '').trim() ||
      !String(contactName || '').trim() ||
      !String(email || '').trim()
    ) {
      return res.status(400).json({
        success: false,
        message:
          'Business name, contact name and email are required.',
      });
    }

    const existing =
      await PartnerApplication.findOne({
        user: userId,
        status: {
          $in: ['PENDING', 'APPROVED'],
        },
      }).sort({
        createdAt: -1,
      });

    if (existing) {
      return res.status(409).json({
        success: false,
        message:
          existing.status === 'APPROVED'
            ? 'Your Partner API application has already been approved.'
            : 'You already have a pending Partner API application.',
        application: existing,
      });
    }

    const application =
      await PartnerApplication.create({
        user: userId,
        businessName:
          String(businessName).trim(),
        contactName:
          String(contactName).trim(),
        email:
          String(email).trim().toLowerCase(),
        phone:
          String(phone || '').trim(),
        website:
          String(website || '').trim(),
        purpose:
          String(purpose || '').trim(),
        status: 'PENDING',
      });

    return res.status(201).json({
      success: true,
      message:
        'Partner API application submitted successfully. Head Office will review your application.',
      application,
    });
  } catch (error) {
    console.error(
      'Partner application error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error.message ||
        'Unable to submit Partner API application.',
    });
  }
};

exports.myApplication = async (req, res) => {
  try {
    const userId =
      req.user?._id ||
      req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    const application =
      await PartnerApplication.findOne({
        user: userId,
      })
        .sort({
          createdAt: -1,
        })
        .populate(
          'partner',
          'businessName status apiKey walletBalance dailyLimit permissions'
        );

    return res.json({
      success: true,
      application: application || null,
    });
  } catch (error) {
    console.error(
      'Load partner application error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error.message ||
        'Unable to load Partner API application.',
    });
  }
};
