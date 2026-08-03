const crypto = require("crypto");

const User = require("../models/user.model");
const Transaction = require(
  "../models/transaction.model"
);
const AdminAuditLog = require(
  "../models/adminAuditLog.model"
);

const {
  sendEmail,
} = require("../services/email.service");

/*
|--------------------------------------------------------------------------
| HELPERS
|--------------------------------------------------------------------------
*/

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

const escapeRegex = (
  value = ""
) => {
  return String(value).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
};

const getActorId = (
  req
) => {
  return (
    req.user?._id ||
    req.user?.id ||
    req.userId ||
    null
  );
};

const normalizeRole = (
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

const getClientIp = (
  req
) => {
  const forwardedFor = String(
    req.headers[
      "x-forwarded-for"
    ] || ""
  ).trim();

  if (forwardedFor) {
    return forwardedFor
      .split(",")[0]
      .trim();
  }

  return (
    req.ip ||
    req.socket?.remoteAddress ||
    ""
  );
};

const requireReason = (
  req,
  res
) => {
  const reason = String(
    req.body.reason ||
      req.body.adminReason ||
      ""
  ).trim();

  if (reason.length < 5) {
    res.status(400).json({
      success: false,
      message:
        "Please enter a clear reason containing at least 5 characters.",
    });

    return null;
  }

  if (reason.length > 500) {
    res.status(400).json({
      success: false,
      message:
        "Reason cannot exceed 500 characters.",
    });

    return null;
  }

  return reason;
};

const ensureHeadOffice = (
  req,
  res
) => {
  const role = normalizeRole(
    req.user?.role
  );

  if (role !== "HEAD_OFFICE") {
    res.status(403).json({
      success: false,
      message:
        "Only Head Office can perform this customer-management action.",
    });

    return false;
  }

  return true;
};

const safeUserObject = (
  user
) => {
  if (!user) {
    return null;
  }

  const raw =
    typeof user.toObject ===
    "function"
      ? user.toObject()
      : {
          ...user,
        };

  delete raw.password;
  delete raw.transactionPin;
  delete raw.passwordResetToken;
  delete raw.passwordResetExpires;

  return raw;
};

const createAuditLog = async ({
  req,
  targetUser,
  action,
  reason,
  previousData = null,
  newData = null,
  metadata = null,
  status = "SUCCESSFUL",
  failureReason = null,
}) => {
  try {
    const actorId =
      getActorId(req);

    if (!actorId) {
      return null;
    }

    return await AdminAuditLog.create({
      actorId,

      actorRole:
        normalizeRole(
          req.user?.role
        ) || "UNKNOWN",

      actorName:
        req.user?.fullName ||
        req.user?.name ||
        "",

      targetUserId:
        targetUser?._id ||
        targetUser?.id ||
        null,

      targetUserName:
        targetUser?.fullName ||
        targetUser?.name ||
        "",

      action,

      reason,

      previousData,
      newData,
      metadata,

      ipAddress:
        getClientIp(req),

      userAgent: String(
        req.headers[
          "user-agent"
        ] || ""
      ).trim(),

      requestMethod:
        req.method,

      requestPath:
        req.originalUrl,

      status,
      failureReason,
    });
  } catch (error) {
    /*
     * Audit-log failure must not hide
     * a successfully completed operation.
     */
    console.error(
      "Admin audit-log creation error:",
      error
    );

    return null;
  }
};

const validateUserId = (
  userId,
  res
) => {
  const mongoose =
    require("mongoose");

  if (
    !mongoose.Types.ObjectId.isValid(
      userId
    )
  ) {
    res.status(400).json({
      success: false,
      message:
        "Invalid user ID.",
    });

    return false;
  }

  return true;
};

const formatCustomer = (
  user
) => {
  const customer =
    safeUserObject(user);

  if (!customer) {
    return null;
  }

  customer.transactionPinSet =
    customer.transactionPinSet ===
    true;

  customer.kycVerified =
    customer.kycVerified === true;

  customer.walletBalance =
    Number(
      customer.walletBalance || 0
    );

  customer.commissionBalance =
    Number(
      customer.commissionBalance ||
        0
    );

  customer.totalEarnings =
    Number(
      customer.totalEarnings || 0
    );

  customer.totalTransactions =
    Number(
      customer.totalTransactions ||
        0
    );

  return customer;
};

/*
|--------------------------------------------------------------------------
| GET SINGLE CUSTOMER DETAILS
|--------------------------------------------------------------------------
*/

exports.getAdminUserDetails = async (
  req,
  res
) => {
  try {
    const userId = String(
      req.params.id || ""
    ).trim();

    if (
      !validateUserId(
        userId,
        res
      )
    ) {
      return;
    }

    const user =
      await User.findById(
        userId
      )
        .select(
          "-password -transactionPin -passwordResetToken -passwordResetExpires"
        )
        .populate(
          "zonalManagerId",
          "fullName phone email role zone state status"
        )
        .populate(
          "stateManagerId",
          "fullName phone email role zone state lga status"
        )
        .populate(
          "agentId",
          "fullName phone email role zone state lga status"
        )
        .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message:
          "User account was not found.",
      });
    }

    const [
      recentTransactions,
      transactionSummary,
    ] = await Promise.all([
      Transaction.find({
        customerId: userId,
      })
        .sort({
          createdAt: -1,
        })
        .limit(10)
        .lean(),

      Transaction.aggregate([
        {
          $match: {
            customerId:
              user._id,
          },
        },
        {
          $group: {
            _id: null,

            totalTransactions: {
              $sum: 1,
            },

            totalAmount: {
              $sum: {
                $convert: {
                  input: "$amount",
                  to: "double",
                  onError: 0,
                  onNull: 0,
                },
              },
            },

            successful: {
              $sum: {
                $cond: [
                  {
                    $in: [
                      "$status",
                      [
                        "SUCCESS",
                        "SUCCESSFUL",
                        "COMPLETED",
                        "APPROVED",
                      ],
                    ],
                  },
                  1,
                  0,
                ],
              },
            },

            pending: {
              $sum: {
                $cond: [
                  {
                    $in: [
                      "$status",
                      [
                        "PENDING",
                        "PROCESSING",
                      ],
                    ],
                  },
                  1,
                  0,
                ],
              },
            },

            failed: {
              $sum: {
                $cond: [
                  {
                    $in: [
                      "$status",
                      [
                        "FAILED",
                        "CANCELLED",
                        "REJECTED",
                      ],
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]),
    ]);

    const summary =
      transactionSummary[0] || {
        totalTransactions: 0,
        totalAmount: 0,
        successful: 0,
        pending: 0,
        failed: 0,
      };

    return res.status(200).json({
      success: true,
      message:
        "User details loaded successfully.",

      data: {
        user:
          formatCustomer(user),

        transactionSummary: {
          total:
            summary.totalTransactions ||
            0,

          totalAmount:
            summary.totalAmount || 0,

          successful:
            summary.successful || 0,

          pending:
            summary.pending || 0,

          failed:
            summary.failed || 0,
        },

        recentTransactions,
      },

      user:
        formatCustomer(user),
    });
  } catch (error) {
    console.error(
      "Get admin user details error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to load user details.",
      error: error.message,
    });
  }
};

/*
|--------------------------------------------------------------------------
| UPDATE CUSTOMER PROFILE
|--------------------------------------------------------------------------
*/

exports.updateAdminUserProfile = async (
  req,
  res
) => {
  let targetUser = null;

  try {
    if (
      !ensureHeadOffice(
        req,
        res
      )
    ) {
      return;
    }

    const userId = String(
      req.params.id || ""
    ).trim();

    if (
      !validateUserId(
        userId,
        res
      )
    ) {
      return;
    }

    const reason =
      requireReason(
        req,
        res
      );

    if (!reason) {
      return;
    }

    targetUser =
      await User.findById(
        userId
      );

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message:
          "User account was not found.",
      });
    }

    if (
      normalizeRole(
        targetUser.role
      ) === "HEAD_OFFICE" &&
      String(targetUser._id) !==
        String(
          getActorId(req)
        )
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Another Head Office account cannot be edited through customer management.",
      });
    }

    const previousData = {
      fullName:
        targetUser.fullName,

      phone:
        targetUser.phone,

      email:
        targetUser.email || null,

      zone:
        targetUser.zone || null,

      state:
        targetUser.state || null,

      lga:
        targetUser.lga || null,
    };

    const fullName =
      req.body.fullName ===
      undefined
        ? targetUser.fullName
        : String(
            req.body.fullName
          ).trim();

    const phone =
      req.body.phone ===
      undefined
        ? targetUser.phone
        : String(
            req.body.phone
          ).trim();

    const email =
      req.body.email ===
      undefined
        ? String(
            targetUser.email || ""
          )
        : String(
            req.body.email || ""
          )
            .trim()
            .toLowerCase();

    const zone =
      req.body.zone ===
      undefined
        ? targetUser.zone
        : String(
            req.body.zone || ""
          ).trim() || null;

    const state =
      req.body.state ===
      undefined
        ? targetUser.state
        : String(
            req.body.state || ""
          ).trim() || null;

    const lga =
      req.body.lga ===
      undefined
        ? targetUser.lga
        : String(
            req.body.lga || ""
          ).trim() || null;

    if (!fullName) {
      return res.status(400).json({
        success: false,
        message:
          "Full name is required.",
      });
    }

    if (
      !/^\d{10,15}$/.test(
        phone
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Enter a valid phone number containing 10 to 15 digits.",
      });
    }

    if (
      email &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
        email
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Enter a valid email address.",
      });
    }

    const duplicateConditions = [
      {
        phone,
        _id: {
          $ne: targetUser._id,
        },
      },
    ];

    if (email) {
      duplicateConditions.push({
        email,
        _id: {
          $ne: targetUser._id,
        },
      });
    }

    const duplicateUser =
      await User.findOne({
        $or:
          duplicateConditions,
      }).select(
        "_id fullName phone email"
      );

    if (duplicateUser) {
      return res.status(409).json({
        success: false,
        message:
          "Another account already uses this phone number or email address.",
      });
    }

    targetUser.fullName =
      fullName;

    targetUser.phone =
      phone;

    targetUser.email =
      email || undefined;

    targetUser.zone =
      zone || null;

    targetUser.state =
      state || null;

    targetUser.lga =
      lga || null;

    await targetUser.save();

    const updatedUser =
      await User.findById(
        targetUser._id
      )
        .select(
          "-password -transactionPin -passwordResetToken -passwordResetExpires"
        )
        .populate(
          "zonalManagerId",
          "fullName phone email role zone state status"
        )
        .populate(
          "stateManagerId",
          "fullName phone email role zone state lga status"
        )
        .populate(
          "agentId",
          "fullName phone email role zone state lga status"
        )
        .lean();

    const newData = {
      fullName:
        updatedUser.fullName,

      phone:
        updatedUser.phone,

      email:
        updatedUser.email || null,

      zone:
        updatedUser.zone || null,

      state:
        updatedUser.state || null,

      lga:
        updatedUser.lga || null,
    };

    await createAuditLog({
      req,
      targetUser:
        updatedUser,

      action:
        "USER_PROFILE_UPDATED",

      reason,

      previousData,
      newData,
    });

    return res.status(200).json({
      success: true,
      message:
        "User profile updated successfully.",

      data: {
        user:
          formatCustomer(
            updatedUser
          ),
      },

      user:
        formatCustomer(
          updatedUser
        ),
    });
  } catch (error) {
    console.error(
      "Update admin user profile error:",
      error
    );

    if (
      error?.code === 11000
    ) {
      return res.status(409).json({
        success: false,
        message:
          "Phone number or email address already belongs to another account.",
      });
    }

    if (
      error?.name ===
      "ValidationError"
    ) {
      const message =
        Object.values(
          error.errors || {}
        )
          .map(
            (item) =>
              item.message
          )
          .join(", ");

      return res.status(400).json({
        success: false,
        message:
          message ||
          "Invalid user profile information.",
      });
    }

    if (targetUser) {
      await createAuditLog({
        req,
        targetUser,

        action:
          "USER_PROFILE_UPDATED",

        reason:
          String(
            req.body.reason ||
              "Profile update failed"
          ).trim(),

        status:
          "FAILED",

        failureReason:
          error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message:
        "Failed to update user profile.",
      error: error.message,
    });
  }
};

