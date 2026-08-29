const crypto = require("crypto");
const mongoose = require("mongoose");

const User = require(
  "../models/user.model"
);

const RiderWithdrawal = require(
  "../models/riderWithdrawal.model"
);
const { verifyTransactionPin } = require("../services/transactionPin.service");

/*
|--------------------------------------------------------------------------
| CONFIGURATION
|--------------------------------------------------------------------------
*/

const MIN_WITHDRAWAL_AMOUNT = Math.max(
  Number(
    process.env
      .RIDER_MIN_WITHDRAWAL_AMOUNT ||
      1000
  ),
  0
);

const MAX_WITHDRAWAL_AMOUNT = Math.max(
  Number(
    process.env
      .RIDER_MAX_WITHDRAWAL_AMOUNT ||
      500000
  ),
  MIN_WITHDRAWAL_AMOUNT
);

const WITHDRAWAL_FEE = Math.max(
  Number(
    process.env
      .RIDER_WITHDRAWAL_FEE ||
      0
  ),
  0
);

const ACTIVE_WITHDRAWAL_STATUSES = [
  "PENDING",
  "APPROVED",
  "PROCESSING",
];

/*
|--------------------------------------------------------------------------
| HELPERS
|--------------------------------------------------------------------------
*/

const normalizeText = (
  value = ""
) => {
  return String(value)
    .trim();
};

const normalizeStatus = (
  value = ""
) => {
  return String(value)
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
};

const normalizeDigits = (
  value = ""
) => {
  return String(value)
    .replace(/\D/g, "");
};

const roundMoney = (
  value
) => {
  const amount = Number(value || 0);

  if (!Number.isFinite(amount)) {
    return 0;
  }

  return Number(
    amount.toFixed(2)
  );
};

const isValidObjectId = (
  value
) => {
  return mongoose.Types.ObjectId
    .isValid(
      String(value || "")
    );
};

const generateWithdrawalReference =
  () => {
    const randomCode = crypto
      .randomBytes(5)
      .toString("hex")
      .toUpperCase();

    return (
      `RIDER-WD-${Date.now()}-` +
      randomCode
    );
  };

const getAuthenticatedUserId = (
  req
) => {
  return (
    req.user?._id ||
    req.user?.id ||
    req.userId ||
    null
  );
};

const getAuthenticatedRider =
  async (
    req, {
      includePin = false,
      session = null,
    } = {}
  ) => {
    const userId =
      getAuthenticatedUserId(req);

    if (!userId) {
      return null;
    }

    let query =
      User.findById(userId);

    if (includePin) {
      query = query.select(
        "+transactionPin"
      );
    }

    if (session) {
      query = query.session(
        session
      );
    }

    return query;
  };

const validateRiderAccount = (
  rider,
  res, {
    requireVerified = true,
  } = {}
) => {
  if (!rider) {
    res.status(401).json({
      success: false,
      message:
        "Authentication is required.",
    });

    return false;
  }

  if (
    normalizeStatus(
      rider.role
    ) !==
    "DELIVERY_RIDER"
  ) {
    res.status(403).json({
      success: false,
      message:
        "Only Delivery Riders can access this resource.",
    });

    return false;
  }

  if (
    normalizeStatus(
      rider.status
    ) !==
    "ACTIVE"
  ) {
    res.status(403).json({
      success: false,
      message:
        "Your rider account is not active.",
    });

    return false;
  }

  if (
    requireVerified &&
    normalizeStatus(
      rider
        .riderVerificationStatus
    ) !==
      "VERIFIED"
  ) {
    res.status(403).json({
      success: false,
      message:
        "Your rider account must be verified before you can withdraw commission.",
    });

    return false;
  }

  return true;
};

const validateHeadOffice = (
  req,
  res
) => {
  const role = normalizeStatus(
    req.user?.role
  );

  const isHeadOffice = [
    "HEAD_OFFICE",
    "HEAD_OFFICE_ADMIN",
    "SUPER_ADMIN",
    "ADMIN",
  ].includes(role);

  if (!isHeadOffice) {
    res.status(403).json({
      success: false,
      message:
        "Only Head Office can manage Rider withdrawals.",
    });

    return false;
  }

  return true;
};

const maskAccountNumber = (
  accountNumber
) => {
  const digits =
    normalizeDigits(
      accountNumber
    );

  if (digits.length <= 4) {
    return digits;
  }

  return (
    "*".repeat(
      digits.length - 4
    ) +
    digits.slice(-4)
  );
};

