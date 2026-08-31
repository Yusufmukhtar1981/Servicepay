const mongoose = require("mongoose");

const User = require("../models/user.model");
const Transaction = require(
  "../models/transaction.model"
);
const Delivery = require(
  "../models/delivery.model"
);
const {
  sendAssignmentAlertIfOnline,
  sendAssignmentCancellation,
} = require("../services/riderDeliveryAlert.service");
const { randomUUID } = require("crypto");

const {
  creditRiderCommissionIfEligible,
} = require(
  "../services/riderCommission.service"
);

const {
  getExecutiveDashboard,
} = require("../services/adminDashboard.service");

exports.getAdminExecutiveDashboard = getExecutiveDashboard;

const DELIVERY_STATUSES = [
  "PENDING",
  "ASSIGNED",
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

const COMMISSION_TYPES = [
  "PERCENTAGE",
  "FIXED",
];

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

const toPositiveInteger = (
  value,
  fallback,
  maximum = 100
) => {
  const parsed = Number.parseInt(
    value,
    10
  );

  if (
    !Number.isFinite(parsed) ||
    parsed < 1
  ) {
    return fallback;
  }

  return Math.min(
    parsed,
    maximum
  );
};

const toValidAmount = (
  value
) => {
  const parsed = Number(value);

  if (
    !Number.isFinite(parsed) ||
    parsed < 0
  ) {
    return null;
  }

  return Number(
    parsed.toFixed(2)
  );
};

const escapeRegex = (
  value = ""
) => {
  return String(value).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
};

const normalizeDeliveryStatus = (
  value = ""
) => {
  return String(value)
    .trim()
    .toUpperCase()
    .replace(
      /[\s-]+/g,
      "_"
    );
};

const normalizePaymentStatus = (
  value = ""
) => {
  return String(value)
    .trim()
    .toUpperCase()
    .replace(
      /[\s-]+/g,
      "_"
    );
};

/*
 * Branch-scoped delivery staff may only access their own stamped records.
 * Head Office remains global, including deliberately retained legacy null
 * branch records.
 */
const deliveryBranchFilter = (req) => {
  if (req.staffAccess?.isHeadOffice ||
      req.staffAccess?.scope?.type === "GLOBAL") {
    return {};
  }

  const scope = req.staffAccess?.scope;
  if (scope?.type !== "BRANCH") {
    return {};
  }

  const branchId = req.branchScope?._id || scope.branchId;
  return branchId ? { branchId } : { _id: null };
};

const findAdminDeliveryForResponse = (
  req,
  deliveryId
) => {
  return Delivery.findOne({
    _id: deliveryId,
    ...deliveryBranchFilter(req),
  })
    .select([
      "customerId", "trackingNumber", "pickupState", "deliveryState",
      "pickupAddress", "deliveryAddress", "senderName", "senderPhone",
      "receiverName", "receiverPhone", "packageName",
      "packageDescription", "packageWeight", "deliveryFee",
      "paymentStatus", "paidAt", "refundedAt", "status",
      "assignedRiderId", "riderName", "riderPhone", "assignedBy",
      "assignedAt", "riderAcceptedAt", "riderRejectedAt",
      "riderRejectionReason", "adminNote", "acceptedAt", "pickedUpAt",
      "inTransitAt", "deliveredAt", "cancelledAt", "failedAt",
      "riderCommissionType", "riderCommissionValue",
      "riderCommissionAmount", "servicepayProfit",
      "riderCommissionStatus", "createdAt", "updatedAt",
    ].join(" "))
    .populate("customerId", "fullName role status")
    .populate(
      "assignedRiderId",
      "riderId fullName role status vehicleType plateNumber riderState riderLga availabilityStatus riderVerificationStatus"
    )
    .populate("assignedBy", "fullName role")
    .lean();
};

const normalizeCommissionType = (
  value = ""
) => {
  return String(value)
    .trim()
    .toUpperCase()
    .replace(
      /[\s-]+/g,
      "_"
    );
};

const normalizeUserRole = (
  value = ""
) => {
  return String(value)
    .trim()
    .toUpperCase()
    .replace(
      /[\s-]+/g,
      "_"
    );
};

const normalizeUserStatus = (
  value = ""
) => {
  return String(value)
    .trim()
    .toUpperCase()
    .replace(
      /[\s-]+/g,
      "_"
    );
};

const generateUniqueReferralCode =
  async (
    role
  ) => {
    const prefixes = {
      AGENT: "AGT",
      STATE_MANAGER: "STM",
      ZONAL_MANAGER: "ZNM",
    };

    const prefix =
      prefixes[role] ||
      "SP";

    let referralCode;
    let exists = true;

    while (exists) {
      const randomNumber =
        Math.floor(
          100000 +
            Math.random() *
              900000
        );

      referralCode =
        `${prefix}${randomNumber}`;

      exists =
        await User.exists({
          referralCode,
        });
    }

    return referralCode;
  };

/*
|--------------------------------------------------------------------------
| ADMIN DASHBOARD
|--------------------------------------------------------------------------
*/

exports.getAdminDashboard =
  async (
    req,
    res
  ) => {
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
        totalDeliveryRiders,
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
        assignedDeliveries,
        deliveredDeliveries,
        creditedDeliveryCommissions,
        pendingDeliverySettlements,
        deliveryProfitSummary,
      ] =
        await Promise.all([
          User.countDocuments(),

          User.countDocuments({
            status: "ACTIVE",
          }),

          User.countDocuments({
            status:
              "SUSPENDED",
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
            role:
              "STATE_MANAGER",
          }),

          User.countDocuments({
            role:
              "ZONAL_MANAGER",
          }),

          User.countDocuments({
            role:
              "DELIVERY_RIDER",
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
              [
                "fullName",
                "name",
                "email",
                "phone",
                "role",
                "status",
                "createdAt",
              ].join(" ")
            )
            .sort({
              createdAt: -1,
            })
            .limit(5)
            .lean(),

          Transaction.find()
            .populate(
              "customerId",
              [
                "fullName",
                "name",
                "email",
                "phone",
                "role",
                "status",
              ].join(" ")
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
                      input:
                        "$amount",
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
                      input:
                        "$walletBalance",
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
            status:
              "ASSIGNED",
          }),

          Delivery.countDocuments({
            status:
              "DELIVERED",
          }),

          Delivery.countDocuments({
            riderCommissionStatus:
              "CREDITED",
          }),

          Delivery.countDocuments({
            riderCommissionStatus:
              "CREDITED",
            riderCommissionCredited:
              true,
          }),

          Delivery.aggregate([
            {
              $group: {
                _id: null,

                totalDeliveryRevenue: {
                  $sum: {
                    $convert: {
                      input:
                        "$deliveryFee",
                      to: "double",
                      onError: 0,
                      onNull: 0,
                    },
                  },
                },

                totalRiderCommission: {
                  $sum: {
                    $convert: {
                      input:
                        "$riderCommissionAmount",
                      to: "double",
                      onError: 0,
                      onNull: 0,
                    },
                  },
                },

                totalDeliveryProfit: {
                  $sum: {
                    $convert: {
                      input:
                        "$servicepayProfit",
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
        transactionSummary[0]
          ?.totalVolume ??
        0;

      const transactionProfit =
        transactionSummary[0]
          ?.totalProfit ??
        0;

      const totalWalletBalance =
        walletSummary[0]
          ?.totalWalletBalance ??
        0;

      const totalDeliveryRevenue =
        deliveryProfitSummary[0]
          ?.totalDeliveryRevenue ??
        0;

      const totalRiderCommission =
        deliveryProfitSummary[0]
          ?.totalRiderCommission ??
        0;

      const totalDeliveryProfit =
        deliveryProfitSummary[0]
          ?.totalDeliveryProfit ??
        0;

      const servicepayProfit =
        Number(
          (
            Number(
              transactionProfit
            ) +
            Number(
              totalDeliveryProfit
            )
          ).toFixed(2)
        );

      return res
        .status(200)
        .json({
          success: true,

          data: {
            users: {
              total:
                totalUsers,
              active:
                activeUsers,
              suspended:
                suspendedUsers,
              blocked:
                blockedUsers,
              customers:
                totalCustomers,
              agents:
                totalAgents,
              stateManagers:
                totalStateManagers,
              zonalManagers:
                totalZonalManagers,
              deliveryRiders:
                totalDeliveryRiders,
            },

            kyc: {
              pending: 0,
            },

            wallets: {
              totalWalletBalance,
              totalBalance:
                totalWalletBalance,
            },

            transactions: {
              total:
                totalTransactions,
              totalVolume,
              totalValue:
                totalVolume,
              successful:
                successfulTransactions,
              pending:
                pendingTransactions,
              failed:
                failedTransactions,
              servicepayProfit:
                transactionProfit,
            },

            deliveries: {
              total:
                totalDeliveries,
              pending:
                pendingDeliveries,
              assigned:
                assignedDeliveries,
              delivered:
                deliveredDeliveries,

              creditedCommissions:
                creditedDeliveryCommissions,

              pendingSettlements:
                pendingDeliverySettlements,

              totalRevenue:
                totalDeliveryRevenue,

              totalRiderCommission,

              servicepayProfit:
                totalDeliveryProfit,
            },

            servicepay: {
              transactionProfit,
              deliveryProfit:
                totalDeliveryProfit,
              totalProfit:
                servicepayProfit,
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

      return res
        .status(500)
        .json({
          success: false,
          message:
            "Failed to load admin dashboard.",
          error:
            error.message,
        });
    }
  };

/*
|--------------------------------------------------------------------------
| ADMIN TRANSACTIONS
|--------------------------------------------------------------------------
*/

exports.getAdminTransactions =
  async (
    req,
    res
  ) => {
    try {
      const page =
        toPositiveInteger(
          req.query.page,
          1,
          100000
        );

      const limit =
        toPositiveInteger(
          req.query.limit,
          20,
          100
        );

      const skip =
        (page - 1) *
        limit;

      const search = String(
        req.query.search ??
          ""
      ).trim();

      const status = String(
        req.query.status ??
          ""
      )
        .trim()
        .toUpperCase();

      const serviceType =
        String(
          req.query
            .serviceType ??
            req.query.service ??
            ""
        )
          .trim()
          .toUpperCase();

      const filter = {};

      if (
        status &&
        status !== "ALL"
      ) {
        if (
          status ===
            "SUCCESS" ||
          status ===
            "SUCCESSFUL" ||
          status ===
            "COMPLETED"
        ) {
          filter.status = {
            $in: [
              "SUCCESS",
              "SUCCESSFUL",
              "COMPLETED",
              "APPROVED",
            ],
          };
        } else if (
          status === "FAILED"
        ) {
          filter.status = {
            $in: [
              "FAILED",
              "CANCELLED",
              "REJECTED",
            ],
          };
        } else if (
          status === "PENDING"
        ) {
          filter.status = {
            $in: [
              "PENDING",
              "PROCESSING",
            ],
          };
        } else if (
          status ===
            "REFUNDED" ||
          status ===
            "REVERSED"
        ) {
          filter.status = {
            $in: [
              "REFUNDED",
              "REVERSED",
            ],
          };
        } else {
          filter.status =
            status;
        }
      }

      if (
        serviceType &&
        serviceType !== "ALL"
      ) {
        filter.serviceType =
          serviceType;
      }

      if (search) {
        const safeSearch =
          escapeRegex(
            search
          );

        const searchRegex =
          new RegExp(
            safeSearch,
            "i"
          );

        const matchingUsers =
          await User.find({
            $or: [
              {
                fullName:
                  searchRegex,
              },
              {
                name:
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
            ],
          })
            .select("_id")
            .limit(500)
            .lean();

        const userIds =
          matchingUsers.map(
            (
              user
            ) =>
              user._id
          );

        const searchConditions =
          [
            {
              reference:
                searchRegex,
            },
            {
              provider:
                searchRegex,
            },
            {
              phone:
                searchRegex,
            },
          ];

        if (
          mongoose.Types
            .ObjectId.isValid(
              search
            )
        ) {
          searchConditions.push({
            _id:
              new mongoose.Types
                .ObjectId(
                  search
                ),
          });
        }

        if (
          userIds.length >
          0
        ) {
          searchConditions.push({
            customerId: {
              $in: userIds,
            },
          });
        }

        filter.$or =
          searchConditions;
      }

      const [
        transactions,
        totalTransactions,
      ] =
        await Promise.all([
          Transaction.find(
            filter
          )
            .populate(
              "customerId",
              [
                "fullName",
                "name",
                "email",
                "phone",
                "role",
                "status",
              ].join(" ")
            )
            .sort({
              createdAt: -1,
            })
            .skip(skip)
            .limit(limit)
            .lean(),

          Transaction.countDocuments(
            filter
          ),
        ]);

      const totalPages =
        Math.max(
          1,
          Math.ceil(
            totalTransactions /
              limit
          )
        );

      return res
        .status(200)
        .json({
          success: true,
          message:
            "Transactions loaded successfully.",

          data: {
            transactions,

            pagination: {
              page,
              currentPage:
                page,
              limit,
              total:
                totalTransactions,
              totalItems:
                totalTransactions,
              totalPages,
              hasNextPage:
                page <
                totalPages,
              hasPreviousPage:
                page > 1,
            },

            total:
              totalTransactions,

            totalTransactions,

            currentPage:
              page,

            totalPages,
          },
        });
    } catch (error) {
      console.error(
        "Get admin transactions error:",
        error
      );

      return res
        .status(500)
        .json({
          success: false,
          message:
            "Failed to load admin transactions.",
          error:
            error.message,
        });
    }
  };
  /*
|--------------------------------------------------------------------------
| GET ADMIN DELIVERIES
|--------------------------------------------------------------------------
*/

exports.getAdminDeliveries =
  async (
    req,
    res
  ) => {
    try {
      const page =
        toPositiveInteger(
          req.query.page,
          1,
          100000
        );

      const limit =
        toPositiveInteger(
          req.query.limit,
          20,
          100
        );

      const skip =
        (page - 1) *
        limit;

      const search =
        String(
          req.query.search ??
            ""
        ).trim();

      const status =
        normalizeDeliveryStatus(
          req.query.status ??
            ""
        );

      const paymentStatus =
        normalizePaymentStatus(
          req.query
            .paymentStatus ??
            ""
        );

      const scopedDeliveryFilter =
        deliveryBranchFilter(req);
      const filter = {
        ...scopedDeliveryFilter,
      };

      if (
        status &&
        status !== "ALL"
      ) {
        if (
          !DELIVERY_STATUSES
            .includes(
              status
            )
        ) {
          return res
            .status(400)
            .json({
              success: false,
              message:
                "Invalid delivery status.",
              allowedStatuses:
                DELIVERY_STATUSES,
            });
        }

        filter.status =
          status;
      }

      if (
        paymentStatus &&
        paymentStatus !==
          "ALL"
      ) {
        if (
          !PAYMENT_STATUSES
            .includes(
              paymentStatus
            )
        ) {
          return res
            .status(400)
            .json({
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
          escapeRegex(
            search
          );

        const searchRegex =
          new RegExp(
            safeSearch,
            "i"
          );

        const matchingUsers =
          await User.find({
            $or: [
              {
                fullName:
                  searchRegex,
              },
              {
                name:
                  searchRegex,
              },
              {
                email:
                  searchRegex,
              },
              {
                phone:
                  searchRegex,
              },
            ],
          })
            .select("_id")
            .limit(500)
            .lean();

        const userIds =
          matchingUsers.map(
            (
              user
            ) =>
              user._id
          );

        const searchConditions =
          [
            {
              trackingNumber:
                searchRegex,
            },
            {
              pickupAddress:
                searchRegex,
            },
            {
              deliveryAddress:
                searchRegex,
            },
            {
              senderName:
                searchRegex,
            },
            {
              senderPhone:
                searchRegex,
            },
            {
              receiverName:
                searchRegex,
            },
            {
              receiverPhone:
                searchRegex,
            },
            {
              packageName:
                searchRegex,
            },
            {
              packageDescription:
                searchRegex,
            },
            {
              riderName:
                searchRegex,
            },
            {
              riderPhone:
                searchRegex,
            },
            {
              adminNote:
                searchRegex,
            },
          ];

        if (
          mongoose.Types
            .ObjectId.isValid(
              search
            )
        ) {
          searchConditions.push({
            _id:
              new mongoose.Types
                .ObjectId(
                  search
                ),
          });
        }

        if (
          userIds.length >
          0
        ) {
          searchConditions.push({
            customerId: {
              $in:
                userIds,
            },
          });
        }

        filter.$or =
          searchConditions;
      }

      const [
        deliveries,
        filteredTotal,
        totalDeliveries,
        pendingDeliveries,
        assignedDeliveries,
        acceptedDeliveries,
        pickedUpDeliveries,
        inTransitDeliveries,
        deliveredDeliveries,
        cancelledDeliveries,
        failedDeliveries,
        unpaidDeliveries,
        paidDeliveries,
        refundedDeliveries,
        pendingCommissionDeliveries,
        creditedCommissionDeliveries,
        settledCommissionDeliveries,
        revenueSummary,
      ] =
        await Promise.all([
          Delivery.find(
            filter
          )
            .populate(
              "customerId",
              [
                "fullName",
                "name",
                "email",
                "phone",
                "role",
                "status",
              ].join(" ")
            )
            .populate(
              "assignedRiderId",
              [
                "riderId",
                "fullName",
                "name",
                "email",
                "phone",
                "role",
                "status",
                "vehicleType",
                "plateNumber",
                "riderState",
                "riderLga",
                "availabilityStatus",
                "riderVerificationStatus",
                "totalRiderEarnings",
                "pendingRiderSettlement",
                "settledRiderEarnings",
              ].join(" ")
            )
            .populate(
              "assignedBy",
              [
                "fullName",
                "email",
                "phone",
                "role",
              ].join(" ")
            )
            .sort({
              createdAt: -1,
            })
            .skip(skip)
            .limit(limit)
            .lean(),

          Delivery.countDocuments(
            filter
          ),

          Delivery.countDocuments(
            scopedDeliveryFilter
          ),

          Delivery.countDocuments({
            ...scopedDeliveryFilter,
            status:
              "PENDING",
          }),

          Delivery.countDocuments({
            ...scopedDeliveryFilter,
            status:
              "ASSIGNED",
          }),

          Delivery.countDocuments({
            ...scopedDeliveryFilter,
            status:
              "ACCEPTED",
          }),

          Delivery.countDocuments({
            ...scopedDeliveryFilter,
            status:
              "PICKED_UP",
          }),

          Delivery.countDocuments({
            ...scopedDeliveryFilter,
            status:
              "IN_TRANSIT",
          }),

          Delivery.countDocuments({
            ...scopedDeliveryFilter,
            status:
              "DELIVERED",
          }),

          Delivery.countDocuments({
            ...scopedDeliveryFilter,
            status:
              "CANCELLED",
          }),

          Delivery.countDocuments({
            ...scopedDeliveryFilter,
            status:
              "FAILED",
          }),

          Delivery.countDocuments({
            ...scopedDeliveryFilter,
            paymentStatus:
              "UNPAID",
          }),

          Delivery.countDocuments({
            ...scopedDeliveryFilter,
            paymentStatus:
              "PAID",
          }),

          Delivery.countDocuments({
            ...scopedDeliveryFilter,
            paymentStatus:
              "REFUNDED",
          }),

          Delivery.countDocuments({
            ...scopedDeliveryFilter,
            riderCommissionStatus:
              "PENDING",
          }),

          Delivery.countDocuments({
            ...scopedDeliveryFilter,
            riderCommissionStatus:
              "CREDITED",
          }),

          Delivery.countDocuments({
            ...scopedDeliveryFilter,
            riderCommissionStatus:
              "SETTLED",
          }),

          Delivery.aggregate([
            { $match: scopedDeliveryFilter },
            {
              $group: {
                _id: null,

                totalQuotedPrice: {
                  $sum: {
                    $convert: {
                      input:
                        "$deliveryFee",
                      to: "double",
                      onError: 0,
                      onNull: 0,
                    },
                  },
                },

                totalPaidRevenue: {
                  $sum: {
                    $cond: [
                      {
                        $eq: [
                          "$paymentStatus",
                          "PAID",
                        ],
                      },
                      {
                        $convert: {
                          input:
                            "$deliveryFee",
                          to: "double",
                          onError: 0,
                          onNull: 0,
                        },
                      },
                      0,
                    ],
                  },
                },

                totalRiderCommission: {
                  $sum: {
                    $convert: {
                      input:
                        "$riderCommissionAmount",
                      to: "double",
                      onError: 0,
                      onNull: 0,
                    },
                  },
                },

                totalServicepayProfit: {
                  $sum: {
                    $convert: {
                      input:
                        "$servicepayProfit",
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

      const totalPages =
        Math.max(
          1,
          Math.ceil(
            filteredTotal /
              limit
          )
        );

      const totalQuotedPrice =
        revenueSummary[0]
          ?.totalQuotedPrice ??
        0;

      const totalRevenue =
        revenueSummary[0]
          ?.totalPaidRevenue ??
        0;

      const totalRiderCommission =
        revenueSummary[0]
          ?.totalRiderCommission ??
        0;

      const servicepayProfit =
        revenueSummary[0]
          ?.totalServicepayProfit ??
        0;

      return res
        .status(200)
        .json({
          success: true,
          message:
            "Deliveries loaded successfully.",

          data: {
            deliveries,

            summary: {
              total:
                totalDeliveries,

              pending:
                pendingDeliveries,

              assigned:
                assignedDeliveries,

              accepted:
                acceptedDeliveries,

              pickedUp:
                pickedUpDeliveries,

              inTransit:
                inTransitDeliveries,

              delivered:
                deliveredDeliveries,

              cancelled:
                cancelledDeliveries,

              failed:
                failedDeliveries,

              unpaid:
                unpaidDeliveries,

              paid:
                paidDeliveries,

              refunded:
                refundedDeliveries,

              pendingCommissions:
                pendingCommissionDeliveries,

              creditedCommissions:
                creditedCommissionDeliveries,

              settledCommissions:
                settledCommissionDeliveries,

              totalRevenue,

              totalQuotedPrice,

              totalRiderCommission,

              servicepayProfit,
            },

            pagination: {
              page,
              currentPage:
                page,
              limit,
              total:
                filteredTotal,
              totalItems:
                filteredTotal,
              totalPages,
              hasNextPage:
                page <
                totalPages,
              hasPreviousPage:
                page > 1,
            },

            total:
              filteredTotal,

            totalDeliveries:
              filteredTotal,

            currentPage:
              page,

            totalPages,
          },
        });
    } catch (error) {
      console.error(
        "Get admin deliveries error:",
        error
      );

      return res
        .status(500)
        .json({
          success: false,
          message:
            "Failed to load deliveries.",
          error:
            error.message,
        });
    }
  };

/*
|--------------------------------------------------------------------------
| GET AVAILABLE DELIVERY RIDERS
|--------------------------------------------------------------------------
*/

exports.getAvailableRiders =
  async (
    req,
    res
  ) => {
    try {
      const deliveryId =
        String(
          req.params.id ??
            ""
        ).trim();

      if (
        !mongoose.Types
          .ObjectId.isValid(
            deliveryId
          )
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Invalid delivery ID.",
          });
      }

      const delivery =
        await Delivery.findOne({
          _id: deliveryId,
          ...deliveryBranchFilter(req),
        }).lean();

      if (!delivery) {
        return res
          .status(404)
          .json({
            success: false,
            message:
              "Delivery was not found.",
          });
      }

      const assignable =
        delivery.status ===
          "PENDING" &&
        !delivery.assignedRiderId;

      const riders =
        assignable
          ? await User.find({
          role:
            "DELIVERY_RIDER",
          // Riders are selected from the delivery tenant, not the actor's
          // request payload or a global rider pool.
          branchId: delivery.branchId || null,

          status:
            "ACTIVE",

          riderVerificationStatus:
            "VERIFIED",

          availabilityStatus:
            "ONLINE",
        })
          .select(
            [
              "_id",
              "riderId",
              "fullName",
              "phone",
              "email",
              "vehicleType",
              "plateNumber",
              "riderState",
              "riderLga",
              "availabilityStatus",
              "riderRating",
              "totalAssignedDeliveries",
              "totalCompletedDeliveries",
              "totalRiderEarnings",
              "pendingRiderSettlement",
            ].join(" ")
          )
          .sort({
            riderRating:
              -1,

            createdAt:
              -1,
          })
          .lean()
          : [];

      return res
        .status(200)
        .json({
          success: true,
          message:
            riders.length > 0
              ? "Available riders loaded successfully."
              : assignable
                ? "No riders are currently available."
                : "This delivery is not available for rider assignment.",

          data: {
            delivery,
            riders,
            count:
              riders.length,
            assignable,
          },

          riders,
          count:
            riders.length,
        });
    } catch (error) {
      console.error(
        "Get available riders error:",
        error
      );

      return res
        .status(500)
        .json({
          success: false,
          message:
            "Failed to load available riders.",
          error:
            error.message,
        });
    }
  };

/*
|--------------------------------------------------------------------------
| ASSIGN RIDER TO DELIVERY
|--------------------------------------------------------------------------
*/

exports.assignRiderToDelivery =
  async (
    req,
    res
  ) => {
    try {
      const deliveryId =
        String(
          req.params.id ??
            ""
        ).trim();

      const riderId =
        String(
          req.body.riderId ??
            req.body
              .assignedRiderId ??
            ""
        ).trim();

      if (
        !mongoose.Types
          .ObjectId.isValid(
            deliveryId
          )
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Invalid delivery ID.",
          });
      }

      if (
        !mongoose.Types
          .ObjectId.isValid(
            riderId
          )
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Select a valid rider.",
          });
      }

      const scopedDelivery = await Delivery.findOne({
        _id: deliveryId,
        ...deliveryBranchFilter(req),
      }).select("branchId").lean();

      if (!scopedDelivery) {
        return res.status(404).json({
          success: false,
          message: "Delivery was not found.",
        });
      }

      const session =
        await mongoose.startSession();
      const assignmentEventId =
        randomUUID();
      const assignedAt =
        new Date();
      let rider;
      let delivery;

      try {
        await session.withTransaction(
          async () => {
            rider =
              await User.findOne({
                _id:
                  riderId,
                role:
                  "DELIVERY_RIDER",
                status:
                  "ACTIVE",
                riderVerificationStatus:
                  "VERIFIED",
                availabilityStatus:
                  "ONLINE",
                branchId:
                  scopedDelivery.branchId || null,
              }).session(
                session
              );

            if (!rider) {
              const existingRider =
                await User.findOne({
                  _id:
                    riderId,
                  role:
                    "DELIVERY_RIDER",
                })
                  .select(
                    "status riderVerificationStatus availabilityStatus"
                  )
                  .session(
                    session
                  )
                  .lean();

              const error =
                new Error(
                  existingRider
                    ? "The selected rider is no longer online and available."
                    : "Delivery Rider was not found."
                );
              error.statusCode =
                existingRider
                  ? 409
                  : 404;
              throw error;
            }

            const adminNote =
              req.body.adminNote ===
              undefined
                ? undefined
                : String(
                    req.body
                      .adminNote ??
                      ""
                  ).trim();
            const setValues = {
              assignedRiderId:
                rider._id,
              riderName:
                rider.fullName ||
                "",
              riderPhone:
                rider.phone ||
                "",
              assignedBy:
                req.user?._id ??
                null,
              assignedAt,
              assignmentEventId,
              riderAcceptedAt:
                null,
              riderRejectedAt:
                null,
              riderRejectionReason:
                "",
              status:
                "ASSIGNED",
            };
            if (
              adminNote !==
              undefined
            ) {
              setValues.adminNote =
                adminNote;
            }

            delivery =
              await Delivery.findOneAndUpdate(
                {
                  _id:
                    deliveryId,
                  ...deliveryBranchFilter(req),
                  status:
                    "PENDING",
                  $or: [
                    {
                      assignedRiderId:
                        null,
                    },
                    {
                      assignedRiderId: {
                        $exists:
                          false,
                      },
                    },
                  ],
                },
                {
                  $set:
                    setValues,
                },
                {
                  returnDocument:
                    "after",
                  runValidators:
                    true,
                  session,
                }
              );

            if (!delivery) {
              const existingDelivery =
                await Delivery.findOne({
                  _id: deliveryId,
                  ...deliveryBranchFilter(req),
                })
                  .select(
                    "status assignedRiderId"
                  )
                  .session(
                    session
                  )
                  .lean();

              const error =
                new Error(
                  !existingDelivery
                    ? "Delivery was not found."
                    : existingDelivery
                        .assignedRiderId
                      ? "This delivery already has a rider assigned."
                      : `A ${String(existingDelivery.status || "current").toLowerCase()} delivery cannot be assigned.`
                );
              error.statusCode =
                !existingDelivery
                  ? 404
                  : 409;
              throw error;
            }

            await User.updateOne(
              {
                _id:
                  rider._id,
              },
              {
                $inc: {
                  totalAssignedDeliveries:
                    1,
                },
              },
              {
                session,
              }
            );
          }
        );
      } finally {
        await session.endSession();
      }

      // Alerts are best-effort and run only after all business persistence.
      try {
        await sendAssignmentAlertIfOnline({ rider, delivery });
      } catch (error) {
        console.error(
          "DELIVERY ASSIGNMENT ALERT ERROR:",
          error?.message || "Unable to dispatch the rider alert."
        );
      }

      const updatedDelivery =
        await findAdminDeliveryForResponse(
          req,
          delivery._id
        );

      return res
        .status(200)
        .json({
          success: true,
          message:
            `${rider.fullName} has been assigned successfully.`,

          data: {
            delivery:
              updatedDelivery,

            rider: {
              id:
                rider._id,

              riderId:
                rider.riderId ||
                null,

              fullName:
                rider.fullName,

              phone:
                rider.phone,

              availabilityStatus:
                rider
                  .availabilityStatus,
            },
          },

          delivery:
            updatedDelivery,
        });
    } catch (error) {
      if (
        Number.isInteger(
          error?.statusCode
        )
      ) {
        return res
          .status(
            error.statusCode
          )
          .json({
            success: false,
            message:
              error.message,
          });
      }

      console.error(
        "Assign rider error:",
        error
      );

      if (
        error?.name ===
        "ValidationError"
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Invalid rider assignment information.",
            error:
              error.message,
          });
      }

      return res
        .status(500)
        .json({
          success: false,
          message:
            "Failed to assign rider.",
          error:
            error.message,
        });
    }
  };
  /*
|--------------------------------------------------------------------------
| UNASSIGN RIDER FROM DELIVERY
|--------------------------------------------------------------------------
*/

exports.unassignRiderFromDelivery =
  async (
    req,
    res
  ) => {
    try {
      const deliveryId =
        String(
          req.params.id ??
            ""
        ).trim();

      if (
        !mongoose.Types
          .ObjectId.isValid(
            deliveryId
          )
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Invalid delivery ID.",
          });
      }

      const delivery =
        await Delivery.findOne({
          _id: deliveryId,
          ...deliveryBranchFilter(req),
        });

      if (!delivery) {
        return res
          .status(404)
          .json({
            success: false,
            message:
              "Delivery was not found.",
          });
      }

      if (
        [
          "PICKED_UP",
          "IN_TRANSIT",
          "DELIVERED",
        ].includes(
          delivery.status
        )
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "The rider cannot be removed after pickup.",
          });
      }

      const previousRiderId =
        delivery
          .assignedRiderId
          ? String(
              delivery
                .assignedRiderId
            )
          : "";
      const previousAssignmentEventId = delivery.assignmentEventId;

      delivery.assignedRiderId =
        null;

      delivery.riderName =
        "";

      delivery.riderPhone =
        "";

      delivery.assignedBy =
        null;

      delivery.assignedAt =
        null;

      delivery.assignmentEventId =
        null;

      delivery.riderAcceptedAt =
        null;

      delivery.riderRejectedAt =
        null;

      delivery.riderRejectionReason =
        "";

      delivery.status =
        "PENDING";

      if (
        req.body.adminNote !==
        undefined
      ) {
        delivery.adminNote =
          String(
            req.body
              .adminNote ??
              ""
          ).trim();
      }

      await delivery.save();

      if (previousRiderId) {
        await User.updateOne(
          {
            _id:
              previousRiderId,

            totalAssignedDeliveries: {
              $gt: 0,
            },
          },
          {
            $inc: {
              totalAssignedDeliveries:
                -1,
            },
          }
        );
        if (previousAssignmentEventId) {
          try {
            await sendAssignmentCancellation({
              riderId: previousRiderId,
              delivery,
              assignmentEventId: previousAssignmentEventId,
            });
          } catch (error) {
            console.error(
              "DELIVERY CANCELLATION ALERT ERROR:",
              error?.message || "Unable to dispatch the rider cancellation."
            );
          }
        }
      }

      const updatedDelivery =
        await findAdminDeliveryForResponse(
          req,
          delivery._id
        );

      return res
        .status(200)
        .json({
          success: true,
          message:
            "Rider removed successfully.",

          data: {
            delivery:
              updatedDelivery,
          },

          delivery:
            updatedDelivery,
        });
    } catch (error) {
      console.error(
        "Unassign rider error:",
        error
      );

      return res
        .status(500)
        .json({
          success: false,
          message:
            "Failed to remove rider.",
          error:
            error.message,
        });
    }
  };

/*
|--------------------------------------------------------------------------
| UPDATE DELIVERY STATUS
|--------------------------------------------------------------------------
*/

exports.updateDeliveryStatus =
  async (
    req,
    res
  ) => {
    try {
      const deliveryId =
        String(
          req.params.id ??
            ""
        ).trim();

      const status =
        normalizeDeliveryStatus(
          req.body.status
        );

      if (
        !mongoose.Types
          .ObjectId.isValid(
            deliveryId
          )
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Invalid delivery ID.",
          });
      }

      if (!status) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Delivery status is required.",
          });
      }

      if (
        !DELIVERY_STATUSES
          .includes(
            status
          )
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Invalid delivery status.",
            allowedStatuses:
              DELIVERY_STATUSES,
          });
      }

      const delivery =
        await Delivery.findOne({
          _id: deliveryId,
          ...deliveryBranchFilter(req),
        });

      if (!delivery) {
        return res
          .status(404)
          .json({
            success: false,
            message:
              "Delivery was not found.",
          });
      }

      const previousStatus =
        delivery.status;

      if (
        status ===
          "ASSIGNED" &&
        !delivery
          .assignedRiderId
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Assign a rider before changing the delivery status to ASSIGNED.",
          });
      }

      delivery.status =
        status;

      if (
        req.body.adminNote !==
        undefined
      ) {
        delivery.adminNote =
          String(
            req.body
              .adminNote ??
              ""
          ).trim();
      }

      const now =
        new Date();

      if (
        status ===
        "ACCEPTED"
      ) {
        delivery.acceptedAt =
          delivery
            .acceptedAt ??
          now;

        delivery.riderAcceptedAt =
          delivery
            .riderAcceptedAt ??
          now;
      }

      if (
        status ===
        "PICKED_UP"
      ) {
        delivery.pickedUpAt =
          delivery
            .pickedUpAt ??
          now;
      }

      if (
        status ===
        "IN_TRANSIT"
      ) {
        delivery.inTransitAt =
          delivery
            .inTransitAt ??
          now;
      }

      if (
        status ===
        "DELIVERED"
      ) {
        delivery.deliveredAt =
          delivery
            .deliveredAt ??
          now;
      }

      if (
        status ===
        "CANCELLED"
      ) {
        delivery.cancelledAt =
          delivery
            .cancelledAt ??
          now;

        if (
          delivery
            .riderCommissionCredited !==
          true
        ) {
          delivery.riderCommissionStatus =
            "CANCELLED";
        }
      }

      if (
        status ===
        "FAILED"
      ) {
        delivery.failedAt =
          delivery
            .failedAt ??
          now;

        if (
          delivery
            .riderCommissionCredited !==
          true
        ) {
          delivery.riderCommissionStatus =
            "CANCELLED";
        }
      }

      await delivery.save();

      let commissionResult = {
        credited: false,
        amount: 0,
        servicepayProfit: 0,
        reason: "",
      };

      if (
        status ===
        "DELIVERED"
      ) {
        commissionResult =
          await creditRiderCommissionIfEligible(
            {
              deliveryId:
                delivery._id,

              riderId:
                delivery
                  .assignedRiderId,
            }
          );
      }

      const updatedDelivery =
        await findAdminDeliveryForResponse(
          req,
          delivery._id
        );

      let message =
        "Delivery status updated successfully.";

      if (
        status ===
          "DELIVERED" &&
        commissionResult
          .credited
      ) {
        message =
          `Delivery completed. ₦${Number(
            commissionResult
              .amount
          ).toFixed(
            2
          )} Rider commission was credited automatically.`;
      }

      return res
        .status(200)
        .json({
          success: true,
          message,

          data: {
            delivery:
              updatedDelivery,

            previousStatus,

            currentStatus:
              status,

            commission: {
              credited:
                commissionResult
                  .credited,

              amount:
                commissionResult
                  .amount,

              servicepayProfit:
                commissionResult
                  .servicepayProfit,

              reason:
                commissionResult
                  .reason,
            },
          },

          delivery:
            updatedDelivery,
        });
    } catch (error) {
      console.error(
        "Update delivery status error:",
        error
      );

      if (
        error?.name ===
        "ValidationError"
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Invalid delivery information.",
            error:
              error.message,
          });
      }

      return res
        .status(500)
        .json({
          success: false,
          message:
            "Failed to update delivery status.",
          error:
            error.message,
        });
    }
  };

/*
|--------------------------------------------------------------------------
| UPDATE DELIVERY PRICE AND RIDER COMMISSION
|--------------------------------------------------------------------------
*/

exports.updateDeliveryPrice =
  async (
    req,
    res
  ) => {
    try {
      const deliveryId =
        String(
          req.params.id ??
            ""
        ).trim();

      if (
        !mongoose.Types
          .ObjectId.isValid(
            deliveryId
          )
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Invalid delivery ID.",
          });
      }

      const deliveryFee =
        toValidAmount(
          req.body
            .deliveryFee ??
            req.body.price ??
            req.body.amount
        );

      if (
        deliveryFee ===
        null
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Enter a valid delivery price.",
          });
      }

      const paymentStatus =
        normalizePaymentStatus(
          req.body
            .paymentStatus ??
            "UNPAID"
        );

      if (
        !PAYMENT_STATUSES
          .includes(
            paymentStatus
          )
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Invalid payment status.",
            allowedPaymentStatuses:
              PAYMENT_STATUSES,
          });
      }

      const commissionType =
        normalizeCommissionType(
          req.body
            .riderCommissionType ??
            req.body
              .commissionType ??
            "PERCENTAGE"
        );

      if (
        !COMMISSION_TYPES
          .includes(
            commissionType
          )
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Commission type must be PERCENTAGE or FIXED.",
            allowedCommissionTypes:
              COMMISSION_TYPES,
          });
      }

      const commissionValue =
        toValidAmount(
          req.body
            .riderCommissionValue ??
            req.body
              .commissionValue ??
            80
        );

      if (
        commissionValue ===
        null
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Enter a valid Rider commission value.",
          });
      }

      if (
        commissionType ===
          "PERCENTAGE" &&
        commissionValue >
          100
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Percentage commission cannot exceed 100%.",
          });
      }

      if (
        commissionType ===
          "FIXED" &&
        commissionValue >
          deliveryFee
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Fixed Rider commission cannot exceed the delivery price.",
          });
      }

      const delivery =
        await Delivery.findOne({
          _id: deliveryId,
          ...deliveryBranchFilter(req),
        });

      if (!delivery) {
        return res
          .status(404)
          .json({
            success: false,
            message:
              "Delivery was not found.",
          });
      }

      if (
        delivery
          .riderCommissionCredited ===
          true &&
        (
          Number(
            delivery
              .deliveryFee ||
              0
          ) !==
            deliveryFee ||
          delivery
            .riderCommissionType !==
            commissionType ||
          Number(
            delivery
              .riderCommissionValue ||
              0
          ) !==
            commissionValue
        )
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "The delivery price or commission cannot be changed after Rider commission has been credited.",
          });
      }

      const previousDeliveryFee =
        Number(
          delivery
            .deliveryFee ??
            0
        );

      const previousPaymentStatus =
        delivery
          .paymentStatus;

      const previousCommissionType =
        delivery
          .riderCommissionType;

      const previousCommissionValue =
        Number(
          delivery
            .riderCommissionValue ??
            0
        );

      delivery.deliveryFee =
        deliveryFee;

      delivery.paymentStatus =
        paymentStatus;

      delivery.riderCommissionType =
        commissionType;

      delivery.riderCommissionValue =
        commissionValue;

      if (
        paymentStatus ===
          "PAID" &&
        !delivery.paidAt
      ) {
        delivery.paidAt =
          new Date();
      }

      if (
        paymentStatus !==
        "PAID"
      ) {
        delivery.paidAt =
          null;
      }

      if (
        paymentStatus ===
          "REFUNDED" &&
        !delivery
          .refundedAt
      ) {
        delivery.refundedAt =
          new Date();
      }

      if (
        paymentStatus !==
        "REFUNDED"
      ) {
        delivery.refundedAt =
          null;
      }

      if (
        req.body.adminNote !==
        undefined
      ) {
        delivery.adminNote =
          String(
            req.body
              .adminNote ??
              ""
          ).trim();
      }

      const calculation =
        delivery
          .calculateCommission();

      if (
        delivery
          .riderCommissionCredited !==
        true
      ) {
        delivery.riderCommissionStatus =
          "PENDING";
      }

      await delivery.save();

      const commissionResult =
        await creditRiderCommissionIfEligible(
          {
            deliveryId:
              delivery._id,

            riderId:
              delivery
                .assignedRiderId,
          }
        );

      const updatedDelivery =
        await findAdminDeliveryForResponse(
          req,
          delivery._id
        );

      let message =
        "Delivery price and Rider commission updated successfully.";

      if (
        commissionResult
          .credited
      ) {
        message =
          `Delivery price updated. ₦${Number(
            commissionResult
              .amount
          ).toFixed(
            2
          )} was credited automatically to the Rider's pending settlement.`;
      } else if (
        paymentStatus ===
          "PAID" &&
        delivery.status !==
          "DELIVERED"
      ) {
        message =
          "Payment confirmed. Rider commission will be credited automatically after delivery is completed.";
      }

      return res
        .status(200)
        .json({
          success: true,
          message,

          data: {
            delivery:
              updatedDelivery,

            previousDeliveryFee,

            currentDeliveryFee:
              deliveryFee,

            previousPaymentStatus,

            currentPaymentStatus:
              paymentStatus,

            previousCommissionType,

            currentCommissionType:
              commissionType,

            previousCommissionValue,

            currentCommissionValue:
              commissionValue,

            riderCommissionAmount:
              calculation
                .riderCommissionAmount,

            servicepayProfit:
              calculation
                .servicepayProfit,

            commission: {
              credited:
                commissionResult
                  .credited,

              amount:
                commissionResult
                  .amount,

              servicepayProfit:
                commissionResult
                  .servicepayProfit,

              reason:
                commissionResult
                  .reason,
            },
          },

          delivery:
            updatedDelivery,
        });
    } catch (error) {
      console.error(
        "Update delivery price error:",
        error
      );

      if (
        error?.name ===
        "ValidationError"
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Invalid delivery price or commission information.",
            error:
              error.message,
          });
      }

      return res
        .status(500)
        .json({
          success: false,
          message:
            "Failed to update delivery price and commission.",
          error:
            error.message,
        });
    }
  };
  /*
|--------------------------------------------------------------------------
| GET ADMIN USERS
|--------------------------------------------------------------------------
*/

