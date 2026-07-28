const mongoose = require("mongoose");

const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const Delivery = require("../models/delivery.model");

const DELIVERY_STATUSES = [
  "PENDING",
  "ACCEPTED",
  "PICKED_UP",
  "IN_TRANSIT",
  "DELIVERED",
  "CANCELLED",
  "FAILED",
];

const PAYMENT_STATUSES = [
  "UNPAID",
  "PAID",
  "REFUNDED",
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

const toValidAmount = (value) => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Number(parsed.toFixed(2));
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

const normalizePaymentStatus = (value = "") => {
  return String(value)
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
};

/*
|--------------------------------------------------------------------------
| ADMIN DASHBOARD
|--------------------------------------------------------------------------
*/

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
      totalDeliveries,
      pendingDeliveries,
      deliveredDeliveries,
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
          "fullName name email phone role status"
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
                      0,
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

      Delivery.countDocuments(),

      Delivery.countDocuments({
        status: "PENDING",
      }),

      Delivery.countDocuments({
        status: "DELIVERED",
      }),
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

        deliveries: {
          total: totalDeliveries,
          pending: pendingDeliveries,
          delivered: deliveredDeliveries,
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

/*
|--------------------------------------------------------------------------
| ADMIN TRANSACTIONS
|--------------------------------------------------------------------------
*/

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
      if (
        status === "SUCCESS" ||
        status === "SUCCESSFUL" ||
        status === "COMPLETED"
      ) {
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
      } else if (
        status === "REFUNDED" ||
        status === "REVERSED"
      ) {
        filter.status = {
          $in: [
            "REFUNDED",
            "REVERSED",
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
          provider: searchRegex,
        },
        {
          phone: searchRegex,
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
      transactions,
      totalTransactions,
    ] = await Promise.all([
      Transaction.find(filter)
        .populate(
          "customerId",
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

/*
|--------------------------------------------------------------------------
| GET ADMIN DELIVERIES
|--------------------------------------------------------------------------
*/

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

    const paymentStatus =
      normalizePaymentStatus(
        req.query.paymentStatus ?? ""
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

    if (
      paymentStatus &&
      paymentStatus !== "ALL"
    ) {
      if (
        !PAYMENT_STATUSES.includes(
          paymentStatus
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid payment status.",
          allowedPaymentStatuses:
            PAYMENT_STATUSES,
        });
      }

      filter.paymentStatus =
        paymentStatus;
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
        {
          adminNote: searchRegex,
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
      unpaidDeliveries,
      paidDeliveries,
      refundedDeliveries,
      revenueSummary,
      quotedPriceSummary,
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

      Delivery.countDocuments({
        paymentStatus: "UNPAID",
      }),

      Delivery.countDocuments({
        paymentStatus: "PAID",
      }),

      Delivery.countDocuments({
        paymentStatus: "REFUNDED",
      }),

      Delivery.aggregate([
        {
          $match: {
            paymentStatus: "PAID",
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

      Delivery.aggregate([
        {
          $group: {
            _id: null,

            totalQuotedPrice: {
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

    const totalQuotedPrice =
      quotedPriceSummary[0]
        ?.totalQuotedPrice ?? 0;

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

          unpaid: unpaidDeliveries,
          paid: paidDeliveries,
          refunded: refundedDeliveries,

          totalRevenue,
          totalQuotedPrice,
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

/*
|--------------------------------------------------------------------------
| UPDATE DELIVERY STATUS
|--------------------------------------------------------------------------
*/

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

/*
|--------------------------------------------------------------------------
| UPDATE DELIVERY PRICE
|--------------------------------------------------------------------------
*/

exports.updateDeliveryPrice = async (
  req,
  res
) => {
  try {
    const deliveryId = String(
      req.params.id ?? ""
    ).trim();

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

    const deliveryFee = toValidAmount(
      req.body.deliveryFee ??
        req.body.price ??
        req.body.amount
    );

    if (deliveryFee === null) {
      return res.status(400).json({
        success: false,
        message:
          "Enter a valid delivery price.",
      });
    }

    const paymentStatus =
      normalizePaymentStatus(
        req.body.paymentStatus ??
          "UNPAID"
      );

    if (
      !PAYMENT_STATUSES.includes(
        paymentStatus
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid payment status.",
        allowedPaymentStatuses:
          PAYMENT_STATUSES,
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

    const previousDeliveryFee =
      Number(delivery.deliveryFee ?? 0);

    const previousPaymentStatus =
      delivery.paymentStatus;

    delivery.deliveryFee =
      deliveryFee;

    delivery.paymentStatus =
      paymentStatus;

    if (
      req.body.adminNote !== undefined
    ) {
      delivery.adminNote = String(
        req.body.adminNote ?? ""
      ).trim();
    }

    if (
      paymentStatus === "PAID" &&
      delivery.paidAt == null
    ) {
      delivery.paidAt = new Date();
    }

    if (
      paymentStatus === "REFUNDED" &&
      delivery.refundedAt == null
    ) {
      delivery.refundedAt = new Date();
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
        "Delivery price updated successfully.",

      data: {
        delivery: updatedDelivery,

        previousDeliveryFee,
        currentDeliveryFee:
          deliveryFee,

        previousPaymentStatus,
        currentPaymentStatus:
          paymentStatus,
      },
    });
  } catch (error) {
    console.error(
      "Update delivery price error:",
      error
    );

    if (
      error.name === "ValidationError"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid delivery price information.",
        error: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message:
        "Failed to update delivery price.",
      error: error.message,
    });
  }
};

/*
|--------------------------------------------------------------------------
| GET ADMIN USERS
|--------------------------------------------------------------------------
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

    const skip = (page - 1) * limit;

    const search = String(
      req.query.search ?? ""
    ).trim();

    const role = String(
      req.query.role ?? ""
    )
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, "_");

    const status = String(
      req.query.status ?? ""
    )
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, "_");

    const allowedRoles = [
      "CUSTOMER",
      "AGENT",
      "STATE_MANAGER",
      "ZONAL_MANAGER",
      "HEAD_OFFICE",
    ];

    const allowedStatuses = [
      "ACTIVE",
      "SUSPENDED",
      "BLOCKED",
      "PENDING",
    ];

    const filter = {};

    if (role && role !== "ALL") {
      if (!allowedRoles.includes(role)) {
        return res.status(400).json({
          success: false,
          message: "Invalid user role.",
          allowedRoles,
        });
      }

      filter.role = role;
    }

    if (
      status &&
      status !== "ALL"
    ) {
      if (
        !allowedStatuses.includes(status)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid account status.",
          allowedStatuses,
        });
      }

      filter.status = status;
    }

    if (search) {
      const safeSearch =
        escapeRegex(search);

      const searchRegex =
        new RegExp(
          safeSearch,
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
        {
          state: searchRegex,
        },
        {
          lga: searchRegex,
        },
        {
          zone: searchRegex,
        },
      ];

      if (
        mongoose.Types.ObjectId.isValid(
          search
        )
      ) {
        filter.$or.push({
          _id:
            new mongoose.Types.ObjectId(
              search
            ),
        });
      }
    }

    const [
      users,
      filteredTotal,
      totalUsers,
      activeUsers,
      suspendedUsers,
      blockedUsers,
      pendingUsers,
      totalCustomers,
      totalAgents,
      totalStateManagers,
      totalZonalManagers,
      totalHeadOffice,
    ] = await Promise.all([
      User.find(filter)
        .select(
          "-password"
        )
        .sort({
          createdAt: -1,
        })
        .skip(skip)
        .limit(limit)
        .lean(),

      User.countDocuments(filter),

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
        status: "PENDING",
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
    ]);

    const totalPages = Math.max(
      1,
      Math.ceil(
        filteredTotal / limit
      )
    );

    return res.status(200).json({
      success: true,
      message:
        "Users loaded successfully.",

      users,

      data: {
        users,

        summary: {
          total: totalUsers,
          active: activeUsers,
          suspended: suspendedUsers,
          blocked: blockedUsers,
          pending: pendingUsers,

          customers: totalCustomers,
          agents: totalAgents,
          stateManagers:
            totalStateManagers,
          zonalManagers:
            totalZonalManagers,
          headOffice:
            totalHeadOffice,
        },

        pagination: {
          page,
          currentPage: page,
          limit,
          total: filteredTotal,
          totalItems:
            filteredTotal,
          totalPages,
          hasNextPage:
            page < totalPages,
          hasPreviousPage:
            page > 1,
        },

        total: filteredTotal,
        totalUsers:
          filteredTotal,
        currentPage: page,
        totalPages,
      },

      pagination: {
        page,
        currentPage: page,
        limit,
        total: filteredTotal,
        totalItems:
          filteredTotal,
        totalPages,
        hasNextPage:
          page < totalPages,
        hasPreviousPage:
          page > 1,
      },

      total: filteredTotal,
      totalUsers:
        filteredTotal,
      currentPage: page,
      totalPages,
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
|--------------------------------------------------------------------------
| ADMIN USER MANAGEMENT
|--------------------------------------------------------------------------
*/

const ADMIN_CREATABLE_ROLES = [
  "ZONAL_MANAGER",
  "STATE_MANAGER",
  "AGENT",
];

const USER_STATUSES = [
  "ACTIVE",
  "SUSPENDED",
  "BLOCKED",
];

const normalizeUserRole = (value = "") => {
  return String(value)
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
};

const normalizeUserStatus = (value = "") => {
  return String(value)
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
};

const generateUniqueReferralCode = async (
  role
) => {
  const prefixes = {
    AGENT: "AGT",
    STATE_MANAGER: "STM",
    ZONAL_MANAGER: "ZNM",
  };

  const prefix = prefixes[role] || "SP";

  let referralCode;
  let exists = true;

  while (exists) {
    const randomNumber = Math.floor(
      100000 + Math.random() * 900000
    );

    referralCode = `${prefix}${randomNumber}`;

    exists = await User.exists({
      referralCode,
    });
  }

  return referralCode;
};

/*
|--------------------------------------------------------------------------
| CREATE AGENT / STATE MANAGER / ZONAL MANAGER
|--------------------------------------------------------------------------
*/

exports.createAdminUser = async (
  req,
  res
) => {
  try {
    const fullName = String(
      req.body.fullName ??
        req.body.name ??
        ""
    ).trim();

    const phone = String(
      req.body.phone ?? ""
    ).trim();

    const email = String(
      req.body.email ?? ""
    )
      .trim()
      .toLowerCase();

    const password = String(
      req.body.password ?? ""
    );

    const role = normalizeUserRole(
      req.body.role
    );

    const status =
      normalizeUserStatus(
        req.body.status ?? "ACTIVE"
      );

    const zone = String(
      req.body.zone ?? ""
    ).trim();

    const state = String(
      req.body.state ?? ""
    ).trim();

    const lga = String(
      req.body.lga ?? ""
    ).trim();

    const zonalManagerId = String(
      req.body.zonalManagerId ?? ""
    ).trim();

    const stateManagerId = String(
      req.body.stateManagerId ?? ""
    ).trim();

    if (!fullName) {
      return res.status(400).json({
        success: false,
        message: "Full name is required.",
      });
    }

    if (!phone) {
      return res.status(400).json({
        success: false,
        message:
          "Phone number is required.",
      });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({
        success: false,
        message:
          "Password must contain at least 6 characters.",
      });
    }

    if (
      !ADMIN_CREATABLE_ROLES.includes(role)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Admin can only create Agent, State Manager or Zonal Manager accounts.",
        allowedRoles:
          ADMIN_CREATABLE_ROLES,
      });
    }

    if (!USER_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid account status.",
        allowedStatuses: USER_STATUSES,
      });
    }

    const existingConditions = [
      { phone },
    ];

    if (email) {
      existingConditions.push({ email });
    }

    const existingUser =
      await User.findOne({
        $or: existingConditions,
      }).lean();

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message:
          "A user with this phone number or email already exists.",
      });
    }

    let selectedZonalManager = null;
    let selectedStateManager = null;

    if (role === "ZONAL_MANAGER") {
      if (!zone) {
        return res.status(400).json({
          success: false,
          message:
            "Zone is required for a Zonal Manager.",
        });
      }
    }

    if (role === "STATE_MANAGER") {
      if (!zone || !state) {
        return res.status(400).json({
          success: false,
          message:
            "Zone and state are required for a State Manager.",
        });
      }

      if (
        !mongoose.Types.ObjectId.isValid(
          zonalManagerId
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Select a valid Zonal Manager.",
        });
      }

      selectedZonalManager =
        await User.findOne({
          _id: zonalManagerId,
          role: "ZONAL_MANAGER",
        });

      if (!selectedZonalManager) {
        return res.status(404).json({
          success: false,
          message:
            "The selected Zonal Manager was not found.",
        });
      }

      if (
        selectedZonalManager.status !==
        "ACTIVE"
      ) {
        return res.status(400).json({
          success: false,
          message:
            "The selected Zonal Manager is not active.",
        });
      }
    }

    if (role === "AGENT") {
      if (!zone || !state || !lga) {
        return res.status(400).json({
          success: false,
          message:
            "Zone, state and LGA are required for an Agent.",
        });
      }

      if (
        !mongoose.Types.ObjectId.isValid(
          stateManagerId
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Select a valid State Manager.",
        });
      }

      selectedStateManager =
        await User.findOne({
          _id: stateManagerId,
          role: "STATE_MANAGER",
        });

      if (!selectedStateManager) {
        return res.status(404).json({
          success: false,
          message:
            "The selected State Manager was not found.",
        });
      }

      if (
        selectedStateManager.status !==
        "ACTIVE"
      ) {
        return res.status(400).json({
          success: false,
          message:
            "The selected State Manager is not active.",
        });
      }

      if (
        selectedStateManager
          .zonalManagerId
      ) {
        selectedZonalManager =
          await User.findById(
            selectedStateManager
              .zonalManagerId
          );
      }
    }

    const referralCode =
      await generateUniqueReferralCode(
        role
      );

    const newUser = await User.create({
      fullName,
      phone,
      email: email || undefined,
      password,
      role,
      status,

      zone: zone || null,
      state: state || null,
      lga: lga || null,

      zonalManagerId:
        role === "STATE_MANAGER"
          ? selectedZonalManager?._id
          : role === "AGENT"
            ? selectedZonalManager?._id ||
              selectedStateManager
                ?.zonalManagerId ||
              null
            : null,

      stateManagerId:
        role === "AGENT"
          ? selectedStateManager?._id
          : null,

      agentId: null,
      referralCode,
      walletBalance: 0,
      commissionBalance: 0,
      totalEarnings: 0,
      totalTransactions: 0,
    });

    const createdUser =
      await User.findById(newUser._id)
        .select("-password")
        .populate(
          "zonalManagerId",
          "fullName phone email role zone state status"
        )
        .populate(
          "stateManagerId",
          "fullName phone email role zone state lga status"
        )
        .lean();

    return res.status(201).json({
      success: true,
      message:
        `${role.replaceAll("_", " ")} created successfully.`,
      data: {
        user: createdUser,
      },
      user: createdUser,
    });
  } catch (error) {
    console.error(
      "Create admin user error:",
      error
    );

    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message:
          "Phone number, email or referral code already exists.",
      });
    }

    return res.status(500).json({
      success: false,
      message:
        "Failed to create user.",
      error: error.message,
    });
  }
};

/*
|--------------------------------------------------------------------------
| UPDATE USER STATUS
|--------------------------------------------------------------------------
*/

exports.updateAdminUserStatus = async (
  req,
  res
) => {
  try {
    const userId = String(
      req.params.id ?? ""
    ).trim();

    const status =
      normalizeUserStatus(
        req.body.status
      );

    if (
      !mongoose.Types.ObjectId.isValid(
        userId
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID.",
      });
    }

    if (!USER_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid account status.",
        allowedStatuses: USER_STATUSES,
      });
    }

    const user = await User.findById(
      userId
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message:
          "User was not found.",
      });
    }

    if (
      user.role === "HEAD_OFFICE" &&
      String(user._id) ===
        String(req.user._id)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "You cannot suspend or block your own Head Office account.",
      });
    }

    const previousStatus = user.status;
    user.status = status;

    await user.save();

    const updatedUser =
      await User.findById(user._id)
        .select("-password")
        .lean();

    return res.status(200).json({
      success: true,
      message:
        "User status updated successfully.",
      data: {
        user: updatedUser,
        previousStatus,
        currentStatus: status,
      },
      user: updatedUser,
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
      error: error.message,
    });
  }
};