const withdrawalForRider = (
  withdrawal
) => {
  if (!withdrawal) {
    return null;
  }

  if (
    typeof withdrawal
      .toRiderJSON ===
    "function"
  ) {
    const result =
      withdrawal.toRiderJSON();

    if (
      result?.bank
        ?.accountNumber
    ) {
      result.bank
        .accountNumber =
        maskAccountNumber(
          result.bank
            .accountNumber
        );
    }

    return result;
  }

  return {
    id:
      withdrawal._id,

    reference:
      withdrawal.reference,

    amount:
      roundMoney(
        withdrawal.amount
      ),

    fee:
      roundMoney(
        withdrawal.fee
      ),

    totalDebit:
      roundMoney(
        withdrawal.totalDebit
      ),

    currency:
      withdrawal.currency ||
      "NGN",

    bank: {
      bankCode:
        withdrawal.bankCode,

      bankName:
        withdrawal.bankName,

      accountNumber:
        maskAccountNumber(
          withdrawal
            .accountNumber
        ),

      accountName:
        withdrawal
          .accountName,
    },

    narration:
      withdrawal.narration,

    status:
      withdrawal.status,

    rejectionReason:
      withdrawal
        .rejectionReason,

    failureReason:
      withdrawal
        .failureReason,

    requestedAt:
      withdrawal.requestedAt,

    approvedAt:
      withdrawal.approvedAt,

    processingAt:
      withdrawal.processingAt,

    paidAt:
      withdrawal.paidAt,

    rejectedAt:
      withdrawal.rejectedAt,

    failedAt:
      withdrawal.failedAt,

    provider:
      withdrawal.provider,

    providerReference:
      withdrawal
        .providerReference,

    createdAt:
      withdrawal.createdAt,

    updatedAt:
      withdrawal.updatedAt,
  };
};

const returnLockedFunds =
  async ({
    withdrawal,
    reviewedBy,
    status,
    reason,
    session,
  }) => {
    if (
      !withdrawal.fundsLocked ||
      withdrawal.fundsReturned
    ) {
      withdrawal.status =
        status;

      withdrawal.reviewedAt =
        new Date();

      withdrawal.reviewedBy =
        reviewedBy;

      return withdrawal.save({
        session,
      });
    }

    const amount =
      roundMoney(
        withdrawal.totalDebit ||
        withdrawal.amount
      );

    const updatedRider =
      await User.findOneAndUpdate(
        {
          _id:
            withdrawal.riderId,

          role:
            "DELIVERY_RIDER",
        },
        {
          $inc: {
            pendingRiderSettlement:
              amount,
          },
        },
        {
          new: true,
          session,
        }
      );

    if (!updatedRider) {
      throw new Error(
        "Delivery Rider account was not found."
      );
    }

    const now =
      new Date();

    withdrawal.status =
      status;

    withdrawal.fundsLocked =
      false;

    withdrawal.fundsReturned =
      true;

    withdrawal.reviewedAt =
      now;

    withdrawal.reviewedBy =
      reviewedBy;

    if (
      status === "REJECTED"
    ) {
      withdrawal.rejectedAt =
        now;

      withdrawal.rejectedBy =
        reviewedBy;

      withdrawal.rejectionReason =
        reason;
    }

    if (
      status === "FAILED"
    ) {
      withdrawal.failedAt =
        now;

      withdrawal.failureReason =
        reason;
    }

    return withdrawal.save({
      session,
    });
  };

/*
|--------------------------------------------------------------------------
| GET RIDER COMMISSION SUMMARY
|--------------------------------------------------------------------------
|
| GET /api/rider/commission-summary
|
*/

