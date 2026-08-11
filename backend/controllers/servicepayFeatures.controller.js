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

/*
 * ============================================================
 * SECURE FEATURE MONEY MOVEMENT
 * ============================================================
 */

const mongoose = require("mongoose");

const FeaturePayment = require(
  "../models/featurePayment.model"
);

const GroupContribution = require(
  "../models/groupContribution.model"
);

const paymentReference = (prefix) =>
  `${prefix}-${Date.now()}-${shortCode()}`;

const loadPayerForPin = async (
  id,
  session
) => {
  return User.findById(id)
    .select(
      "+transactionPin transactionPinSet walletBalance fullName phone"
    )
    .session(session);
};

const verifyTransactionPin = async (
  payer,
  pin
) => {
  if (
    payer.transactionPinSet !== true ||
    !payer.transactionPin
  ) {
    const error = new Error(
      "Please create your transaction PIN before making this payment."
    );

    error.statusCode = 400;
    error.code =
      "TRANSACTION_PIN_NOT_SET";

    throw error;
  }

  const enteredPin =
    String(pin || "").trim();

  if (!/^\d{4}$/.test(enteredPin)) {
    const error = new Error(
      "Enter your 4-digit transaction PIN."
    );

    error.statusCode = 400;
    error.code =
      "INVALID_TRANSACTION_PIN";

    throw error;
  }

  const correct =
    await payer.compareTransactionPin(
      enteredPin
    );

  if (!correct) {
    const error = new Error(
      "Incorrect transaction PIN."
    );

    error.statusCode = 401;
    error.code =
      "INCORRECT_TRANSACTION_PIN";

    throw error;
  }
};

const debitWallet = async ({
  userId,
  amount,
  session,
}) => {
  const updated =
    await User.findOneAndUpdate(
      {
        _id: userId,
        walletBalance: {
          $gte: amount,
        },
      },
      {
        $inc: {
          walletBalance: -amount,
        },
      },
      {
        new: true,
        session,
      }
    );

  if (!updated) {
    const error = new Error(
      "Insufficient wallet balance."
    );

    error.statusCode = 400;
    error.code =
      "INSUFFICIENT_BALANCE";

    throw error;
  }

  return updated;
};

const creditWallet = async ({
  userId,
  amount,
  session,
}) => {
  const updated =
    await User.findByIdAndUpdate(
      userId,
      {
        $inc: {
          walletBalance: amount,
        },
      },
      {
        new: true,
        session,
      }
    );

  if (!updated) {
    const error = new Error(
      "Beneficiary account not found."
    );

    error.statusCode = 404;

    throw error;
  }

  return updated;
};


/*
 * ------------------------------------------------------------
 * REQUEST MONEY - PAY
 * ------------------------------------------------------------
 */
exports.payMoneyRequest = async (
  req,
  res
) => {
  const session =
    await mongoose.startSession();

  try {
    let result = null;

    await session.withTransaction(
      async () => {
        const request =
          await MoneyRequest.findOne({
            _id: req.params.id,
            requestedFrom: userId(req),
            status: "PENDING",
          }).session(session);

        if (!request) {
          const error = new Error(
            "Pending money request not found."
          );

          error.statusCode = 404;
          throw error;
        }

        const idempotencyKey =
          `MONEY_REQUEST:${request._id}`;

        const alreadyPaid =
          await FeaturePayment.findOne({
            idempotencyKey,
            status: "SUCCESSFUL",
          }).session(session);

        if (alreadyPaid) {
          const error = new Error(
            "This money request has already been paid."
          );

          error.statusCode = 409;
          throw error;
        }

        const amount =
          Number(request.amount);

        const payer =
          await loadPayerForPin(
            userId(req),
            session
          );

        if (!payer) {
          const error = new Error(
            "Payer account not found."
          );

          error.statusCode = 404;
          throw error;
        }

        await verifyTransactionPin(
          payer,
          req.body?.transactionPin
        );

        const debited =
          await debitWallet({
            userId: payer._id,
            amount,
            session,
          });

        const credited =
          await creditWallet({
            userId: request.requester,
            amount,
            session,
          });

        const reference =
          paymentReference("REQPAY");

        const payment =
          await FeaturePayment.create(
            [
              {
                reference,
                idempotencyKey,
                featureType:
                  "MONEY_REQUEST",
                sourceId: request._id,
                payer: payer._id,
                beneficiary:
                  request.requester,
                amount,
                status: "SUCCESSFUL",
                description:
                  request.note ||
                  "ServicePay Money Request",
                completedAt:
                  new Date(),
              },
            ],
            {
              session,
            }
          );

        request.status = "PAID";
        request.paidAt = new Date();

        await request.save({
          session,
        });

        result = {
          payment: payment[0],
          payerWalletBalance:
            debited.walletBalance,
          beneficiaryWalletBalance:
            credited.walletBalance,
        };
      }
    );

    return res.status(200).json({
      success: true,
      message:
        "Money request paid successfully.",
      ...result,
    });
  } catch (error) {
    console.error(
      "PAY MONEY REQUEST ERROR:",
      error
    );

    return res
      .status(error.statusCode || 500)
      .json({
        success: false,
        code:
          error.code ||
          "MONEY_REQUEST_PAYMENT_FAILED",
        message:
          error.message ||
          "Unable to pay money request.",
      });
  } finally {
    await session.endSession();
  }
};


