const mongoose = require("mongoose");

const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const Delivery = require("../models/delivery.model");
const {
  getExecutiveDashboard,
   getDashboardTargets,
   updateDashboardTargets,
   getDashboardExport,
} = require("../services/adminDashboard.service");

exports.getAdminExecutiveDashboard = getExecutiveDashboard;
exports.getAdminDashboardTargets = getDashboardTargets;
exports.updateAdminDashboardTargets = updateDashboardTargets;
exports.getAdminDashboardExport = getDashboardExport;

const DELIVERY_STATUSES = [
  "PENDING",
  "ACCEPTED",
  "PICKED_UP",
  "IN_TRANSIT",
  "DELIVERED",
  "CANCELLED",
  "FAILED",
];

const toPositiveInteger = (
  value,
  fallback,
  maximum = 100
) => {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(parsed, maximum);
};

const escapeRegex = (value = "") => {
  return String(value).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
};

const normalizeDeliveryStatus = (value = "") => {
  return String(value)
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
};

exports.getAdminDashboard = async (req, res) => {
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
      totalTransactions,
      successfulTransactions,
      pendingTransactions,
      failedTransactions,
      recentUsers,
      recentTransactions,
      transactionSummary,
      walletSummary,
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

      User.find()
        .select(
          "fullName name email phone role status createdAt"
        )
        .sort({
          createdAt: -1,
        })
        .limit(5)
        .lean(),

      Transaction.find()
        .populate(
          "customerId",
          "fullName name email phone"
        )
        .populate(
          "userId",
          "fullName name email phone"
        )
        .sort({
          createdAt: -1,
        })
        .limit(5)
        .lean(),

      Transaction.aggregate([
        {
          $group: {
            _id: null,

            totalVolume: {
              $sum: {
                $convert: {
                  input: "$amount",
                  to: "double",
                  onError: 0,
                  onNull: 0,
                },
              },
            },

            totalProfit: {
              $sum: {
                $convert: {
                  input: {
                    $ifNull: [
                      "$servicepayProfit",
                      {
                        $ifNull: [
                          "$profit",
                          0,
                        ],
                      },
                    ],
                  },
                  to: "double",
                  onError: 0,
                  onNull: 0,
                },
              },
            },
          },
        },
      ]),

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
          },
        },
      ]),
    ]);

    const totalVolume =
      transactionSummary[0]?.totalVolume ?? 0;

    const servicepayProfit =
      transactionSummary[0]?.totalProfit ?? 0;

    const totalWalletBalance =
      walletSummary[0]?.totalWalletBalance ?? 0;

    return res.status(200).json({
      success: true,

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
        },

        kyc: {
          pending: 0,
        },

        wallets: {
          totalWalletBalance,
          totalBalance: totalWalletBalance,
        },

        transactions: {
          total: totalTransactions,
          totalVolume,
          totalValue: totalVolume,
          successful: successfulTransactions,
          pending: pendingTransactions,
          failed: failedTransactions,
          servicepayProfit,
        },

        servicepay: {
          totalProfit: servicepayProfit,
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
      error: error.message,
    });
  }
};

