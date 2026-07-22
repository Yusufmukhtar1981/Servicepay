const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== "HEAD_OFFICE") {
    return res.status(403).json({
      success: false,
      message: "Ba ka da izinin shiga Admin Dashboard.",
    });
  }

  next();
};

module.exports = { requireAdmin };
