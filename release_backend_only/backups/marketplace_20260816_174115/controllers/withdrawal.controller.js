const mongoose = require("mongoose");

const User = require("../models/user.model");
const WithdrawalRequest = require(
  "../models/withdrawalRequest.model"
);

const getUserId = (req) =>
  req.user?._id ||
  req.user?.id;

const makeReference = () =>
  `WDR-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)
    .toUpperCase()}`;

exports.createWithdrawal = async (
  req,
  res
) => {
  const session =
    await mongoose.startSession();

  try {
    let result = null;

    await session.withTransaction(
      async () => {
        const amount =
          Number(req.body?.amount);

        const bankName =
          String(
            req.body?.bankName || ""
          ).trim();

        const accountNumber =
          String(
            req.body?.accountNumber || ""
          ).trim();

        const accountName =
          String(
            req.body?.accountName || ""
          ).trim();

        const pin =
          String(
            req.body?.transactionPin || ""
          ).trim();

        if (
          !Number.isFinite(amount) ||
          amount < 100
        ) {
          const error = new Error(
            "Minimum withdrawal is ₦100."
          );

          error.statusCode = 400;
          throw error;
        }

        if (
          !bankName ||
          !accountName ||
          !/^\d{10}$/.test(accountNumber)
        ) {
          const error = new Error(
            "Enter valid bank account details."
          );

          error.statusCode = 400;
          throw error;
        }

        const user =
          await User.findById(
            getUserId(req)
          )
            .select(
              "+transactionPin transactionPinSet walletBalance withdrawalLockedBalance"
            )
            .session(session);

        if (!user) {
          const error = new Error(
            "User not found."
          );

          error.statusCode = 404;
          throw error;
        }

        if (
          user.transactionPinSet !== true ||
          !user.transactionPin
        ) {
          const error = new Error(
            "Please create your transaction PIN first."
          );

          error.statusCode = 400;
          error.code =
            "TRANSACTION_PIN_NOT_SET";
          throw error;
        }

        if (!/^\d{4}$/.test(pin)) {
          const error = new Error(
            "Enter your 4-digit transaction PIN."
          );

          error.statusCode = 400;
          throw error;
        }

        const pinCorrect =
          await user.compareTransactionPin(
            pin
          );

        if (!pinCorrect) {
          const error = new Error(
            "Incorrect transaction PIN."
          );

          error.statusCode = 401;
          throw error;
        }

        const debited =
          await User.findOneAndUpdate(
            {
              _id: user._id,
              walletBalance: {
                $gte: amount,
              },
            },
            {
              $inc: {
                walletBalance: -amount,
                withdrawalLockedBalance:
                  amount,
              },
            },
            {
              new: true,
              session,
            }
          );

        if (!debited) {
          const error = new Error(
            "Insufficient wallet balance."
          );

          error.statusCode = 400;
          throw error;
        }

        const created =
          await WithdrawalRequest.create(
            [
              {
                reference:
                  makeReference(),
                user: user._id,
                amount,
                bankName,
                accountNumber,
                accountName,
                status: "PENDING",
              },
            ],
            {
              session,
            }
          );

        result = {
          withdrawal:
            created[0],
          walletBalance:
            debited.walletBalance,
          withdrawalLockedBalance:
            debited
              .withdrawalLockedBalance,
        };
      }
    );

    return res.status(201).json({
      success: true,
      message:
        "Withdrawal request submitted for approval.",
      ...result,
    });
  } catch (error) {
    console.error(
      "CREATE WITHDRAWAL ERROR:",
      error
    );

    return res
      .status(error.statusCode || 500)
      .json({
        success: false,
        code:
          error.code ||
          "WITHDRAWAL_FAILED",
        message:
          error.message ||
          "Unable to create withdrawal request.",
      });
  } finally {
    await session.endSession();
  }
};