exports.getAdminTransactions = async (
  req,
  res
) => {
  try {
    const page = toPositiveInteger(
      req.query.page,
      1,
      100000
    );

    const limit = toPositiveInteger(
      req.query.limit,
      20,
      100
    );

    const skip = (page - 1) * limit;

    const search = String(
      req.query.search ?? ""
    ).trim();

    const status = String(
      req.query.status ?? ""
    )
      .trim()
      .toUpperCase();

    const serviceType = String(
      req.query.serviceType ??
        req.query.service ??
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
      } else if (status === "FAILED") {
        filter.status = {
          $in: [
            "FAILED",
            "CANCELLED",
            "REJECTED",
          ],
        };
      } else if (status === "PENDING") {
        filter.status = {
          $in: [
            "PENDING",
            "PROCESSING",
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
      const safeSearch =
        escapeRegex(search);

      const searchRegex = new RegExp(
        safeSearch,
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

      if (
        mongoose.Types.ObjectId.isValid(
          search
        )
      ) {
        searchConditions.push({
          _id: new mongoose.Types.ObjectId(
            search
          ),
        });
      }

      if (userIds.length > 0) {
        searchConditions.push(
          {
            customerId: {
              $in: userIds,
            },
          },
          {
            userId: {
              $in: userIds,
            },
          }
        );
      }

      filter.$or = searchConditions;
    }

    const [
      transactions,
      totalTransactions,
    ] = await Promise.all([
      Transaction.find(filter)
        .populate(
          "customerId",
          "fullName name email phone role status"
        )
        .populate(
          "userId",
          "fullName name email phone role status"
        )
        .sort({
          createdAt: -1,
        })
        .skip(skip)
        .limit(limit)
        .lean(),

      Transaction.countDocuments(filter),
    ]);

    const totalPages = Math.max(
      1,
      Math.ceil(
        totalTransactions / limit
      )
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
      error: error.message,
    });
  }
};

exports.getAdminDeliveries = async (
  req,
  res
) => {
  try {
    const page = toPositiveInteger(
      req.query.page,
      1,
      100000
    );

    const limit = toPositiveInteger(
      req.query.limit,
      20,
      100
    );

    const skip = (page - 1) * limit;

    const search = String(
      req.query.search ?? ""
    ).trim();

    const status =
      normalizeDeliveryStatus(
        req.query.status ?? ""
      );

    const filter = {};

    if (status && status !== "ALL") {
      if (
        !DELIVERY_STATUSES.includes(status)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid delivery status.",
          allowedStatuses:
            DELIVERY_STATUSES,
        });
      }

      filter.status = status;
    }

    if (search) {
      const safeSearch =
        escapeRegex(search);

      const searchRegex = new RegExp(
        safeSearch,
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
            email: searchRegex,
          },
          {
            phone: searchRegex,
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
          trackingNumber: searchRegex,
        },
        {
          pickupAddress: searchRegex,
        },
        {
          deliveryAddress: searchRegex,
        },
        {
          senderName: searchRegex,
        },
        {
          senderPhone: searchRegex,
        },
        {
          receiverName: searchRegex,
        },
        {
          receiverPhone: searchRegex,
        },
        {
          packageName: searchRegex,
        },
        {
          packageDescription: searchRegex,
        },
        {
          riderName: searchRegex,
        },
        {
          riderPhone: searchRegex,
        },
      ];

      if (
        mongoose.Types.ObjectId.isValid(
          search
        )
      ) {
        searchConditions.push({
          _id: new mongoose.Types.ObjectId(
            search
          ),
        });
      }

      if (userIds.length > 0) {
        searchConditions.push({
          customerId: {
            $in: userIds,
          },
        });
      }

      filter.$or = searchConditions;
    }

    const [
      deliveries,
      filteredTotal,
      totalDeliveries,
      pendingDeliveries,
      acceptedDeliveries,
      pickedUpDeliveries,
      inTransitDeliveries,
      deliveredDeliveries,
      cancelledDeliveries,
      failedDeliveries,
      revenueSummary,
    ] = await Promise.all([
      Delivery.find(filter)
        .populate(
          "customerId",
          "fullName name email phone role status"
        )
        .populate(
          "assignedRiderId",
          "fullName name email phone role status"
        )
        .sort({
          createdAt: -1,
        })
        .skip(skip)
        .limit(limit)
        .lean(),

      Delivery.countDocuments(filter),

      Delivery.countDocuments(),

      Delivery.countDocuments({
        status: "PENDING",
      }),

      Delivery.countDocuments({
        status: "ACCEPTED",
      }),

      Delivery.countDocuments({
        status: "PICKED_UP",
      }),

      Delivery.countDocuments({
        status: "IN_TRANSIT",
      }),

      Delivery.countDocuments({
        status: "DELIVERED",
      }),

      Delivery.countDocuments({
        status: "CANCELLED",
      }),

      Delivery.countDocuments({
        status: "FAILED",
      }),

      Delivery.aggregate([
        {
          $match: {
            status: "DELIVERED",
          },
        },
        {
          $group: {
            _id: null,

            totalRevenue: {
              $sum: {
                $convert: {
                  input: "$deliveryFee",
                  to: "double",
                  onError: 0,
                  onNull: 0,
                },
              },
            },
          },
        },
      ]),
    ]);

    const totalPages = Math.max(
      1,
      Math.ceil(
        filteredTotal / limit
      )
    );

    const totalRevenue =
      revenueSummary[0]?.totalRevenue ?? 0;

    return res.status(200).json({
      success: true,
      message:
        "Deliveries loaded successfully.",

      data: {
        deliveries,

        summary: {
          total: totalDeliveries,
          pending: pendingDeliveries,
          accepted: acceptedDeliveries,
          assigned: acceptedDeliveries,
          pickedUp: pickedUpDeliveries,
          inTransit: inTransitDeliveries,
          delivered: deliveredDeliveries,
          cancelled: cancelledDeliveries,
          failed: failedDeliveries,
          totalRevenue,
        },

        pagination: {
          page,
          currentPage: page,
          limit,
          total: filteredTotal,
          totalItems: filteredTotal,
          totalPages,
          hasNextPage:
            page < totalPages,
          hasPreviousPage:
            page > 1,
        },

        total: filteredTotal,
        totalDeliveries: filteredTotal,
        currentPage: page,
        totalPages,
      },
    });
  } catch (error) {
    console.error(
      "Get admin deliveries error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to load deliveries.",
      error: error.message,
    });
  }
};