/*
 * ------------------------------------------------------------
 * REQUEST MONEY - DECLINE
 * ------------------------------------------------------------
 */
exports.declineMoneyRequest = async (
  req,
  res
) => {
  try {
    const request =
      await MoneyRequest.findOneAndUpdate(
        {
          _id: req.params.id,
          requestedFrom: userId(req),
          status: "PENDING",
        },
        {
          $set: {
            status: "DECLINED",
          },
        },
        {
          new: true,
        }
      );

    if (!request) {
      return res.status(404).json({
        success: false,
        message:
          "Pending money request not found.",
      });
    }

    return res.json({
      success: true,
      message:
        "Money request declined.",
      request,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message:
        "Unable to decline request.",
    });
  }
};


/*
 * ------------------------------------------------------------
 * PAY-BY-LINK DETAILS
 * ------------------------------------------------------------
 */
exports.getPaymentLinkByCode = async (
  req,
  res
) => {
  try {
    const item =
      await PaymentLink.findOne({
        code: String(
          req.params.code || ""
        ).toUpperCase(),
      }).populate(
        "owner",
        "fullName phone"
      );

    if (!item) {
      return res.status(404).json({
        success: false,
        message:
          "Payment link not found.",
      });
    }

    return res.json({
      success: true,
      paymentLink: item,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message:
        "Unable to load payment link.",
    });
  }
};


/*
 * ------------------------------------------------------------
 * PAY-BY-LINK - PAY
 * ------------------------------------------------------------
 */
exports.payPaymentLink = async (
  req,
  res
) => {
  const session =
    await mongoose.startSession();

  try {
    let result = null;

    await session.withTransaction(
      async () => {
        const item =
          await PaymentLink.findOne({
            code: String(
              req.params.code || ""
            ).toUpperCase(),
            status: "ACTIVE",
          }).session(session);

        if (!item) {
          const error = new Error(
            "Active payment link not found."
          );

          error.statusCode = 404;
          throw error;
        }

        const payerId =
          userId(req);

        if (
          String(item.owner) ===
          String(payerId)
        ) {
          const error = new Error(
            "You cannot pay your own payment link."
          );

          error.statusCode = 400;
          throw error;
        }

        const idempotencyKey =
          `PAY_LINK:${item._id}`;

        const existing =
          await FeaturePayment.findOne({
            idempotencyKey,
            status: "SUCCESSFUL",
          }).session(session);

        if (existing) {
          const error = new Error(
            "This payment link has already been paid."
          );

          error.statusCode = 409;
          throw error;
        }

        const amount =
          Number(item.amount);

        const payer =
          await loadPayerForPin(
            payerId,
            session
          );

        if (!payer) {
          const error = new Error(
            "Payer account not found."
          );

          error.statusCode = 404;
          throw error;
        }

        await verifyTransactionPin(
          payer,
          req.body?.transactionPin
        );

        const debited =
          await debitWallet({
            userId: payer._id,
            amount,
            session,
          });

        const merchant =
          await creditWallet({
            userId: item.owner,
            amount,
            session,
          });

        const reference =
          paymentReference("PAYLINK");

        const payments =
          await FeaturePayment.create(
            [
              {
                reference,
                idempotencyKey,
                featureType:
                  "PAY_BY_LINK",
                sourceId: item._id,
                payer: payer._id,
                beneficiary:
                  item.owner,
                amount,
                status: "SUCCESSFUL",
                description:
                  item.title,
                completedAt:
                  new Date(),
              },
            ],
            {
              session,
            }
          );

        item.status = "PAID";
        item.paidBy = payer._id;
        item.paidAt = new Date();

        await item.save({
          session,
        });

        result = {
          payment: payments[0],
          payerWalletBalance:
            debited.walletBalance,
          merchantWalletBalance:
            merchant.walletBalance,
        };
      }
    );

    return res.json({
      success: true,
      message:
        "Payment completed successfully.",
      ...result,
    });
  } catch (error) {
    console.error(
      "PAY LINK ERROR:",
      error
    );

    return res
      .status(error.statusCode || 500)
      .json({
        success: false,
        code:
          error.code ||
          "PAY_LINK_FAILED",
        message:
          error.message ||
          "Unable to complete payment.",
      });
  } finally {
    await session.endSession();
  }
};


/*
 * ------------------------------------------------------------
 * AJO - ADD MEMBER
 * ------------------------------------------------------------
 */
