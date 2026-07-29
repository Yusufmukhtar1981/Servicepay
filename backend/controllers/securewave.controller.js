const User = require("../models/user.model");

const {
  getBanks,
  validateAccountName,
  generateVirtualAccount,
} = require("../services/securewave.service");

/*
 * Extract one virtual account from the different
 * response formats SecureWaveNG may return.
 */
const extractVirtualAccount = (providerResponse) => {
  const responseData = providerResponse?.data;

  let account = null;

  if (Array.isArray(responseData)) {
    account = responseData[0] || null;
  } else if (
    responseData &&
    typeof responseData === "object"
  ) {
    if (Array.isArray(responseData.accounts)) {
      account = responseData.accounts[0] || null;
    } else if (
      responseData.virtual_account &&
      typeof responseData.virtual_account === "object"
    ) {
      account = responseData.virtual_account;
    } else {
      account = responseData;
    }
  }

  if (!account) {
    return null;
  }

  const accountNumber = String(
    account.account_number ||
      account.accountNumber ||
      account.number ||
      ""
  ).trim();

  const accountName = String(
    account.account_name ||
      account.accountName ||
      account.name ||
      ""
  ).trim();

  const bankName = String(
    account.account_bank ||
      account.bank_name ||
      account.bankName ||
      account.bank ||
      ""
  ).trim();

  const bankCode = String(
    account.bank_code ||
      account.bankCode ||
      ""
  ).trim();

  const customerReference = String(
    account.customer_reference ||
      account.customerReference ||
      account.reference ||
      account.provider_reference ||
      ""
  ).trim();

  const providerCustomerId = String(
    account.customer_id ||
      account.customerId ||
      account.id ||
      ""
  ).trim();

  if (!accountNumber) {
    return null;
  }

  return {
    accountNumber,
    accountName,
    bankName,
    bankCode,
    customerReference,
    providerCustomerId,
    raw: account,
  };
};

/*
 * GET /api/securewave/banks
 */
exports.getBanks = async (req, res) => {
  try {
    const response = await getBanks();

    return res.status(200).json({
      success: true,
      ...response,
    });
  } catch (error) {
    console.error(
      "SecureWave get banks error:",
      error.providerResponse || error.message
    );

    return res
      .status(error.statusCode || 500)
      .json({
        success: false,
        message:
          error.message ||
          "Unable to fetch banks.",
        providerResponse:
          error.providerResponse || null,
      });
  }
};

/*
 * POST /api/securewave/validate-account-name
 *
 * This will only work after SecureWaveNG enables
 * Customer Withdrawals/Payouts for the merchant.
 */
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
      error.providerResponse || error.message
    );

    return res
      .status(error.statusCode || 500)
      .json({
        success: false,
        message:
          error.message ||
          "Unable to verify account name.",
        providerResponse:
          error.providerResponse || null,
      });
  }
};

/*
 * POST /api/securewave/virtual-account
 *
 * This endpoint must be protected with JWT middleware.
 * Customer details come from MongoDB, not request body.
 */
