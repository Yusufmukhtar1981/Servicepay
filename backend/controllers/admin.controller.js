const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");

const escapeRegex = (value = "") => {
  return String(value).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
};

const getPositiveInteger = (
  value,
  fallback,
  maximum = 100
) => {
  const parsedValue = Number.parseInt(value, 10);

  if (
    !Number.isFinite(parsedValue) ||
    parsedValue < 1
  ) {
    return fallback;
  }

  return Math.min(parsedValue, maximum);
};

const buildTransactionQuery = (filter = {}) => {
  let query = Transaction.find(filter);

  if (Transaction.schema.path("customerId")) {
    query = query.populate(
      "customerId",
      "fullName name email phone role status"
    );
  }

  if (Transaction.schema.path("userId")) {
    query = query.populate(
      "userId",
      "fullName name email phone role status"
    );
  }

  if (Transaction.schema.path("senderId")) {
    query = query.populate(
      "senderId",
      "fullName name email phone role status"
    );
  }

  if (Transaction.schema.path("receiverId")) {
    query = query.populate(
      "receiverId",
      "fullName name email phone role status"
    );
  }

  return query;
};

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
      recentUsers,
      recentTransactions,
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
        status: {
          $in: [
            "SUCCESS",
            "SUCCESSFUL",
            "COMPLETED",
            "APPROVED",
          ],
        },
      }),

      Transaction.countDocuments({
        status: {
          $in: [
            "PENDING",
            "PROCESSING",
          ],
        },
      }),

      Transaction.countDocuments({
        status: {
          $in: [
            "FAILED",
            "CANCELLED",
            "REJECTED",
          ],
        },
      }),

      Transaction.countDocuments({
        status: {
          $in: [
            "REFUNDED",
            "REVERSED",
          ],
        },
      }),

      User.aggregate([
        {
          $group: {
            _id: null,

            totalWalletBalance: {
              $sum: {
                $convert: {
                  input: "$walletBalance",
                  to: "double",
                  onError: 0,
                  onNull: 0,
                },
              },
            },

            totalCommissionBalance: {
              $sum: {
                $convert: {
                  input: "$commissionBalance",
                  to: "double",
                  onError: 0,
                  onNull: 0,
                },
              },
            },

            totalUserEarnings: {
              $sum: {
                $convert: {
                  input: "$totalEarnings",
                  to: "double",
                  onError: 0,
                  onNull: 0,
                },
              },
            },
          },
        },
      ]),

      Transaction.aggregate([
        {
          $match: {
            status: {
              $in: [
                "SUCCESS",
                "SUCCESSFUL",
                "COMPLETED",
                "APPROVED",
              ],
            },
          },
        },
        {
          $group: {
            _id: null,

            totalTransactionVolume: {
              $sum: {
                $convert: {
                  input: "$amount",
                  to: "double",
                  onError: 0,
                  onNull: 0,
                },
              },
            },
          },
        },
      ]),

      Transaction.aggregate([
        {
          $match: {
            status: {
              $in: [
                "SUCCESS",
                "SUCCESSFUL",
                "COMPLETED",
                "APPROVED",
              ],
            },
          },
        },
        {
          $group: {
            _id: null,

            totalAgentCommission: {
              $sum: {
                $convert: {
                  input: "$agentCommission",
                  to: "double",
                  onError: 0,
                  onNull: 0,
                },
              },
            },

            totalStateManagerCommission: {
              $sum: {
                $convert: {
                  input: "$stateManagerCommission",
                  to: "double",
                  onError: 0,
                  onNull: 0,
                },
              },
            },

            totalZonalManagerCommission: {
              $sum: {
                $convert: {
                  input: "$zonalManagerCommission",
                  to: "double",
                  onError: 0,
                  onNull: 0,
                },
              },
            },
          },
        },
      ]),

      Transaction.aggregate([
        {
          $match: {
            status: {
              $in: [
                "SUCCESS",
                "SUCCESSFUL",
                "COMPLETED",
                "APPROVED",
              ],
            },
          },
        },
        {
          $group: {
            _id: null,

            totalServicepayProfit: {
              $sum: {
                $convert: {
                  input: "$servicepayProfit",
                  to: "double",
                  onError: 0,
                  onNull: 0,
                },
              },
            },
          },
        },
      ]),

      User.find()
        .select(
          "fullName name email phone role status createdAt"
        )
        .sort({
          createdAt: -1,
        })
        .limit(5)
        .lean(),

      buildTransactionQuery()
        .sort({
          createdAt: -1,
        })
        .limit(5)
        .lean(),
    ]);

    const walletStats = walletResult[0] || {
      totalWalletBalance: 0,
      totalCommissionBalance: 0,
      totalUserEarnings: 0,
    };

    const transactionStats =
      transactionVolumeResult[0] || {
        totalTransactionVolume: 0,
      };

    const commissionStats =
      commissionResult[0] || {
        totalAgentCommission: 0,
        totalStateManagerCommission: 0,
        totalZonalManagerCommission: 0,
      };

    const profitStats = profitResult[0] || {
      totalServicepayProfit: 0,
    };

    const totalCommission =
      Number(
        commissionStats.totalAgentCommission || 0
      ) +
      Number(
        commissionStats.totalStateManagerCommission ||
          0
      ) +
      Number(
        commissionStats.totalZonalManagerCommission ||
          0
      );

    return res.status(200).json({
      success: true,
      message:
        "Admin dashboard loaded successfully.",

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

        kyc: {
          pending: 0,
          verified: 0,
        },

        transactions: {
          total: totalTransactions,
          successful: successfulTransactions,
          pending: pendingTransactions,
          failed: failedTransactions,
          refunded: refundedTransactions,

          totalVolume:
            transactionStats.totalTransactionVolume ||
            0,

          totalValue:
            transactionStats.totalTransactionVolume ||
            0,

          servicepayProfit:
            profitStats.totalServicepayProfit || 0,
        },

        wallets: {
          totalWalletBalance:
            walletStats.totalWalletBalance || 0,

          totalBalance:
            walletStats.totalWalletBalance || 0,

          totalCommissionBalance:
            walletStats.totalCommissionBalance || 0,

          totalUserEarnings:
            walletStats.totalUserEarnings || 0,
        },

        commissions: {
          agent:
            commissionStats.totalAgentCommission ||
            0,

          stateManager:
            commissionStats
              .totalStateManagerCommission || 0,

          zonalManager:
            commissionStats
              .totalZonalManagerCommission || 0,

          total: totalCommission,
        },

        servicepay: {
          totalProfit:
            profitStats.totalServicepayProfit || 0,
        },

        recentUsers,
        recentTransactions,
      },
    });
  } catch (error) {
    console.error(
      "Admin dashboard error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to load admin dashboard.",
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined,
    });
  }
};