/*
|--------------------------------------------------------------------------
| RESET TRANSACTION PIN
|--------------------------------------------------------------------------
*/

exports.resetAdminUserTransactionPin =
  async (
    req,
    res
  ) => {
    let targetUser = null;

    try {
      if (
        !ensureHeadOffice(
          req,
          res
        )
      ) {
        return;
      }

      const userId = String(
        req.params.id || ""
      ).trim();

      if (
        !validateUserId(
          userId,
          res
        )
      ) {
        return;
      }

      const reason =
        requireReason(
          req,
          res
        );

      if (!reason) {
        return;
      }

      targetUser =
        await User.findById(
          userId
        ).select(
          "+transactionPin transactionPinSet transactionPinUpdatedAt fullName role"
        );

      if (!targetUser) {
        return res.status(404).json({
          success: false,
          message:
            "User account was not found.",
        });
      }

      if (
        normalizeRole(
          targetUser.role
        ) === "HEAD_OFFICE"
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Head Office transaction PIN cannot be reset through customer management.",
        });
      }

      const previousData = {
        transactionPinSet:
          targetUser
            .transactionPinSet ===
          true,

        transactionPinUpdatedAt:
          targetUser
            .transactionPinUpdatedAt ||
          null,
      };

      targetUser.transactionPin =
        undefined;

      targetUser.transactionPinSet =
        false;

      targetUser.transactionPinUpdatedAt =
        null;

      await targetUser.save({
        validateBeforeSave: false,
      });

      const newData = {
        transactionPinSet:
          false,

        transactionPinUpdatedAt:
          null,
      };

      await createAuditLog({
        req,
        targetUser,

        action:
          "TRANSACTION_PIN_RESET",

        reason,

        previousData,
        newData,
      });

      return res.status(200).json({
        success: true,
        message:
          "Transaction PIN reset successfully. The customer can now create a new PIN.",

        data: {
          transactionPinSet:
            false,
        },
      });
    } catch (error) {
      console.error(
        "Reset customer transaction PIN error:",
        error
      );

      if (targetUser) {
        await createAuditLog({
          req,
          targetUser,

          action:
            "TRANSACTION_PIN_RESET",

          reason:
            String(
              req.body.reason ||
                "Transaction PIN reset failed"
            ).trim(),

          status:
            "FAILED",

          failureReason:
            error.message,
        });
      }

      return res.status(500).json({
        success: false,
        message:
          "Failed to reset the customer transaction PIN.",
        error: error.message,
      });
    }
  };

