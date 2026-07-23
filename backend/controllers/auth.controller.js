const jwt = require("jsonwebtoken");
const User = require("../models/user.model");

const generateToken = (userId) => {
  return jwt.sign(
    { id: userId },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
};

const formatUser = (user) => ({
  id: user._id,
  fullName: user.fullName,
  phone: user.phone,
  email: user.email,
  role: user.role,
  zone: user.zone,
  state: user.state,
  lga: user.lga,
  walletBalance: user.walletBalance,
  commissionBalance: user.commissionBalance,
  status: user.status,
});

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

    const cleanPhone = phone.trim();
    const cleanEmail = email ? email.trim().toLowerCase() : undefined;

    const existingUser = await User.findOne({
      $or: [
        { phone: cleanPhone },
        ...(cleanEmail ? [{ email: cleanEmail }] : []),
      ],
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "An riga an yi register da wannan phone ko email.",
      });
    }

    // Mutane ba za su iya yi wa kansu register a matsayin admin ba.
    const safeRole = role === "CUSTOMER" ? role : "CUSTOMER";

    const user = await User.create({
      fullName: fullName.trim(),
      phone: cleanPhone,
      email: cleanEmail,
      password,
      role: safeRole,
      zone,
      state,
      lga,
      zonalManagerId,
      stateManagerId,
      agentId,
      walletBalance: 0,
      status: "ACTIVE",
    });

    return res.status(201).json({
      success: true,
      message: "An yi register cikin nasara.",
      token: generateToken(user._id),
      user: formatUser(user),
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

    const loginValue = email || phone;

    const cleanLoginValue = loginValue.trim().toLowerCase();

    // Zai karɓi email ko phone a wajen login.
    const user = await User.findOne({
      $or: [
        { email: cleanLoginValue },
        { phone: loginValue.trim() },
      ],
    });

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