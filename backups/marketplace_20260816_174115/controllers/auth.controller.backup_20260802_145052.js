const jwt = require("jsonwebtoken");
const User = require("../models/user.model");

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