exports.updateDeliveryStatus = async (
  req,
  res
) => {
  try {
    const deliveryId = String(
      req.params.id ?? ""
    ).trim();

    const status =
      normalizeDeliveryStatus(
        req.body.status
      );

    if (
      !mongoose.Types.ObjectId.isValid(
        deliveryId
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid delivery ID.",
      });
    }

    if (!status) {
      return res.status(400).json({
        success: false,
        message:
          "Delivery status is required.",
      });
    }

    if (
      !DELIVERY_STATUSES.includes(status)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid delivery status.",
        allowedStatuses:
          DELIVERY_STATUSES,
      });
    }

    const delivery =
      await Delivery.findById(
        deliveryId
      );

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message:
          "Delivery was not found.",
      });
    }

    const previousStatus =
      delivery.status;

    delivery.status = status;

    if (
      req.body.adminNote !== undefined
    ) {
      delivery.adminNote = String(
        req.body.adminNote ?? ""
      ).trim();
    }

    if (
      req.body.riderName !== undefined
    ) {
      delivery.riderName = String(
        req.body.riderName ?? ""
      ).trim();
    }

    if (
      req.body.riderPhone !== undefined
    ) {
      delivery.riderPhone = String(
        req.body.riderPhone ?? ""
      ).trim();
    }

    if (
      req.body.assignedRiderId !==
        undefined
    ) {
      const riderId = String(
        req.body.assignedRiderId ?? ""
      ).trim();

      if (!riderId) {
        delivery.assignedRiderId = null;
      } else if (
        mongoose.Types.ObjectId.isValid(
          riderId
        )
      ) {
        const rider = await User.findById(
          riderId
        ).select(
          "_id fullName name phone role status"
        );

        if (!rider) {
          return res.status(404).json({
            success: false,
            message:
              "Assigned rider was not found.",
          });
        }

        delivery.assignedRiderId =
          rider._id;

        if (!delivery.riderName) {
          delivery.riderName =
            rider.fullName ||
            rider.name ||
            "";
        }

        if (!delivery.riderPhone) {
          delivery.riderPhone =
            rider.phone || "";
        }
      } else {
        return res.status(400).json({
          success: false,
          message:
            "Invalid rider ID.",
        });
      }
    }

    const now = new Date();

    if (status === "ACCEPTED") {
      delivery.acceptedAt =
        delivery.acceptedAt ?? now;
    }

    if (status === "PICKED_UP") {
      delivery.pickedUpAt =
        delivery.pickedUpAt ?? now;
    }

    if (status === "IN_TRANSIT") {
      delivery.inTransitAt =
        delivery.inTransitAt ?? now;
    }

    if (status === "DELIVERED") {
      delivery.deliveredAt =
        delivery.deliveredAt ?? now;
    }

    if (status === "CANCELLED") {
      delivery.cancelledAt =
        delivery.cancelledAt ?? now;
    }

    if (status === "FAILED") {
      delivery.failedAt =
        delivery.failedAt ?? now;
    }

    await delivery.save();

    const updatedDelivery =
      await Delivery.findById(
        delivery._id
      )
        .populate(
          "customerId",
          "fullName name email phone role status"
        )
        .populate(
          "assignedRiderId",
          "fullName name email phone role status"
        )
        .lean();

    return res.status(200).json({
      success: true,
      message:
        "Delivery status updated successfully.",

      data: {
        delivery: updatedDelivery,
        previousStatus,
        currentStatus: status,
      },
    });
  } catch (error) {
    console.error(
      "Update delivery status error:",
      error
    );

    if (
      error.name === "ValidationError"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid delivery information.",
        error: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message:
        "Failed to update delivery status.",
      error: error.message,
    });
  }
};
const MANAGEMENT_ROLES = [
  "HEAD_OFFICE",
  "ZONAL_MANAGER",
  "STATE_MANAGER",
];