/*
|--------------------------------------------------------------------------
| SEND PASSWORD RESET EMAIL
|--------------------------------------------------------------------------
*/

exports.requestAdminUserPasswordReset =
  async (
    req,
    res
  ) => {
    let targetUser = null;

    try {
      if (
        !ensureHeadOffice(
          req,
          res
        )
      ) {
        return;
      }

      const userId = String(
        req.params.id || ""
      ).trim();

      if (
        !validateUserId(
          userId,
          res
        )
      ) {
        return;
      }

      const reason =
        requireReason(
          req,
          res
        );

      if (!reason) {
        return;
      }

      targetUser =
        await User.findById(
          userId
        ).select(
          "+passwordResetToken +passwordResetExpires fullName email phone role"
        );

      if (!targetUser) {
        return res.status(404).json({
          success: false,
          message:
            "User account was not found.",
        });
      }

      if (
        !targetUser.email
      ) {
        return res.status(400).json({
          success: false,
          message:
            "This customer has no email address. Add a verified email before requesting a password reset.",
        });
      }

      if (
        normalizeRole(
          targetUser.role
        ) === "HEAD_OFFICE"
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Head Office password reset cannot be requested through customer management.",
        });
      }

      const resetToken =
        crypto
          .randomBytes(32)
          .toString("hex");

      const hashedToken =
        crypto
          .createHash(
            "sha256"
          )
          .update(
            resetToken
          )
          .digest("hex");

      const expiresAt =
        new Date(
          Date.now() +
            20 * 60 * 1000
        );

      targetUser.passwordResetToken =
        hashedToken;

      targetUser.passwordResetExpires =
        expiresAt;

      await targetUser.save({
        validateBeforeSave: false,
      });

      const frontendUrl = String(
        process.env
          .FRONTEND_URL ||
          "https://servicepay.ng"
      ).replace(
        /\/+$/,
        ""
      );

      const resetUrl =
        `${frontendUrl}/?reset-password=true&token=${resetToken}`;

      const firstName =
        String(
          targetUser.fullName ||
            "Customer"
        )
          .trim()
          .split(/\s+/)[0] ||
        "Customer";

      const subject =
        "Reset your ServicePay password";

      const text = [
        `Hello ${firstName},`,
        "",
        "ServicePay support approved a password reset request for your account.",
        "",
        `Open this link to create a new password: ${resetUrl}`,
        "",
        "This link expires in 20 minutes.",
        "",
        "If you did not contact ServicePay support, please ignore this email and contact us immediately.",
        "",
        "ServicePay Support",
      ].join("\n");

      const html = `
        <!doctype html>
        <html>
          <body style="margin:0;padding:0;background:#f4f7f6;font-family:Arial,sans-serif;color:#17211a;">
            <table width="100%" cellpadding="0" cellspacing="0" style="padding:30px 12px;background:#f4f7f6;">
              <tr>
                <td align="center">
                  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden;">
                    <tr>
                      <td style="padding:24px;background:#149b8f;color:#ffffff;">
                        <div style="font-size:24px;font-weight:800;">ServicePay</div>
                        <div style="font-size:13px;margin-top:4px;">Password Reset</div>
                      </td>
                    </tr>

                    <tr>
                      <td style="padding:28px;">
                        <p style="font-size:17px;margin-top:0;">
                          Hello ${firstName},
                        </p>

                        <p style="line-height:1.6;">
                          ServicePay support approved a password reset request for your account.
                        </p>

                        <p style="line-height:1.6;">
                          Click the button below to create your new password.
                          This link expires in <strong>20 minutes</strong>.
                        </p>

                        <p style="text-align:center;margin:30px 0;">
                          <a
                            href="${resetUrl}"
                            style="display:inline-block;background:#149b8f;color:#ffffff;text-decoration:none;padding:15px 25px;border-radius:10px;font-weight:700;"
                          >
                            Reset Password
                          </a>
                        </p>

                        <p style="font-size:13px;line-height:1.6;color:#64748b;">
                          If the button does not work, copy and paste this link into your browser:
                        </p>

                        <p style="font-size:12px;word-break:break-all;color:#149b8f;">
                          ${resetUrl}
                        </p>

                        <p style="line-height:1.6;margin-bottom:0;">
                          If you did not contact ServicePay support, ignore this email and contact us immediately.
                        </p>
                      </td>
                    </tr>

                    <tr>
                      <td style="padding:18px 28px;background:#f8fafc;color:#64748b;font-size:12px;">
                        © ServicePay. Making everyday services simple.
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </body>
        </html>
      `;

      try {
        await sendEmail({
          to:
            targetUser.email,

          subject,
          text,
          html,
        });
      } catch (emailError) {
        targetUser.passwordResetToken =
          undefined;

        targetUser.passwordResetExpires =
          undefined;

        await targetUser.save({
          validateBeforeSave:
            false,
        });

        throw new Error(
          `Unable to send password reset email: ${emailError.message}`
        );
      }

      await createAuditLog({
        req,
        targetUser,

        action:
          "PASSWORD_RESET_REQUESTED",

        reason,

        previousData: {
          passwordResetRequested:
            false,
        },

        newData: {
          passwordResetRequested:
            true,

          expiresAt,

          deliveryMethod:
            "EMAIL",

          email:
            targetUser.email,
        },
      });

      return res.status(200).json({
        success: true,
        message:
          "Password reset email sent successfully.",

        data: {
          email:
            targetUser.email,

          expiresAt,
        },
      });
    } catch (error) {
      console.error(
        "Admin customer password-reset request error:",
        error
      );

      if (targetUser) {
        await createAuditLog({
          req,
          targetUser,

          action:
            "PASSWORD_RESET_REQUESTED",

          reason:
            String(
              req.body.reason ||
                "Password reset request failed"
            ).trim(),

          status:
            "FAILED",

          failureReason:
            error.message,
        });
      }

      return res.status(500).json({
        success: false,
        message:
          error.message ||
          "Failed to send password reset email.",
      });
    }
  };

