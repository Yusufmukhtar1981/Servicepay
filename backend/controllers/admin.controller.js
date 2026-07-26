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
const getUsers = async (req, res) => {
  try {
    const {
      search = "",
      role,
      status,
      page = 1,
      limit = 20,
    } = req.query;

    const filter = {};

    if (search.trim()) {
      filter.$or = [
        {
          fullName: {
            $regex: search.trim(),
            $options: "i",
          },
        },
        {
          phone: {
            $regex: search.trim(),
            $options: "i",
          },
        },
        {
          email: {
            $regex: search.trim(),
            $options: "i",
          },
        },
      ];
    }

    if (role) {
      filter.role = role;
    }

    if (status) {
      filter.status = status;
    }

    const currentPage = Math.max(Number(page) || 1, 1);
    const pageLimit = Math.min(
      Math.max(Number(limit) || 20, 1),
      100
    );

    const skip = (currentPage - 1) * pageLimit;

    const [users, totalUsers] = await Promise.all([
      User.find(filter)
        .select("-password")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageLimit),

      User.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        users,
        pagination: {
          page: currentPage,
          limit: pageLimit,
          totalUsers,
          totalPages: Math.ceil(totalUsers / pageLimit),
        },
      },
    });
  } catch (error) {
    console.error("Get users error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load users.",
    });
  }
};

const getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId)
      .select("-password")
      .populate(
        "zonalManagerId stateManagerId agentId referredBy",
        "fullName phone email role"
      );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        user,
      },
    });
  } catch (error) {
    console.error("Get user error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load user.",
    });
  }
};

const updateUserStatus = async (req, res) => {
  try {
    const { status } = req.body;

    const allowedStatuses = [
      "ACTIVE",
      "SUSPENDED",
      "BLOCKED",
    ];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message:
          "Status must be ACTIVE, SUSPENDED, or BLOCKED.",
      });
    }

    const user = await User.findById(req.params.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    if (
      user._id.toString() === req.user._id.toString() &&
      status !== "ACTIVE"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "You cannot suspend or block your own admin account.",
      });
    }

    user.status = status;
    await user.save();

    return res.status(200).json({
      success: true,
      message: `User status changed to ${status}.`,
      data: {
        user: {
          id: user._id,
          fullName: user.fullName,
          phone: user.phone,
          email: user.email,
          role: user.role,
          status: user.status,
        },
      },
    });
  } catch (error) {
    console.error("Update user status error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update user status.",
    });
  }
};
module.exports = {
  getAdminDashboard,
};