const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");

exports.getWallet = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const user = await User.findById(userId).select(
      "fullName name phone email walletBalance"
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User account was not found.",
      });
    }

    let transactions = [];

    try {
      transactions = await Transaction.find({
        $or: [
          { user: userId },
          { userId },
          { sender: userId },
          { receiver: userId },
        ],
      })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean();
    } catch (transactionError) {
      console.error(
        "Wallet transaction loading error:",
        transactionError.message
      );

      transactions = [];
    }

    return res.status(200).json({
      success: true,
      message: "Wallet loaded successfully.",
      walletBalance: Number(user.walletBalance || 0),
      user: {
        id: user._id,
        fullName:
          user.fullName ||
          user.name ||
          "Servicepay Customer",
        phone: user.phone || "",
        email: user.email || "",
        walletBalance: Number(user.walletBalance || 0),
      },
      transactions,
    });
  } catch (error) {
    console.error("Get wallet error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to load wallet.",
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined,
    });
  }
};