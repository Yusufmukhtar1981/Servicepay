const mongoose = require("mongoose");
const User = require("../models/user.model");
const Transfer = require("../models/transfer.model");

exports.transfer = async (req, res) => {
  console.log("========== NEW TRANSFER CONTROLLER ==========");
  console.log("BODY:", req.body);
  console.log("USER:", req.user);

  const session = await mongoose.startSession();

  try {
    const senderId = req.user?._id;
    const receiverPhone = String(
      req.body.receiverPhone || ""
    ).trim();

    const transferAmount = Number(req.body.amount);

    if (!senderId) {
      return res.status(401).json({
        success: false,
        message: "Ba a gane account ɗin mai turawa ba. Ka sake login.",
      });
    }

    if (!receiverPhone || req.body.amount === undefined) {
      return res.status(400).json({
        success: false,
        message: "Receiver phone da amount suna da bukata.",
      });
    }

    if (!Number.isFinite(transferAmount) || transferAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Ka saka amount mai inganci.",
      });
    }

    await session.withTransaction(async () => {
      const sender = await User.findById(senderId).session(session);

      if (!sender) {
        const error = new Error("Ba a samu account ɗin mai turawa ba.");
        error.statusCode = 404;
        throw error;
      }

      const receiver = await User.findOne({
        phone: receiverPhone,
      }).session(session);

      if (!receiver) {
        const error = new Error(
          "Ba a samu mai amfani da wannan phone number ba."
        );
        error.statusCode = 404;
        throw error;
      }

      if (sender._id.toString() === receiver._id.toString()) {
        const error = new Error(
          "Ba za ka iya tura kuɗi zuwa account ɗinka ba."
        );
        error.statusCode = 400;
        throw error;
      }

      const senderBalance = Number(sender.walletBalance || 0);

      if (senderBalance < transferAmount) {
        const error = new Error(
          "Ba ka da isasshen kuɗi a wallet."
        );
        error.statusCode = 400;
        throw error;
      }

      sender.walletBalance = senderBalance - transferAmount;

      receiver.walletBalance =
        Number(receiver.walletBalance || 0) + transferAmount;

      await sender.save({ session });
      await receiver.save({ session });

      await Transfer.create(
        [
          {
            sender: sender._id,
            receiver: receiver._id,
            receiverPhone: receiver.phone,
            amount: transferAmount,
            status: "successful",
          },
        ],
        { session }
      );
    });

    const updatedSender = await User.findById(senderId);

    return res.status(200).json({
      success: true,
      message: "An tura kuɗi cikin nasara.",
      walletBalance: updatedSender.walletBalance,
    });
  } catch (error) {
    console.error("TRANSFER ERROR:", error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message:
        error.message || "An samu matsala wajen tura kuɗi.",
    });
  } finally {
    await session.endSession();
  }
};