const {
  getBanks,
  validateAccountName,
} = require("../services/securewave.service");

exports.getBanks = async (req, res) => {
  try {
    const response = await getBanks();

    return res.status(200).json({
      success: true,
      ...response,
    });
  } catch (error) {
    console.error("SecureWave get banks error:", error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
      providerResponse:
        error.providerResponse || null,
    });
  }
};

exports.validateAccountName = async (req, res) => {
  try {
    const bankCode = String(
      req.body.bankCode ||
        req.body.bank_code ||
        ""
    ).trim();

    const accountNumber = String(
      req.body.accountNumber ||
        req.body.account_number ||
        ""
    ).trim();

    if (!bankCode || !accountNumber) {
      return res.status(400).json({
        success: false,
        message:
          "Bank code and account number are required.",
      });
    }

    if (!/^\d+$/.test(bankCode)) {
      return res.status(400).json({
        success: false,
        message: "Bank code is invalid.",
      });
    }

    if (!/^\d{10}$/.test(accountNumber)) {
      return res.status(400).json({
        success: false,
        message:
          "Account number must be exactly 10 digits.",
      });
    }

    const response = await validateAccountName({
      bankCode,
      accountNumber,
    });

    return res.status(200).json({
      success: true,
      ...response,
    });
  } catch (error) {
    console.error(
      "SecureWave account verification error:",
      error
    );

    return res.status(error.statusCode || 500).json({
      success: false,
      message:
        error.message ||
        "Unable to verify account name.",
      providerResponse:
        error.providerResponse || null,
    });
  }
};