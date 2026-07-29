const {
  getBanks,
  validateAccountName,
  generateVirtualAccount,
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
exports.generateVirtualAccount = async (req, res) => {
  try {
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();

    const firstName = String(
      req.body.firstName ||
        req.body.first_name ||
        ""
    ).trim();

    const lastName = String(
      req.body.lastName ||
        req.body.last_name ||
        ""
    ).trim();

    const phoneNumber = String(
      req.body.phoneNumber ||
        req.body.phone_number ||
        req.body.phone ||
        ""
    ).trim();

    if (
      !email ||
      !firstName ||
      !lastName ||
      !phoneNumber
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Email, first name, last name and phone number are required.",
      });
    }

    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address.",
      });
    }

    if (!/^\d{11}$/.test(phoneNumber)) {
      return res.status(400).json({
        success: false,
        message:
          "Phone number must contain exactly 11 digits.",
      });
    }

    const response = await generateVirtualAccount({
      email,
      firstName,
      lastName,
      phoneNumber,
    });

    return res.status(200).json({
      success: true,
      ...response,
    });
  } catch (error) {
    console.error(
      "SecureWave virtual account error:",
      error
    );

    return res
      .status(error.statusCode || 500)
      .json({
        success: false,
        message:
          error.message ||
          "Unable to generate virtual account.",
        providerResponse:
          error.providerResponse || null,
      });
  }
};