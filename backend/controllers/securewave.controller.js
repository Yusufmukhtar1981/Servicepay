const User = require("../models/user.model");
const { randomUUID } = require("node:crypto");

const VIRTUAL_ACCOUNT_UNAVAILABLE =
  "Virtual account service is temporarily unavailable. Please try again later.";
const safeProvisioningFailure = (message) =>
  /^(PROVIDER_ACCESS_REJECTED|CONFIGURATION_UNAVAILABLE)$/.test(String(message || "")) ||
  /this ip address .{0,60}not whitelisted/i.test(String(message || "")) ||
  /^SecureWaveNG (live API keys|Business ID|merchant BVN).*(not configured|exactly 11 digits)/.test(String(message || ""));
const logProviderFailure = (event, error, attemptId) => {
  const message = String(error?.message || "");
  const ip = /this ip address (\d{1,3}(?:\.\d{1,3}){3}) is not whitelisted/i.exec(message)?.[1];
  console.error(JSON.stringify({
    event,
    provider: "SECUREWAVENG",
    status: Number.isInteger(error?.statusCode) ? error.statusCode : 500,
    category: ip ? "IP_NOT_WHITELISTED" : "PROVIDER_UNAVAILABLE",
    ...(ip ? { outboundIp: ip } : {}),
    ...(attemptId ? { attemptId } : {}),
  }));
};

const {
  getBanks,
  validateAccountName,
  generateVirtualAccount,
} = require("../services/securewave.service");

const getAuthenticatedUserId = (req) => {
  return (
    req.user?._id ||
    req.user?.id ||
    req.user?.userId ||
    null
  );
};

const formatVirtualAccount = (virtualAccount) => {
  if (!virtualAccount) {
    return {
      provider: null,
      accountNumber: null,
      accountName: null,
      bankName: null,
      bankCode: null,
      status: "NOT_CREATED",
      failureReason: null,
      createdAt: null,
      updatedAt: null,
    };
  }

  return {
    provider: virtualAccount.provider || null,
    accountNumber:
      virtualAccount.accountNumber || null,
    accountName:
      virtualAccount.accountName || null,
    bankName:
      virtualAccount.bankName || null,
    bankCode:
      virtualAccount.bankCode || null,
    status:
      virtualAccount.status || "NOT_CREATED",
    failureReason:
      virtualAccount.failureReason ? VIRTUAL_ACCOUNT_UNAVAILABLE : null,
    createdAt:
      virtualAccount.createdAt || null,
    updatedAt:
      virtualAccount.updatedAt || null,
  };
};

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
    } else if (
      responseData.virtualAccount &&
      typeof responseData.virtualAccount === "object"
    ) {
      account = responseData.virtualAccount;
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
      account.providerReference ||
      ""
  ).trim();

  const providerCustomerId = String(
    account.customer_id ||
      account.customerId ||
      account.id ||
      ""
  ).trim();

  if (!/^\d{10}$/.test(accountNumber) || !accountName || !bankName) {
    return null;
  }

  return {
    accountNumber,
    accountName,
    bankName,
    bankCode,
    customerReference,
    providerCustomerId,
  };
};

/*
 * GET /api/securewave/banks
 */
exports.getBanks = async (req, res) => {
  try {
    const response = await getBanks();
    if (response?.success === false || response?.status === false ||
        ["failed", "error"].includes(String(response?.status || "").toLowerCase())) {
      throw new Error("Provider bank request rejected.");
    }

    return res.status(200).json({
      success: true,
      ...response,
    });
  } catch (error) {
    logProviderFailure("securewave.banks.failed", error);

    return res
      .status(503)
      .json({
        success: false,
        message: "Bank service is temporarily unavailable. Please try again later.",
      });
  }
};

/*
 * GET /api/securewave/virtual-account
 */
