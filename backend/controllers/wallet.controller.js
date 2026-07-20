const User = require("../models/user.model");
const Transfer = require("../models/transfer.model");
const Transaction = require("../models/transaction.model");

exports.getWallet = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;

    const user = await User.findById(userId).select(
      "fullName phone email walletBalance commissionBalance"
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Ba a samu user ba.",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        walletBalance: Number(user.walletBalance || 0),
        commissionBalance: Number(user.commissionBalance || 0),
        user: {
          id: user._id,
          fullName: user.fullName,
          phone: user.phone,
          email: user.email,
        },
      },
    });
  } catch (error) {
    console.log("GET WALLET ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "An samu matsala wajen ɗauko wallet.",
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
