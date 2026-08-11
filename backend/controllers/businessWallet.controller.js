const crypto = require("crypto");

const User = require("../models/user.model");
const BusinessWalletTransaction = require(
  "../models/businessWalletTransaction.model"
);


const makeBusinessId = (user) => {
  const name =
    String(user?.businessName || user?.fullName || "BUSINESS")
      .replace(/[^A-Za-z0-9]/g, "")
      .toUpperCase()
      .slice(0, 5)
      .padEnd(3, "X");

  const suffix = crypto
    .randomBytes(3)
    .toString("hex")
    .toUpperCase();

  return `SPB-${name}-${suffix}`;
};

const makeReference = () => {
  return `BW-${Date.now()}-${crypto
    .randomBytes(4)
    .toString("hex")
    .toUpperCase()}`;
};

const getUserId = (req) =>
  req.user?._id || req.user?.id;

const cleanAmount = (value) => {
  const amount = Number(value);

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    return null;
  }

  return Math.round(amount * 100) / 100;
};


/*
 * ============================================================
 * GET BUSINESS WALLET
 * ============================================================
 */
exports.getBusinessWallet = async (req, res) => {
  try {
    const userId = getUserId(req);

    const user = await User.findById(userId).select(
      "fullName phone email walletBalance businessWalletBalance businessWalletLockedBalance businessWalletId businessName"
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User account not found.",
      });
    }

    const transactions =
      await BusinessWalletTransaction.find({
        user: user._id,
      })
        .sort({
          createdAt: -1,
        })
        .limit(30)
        .lean();

    return res.status(200).json({
      success: true,

      businessProfile: {
        businessName: user.businessName || "",
        businessWalletId: user.businessWalletId || "",
      },

      wallet: {
        balance:
          Number(user.businessWalletBalance || 0),
        lockedBalance:
          Number(
            user.businessWalletLockedBalance || 0
          ),
        availableBalance:
          Math.max(
            0,
            Number(
              user.businessWalletBalance || 0
            ) -
              Number(
                user.businessWalletLockedBalance ||
                  0
              )
          ),
        personalWalletBalance:
          Number(user.walletBalance || 0),
      },

      transactions,
    });
  } catch (error) {
    console.error(
      "Get Business Wallet error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to load Business Wallet.",
    });
  }
};


/*
 * ============================================================
 * PERSONAL WALLET -> BUSINESS WALLET
 *
 * Both balances live on the same User document.
 * $inc therefore changes both balances atomically.
 * ============================================================
 */
exports.movePersonalToBusiness = async (
  req,
  res
) => {
  try {
    const userId = getUserId(req);
    const amount = cleanAmount(req.body?.amount);

    if (!amount) {
      return res.status(400).json({
        success: false,
        message:
          "Please enter a valid amount.",
      });
    }

    if (amount < 100) {
      return res.status(400).json({
        success: false,
        message:
          "Minimum amount is ₦100.",
      });
    }

    const before = await User.findById(
      userId
    ).select(
      "walletBalance businessWalletBalance"
    );

    if (!before) {
      return res.status(404).json({
        success: false,
        message: "User account not found.",
      });
    }

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
            businessWalletBalance: amount,
          },
        },
        {
          new: true,
          runValidators: true,
        }
      ).select(
        "walletBalance businessWalletBalance"
      );

    if (!updated) {
      return res.status(400).json({
        success: false,
        message:
          "Insufficient Personal Wallet balance.",
      });
    }

    const reference = makeReference();

    await BusinessWalletTransaction.create({
      user: userId,
      reference,
      type: "PERSONAL_TO_BUSINESS",
      direction: "CREDIT",
      amount,
      balanceBefore: Number(
        before.businessWalletBalance || 0
      ),
      balanceAfter: Number(
        updated.businessWalletBalance || 0
      ),
      status: "SUCCESSFUL",
      narration:
        "Transferred from Personal Wallet",
    });

    return res.status(200).json({
      success: true,
      message:
        "Business Wallet funded successfully.",
      reference,
      businessWalletBalance:
        updated.businessWalletBalance,
      personalWalletBalance:
        updated.walletBalance,
    });
  } catch (error) {
    console.error(
      "Personal to Business Wallet error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to fund Business Wallet.",
    });
  }
};


/*
 * ============================================================
 * BUSINESS WALLET -> PERSONAL WALLET
 * ============================================================
 */
