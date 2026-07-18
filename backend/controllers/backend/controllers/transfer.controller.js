const mongoose = require("mongoose");
const User = require("../models/user.model");
const Transfer = require("../models/transfer.model");

exports.transfer = async (req, res) => {
  console.log("Transfer request:", req.body);

  const session = await mongoose.startSession();

  try {
    const { receiverPhone, amount } = req.body;
    const transferAmount = Number(amount);

    if (!receiverPhone || !amount) {
      return res.status(400).json({
        success: false,
        message: "Receiver phone da amount suna da bukata.",
      });
    }

    session.startTransaction();

    const sender = await User.findById(req.user._id).session(session);

    const receiver = await User.findOne({
      phone: receiverPhone,
    }).session(session);

    if (!receiver) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Ba a sami mai wannan phone number ba.",
      });
    }

    if (sender.walletBalance < transferAmount) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Babu isasshen kudi a wallet.",
      });
    }

    sender.walletBalance -= transferAmount;
    receiver.walletBalance += transferAmount;

    await sender.save({ session });
    await receiver.save({ session });

    const reference =
      "SP" + Date.now() + Math.floor(Math.random() * 1000);

    await Transfer.create(
      [{
        sender: sender._id,
        receiver: receiver._id,
        amount: transferAmount,
        reference,
        status: "SUCCESSFUL",
        senderBalanceAfter: sender.walletBalance,
        receiverBalanceAfter: receiver.walletBalance,
      }],
      { session }
    );

    await session.commitTransaction();

    return res.status(200).json({
      success: true,
      message: "An tura kudi cikin nasara.",
      walletBalance: sender.walletBalance,
      reference,
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    console.error(error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  } finally {
    await session.endSession();
  }
};