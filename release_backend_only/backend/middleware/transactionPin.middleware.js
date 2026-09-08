const {
  verifyTransactionPin,
} = require("../services/transactionPin.service");

const requireTransactionPin = async (req, res, next) => {
  try {
    const transactionPin = String(
      req.body?.transactionPin ?? req.body?.pin ?? ""
    ).trim();

    if (!/^\d{4}$/.test(transactionPin)) {
      return res.status(400).json({
        success: false,
        code: "TRANSACTION_PIN_REQUIRED",
        message:
          "Enter your valid 4-digit Transaction PIN.",
      });
    }

    const userId = req.user?._id || req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    await verifyTransactionPin(userId, transactionPin);

    delete req.body.transactionPin;
    delete req.body.pin;

    return next();
  } catch (error) {
    console.error(
      "TRANSACTION PIN VERIFICATION ERROR:",
      error
    );

    return res.status(error.statusCode || 500).json({
      success: false,
      code: error.code,
      message:
        error.statusCode
          ? error.message
          : "Unable to verify Transaction PIN.",
    });
  }
};

module.exports = {
  requireTransactionPin,
};