exports.moveBusinessToPersonal = async (
  req,
  res
) => {
  try {
    const userId = getUserId(req);
    const amount = cleanAmount(req.body?.amount);

    if (!amount) {
      return res.status(400).json({
        success: false,
        message:
          "Please enter a valid amount.",
      });
    }

    if (amount < 100) {
      return res.status(400).json({
        success: false,
        message:
          "Minimum amount is ₦100.",
      });
    }

    const before = await User.findById(
      userId
    ).select(
      "walletBalance businessWalletBalance businessWalletLockedBalance"
    );

    if (!before) {
      return res.status(404).json({
        success: false,
        message: "User account not found.",
      });
    }

    const locked = Number(
      before.businessWalletLockedBalance || 0
    );

    const available =
      Number(
        before.businessWalletBalance || 0
      ) - locked;

    if (available < amount) {
      return res.status(400).json({
        success: false,
        message:
          "Insufficient Business Wallet balance.",
      });
    }

    /*
     * Condition also protects against concurrent debits.
     */
    const updated =
      await User.findOneAndUpdate(
        {
          _id: userId,
          businessWalletBalance: {
            $gte: amount + locked,
          },
        },
        {
          $inc: {
            businessWalletBalance: -amount,
            walletBalance: amount,
          },
        },
        {
          new: true,
          runValidators: true,
        }
      ).select(
        "walletBalance businessWalletBalance"
      );

    if (!updated) {
      return res.status(409).json({
        success: false,
        message:
          "Business Wallet balance changed. Please try again.",
      });
    }

    const reference = makeReference();

    await BusinessWalletTransaction.create({
      user: userId,
      reference,
      type: "BUSINESS_TO_PERSONAL",
      direction: "DEBIT",
      amount,
      balanceBefore: Number(
        before.businessWalletBalance || 0
      ),
      balanceAfter: Number(
        updated.businessWalletBalance || 0
      ),
      status: "SUCCESSFUL",
      narration:
        "Transferred to Personal Wallet",
    });

    return res.status(200).json({
      success: true,
      message:
        "Money moved to Personal Wallet successfully.",
      reference,
      businessWalletBalance:
        updated.businessWalletBalance,
      personalWalletBalance:
        updated.walletBalance,
    });
  } catch (error) {
    console.error(
      "Business to Personal Wallet error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to move money from Business Wallet.",
    });
  }
};


/*
 * ============================================================
 * SETUP / UPDATE BUSINESS WALLET IDENTITY
 * ============================================================
 */
exports.setupBusinessWalletIdentity = async (req, res) => {
  try {
    const userId = getUserId(req);

    const businessName =
      String(req.body?.businessName || "").trim();

    if (businessName.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid business name.",
      });
    }

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User account not found.",
      });
    }

    user.businessName = businessName;

    if (!user.businessWalletId) {
      let candidate = "";

      for (let attempt = 0; attempt < 20; attempt += 1) {
        candidate = makeBusinessId(user);

        const exists = await User.exists({
          businessWalletId: candidate,
          _id: { $ne: user._id },
        });

        if (!exists) {
          break;
        }

        candidate = "";
      }

      if (!candidate) {
        return res.status(500).json({
          success: false,
          message: "Unable to generate Business ID.",
        });
      }

      user.businessWalletId = candidate;
    }

    await user.save();

    return res.status(200).json({
      success: true,
      message: "Business profile saved successfully.",
      businessProfile: {
        businessName: user.businessName,
        businessWalletId: user.businessWalletId,
      },
    });
  } catch (error) {
    console.error(
      "Setup Business Wallet identity error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Unable to save business profile.",
    });
  }
};


/*
 * ============================================================
 * RESOLVE BUSINESS BENEFICIARY
 * ============================================================
 */
exports.resolveBusinessBeneficiary = async (req, res) => {
  try {
    const businessWalletId =
      String(req.body?.businessWalletId || "")
        .trim()
        .toUpperCase();

    if (!businessWalletId) {
      return res.status(400).json({
        success: false,
        message: "Business ID is required.",
      });
    }

    const business = await User.findOne({
      businessWalletId,
      status: "ACTIVE",
    }).select(
      "businessName businessWalletId fullName"
    );

    if (!business) {
      return res.status(404).json({
        success: false,
        message: "Business wallet not found.",
      });
    }

    return res.status(200).json({
      success: true,
      business: {
        businessName:
          business.businessName ||
          business.fullName ||
          "ServicePay Business",
        businessWalletId:
          business.businessWalletId,
      },
    });
  } catch (error) {
    console.error(
      "Resolve Business beneficiary error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Unable to resolve business wallet.",
    });
  }
};