exports.addGroupMember = async (
  req,
  res
) => {
  try {
    const group =
      await GroupWallet.findOne({
        _id: req.params.id,
        owner: userId(req),
        status: "ACTIVE",
      });

    if (!group) {
      return res.status(404).json({
        success: false,
        message:
          "Active group not found.",
      });
    }

    const phone =
      String(
        req.body?.phone || ""
      ).trim();

    const member =
      await User.findOne({
        phone,
      });

    if (!member) {
      return res.status(404).json({
        success: false,
        message:
          "ServicePay user not found.",
      });
    }

    const exists =
      group.members.some(
        (item) =>
          String(item.user) ===
          String(member._id)
      );

    if (exists) {
      return res.status(409).json({
        success: false,
        message:
          "This member is already in the group.",
      });
    }

    group.members.push({
      user: member._id,
      phone: member.phone,
      status: "ACTIVE",
    });

    await group.save();

    return res.json({
      success: true,
      message:
        "Member added successfully.",
      group,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message:
        "Unable to add member.",
    });
  }
};


/*
 * ------------------------------------------------------------
 * AJO - CONTRIBUTE
 * ------------------------------------------------------------
 */
exports.contributeToGroup = async (
  req,
  res
) => {
  const session =
    await mongoose.startSession();

  try {
    let result = null;

    await session.withTransaction(
      async () => {
        const group =
          await GroupWallet.findOne({
            _id: req.params.id,
            status: "ACTIVE",
          }).session(session);

        if (!group) {
          const error = new Error(
            "Active group not found."
          );

          error.statusCode = 404;
          throw error;
        }

        const payerId =
          userId(req);

        const isOwner =
          String(group.owner) ===
          String(payerId);

        const isMember =
          group.members.some(
            (member) =>
              String(member.user) ===
                String(payerId) &&
              member.status === "ACTIVE"
          );

        if (
          !isOwner &&
          !isMember
        ) {
          const error = new Error(
            "You are not an active member of this group."
          );

          error.statusCode = 403;
          throw error;
        }

        const amount =
          Number(
            group.contributionAmount
          );

        const payer =
          await loadPayerForPin(
            payerId,
            session
          );

        await verifyTransactionPin(
          payer,
          req.body?.transactionPin
        );

        const debited =
          await debitWallet({
            userId: payerId,
            amount,
            session,
          });

        /*
         * One successful contribution per member/group
         * within a short safety window.
         * Prevents accidental double debit from double taps/retries.
         */
        const safetyWindowStart =
          new Date(Date.now() - 2 * 60 * 1000);

        const recentContribution =
          await GroupContribution.findOne({
            group: group._id,
            member: payerId,
            status: "SUCCESSFUL",
            createdAt: {
              $gte: safetyWindowStart,
            },
          }).session(session);

        if (recentContribution) {
          const error = new Error(
            "A contribution was already completed recently. Please check contribution history before trying again."
          );

          error.statusCode = 409;
          error.code =
            "DUPLICATE_AJO_CONTRIBUTION";

          throw error;
        }

        const reference =
          paymentReference("AJO");

        const idempotencyKey =
          `AJO:${group._id}:${payerId}:${reference}`;

        const contribution =
          await GroupContribution.create(
            [
              {
                group: group._id,
                member: payerId,
                reference,
                amount,
                status:
                  "SUCCESSFUL",
              },
            ],
            {
              session,
            }
          );

        await GroupWallet.findByIdAndUpdate(
          group._id,
          {
            $inc: {
              totalCollected:
                amount,
            },
          },
          {
            session,
          }
        );

        const payment =
          await FeaturePayment.create(
            [
              {
                reference,
                idempotencyKey,
                featureType:
                  "AJO_CONTRIBUTION",
                sourceId: group._id,
                payer: payerId,
                beneficiary: null,
                amount,
                status: "SUCCESSFUL",
                description:
                  `Ajo contribution - ${group.name}`,
                completedAt:
                  new Date(),
              },
            ],
            {
              session,
            }
          );

        result = {
          contribution:
            contribution[0],
          payment: payment[0],
          walletBalance:
            debited.walletBalance,
        };
      }
    );

    return res.json({
      success: true,
      message:
        "Contribution completed successfully.",
      ...result,
    });
  } catch (error) {
    console.error(
      "AJO CONTRIBUTION ERROR:",
      error
    );

    return res
      .status(error.statusCode || 500)
      .json({
        success: false,
        code:
          error.code ||
          "AJO_CONTRIBUTION_FAILED",
        message:
          error.message ||
          "Unable to complete contribution.",
      });
  } finally {
    await session.endSession();
  }
};


/*
 * ------------------------------------------------------------
 * AJO CONTRIBUTION HISTORY
 * ------------------------------------------------------------
 */
exports.groupContributions = async (
  req,
  res
) => {
  try {
    const contributions =
      await GroupContribution.find({
        group: req.params.id,
      })
        .populate(
          "member",
          "fullName phone"
        )
        .sort({
          createdAt: -1,
        });

    return res.json({
      success: true,
      contributions,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message:
        "Unable to load contribution history.",
    });
  }
};
