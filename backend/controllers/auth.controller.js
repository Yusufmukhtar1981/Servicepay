const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/user.model");
const { sendEmail } = require("../services/email.service");

const generateToken = (userId) => {
  if (!process.env.JWT_SECRET) {
    throw new Error(
      "JWT_SECRET is missing from environment variables."
    );
  }

  return jwt.sign(
    {
      id: userId,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "7d",
    }
  );
};

const formatUser = (user) => {
  return {
    id: user._id,
    _id: user._id,
    fullName: user.fullName,
    phone: user.phone,
    email: user.email,
    role: user.role,
    status: user.status,
    zone: user.zone,
    state: user.state,
    lga: user.lga,
    zonalManagerId: user.zonalManagerId,
    stateManagerId: user.stateManagerId,
    agentId: user.agentId,
    walletBalance: Number(
      user.walletBalance || 0
    ),
    commissionBalance: Number(
      user.commissionBalance || 0
    ),
    totalEarnings: Number(
      user.totalEarnings || 0
    ),
    totalTransactions: Number(
      user.totalTransactions || 0
    ),
    kycVerified:
      user.kycVerified === true,
    transactionPinSet:
      user.transactionPinSet === true,
    virtualAccount:
      user.virtualAccount || null,

    isStaff: user.isStaff === true,
    staffId: user.staffId || null,
    department: user.department || null,
    mustChangePassword:
      user.mustChangePassword === true,
    lastStaffLoginAt:
      user.lastStaffLoginAt || null,

    staffRole:
      user.staffRoleId &&
      typeof user.staffRoleId === "object" &&
      user.staffRoleId.name
        ? {
            id:
              user.staffRoleId._id ||
              user.staffRoleId.id,
            name:
              user.staffRoleId.name,
            displayName:
              user.staffRoleId.displayName,
            department:
              user.staffRoleId.department,
            permissions:
              Array.isArray(
                user.staffRoleId.permissions
              )
                ? user.staffRoleId.permissions
                : [],
            status:
              user.staffRoleId.status,
          }
        : null,

    permissions:
      user.staffRoleId &&
      typeof user.staffRoleId === "object" &&
      Array.isArray(
        user.staffRoleId.permissions
      )
        ? user.staffRoleId.permissions
        : [],

    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
};

exports.registerUser = async (
  req,
  res
) => {
  try {
    const {
      fullName,
      phone,
      email,
      password,
      zone,
      state,
      lga,
      zonalManagerId,
      stateManagerId,
      agentId,
    } = req.body;

    const cleanFullName = String(
      fullName || ""
    ).trim();

    const cleanPhone = String(
      phone || ""
    ).trim();

    const cleanEmail = String(
      email || ""
    )
      .trim()
      .toLowerCase();

    const cleanPassword = String(
      password || ""
    );

    if (
      !cleanFullName ||
      !cleanPhone ||
      !cleanPassword
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Full name, phone number and password are required.",
      });
    }

    if (cleanPhone.length < 10) {
      return res.status(400).json({
        success: false,
        message:
          "Enter a valid phone number.",
      });
    }

    if (cleanPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message:
          "Password must contain at least 6 characters.",
      });
    }

    const duplicateConditions = [
      {
        phone: cleanPhone,
      },
    ];

    if (cleanEmail) {
      duplicateConditions.push({
        email: cleanEmail,
      });
    }

    const existingUser =
      await User.findOne({
        $or: duplicateConditions,
      });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message:
          "An account already exists with this phone number or email.",
      });
    }

    const user = await User.create({
      fullName: cleanFullName,
      phone: cleanPhone,
      email:
        cleanEmail || undefined,
      password: cleanPassword,

      /*
       * Only CUSTOMER accounts can register
       * through the public ServicePay app.
       */
      role: "CUSTOMER",
      status: "ACTIVE",
      walletBalance: 0,
      commissionBalance: 0,
      totalEarnings: 0,
      totalTransactions: 0,
      transactionPinSet: false,

      zone:
        String(zone || "").trim() ||
        undefined,

      state:
        String(state || "").trim() ||
        undefined,

      lga:
        String(lga || "").trim() ||
        undefined,

      zonalManagerId:
        zonalManagerId || undefined,

      stateManagerId:
        stateManagerId || undefined,

      agentId:
        agentId || undefined,
    });

    return res.status(201).json({
      success: true,
      message:
        "Account created successfully.",
      token: generateToken(user._id),
      user: formatUser(user),
    });
  } catch (error) {
    console.error(
      "Register error:",
      error
    );

    if (error?.code === 11000) {
      return res.status(400).json({
        success: false,
        message:
          "An account already exists with this phone number or email.",
      });
    }

    if (
      error?.name ===
      "ValidationError"
    ) {
      const validationMessage =
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
          validationMessage ||
          "Invalid registration information.",
      });
    }

    return res.status(500).json({
      success: false,
      message:
        "Unable to create account.",
      error: error.message,
    });
  }
};

