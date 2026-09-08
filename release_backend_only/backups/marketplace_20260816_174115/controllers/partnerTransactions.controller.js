const crypto = require("crypto");

const PartnerTransaction =
  require("../models/partnerTransaction.model");

function makeReference(service) {
  return [
    "SP",
    service,
    Date.now(),
    crypto.randomBytes(4).toString("hex").toUpperCase(),
  ].join("-");
}

exports.listTransactions = async (req, res) => {
  try {
    const partnerId = req.partner._id;

    const page = Math.max(
      Number(req.query.page || 1),
      1
    );

    const limit = Math.min(
      Math.max(Number(req.query.limit || 50), 1),
      100
    );

    const filter = {
      partner: partnerId,
    };

    if (req.query.status) {
      filter.status =
        String(req.query.status).toUpperCase();
    }

    if (req.query.service) {
      filter.service =
        String(req.query.service).toUpperCase();
    }

    const [items, total] = await Promise.all([
      PartnerTransaction.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),

      PartnerTransaction.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
      data: items,
    });
  } catch (error) {
    console.error(
      "Partner transaction list error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to load partner transactions.",
    });
  }
};

exports.getTransaction = async (req, res) => {
  try {
    const item =
      await PartnerTransaction.findOne({
        partner: req.partner._id,
        reference: req.params.reference,
      }).lean();

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found.",
      });
    }

    return res.json({
      success: true,
      data: item,
    });
  } catch (error) {
    console.error(
      "Partner transaction lookup error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to load transaction.",
    });
  }
};

exports.makeReference = makeReference;