/*
|--------------------------------------------------------------------------
| UPDATE USER ROLE
|--------------------------------------------------------------------------
*/

exports.updateAdminUserRole = async (
  req,
  res
) => {
  try {
    const userId = String(
      req.params.id ?? ""
    ).trim();

    const role = normalizeUserRole(
      req.body.role
    );

    if (
      !mongoose.Types.ObjectId.isValid(
        userId
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID.",
      });
    }

    if (
      !ADMIN_CREATABLE_ROLES.includes(role)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Role can only be changed to Agent, State Manager or Zonal Manager.",
        allowedRoles:
          ADMIN_CREATABLE_ROLES,
      });
    }

    const user = await User.findById(
      userId
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message:
          "User was not found.",
      });
    }

    if (user.role === "HEAD_OFFICE") {
      return res.status(403).json({
        success: false,
        message:
          "Head Office role cannot be changed.",
      });
    }

    const previousRole = user.role;
    user.role = role;

    if (role === "ZONAL_MANAGER") {
      user.zone = String(
        req.body.zone ??
          user.zone ??
          ""
      ).trim();

      if (!user.zone) {
        return res.status(400).json({
          success: false,
          message:
            "Zone is required for a Zonal Manager.",
        });
      }

      user.state = null;
      user.lga = null;
      user.zonalManagerId = null;
      user.stateManagerId = null;
      user.agentId = null;
    }

    if (role === "STATE_MANAGER") {
      const zonalManagerId = String(
        req.body.zonalManagerId ?? ""
      ).trim();

      if (
        !mongoose.Types.ObjectId.isValid(
          zonalManagerId
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Select a valid Zonal Manager.",
        });
      }

      const zonalManager =
        await User.findOne({
          _id: zonalManagerId,
          role: "ZONAL_MANAGER",
          status: "ACTIVE",
        });

      if (!zonalManager) {
        return res.status(404).json({
          success: false,
          message:
            "Active Zonal Manager was not found.",
        });
      }

      user.zone = String(
        req.body.zone ??
          zonalManager.zone ??
          ""
      ).trim();

      user.state = String(
        req.body.state ??
          user.state ??
          ""
      ).trim();

      if (!user.zone || !user.state) {
        return res.status(400).json({
          success: false,
          message:
            "Zone and state are required.",
        });
      }

      user.lga = null;
      user.zonalManagerId =
        zonalManager._id;
      user.stateManagerId = null;
      user.agentId = null;
    }

    if (role === "AGENT") {
      const stateManagerId = String(
        req.body.stateManagerId ?? ""
      ).trim();

      if (
        !mongoose.Types.ObjectId.isValid(
          stateManagerId
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Select a valid State Manager.",
        });
      }

      const stateManager =
        await User.findOne({
          _id: stateManagerId,
          role: "STATE_MANAGER",
          status: "ACTIVE",
        });

      if (!stateManager) {
        return res.status(404).json({
          success: false,
          message:
            "Active State Manager was not found.",
        });
      }

      user.zone = String(
        req.body.zone ??
          stateManager.zone ??
          ""
      ).trim();

      user.state = String(
        req.body.state ??
          stateManager.state ??
          ""
      ).trim();

      user.lga = String(
        req.body.lga ??
          user.lga ??
          ""
      ).trim();

      if (
        !user.zone ||
        !user.state ||
        !user.lga
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Zone, state and LGA are required.",
        });
      }

      user.zonalManagerId =
        stateManager.zonalManagerId ||
        null;

      user.stateManagerId =
        stateManager._id;

      user.agentId = null;
    }

    if (!user.referralCode) {
      user.referralCode =
        await generateUniqueReferralCode(
          role
        );
    }

    await user.save();

    const updatedUser =
      await User.findById(user._id)
        .select("-password")
        .populate(
          "zonalManagerId",
          "fullName phone email role zone state status"
        )
        .populate(
          "stateManagerId",
          "fullName phone email role zone state lga status"
        )
        .lean();

    return res.status(200).json({
      success: true,
      message:
        "User role updated successfully.",
      data: {
        user: updatedUser,
        previousRole,
        currentRole: role,
      },
      user: updatedUser,
    });
  } catch (error) {
    console.error(
      "Update admin user role error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to update user role.",
      error: error.message,
    });
  }
};