exports.loginUser = async (
  req,
  res
) => {
  try {
    const {
      phone,
      email,
      identifier,
      password,
    } = req.body;

    const loginValue =
      email ||
      phone ||
      identifier;

    if (
      !loginValue ||
      !password
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Email or phone number and password are required.",
      });
    }

    const cleanLoginValue = String(
      loginValue
    ).trim();

    const normalizedEmail =
      cleanLoginValue.toLowerCase();

    /*
     * Password uses select:false in user.model.js.
     * We must explicitly request it with +password.
     */
    const user = await User.findOne({
      $or: [
        {
          email: normalizedEmail,
        },
        {
          phone: cleanLoginValue,
        },
      ],
    }).select("+password");

    if (!user) {
      return res.status(401).json({
        success: false,
        message:
          "Incorrect email, phone number or password.",
      });
    }

    const userStatus = String(
      user.status || "ACTIVE"
    )
      .trim()
      .toUpperCase();

    if (
      userStatus !== "ACTIVE"
    ) {
      return res.status(403).json({
        success: false,
        message:
          "This account is not active.",
      });
    }

    const savedPassword =
      typeof user.password ===
      "string"
        ? user.password
        : "";

    if (!savedPassword) {
      return res.status(401).json({
        success: false,
        message:
          "Incorrect email, phone number or password.",
      });
    }

    const passwordIsHashed =
      savedPassword.startsWith(
        "$2a$"
      ) ||
      savedPassword.startsWith(
        "$2b$"
      ) ||
      savedPassword.startsWith(
        "$2y$"
      );

    let passwordIsCorrect = false;

    if (passwordIsHashed) {
      passwordIsCorrect =
        await user.comparePassword(
          String(password)
        );
    } else {
      /*
       * This supports older accounts whose
       * passwords were saved before bcrypt.
       */
      passwordIsCorrect =
        String(password) ===
        savedPassword;

      if (passwordIsCorrect) {
        user.password =
          String(password);

        /*
         * user.model.js will hash it
         * automatically before saving.
         */
        await user.save();

        console.log(
          `Password migrated to bcrypt for ${
            user.email ||
            user.phone
          }`
        );
      }
    }

    if (!passwordIsCorrect) {
      return res.status(401).json({
        success: false,
        message:
          "Incorrect email, phone number or password.",
      });
    }

    /*
     * Load the assigned staff role only for internal staff accounts.
     * Existing customer and network-manager logins remain unchanged.
     */
    if (
      String(user.role || "")
        .trim()
        .toUpperCase() === "STAFF" &&
      user.isStaff === true
    ) {
      await user.populate({
        path: "staffRoleId",
        select:
          "name displayName department permissions status",
      });

      if (
        !user.staffRoleId ||
        user.staffRoleId.status !== "ACTIVE"
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Your assigned staff role is unavailable or inactive.",
        });
      }

      user.lastStaffLoginAt = new Date();

      await user.save({
        validateBeforeSave: false,
      });
    }

    return res.status(200).json({
      success: true,
      message:
        "Login successful.",
      token: generateToken(
        user._id
      ),
      user: formatUser(user),
    });
  } catch (error) {
    console.error(
      "Login error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to sign in at the moment.",
      error: error.message,
    });
  }
};

exports.getProfile = async (
  req,
  res
) => {
  try {
    const userId =
      req.user?._id ||
      req.user?.id ||
      req.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message:
          "Authentication is required.",
      });
    }

    const user =
      await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message:
          "User account not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message:
        "Profile fetched successfully.",
      user: formatUser(user),
      data: {
        user: formatUser(user),
      },
    });
  } catch (error) {
    console.error(
      "Get profile error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to fetch your profile.",
    });
  }
};