exports.getAdminUsers =
  async (
    req,
    res
  ) => {
    try {
      const page =
        toPositiveInteger(
          req.query.page,
          1,
          100000
        );

      const limit =
        toPositiveInteger(
          req.query.limit,
          20,
          100
        );

      const skip =
        (page - 1) *
        limit;

      const search =
        String(
          req.query.search ??
            ""
        ).trim();

      const role =
        normalizeUserRole(
          req.query.role ??
            ""
        );

      const status =
        normalizeUserStatus(
          req.query.status ??
            ""
        );

      const allowedRoles = [
        "CUSTOMER",
        "AGENT",
        "STATE_MANAGER",
        "ZONAL_MANAGER",
        "HEAD_OFFICE",
        "STAFF",
        "DELIVERY_RIDER",
      ];

      const allowedStatuses = [
        "ACTIVE",
        "SUSPENDED",
        "BLOCKED",
      ];

      const filter = {};

      if (
        role &&
        role !== "ALL"
      ) {
        if (
          !allowedRoles.includes(
            role
          )
        ) {
          return res
            .status(400)
            .json({
              success: false,
              message:
                "Invalid user role.",
              allowedRoles,
            });
        }

        filter.role =
          role;
      }

      if (
        status &&
        status !== "ALL"
      ) {
        if (
          !allowedStatuses.includes(
            status
          )
        ) {
          return res
            .status(400)
            .json({
              success: false,
              message:
                "Invalid account status.",
              allowedStatuses,
            });
        }

        filter.status =
          status;
      }

      if (search) {
        const safeSearch =
          escapeRegex(
            search
          );

        const searchRegex =
          new RegExp(
            safeSearch,
            "i"
          );

        filter.$or = [
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
          {
            riderId:
              searchRegex,
          },
          {
            plateNumber:
              searchRegex,
          },
        ];

        if (
          mongoose.Types
            .ObjectId.isValid(
              search
            )
        ) {
          filter.$or.push({
            _id:
              new mongoose.Types
                .ObjectId(
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
        totalCustomers,
        totalAgents,
        totalStateManagers,
        totalZonalManagers,
        totalHeadOffice,
        totalStaff,
        totalDeliveryRiders,
      ] =
        await Promise.all([
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

          User.countDocuments(
            filter
          ),

          User.countDocuments(),

          User.countDocuments({
            status:
              "ACTIVE",
          }),

          User.countDocuments({
            status:
              "SUSPENDED",
          }),

          User.countDocuments({
            status:
              "BLOCKED",
          }),

          User.countDocuments({
            role:
              "CUSTOMER",
          }),

          User.countDocuments({
            role:
              "AGENT",
          }),

          User.countDocuments({
            role:
              "STATE_MANAGER",
          }),

          User.countDocuments({
            role:
              "ZONAL_MANAGER",
          }),

          User.countDocuments({
            role:
              "HEAD_OFFICE",
          }),

          User.countDocuments({
            role:
              "STAFF",
          }),

          User.countDocuments({
            role:
              "DELIVERY_RIDER",
          }),
        ]);

      const totalPages =
        Math.max(
          1,
          Math.ceil(
            filteredTotal /
              limit
          )
        );

      const summary = {
        total:
          totalUsers,

        active:
          activeUsers,

        suspended:
          suspendedUsers,

        blocked:
          blockedUsers,

        customers:
          totalCustomers,

        agents:
          totalAgents,

        stateManagers:
          totalStateManagers,

        zonalManagers:
          totalZonalManagers,

        headOffice:
          totalHeadOffice,

        staff:
          totalStaff,

        deliveryRiders:
          totalDeliveryRiders,
      };

      const pagination = {
        page,

        currentPage:
          page,

        limit,

        total:
          filteredTotal,

        totalItems:
          filteredTotal,

        totalPages,

        hasNextPage:
          page <
          totalPages,

        hasPreviousPage:
          page > 1,
      };

      return res
        .status(200)
        .json({
          success: true,

          message:
            "Users loaded successfully.",

          users,

          data: {
            users,
            summary,
            pagination,

            total:
              filteredTotal,

            totalUsers:
              filteredTotal,

            currentPage:
              page,

            totalPages,
          },

          summary,
          pagination,

          total:
            filteredTotal,

          totalUsers:
            filteredTotal,

          currentPage:
            page,

          totalPages,
        });
    } catch (error) {
      console.error(
        "Get admin users error:",
        error
      );

      return res
        .status(500)
        .json({
          success: false,

          message:
            "Failed to load users.",

          error:
            error.message,
        });
    }
  };

/*
|--------------------------------------------------------------------------
| CREATE AGENT / STATE MANAGER / ZONAL MANAGER
|--------------------------------------------------------------------------
*/

exports.createAdminUser =
  async (
    req,
    res
  ) => {
    try {
      const fullName =
        String(
          req.body
            .fullName ??
            req.body.name ??
            ""
        ).trim();

      const phone =
        String(
          req.body.phone ??
            ""
        ).trim();

      const email =
        String(
          req.body.email ??
            ""
        )
          .trim()
          .toLowerCase();

      const password =
        String(
          req.body.password ??
            ""
        );

      const role =
        normalizeUserRole(
          req.body.role
        );

      const status =
        normalizeUserStatus(
          req.body.status ??
            "ACTIVE"
        );

      const zone =
        String(
          req.body.zone ??
            ""
        ).trim();

      const state =
        String(
          req.body.state ??
            ""
        ).trim();

      const lga =
        String(
          req.body.lga ??
            ""
        ).trim();

      const zonalManagerId =
        String(
          req.body
            .zonalManagerId ??
            ""
        ).trim();

      const stateManagerId =
        String(
          req.body
            .stateManagerId ??
            ""
        ).trim();

      if (!fullName) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Full name is required.",
          });
      }

      if (!phone) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Phone number is required.",
          });
      }

      if (
        !password ||
        password.length <
          6
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Password must contain at least 6 characters.",
          });
      }

      if (
        !ADMIN_CREATABLE_ROLES
          .includes(
            role
          )
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Admin can only create Agent, State Manager or Zonal Manager accounts.",
            allowedRoles:
              ADMIN_CREATABLE_ROLES,
          });
      }

      if (
        !USER_STATUSES.includes(
          status
        )
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Invalid account status.",
            allowedStatuses:
              USER_STATUSES,
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
        return res
          .status(409)
          .json({
            success: false,
            message:
              "A user with this phone number or email already exists.",
          });
      }

      let selectedZonalManager =
        null;

      let selectedStateManager =
        null;

      if (
        role ===
        "ZONAL_MANAGER"
      ) {
        if (!zone) {
          return res
            .status(400)
            .json({
              success: false,
              message:
                "Zone is required for a Zonal Manager.",
            });
        }
      }

      if (
        role ===
        "STATE_MANAGER"
      ) {
        if (
          !zone ||
          !state
        ) {
          return res
            .status(400)
            .json({
              success: false,
              message:
                "Zone and state are required for a State Manager.",
            });
        }

        if (
          !mongoose.Types
            .ObjectId.isValid(
              zonalManagerId
            )
        ) {
          return res
            .status(400)
            .json({
              success: false,
              message:
                "Select a valid Zonal Manager.",
            });
        }

        selectedZonalManager =
          await User.findOne({
            _id:
              zonalManagerId,

            role:
              "ZONAL_MANAGER",
          });

        if (
          !selectedZonalManager
        ) {
          return res
            .status(404)
            .json({
              success: false,
              message:
                "The selected Zonal Manager was not found.",
            });
        }

        if (
          selectedZonalManager
            .status !==
          "ACTIVE"
        ) {
          return res
            .status(400)
            .json({
              success: false,
              message:
                "The selected Zonal Manager is not active.",
            });
        }
      }

      if (
        role ===
        "AGENT"
      ) {
        if (
          !zone ||
          !state ||
          !lga
        ) {
          return res
            .status(400)
            .json({
              success: false,
              message:
                "Zone, state and LGA are required for an Agent.",
            });
        }

        if (
          !mongoose.Types
            .ObjectId.isValid(
              stateManagerId
            )
        ) {
          return res
            .status(400)
            .json({
              success: false,
              message:
                "Select a valid State Manager.",
            });
        }

        selectedStateManager =
          await User.findOne({
            _id:
              stateManagerId,

            role:
              "STATE_MANAGER",
          });

        if (
          !selectedStateManager
        ) {
          return res
            .status(404)
            .json({
              success: false,
              message:
                "The selected State Manager was not found.",
            });
        }

        if (
          selectedStateManager
            .status !==
          "ACTIVE"
        ) {
          return res
            .status(400)
            .json({
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

      const newUser =
        await User.create({
          fullName,
          phone,

          email:
            email ||
            undefined,

          password,
          role,
          status,

          zone:
            zone ||
            null,

          state:
            state ||
            null,

          lga:
            lga ||
            null,

          zonalManagerId:
            role ===
            "STATE_MANAGER"
              ? selectedZonalManager
                  ?._id
              : role ===
                  "AGENT"
                ? selectedZonalManager
                      ?._id ||
                  selectedStateManager
                    ?.zonalManagerId ||
                  null
                : null,

          stateManagerId:
            role ===
            "AGENT"
              ? selectedStateManager
                  ?._id
              : null,

          agentId:
            null,

          referralCode,

          walletBalance:
            0,

          commissionBalance:
            0,

          totalEarnings:
            0,

          totalTransactions:
            0,
        });

      const createdUser =
        await User.findById(
          newUser._id
        )
          .select(
            "-password"
          )
          .populate(
            "zonalManagerId",
            [
              "fullName",
              "phone",
              "email",
              "role",
              "zone",
              "state",
              "status",
            ].join(" ")
          )
          .populate(
            "stateManagerId",
            [
              "fullName",
              "phone",
              "email",
              "role",
              "zone",
              "state",
              "lga",
              "status",
            ].join(" ")
          )
          .lean();

      return res
        .status(201)
        .json({
          success: true,

          message:
            `${role.replaceAll(
              "_",
              " "
            )} created successfully.`,

          data: {
            user:
              createdUser,
          },

          user:
            createdUser,
        });
    } catch (error) {
      console.error(
        "Create admin user error:",
        error
      );

      if (
        error?.code ===
        11000
      ) {
        return res
          .status(409)
          .json({
            success: false,
            message:
              "Phone number, email or referral code already exists.",
          });
      }

      if (
        error?.name ===
        "ValidationError"
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Invalid user information.",
            error:
              error.message,
          });
      }

      return res
        .status(500)
        .json({
          success: false,
          message:
            "Failed to create user.",
          error:
            error.message,
        });
    }
  };
  /*
|--------------------------------------------------------------------------
| UPDATE USER STATUS
|--------------------------------------------------------------------------
*/