/*
|--------------------------------------------------------------------------
| GET CUSTOMER TRANSACTIONS
|--------------------------------------------------------------------------
*/

exports.getAdminUserTransactions =
  async (
    req,
    res
  ) => {
    try {
      const userId = String(
        req.params.id || ""
      ).trim();

      if (
        !validateUserId(
          userId,
          res
        )
      ) {
        return;
      }

      const user =
        await User.findById(
          userId
        ).select(
          "_id fullName phone email role status"
        );

      if (!user) {
        return res.status(404).json({
          success: false,
          message:
            "User account was not found.",
        });
      }

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
        (page - 1) * limit;

      const status =
        String(
          req.query.status ||
            ""
        )
          .trim()
          .toUpperCase();

      const serviceType =
        String(
          req.query.serviceType ||
            req.query.service ||
            ""
        )
          .trim()
          .toUpperCase();

      const search = String(
        req.query.search || ""
      ).trim();

      const filter = {
        customerId:
          user._id,
      };

      if (
        status &&
        status !== "ALL"
      ) {
        if (
          [
            "SUCCESS",
            "SUCCESSFUL",
            "COMPLETED",
          ].includes(status)
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
        const searchRegex =
          new RegExp(
            escapeRegex(search),
            "i"
          );

        filter.$or = [
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
      }

      const [
        transactions,
        totalTransactions,
        summary,
      ] = await Promise.all([
        Transaction.find(
          filter
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

        Transaction.aggregate([
          {
            $match: {
              customerId:
                user._id,
            },
          },
          {
            $group: {
              _id: null,

              total: {
                $sum: 1,
              },

              totalAmount: {
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

              successful: {
                $sum: {
                  $cond: [
                    {
                      $in: [
                        "$status",
                        [
                          "SUCCESS",
                          "SUCCESSFUL",
                          "COMPLETED",
                          "APPROVED",
                        ],
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },

              pending: {
                $sum: {
                  $cond: [
                    {
                      $in: [
                        "$status",
                        [
                          "PENDING",
                          "PROCESSING",
                        ],
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },

              failed: {
                $sum: {
                  $cond: [
                    {
                      $in: [
                        "$status",
                        [
                          "FAILED",
                          "CANCELLED",
                          "REJECTED",
                        ],
                      ],
                    },
                    1,
                    0,
                  ],
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
            totalTransactions /
              limit
          )
        );

      const transactionSummary =
        summary[0] || {
          total: 0,
          totalAmount: 0,
          successful: 0,
          pending: 0,
          failed: 0,
        };

      return res.status(200).json({
        success: true,
        message:
          "Customer transactions loaded successfully.",

        data: {
          user:
            formatCustomer(user),

          transactions,

          summary:
            transactionSummary,

          pagination: {
            page,
            currentPage: page,
            limit,

            total:
              totalTransactions,

            totalItems:
              totalTransactions,

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
        "Get customer transactions error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to load customer transactions.",
        error: error.message,
      });
    }
  };

/*
|--------------------------------------------------------------------------
| GET ADMIN AUDIT LOGS
|--------------------------------------------------------------------------
*/

exports.getAdminAuditLogs = async (
  req,
  res
) => {
  try {
    if (
      !ensureHeadOffice(
        req,
        res
      )
    ) {
      return;
    }

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
      (page - 1) * limit;

    const targetUserId =
      String(
        req.query.targetUserId ||
          req.params.id ||
          ""
      ).trim();

    const actorId =
      String(
        req.query.actorId ||
          ""
      ).trim();

    const action =
      String(
        req.query.action ||
          ""
      )
        .trim()
        .toUpperCase();

    const status =
      String(
        req.query.status ||
          ""
      )
        .trim()
        .toUpperCase();

    const search = String(
      req.query.search || ""
    ).trim();

    const filter = {};

    if (targetUserId) {
      if (
        !validateUserId(
          targetUserId,
          res
        )
      ) {
        return;
      }

      filter.targetUserId =
        targetUserId;
    }

    if (actorId) {
      if (
        !validateUserId(
          actorId,
          res
        )
      ) {
        return;
      }

      filter.actorId =
        actorId;
    }

    if (
      action &&
      action !== "ALL"
    ) {
      filter.action =
        action;
    }

    if (
      status &&
      status !== "ALL"
    ) {
      filter.status =
        status;
    }

    if (search) {
      const searchRegex =
        new RegExp(
          escapeRegex(search),
          "i"
        );

      filter.$or = [
        {
          actorName:
            searchRegex,
        },
        {
          targetUserName:
            searchRegex,
        },
        {
          reason:
            searchRegex,
        },
        {
          action:
            searchRegex,
        },
      ];
    }

    const [
      logs,
      totalLogs,
    ] = await Promise.all([
      AdminAuditLog.find(
        filter
      )
        .populate(
          "actorId",
          "fullName email phone role staffId department"
        )
        .populate(
          "targetUserId",
          "fullName email phone role status"
        )
        .sort({
          createdAt: -1,
        })
        .skip(skip)
        .limit(limit)
        .lean(),

      AdminAuditLog.countDocuments(
        filter
      ),
    ]);

    const totalPages =
      Math.max(
        1,
        Math.ceil(
          totalLogs / limit
        )
      );

    return res.status(200).json({
      success: true,
      message:
        "Admin audit logs loaded successfully.",

      data: {
        logs,

        pagination: {
          page,
          currentPage: page,
          limit,

          total:
            totalLogs,

          totalItems:
            totalLogs,

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
      "Get admin audit logs error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to load admin audit logs.",
      error: error.message,
    });
  }
};