exports.getCommissionSummary =
  async (req, res) => {
    try {
      const rider =
        await getAuthenticatedRider(
          req
        );

      if (
        !validateRiderAccount(
          rider,
          res, {
            requireVerified:
              false,
          }
        )
      ) {
        return;
      }

      const [
        activeSummary,
        paidSummary,
        rejectedSummary,
        recentWithdrawals,
      ] = await Promise.all([
        RiderWithdrawal.aggregate([
          {
            $match: {
              riderId:
                rider._id,

              status: {
                $in:
                  ACTIVE_WITHDRAWAL_STATUSES,
              },
            },
          },
          {
            $group: {
              _id: null,

              amount: {
                $sum:
                  "$amount",
              },

              totalDebit: {
                $sum:
                  "$totalDebit",
              },

              count: {
                $sum: 1,
              },
            },
          },
        ]),

        RiderWithdrawal.aggregate([
          {
            $match: {
              riderId:
                rider._id,

              status:
                "PAID",
            },
          },
          {
            $group: {
              _id: null,

              amount: {
                $sum:
                  "$amount",
              },

              count: {
                $sum: 1,
              },
            },
          },
        ]),

        RiderWithdrawal.countDocuments({
          riderId:
            rider._id,

          status: {
            $in: [
              "REJECTED",
              "FAILED",
              "CANCELLED",
            ],
          },
        }),

        RiderWithdrawal.find({
          riderId:
            rider._id,
        })
          .sort({
            createdAt: -1,
          })
          .limit(5),
      ]);

      const availableCommission =
        roundMoney(
          rider
            .pendingRiderSettlement
        );

      const active =
        activeSummary[0] || {};

      const paid =
        paidSummary[0] || {};

      return res.status(200).json({
        success: true,
        message:
          "Rider commission summary loaded successfully.",

        data: {
          rider: {
            riderId:
              rider.riderId,

            fullName:
              rider.fullName,

            verificationStatus:
              rider
                .riderVerificationStatus,

            transactionPinSet:
              rider
                .transactionPinSet ===
              true,
          },

          summary: {
            totalCommissionEarned:
              roundMoney(
                rider
                  .totalRiderEarnings
              ),

            availableCommission,

            pendingWithdrawal:
              roundMoney(
                active.totalDebit ||
                0
              ),

            pendingWithdrawalAmount:
              roundMoney(
                active.amount ||
                0
              ),

            totalWithdrawn:
              roundMoney(
                rider
                  .settledRiderEarnings
              ),

            paidWithdrawalAmount:
              roundMoney(
                paid.amount ||
                0
              ),

            activeWithdrawalCount:
              Number(
                active.count || 0
              ),

            paidWithdrawalCount:
              Number(
                paid.count || 0
              ),

            unsuccessfulWithdrawalCount:
              rejectedSummary,

            minimumWithdrawal:
              MIN_WITHDRAWAL_AMOUNT,

            maximumWithdrawal:
              MAX_WITHDRAWAL_AMOUNT,

            withdrawalFee:
              WITHDRAWAL_FEE,
          },

          recentWithdrawals:
            recentWithdrawals.map(
              withdrawalForRider
            ),
        },

        summary: {
          totalCommissionEarned:
            roundMoney(
              rider
                .totalRiderEarnings
            ),

          availableCommission,

          pendingWithdrawal:
            roundMoney(
              active.totalDebit ||
              0
            ),

          totalWithdrawn:
            roundMoney(
              rider
                .settledRiderEarnings
            ),
        },
      });
    } catch (error) {
      console.error(
        "Get Rider commission summary error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to load Rider commission summary.",
        error:
          error.message,
      });
    }
  };

/*
|--------------------------------------------------------------------------
| GET RIDER WITHDRAWAL HISTORY
|--------------------------------------------------------------------------
|
| GET /api/rider/withdrawals
|
*/

exports.getMyWithdrawals =
  async (req, res) => {
    try {
      const rider =
        await getAuthenticatedRider(
          req
        );

      if (
        !validateRiderAccount(
          rider,
          res, {
            requireVerified:
              false,
          }
        )
      ) {
        return;
      }

      const page = Math.max(
        Number(
          req.query.page || 1
        ),
        1
      );

      const limit = Math.min(
        Math.max(
          Number(
            req.query.limit || 20
          ),
          1
        ),
        100
      );

      const status =
        normalizeStatus(
          req.query.status
        );

      const filter = {
        riderId:
          rider._id,
      };

      if (
        status &&
        status !== "ALL"
      ) {
        const allowedStatuses =
          RiderWithdrawal.schema.path(
            "status"
          ).enumValues;

        if (
          !allowedStatuses.includes(
            status
          )
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid withdrawal status.",
            allowedStatuses,
          });
        }

        filter.status =
          status;
      }

      const skip =
        (page - 1) *
        limit;

      const [
        withdrawals,
        total,
      ] = await Promise.all([
        RiderWithdrawal.find(
          filter
        )
          .sort({
            createdAt: -1,
          })
          .skip(skip)
          .limit(limit),

        RiderWithdrawal.countDocuments(
          filter
        ),
      ]);

      return res.status(200).json({
        success: true,
        message:
          "Rider withdrawal history loaded successfully.",

        data: {
          withdrawals:
            withdrawals.map(
              withdrawalForRider
            ),

          pagination: {
            page,
            limit,
            total,
            totalPages:
              Math.max(
                Math.ceil(
                  total / limit
                ),
                1
              ),
          },
        },

        withdrawals:
          withdrawals.map(
            withdrawalForRider
          ),
      });
    } catch (error) {
      console.error(
        "Get Rider withdrawals error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to load Rider withdrawal history.",
        error:
          error.message,
      });
    }
  };

/*
|--------------------------------------------------------------------------
| GET ONE RIDER WITHDRAWAL
|--------------------------------------------------------------------------
|
| GET /api/rider/withdrawals/:id
|
*/

