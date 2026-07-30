const mongoose = require("mongoose");
const crypto = require("crypto");

const User = require("../models/user.model");
const Transfer = require("../models/transfer.model");

const generateReference = () => {
  return `SPT-${Date.now()}-${crypto
    .randomBytes(4)
    .toString("hex")
    .toUpperCase()}`;
};

exports.transfer = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    console.log(
      "========== NEW SERVICEPAY TRANSFER =========="
    );

    const senderId =
      req.user?._id || req.userId;

    const receiverPhone = String(
      req.body.receiverPhone || ""
    ).trim();

    const pin = String(
      req.body.pin || ""
    ).trim();

    const transferAmount = Number(
      req.body.amount
    );

    /*
     * Confirm authenticated sender.
     */
    if (!senderId) {
      return res.status(401).json({
        success: false,
        message:
          "Please sign in before making a transfer.",
      });
    }

    /*
     * Confirm required transfer information.
     */
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

    /*
     * Transaction PIN must contain exactly
     * four numbers.
     */
    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({
        success: false,
        message:
          "Enter your valid 4-digit transaction PIN.",
      });
    }

    /*
     * Validate transfer amount.
     */
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
        (transferAmount +
          Number.EPSILON) *
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
     * transactionPin uses select:false in
     * user.model.js, so it must be requested
     * explicitly with +transactionPin.
     */
    const sender = await User.findById(
      senderId
    )
      .select(
        "+transactionPin"
      )
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

    /*
     * Require the sender to create a
     * transaction PIN first.
     */
    if (
      sender.transactionPinSet !== true ||
      !sender.transactionPin
    ) {
      await session.abortTransaction();

      return res.status(400).json({
        success: false,
        code: "TRANSACTION_PIN_NOT_SET",
        message:
          "Please create your transaction PIN before making a transfer.",
      });
    }

    /*
     * Verify sender transaction PIN before
     * debiting or crediting any wallet.
     */
    const pinIsCorrect =
      await sender.compareTransactionPin(
        pin
      );

    if (!pinIsCorrect) {
      await session.abortTransaction();

      return res.status(401).json({
        success: false,
        code: "INCORRECT_TRANSACTION_PIN",
        message:
          "Incorrect transaction PIN.",
      });
    }

    /*
     * Find the recipient using their
     * registered ServicePay phone number.
     */
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
          "The recipient account is not active.",
      });
    }

    /*
     * Prevent customers from transferring
     * money to their own account.
     */
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

    /*
     * Confirm that the sender has enough
     * money in their wallet.
     */
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
     * Debit the sender atomically.
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
     * Credit the recipient atomically.
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
        "Unable to credit the recipient wallet."
      );
    }

    /*
     * Generate a unique transfer reference.
     */
    const reference =
      generateReference();

    /*
     * Save the successful transfer record.
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
        reference:
          savedTransfer.reference,
        status:
          savedTransfer.status,
        amount:
          savedTransfer.amount,

        sender: {
          id: updatedSender._id,
          fullName:
            updatedSender.fullName,
          phone:
            updatedSender.phone,
          walletBalance:
            updatedSender.walletBalance,
        },

        receiver: {
          id: updatedReceiver._id,
          fullName:
            updatedReceiver.fullName,
          phone:
            updatedReceiver.phone,
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