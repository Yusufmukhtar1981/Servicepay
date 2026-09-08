const mongoose = require("mongoose");

const {
  postDebit,
  postCredit,
} = require("../services/ledger.service");

const crypto = require("crypto");

const User = require("../models/user.model");
const Transfer = require("../models/transfer.model");
const Transaction = require(
  "../models/transaction.model"
);

const generateReference = () => {
  return `SPT-${Date.now()}-${crypto
    .randomBytes(4)
    .toString("hex")
    .toUpperCase()}`;
};

/*
 * Check a beneficiary before transfer.
 *
 * Only safe information is returned.
 */
exports.lookupBeneficiary = async (
  req,
  res
) => {
  try {
    const senderId =
      req.user?._id ||
      req.user?.id ||
      req.userId;

    const receiverPhone = String(
      req.params.phone || ""
    ).trim();

    if (!senderId) {
      return res.status(401).json({
        success: false,
        message:
          "Please sign in before checking a beneficiary.",
      });
    }

    if (!/^\d{11}$/.test(receiverPhone)) {
      return res.status(400).json({
        success: false,
        message:
          "Enter a valid 11-digit phone number.",
      });
    }

    const receiver = await User.findOne({
      phone: receiverPhone,
    }).select(
      "_id fullName phone status"
    );

    if (!receiver) {
      return res.status(404).json({
        success: false,
        message:
          "No ServicePay user was found with this phone number.",
      });
    }

    const receiverStatus = String(
      receiver.status || ""
    )
      .trim()
      .toUpperCase();

    if (receiverStatus !== "ACTIVE") {
      return res.status(403).json({
        success: false,
        message:
          "The beneficiary account is not active.",
      });
    }

    if (
      receiver._id.toString() ===
      senderId.toString()
    ) {
      return res.status(400).json({
        success: false,
        message:
          "You cannot transfer money to your own account.",
      });
    }

    return res.status(200).json({
      success: true,
      message:
        "Beneficiary found successfully.",
      data: {
        beneficiary: {
          id: receiver._id,
          fullName: receiver.fullName,
          phone: receiver.phone,
        },
      },
    });
  } catch (error) {
    console.error(
      "Beneficiary lookup error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to verify the beneficiary.",
    });
  }
};

/*
 * ServicePay-to-ServicePay transfer.
 */
