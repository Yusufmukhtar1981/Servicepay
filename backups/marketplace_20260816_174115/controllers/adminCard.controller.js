const Card = require('../models/card.model');

const normalizeStatus = (value) =>
  String(value || '').trim().toUpperCase();

exports.getCardRequests = async (req, res) => {
  try {
    const query = {};

    if (req.query.status) {
      query.status = normalizeStatus(req.query.status);
    }

    if (req.query.cardType) {
      query.cardType = String(req.query.cardType).trim().toUpperCase();
    }

    const cards = await Card.find(query)
      .populate('user', 'fullName phone email role status')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: cards.length,
      cards,
    });
  } catch (error) {
    console.error('ADMIN GET CARD REQUESTS ERROR:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to load card requests.',
    });
  }
};

exports.getCardRequest = async (req, res) => {
  try {
    const card = await Card.findById(req.params.id)
      .populate('user', 'fullName phone email role status');

    if (!card) {
      return res.status(404).json({
        success: false,
        message: 'Card request not found.',
      });
    }

    return res.status(200).json({
      success: true,
      card,
    });
  } catch (error) {
    console.error('ADMIN GET CARD REQUEST ERROR:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to load card request.',
    });
  }
};

exports.approveCardRequest = async (req, res) => {
  try {
    const card = await Card.findById(req.params.id);

    if (!card) {
      return res.status(404).json({
        success: false,
        message: 'Card request not found.',
      });
    }

    card.status = 'APPROVED';

    if ('approvedAt' in card) {
      card.approvedAt = new Date();
    }

    if ('approvedBy' in card && req.user?._id) {
      card.approvedBy = req.user._id;
    }

    if (
      req.body &&
      typeof req.body.adminNote === 'string' &&
      'adminNote' in card
    ) {
      card.adminNote = req.body.adminNote.trim();
    }

    await card.save();

    return res.status(200).json({
      success: true,
      message: 'Card request approved successfully.',
      card,
    });
  } catch (error) {
    console.error('ADMIN APPROVE CARD ERROR:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to approve card request.',
    });
  }
};

exports.rejectCardRequest = async (req, res) => {
  try {
    const card = await Card.findById(req.params.id);

    if (!card) {
      return res.status(404).json({
        success: false,
        message: 'Card request not found.',
      });
    }

    card.status = 'REJECTED';

    if ('rejectedAt' in card) {
      card.rejectedAt = new Date();
    }

    if ('rejectedBy' in card && req.user?._id) {
      card.rejectedBy = req.user._id;
    }

    if (
      req.body &&
      typeof req.body.reason === 'string' &&
      'rejectionReason' in card
    ) {
      card.rejectionReason = req.body.reason.trim();
    }

    await card.save();

    return res.status(200).json({
      success: true,
      message: 'Card request rejected successfully.',
      card,
    });
  } catch (error) {
    console.error('ADMIN REJECT CARD ERROR:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to reject card request.',
    });
  }
};

exports.updateCardStatus = async (req, res) => {
  try {
    const allowedStatuses = [
      'PENDING',
      'APPROVED',
      'PROCESSING',
      'PRINTED',
      'DISPATCHED',
      'DELIVERED',
      'ACTIVE',
      'FROZEN',
      'BLOCKED',
      'REJECTED',
      'EXPIRED',
    ];

    const status = normalizeStatus(req.body?.status);

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid card status.',
        allowedStatuses,
      });
    }

    const card = await Card.findById(req.params.id);

    if (!card) {
      return res.status(404).json({
        success: false,
        message: 'Card request not found.',
      });
    }

    card.status = status;

    if (
      req.body &&
      typeof req.body.adminNote === 'string' &&
      'adminNote' in card
    ) {
      card.adminNote = req.body.adminNote.trim();
    }

    await card.save();

    return res.status(200).json({
      success: true,
      message: `Card status changed to ${status}.`,
      card,
    });
  } catch (error) {
    console.error('ADMIN UPDATE CARD STATUS ERROR:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to update card status.',
    });
  }
};