exports.getMyVirtualAccount = async (req, res) => {
  try {
    const authenticatedUserId =
      getAuthenticatedUserId(req);

    if (!authenticatedUserId) {
      return res.status(401).json({
        success: false,
        message: "Authentication is required.",
      });
    }

    const customer = await User.findById(
      authenticatedUserId
    ).select(
      "fullName email phone role status virtualAccount"
    );

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer account not found.",
      });
    }

    if (customer.role !== "CUSTOMER") {
      return res.status(403).json({
        success: false,
        message:
          "Virtual accounts are currently available to customers only.",
      });
    }

    const virtualAccount =
      formatVirtualAccount(
        customer.virtualAccount
      );

    const hasActiveAccount =
      virtualAccount.status === "ACTIVE" &&
      Boolean(virtualAccount.accountNumber);

    return res.status(200).json({
      success: true,
      message: hasActiveAccount
        ? "Virtual account fetched successfully."
        : "Virtual account has not been created yet.",
      data: {
        hasVirtualAccount: hasActiveAccount,
        customerName: customer.fullName,
        virtualAccount,
      },
    });
  } catch (error) {
    logProviderFailure("securewave.virtual_account.read_failed", error);

    return res.status(500).json({
      success: false,
      message:
        "Unable to fetch virtual account.",
    });
  }
};

/*
 * POST /api/securewave/validate-account-name
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
    if (response?.success === false || response?.status === false ||
        ["failed", "error"].includes(String(response?.status || "").toLowerCase())) {
      throw new Error("Provider account validation rejected.");
    }

    return res.status(200).json({
      success: true,
      ...response,
    });
  } catch (error) {
    logProviderFailure("securewave.account_validation.failed", error);

    return res
      .status(503)
      .json({
        success: false,
        message: "Account verification is temporarily unavailable. Please try again later.",
      });
  }
};

/*
 * POST /api/securewave/virtual-account
 */
