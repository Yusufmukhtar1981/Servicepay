const jwt = require("jsonwebtoken");
const User = require("../models/user.model");

const generateToken = (userId) => {
  return jwt.sign(
    { id: userId },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
};

exports.registerUser = async (req, res) => {
  try {
    const {
      fullName,
      phone,
      email,
      password,
      role,
      zone,
      state,
      lga,
      zonalManagerId,
      stateManagerId,
      agentId,
    } = req.body;

    if (!fullName || !phone || !password) {
      return res.status(400).json({
        success: false,
        message: "Full name, phone da password suna da bukata.",
      });
    }

    const normalizedEmail = email
      ? email.trim().toLowerCase()
      : undefined;

    const normalizedPhone = phone.trim();

    const existingUser = await User.findOne({
      $or: [
        { phone: normalizedPhone },
        ...(normalizedEmail ? [{ email: normalizedEmail }] : []),
      ],
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "An riga an yi register da wannan phone ko email.",
      });
    }

    // Mutanen da suke yin register da kansu CUSTOMER kawai za su zama.
    // Admin da sauran managers sai admin ya kirkire su.
    const allowedPublicRoles = ["CUSTOMER"];

    const safeRole = allowedPublicRoles.includes(role)
      ? role
      : "CUSTOMER";

    const user = await User.create({
      fullName: fullName.trim(),
      phone: normalizedPhone,
      email: normalizedEmail,
      password,
      role: safeRole,
      zone,
      state,
      lga,
      zonalManagerId,
      stateManagerId,
      agentId,
      walletBalance: 10000,
    });

    return res.status(201).json({
      success: true,
      message: "An yi register cikin nasara.",
      token: generateToken(user._id),
      user: {
        id: user._id,
        fullName: user.fullName,
        phone: user.phone,
        email: user.email,
        role: user.role,
        zone: user.zone,
        state: user.state,
        lga: user.lga,
        walletBalance: user.walletBalance,
        commissionBalance: user.commissionBalance || 0,
        status: user.status,
      },
    });
  } catch (error) {
    console.error("Register error:", error);

    return res.status(500).json({
      success: false,
      message: "An samu matsala wajen yin register.",
      error: error.message,
    });
  }
};

exports.loginUser = async (req, res) => {
  try {
    const { phone, email, password } = req.body;

    if ((!phone && !email) || !password) {
      return res.status(400).json({
        success: false,
        message: "Phone ko email tare da password suna da bukata.",
      });
    }

    const query = phone
      ? { phone: phone.trim() }
      : { email: email.trim().toLowerCase() };

    // Ana amfani da +password idan password field yana da select: false.
    const user = await User.findOne(query).select("+password");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Bayanan shiga ba daidai ba ne.",
      });
    }

    if (user.status !== "ACTIVE") {
      return res.status(403).json({
        success: false,
        message: "Wannan account din ba ya aiki a halin yanzu.",
      });
    }

    const passwordIsCorrect = await user.comparePassword(password);

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
      user: {
        id: user._id,
        fullName: user.fullName,
        phone: user.phone,
        email: user.email,
        role: user.role,
        zone: user.zone,
        state: user.state,
        lga: user.lga,
        walletBalance: user.walletBalance,
        commissionBalance: user.commissionBalance || 0,
        status: user.status,
      },
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