const axios = require("axios");

const AIRTIME_URL =
  "https://www.nellobytesystems.com/APIAirtimeV1.asp";

const DATA_URL =
  "https://www.nellobytesystems.com/APIDatabundleV1.asp";

const NETWORK_CODES = {
  MTN: "01",
  GLO: "02",
  "9MOBILE": "03",
  ETISALAT: "03",
  AIRTEL: "04",

  "01": "01",
  "02": "02",
  "03": "03",
  "04": "04",
};

const normalizeNetwork = (network) => {
  const value = String(network || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");

  return NETWORK_CODES[value] || null;
};

const normalizePhone = (phone) => {
  let value = String(phone || "").replace(/\D/g, "");

  if (value.startsWith("234") && value.length === 13) {
    value = `0${value.substring(3)}`;
  }

  return value;
};

const getProviderStatus = (providerData) => {
  if (providerData === null || providerData === undefined) {
    return "";
  }

  if (typeof providerData === "string") {
    const trimmed = providerData.trim();

    try {
      const parsed = JSON.parse(trimmed);

      return String(
        parsed.status ||
          parsed.Status ||
          parsed.response_description ||
          parsed.message ||
          ""
      )
        .trim()
        .toUpperCase();
    } catch (_) {
      return trimmed.toUpperCase();
    }
  }

  if (typeof providerData === "object") {
    return String(
      providerData.status ||
        providerData.Status ||
        providerData.response_description ||
        providerData.ResponseDescription ||
        providerData.message ||
        providerData.Message ||
        ""
    )
      .trim()
      .toUpperCase();
  }

  return String(providerData).trim().toUpperCase();
};

const getProviderMessage = (providerData) => {
  if (!providerData) {
    return "No response was received from the service provider.";
  }

  if (typeof providerData === "string") {
    return providerData;
  }

  return (
    providerData.message ||
    providerData.Message ||
    providerData.response_description ||
    providerData.ResponseDescription ||
    providerData.status ||
    providerData.Status ||
    "The service provider rejected the request."
  );
};

const isSuccessfulProviderResponse = (providerData) => {
  const status = getProviderStatus(providerData);

  if (!status) {
    return false;
  }

  const failureWords = [
    "INVALID",
    "FAILED",
    "FAILURE",
    "ERROR",
    "MISSING",
    "INSUFFICIENT",
    "DECLINED",
    "REJECTED",
    "NOT_FOUND",
    "UNAUTHORIZED",
    "DUPLICATE",
  ];

  if (
    failureWords.some((failureWord) =>
      status.includes(failureWord)
    )
  ) {
    return false;
  }

  const successWords = [
    "SUCCESS",
    "SUCCESSFUL",
    "COMPLETED",
    "ORDER_RECEIVED",
    "ORDER_COMPLETED",
    "PROCESSING",
    "PENDING",
  ];

  return successWords.some((successWord) =>
    status.includes(successWord)
  );
};

const checkCredentials = () => {
  const userId = String(
    process.env.CLUBKONNECT_USER_ID || ""
  ).trim();

  const apiKey = String(
    process.env.CLUBKONNECT_API_KEY || ""
  ).trim();

  if (!userId || !apiKey) {
    return {
      valid: false,
      userId: "",
      apiKey: "",
    };
  }

  return {
    valid: true,
    userId,
    apiKey,
  };
};

exports.buyAirtime = async (req, res) => {
  try {
    const { network, phone, amount } = req.body;

    const credentials = checkCredentials();

    if (!credentials.valid) {
      return res.status(503).json({
        success: false,
        message:
          "ClubKonnect credentials are not configured on the server.",
      });
    }

    const networkCode = normalizeNetwork(network);
    const mobileNumber = normalizePhone(phone);
    const airtimeAmount = Number(amount);

    if (!networkCode) {
      return res.status(400).json({
        success: false,
        message:
          "Select a valid network: MTN, GLO, Airtel or 9mobile.",
      });
    }

    if (
      mobileNumber.length !== 11 ||
      !mobileNumber.startsWith("0")
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Enter a valid Nigerian phone number with 11 digits.",
      });
    }

    if (
      !Number.isFinite(airtimeAmount) ||
      airtimeAmount < 50
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Airtime amount must be at least ₦50.",
      });
    }

    const response = await axios.get(AIRTIME_URL, {
      params: {
        UserID: credentials.userId,
        APIKey: credentials.apiKey,
        MobileNetwork: networkCode,
        Amount: airtimeAmount,
        MobileNumber: mobileNumber,
      },
      timeout: 45000,
      validateStatus: () => true,
    });

    console.log("CLUBKONNECT AIRTIME RESPONSE:", {
      httpStatus: response.status,
      providerStatus: getProviderStatus(response.data),
      data: response.data,
    });

    if (
      response.status < 200 ||
      response.status >= 300
    ) {
      return res.status(502).json({
        success: false,
        message:
          "The airtime provider could not process the request.",
        providerResponse: response.data,
      });
    }

    if (!isSuccessfulProviderResponse(response.data)) {
      return res.status(400).json({
        success: false,
        message: getProviderMessage(response.data),
        providerResponse: response.data,
      });
    }

    return res.status(200).json({
      success: true,
      message:
        "Airtime purchase request was submitted successfully.",
      transaction: {
        service: "AIRTIME",
        network: networkCode,
        phone: mobileNumber,
        amount: airtimeAmount,
        providerStatus: getProviderStatus(response.data),
      },
      providerResponse: response.data,
    });
  } catch (error) {
    console.error("CLUBKONNECT AIRTIME ERROR:", {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data,
      url: error.config?.url,
    });

    if (
      error.code === "ECONNABORTED" ||
      error.code === "ETIMEDOUT"
    ) {
      return res.status(504).json({
        success: false,
        message:
          "The airtime provider took too long to respond. Please check the transaction status before trying again.",
      });
    }

    return res.status(500).json({
      success: false,
      message:
        "Airtime purchase could not be completed.",
      error:
        error.response?.data ||
        error.message ||
        "Unknown server error.",
    });
  }
};