exports.generateVirtualAccount = async (
  req,
  res
) => {
  let customer = null;

  try {
    const authenticatedUserId =
      req.user?._id ||
      req.user?.id ||
      req.user?.userId;

    if (!authenticatedUserId) {
      return res.status(401).json({
        success: false,
        message:
          "Authentication is required.",
      });
    }

    customer = await User.findById(
      authenticatedUserId
    );

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer account not found.",
      });
    }

    if (customer.status !== "ACTIVE") {
      return res.status(403).json({
        success: false,
        message:
          "Only active customers can create a virtual account.",
      });
    }

    if (customer.role !== "CUSTOMER") {
      return res.status(403).json({
        success: false,
        message:
          "Virtual accounts are currently available to customers only.",
      });
    }

    /*
     * Return the existing account instead of
     * requesting another one from SecureWaveNG.
     */
    if (
      customer.virtualAccount?.status ===
        "ACTIVE" &&
      customer.virtualAccount?.accountNumber
    ) {
      return res.status(200).json({
        success: true,
        message:
          "Virtual account already exists.",
        data: {
          provider:
            customer.virtualAccount.provider,
          accountNumber:
            customer.virtualAccount
              .accountNumber,
          accountName:
            customer.virtualAccount.accountName,
          bankName:
            customer.virtualAccount.bankName,
          bankCode:
            customer.virtualAccount.bankCode,
          status:
            customer.virtualAccount.status,
        },
      });
    }

    if (
      customer.virtualAccount?.status ===
      "PENDING"
    ) {
      return res.status(409).json({
        success: false,
        message:
          "Virtual account creation is already in progress.",
      });
    }

    const email = String(
      customer.email || ""
    )
      .trim()
      .toLowerCase();

    const phoneNumber = String(
      customer.phone || ""
    ).trim();

    const fullName = String(
      customer.fullName || ""
    )
      .trim()
      .replace(/\s+/g, " ");

    if (!email) {
      return res.status(400).json({
        success: false,
        message:
          "Please add an email address to your profile before creating a virtual account.",
      });
    }

    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
        email
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "The email address on your profile is invalid.",
      });
    }

    if (!/^\d{11}$/.test(phoneNumber)) {
      return res.status(400).json({
        success: false,
        message:
          "The phone number on your profile must contain exactly 11 digits.",
      });
    }

    const nameParts = fullName.split(" ");

    const firstName =
      nameParts.shift() || "ServicePay";

    const lastName =
      nameParts.join(" ").trim() ||
      firstName;

    customer.virtualAccount = {
      ...(customer.virtualAccount?.toObject
        ? customer.virtualAccount.toObject()
        : customer.virtualAccount || {}),

      provider: "SECUREWAVENG",
      status: "PENDING",
      failureReason: null,
      updatedAt: new Date(),
    };

    await customer.save();

    const providerResponse =
      await generateVirtualAccount({
        email,
        firstName,
        lastName,
        phoneNumber,
      });

    const virtualAccount =
      extractVirtualAccount(providerResponse);

    if (!virtualAccount) {
      throw Object.assign(
        new Error(
          "SecureWaveNG did not return a valid virtual account number."
        ),
        {
          statusCode: 502,
          providerResponse,
        }
      );
    }

    customer.virtualAccount = {
      provider: "SECUREWAVENG",

      accountNumber:
        virtualAccount.accountNumber,

      accountName:
        virtualAccount.accountName ||
        fullName,

      bankName:
        virtualAccount.bankName || null,

      bankCode:
        virtualAccount.bankCode || null,

      customerReference:
        virtualAccount.customerReference ||
        null,

      providerCustomerId:
        virtualAccount.providerCustomerId ||
        null,

      status: "ACTIVE",
      failureReason: null,
      createdAt:
        customer.virtualAccount?.createdAt ||
        new Date(),
      updatedAt: new Date(),
    };

    await customer.save();

    return res.status(201).json({
      success: true,
      message:
        providerResponse?.message ||
        "Virtual account created successfully.",
      data: {
        provider: "SECUREWAVENG",
        accountNumber:
          customer.virtualAccount
            .accountNumber,
        accountName:
          customer.virtualAccount.accountName,
        bankName:
          customer.virtualAccount.bankName,
        bankCode:
          customer.virtualAccount.bankCode,
        status:
          customer.virtualAccount.status,
      },

      /*
       * SecureWaveNG may generate more than one
       * account. Return the provider data but store
       * the first account as the primary account.
       */
      providerData:
        providerResponse?.data || null,
    });
  } catch (error) {
    console.error(
      "SecureWave virtual account error:",
      error.providerResponse || error.message
    );

    if (customer) {
      try {
        customer.virtualAccount = {
          ...(customer.virtualAccount?.toObject
            ? customer.virtualAccount.toObject()
            : customer.virtualAccount || {}),

          provider: "SECUREWAVENG",
          status: "FAILED",
          failureReason:
            error.message ||
            "Virtual account creation failed.",
          updatedAt: new Date(),
        };

        await customer.save();
      } catch (saveError) {
        console.error(
          "Unable to save virtual account failure:",
          saveError.message
        );
      }
    }

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