exports.getMyWithdrawalById =
  async (req, res) => {
    try {
      const rider =
        await getAuthenticatedRider(
          req
        );

      if (
        !validateRiderAccount(
          rider,
          res, {
            requireVerified:
              false,
          }
        )
      ) {
        return;
      }

      const withdrawalId =
        normalizeText(
          req.params.id
        );

      if (
        !isValidObjectId(
          withdrawalId
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid withdrawal ID.",
        });
      }

      const withdrawal =
        await RiderWithdrawal.findOne({
          _id:
            withdrawalId,

          riderId:
            rider._id,
        });

      if (!withdrawal) {
        return res.status(404).json({
          success: false,
          message:
            "Withdrawal request not found.",
        });
      }

      return res.status(200).json({
        success: true,
        message:
          "Withdrawal details loaded successfully.",

        data: {
          withdrawal:
            withdrawalForRider(
              withdrawal
            ),
        },

        withdrawal:
          withdrawalForRider(
            withdrawal
          ),
      });
    } catch (error) {
      console.error(
        "Get Rider withdrawal details error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to load withdrawal details.",
        error:
          error.message,
      });
    }
  };

/*
|--------------------------------------------------------------------------
| CREATE RIDER WITHDRAWAL REQUEST
|--------------------------------------------------------------------------
|
| POST /api/rider/withdrawals
|
| Body:
|
| {
|   "amount": 5000,
|   "bankCode": "058",
|   "bankName": "Guaranty Trust Bank",
|   "accountNumber": "0123456789",
|   "accountName": "RIDER NAME",
|   "transactionPin": "1234"
| }
|
*/

exports.createWithdrawalRequest =
  async (req, res) => {
    const session =
      await mongoose.startSession();

    try {
      const amount =
        roundMoney(
          req.body.amount
        );

      const bankCode =
        normalizeText(
          req.body.bankCode ??
          req.body.bank_code
        );

      const bankName =
        normalizeText(
          req.body.bankName ??
          req.body.bank_name
        );

      const accountNumber =
        normalizeDigits(
          req.body.accountNumber ??
          req.body.account_number
        );

      const accountName =
        normalizeText(
          req.body.accountName ??
          req.body.account_name
        );

      const transactionPin =
        normalizeDigits(
          req.body.transactionPin ??
          req.body
            .transaction_pin ??
          req.body.pin
        );

      const narration =
        normalizeText(
          req.body.narration
        ) ||
        "ServicePay Rider commission withdrawal";

      if (
        !Number.isFinite(amount) ||
        amount <= 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Please enter a valid withdrawal amount.",
        });
      }

      if (
        amount <
        MIN_WITHDRAWAL_AMOUNT
      ) {
        return res.status(400).json({
          success: false,
          message:
            `Minimum Rider withdrawal is ₦${MIN_WITHDRAWAL_AMOUNT.toFixed(
              2
            )}.`,
          minimumWithdrawal:
            MIN_WITHDRAWAL_AMOUNT,
        });
      }

      if (
        amount >
        MAX_WITHDRAWAL_AMOUNT
      ) {
        return res.status(400).json({
          success: false,
          message:
            `Maximum Rider withdrawal is ₦${MAX_WITHDRAWAL_AMOUNT.toFixed(
              2
            )}.`,
          maximumWithdrawal:
            MAX_WITHDRAWAL_AMOUNT,
        });
      }

      if (!bankCode) {
        return res.status(400).json({
          success: false,
          message:
            "Please select a bank.",
        });
      }

      if (!bankName) {
        return res.status(400).json({
          success: false,
          message:
            "Bank name is required.",
        });
      }

      if (
        !/^\d{10}$/.test(
          accountNumber
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Bank account number must contain exactly 10 digits.",
        });
      }

      if (
        accountName.length < 3
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Please provide the verified bank account name.",
        });
      }

      if (
        narration.length > 120
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Narration must not exceed 120 characters.",
        });
      }

      const fee =
        roundMoney(
          WITHDRAWAL_FEE
        );

      const totalDebit =
        roundMoney(
          amount + fee
        );

      let createdWithdrawal =
        null;

      let updatedRider =
        null;

      await session.withTransaction(
        async () => {
          const rider =
            await getAuthenticatedRider(
              req, {
                includePin: false,
                session,
              }
            );

          if (
            !rider ||
            normalizeStatus(
              rider.role
            ) !==
              "DELIVERY_RIDER"
          ) {
            const error =
              new Error(
                "Only Delivery Riders can request commission withdrawal."
              );

            error.statusCode =
              403;

            throw error;
          }

          if (
            normalizeStatus(
              rider.status
            ) !==
              "ACTIVE"
          ) {
            const error =
              new Error(
                "Your Rider account is not active."
              );

            error.statusCode =
              403;

            throw error;
          }

          if (
            normalizeStatus(
              rider
                .riderVerificationStatus
            ) !==
              "VERIFIED"
          ) {
            const error =
              new Error(
                "Your Rider account must be verified before withdrawal."
              );

            error.statusCode =
              403;

            throw error;
          }

          await verifyTransactionPin(
            rider._id,
            transactionPin,
            { session }
          );

          const existingActive =
            await RiderWithdrawal.findOne({
              riderId:
                rider._id,

              status: {
                $in:
                  ACTIVE_WITHDRAWAL_STATUSES,
              },
            }).session(session);

          if (existingActive) {
            const error =
              new Error(
                "You already have an active withdrawal request. Please wait until it is completed."
              );

            error.statusCode =
              409;

            throw error;
          }

          updatedRider =
            await User.findOneAndUpdate(
              {
                _id:
                  rider._id,

                role:
                  "DELIVERY_RIDER",

                status:
                  "ACTIVE",

                pendingRiderSettlement: {
                  $gte:
                    totalDebit,
                },
              },
              {
                $inc: {
                  pendingRiderSettlement:
                    -totalDebit,
                },
              },
              {
                new: true,
                session,
              }
            );

          if (!updatedRider) {
            const freshRider =
              await User.findById(
                rider._id
              )
                .select(
                  "pendingRiderSettlement"
                )
                .session(session);

            const available =
              roundMoney(
                freshRider
                  ?.pendingRiderSettlement
              );

            const error =
              new Error(
                "Insufficient available Rider commission."
              );

            error.statusCode =
              400;

            error.extra = {
              availableCommission:
                available,

              requestedAmount:
                amount,

              fee,

              totalDebit,
            };

            throw error;
          }

          const reference =
            generateWithdrawalReference();

          const withdrawals =
            await RiderWithdrawal.create(
              [
                {
                  riderId:
                    rider._id,

                  reference,

                  amount,

                  fee,

                  totalDebit,

                  currency:
                    "NGN",

                  bankCode,

                  bankName,

                  accountNumber,

                  accountName,

                  narration,

                  status:
                    "PENDING",

                  fundsLocked:
                    true,

                  fundsReturned:
                    false,

                  requestedAt:
                    new Date(),

                  provider:
                    "MANUAL",
                },
              ],
              {
                session,
              }
            );

          createdWithdrawal =
            withdrawals[0];
        }
      );

      return res.status(201).json({
        success: true,
        message:
          "Rider commission withdrawal request submitted successfully.",

        data: {
          withdrawal:
            withdrawalForRider(
              createdWithdrawal
            ),

          availableCommission:
            roundMoney(
              updatedRider
                ?.pendingRiderSettlement
            ),
        },

        withdrawal:
          withdrawalForRider(
            createdWithdrawal
          ),

        availableCommission:
          roundMoney(
            updatedRider
              ?.pendingRiderSettlement
          ),
      });
    } catch (error) {
      console.error(
        "Create Rider withdrawal error:",
        error
      );

      return res
        .status(
          error.statusCode ||
          500
        )
        .json({
          success: false,
          ...(error.code ? { code: error.code } : {}),

          message:
            error.message ||
            "Unable to create Rider withdrawal request.",

          ...(
            error.extra ||
            {}
          ),
        });
    } finally {
      await session.endSession();
    }
  };