exports.updateAdminUserStatus =
  async (
    req,
    res
  ) => {
    try {
      const userId =
        String(
          req.params.id ??
            ""
        ).trim();

      const status =
        normalizeUserStatus(
          req.body.status
        );

      if (
        !mongoose.Types
          .ObjectId.isValid(
            userId
          )
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Invalid user ID.",
          });
      }

      if (
        !USER_STATUSES.includes(
          status
        )
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Invalid account status.",
            allowedStatuses:
              USER_STATUSES,
          });
      }

      const user =
        await User.findById(
          userId
        );

      if (!user) {
        return res
          .status(404)
          .json({
            success: false,
            message:
              "User was not found.",
          });
      }

      if (
        user.role ===
          "HEAD_OFFICE" &&
        String(user._id) ===
          String(
            req.user?._id
          )
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "You cannot suspend or block your own Head Office account.",
          });
      }

      const previousStatus =
        user.status;

      user.status =
        status;

      if (
        user.role ===
          "DELIVERY_RIDER" &&
        status !==
          "ACTIVE"
      ) {
        user.availabilityStatus =
          "OFFLINE";
      }

      await user.save();

      const updatedUser =
        await User.findById(
          user._id
        )
          .select(
            "-password"
          )
          .lean();

      return res
        .status(200)
        .json({
          success: true,

          message:
            "User status updated successfully.",

          data: {
            user:
              updatedUser,

            previousStatus,

            currentStatus:
              status,
          },

          user:
            updatedUser,
        });
    } catch (error) {
      console.error(
        "Update admin user status error:",
        error
      );

      return res
        .status(500)
        .json({
          success: false,

          message:
            "Failed to update user status.",

          error:
            error.message,
        });
    }
  };

