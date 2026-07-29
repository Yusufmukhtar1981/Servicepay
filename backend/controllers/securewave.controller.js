const {
  getBanks,
} = require("../services/securewave.service");

exports.getBanks = async (req, res) => {
  try {
    const response = await getBanks();

    return res.status(200).json({
      success: true,
      ...response,
    });
  } catch (error) {
    console.error("SecureWave Error:", error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
      providerResponse: error.providerResponse || null,
    });
  }
};