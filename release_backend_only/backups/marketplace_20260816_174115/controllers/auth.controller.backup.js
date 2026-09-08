const jwt = require("jsonwebtoken");
const User = require("../models/user.model");

const generateToken = (userId) => {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET ba ya cikin environment variables.");
  }

  return jwt.sign(
    { id: userId },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
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
    walletBalance: Number(user.walletBalance || 0),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
};

exports.registerUser = async (req, res) => {
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

    const cleanFullName = String(fullName || "").trim();
    const cleanPhone = String(phone || "").trim();
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanPassword = String(password || "");

    if (!cleanFullName || !cleanPhone || !cleanPassword) {
      return res.status(400).json({
        success: false,
        message: "Full name, phone da password suna da bukata.",
      });
    }

    if (cleanPhone.length < 10) {
      return res.status(400).json({
        success: false,
        message: "Ka saka ingantaccen phone number.",
      });
    }

    if (cleanPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password dole ya kasance akalla haruffa 6.",
      });
    }

    const duplicateConditions = [
      { phone: cleanPhone },
    ];

    if (cleanEmail) {
      duplicateConditions.push({
        email: cleanEmail,
      });
    }

    const existingUser = await User.findOne({
      $or: duplicateConditions,
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message:
          "An riga an yi register da wannan phone ko email.",
      });
    }

    const user = await User.create({
      fullName: cleanFullName,
      phone: cleanPhone,
      email: cleanEmail || undefined,
      password: cleanPassword,

      // Customer ne kawai zai iya register daga public app.
      role: "CUSTOMER",
      status: "ACTIVE",
      walletBalance: 0,

      zone: zone || undefined,
      state: state || undefined,
      lga: lga || undefined,
      zonalManagerId: zonalManagerId || undefined,
      stateManagerId: stateManagerId || undefined,
      agentId: agentId || undefined,
    });

    return res.status(201).json({
      success: true,
      message: "An kirkiri account cikin nasara.",
      token: generateToken(user._id),
      user: formatUser(user),
    });
  } catch (error) {
    console.error("Register error:", error);

    if (error?.code === 11000) {
      return res.status(400).json({
        success: false,
        message:
          "An riga an yi register da wannan phone ko email.",
      });
    }

    if (error?.name === "ValidationError") {
      const validationMessage = Object.values(
        error.errors || {}
      )
        .map((item) => item.message)
        .join(", ");

      return res.status(400).json({
        success: false,
        message:
          validationMessage ||
          "Bayanan registration ba su cika ba.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "An samu matsala wajen kirkirar account.",
      error: error.message,
    });
  }
};

exports.loginUser = async (req, res) => {
  try {
    const {
      phone,
      email,
      identifier,
      password,
    } = req.body;

    const loginValue =
      email || phone || identifier;

    if (!loginValue || !password) {
      return res.status(400).json({
        success: false,
        message:
          "Email ko phone tare da password suna da bukata.",
      });
    }

    const cleanLoginValue =
      String(loginValue).trim();

    const normalizedEmail =
      cleanLoginValue.toLowerCase();

    const user = await User.findOne({
      $or: [
        { email: normalizedEmail },
        { phone: cleanLoginValue },
      ],
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Bayanan shiga ba daidai ba ne.",
      });
    }

    const userStatus = String(
      user.status || "ACTIVE"
    ).toUpperCase();

    if (userStatus !== "ACTIVE") {
      return res.status(403).json({
        success: false,
        message:
          "Wannan account din ba ya aiki a halin yanzu.",
      });
    }

    let passwordIsCorrect = false;

    const savedPassword =
      typeof user.password === "string"
        ? user.password
        : "";

    const passwordIsHashed =
      savedPassword.startsWith("$2a$") ||
      savedPassword.startsWith("$2b$") ||
      savedPassword.startsWith("$2y$");

    if (passwordIsHashed) {
      if (
        typeof user.comparePassword !== "function"
      ) {
        throw new Error(
          "comparePassword function ba ya cikin user model."
        );
      }

      passwordIsCorrect =
        await user.comparePassword(password);
    } else {
      passwordIsCorrect =
        String(password) === savedPassword;

      if (passwordIsCorrect) {
        user.password = String(password);

        // pre-save hook na user.model.js zai hash password.
        await user.save();

        console.log(
          `Password migrated to bcrypt for ${
            user.email || user.phone
          }`
        );
      }
    }

    if (!passwordIsCorrect) {
      return res.status(401).json({
        success: false,
        message: "Bayanan shiga ba daidai ba ne.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "An shiga account cikin nasara.",
      token: generateToken(user._id),
      user: formatUser(user),
    });
  } catch (error) {
    console.error("Login error:", error);

    return res.status(500).json({
      success: false,
      message: "An samu matsala wajen shiga account.",
      error: error.message,
    });
  }
};