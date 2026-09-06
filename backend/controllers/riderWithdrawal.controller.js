const crypto = require("crypto");
const mongoose = require("mongoose");

const User = require(
  "../models/user.model"
);

const RiderWithdrawal = require(
  "../models/riderWithdrawal.model"
);
const { verifyTransactionPin } = require("../services/transactionPin.service");
const AppSettings = require("../models/appSettings.model");
const RiderWalletLedger = require("../models/riderWalletLedger.model");
const AdminAuditLog = require("../models/adminAuditLog.model");

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

const appendRiderLedger = (entry, session) => RiderWalletLedger.create([entry], { session });
const auditWithdrawalAction = (req, action, withdrawal, previousStatus, session) => AdminAuditLog.create([{
  actorId: req.user._id, actorRole: normalizeStatus(req.user.role), actorName: req.user.fullName || req.user.name || "",
  targetUserId: withdrawal.riderId, action, reason: `Rider withdrawal ${withdrawal.reference} changed from ${previousStatus} to ${withdrawal.status}.`,
  previousData: { status: previousStatus }, newData: { status: withdrawal.status },
  metadata: { withdrawalId: String(withdrawal._id), reference: withdrawal.reference },
  requestMethod: req.method || "", requestPath: req.originalUrl || "", status: "SUCCESSFUL",
}], { session });

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

    await appendRiderLedger({
      riderId: withdrawal.riderId,
      type: "WITHDRAWAL_REVERSAL",
      direction: "DEBIT",
      balanceAccount: "RESERVED",
      amount,
      oldBalance: amount,
      newBalance: 0,
      reference: `${withdrawal.reference}-REVERSAL-RELEASE`,
      withdrawalId: withdrawal._id,
      reason: reason || `Withdrawal ${status.toLowerCase()}`,
      adminId: reviewedBy,
    }, session);
    await appendRiderLedger({
      riderId: withdrawal.riderId,
      type: "WITHDRAWAL_REVERSAL",
      direction: "CREDIT",
      amount,
      oldBalance: roundMoney(updatedRider.pendingRiderSettlement - amount),
      newBalance: roundMoney(updatedRider.pendingRiderSettlement),
      reference: `${withdrawal.reference}-REVERSAL`,
      withdrawalId: withdrawal._id,
      reason: reason || `Withdrawal ${status.toLowerCase()}`,
      adminId: reviewedBy,
    }, session);

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
              "REVERSED",
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
    const startedAt = Date.now();
    let session = null;
    let riderId = null;
    let idempotencyKey = "";
    let reference = null;
    let respondWithDuplicate = null;
    const logStage = (stage, details = {}) => {
      console.info("rider_withdrawal", {
        stage,
        riderId: riderId ? String(riderId) : undefined,
        idempotencyKey: idempotencyKey || undefined,
        reference: reference || undefined,
        durationMs: Date.now() - startedAt,
        status: details.status || stage,
        ...details,
      });
    };

    try {
      riderId = getAuthenticatedUserId(req);
      idempotencyKey = normalizeText(
        (typeof req.get === "function" &&
          req.get("Idempotency-Key")) ||
          req.headers?.["idempotency-key"]
      );
      logStage("received");

      if (!riderId) {
        return res.status(401).json({
          success: false,
          message: "Authentication is required.",
        });
      }

      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{11,127}$/.test(idempotencyKey)) {
        return res.status(400).json({
          success: false,
          message: "A valid Idempotency-Key header (12-128 safe characters) is required.",
        });
      }

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

      const idempotencyIntent = crypto
        .createHash("sha256")
        .update(JSON.stringify({
          amount,
          bankCode,
          accountNumber,
          accountName,
          narration,
          currency: "NGN",
        }))
        .digest("hex");

      respondWithDuplicate = async (withdrawal) => {
        const existingIntent = withdrawal.idempotencyIntent;
        if (existingIntent !== idempotencyIntent) {
          return res.status(409).json({
            success: false,
            code: "IDEMPOTENCY_KEY_INTENT_CONFLICT",
            message:
              "This Idempotency-Key has already been used for a different withdrawal request.",
          });
        }
        const currentRider = await User.findById(riderId)
          .select("pendingRiderSettlement");
        logStage("duplicate_resolved", {
          status: withdrawal.status,
          reference: withdrawal.reference,
        });
        return res.status(200).json({
          success: true,
          message: "Rider commission withdrawal request already submitted.",
          data: {
            withdrawal: withdrawalForRider(withdrawal),
            availableCommission: roundMoney(
              currentRider?.pendingRiderSettlement
            ),
          },
          withdrawal: withdrawalForRider(withdrawal),
          availableCommission: roundMoney(
            currentRider?.pendingRiderSettlement
          ),
        });
      };

      /*
       * Retried HTTP requests must not consume another PIN admission. This
       * lookup also gives an immediately committed request precedence over
       * validation of a newly resent body.
       */
      const preexisting = await RiderWithdrawal.findOne({
        riderId,
        idempotencyKey,
      }).select("+idempotencyIntent");
      if (preexisting) {
        return respondWithDuplicate(preexisting);
      }

      /*
       * Availability is checked before PIN verification because PIN
       * verification records security admission state. A disabled product
       * must be a completely side-effect-free refusal.
       */
      const withdrawalSettings = await AppSettings.findOne({
        key: "GLOBAL_SETTINGS",
      }).lean();
      if (withdrawalSettings?.riderWithdrawalControl?.enabled === false) {
        return res.status(503).json({
          success: false,
          message: "Rider withdrawal is temporarily unavailable. Please try again later.",
        });
      }

      /*
       * PIN reservation/clearing writes are intentionally completed before
       * opening the financial transaction. verifyTransactionPin owns its
       * security writes outside caller sessions.
       */
      try {
        await verifyTransactionPin(riderId, transactionPin);
        logStage("pin_admitted");
      } catch (error) {
        logStage("pin_rejected", {
          status: error.statusCode || 400,
        });
        throw error;
      }

      session = await mongoose.startSession();
      logStage("transaction_started");
      let transactionResult = null;

      await session.withTransaction(
        async () => {
          let createdWithdrawal = null;
          let updatedRider = null;
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

          logStage("rider_validated");

          const settings = await AppSettings.findOne({
            key: "GLOBAL_SETTINGS",
          }).session(session);
          if (settings?.riderWithdrawalControl?.enabled === false) {
            const error = new Error(
              "Rider withdrawal is temporarily unavailable. Please try again later."
            );
            error.statusCode = 503;
            throw error;
          }

          const duplicate = await RiderWithdrawal.findOne({
            riderId: rider._id,
            idempotencyKey,
          })
            .select("+idempotencyIntent")
            .session(session);
          if (duplicate) {
            if (duplicate.idempotencyIntent !== idempotencyIntent) {
              const error = new Error(
                "This Idempotency-Key has already been used for a different withdrawal request."
              );
              error.statusCode = 409;
              error.code = "IDEMPOTENCY_KEY_INTENT_CONFLICT";
              throw error;
            }
            transactionResult = {
              duplicate,
              updatedRider: rider,
            };
            return;
          }

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

                riderVerificationStatus:
                  "VERIFIED",

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
          logStage("balance_reserved");

          reference =
            generateWithdrawalReference();

          const withdrawals =
            await RiderWithdrawal.create(
              [
                {
                  riderId:
                    rider._id,

                  reference,

                  idempotencyKey,

                  idempotencyIntent,

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
          await appendRiderLedger({
            riderId: rider._id,
            type: "WITHDRAWAL_RESERVED",
            direction: "DEBIT",
            amount: totalDebit,
            oldBalance: roundMoney(updatedRider.pendingRiderSettlement + totalDebit),
            newBalance: roundMoney(updatedRider.pendingRiderSettlement),
            reference: `${reference}-RESERVED`,
            withdrawalId: createdWithdrawal._id,
            reason: "Rider withdrawal funds reserved",
          }, session);
          await appendRiderLedger({
            riderId: rider._id,
            type: "WITHDRAWAL_RESERVED",
            direction: "CREDIT",
            balanceAccount: "RESERVED",
            amount: totalDebit,
            oldBalance: 0,
            newBalance: totalDebit,
            reference: `${reference}-RESERVED-HOLD`,
            withdrawalId: createdWithdrawal._id,
            reason: "Rider withdrawal reserve created",
          }, session);
          transactionResult = {
            createdWithdrawal,
            updatedRider,
          };
          logStage("request_created", {
            status: createdWithdrawal.status,
          });
        },
        {
          readConcern: {
            level: "snapshot",
          },
          writeConcern: {
            w: "majority",
            wtimeout: 5000,
          },
          maxCommitTimeMS: 5000,
        }
      );

      if (transactionResult?.duplicate) {
        return respondWithDuplicate(
          transactionResult.duplicate
        );
      }

      const createdWithdrawal =
        transactionResult?.createdWithdrawal;
      const updatedRider =
        transactionResult?.updatedRider;
      logStage("committed", {
        status: createdWithdrawal?.status,
      });
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
      logStage("rollback", {
        status: error.statusCode || 500,
        code: error.code,
      });

      /*
       * A duplicate-key error or an unknown commit result can occur after the
       * server has committed the transaction. Resolve by the durable key
       * before reporting uncertainty; this never performs a second debit.
       */
      if (riderId && idempotencyKey) {
        try {
          const committed = await RiderWithdrawal.findOne({
            riderId,
            idempotencyKey,
          }).select("+idempotencyIntent");
          if (committed && respondWithDuplicate) {
            return respondWithDuplicate(committed);
          }
        } catch (lookupError) {
          // The original error remains the safest response if resolution fails.
        }
      }

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
      if (session) {
        await session.endSession();
      }
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

          const previousStatus = withdrawal.status;
          updatedWithdrawal =
            await withdrawal.save({
              session,
            });
          await auditWithdrawalAction(req, "RIDER_WITHDRAWAL_APPROVED", updatedWithdrawal, "PENDING", session);
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

          const previousStatus = withdrawal.status;
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
          await auditWithdrawalAction(req, "RIDER_WITHDRAWAL_REJECTED", updatedWithdrawal, previousStatus, session);
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
    const session = await mongoose.startSession();
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

      let withdrawal;
      await session.withTransaction(async () => {
        withdrawal = await RiderWithdrawal.findOneAndUpdate(
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
            session,
          }
        )
          .populate(
            "riderId",
            "riderId fullName phone email"
          );

        if (!withdrawal) {
          const error = new Error("Only an APPROVED withdrawal can be marked as processing.");
          error.statusCode = 400;
          throw error;
        }

        await auditWithdrawalAction(req, "RIDER_WITHDRAWAL_PROCESSING", withdrawal, "APPROVED", session);
      });

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

      return res.status(error.statusCode || 500).json({
        success: false,
        message:
          "Unable to mark withdrawal as processing.",
        error:
          error.message,
      });
    } finally {
      await session.endSession();
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

          const previousStatus = withdrawal.status;
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
          await appendRiderLedger({
            riderId: withdrawal.riderId,
            type: "WITHDRAWAL_PAID",
            direction: "DEBIT",
            amount: roundMoney(withdrawal.totalDebit),
            balanceAccount: "RESERVED",
            oldBalance: roundMoney(withdrawal.totalDebit),
            newBalance: 0,
            reference: `${withdrawal.reference}-PAID`,
            withdrawalId: withdrawal._id,
            reason: "Rider withdrawal paid",
            adminId: req.user._id,
            metadata: { paidAmount: amount, fee: roundMoney(withdrawal.fee) },
          }, session);
          await auditWithdrawalAction(req, "RIDER_WITHDRAWAL_PAID", updatedWithdrawal, previousStatus, session);
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

          const previousStatus = withdrawal.status;
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
          await auditWithdrawalAction(req, "RIDER_WITHDRAWAL_FAILED", updatedWithdrawal, previousStatus, session);
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

/*
 * Reverse only an unpaid, reserved withdrawal. PAID records are intentionally
 * excluded: reversing a confirmed bank settlement requires a separate
 * recovery process, never an admin button.
 */
exports.reverseWithdrawal = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    if (!validateHeadOffice(req, res)) return;
    const withdrawalId = normalizeText(req.params.id);
    const reason = normalizeText(req.body.reason);
    if (!isValidObjectId(withdrawalId) || reason.length < 3) {
      return res.status(400).json({ success: false, message: "A valid withdrawal ID and reversal reason are required." });
    }
    let updatedWithdrawal;
    await session.withTransaction(async () => {
      const withdrawal = await RiderWithdrawal.findById(withdrawalId).session(session);
      if (!withdrawal) throw Object.assign(new Error("Withdrawal request not found."), { statusCode: 404 });
      if (withdrawal.status === "REVERSED") {
        updatedWithdrawal = withdrawal;
        return;
      }
      if (!["PENDING", "APPROVED", "PROCESSING"].includes(withdrawal.status)) {
        throw Object.assign(new Error(`This withdrawal cannot be reversed because its current status is ${withdrawal.status}.`), { statusCode: 400 });
      }
      const previousStatus = withdrawal.status;
      updatedWithdrawal = await returnLockedFunds({
        withdrawal, reviewedBy: req.user._id, status: "REVERSED", reason, session,
      });
      await auditWithdrawalAction(req, "RIDER_WITHDRAWAL_REVERSED", updatedWithdrawal, previousStatus, session);
    });
    return res.status(200).json({
      success: true,
      message: updatedWithdrawal.status === "REVERSED" ? "Rider withdrawal reversed successfully." : "Rider withdrawal reversal already completed.",
      withdrawal: updatedWithdrawal,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Unable to reverse Rider withdrawal." });
  } finally {
    await session.endSession();
  }
};