/*
|--------------------------------------------------------------------------
| ADMIN: GET ALL RIDER WITHDRAWALS
|--------------------------------------------------------------------------
|
| GET /api/rider/admin/withdrawals
|
*/

exports.getAllWithdrawals =
  async (req, res) => {
    try {
      if (
        !validateHeadOffice(
          req,
          res
        )
      ) {
        return;
      }

      const page = Math.max(
        Number(
          req.query.page || 1
        ),
        1
      );

      const limit = Math.min(
        Math.max(
          Number(
            req.query.limit || 20
          ),
          1
        ),
        100
      );

      const status =
        normalizeStatus(
          req.query.status
        );

      const search =
        normalizeText(
          req.query.search
        );

      const filter = {};

      if (
        status &&
        status !== "ALL"
      ) {
        const allowedStatuses =
          RiderWithdrawal.schema.path(
            "status"
          ).enumValues;

        if (
          !allowedStatuses.includes(
            status
          )
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid withdrawal status.",
            allowedStatuses,
          });
        }

        filter.status =
          status;
      }

      if (search) {
        filter.$or = [
          {
            reference: {
              $regex:
                search,
              $options:
                "i",
            },
          },
          {
            accountNumber: {
              $regex:
                search,
              $options:
                "i",
            },
          },
          {
            accountName: {
              $regex:
                search,
              $options:
                "i",
            },
          },
          {
            bankName: {
              $regex:
                search,
              $options:
                "i",
            },
          },
        ];
      }

      const skip =
        (page - 1) *
        limit;

      const [
        withdrawals,
        total,
        statusSummary,
      ] = await Promise.all([
        RiderWithdrawal.find(
          filter
        )
          .populate(
            "riderId",
            [
              "riderId",
              "fullName",
              "phone",
              "email",
              "status",
              "riderVerificationStatus",
              "pendingRiderSettlement",
              "totalRiderEarnings",
              "settledRiderEarnings",
            ].join(" ")
          )
          .populate(
            "reviewedBy",
            "fullName email role"
          )
          .populate(
            "approvedBy",
            "fullName email role"
          )
          .populate(
            "rejectedBy",
            "fullName email role"
          )
          .sort({
            createdAt: -1,
          })
          .skip(skip)
          .limit(limit)
          .lean(),

        RiderWithdrawal.countDocuments(
          filter
        ),

        RiderWithdrawal.aggregate([
          {
            $group: {
              _id:
                "$status",

              count: {
                $sum: 1,
              },

              amount: {
                $sum:
                  "$amount",
              },
            },
          },
        ]),
      ]);

      const summary = {};

      for (
        const item
        of statusSummary
      ) {
        summary[item._id] = {
          count:
            Number(
              item.count || 0
            ),

          amount:
            roundMoney(
              item.amount
            ),
        };
      }

      return res.status(200).json({
        success: true,
        message:
          "Rider withdrawals loaded successfully.",

        data: {
          withdrawals,

          summary,

          pagination: {
            page,
            limit,
            total,
            totalPages:
              Math.max(
                Math.ceil(
                  total / limit
                ),
                1
              ),
          },
        },

        withdrawals,
      });
    } catch (error) {
      console.error(
        "Admin get Rider withdrawals error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to load Rider withdrawals.",
        error:
          error.message,
      });
    }
  };