exports.myWithdrawals = async (
  req,
  res
) => {
  try {
    const items =
      await WithdrawalRequest.find({
        user: getUserId(req),
      }).sort({
        createdAt: -1,
      });

    return res.json({
      success: true,
      withdrawals: items,
    });
  } catch (_) {
    return res.status(500).json({
      success: false,
      message:
        "Unable to load withdrawals.",
    });
  }
};

exports.adminWithdrawals = async (
  req,
  res
) => {
  try {
    const status =
      String(
        req.query?.status || ""
      )
        .trim()
        .toUpperCase();

    const filter = {};

    if (
      [
        "PENDING",
        "APPROVED",
        "REJECTED",
      ].includes(status)
    ) {
      filter.status = status;
    }

    const items =
      await WithdrawalRequest.find(
        filter
      )
        .populate(
          "user",
          "fullName phone email walletBalance withdrawalLockedBalance"
        )
        .sort({
          createdAt: -1,
        });

    return res.json({
      success: true,
      withdrawals: items,
    });
  } catch (_) {
    return res.status(500).json({
      success: false,
      message:
        "Unable to load withdrawal requests.",
    });
  }
};

exports.approveWithdrawal = async (
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
          await WithdrawalRequest.findOne({
            _id: req.params.id,
            status: "PENDING",
          }).session(session);

        if (!item) {
          const error = new Error(
            "Pending withdrawal request not found."
          );

          error.statusCode = 404;
          throw error;
        }

        const updatedUser =
          await User.findOneAndUpdate(
            {
              _id: item.user,
              withdrawalLockedBalance: {
                $gte: item.amount,
              },
            },
            {
              $inc: {
                withdrawalLockedBalance:
                  -item.amount,
              },
            },
            {
              new: true,
              session,
            }
          );

        if (!updatedUser) {
          const error = new Error(
            "Locked withdrawal balance is inconsistent."
          );

          error.statusCode = 409;
          throw error;
        }

        item.status = "APPROVED";
        item.approvedAt = new Date();
        item.approvedBy =
          getUserId(req);
        item.adminNote =
          String(
            req.body?.adminNote || ""
          ).trim();
        item.payoutReference =
          String(
            req.body
              ?.payoutReference || ""
          ).trim();

        await item.save({
          session,
        });

        result = {
          withdrawal: item,
          user:
            updatedUser,
        };
      }
    );

    return res.json({
      success: true,
      message:
        "Withdrawal approved successfully.",
      ...result,
    });
  } catch (error) {
    return res
      .status(error.statusCode || 500)
      .json({
        success: false,
        message:
          error.message ||
          "Unable to approve withdrawal.",
      });
  } finally {
    await session.endSession();
  }
};

exports.rejectWithdrawal = async (
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
          await WithdrawalRequest.findOne({
            _id: req.params.id,
            status: "PENDING",
          }).session(session);

        if (!item) {
          const error = new Error(
            "Pending withdrawal request not found."
          );

          error.statusCode = 404;
          throw error;
        }

        const updatedUser =
          await User.findOneAndUpdate(
            {
              _id: item.user,
              withdrawalLockedBalance: {
                $gte: item.amount,
              },
            },
            {
              $inc: {
                withdrawalLockedBalance:
                  -item.amount,
                walletBalance:
                  item.amount,
              },
            },
            {
              new: true,
              session,
            }
          );

        if (!updatedUser) {
          const error = new Error(
            "Locked withdrawal balance is inconsistent."
          );

          error.statusCode = 409;
          throw error;
        }

        item.status = "REJECTED";
        item.rejectedAt = new Date();
        item.rejectedBy =
          getUserId(req);
        item.adminNote =
          String(
            req.body?.adminNote || ""
          ).trim();

        await item.save({
          session,
        });

        result = {
          withdrawal: item,
          user:
            updatedUser,
        };
      }
    );

    return res.json({
      success: true,
      message:
        "Withdrawal rejected and wallet refunded.",
      ...result,
    });
  } catch (error) {
    return res
      .status(error.statusCode || 500)
      .json({
        success: false,
        message:
          error.message ||
          "Unable to reject withdrawal.",
      });
  } finally {
    await session.endSession();
  }
};