exports.buyData = async (req, res) => {
  try {
    const {
      network,
      phone,
      planCode,
      dataPlan,
    } = req.body;

    const credentials = checkCredentials();

    if (!credentials.valid) {
      return res.status(503).json({
        success: false,
        message:
          "ClubKonnect credentials are not configured on the server.",
      });
    }

    const networkCode = normalizeNetwork(network);
    const mobileNumber = normalizePhone(phone);

    const selectedPlan = String(
      planCode || dataPlan || ""
    ).trim();

    if (!networkCode) {
      return res.status(400).json({
        success: false,
        message:
          "Select a valid network: MTN, GLO, Airtel or 9mobile.",
      });
    }

    if (
      mobileNumber.length !== 11 ||
      !mobileNumber.startsWith("0")
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Enter a valid Nigerian phone number with 11 digits.",
      });
    }

    if (!selectedPlan) {
      return res.status(400).json({
        success: false,
        message: "Select a valid data plan.",
      });
    }

    const response = await axios.get(DATA_URL, {
      params: {
        UserID: credentials.userId,
        APIKey: credentials.apiKey,
        MobileNetwork: networkCode,
        DataPlan: selectedPlan,
        MobileNumber: mobileNumber,
      },
      timeout: 45000,
      validateStatus: () => true,
    });

    console.log("CLUBKONNECT DATA RESPONSE:", {
      httpStatus: response.status,
      providerStatus: getProviderStatus(response.data),
      data: response.data,
    });

    if (
      response.status < 200 ||
      response.status >= 300
    ) {
      return res.status(502).json({
        success: false,
        message:
          "The data provider could not process the request.",
        providerResponse: response.data,
      });
    }

    if (!isSuccessfulProviderResponse(response.data)) {
      return res.status(400).json({
        success: false,
        message: getProviderMessage(response.data),
        providerResponse: response.data,
      });
    }

    return res.status(200).json({
      success: true,
      message:
        "Data purchase request was submitted successfully.",
      transaction: {
        service: "DATA",
        network: networkCode,
        phone: mobileNumber,
        planCode: selectedPlan,
        providerStatus: getProviderStatus(response.data),
      },
      providerResponse: response.data,
    });
  } catch (error) {
    console.error("CLUBKONNECT DATA ERROR:", {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data,
      url: error.config?.url,
    });

    if (
      error.code === "ECONNABORTED" ||
      error.code === "ETIMEDOUT"
    ) {
      return res.status(504).json({
        success: false,
        message:
          "The data provider took too long to respond. Please check the transaction status before trying again.",
      });
    }

    return res.status(500).json({
      success: false,
      message:
        "Data purchase could not be completed.",
      error:
        error.response?.data ||
        error.message ||
        "Unknown server error.",
    });
  }
};