/*
|--------------------------------------------------------------------------
| UPDATE USER ROLE
|--------------------------------------------------------------------------
*/

exports.updateAdminUserRole =
  async (
    req,
    res
  ) => {
    try {
      const userId =
        String(
          req.params.id ??
            ""
        ).trim();

      const role =
        normalizeUserRole(
          req.body.role
        );

      if (
        !mongoose.Types
          .ObjectId.isValid(
            userId
          )
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Invalid user ID.",
          });
      }

      if (
        !ADMIN_CREATABLE_ROLES
          .includes(
            role
          )
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Role can only be changed to Agent, State Manager or Zonal Manager.",
            allowedRoles:
              ADMIN_CREATABLE_ROLES,
          });
      }

      const user =
        await User.findById(
          userId
        );

      if (!user) {
        return res
          .status(404)
          .json({
            success: false,
            message:
              "User was not found.",
          });
      }

      if (
        user.role ===
        "HEAD_OFFICE"
      ) {
        return res
          .status(403)
          .json({
            success: false,
            message:
              "Head Office role cannot be changed.",
          });
      }

      if (
        user.role ===
        "DELIVERY_RIDER"
      ) {
        return res
          .status(403)
          .json({
            success: false,
            message:
              "Delivery Rider roles must be managed from the Riders section.",
          });
      }

      const previousRole =
        user.role;

      user.role =
        role;

      if (
        role ===
        "ZONAL_MANAGER"
      ) {
        user.zone =
          String(
            req.body.zone ??
              user.zone ??
              ""
          ).trim();

        if (!user.zone) {
          return res
            .status(400)
            .json({
              success: false,
              message:
                "Zone is required for a Zonal Manager.",
            });
        }

        user.state =
          null;

        user.lga =
          null;

        user.zonalManagerId =
          null;

        user.stateManagerId =
          null;

        user.agentId =
          null;
      }

      if (
        role ===
        "STATE_MANAGER"
      ) {
        const zonalManagerId =
          String(
            req.body
              .zonalManagerId ??
              ""
          ).trim();

        if (
          !mongoose.Types
            .ObjectId.isValid(
              zonalManagerId
            )
        ) {
          return res
            .status(400)
            .json({
              success: false,
              message:
                "Select a valid Zonal Manager.",
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
          return res
            .status(404)
            .json({
              success: false,
              message:
                "Active Zonal Manager was not found.",
            });
        }

        user.zone =
          String(
            req.body.zone ??
              zonalManager.zone ??
              ""
          ).trim();

        user.state =
          String(
            req.body.state ??
              user.state ??
              ""
          ).trim();

        if (
          !user.zone ||
          !user.state
        ) {
          return res
            .status(400)
            .json({
              success: false,
              message:
                "Zone and state are required.",
            });
        }

        user.lga =
          null;

        user.zonalManagerId =
          zonalManager._id;

        user.stateManagerId =
          null;

        user.agentId =
          null;
      }

      if (
        role ===
        "AGENT"
      ) {
        const stateManagerId =
          String(
            req.body
              .stateManagerId ??
              ""
          ).trim();

        if (
          !mongoose.Types
            .ObjectId.isValid(
              stateManagerId
            )
        ) {
          return res
            .status(400)
            .json({
              success: false,
              message:
                "Select a valid State Manager.",
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
          return res
            .status(404)
            .json({
              success: false,
              message:
                "Active State Manager was not found.",
            });
        }

        user.zone =
          String(
            req.body.zone ??
              stateManager.zone ??
              ""
          ).trim();

        user.state =
          String(
            req.body.state ??
              stateManager.state ??
              ""
          ).trim();

        user.lga =
          String(
            req.body.lga ??
              user.lga ??
              ""
          ).trim();

        if (
          !user.zone ||
          !user.state ||
          !user.lga
        ) {
          return res
            .status(400)
            .json({
              success: false,
              message:
                "Zone, state and LGA are required.",
            });
        }

        user.zonalManagerId =
          stateManager
            .zonalManagerId ||
          null;

        user.stateManagerId =
          stateManager._id;

        user.agentId =
          null;
      }

      if (
        !user.referralCode
      ) {
        user.referralCode =
          await generateUniqueReferralCode(
            role
          );
      }

      await user.save();

      const updatedUser =
        await User.findById(
          user._id
        )
          .select(
            "-password"
          )
          .populate(
            "zonalManagerId",
            [
              "fullName",
              "phone",
              "email",
              "role",
              "zone",
              "state",
              "status",
            ].join(" ")
          )
          .populate(
            "stateManagerId",
            [
              "fullName",
              "phone",
              "email",
              "role",
              "zone",
              "state",
              "lga",
              "status",
            ].join(" ")
          )
          .lean();

      return res
        .status(200)
        .json({
          success: true,

          message:
            "User role updated successfully.",

          data: {
            user:
              updatedUser,

            previousRole,

            currentRole:
              role,
          },

          user:
            updatedUser,
        });
    } catch (error) {
      console.error(
        "Update admin user role error:",
        error
      );

      return res
        .status(500)
        .json({
          success: false,

          message:
            "Failed to update user role.",

          error:
            error.message,
        });
    }
  };
