const mongoose = require("mongoose");

const User = require("../models/user.model");
const AdminAuditLog = require(
  "../models/adminAuditLog.model"
);

const cleanRole = (value = "") =>
  String(value)
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");

const findCustomer = async (
  identifier,
  session
) => {
  const value = String(identifier || "").trim();

  if (!value) {
    return null;
  }

  const conditions = [
    { phone: value },
    { email: value.toLowerCase() },
  ];

  if (
    mongoose.Types.ObjectId.isValid(value)
  ) {
    conditions.push({
      _id: value,
    });
  }

  return User.findOne({
    $or: conditions,
  }).session(session);
};

exports.adjustCustomerWallet = async (
  req,
  res
) => {
  const session =
    await mongoose.startSession();

  try {
    const role =
      cleanRole(req.user?.role);

    if (role !== "HEAD_OFFICE") {
      return res.status(403).json({
        success: false,
        message:
          "Only Head Office can credit or debit customer wallets.",
      });
    }

    const identifier = String(
      req.body.identifier || ""
    ).trim();

    const action = String(
      req.body.action || ""
    )
      .trim()
      .toUpperCase();

    const amount =
      Number(req.body.amount);

    const reason = String(
      req.body.reason || ""
    ).trim();

    if (!identifier) {
      return res.status(400).json({
        success: false,
        message:
          "Enter customer phone, email or user ID.",
      });
    }

    if (
      action !== "CREDIT" &&
      action !== "DEBIT"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Action must be CREDIT or DEBIT.",
      });
    }

    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Enter a valid amount greater than zero.",
      });
    }

    if (reason.length < 5) {
      return res.status(400).json({
        success: false,
        message:
          "Enter a clear reason containing at least 5 characters.",
      });
    }

    session.startTransaction();

    const customer =
      await findCustomer(
        identifier,
        session
      );

    if (!customer) {
      await session.abortTransaction();

      return res.status(404).json({
        success: false,
        message:
          "Customer account was not found.",
      });
    }

    const balanceBefore =
      Number(
        customer.walletBalance || 0
      );

    let updatedCustomer;

    if (action === "DEBIT") {
      updatedCustomer =
        await User.findOneAndUpdate(
          {
            _id: customer._id,

            walletBalance: {
              $gte: amount,
            },
          },
          {
            $inc: {
              walletBalance:
                -amount,
            },
          },
          {
            new: true,
            session,
          }
        );

      if (!updatedCustomer) {
        await session.abortTransaction();

        return res.status(400).json({
          success: false,
          code:
            "INSUFFICIENT_WALLET_BALANCE",
          message:
            "Customer wallet does not have enough balance for this debit.",
          walletBalance:
            balanceBefore,
        });
      }
    } else {
      updatedCustomer =
        await User.findByIdAndUpdate(
          customer._id,
          {
            $inc: {
              walletBalance:
                amount,
            },
          },
          {
            new: true,
            session,
          }
        );
    }

    const balanceAfter =
      Number(
        updatedCustomer
          ?.walletBalance || 0
      );

    await AdminAuditLog.create(
      [
        {
          actorId:
            req.user._id,

          actorRole:
            "HEAD_OFFICE",

          actorName:
            req.user.fullName ||
            req.user.name ||
            "Head Office",

          targetUserId:
            customer._id,

          targetUserName:
            customer.fullName ||
            customer.name ||
            customer.phone,

          action:
            action === "CREDIT"
              ? "CUSTOMER_WALLET_CREDIT"
              : "CUSTOMER_WALLET_DEBIT",

          reason,

          previousData: {
            walletBalance:
              balanceBefore,
          },

          newData: {
            walletBalance:
              balanceAfter,
          },

          metadata: {
            amount,
            adjustmentType:
              action,
          },

          requestMethod:
            req.method,

          requestPath:
            req.originalUrl,

          status:
            "SUCCESSFUL",
        },
      ],
      {
        session,
      }
    );

    await session.commitTransaction();

    return res.status(200).json({
      success: true,

      message:
        action === "CREDIT"
          ? `Customer wallet credited with ₦${amount.toFixed(2)} successfully.`
          : `Customer wallet debited by ₦${amount.toFixed(2)} successfully.`,

      customer: {
        id:
          updatedCustomer._id,

        fullName:
          updatedCustomer.fullName,

        phone:
          updatedCustomer.phone,

        email:
          updatedCustomer.email,

        walletBalance:
          balanceAfter,
      },

      adjustment: {
        action,
        amount,
        balanceBefore,
        balanceAfter,
        reason,
      },
    });
  } catch (error) {
    if (
      session.inTransaction()
    ) {
      await session.abortTransaction();
    }

    console.error(
      "Admin wallet adjustment error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to adjust customer wallet.",
      error:
        error.message,
    });
  } finally {
    await session.endSession();
  }
};