/*
|--------------------------------------------------------------------------
| ADMIN: APPROVE RIDER WITHDRAWAL
|--------------------------------------------------------------------------
|
| PATCH /api/rider/admin/withdrawals/:id/approve
|
*/

exports.approveWithdrawal =
  async (req, res) => {
    const session =
      await mongoose.startSession();

    try {
      if (
        !validateHeadOffice(
          req,
          res
        )
      ) {
        return;
      }

      const withdrawalId =
        normalizeText(
          req.params.id
        );

      if (
        !isValidObjectId(
          withdrawalId
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid withdrawal ID.",
        });
      }

      let updatedWithdrawal =
        null;

      await session.withTransaction(
        async () => {
          const withdrawal =
            await RiderWithdrawal.findById(
              withdrawalId
            ).session(session);

          if (!withdrawal) {
            const error =
              new Error(
                "Withdrawal request not found."
              );

            error.statusCode =
              404;

            throw error;
          }

          if (
            withdrawal.status !==
            "PENDING"
          ) {
            const error =
              new Error(
                `Only PENDING withdrawals can be approved. Current status is ${withdrawal.status}.`
              );

            error.statusCode =
              400;

            throw error;
          }

          const now =
            new Date();

          withdrawal.status =
            "APPROVED";

          withdrawal.approvedAt =
            now;

          withdrawal.approvedBy =
            req.user._id;

          withdrawal.reviewedAt =
            now;

          withdrawal.reviewedBy =
            req.user._id;

          withdrawal.adminNote =
            normalizeText(
              req.body.adminNote ??
              req.body.note
            );

          updatedWithdrawal =
            await withdrawal.save({
              session,
            });
        }
      );

      const populated =
        await RiderWithdrawal.findById(
          updatedWithdrawal._id
        )
          .populate(
            "riderId",
            "riderId fullName phone email"
          )
          .populate(
            "approvedBy",
            "fullName email role"
          )
          .lean();

      return res.status(200).json({
        success: true,
        message:
          "Rider withdrawal approved successfully.",

        data: {
          withdrawal:
            populated,
        },

        withdrawal:
          populated,
      });
    } catch (error) {
      console.error(
        "Approve Rider withdrawal error:",
        error
      );

      return res
        .status(
          error.statusCode ||
          500
        )
        .json({
          success: false,
          message:
            error.message ||
            "Unable to approve Rider withdrawal.",
        });
    } finally {
      await session.endSession();
    }
  };

/*
|--------------------------------------------------------------------------
| ADMIN: REJECT RIDER WITHDRAWAL
|--------------------------------------------------------------------------
|
| PATCH /api/rider/admin/withdrawals/:id/reject
|
*/

