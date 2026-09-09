const jwt = require("jsonwebtoken");
const User = require("../models/user.model");
const {
  ensureBusinessPartnerViewAccess,
} = require("../services/businessPartnerAccess.service");

const normalizeRole = (value = "") => {
  return String(value)
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
};

const protect = async (req, res, next) => {
  try {
    const authorization =
      req.headers.authorization;

    if (
      !authorization ||
      !authorization.startsWith("Bearer ")
    ) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        success: false,
        message:
          "Authentication configuration error.",
      });
    }

    const token = authorization
      .slice(7)
      .trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    const userId =
      decoded.id ||
      decoded.userId ||
      decoded._id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message:
          "Invalid authentication token.",
      });
    }

    const user = await User.findById(userId)
      .select("-password +authTokenVersion");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found.",
      });
    }

    const tokenVersion = decoded.authTokenVersion === undefined
      ? 0
      : Number(decoded.authTokenVersion);
    if (!Number.isInteger(tokenVersion) ||
        tokenVersion !== Number(user.authTokenVersion || 0)) {
      return res.status(401).json({
        success: false,
        code: "TOKEN_REVOKED",
        message: "Your password was changed. Please sign in again.",
      });
    }

    const normalizedStatus = String(
      user.status || ""
    )
      .trim()
      .toUpperCase();

    if (normalizedStatus !== "ACTIVE") {
      return res.status(403).json({
        success: false,
        message: "Account is inactive.",
      });
    }

    user.role = normalizeRole(
      user.role
    );

    req.user = user;
    // Temporary credentials may authenticate solely to establish the password.
    // This is intentionally enforced here, rather than only on branch routes,
    // so a manager cannot use another protected product endpoint to bypass it.
    const changingPassword = /\/change-password\/?(?:\?.*)?$/.test(
      String(req.originalUrl || req.url || "")
    );
    if (user.mustChangePassword === true && !changingPassword) {
      return res.status(403).json({
        success: false,
        code: "PASSWORD_CHANGE_REQUIRED",
        message: "You must change your temporary password before continuing.",
      });
    }

    return next();
  } catch (error) {
    console.error(
      "Authentication middleware error:",
      error.message
    );

    return res.status(401).json({
      success: false,
      message:
        "Invalid or expired token.",
    });
  }
};

const adminOnly = (...roles) => {
  const allowedRoles = roles.map(
    normalizeRole
  );

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    const userRole = normalizeRole(
      req.user.role
    );

    if (!allowedRoles.includes(userRole)) {
      console.error(
        "ADMIN_ACCESS_DENIED " +
          JSON.stringify({
            userId: String(req.user._id),
            userRole,
            allowedRoles,
          })
      );

      return res.status(403).json({
        success: false,
        message: "Access denied.",
      });
    }

    req.user.role = userRole;

    return next();
  };
};

const customerOnly = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized.",
    });
  }

  const userRole = normalizeRole(req.user.role);

  if (userRole !== "CUSTOMER") {
    return res.status(403).json({
      success: false,
      message: "This feature is available to customer accounts only.",
    });
  }

  req.user.role = userRole;
  return next();
};

const solarOfficerOnly = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized.",
    });
  }

  const userRole = normalizeRole(req.user.role);
  if (userRole !== "SOLAR_OFFICER") {
    return res.status(403).json({
      success: false,
      message: "This feature is available to Solar Officer accounts only.",
    });
  }

  req.user.role = userRole;
  return next();
};
const phoneFinancingOfficerOnly = (req, res, next) => {
  if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized." });
  const userRole = normalizeRole(req.user.role);
  if (userRole !== "PHONE_FINANCING_OFFICER" || req.user.isStaff !== true) {
    return res.status(403).json({ success: false, message: "This feature is available to Phone Financing Officer accounts only." });
  }
  req.user.role = userRole;
  return next();
};
const businessPartnerOnly = async (req, res, next) => {
  if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized." });
  const userRole = normalizeRole(req.user.role);
  if (userRole !== "BUSINESS_PARTNER") {
    return res.status(403).json({ success: false, message: "This feature is available to active Business Partner accounts only." });
  }
  try {
    const profile = await ensureBusinessPartnerViewAccess(req.user);
    if (!profile) {
      return res.status(403).json({ success: false, message: "This feature is available to active Business Partner accounts only." });
    }
    req.user.role = userRole;
    req.businessPartnerProfile = profile;
    return next();
  } catch (error) {
    console.error("Business Partner access normalization error:", error.message);
    return res.status(500).json({ success: false, message: "Unable to verify Business Partner access." });
  }
};

module.exports = {
  normalizeRole,
  customerOnly,
  solarOfficerOnly,
  phoneFinancingOfficerOnly,
  businessPartnerOnly,
  protect,
  adminOnly,
};