exports.transfer = async (
  req,
  res
) => {
  const session =
    await mongoose.startSession();

  try {
    console.log(
      "========== NEW SERVICEPAY TRANSFER =========="
    );

    const senderId =
      req.user?._id ||
      req.user?.id ||
      req.userId;

    const receiverPhone = String(
      req.body.receiverPhone || ""
    ).trim();

    const pin = String(
      req.body.pin || ""
    ).trim();

    const transferAmount = Number(
      req.body.amount
    );

    if (!senderId) {
      return res.status(401).json({
        success: false,
        message:
          "Please sign in before making a transfer.",
      });
    }

    if (
      !receiverPhone ||
      req.body.amount === undefined
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Recipient phone number and amount are required.",
      });
    }

    if (!/^\d{11}$/.test(receiverPhone)) {
      return res.status(400).json({
        success: false,
        message:
          "Enter a valid 11-digit recipient phone number.",
      });
    }

    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({
        success: false,
        message:
          "Enter your valid 4-digit transaction PIN.",
      });
    }

    if (
      !Number.isFinite(transferAmount) ||
      transferAmount <= 0
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Enter a valid transfer amount.",
      });
    }

    const amount =
      Math.round(
        (
          transferAmount +
          Number.EPSILON
        ) *
          100
      ) / 100;

    if (amount < 100) {
      return res.status(400).json({
        success: false,
        message:
          "Minimum transfer amount is ₦100.",
      });
    }

    session.startTransaction();

    /*
     * transactionPin has select:false.
     */
    const sender = await User.findById(
      senderId
    )
      .select("+transactionPin")
      .session(session);

    if (!sender) {
      await session.abortTransaction();

      return res.status(404).json({
        success: false,
        message:
          "Sender account was not found.",
      });
    }

    const senderStatus = String(
      sender.status || ""
    )
      .trim()
      .toUpperCase();

    if (senderStatus !== "ACTIVE") {
      await session.abortTransaction();

      return res.status(403).json({
        success: false,
        message:
          "Your account is not active.",
      });
    }

    if (
      sender.transactionPinSet !== true ||
      !sender.transactionPin
    ) {
      await session.abortTransaction();

      return res.status(400).json({
        success: false,
        code:
          "TRANSACTION_PIN_NOT_SET",
        message:
          "Please create your transaction PIN before making a transfer.",
      });
    }

    const pinIsCorrect =
      await sender.compareTransactionPin(
        pin
      );

    if (!pinIsCorrect) {
      await session.abortTransaction();

      return res.status(401).json({
        success: false,
        code:
          "INCORRECT_TRANSACTION_PIN",
        message:
          "Incorrect transaction PIN.",
      });
    }

    const receiver = await User.findOne({
      phone: receiverPhone,
    }).session(session);

    if (!receiver) {
      await session.abortTransaction();

      return res.status(404).json({
        success: false,
        message:
          "No ServicePay user was found with this phone number.",
      });
    }

    const receiverStatus = String(
      receiver.status || ""
    )
      .trim()
      .toUpperCase();

    if (receiverStatus !== "ACTIVE") {
      await session.abortTransaction();

      return res.status(403).json({
        success: false,
        message:
          "The beneficiary account is not active.",
      });
    }

    if (
      sender._id.toString() ===
      receiver._id.toString()
    ) {
      await session.abortTransaction();

      return res.status(400).json({
        success: false,
        message:
          "You cannot transfer money to your own account.",
      });
    }

    if (
      Number(sender.walletBalance || 0) <
      amount
    ) {
      await session.abortTransaction();

      return res.status(400).json({
        success: false,
        message:
          "Your wallet balance is insufficient for this transfer.",
        data: {
          walletBalance: Number(
            sender.walletBalance || 0
          ),
          amount,
        },
      });
    }

    /*
     * Debit sender.
     */
    const updatedSender =
      await User.findOneAndUpdate(
        {
          _id: sender._id,
          status: "ACTIVE",
          walletBalance: {
            $gte: amount,
          },
        },
        {
          $inc: {
            walletBalance: -amount,
            totalTransactions: 1,
          },
        },
        {
          new: true,
          session,
          runValidators: true,
        }
      );

    if (!updatedSender) {
      await session.abortTransaction();

      return res.status(400).json({
        success: false,
        message:
          "Your wallet balance is insufficient, or the debit could not be completed.",
      });
    }

    /*
     * Credit beneficiary.
     */
    const updatedReceiver =
      await User.findOneAndUpdate(
        {
          _id: receiver._id,
          status: "ACTIVE",
        },
        {
          $inc: {
            walletBalance: amount,
            totalTransactions: 1,
          },
        },
        {
          new: true,
          session,
          runValidators: true,
        }
      );

    if (!updatedReceiver) {
      throw new Error(
        "Unable to credit the beneficiary wallet."
      );
    }

    const reference =
      generateReference();

    /*
     * Save transfer record.
     */
    const transfers =
      await Transfer.create(
        [
          {
            sender:
              updatedSender._id,
            receiver:
              updatedReceiver._id,
            amount,
            reference,
            status: "SUCCESSFUL",
            senderBalanceAfter:
              updatedSender.walletBalance,
            receiverBalanceAfter:
              updatedReceiver.walletBalance,
          },
        ],
        {
          session,
        }
      );

    const savedTransfer =
      transfers[0];

    /*
     * Save sender transaction history.
     *
     * providerResponse contains receipt details.
     */
    const senderTransactions =
      await Transaction.create(
        [
          {
            reference,
            customerId:
              updatedSender._id,

            agentId:
              updatedSender.agentId ||
              null,

            stateManagerId:
              updatedSender
                .stateManagerId ||
              null,

            zonalManagerId:
              updatedSender
                .zonalManagerId ||
              null,

            serviceType: "TRANSFER",
            provider:
              "SERVICEPAY",

            phone:
              updatedReceiver.phone,

            amount,
            status: "SUCCESSFUL",

            providerResponse: {
              transactionDirection:
                "DEBIT",

              transferType:
                "SERVICEPAY_TO_SERVICEPAY",

              narration:
                `Transfer to ${updatedReceiver.fullName}`,

              sender: {
                id:
                  updatedSender._id,
                fullName:
                  updatedSender.fullName,
                phone:
                  updatedSender.phone,
                balanceAfter:
                  updatedSender
                    .walletBalance,
              },

              beneficiary: {
                id:
                  updatedReceiver._id,
                fullName:
                  updatedReceiver
                    .fullName,
                phone:
                  updatedReceiver.phone,
                balanceAfter:
                  updatedReceiver
                    .walletBalance,
              },

              transferId:
                savedTransfer._id,

              reference,
              amount,
              status:
                "SUCCESSFUL",

              receiptTitle:
                "ServicePay Transfer Receipt",
            },
          },
        ],
        {
          session,
        }
      );

    const savedTransaction =
      senderTransactions[0];

    /*
     * =====================================================
     * SERVICEPAY_CORE_LEDGER_TRANSFER_V1
     * =====================================================
     * Wallet debit + credit + ledger entries all live inside
     * the same MongoDB session.
     *
     * If any ledger write fails, the complete transfer rolls
     * back before commit.
     */

    const senderClosingBalance =
      Number(updatedSender.walletBalance);

    const senderOpeningBalance =
      Number(
        (
          senderClosingBalance +
          Number(amount)
        ).toFixed(2)
      );

    const receiverClosingBalance =
      Number(updatedReceiver.walletBalance);

    const receiverOpeningBalance =
      Number(
        (
          receiverClosingBalance -
          Number(amount)
        ).toFixed(2)
      );

    await postDebit({
      userId: updatedSender._id,
      amount,
      openingBalance:
        senderOpeningBalance,
      closingBalance:
        senderClosingBalance,
      service:
        "SERVICEPAY_TRANSFER",
      reference,
      idempotencyKey:
        `TRANSFER:${reference}:SENDER:DEBIT`,
      transactionId:
        savedTransaction._id,
      relatedUser:
        updatedReceiver._id,
      narration:
        `Transfer to ${updatedReceiver.fullName}`,
      metadata: {
        transferId:
          savedTransfer?._id
            ? String(savedTransfer._id)
            : null,
        senderPhone:
          updatedSender.phone,
        receiverPhone:
          updatedReceiver.phone,
        transferType:
          "SERVICEPAY_TO_SERVICEPAY",
      },
      session,
    });

    await postCredit({
      userId: updatedReceiver._id,
      amount,
      openingBalance:
        receiverOpeningBalance,
      closingBalance:
        receiverClosingBalance,
      service:
        "SERVICEPAY_TRANSFER",
      reference,
      idempotencyKey:
        `TRANSFER:${reference}:RECEIVER:CREDIT`,
      transactionId:
        savedTransaction._id,
      relatedUser:
        updatedSender._id,
      narration:
        `Transfer from ${updatedSender.fullName}`,
      metadata: {
        transferId:
          savedTransfer?._id
            ? String(savedTransfer._id)
            : null,
        senderPhone:
          updatedSender.phone,
        receiverPhone:
          updatedReceiver.phone,
        transferType:
          "SERVICEPAY_TO_SERVICEPAY",
      },
      session,
    });

    await session.commitTransaction();

    console.log(
      "ServicePay transfer successful:",
      {
        reference,
        sender:
          updatedSender.phone,
        receiver:
          updatedReceiver.phone,
        amount,
      }
    );

    return res.status(200).json({
      success: true,
      message:
        "Transfer completed successfully.",

      data: {
        transferId:
          savedTransfer._id,

        transactionId:
          savedTransaction._id,

        reference:
          savedTransfer.reference,

        status:
          savedTransfer.status,

        amount:
          savedTransfer.amount,

        sender: {
          id:
            updatedSender._id,
          fullName:
            updatedSender.fullName,
          phone:
            updatedSender.phone,
          walletBalance:
            updatedSender.walletBalance,
        },

        receiver: {
          id:
            updatedReceiver._id,
          fullName:
            updatedReceiver.fullName,
          phone:
            updatedReceiver.phone,
        },

        receipt: {
          title:
            "ServicePay Transfer Receipt",
          reference,
          status:
            "SUCCESSFUL",
          amount,
          senderName:
            updatedSender.fullName,
          senderPhone:
            updatedSender.phone,
          beneficiaryName:
            updatedReceiver.fullName,
          beneficiaryPhone:
            updatedReceiver.phone,
          createdAt:
            savedTransfer.createdAt,
        },

        createdAt:
          savedTransfer.createdAt,
      },
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    console.error(
      "ServicePay transfer error:",
      error
    );

    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message:
          "The transfer reference was duplicated. Please try again.",
      });
    }

    return res.status(500).json({
      success: false,
      message:
        error.message ||
        "An error occurred while processing the transfer.",
    });
  } finally {
    await session.endSession();
  }
};