exports.rejectWithdrawal =
  async (req, res) => {
    const session =
      await mongoose.startSession();

    try {
      if (
        !validateHeadOffice(
          req,
          res
        )
      ) {
        return;
      }

      const withdrawalId =
        normalizeText(
          req.params.id
        );

      const reason =
        normalizeText(
          req.body.reason ??
          req.body.rejectionReason
        );

      if (
        !isValidObjectId(
          withdrawalId
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid withdrawal ID.",
        });
      }

      if (
        reason.length < 3
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Please provide a reason for rejecting the withdrawal.",
        });
      }

      let updatedWithdrawal =
        null;

      await session.withTransaction(
        async () => {
          const withdrawal =
            await RiderWithdrawal.findById(
              withdrawalId
            ).session(session);

          if (!withdrawal) {
            const error =
              new Error(
                "Withdrawal request not found."
              );

            error.statusCode =
              404;

            throw error;
          }

          if (
            ![
              "PENDING",
              "APPROVED",
            ].includes(
              withdrawal.status
            )
          ) {
            const error =
              new Error(
                `This withdrawal cannot be rejected because its current status is ${withdrawal.status}.`
              );

            error.statusCode =
              400;

            throw error;
          }

          updatedWithdrawal =
            await returnLockedFunds({
              withdrawal,

              reviewedBy:
                req.user._id,

              status:
                "REJECTED",

              reason,

              session,
            });
        }
      );

      const populated =
        await RiderWithdrawal.findById(
          updatedWithdrawal._id
        )
          .populate(
            "riderId",
            [
              "riderId",
              "fullName",
              "phone",
              "email",
              "pendingRiderSettlement",
            ].join(" ")
          )
          .populate(
            "rejectedBy",
            "fullName email role"
          )
          .lean();

      return res.status(200).json({
        success: true,
        message:
          "Rider withdrawal rejected and the locked commission was returned successfully.",

        data: {
          withdrawal:
            populated,
        },

        withdrawal:
          populated,
      });
    } catch (error) {
      console.error(
        "Reject Rider withdrawal error:",
        error
      );

      return res
        .status(
          error.statusCode ||
          500
        )
        .json({
          success: false,
          message:
            error.message ||
            "Unable to reject Rider withdrawal.",
        });
    } finally {
      await session.endSession();
    }
  };

/*
|--------------------------------------------------------------------------
| ADMIN: MARK WITHDRAWAL AS PROCESSING
|--------------------------------------------------------------------------
|
| PATCH /api/rider/admin/withdrawals/:id/processing
|
*/

exports.markWithdrawalProcessing =
  async (req, res) => {
    try {
      if (
        !validateHeadOffice(
          req,
          res
        )
      ) {
        return;
      }

      const withdrawalId =
        normalizeText(
          req.params.id
        );

      if (
        !isValidObjectId(
          withdrawalId
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid withdrawal ID.",
        });
      }

      const withdrawal =
        await RiderWithdrawal.findOneAndUpdate(
          {
            _id:
              withdrawalId,

            status:
              "APPROVED",
          },
          {
            $set: {
              status:
                "PROCESSING",

              processingAt:
                new Date(),

              provider:
                normalizeStatus(
                  req.body.provider ||
                  "MANUAL"
                ),

              providerReference:
                normalizeText(
                  req.body
                    .providerReference
                ),

              providerTransactionId:
                normalizeText(
                  req.body
                    .providerTransactionId
                ),

              providerStatus:
                "PROCESSING",

              providerResponse:
                req.body
                  .providerResponse ||
                null,
            },
          },
          {
            new: true,
            runValidators: true,
          }
        )
          .populate(
            "riderId",
            "riderId fullName phone email"
          );

      if (!withdrawal) {
        return res.status(400).json({
          success: false,
          message:
            "Only an APPROVED withdrawal can be marked as processing.",
        });
      }

      return res.status(200).json({
        success: true,
        message:
          "Rider withdrawal marked as processing.",

        data: {
          withdrawal,
        },

        withdrawal,
      });
    } catch (error) {
      console.error(
        "Mark withdrawal processing error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to mark withdrawal as processing.",
        error:
          error.message,
      });
    }
  };

/*
|--------------------------------------------------------------------------
| ADMIN: MARK RIDER WITHDRAWAL AS PAID
|--------------------------------------------------------------------------
|
| PATCH /api/rider/admin/withdrawals/:id/paid
|
*/