exports.generateVirtualAccount = async (
  req,
  res
) => {
  let customer = null;
  let attemptId = null;

  try {
    const authenticatedUserId =
      getAuthenticatedUserId(req);

    if (!authenticatedUserId) {
      return res.status(401).json({
        success: false,
        message: "Authentication is required.",
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

    if (customer.status !== "ACTIVE" || customer.isDeleted || customer.deletedAt) {
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

    if (
      customer.virtualAccount?.accountNumber
    ) {
      return res.status(200).json({
        success: true,
        message:
          "Virtual account already exists.",
        data: formatVirtualAccount(
          customer.virtualAccount
        ),
      });
    }

    if (
      customer.virtualAccount?.status ===
      "PENDING" ||
      customer.virtualAccount?.status === "ACTIVE" ||
      customer.virtualAccount?.status === "DISABLED" ||
      (customer.virtualAccount?.status === "FAILED" &&
        !safeProvisioningFailure(customer.virtualAccount?.failureReason))
    ) {
      return res.status(409).json({
        success: false,
        message:
          VIRTUAL_ACCOUNT_UNAVAILABLE,
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

    attemptId = randomUUID();
    const claim = await User.findOneAndUpdate(
      {
        _id: authenticatedUserId,
        role: "CUSTOMER",
        status: "ACTIVE",
        isDeleted: { $ne: true },
        deletedAt: null,
        $and: [
          { $or: [
            { "virtualAccount.accountNumber": { $exists: false } },
            { "virtualAccount.accountNumber": { $in: [null, ""] } },
          ] },
          { "virtualAccount.status": { $nin: ["PENDING", "ACTIVE", "DISABLED"] } },
          ...(customer.virtualAccount?.status === "FAILED"
            ? [{ "virtualAccount.failureReason": customer.virtualAccount.failureReason }]
            : []),
        ],
      },
      { $set: {
        "virtualAccount.provider": "SECUREWAVENG",
        "virtualAccount.status": "PENDING",
        "virtualAccount.creationAttemptId": attemptId,
        "virtualAccount.failureReason": null,
        "virtualAccount.updatedAt": new Date(),
      } },
      { new: true, runValidators: true }
    );
    if (!claim) {
      attemptId = null;
      const current = await User.findById(authenticatedUserId);
      if (current?.virtualAccount?.accountNumber) {
        return res.status(200).json({
          success: true,
          message: "Virtual account already exists.",
          data: formatVirtualAccount(current.virtualAccount),
        });
      }
      return res.status(409).json({ success: false, message: VIRTUAL_ACCOUNT_UNAVAILABLE });
    }
    customer = claim;

    /*
     * Merchant BVN and Business ID are read
     * inside securewave.service.js from Render.
     */
    const providerResponse =
      await generateVirtualAccount({
        email,
        firstName,
        lastName,
        phoneNumber,
      });

    const virtualAccount =
      extractVirtualAccount(
        providerResponse
      );

    if (!virtualAccount || providerResponse?.success === false ||
        providerResponse?.status === false ||
        ["failed", "error"].includes(String(providerResponse?.status || "").toLowerCase())) {
      const responseError = new Error(
        "SecureWaveNG did not return a valid virtual account number."
      );

      responseError.statusCode = 502;
      responseError.providerResponse =
        providerResponse;

      throw responseError;
    }

    const confirmedAccount = {
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
        undefined,

      providerCustomerId:
        virtualAccount.providerCustomerId ||
        null,

      status: "ACTIVE",

      failureReason: null,

      createdAt:
        customer.virtualAccount?.createdAt ||
        new Date(),

      updatedAt: new Date(),
      creationAttemptId: attemptId,
    };

    const persisted = await User.findOneAndUpdate(
      {
        _id: authenticatedUserId,
        "virtualAccount.status": "PENDING",
        "virtualAccount.creationAttemptId": attemptId,
        $or: [
          { "virtualAccount.accountNumber": { $exists: false } },
          { "virtualAccount.accountNumber": { $in: [null, ""] } },
        ],
      },
      { $set: { virtualAccount: confirmedAccount } },
      { new: true, runValidators: true }
    );
    if (!persisted) {
      const current = await User.findById(authenticatedUserId);
      if (current?.virtualAccount?.accountNumber) {
        return res.status(200).json({
          success: true,
          message: "Virtual account already exists.",
          data: formatVirtualAccount(current.virtualAccount),
        });
      }
      throw new Error("Confirmed account persistence needs reconciliation.");
    }

    return res.status(201).json({
      success: true,
      message: "Virtual account created successfully.",
      data: formatVirtualAccount(
        persisted.virtualAccount
      ),
    });
  } catch (error) {
    logProviderFailure("securewave.virtual_account.failed", error, attemptId);

    if (customer && attemptId) {
      try {
        // A timeout, malformed response, crash or failed persistence is not proof
        // that no bank account was created. Keep its durable claim non-retryable.
        const accessRejected = Boolean(error.providerResponse) &&
          error.statusCode >= 400 && error.statusCode < 500 &&
          /not whitelisted|unauthorized|invalid api key/i.test(String(error.message || ""));
        const configurationUnavailable = !error.providerResponse && error.statusCode === 503 &&
          safeProvisioningFailure(error.message);
        const definiteRejection = accessRejected || configurationUnavailable;
        await User.updateOne(
          {
            _id: getAuthenticatedUserId(req),
            "virtualAccount.status": "PENDING",
            "virtualAccount.creationAttemptId": attemptId,
          },
          { $set: {
            "virtualAccount.status": definiteRejection ? "FAILED" : "PENDING",
            "virtualAccount.failureReason": definiteRejection
              ? (accessRejected ? "PROVIDER_ACCESS_REJECTED" : "CONFIGURATION_UNAVAILABLE")
              : "PROVIDER_OUTCOME_UNCONFIRMED",
            "virtualAccount.updatedAt": new Date(),
          } },
          { runValidators: true }
        );
      } catch (saveError) {
        logProviderFailure("securewave.virtual_account.failure_persistence_failed", saveError, attemptId);
      }
    }

    return res
      .status(503)
      .json({
        success: false,
        message: VIRTUAL_ACCOUNT_UNAVAILABLE,
      });
  }
};