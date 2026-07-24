const User = require("../models/user.model");
const Transfer = require("../models/transfer.model");
const Transaction = require("../models/transaction.model");

exports.getWallet = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Login session ba ta aiki. Ka sake shiga account.",
      });
    }

    const user = await User.findById(userId)
      .select("_id fullName phone email role status walletBalance")
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Ba a samu account din mai amfani ba.",
      });
    }

    if (String(user.status || "ACTIVE").toUpperCase() !== "ACTIVE") {
      return res.status(403).json({
        success: false,
        message: "An dakatar da wannan account.",
      });
    }

    const walletBalance = Number(user.walletBalance || 0);

    return res.status(200).json({
      success: true,
      walletBalance,
      balance: walletBalance,
      user: {
        id: user._id,
        _id: user._id,
        fullName: user.fullName,
        phone: user.phone,
        email: user.email,
        role: user.role,
        status: user.status,
        walletBalance,
      },
    });
  } catch (error) {
    console.error("GET WALLET ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "An samu matsala wajen dauko wallet.",
    });
  }
};

exports.getWalletHistory = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);

    const [transfers, transactions] = await Promise.all([
      Transfer.find({
        $or: [{ sender: userId }, { receiver: userId }],
      })
        .populate("sender", "fullName phone")
        .populate("receiver", "fullName phone")
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),
      Transaction.find({ customerId: userId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),
    ]);

    const transferItems = transfers.map((item) => {
      const isDebit = String(item.sender?._id || item.sender) === String(userId);
      const otherUser = isDebit ? item.receiver : item.sender;

      return {
        id: item._id,
        reference: item.reference,
        type: "TRANSFER",
        direction: isDebit ? "DEBIT" : "CREDIT",
        title: isDebit ? "ServicePay Transfer" : "Money Received",
        description: otherUser
          ? `${otherUser.fullName || "ServicePay user"} (${otherUser.phone || ""})`
          : "ServicePay user",
        amount: Number(item.amount || 0),
        status: item.status,
        createdAt: item.createdAt,
      };
    });

    const transactionItems = transactions.map((item) => ({
      id: item._id,
      reference: item.reference,
      type: item.serviceType,
      direction:
        item.serviceType === "WALLET_FUNDING" ? "CREDIT" : "DEBIT",
      title:
        item.serviceType === "WALLET_FUNDING"
          ? "Wallet Funding"
          : item.serviceType.replaceAll("_", " "),
      description: item.provider || item.phone || "ServicePay transaction",
      amount: Number(item.amount || 0),
      status: item.status,
      createdAt: item.createdAt,
    }));

    const history = [...transferItems, ...transactionItems]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);

    return res.status(200).json({
      success: true,
      data: history,
    });
  } catch (error) {
    console.log("GET WALLET HISTORY ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "An samu matsala wajen ɗauko transaction history.",
    });
  }
};
