const crypto = require("crypto");

const User = require("../models/user.model");
const BusinessWalletTransaction = require(
  "../models/businessWalletTransaction.model"
);

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
      "fullName phone email walletBalance businessWalletBalance businessWalletLockedBalance"
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
