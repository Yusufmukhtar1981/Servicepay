const {
  ensureProviderCanRouteElectricity,
} = require("../services/providerManagement.service");

const electricityProviderEnabled = async (_req, res, next) => {
  try {
    const { getServiceConfig } = require("../services/providerManagement.service");
    const { admitted } = require("../services/telecomAbodeElectricity.service");
    const config = await getServiceConfig("ELECTRICITY");
    if (config.primaryProvider === "TELECOM_ABODE" &&
        (_req.path === "/verify-meter" || admitted(_req.user?._id || _req.user?.id))) return next();
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