exports.updateProfile = async (
  req,
  res
) => {
  try {
    const userId =
      req.user?._id ||
      req.user?.id ||
      req.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message:
          "Authentication is required.",
      });
    }

    const {
      fullName,
      phone,
      email,
      state,
      lga,
      zone,
    } = req.body;

    const user =
      await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message:
          "User account not found.",
      });
    }

    const cleanFullName =
      fullName === undefined
        ? user.fullName
        : String(
            fullName
          ).trim();

    const cleanPhone =
      phone === undefined
        ? user.phone
        : String(phone).trim();

    const cleanEmail =
      email === undefined
        ? String(
            user.email || ""
          )
        : String(email)
            .trim()
            .toLowerCase();

    if (!cleanFullName) {
      return res.status(400).json({
        success: false,
        message:
          "Full name is required.",
      });
    }

    if (
      !cleanPhone ||
      cleanPhone.length < 10
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Enter a valid phone number.",
      });
    }

    const duplicateConditions = [
      {
        phone: cleanPhone,
        _id: {
          $ne: userId,
        },
      },
    ];

    if (cleanEmail) {
      duplicateConditions.push({
        email: cleanEmail,
        _id: {
          $ne: userId,
        },
      });
    }

    const existingUser =
      await User.findOne({
        $or: duplicateConditions,
      });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message:
          "Another account already uses this phone number or email.",
      });
    }

    user.fullName =
      cleanFullName;

    user.phone =
      cleanPhone;

    user.email =
      cleanEmail || undefined;

    if (state !== undefined) {
      user.state =
        String(
          state || ""
        ).trim() || undefined;
    }

    if (lga !== undefined) {
      user.lga =
        String(
          lga || ""
        ).trim() || undefined;
    }

    if (zone !== undefined) {
      user.zone =
        String(
          zone || ""
        ).trim() || undefined;
    }

    await user.save();

    return res.status(200).json({
      success: true,
      message:
        "Profile updated successfully.",
      user: formatUser(user),
      data: {
        user: formatUser(user),
      },
    });
  } catch (error) {
    console.error(
      "Update profile error:",
      error
    );

    if (error?.code === 11000) {
      return res.status(400).json({
        success: false,
        message:
          "Another account already uses this phone number or email.",
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
          "Invalid profile information.",
      });
    }

    return res.status(500).json({
      success: false,
      message:
        "Unable to update your profile.",
    });
  }
};

exports.changePassword = async (
  req,
  res
) => {
  try {
    const userId =
      req.user?._id ||
      req.user?.id ||
      req.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message:
          "Authentication is required.",
      });
    }

    const {
      currentPassword,
      newPassword,
      confirmPassword,
    } = req.body;

    if (
      !currentPassword ||
      !newPassword ||
      !confirmPassword
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Current password, new password and confirmation are required.",
      });
    }

    if (
      String(newPassword)
        .length < 6
    ) {
      return res.status(400).json({
        success: false,
        message:
          "New password must contain at least 6 characters.",
      });
    }

    if (
      String(newPassword) !==
      String(confirmPassword)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "New password and confirmation do not match.",
      });
    }

    if (
      String(currentPassword) ===
      String(newPassword)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "New password must be different from the current password.",
      });
    }

    const user =
      await User.findById(
        userId
      ).select("+password");

    if (!user) {
      return res.status(404).json({
        success: false,
        message:
          "User account not found.",
      });
    }

    const savedPassword =
      typeof user.password ===
      "string"
        ? user.password
        : "";

    if (!savedPassword) {
      return res.status(400).json({
        success: false,
        message:
          "Current password is incorrect.",
      });
    }

    const passwordIsHashed =
      savedPassword.startsWith(
        "$2a$"
      ) ||
      savedPassword.startsWith(
        "$2b$"
      ) ||
      savedPassword.startsWith(
        "$2y$"
      );

    let passwordIsCorrect = false;

    if (passwordIsHashed) {
      passwordIsCorrect =
        await user.comparePassword(
          String(
            currentPassword
          )
        );
    } else {
      passwordIsCorrect =
        String(
          currentPassword
        ) === savedPassword;
    }

    if (!passwordIsCorrect) {
      return res.status(400).json({
        success: false,
        message:
          "Current password is incorrect.",
      });
    }

    user.password =
      String(newPassword);

    await user.save();

    return res.status(200).json({
      success: true,
      message:
        "Password changed successfully.",
    });
  } catch (error) {
    console.error(
      "Change password error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to change your password.",
    });
  }
};