const getUsers = async (req, res) => {
  try {
    const search = String(
      req.query.search || ""
    ).trim();

    const role = String(
      req.query.role || ""
    )
      .trim()
      .toUpperCase();

    const status = String(
      req.query.status || ""
    )
      .trim()
      .toUpperCase();

    const currentPage = getPositiveInteger(
      req.query.page,
      1,
      100000
    );

    const pageLimit = getPositiveInteger(
      req.query.limit,
      20,
      100
    );

    const skip =
      (currentPage - 1) * pageLimit;

    const filter = {};

    if (search) {
      const searchRegex = new RegExp(
        escapeRegex(search),
        "i"
      );

      filter.$or = [
        {
          fullName: searchRegex,
        },
        {
          name: searchRegex,
        },
        {
          phone: searchRegex,
        },
        {
          email: searchRegex,
        },
      ];
    }

    if (role && role !== "ALL") {
      filter.role = role;
    }

    if (status && status !== "ALL") {
      filter.status = status;
    }

    const [users, totalUsers] =
      await Promise.all([
        User.find(filter)
          .select("-password")
          .sort({
            createdAt: -1,
          })
          .skip(skip)
          .limit(pageLimit)
          .lean(),

        User.countDocuments(filter),
      ]);

    const totalPages = Math.max(
      Math.ceil(totalUsers / pageLimit),
      1
    );

    return res.status(200).json({
      success: true,

      data: {
        users,

        pagination: {
          page: currentPage,
          currentPage,
          limit: pageLimit,
          total: totalUsers,
          totalUsers,
          totalItems: totalUsers,
          totalPages,
          hasNextPage:
            currentPage < totalPages,
          hasPreviousPage:
            currentPage > 1,
        },
      },
    });
  } catch (error) {
    console.error(
      "Get users error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to load users.",
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined,
    });
  }
};

const getUserById = async (req, res) => {
  try {
    const user = await User.findById(
      req.params.userId
    )
      .select("-password")
      .populate(
        "zonalManagerId stateManagerId agentId referredBy",
        "fullName name phone email role status"
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
    console.error(
      "Get user error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to load user.",
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined,
    });
  }
};

