const jwt = require("jsonwebtoken");
const User = require("../models/user.model");

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

    const user = await User.findById(
      userId
    ).select("-password");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found.",
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

module.exports = {
  normalizeRole,
  customerOnly,
  protect,
  adminOnly,
};
