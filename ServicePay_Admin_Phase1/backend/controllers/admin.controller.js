const User = require("../models/user.model");
const Transfer = require("../models/transfer.model");
const Transaction = require("../models/transaction.model");

exports.getDashboard = async (req, res) => {
  try {
    const [
      totalUsers,
      activeUsers,
      blockedUsers,
      walletSummary,
      totalTransfers,
      transferSummary,
      transactionSummary,
      recentTransfers,
      recentTransactions,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ status: "ACTIVE" }),
      User.countDocuments({ status: { $in: ["BLOCKED", "SUSPENDED"] } }),
      User.aggregate([
        {
          $group: {
            _id: null,
            totalWalletBalance: { $sum: "$walletBalance" },
            totalCommissionBalance: { $sum: "$commissionBalance" },
          },
        },
      ]),
      Transfer.countDocuments(),
      Transfer.aggregate([
        { $match: { status: "SUCCESSFUL" } },
        { $group: { _id: null, totalAmount: { $sum: "$amount" } } },
      ]),
      Transaction.aggregate([
        { $match: { status: "SUCCESSFUL" } },
        {
          $group: {
            _id: null,
            totalAmount: { $sum: "$amount" },
            totalRevenue: { $sum: "$servicepayProfit" },
          },
        },
      ]),
      Transfer.find()
        .sort({ createdAt: -1 })
        .limit(8)
        .populate("sender", "fullName phone")
        .populate("receiver", "fullName phone")
        .lean(),
      Transaction.find()
        .sort({ createdAt: -1 })
        .limit(8)
        .populate("customerId", "fullName phone")
        .lean(),
    ]);

    const wallet = walletSummary[0] || {};
    const transfer = transferSummary[0] || {};
    const transaction = transactionSummary[0] || {};

    const recentActivity = [
      ...recentTransfers.map((item) => ({
        id: item._id,
        reference: item.reference,
        type: "TRANSFER",
        title: `${item.sender?.fullName || "Unknown"} → ${item.receiver?.fullName || "Unknown"}`,
        subtitle: `${item.sender?.phone || ""} → ${item.receiver?.phone || ""}`,
        amount: item.amount,
        status: item.status,
        createdAt: item.createdAt,
      })),
      ...recentTransactions.map((item) => ({
        id: item._id,
        reference: item.reference,
        type: item.serviceType,
        title: item.customerId?.fullName || "Unknown customer",
        subtitle: item.provider || item.phone || item.serviceType,
        amount: item.amount,
        status: item.status,
        createdAt: item.createdAt,
      })),
    ]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 10);

    return res.json({
      success: true,
      data: {
        admin: {
          id: req.user._id,
          fullName: req.user.fullName,
          email: req.user.email,
          role: req.user.role,
        },
        stats: {
          totalUsers,
          activeUsers,
          blockedUsers,
          totalWalletBalance: wallet.totalWalletBalance || 0,
          totalCommissionBalance: wallet.totalCommissionBalance || 0,
          totalTransfers,
          totalTransferVolume: transfer.totalAmount || 0,
          totalServiceVolume: transaction.totalAmount || 0,
          totalRevenue: transaction.totalRevenue || 0,
        },
        recentActivity,
      },
    });
  } catch (error) {
    console.error("Admin dashboard error:", error);
    return res.status(500).json({
      success: false,
      message: "An samu matsala wajen ɗauko bayanan Admin Dashboard.",
      error: error.message,
    });
  }
};
