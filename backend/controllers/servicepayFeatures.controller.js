const crypto = require("crypto");

const User = require("../models/user.model");
const PaymentLink = require("../models/paymentLink.model");
const MoneyRequest = require("../models/moneyRequest.model");
const BusinessWallet = require("../models/businessWallet.model");
const GroupWallet = require("../models/groupWallet.model");

const userId = (req) =>
  req.user?._id || req.user?.id;

const shortCode = () =>
  crypto
    .randomBytes(5)
    .toString("hex")
    .toUpperCase();

exports.createPaymentLink = async (req, res) => {
  try {
    const amount = Number(req.body?.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid amount.",
      });
    }

    const item = await PaymentLink.create({
      owner: userId(req),
      code: shortCode(),
      title:
        String(req.body?.title || "Payment").trim(),
      amount,
      description:
        String(req.body?.description || "").trim(),
    });

    return res.status(201).json({
      success: true,
      message: "Payment link created.",
      paymentLink: item,
      url:
        `https://servicepay.ng/pay/${item.code}`,
    });
  } catch (error) {
    console.error("CREATE PAYMENT LINK:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to create payment link.",
    });
  }
};

exports.myPaymentLinks = async (req, res) => {
  const items = await PaymentLink.find({
    owner: userId(req),
  }).sort({
    createdAt: -1,
  });

  return res.json({
    success: true,
    paymentLinks: items,
  });
};

exports.createMoneyRequest = async (req, res) => {
  try {
    const phone =
      String(req.body?.phone || "").trim();

    const amount = Number(req.body?.amount);

    if (!phone || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Phone and valid amount are required.",
      });
    }

    const receiver = await User.findOne({
      phone,
    });

    if (!receiver) {
      return res.status(404).json({
        success: false,
        message: "ServicePay user not found.",
      });
    }

    if (
      String(receiver._id) ===
      String(userId(req))
    ) {
      return res.status(400).json({
        success: false,
        message:
          "You cannot request money from yourself.",
      });
    }

    const item = await MoneyRequest.create({
      requester: userId(req),
      requestedFrom: receiver._id,
      reference:
        `REQ-${Date.now()}-${shortCode()}`,
      amount,
      note:
        String(req.body?.note || "").trim(),
    });

    return res.status(201).json({
      success: true,
      message: "Money request sent.",
      request: item,
    });
  } catch (error) {
    console.error("CREATE MONEY REQUEST:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to create request.",
    });
  }
};

exports.moneyRequests = async (req, res) => {
  const id = userId(req);

  const items = await MoneyRequest.find({
    $or: [
      {
        requester: id,
      },
      {
        requestedFrom: id,
      },
    ],
  })
    .populate(
      "requester requestedFrom",
      "fullName phone"
    )
    .sort({
      createdAt: -1,
    });

  return res.json({
    success: true,
    requests: items,
  });
};

exports.createBusinessProfile = async (req, res) => {
  try {
    const owner = userId(req);

    const item =
      await BusinessWallet.findOneAndUpdate(
        {
          owner,
        },
        {
          owner,
          businessName:
            String(req.body?.businessName || "")
              .trim(),
          businessPhone:
            String(req.body?.businessPhone || "")
              .trim(),
          category:
            String(req.body?.category || "")
              .trim(),
          description:
            String(req.body?.description || "")
              .trim(),
        },
        {
          new: true,
          upsert: true,
          runValidators: true,
        }
      );

    return res.json({
      success: true,
      message: "Business profile saved.",
      business: item,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message:
        error.message ||
        "Unable to save business profile.",
    });
  }
};

exports.getBusinessProfile = async (req, res) => {
  const item = await BusinessWallet.findOne({
    owner: userId(req),
  });

  return res.json({
    success: true,
    business: item,
  });
};

exports.agentLocator = async (req, res) => {
  const state =
    String(req.query?.state || "").trim();

  const lga =
    String(req.query?.lga || "").trim();

  const filter = {
    role: {
      $in: [
        "AGGREGATOR",
        "AGENT",
        "STATE_MANAGER",
      ],
    },
    status: "ACTIVE",
  };

  if (state) {
    filter.state = new RegExp(
      `^${state}$`,
      "i"
    );
  }

  if (lga) {
    filter.lga = new RegExp(
      `^${lga}$`,
      "i"
    );
  }

  const agents = await User.find(filter)
    .select(
      "fullName phone role state lga status"
    )
    .limit(200);

  return res.json({
    success: true,
    agents,
  });
};

exports.createGroup = async (req, res) => {
  try {
    const amount =
      Number(req.body?.contributionAmount);

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        message:
          "Enter a valid contribution amount.",
      });
    }

    const group = await GroupWallet.create({
      owner: userId(req),
      name:
        String(req.body?.name || "").trim(),
      description:
        String(req.body?.description || "")
          .trim(),
      contributionAmount: amount,
      frequency:
        String(
          req.body?.frequency || "MONTHLY"
        ).toUpperCase(),
    });

    return res.status(201).json({
      success: true,
      message: "Group created successfully.",
      group,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message:
        error.message ||
        "Unable to create group.",
    });
  }
};

exports.myGroups = async (req, res) => {
  const groups = await GroupWallet.find({
    owner: userId(req),
  }).sort({
    createdAt: -1,
  });

  return res.json({
    success: true,
    groups,
  });
};
