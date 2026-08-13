const User = require("../models/user.model");

const requireTransactionPin = async (req, res, next) => {
  try {
    const transactionPin = String(
      req.body?.transactionPin || ""
    ).trim();

    if (!/^\d{4}$/.test(transactionPin)) {
      return res.status(400).json({
        success: false,
        code: "TRANSACTION_PIN_REQUIRED",
        message:
          "Enter your valid 4-digit Transaction PIN.",
      });
    }

    const userId =
      req.user?._id ||
      req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    const user = await User.findById(userId)
      .select("+transactionPin transactionPinSet");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Customer account not found.",
      });
    }

    if (
      user.transactionPinSet !== true ||
      !user.transactionPin
    ) {
      return res.status(409).json({
        success: false,
        code: "TRANSACTION_PIN_NOT_SET",
        message:
          "Please set your Transaction PIN before making this transaction.",
      });
    }

    if (
      typeof user.compareTransactionPin !== "function"
    ) {
      return res.status(500).json({
        success: false,
        message:
          "Transaction PIN verification is unavailable.",
      });
    }

    const isCorrect =
      await user.compareTransactionPin(
        transactionPin
      );

    if (!isCorrect) {
      return res.status(401).json({
        success: false,
        code: "INCORRECT_TRANSACTION_PIN",
        message:
          "Incorrect Transaction PIN.",
      });
    }

    delete req.body.transactionPin;

    return next();
  } catch (error) {
    console.error(
      "TRANSACTION PIN VERIFICATION ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to verify Transaction PIN.",
    });
  }
};

module.exports = {
  requireTransactionPin,
};
