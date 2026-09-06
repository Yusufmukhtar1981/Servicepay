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
    console.log("========== NEW SERVICEPAY TRANSFER ==========");
    console.log("Request body:", req.body);

    const senderId = req.user?._id;
    const receiverPhone = String(
      req.body.receiverPhone || ""
    ).trim();

    const transferAmount = Number(req.body.amount);

    // Validate authenticated user.
    if (!senderId) {
      return res.status(401).json({
        success: false,
        message: "Sai ka shiga account kafin ka yi transfer.",
      });
    }

    // Validate required fields.
    if (!receiverPhone || req.body.amount === undefined) {
      return res.status(400).json({
        success: false,
        message:
          "Receiver phone da amount suna da buƙata.",
      });
    }

    // Validate amount.
    if (
      !Number.isFinite(transferAmount) ||
      transferAmount <= 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Ka saka amount mai inganci.",
      });
    }

    // Prevent decimal values beyond two places.
    const amount = Math.round(
      (transferAmount + Number.EPSILON) * 100
    ) / 100;

    session.startTransaction();

    /*
     * Read the sender inside the MongoDB transaction.
     */
    const sender = await User.findById(senderId).session(
      session
    );

    if (!sender) {
      await session.abortTransaction();

      return res.status(404).json({
        success: false,
        message: "Ba a sami account ɗin sender ba.",
      });
    }

    if (sender.status !== "ACTIVE") {
      await session.abortTransaction();

      return res.status(403).json({
        success: false,
        message: "Account ɗinka ba ya aiki.",
      });
    }

    /*
     * Find receiver by phone number.
     */
    const receiver = await User.findOne({
      phone: receiverPhone,
    }).session(session);

    if (!receiver) {
      await session.abortTransaction();

      return res.status(404).json({
        success: false,
        message:
          "Ba a sami ServicePay user mai wannan phone number ba.",
      });
    }

    if (receiver.status !== "ACTIVE") {
      await session.abortTransaction();

      return res.status(403).json({
        success: false,
        message:
          "Account ɗin wanda za a tura wa kuɗin ba ya aiki.",
      });
    }

    /*
     * Prevent user from transferring to their own account.
     */
    if (
      sender._id.toString() === receiver._id.toString()
    ) {
      await session.abortTransaction();

      return res.status(400).json({
        success: false,
        message:
          "Ba za ka iya tura kuɗi zuwa account ɗinka ba.",
      });
    }

    /*
     * Check sender balance.
     */
    if (Number(sender.walletBalance) < amount) {
      await session.abortTransaction();

      return res.status(400).json({
        success: false,
        message:
          "Kuɗin wallet ɗinka bai isa yin wannan transfer ba.",
        data: {
          walletBalance: Number(
            sender.walletBalance || 0
          ),
          amount,
        },
      });
    }

    /*
     * Debit sender atomically.
     *
     * The walletBalance condition prevents a negative
     * balance if two transfer requests arrive together.
     */
    const updatedSender = await User.findOneAndUpdate(
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
          "Kuɗin wallet ɗinka bai isa ba, ko an kasa cire kuɗin.",
      });
    }

    /*
     * Credit receiver atomically.
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
        "An kasa saka kuɗi a wallet ɗin receiver."
      );
    }

    /*
     * Generate a unique transfer reference.
     */
    const reference = generateReference();

    /*
     * Save transfer history.
     */
    const transfers = await Transfer.create(
      [
        {
          sender: updatedSender._id,
          receiver: updatedReceiver._id,
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

    const savedTransfer = transfers[0];

    await session.commitTransaction();

    console.log("Transfer successful:", {
      reference,
      sender: updatedSender.phone,
      receiver: updatedReceiver.phone,
      amount,
    });

    return res.status(200).json({
      success: true,
      message: "Transfer successfully.",
      data: {
        transferId: savedTransfer._id,
        reference: savedTransfer.reference,
        status: savedTransfer.status,
        amount: savedTransfer.amount,

        sender: {
          id: updatedSender._id,
          fullName: updatedSender.fullName,
          phone: updatedSender.phone,
          walletBalance:
            updatedSender.walletBalance,
        },

        receiver: {
          id: updatedReceiver._id,
          fullName: updatedReceiver.fullName,
          phone: updatedReceiver.phone,
        },

        createdAt: savedTransfer.createdAt,
      },
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    console.log("TRANSFER ERROR:");
    console.log(error);

    /*
     * Handle a rare duplicate transfer-reference error.
     */
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message:
          "Transfer reference ya maimaitu. Ka sake gwadawa.",
      });
    }

    return res.status(500).json({
      success: false,
      message:
        error.message ||
        "An samu matsala yayin transfer.",
    });
  } finally {
    await session.endSession();
  }
};