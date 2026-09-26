const {
  ensureProviderCanRouteElectricity,
} = require("../services/providerManagement.service");

const electricityProviderEnabled = async (_req, res, next) => {
  try {
    await ensureProviderCanRouteElectricity();
    return next();
  } catch (error) {
    return res.status(error.statusCode || 503).json({
      success: false,
      code: error.code || "ELECTRICITY_PROVIDER_UNAVAILABLE",
      message: error.message || "Electricity purchases are unavailable.",
    });
  }
};

module.exports = { electricityProviderEnabled };