const updateUserStatus = async (
  req,
  res
) => {
  try {
    const status = String(
      req.body.status || ""
    )
      .trim()
      .toUpperCase();

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

    const user = await User.findById(
      req.params.userId
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    if (
      req.user &&
      user._id.toString() ===
        req.user._id.toString() &&
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
      message:
        `User status changed to ${status}.`,

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
    console.error(
      "Update user status error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to update user status.",
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined,
    });
  }
};

const getAdminTransactions = async (
  req,
  res
) => {
  try {
    const page = getPositiveInteger(
      req.query.page,
      1,
      100000
    );

    const limit = getPositiveInteger(
      req.query.limit,
      20,
      100
    );

    const skip = (page - 1) * limit;

    const search = String(
      req.query.search || ""
    ).trim();

    const status = String(
      req.query.status || ""
    )
      .trim()
      .toUpperCase();

    const serviceType = String(
      req.query.serviceType ||
        req.query.service ||
        ""
    )
      .trim()
      .toUpperCase();

    const filter = {};

    if (status && status !== "ALL") {
      if (status === "SUCCESSFUL") {
        filter.status = {
          $in: [
            "SUCCESS",
            "SUCCESSFUL",
            "COMPLETED",
            "APPROVED",
          ],
        };
      } else if (status === "PENDING") {
        filter.status = {
          $in: [
            "PENDING",
            "PROCESSING",
          ],
        };
      } else if (status === "FAILED") {
        filter.status = {
          $in: [
            "FAILED",
            "CANCELLED",
            "REJECTED",
          ],
        };
      } else if (status === "REVERSED") {
        filter.status = {
          $in: [
            "REVERSED",
            "REFUNDED",
          ],
        };
      } else {
        filter.status = status;
      }
    }

    if (
      serviceType &&
      serviceType !== "ALL"
    ) {
      filter.serviceType = serviceType;
    }

    if (search) {
      const searchRegex = new RegExp(
        escapeRegex(search),
        "i"
      );

      const matchingUsers = await User.find({
        $or: [
          {
            fullName: searchRegex,
          },
          {
            name: searchRegex,
          },
          {
            phone: searchRegex,
          },
          {
            email: searchRegex,
          },
        ],
      })
        .select("_id")
        .limit(500)
        .lean();

      const userIds = matchingUsers.map(
        (user) => user._id
      );

      const searchConditions = [
        {
          reference: searchRegex,
        },
        {
          transactionReference:
            searchRegex,
        },
        {
          paymentReference:
            searchRegex,
        },
        {
          description: searchRegex,
        },
        {
          narration: searchRegex,
        },
        {
          phone: searchRegex,
        },
        {
          customerPhone: searchRegex,
        },
        {
          customerName: searchRegex,
        },
        {
          userName: searchRegex,
        },
      ];

      if (userIds.length > 0) {
        if (
          Transaction.schema.path(
            "customerId"
          )
        ) {
          searchConditions.push({
            customerId: {
              $in: userIds,
            },
          });
        }

        if (
          Transaction.schema.path("userId")
        ) {
          searchConditions.push({
            userId: {
              $in: userIds,
            },
          });
        }

        if (
          Transaction.schema.path("senderId")
        ) {
          searchConditions.push({
            senderId: {
              $in: userIds,
            },
          });
        }

        if (
          Transaction.schema.path(
            "receiverId"
          )
        ) {
          searchConditions.push({
            receiverId: {
              $in: userIds,
            },
          });
        }
      }

      filter.$or = searchConditions;
    }

    const [
      transactions,
      totalTransactions,
    ] = await Promise.all([
      buildTransactionQuery(filter)
        .sort({
          createdAt: -1,
        })
        .skip(skip)
        .limit(limit)
        .lean(),

      Transaction.countDocuments(filter),
    ]);

    const totalPages = Math.max(
      Math.ceil(totalTransactions / limit),
      1
    );

    return res.status(200).json({
      success: true,
      message:
        "Transactions loaded successfully.",

      data: {
        transactions,

        pagination: {
          page,
          currentPage: page,
          limit,
          total: totalTransactions,
          totalItems: totalTransactions,
          totalPages,
          hasNextPage:
            page < totalPages,
          hasPreviousPage:
            page > 1,
        },

        total: totalTransactions,
        totalTransactions,
        currentPage: page,
        totalPages,
      },
    });
  } catch (error) {
    console.error(
      "Get admin transactions error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to load admin transactions.",
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined,
    });
  }
};

module.exports = {
  getAdminDashboard,
  getUsers,
  getUserById,
  updateUserStatus,
  getAdminTransactions,
};