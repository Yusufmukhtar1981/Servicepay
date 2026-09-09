const User = require("../models/user.model");

const getLoggedInUserId = (req) => {
  return (
    req.user?._id ||
    req.user?.id ||
    req.userId ||
    null
  );
};

/*
 * Check whether the logged-in user
 * has already created a transaction PIN.
 */
exports.getTransactionPinStatus = async (
  req,
  res
) => {
  try {
    const userId = getLoggedInUserId(req);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    const user = await User.findById(
      userId
    ).select("transactionPinSet");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User account not found.",
      });
    }

    return res.status(200).json({
      success: true,
      transactionPinSet:
        user.transactionPinSet === true,
    });
  } catch (error) {
    console.error(
      "Get transaction PIN status error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to check transaction PIN status.",
    });
  }
};

/*
 * Create a transaction PIN.
 */
exports.createTransactionPin = async (
  req,
  res
) => {
  try {
    const userId = getLoggedInUserId(req);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    const pin = String(
      req.body.pin || ""
    ).trim();

    const confirmPin = String(
      req.body.confirmPin || ""
    ).trim();

    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({
        success: false,
        message:
          "Transaction PIN must contain exactly 4 digits.",
      });
    }

    if (pin !== confirmPin) {
      return res.status(400).json({
        success: false,
        message:
          "Transaction PINs do not match.",
      });
    }

    const user = await User.findById(
      userId
    ).select(
      "+transactionPin transactionPinSet"
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User account not found.",
      });
    }

    if (
      user.transactionPinSet ||
      user.transactionPin
    ) {
      return res.status(409).json({
        success: false,
        message:
          "Transaction PIN has already been created.",
      });
    }

    user.setTransactionPin(pin);

    await user.save();

    return res.status(201).json({
      success: true,
      message:
        "Transaction PIN created successfully.",
      transactionPinSet: true,
    });
  } catch (error) {
    console.error(
      "Create transaction PIN error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error.message ||
        "Unable to create transaction PIN.",
    });
  }
};

/*
 * Verify transaction PIN.
 */
exports.verifyTransactionPin = async (
  req,
  res
) => {
  try {
    const userId = getLoggedInUserId(req);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    const pin = String(
      req.body.pin || ""
    ).trim();

    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({
        success: false,
        message:
          "Enter a valid 4-digit transaction PIN.",
      });
    }

    const user = await User.findById(
      userId
    ).select(
      "+transactionPin transactionPinSet"
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User account not found.",
      });
    }

    if (
      !user.transactionPinSet ||
      !user.transactionPin
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Please create your transaction PIN first.",
      });
    }

    const pinIsCorrect =
      await user.compareTransactionPin(
        pin
      );

    if (!pinIsCorrect) {
      return res.status(401).json({
        success: false,
        message:
          "Incorrect transaction PIN.",
      });
    }

    return res.status(200).json({
      success: true,
      message:
        "Transaction PIN verified successfully.",
    });
  } catch (error) {
    console.error(
      "Verify transaction PIN error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to verify transaction PIN.",
    });
  }
};

/*
 * Change an existing transaction PIN.
 */
exports.changeTransactionPin = async (
  req,
  res
) => {
  try {
    const userId = getLoggedInUserId(req);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    const currentPin = String(
      req.body.currentPin || ""
    ).trim();

    const newPin = String(
      req.body.newPin || ""
    ).trim();

    const confirmNewPin = String(
      req.body.confirmNewPin || ""
    ).trim();

    if (!/^\d{4}$/.test(currentPin)) {
      return res.status(400).json({
        success: false,
        message:
          "Enter your current 4-digit transaction PIN.",
      });
    }

    if (!/^\d{4}$/.test(newPin)) {
      return res.status(400).json({
        success: false,
        message:
          "New transaction PIN must contain exactly 4 digits.",
      });
    }

    if (newPin !== confirmNewPin) {
      return res.status(400).json({
        success: false,
        message:
          "New transaction PINs do not match.",
      });
    }

    if (currentPin === newPin) {
      return res.status(400).json({
        success: false,
        message:
          "New transaction PIN must be different from the current PIN.",
      });
    }

    const user = await User.findById(
      userId
    ).select(
      "+transactionPin transactionPinSet"
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User account not found.",
      });
    }

    if (
      !user.transactionPinSet ||
      !user.transactionPin
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Please create your transaction PIN first.",
      });
    }

    const currentPinIsCorrect =
      await user.compareTransactionPin(
        currentPin
      );

    if (!currentPinIsCorrect) {
      return res.status(401).json({
        success: false,
        message:
          "Current transaction PIN is incorrect.",
      });
    }

    user.setTransactionPin(newPin);

    await user.save();

    return res.status(200).json({
      success: true,
      message:
        "Transaction PIN changed successfully.",
      transactionPinSet: true,
    });
  } catch (error) {
    console.error(
      "Change transaction PIN error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error.message ||
        "Unable to change transaction PIN.",
    });
  }
};