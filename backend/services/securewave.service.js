const axios = require("axios");

const SECUREWAVE_BASE_URL =
  process.env.SECUREWAVE_BASE_URL ||
  "https://securewaveng.com/api";

/*
 * SecureWaveNG Live API headers.
 */
const getSecureWaveHeaders = () => {
  const publicKey = String(
    process.env.SECUREWAVE_PUBLIC_KEY || ""
  ).trim();

  const secretKey = String(
    process.env.SECUREWAVE_SECRET_KEY || ""
  ).trim();

  if (!publicKey || !secretKey) {
    const error = new Error(
      "SecureWaveNG live API keys are not configured."
    );

    error.statusCode = 503;
    throw error;
  }

  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${secretKey}`,
    "x-api-key": publicKey,
  };
};

/*
 * General SecureWaveNG request function.
 */
const secureWaveRequest = async ({
  method,
  endpoint,
  data,
  params,
}) => {
  try {
    const response = await axios({
      method,
      url: `${SECUREWAVE_BASE_URL}${endpoint}`,
      headers: getSecureWaveHeaders(),
      data,
      params,
      timeout: 45000,
      validateStatus: () => true,
    });

    if (
      response.status < 200 ||
      response.status >= 300
    ) {
      const message =
        response.data?.message ||
        response.data?.error ||
        "SecureWaveNG request failed.";

      const error = new Error(message);

      error.statusCode = response.status;
      error.providerResponse =
        response.data || null;

      throw error;
    }

    return response.data;
  } catch (error) {
    if (error.providerResponse) {
      throw error;
    }

    if (error.code === "ECONNABORTED") {
      const timeoutError = new Error(
        "SecureWaveNG request timed out."
      );

      timeoutError.statusCode = 504;
      throw timeoutError;
    }

    const requestError = new Error(
      error.response?.data?.message ||
        error.response?.data?.error ||
        error.message ||
        "Unable to connect to SecureWaveNG."
    );

    requestError.statusCode =
      error.response?.status ||
      error.statusCode ||
      500;

    requestError.providerResponse =
      error.response?.data || null;

    throw requestError;
  }
};

/*
 * Get supported banks.
 */
const getBanks = async () => {
  return secureWaveRequest({
    method: "GET",
    endpoint: "/banks",
  });
};

/*
 * Account-name validation.
 *
 * SecureWaveNG support confirmed that they
 * do not provide customer-to-bank payouts.
 * This function may therefore remain unavailable.
 */
const validateAccountName = async ({
  bankCode,
  accountNumber,
}) => {
  const normalizedBankCode = String(
    bankCode || ""
  ).trim();

  const normalizedAccountNumber = String(
    accountNumber || ""
  ).trim();

  if (!normalizedBankCode) {
    const error = new Error(
      "Bank code is required."
    );

    error.statusCode = 400;
    throw error;
  }

  if (
    !/^\d{10}$/.test(
      normalizedAccountNumber
    )
  ) {
    const error = new Error(
      "Account number must contain exactly 10 digits."
    );

    error.statusCode = 400;
    throw error;
  }

  return secureWaveRequest({
    method: "POST",
    endpoint:
      "/customer_withdrawals/validate-account-name",
    data: {
      bank_code: normalizedBankCode,
      account_number:
        normalizedAccountNumber,
    },
  });
};

/*
 * Generate a dedicated Virtual Account.
 *
 * SecureWaveNG confirmed:
 * - id_type must be BVN
 * - id_number must be the merchant BVN
 * - business_id must be the merchant Business ID
 *
 * Merchant BVN and Business ID are read only
 * from Render environment variables.
 */
const generateVirtualAccount = async ({
  email,
  firstName,
  lastName,
  phoneNumber,
}) => {
  const businessId = String(
    process.env.SECUREWAVE_BUSINESS_ID || ""
  ).trim();

  const merchantBvn = String(
    process.env.SECUREWAVE_MERCHANT_BVN || ""
  ).trim();

  const normalizedEmail = String(
    email || ""
  )
    .trim()
    .toLowerCase();

  const normalizedFirstName = String(
    firstName || ""
  ).trim();

  const normalizedLastName = String(
    lastName || ""
  ).trim();

  const normalizedPhoneNumber = String(
    phoneNumber || ""
  ).trim();

  if (!businessId) {
    const error = new Error(
      "SecureWaveNG Business ID is not configured."
    );

    error.statusCode = 503;
    throw error;
  }

  if (!merchantBvn) {
    const error = new Error(
      "SecureWaveNG merchant BVN is not configured."
    );

    error.statusCode = 503;
    throw error;
  }

  if (!/^\d{11}$/.test(merchantBvn)) {
    const error = new Error(
      "SecureWaveNG merchant BVN must contain exactly 11 digits."
    );

    error.statusCode = 503;
    throw error;
  }

  if (
    !normalizedEmail ||
    !normalizedFirstName ||
    !normalizedLastName ||
    !normalizedPhoneNumber
  ) {
    const error = new Error(
      "Customer email, first name, last name and phone number are required."
    );

    error.statusCode = 400;
    throw error;
  }

  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
      normalizedEmail
    )
  ) {
    const error = new Error(
      "Customer email address is invalid."
    );

    error.statusCode = 400;
    throw error;
  }

  if (
    !/^\d{11}$/.test(
      normalizedPhoneNumber
    )
  ) {
    const error = new Error(
      "Customer phone number must contain exactly 11 digits."
    );

    error.statusCode = 400;
    throw error;
  }

  return secureWaveRequest({
    method: "POST",
    endpoint:
      "/virtual_accounts/generate",
    data: {
      email: normalizedEmail,
      first_name: normalizedFirstName,
      last_name: normalizedLastName,
      phone_number:
        normalizedPhoneNumber,

      id_type: "BVN",
      id_number: merchantBvn,
      business_id: businessId,
    },
  });
};

module.exports = {
  getSecureWaveHeaders,
  secureWaveRequest,
  getBanks,
  validateAccountName,
  generateVirtualAccount,
};