const CREATABLE_ROLE_BY_CREATOR = {
  HEAD_OFFICE: [
    "ZONAL_MANAGER",
    "STATE_MANAGER",
    "AGENT",
  ],

  ZONAL_MANAGER: [
    "STATE_MANAGER",
  ],

  STATE_MANAGER: [
    "AGENT",
  ],
};

const normalizeRole = (value = "") => {
  return String(value)
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
};

const normalizeAccountStatus = (
  value = "ACTIVE"
) => {
  return String(value)
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
};

const buildUserVisibilityFilter = (
  loggedInUser
) => {
  if (
    !loggedInUser ||
    loggedInUser.role === "HEAD_OFFICE"
  ) {
    return {};
  }

  if (
    loggedInUser.role === "ZONAL_MANAGER"
  ) {
    return {
      $or: [
        {
          _id: loggedInUser._id,
        },
        {
          zonalManagerId:
            loggedInUser._id,
        },
        {
          zone: loggedInUser.zone,
          role: {
            $in: [
              "STATE_MANAGER",
              "AGENT",
              "CUSTOMER",
            ],
          },
        },
      ],
    };
  }

  if (
    loggedInUser.role === "STATE_MANAGER"
  ) {
    return {
      $or: [
        {
          _id: loggedInUser._id,
        },
        {
          stateManagerId:
            loggedInUser._id,
        },
        {
          state: loggedInUser.state,
          role: {
            $in: [
              "AGENT",
              "CUSTOMER",
            ],
          },
        },
      ],
    };
  }

  return {
    _id: loggedInUser._id,
  };
};

const combineFilters = (
  baseFilter,
  extraFilter
) => {
  const baseHasValues =
    baseFilter &&
    Object.keys(baseFilter).length > 0;

  const extraHasValues =
    extraFilter &&
    Object.keys(extraFilter).length > 0;

  if (
    baseHasValues &&
    extraHasValues
  ) {
    return {
      $and: [
        baseFilter,
        extraFilter,
      ],
    };
  }

  if (baseHasValues) {
    return baseFilter;
  }

  return extraFilter || {};
};

/*
 * GET /api/admin/users
 *
 * HEAD_OFFICE:
 * Sees all users.
 *
 * ZONAL_MANAGER:
 * Sees users in the manager's zone.
 *
 * STATE_MANAGER:
 * Sees agents/customers in the manager's state.
 */
