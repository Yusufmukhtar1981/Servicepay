const Card = require('../models/card.model');

function sendError(res, error, fallback = 'Something went wrong') {
  console.error('CARD ERROR:', error);
  return res.status(500).json({
    success: false,
    message: error?.message || fallback,
  });
}

exports.getMyCards = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;

    const cards = await Card.find({
      user: userId,
    }).sort({ createdAt: -1 });

    return res.json({
      success: true,
      cards,
    });
  } catch (error) {
    return sendError(res, error, 'Unable to load cards');
  }
};

exports.requestPhysicalCard = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;

    const existing = await Card.findOne({
      user: userId,
      cardType: 'PHYSICAL',
      status: {
        $in: ['PENDING', 'APPROVED', 'ACTIVE'],
      },
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message:
          'You already have an active or pending Physical Card request.',
      });
    }

    const {
      deliveryAddress = '',
      state = '',
      lga = '',
      phone = '',
    } = req.body || {};

    if (!deliveryAddress.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Delivery address is required.',
      });
    }

    const card = await Card.create({
      user: userId,
      cardType: 'PHYSICAL',
      status: 'PENDING',
      deliveryAddress: deliveryAddress.trim(),
      state: state.trim(),
      lga: lga.trim(),
      phone: phone.trim(),
      isFrozen: false,
    });

    return res.status(201).json({
      success: true,
      message:
        'Physical Card request submitted successfully.',
      card,
    });
  } catch (error) {
    return sendError(
      res,
      error,
      'Unable to request Physical Card',
    );
  }
};

exports.requestVirtualCard = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;

    const existing = await Card.findOne({
      user: userId,
      cardType: 'VIRTUAL',
      status: {
        $in: ['PENDING', 'APPROVED', 'ACTIVE'],
      },
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message:
          'You already have an active or pending Virtual Card request.',
      });
    }

    const card = await Card.create({
      user: userId,
      cardType: 'VIRTUAL',
      status: 'PENDING',
      isFrozen: false,
    });

    return res.status(201).json({
      success: true,
      message:
        'Virtual Card request submitted successfully.',
      card,
    });
  } catch (error) {
    return sendError(
      res,
      error,
      'Unable to request Virtual Card',
    );
  }
};

exports.freezeCard = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;

    const card = await Card.findOne({
      _id: req.params.id,
      user: userId,
    });

    if (!card) {
      return res.status(404).json({
        success: false,
        message: 'Card not found.',
      });
    }

    if (card.status !== 'ACTIVE') {
      return res.status(400).json({
        success: false,
        message: 'Only an active card can be frozen.',
      });
    }

    card.isFrozen = true;
    await card.save();

    return res.json({
      success: true,
      message: 'Card frozen successfully.',
      card,
    });
  } catch (error) {
    return sendError(res, error, 'Unable to freeze card');
  }
};

exports.unfreezeCard = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;

    const card = await Card.findOne({
      _id: req.params.id,
      user: userId,
    });

    if (!card) {
      return res.status(404).json({
        success: false,
        message: 'Card not found.',
      });
    }

    if (card.status !== 'ACTIVE') {
      return res.status(400).json({
        success: false,
        message: 'Only an active card can be unfrozen.',
      });
    }

    card.isFrozen = false;
    await card.save();

    return res.json({
      success: true,
      message: 'Card unfrozen successfully.',
      card,
    });
  } catch (error) {
    return sendError(res, error, 'Unable to unfreeze card');
  }
};