exports.markWithdrawalPaid =
  async (req, res) => {
    const session =
      await mongoose.startSession();

    try {
      if (
        !validateHeadOffice(
          req,
          res
        )
      ) {
        return;
      }

      const withdrawalId =
        normalizeText(
          req.params.id
        );

      if (
        !isValidObjectId(
          withdrawalId
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid withdrawal ID.",
        });
      }

      let updatedWithdrawal =
        null;

      await session.withTransaction(
        async () => {
          const withdrawal =
            await RiderWithdrawal.findById(
              withdrawalId
            ).session(session);

          if (!withdrawal) {
            const error =
              new Error(
                "Withdrawal request not found."
              );

            error.statusCode =
              404;

            throw error;
          }

          if (
            ![
              "APPROVED",
              "PROCESSING",
            ].includes(
              withdrawal.status
            )
          ) {
            const error =
              new Error(
                `This withdrawal cannot be marked as paid because its current status is ${withdrawal.status}.`
              );

            error.statusCode =
              400;

            throw error;
          }

          if (
            withdrawal
              .fundsReturned
          ) {
            const error =
              new Error(
                "This withdrawal was already refunded to the Rider."
              );

            error.statusCode =
              400;

            throw error;
          }

          const amount =
            roundMoney(
              withdrawal.amount
            );

          const updatedRider =
            await User.findOneAndUpdate(
              {
                _id:
                  withdrawal.riderId,

                role:
                  "DELIVERY_RIDER",
              },
              {
                $inc: {
                  settledRiderEarnings:
                    amount,
                },
              },
              {
                new: true,
                session,
              }
            );

          if (!updatedRider) {
            throw new Error(
              "Delivery Rider account was not found."
            );
          }

          const now =
            new Date();

          withdrawal.status =
            "PAID";

          withdrawal.paidAt =
            now;

          withdrawal.fundsLocked =
            false;

          withdrawal.provider =
            normalizeStatus(
              req.body.provider ||
              withdrawal.provider ||
              "MANUAL"
            );

          withdrawal
            .providerReference =
            normalizeText(
              req.body
                .providerReference ??
              withdrawal
                .providerReference
            );

          withdrawal
            .providerTransactionId =
            normalizeText(
              req.body
                .providerTransactionId ??
              withdrawal
                .providerTransactionId
            );

          withdrawal.providerStatus =
            "SUCCESSFUL";

          withdrawal.providerResponse =
            req.body
              .providerResponse ??
            withdrawal
              .providerResponse;

          withdrawal.reviewedAt =
            withdrawal.reviewedAt ||
            now;

          withdrawal.reviewedBy =
            withdrawal.reviewedBy ||
            req.user._id;

          withdrawal.adminNote =
            normalizeText(
              req.body.adminNote ??
              req.body.note ??
              withdrawal.adminNote
            );

          updatedWithdrawal =
            await withdrawal.save({
              session,
            });
        }
      );

      const populated =
        await RiderWithdrawal.findById(
          updatedWithdrawal._id
        )
          .populate(
            "riderId",
            [
              "riderId",
              "fullName",
              "phone",
              "email",
              "pendingRiderSettlement",
              "totalRiderEarnings",
              "settledRiderEarnings",
            ].join(" ")
          )
          .lean();

      return res.status(200).json({
        success: true,
        message:
          "Rider withdrawal marked as paid successfully.",

        data: {
          withdrawal:
            populated,
        },

        withdrawal:
          populated,
      });
    } catch (error) {
      console.error(
        "Mark Rider withdrawal paid error:",
        error
      );

      return res
        .status(
          error.statusCode ||
          500
        )
        .json({
          success: false,
          message:
            error.message ||
            "Unable to mark Rider withdrawal as paid.",
        });
    } finally {
      await session.endSession();
    }
  };

/*
|--------------------------------------------------------------------------
| ADMIN: MARK RIDER WITHDRAWAL AS FAILED
|--------------------------------------------------------------------------
|
| PATCH /api/rider/admin/withdrawals/:id/failed
|
*/

exports.markWithdrawalFailed =
  async (req, res) => {
    const session =
      await mongoose.startSession();

    try {
      if (
        !validateHeadOffice(
          req,
          res
        )
      ) {
        return;
      }

      const withdrawalId =
        normalizeText(
          req.params.id
        );

      const reason =
        normalizeText(
          req.body.reason ??
          req.body.failureReason
        );

      if (
        !isValidObjectId(
          withdrawalId
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid withdrawal ID.",
        });
      }

      if (
        reason.length < 3
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Please provide the payment failure reason.",
        });
      }

      let updatedWithdrawal =
        null;

      await session.withTransaction(
        async () => {
          const withdrawal =
            await RiderWithdrawal.findById(
              withdrawalId
            ).session(session);

          if (!withdrawal) {
            const error =
              new Error(
                "Withdrawal request not found."
              );

            error.statusCode =
              404;

            throw error;
          }

          if (
            ![
              "APPROVED",
              "PROCESSING",
            ].includes(
              withdrawal.status
            )
          ) {
            const error =
              new Error(
                `This withdrawal cannot be marked as failed because its current status is ${withdrawal.status}.`
              );

            error.statusCode =
              400;

            throw error;
          }

          withdrawal.providerStatus =
            "FAILED";

          withdrawal.providerResponse =
            req.body
              .providerResponse ??
            withdrawal
              .providerResponse;

          updatedWithdrawal =
            await returnLockedFunds({
              withdrawal,

              reviewedBy:
                req.user._id,

              status:
                "FAILED",

              reason,

              session,
            });
        }
      );

      const populated =
        await RiderWithdrawal.findById(
          updatedWithdrawal._id
        )
          .populate(
            "riderId",
            [
              "riderId",
              "fullName",
              "phone",
              "email",
              "pendingRiderSettlement",
            ].join(" ")
          )
          .lean();

      return res.status(200).json({
        success: true,
        message:
          "Rider withdrawal marked as failed and the locked commission was returned.",

        data: {
          withdrawal:
            populated,
        },

        withdrawal:
          populated,
      });
    } catch (error) {
      console.error(
        "Mark Rider withdrawal failed error:",
        error
      );

      return res
        .status(
          error.statusCode ||
          500
        )
        .json({
          success: false,
          message:
            error.message ||
            "Unable to mark Rider withdrawal as failed.",
        });
    } finally {
      await session.endSession();
    }
  };