exports.getAdminUsers = async (
  req,
  res
) => {
  try {
    const page = toPositiveInteger(
      req.query.page,
      1,
      100000
    );

    const limit = toPositiveInteger(
      req.query.limit,
      20,
      100
    );

    const skip =
      (page - 1) * limit;

    const search = String(
      req.query.search || ""
    ).trim();

    const role = normalizeRole(
      req.query.role || ""
    );

    const status =
      normalizeAccountStatus(
        req.query.status || ""
      );

    const requestedFilter = {};

    if (
      role &&
      role !== "ALL"
    ) {
      requestedFilter.role = role;
    }

    if (
      status &&
      status !== "ALL"
    ) {
      requestedFilter.status =
        status;
    }

    if (search) {
      const searchRegex =
        new RegExp(
          escapeRegex(search),
          "i"
        );

      requestedFilter.$or = [
        {
          fullName:
            searchRegex,
        },
        {
          phone:
            searchRegex,
        },
        {
          email:
            searchRegex,
        },
        {
          state:
            searchRegex,
        },
        {
          lga:
            searchRegex,
        },
        {
          zone:
            searchRegex,
        },
      ];

      if (
        mongoose.Types.ObjectId.isValid(
          search
        )
      ) {
        requestedFilter.$or.push({
          _id:
            new mongoose.Types.ObjectId(
              search
            ),
        });
      }
    }

    const visibilityFilter =
      buildUserVisibilityFilter(
        req.user
      );

    const filter =
      combineFilters(
        visibilityFilter,
        requestedFilter
      );

    const [
      users,
      totalUsers,
    ] = await Promise.all([
      User.find(filter)
        .select("-password")
        .populate(
          "zonalManagerId",
          "fullName phone email role zone state"
        )
        .populate(
          "stateManagerId",
          "fullName phone email role zone state"
        )
        .populate(
          "agentId",
          "fullName phone email role zone state"
        )
        .sort({
          createdAt: -1,
        })
        .skip(skip)
        .limit(limit)
        .lean(),

      User.countDocuments(
        filter
      ),
    ]);

    const totalPages =
      Math.max(
        1,
        Math.ceil(
          totalUsers / limit
        )
      );

    return res.status(200).json({
      success: true,
      message:
        "Users loaded successfully.",

      data: {
        users,

        pagination: {
          page,
          currentPage: page,
          limit,
          total: totalUsers,
          totalItems:
            totalUsers,
          totalPages,
          hasNextPage:
            page < totalPages,
          hasPreviousPage:
            page > 1,
        },
      },
    });
  } catch (error) {
    console.error(
      "Get admin users error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to load users.",
      error: error.message,
    });
  }
};

/*
 * POST /api/admin/users
 *
 * HEAD_OFFICE -> ZONAL_MANAGER,
 *                STATE_MANAGER,
 *                AGENT
 *
 * ZONAL_MANAGER -> STATE_MANAGER
 *
 * STATE_MANAGER -> AGENT
 */