/**
 * Request a password reset link.
 * Always returns a generic response so attackers cannot discover
 * whether an email address is registered.
 */
exports.forgotPassword = async (req, res) => {
  const genericMessage =
    "If an account exists with this email, a password reset link has been sent.";

  try {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email address is required.",
      });
    }

    const user = await User.findOne({
      email,
    }).select(
      "+passwordResetToken +passwordResetExpires"
    );

    if (!user) {
      return res.status(200).json({
        success: true,
        message: genericMessage,
      });
    }

    const resetToken = crypto
      .randomBytes(32)
      .toString("hex");

    const hashedToken = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");

    user.passwordResetToken = hashedToken;
    user.passwordResetExpires =
      Date.now() + 20 * 60 * 1000;

    await user.save({
      validateBeforeSave: false,
    });

    const frontendUrl = String(
      process.env.FRONTEND_URL ||
        "https://servicepay.ng"
    ).replace(/\/+$/, "");

    const resetUrl =
      `${frontendUrl}/?reset-password=true&token=${resetToken}`;

    const firstName =
      String(user.fullName || "Customer")
        .trim()
        .split(/\s+/)[0] || "Customer";

    const subject =
      "Reset your ServicePay password";

    const text = [
      `Hello ${firstName},`,
      "",
      "We received a request to reset your ServicePay password.",
      "",
      `Open this link to create a new password: ${resetUrl}`,
      "",
      "This link will expire in 20 minutes.",
      "",
      "If you did not request this change, you can ignore this email.",
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
                      <p style="font-size:17px;margin-top:0;">Hello ${firstName},</p>

                      <p style="line-height:1.6;">
                        We received a request to reset your ServicePay password.
                      </p>

                      <p style="line-height:1.6;">
                        Click the button below to create a new password.
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
                        If you did not request this change, you can safely ignore this email.
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
        to: user.email,
        subject,
        text,
        html,
      });
    } catch (emailError) {
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;

      await user.save({
        validateBeforeSave: false,
      });

      console.error(
        "Forgot password email error:",
        emailError
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to send the password reset email. Please try again later.",
      });
    }

    return res.status(200).json({
      success: true,
      message: genericMessage,
    });
  } catch (error) {
    console.error(
      "Forgot password error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to process the password reset request.",
    });
  }
};

/**
 * Reset password with a valid one-time token.
 */
exports.resetPassword = async (req, res) => {
  try {
    const token = String(
      req.body?.token ||
        req.params?.token ||
        ""
    ).trim();

    const newPassword = String(
      req.body?.newPassword ||
        req.body?.password ||
        ""
    );

    const confirmPassword = String(
      req.body?.confirmPassword ||
        req.body?.passwordConfirmation ||
        ""
    );

    if (!token) {
      return res.status(400).json({
        success: false,
        message:
          "Password reset token is required.",
      });
    }

    if (!newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message:
          "New password and confirmation are required.",
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message:
          "New password must contain at least 6 characters.",
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message:
          "New password and confirmation do not match.",
      });
    }

    const hashedToken = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: {
        $gt: Date.now(),
      },
    }).select(
      "+password +passwordResetToken +passwordResetExpires"
    );

    if (!user) {
      return res.status(400).json({
        success: false,
        message:
          "This password reset link is invalid or has expired.",
      });
    }

    const savedPassword =
      typeof user.password === "string"
        ? user.password
        : "";

    const passwordIsHashed =
      savedPassword.startsWith("$2a$") ||
      savedPassword.startsWith("$2b$") ||
      savedPassword.startsWith("$2y$");

    let sameAsCurrentPassword = false;

    if (savedPassword) {
      if (passwordIsHashed) {
        sameAsCurrentPassword =
          await bcrypt.compare(
            newPassword,
            savedPassword
          );
      } else {
        sameAsCurrentPassword =
          newPassword === savedPassword;
      }
    }

    if (sameAsCurrentPassword) {
      return res.status(400).json({
        success: false,
        message:
          "New password must be different from the previous password.",
      });
    }

    user.password = newPassword;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    user.passwordChangedAt = new Date();

    await user.save();

    return res.status(200).json({
      success: true,
      message:
        "Password reset successfully. You can now log in with your new password.",
    });
  } catch (error) {
    console.error(
      "Reset password error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to reset your password. Please try again.",
    });
  }
};

