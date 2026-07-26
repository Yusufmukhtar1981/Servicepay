const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");

const getAdminDashboard = async (req, res) => {
  try {
    const [
      totalUsers,
      activeUsers,
      suspendedUsers,
      blockedUsers,
      totalCustomers,
      totalAgents,
      totalStateManagers,
      totalZonalManagers,
      totalHeadOffice,
      totalTransactions,
      successfulTransactions,
      pendingTransactions,
      failedTransactions,
      refundedTransactions,
      walletResult,
      transactionVolumeResult,
      commissionResult,
      profitResult,
    ] = await Promise.all([
      User.countDocuments(),

      User.countDocuments({
        status: "ACTIVE",
      }),

      User.countDocuments({
        status: "SUSPENDED",
      }),

      User.countDocuments({
        status: "BLOCKED",
      }),

      User.countDocuments({
        role: "CUSTOMER",
      }),

      User.countDocuments({
        role: "AGENT",
      }),

      User.countDocuments({
        role: "STATE_MANAGER",
      }),

      User.countDocuments({
        role: "ZONAL_MANAGER",
      }),

      User.countDocuments({
        role: "HEAD_OFFICE",
      }),

      Transaction.countDocuments(),

      Transaction.countDocuments({
        status: "SUCCESSFUL",
      }),

      Transaction.countDocuments({
        status: "PENDING",
      }),

      Transaction.countDocuments({
        status: "FAILED",
      }),

      Transaction.countDocuments({
        status: "REFUNDED",
      }),

      User.aggregate([
        {
          $group: {
            _id: null,
            totalWalletBalance: {
              $sum: "$walletBalance",
            },
            totalCommissionBalance: {
              $sum: "$commissionBalance",
            },
            totalUserEarnings: {
              $sum: "$totalEarnings",
            },
          },
        },
      ]),

      Transaction.aggregate([
        {
          $match: {
            status: "SUCCESSFUL",
          },
        },
        {
          $group: {
            _id: null,
            totalTransactionVolume: {
              $sum: "$amount",
            },
          },
        },
      ]),

      Transaction.aggregate([
        {
          $match: {
            status: "SUCCESSFUL",
          },
        },
        {
          $group: {
            _id: null,
            totalAgentCommission: {
              $sum: "$agentCommission",
            },
            totalStateManagerCommission: {
              $sum: "$stateManagerCommission",
            },
            totalZonalManagerCommission: {
              $sum: "$zonalManagerCommission",
            },
          },
        },
      ]),

      Transaction.aggregate([
        {
          $match: {
            status: "SUCCESSFUL",
          },
        },
        {
          $group: {
            _id: null,
            totalServicepayProfit: {
              $sum: "$servicepayProfit",
            },
          },
        },
      ]),
    ]);

    const walletStats = walletResult[0] || {
      totalWalletBalance: 0,
      totalCommissionBalance: 0,
      totalUserEarnings: 0,
    };

    const transactionStats = transactionVolumeResult[0] || {
      totalTransactionVolume: 0,
    };

    const commissionStats = commissionResult[0] || {
      totalAgentCommission: 0,
      totalStateManagerCommission: 0,
      totalZonalManagerCommission: 0,
    };

    const profitStats = profitResult[0] || {
      totalServicepayProfit: 0,
    };

    return res.status(200).json({
      success: true,
      message: "Admin dashboard loaded successfully.",
      data: {
        users: {
          total: totalUsers,
          active: activeUsers,
          suspended: suspendedUsers,
          blocked: blockedUsers,
          customers: totalCustomers,
          agents: totalAgents,
          stateManagers: totalStateManagers,
          zonalManagers: totalZonalManagers,
          headOffice: totalHeadOffice,
        },

        transactions: {
          total: totalTransactions,
          successful: successfulTransactions,
          pending: pendingTransactions,
          failed: failedTransactions,
          refunded: refundedTransactions,
          totalVolume:
            transactionStats.totalTransactionVolume || 0,
        },

        wallets: {
          totalWalletBalance:
            walletStats.totalWalletBalance || 0,
          totalCommissionBalance:
            walletStats.totalCommissionBalance || 0,
          totalUserEarnings:
            walletStats.totalUserEarnings || 0,
        },

        commissions: {
          agent:
            commissionStats.totalAgentCommission || 0,
          stateManager:
            commissionStats.totalStateManagerCommission || 0,
          zonalManager:
            commissionStats.totalZonalManagerCommission || 0,
          total:
            (commissionStats.totalAgentCommission || 0) +
            (commissionStats.totalStateManagerCommission || 0) +
            (commissionStats.totalZonalManagerCommission || 0),
        },

        servicepay: {
          totalProfit:
            profitStats.totalServicepayProfit || 0,
        },
      },
    });
  } catch (error) {
    console.error("Admin dashboard error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load admin dashboard.",
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined,
    });
  }
};

module.exports = {
  getAdminDashboard,
};