exports.createAdminUser = async (
  req,
  res
) => {
  try {
    const creator =
      req.user;

    if (
      !creator ||
      !MANAGEMENT_ROLES.includes(
        creator.role
      )
    ) {
      return res.status(403).json({
        success: false,
        message:
          "You are not allowed to create managed accounts.",
      });
    }

    const fullName = String(
      req.body.fullName || ""
    ).trim();

    const phone = String(
      req.body.phone || ""
    )
      .trim()
      .replace(/\s+/g, "");

    const email = String(
      req.body.email || ""
    )
      .trim()
      .toLowerCase();

    const password = String(
      req.body.password || ""
    );

    const requestedRole =
      normalizeRole(
        req.body.role
      );

    const requestedStatus =
      normalizeAccountStatus(
        req.body.status ||
          "ACTIVE"
      );

    const allowedRoles =
      CREATABLE_ROLE_BY_CREATOR[
        creator.role
      ] || [];

    if (!fullName) {
      return res.status(400).json({
        success: false,
        message:
          "Full name is required.",
      });
    }

    if (!phone) {
      return res.status(400).json({
        success: false,
        message:
          "Phone number is required.",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message:
          "Password must contain at least 6 characters.",
      });
    }

    if (
      !allowedRoles.includes(
        requestedRole
      )
    ) {
      return res.status(403).json({
        success: false,
        message:
          `${creator.role.replaceAll(
            "_",
            " "
          )} cannot create ${requestedRole.replaceAll(
            "_",
            " "
          )}.`,
      });
    }

    if (
      ![
        "ACTIVE",
        "SUSPENDED",
        "BLOCKED",
      ].includes(
        requestedStatus
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid account status.",
      });
    }

    const existingConditions = [
      {
        phone,
      },
    ];

    if (email) {
      existingConditions.push({
        email,
      });
    }

    const existingUser =
      await User.findOne({
        $or:
          existingConditions,
      }).lean();

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message:
          "A user with this phone number or email already exists.",
      });
    }

    const userData = {
      fullName,
      phone,
      password,
      role:
        requestedRole,
      status:
        requestedStatus,
    };

    if (email) {
      userData.email = email;
    }

    /*
     * HEAD OFFICE assignments.
     */
    if (
      creator.role ===
      "HEAD_OFFICE"
    ) {
      if (
        requestedRole ===
        "ZONAL_MANAGER"
      ) {
        const zone = String(
          req.body.zone || ""
        ).trim();

        if (!zone) {
          return res.status(400).json({
            success: false,
            message:
              "Zone is required for a Zonal Manager.",
          });
        }

        userData.zone =
          zone;
      }

      if (
        requestedRole ===
        "STATE_MANAGER"
      ) {
        const zonalManagerId =
          String(
            req.body
              .zonalManagerId ||
              ""
          ).trim();

        const state = String(
          req.body.state || ""
        ).trim();

        if (
          !mongoose.Types
            .ObjectId
            .isValid(
              zonalManagerId
            )
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Select a valid Zonal Manager.",
          });
        }

        if (!state) {
          return res.status(400).json({
            success: false,
            message:
              "State is required.",
          });
        }

        const zonalManager =
          await User.findOne({
            _id:
              zonalManagerId,
            role:
              "ZONAL_MANAGER",
            status:
              "ACTIVE",
          });

        if (!zonalManager) {
          return res.status(404).json({
            success: false,
            message:
              "Zonal Manager was not found.",
          });
        }

        userData.zone =
          zonalManager.zone;

        userData.state =
          state;

        userData.zonalManagerId =
          zonalManager._id;
      }

      if (
        requestedRole ===
        "AGENT"
      ) {
        const stateManagerId =
          String(
            req.body
              .stateManagerId ||
              ""
          ).trim();

        const lga = String(
          req.body.lga || ""
        ).trim();

        if (
          !mongoose.Types
            .ObjectId
            .isValid(
              stateManagerId
            )
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Select a valid State Manager.",
          });
        }

        if (!lga) {
          return res.status(400).json({
            success: false,
            message:
              "LGA is required.",
          });
        }

        const stateManager =
          await User.findOne({
            _id:
              stateManagerId,
            role:
              "STATE_MANAGER",
            status:
              "ACTIVE",
          });

        if (!stateManager) {
          return res.status(404).json({
            success: false,
            message:
              "State Manager was not found.",
          });
        }

        userData.zone =
          stateManager.zone;

        userData.state =
          stateManager.state;

        userData.lga =
          lga;

        userData.zonalManagerId =
          stateManager
            .zonalManagerId ||
          null;

        userData.stateManagerId =
          stateManager._id;
      }
    }

    /*
     * Zonal Manager creates State Manager.
     * Zone and parent manager ID are enforced
     * by the backend.
     */
    if (
      creator.role ===
      "ZONAL_MANAGER"
    ) {
      const state = String(
        req.body.state || ""
      ).trim();

      if (!creator.zone) {
        return res.status(400).json({
          success: false,
          message:
            "Your Zonal Manager account does not have a zone assigned.",
        });
      }

      if (!state) {
        return res.status(400).json({
          success: false,
          message:
            "State is required.",
        });
      }

      userData.zone =
        creator.zone;

      userData.state =
        state;

      userData.zonalManagerId =
        creator._id;
    }

    /*
     * State Manager creates Agent.
     * Zone, state and parent IDs are enforced
     * by the backend.
     */
    if (
      creator.role ===
      "STATE_MANAGER"
    ) {
      const lga = String(
        req.body.lga || ""
      ).trim();

      if (
        !creator.zone ||
        !creator.state
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Your State Manager account does not have a valid zone and state.",
        });
      }

      if (!lga) {
        return res.status(400).json({
          success: false,
          message:
            "LGA is required.",
        });
      }

      userData.zone =
        creator.zone;

      userData.state =
        creator.state;

      userData.lga =
        lga;

      userData.zonalManagerId =
        creator
          .zonalManagerId ||
        null;

      userData.stateManagerId =
        creator._id;
    }

    const createdUser =
      await User.create(
        userData
      );

    const safeUser =
      await User.findById(
        createdUser._id
      )
        .select("-password")
        .lean();

    return res.status(201).json({
      success: true,
      message:
        `${requestedRole.replaceAll(
          "_",
          " "
        )} created successfully.`,

      data: {
        user: safeUser,
      },
    });
  } catch (error) {
    console.error(
      "Create admin user error:",
      error
    );

    if (
      error?.code === 11000
    ) {
      return res.status(409).json({
        success: false,
        message:
          "A user with this phone number or email already exists.",
      });
    }

    if (
      error.name ===
      "ValidationError"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid account information.",
        error:
          error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message:
        "Failed to create account.",
      error:
        error.message,
    });
  }
};

