const axios = require("axios");

const SECUREWAVE_BASE_URL =
  process.env.SECUREWAVE_BASE_URL ||
  "https://securewaveng.com/api";

const getSecureWaveHeaders = () => {
  const publicKey = process.env.SECUREWAVE_PUBLIC_KEY;
  const secretKey = process.env.SECUREWAVE_SECRET_KEY;

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

    if (response.status < 200 || response.status >= 300) {
      const message =
        response.data?.message ||
        response.data?.error ||
        "SecureWaveNG request failed.";

      const error = new Error(message);

      error.statusCode = response.status;
      error.providerResponse = response.data;

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
        error.message ||
        "Unable to connect to SecureWaveNG."
    );

    requestError.statusCode =
      error.response?.status || error.statusCode || 500;

    requestError.providerResponse =
      error.response?.data || null;

    throw requestError;
  }
};

const getBanks = async () => {
  return secureWaveRequest({
    method: "GET",
    endpoint: "/banks",
  });
};

module.exports = {
  getSecureWaveHeaders,
  secureWaveRequest,
  getBanks,
};