/*
 * ============================================================
 * BUSINESS TO BUSINESS TRANSFER
 * ============================================================
 */
exports.transferBusinessToBusiness = async (req, res) => {
  try {
    const senderId = getUserId(req);

    const businessWalletId =
      String(req.body?.businessWalletId || "")
        .trim()
        .toUpperCase();

    const amount = cleanAmount(req.body?.amount);

    if (!businessWalletId) {
      return res.status(400).json({
        success: false,
        message: "Business ID is required.",
      });
    }

    if (!amount || amount < 100) {
      return res.status(400).json({
        success: false,
        message: "Minimum transfer amount is ₦100.",
      });
    }

    const sender = await User.findById(senderId).select(
      "businessWalletBalance businessWalletLockedBalance businessWalletId businessName"
    );

    if (!sender) {
      return res.status(404).json({
        success: false,
        message: "Sender account not found.",
      });
    }

    if (!sender.businessWalletId) {
      return res.status(400).json({
        success: false,
        message: "Please set up your Business Wallet profile first.",
      });
    }

    const beneficiary = await User.findOne({
      businessWalletId,
      status: "ACTIVE",
    }).select(
      "businessWalletBalance businessWalletId businessName fullName"
    );

    if (!beneficiary) {
      return res.status(404).json({
        success: false,
        message: "Beneficiary Business Wallet not found.",
      });
    }

    if (String(beneficiary._id) === String(sender._id)) {
      return res.status(400).json({
        success: false,
        message: "You cannot transfer to your own Business Wallet.",
      });
    }

    const locked = Number(
      sender.businessWalletLockedBalance || 0
    );

    const available =
      Number(sender.businessWalletBalance || 0) - locked;

    if (available < amount) {
      return res.status(400).json({
        success: false,
        message: "Insufficient Business Wallet balance.",
      });
    }

    const debit = await User.findOneAndUpdate(
      {
        _id: sender._id,
        businessWalletBalance: {
          $gte: amount + locked,
        },
      },
      {
        $inc: {
          businessWalletBalance: -amount,
        },
      },
      {
        new: true,
        runValidators: true,
      }
    ).select("businessWalletBalance");

    if (!debit) {
      return res.status(409).json({
        success: false,
        message:
          "Business Wallet balance changed. Please try again.",
      });
    }

    const credit = await User.findByIdAndUpdate(
      beneficiary._id,
      {
        $inc: {
          businessWalletBalance: amount,
        },
      },
      {
        new: true,
        runValidators: true,
      }
    ).select("businessWalletBalance");

    if (!credit) {
      await User.findByIdAndUpdate(sender._id, {
        $inc: {
          businessWalletBalance: amount,
        },
      });

      return res.status(500).json({
        success: false,
        message:
          "Transfer could not be completed. Your balance was restored.",
      });
    }

    const reference = makeReference();

    await BusinessWalletTransaction.create([
      {
        user: sender._id,
        reference: `${reference}-D`,
        type: "DEBIT",
        direction: "DEBIT",
        amount,
        balanceBefore: Number(
          sender.businessWalletBalance || 0
        ),
        balanceAfter: Number(
          debit.businessWalletBalance || 0
        ),
        status: "SUCCESSFUL",
        narration:
          `Transfer to ${
            beneficiary.businessName ||
            beneficiary.fullName ||
            beneficiary.businessWalletId
          }`,
        metadata: {
          counterpartyBusinessWalletId:
            beneficiary.businessWalletId,
        },
      },
      {
        user: beneficiary._id,
        reference: `${reference}-C`,
        type: "CREDIT",
        direction: "CREDIT",
        amount,
        balanceBefore:
          Number(credit.businessWalletBalance || 0) -
          amount,
        balanceAfter: Number(
          credit.businessWalletBalance || 0
        ),
        status: "SUCCESSFUL",
        narration:
          `Transfer from ${
            sender.businessName ||
            sender.businessWalletId
          }`,
        metadata: {
          counterpartyBusinessWalletId:
            sender.businessWalletId,
        },
      },
    ]);

    return res.status(200).json({
      success: true,
      message: "Business transfer successful.",
      reference,
      businessWalletBalance:
        debit.businessWalletBalance,
      beneficiary: {
        businessName:
          beneficiary.businessName ||
          beneficiary.fullName ||
          "ServicePay Business",
        businessWalletId:
          beneficiary.businessWalletId,
      },
    });
  } catch (error) {
    console.error(
      "Business to Business transfer error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Unable to complete business transfer.",
    });
  }
};