/*
 * PATCH /api/admin/users/:id/status
 */
exports.updateAdminUserStatus =
  async (req, res) => {
    try {
      const targetUserId =
        String(
          req.params.id || ""
        ).trim();

      const newStatus =
        normalizeAccountStatus(
          req.body.status
        );

      if (
        !mongoose.Types
          .ObjectId
          .isValid(
            targetUserId
          )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid user ID.",
        });
      }

      if (
        ![
          "ACTIVE",
          "SUSPENDED",
          "BLOCKED",
        ].includes(
          newStatus
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid user status.",
        });
      }

      if (
        String(req.user._id) ===
        targetUserId
      ) {
        return res.status(400).json({
          success: false,
          message:
            "You cannot change your own account status.",
        });
      }

      const targetUser =
        await User.findById(
          targetUserId
        );

      if (!targetUser) {
        return res.status(404).json({
          success: false,
          message:
            "User was not found.",
        });
      }

      let canManage = false;

      if (
        req.user.role ===
        "HEAD_OFFICE"
      ) {
        canManage = true;
      }

      if (
        req.user.role ===
          "ZONAL_MANAGER" &&
        String(
          targetUser
            .zonalManagerId
        ) ===
          String(req.user._id)
      ) {
        canManage = true;
      }

      if (
        req.user.role ===
          "STATE_MANAGER" &&
        String(
          targetUser
            .stateManagerId
        ) ===
          String(req.user._id)
      ) {
        canManage = true;
      }

      if (!canManage) {
        return res.status(403).json({
          success: false,
          message:
            "You are not allowed to manage this user.",
        });
      }

      targetUser.status =
        newStatus;

      await targetUser.save();

      const safeUser =
        await User.findById(
          targetUser._id
        )
          .select("-password")
          .lean();

      return res.status(200).json({
        success: true,
        message:
          "User status updated successfully.",

        data: {
          user: safeUser,
        },
      });
    } catch (error) {
      console.error(
        "Update admin user status error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to update user status.",
        error:
          error.message,
      });
    }
  };