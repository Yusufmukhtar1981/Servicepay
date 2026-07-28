const jwt = require("jsonwebtoken");
const User = require("../models/user.model");

const protect = async (req, res, next) => {
  try {
    const authorization = req.headers.authorization;

    if (
      !authorization ||
      !authorization.startsWith("Bearer ")
    ) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const token = authorization
      .replace("Bearer ", "")
      .trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication token is missing.",
      });
    }

    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET is missing.");

      return res.status(500).json({
        success: false,
        message: "Server authentication configuration error.",
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
        message: "Invalid authentication token.",
      });
    }

    const user = await User.findById(userId).select(
      "-password"
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User account not found.",
      });
    }

    const userStatus = String(
      user.status || "ACTIVE"
    ).toUpperCase();

    if (userStatus !== "ACTIVE") {
      return res.status(403).json({
        success: false,
        message: "This account is not active.",
      });
    }

    req.user = user;
    req.userId = user._id;

    return next();
  } catch (error) {
    console.error(
      "Authentication middleware error:",
      error.message
    );

    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Your login session has expired.",
      });
    }

    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        success: false,
        message: "Invalid authentication token.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Unable to verify authentication.",
    });
  }
};

const adminOnly = (...allowedRoles) => {
  const roles = allowedRoles
    .flat()
    .map((role) =>
      String(role || "")
        .trim()
        .toUpperCase()
    );

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication is required.",
      });
    }

    const userRole = String(
      req.user.role || ""
    )
      .trim()
      .toUpperCase();

    if (
      roles.length > 0 &&
      !roles.includes(userRole)
    ) {
      return res.status(403).json({
        success: false,
        message: "Access denied.",
      });
    }

    return next();
  };
};

module.exports = {
  protect,
  adminOnly,
};