const mongoose = require("mongoose");

const User = require("../models/user.model");
const WithdrawalRequest = require(
  "../models/withdrawalRequest.model"
);
const AppSettings = require(
  "../models/appSettings.model"
);
const {
  postDebit,
  postCredit,
} = require("../services/ledger.service");
const {
  verifyTransactionPin,
} = require("../services/transactionPin.service");

const getUserId = (req) =>
  req.user?._id ||
  req.user?.id;

const makeReference = () =>
  `WDR-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)
    .toUpperCase()}`;

const getIdempotencyKey = (req) =>
  String(
    req.get?.("Idempotency-Key") ||
      req.body?.idempotencyKey ||
      ""
  )
    .trim()
    .slice(0, 128);

const getWithdrawalLimits = async () => {
  const settings =
    await AppSettings.getGlobalSettings();
  const limits =
    settings?.transactionLimits || {};

  return {
    minimum: Math.max(
      100,
      Number(
        limits.minimumBankTransfer ||
          100
      )
    ),
    maximum: Math.max(
      100,
      Number(
        limits.maximumBankTransfer ||
          50000
      )
    ),
  };
};

exports.createWithdrawal = async (
  req,
  res
) => {
  const session =
    await mongoose.startSession();

  try {
    let result = null;
    const userId = getUserId(req);
    // PIN admission maintains durable security state outside financial
    // transactions. Verify before opening the wallet transaction so its
    // reservation cannot be rolled back or cause a transaction retry loop.
    await verifyTransactionPin(
      userId,
      String(req.body?.transactionPin || "").trim()
    );
    const idempotencyKey =
      getIdempotencyKey(req);
    const limits =
      await getWithdrawalLimits();

    if (!idempotencyKey) {
      return res.status(400).json({
        success: false,
        code:
          "IDEMPOTENCY_KEY_REQUIRED",
        message:
          "A withdrawal request key is required. Please try again.",
      });
    }

    await session.withTransaction(
      async () => {
        const rawAmount =
          Number(req.body?.amount);
        const amountInKobo =
          Math.round(
            (
              rawAmount +
              Number.EPSILON
            ) * 100
          );
        const amount =
          amountInKobo / 100;

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
          !Number.isFinite(rawAmount) ||
          amount < limits.minimum
        ) {
          const error = new Error(
            `Minimum withdrawal is ₦${limits.minimum.toLocaleString("en-NG")}.`
          );

          error.statusCode = 400;
          throw error;
        }

        if (
          Math.abs(
            rawAmount * 100 -
              amountInKobo
          ) > 1e-8
        ) {
          const error = new Error(
            "Withdrawal amount cannot have more than two decimal places."
          );

          error.statusCode = 400;
          throw error;
        }

        if (amount > limits.maximum) {
          const error = new Error(
            `Maximum withdrawal is ₦${limits.maximum.toLocaleString("en-NG")}.`
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

        const existing =
          await WithdrawalRequest.findOne({
            user: userId,
            idempotencyKey,
          }).session(session);

        if (existing) {
          const duplicateUser =
            await User.findById(userId)
              .select(
                "walletBalance withdrawalLockedBalance"
              )
              .session(session);

          result = {
            withdrawal: existing,
            walletBalance:
              duplicateUser?.walletBalance,
            withdrawalLockedBalance:
              duplicateUser
                ?.withdrawalLockedBalance,
            duplicate: true,
          };
          return;
        }

        const user =
          await User.findById(userId)
            .select("walletBalance withdrawalLockedBalance")
            .session(session);

        if (!user) {
          const error = new Error(
            "User not found."
          );

          error.statusCode = 404;
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

        const reference =
          makeReference();
        const created =
          await WithdrawalRequest.create(
            [
              {
                reference:
                  reference,
                user: user._id,
                idempotencyKey,
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

        const ledger =
          await postDebit({
            userId: user._id,
            amount,
            openingBalance:
              Number(
                debited.walletBalance
              ) + amount,
            closingBalance:
              debited.walletBalance,
            service:
              "WITHDRAWAL_HOLD",
            reference,
            idempotencyKey:
              `withdrawal:${created[0]._id}:hold`,
            narration:
              `Withdrawal request to ${bankName} • ${accountNumber.slice(-4)}`,
            metadata: {
              withdrawalRequestId:
                String(created[0]._id),
              bankName,
              accountNumberLast4:
                accountNumber.slice(-4),
            },
            session,
          });

        created[0].balanceAfter =
          debited.walletBalance;
        created[0].debitLedgerEntry =
          ledger.entry._id;
        await created[0].save({
          session,
        });

        result = {
          withdrawal:
            created[0],
          walletBalance:
            debited.walletBalance,
          withdrawalLockedBalance:
            debited
              .withdrawalLockedBalance,
          duplicate: false,
        };
      }
    );

    return res
      .status(
        result?.duplicate ? 200 : 201
      )
      .json({
      success: true,
      message:
        result?.duplicate
          ? "This withdrawal request was already submitted."
          : "Withdrawal request submitted for approval.",
      ...result,
    });
  } catch (error) {
    if (
      error?.code === 11000
    ) {
      const existing =
        await WithdrawalRequest.findOne({
          user: getUserId(req),
          idempotencyKey:
            getIdempotencyKey(req),
        });

      if (existing) {
        const user =
          await User.findById(
            getUserId(req)
          ).select(
            "walletBalance withdrawalLockedBalance"
          );

        return res.status(200).json({
          success: true,
          message:
            "This withdrawal request was already submitted.",
          withdrawal: existing,
          walletBalance:
            user?.walletBalance,
          withdrawalLockedBalance:
            user
              ?.withdrawalLockedBalance,
          duplicate: true,
        });
      }
    }

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
    const payoutReference =
      String(
        req.body?.payoutReference || ""
      ).trim();

    if (
      !payoutReference ||
      payoutReference.length > 120
    ) {
      return res.status(400).json({
        success: false,
        message:
          "A valid bank payout reference is required.",
      });
    }

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
          payoutReference;

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

        const refundLedger =
          await postCredit({
            userId: item.user,
            amount: item.amount,
            openingBalance:
              Number(
                updatedUser.walletBalance
              ) - item.amount,
            closingBalance:
              updatedUser.walletBalance,
            service:
              "WITHDRAWAL_REFUND",
            reference:
              item.reference,
            idempotencyKey:
              `withdrawal:${item._id}:refund`,
            narration:
              "Rejected withdrawal refund",
            metadata: {
              withdrawalRequestId:
                String(item._id),
            },
            session,
          });

        item.status = "REJECTED";
        item.rejectedAt = new Date();
        item.rejectedBy =
          getUserId(req);
        item.adminNote =
          String(
            req.body?.adminNote || ""
          ).trim();
        item.refundLedgerEntry =
          refundLedger.entry._id;
        item.balanceAfter =
          updatedUser.walletBalance;

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
