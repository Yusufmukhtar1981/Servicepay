const axios = require("axios");
const crypto = require("crypto");

const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");

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

const generateReference = (prefix) => {
  return `${prefix}-${Date.now()}-${crypto
    .randomBytes(4)
    .toString("hex")
    .toUpperCase()}`;
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

const parseProviderResponse = (data) => {
  if (data === null || data === undefined) {
    return {};
  }

  if (typeof data === "object") {
    return data;
  }

  const text = String(data).trim();

  try {
    return JSON.parse(text);
  } catch (_) {
    return {
      message: text,
      raw: text,
    };
  }
};

const getProviderStatus = (data) => {
  const parsed = parseProviderResponse(data);

  return String(
    parsed.status ||
      parsed.Status ||
      parsed.response_description ||
      parsed.ResponseDescription ||
      parsed.message ||
      parsed.Message ||
      ""
  )
    .trim()
    .toUpperCase();
};

const getProviderMessage = (data) => {
  const parsed = parseProviderResponse(data);

  return String(
    parsed.message ||
      parsed.Message ||
      parsed.response_description ||
      parsed.ResponseDescription ||
      parsed.status ||
      parsed.Status ||
      "The provider rejected this request."
  ).trim();
};

const isProviderSuccessful = (data) => {
  const status = getProviderStatus(data);

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
    "UNAUTHORIZED",
    "NOT_FOUND",
    "CANCELLED",
  ];

  if (
    failureWords.some((word) => status.includes(word))
  ) {
    return false;
  }

  const successWords = [
    "SUCCESS",
    "SUCCESSFUL",
    "COMPLETED",
    "ORDER_RECEIVED",
    "ORDER COMPLETED",
    "PROCESSING",
    "PENDING",
  ];

  return successWords.some((word) =>
    status.includes(word)
  );
};

const getCredentials = () => {
  const userId = String(
    process.env.CLUBKONNECT_USER_ID || ""
  ).trim();

  const apiKey = String(
    process.env.CLUBKONNECT_API_KEY || ""
  ).trim();

  return {
    userId,
    apiKey,
    valid: Boolean(userId && apiKey),
  };
};

const refundCustomer = async ({
  customerId,
  amount,
  transactionId,
  providerResponse,
}) => {
  const updatedCustomer = await User.findOneAndUpdate(
    {
      _id: customerId,
    },
    {
      $inc: {
        walletBalance: amount,
      },
    },
    {
      new: true,
    }
  );

  await Transaction.findByIdAndUpdate(transactionId, {
    status: "REFUNDED",
    providerResponse,
  });

  return updatedCustomer;
};

exports.buyAirtime = async (req, res) => {
  let transaction = null;
  let customer = null;
  let walletDebited = false;

  try {
    const credentials = getCredentials();

    if (!credentials.valid) {
      return res.status(503).json({
        success: false,
        message:
          "ClubKonnect credentials are not configured on the server.",
      });
    }

    const { network, phone, amount } = req.body;

    const networkCode = normalizeNetwork(network);
    const mobileNumber = normalizePhone(phone);
    const airtimeAmount = Number(amount);

    if (!networkCode) {
      return res.status(400).json({
        success: false,
        message:
          "Select MTN, GLO, Airtel or 9mobile.",
      });
    }

    if (
      mobileNumber.length !== 11 ||
      !mobileNumber.startsWith("0")
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Enter a valid Nigerian phone number.",
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

    customer = await User.findOneAndUpdate(
      {
        _id: req.user._id,
        status: "ACTIVE",
        walletBalance: {
          $gte: airtimeAmount,
        },
      },
      {
        $inc: {
          walletBalance: -airtimeAmount,
          totalTransactions: 1,
        },
      },
      {
        new: true,
      }
    );

    if (!customer) {
      const existingCustomer = await User.findById(
        req.user._id
      );

      if (!existingCustomer) {
        return res.status(404).json({
          success: false,
          message: "Customer account was not found.",
        });
      }

      if (existingCustomer.status !== "ACTIVE") {
        return res.status(403).json({
          success: false,
          message: "This account is not active.",
        });
      }

      return res.status(400).json({
        success: false,
        message: "Insufficient wallet balance.",
        walletBalance:
          existingCustomer.walletBalance || 0,
      });
    }

    walletDebited = true;

    transaction = await Transaction.create({
      reference: generateReference("AIR"),
      customerId: customer._id,
      agentId: customer.agentId,
      stateManagerId: customer.stateManagerId,
      zonalManagerId: customer.zonalManagerId,
      serviceType: "AIRTIME",
      provider: "CLUBKONNECT",
      phone: mobileNumber,
      amount: airtimeAmount,
      status: "PENDING",
    });

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

    const providerResponse =
      parseProviderResponse(response.data);

    console.log("CLUBKONNECT AIRTIME RESPONSE:", {
      httpStatus: response.status,
      transactionReference: transaction.reference,
      providerResponse,
    });

    if (
      response.status < 200 ||
      response.status >= 300 ||
      !isProviderSuccessful(providerResponse)
    ) {
      const refundedCustomer = await refundCustomer({
        customerId: customer._id,
        amount: airtimeAmount,
        transactionId: transaction._id,
        providerResponse,
      });

      walletDebited = false;

      return res.status(400).json({
        success: false,
        message: getProviderMessage(providerResponse),
        reference: transaction.reference,
        status: "REFUNDED",
        walletBalance:
          refundedCustomer?.walletBalance || 0,
        providerResponse,
      });
    }

    transaction.status = "SUCCESSFUL";
    transaction.providerResponse = providerResponse;

    await transaction.save();

    return res.status(200).json({
      success: true,
      message: "Airtime purchase was successful.",
      reference: transaction.reference,
      status: transaction.status,
      walletBalance: customer.walletBalance,
      transaction: {
        serviceType: transaction.serviceType,
        network: networkCode,
        phone: mobileNumber,
        amount: airtimeAmount,
      },
      providerResponse,
    });
  } catch (error) {
    console.error("AIRTIME PURCHASE ERROR:", {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data,
    });

    if (
      walletDebited &&
      customer &&
      transaction
    ) {
      try {
        const refundedCustomer =
          await refundCustomer({
            customerId: customer._id,
            amount: transaction.amount,
            transactionId: transaction._id,
            providerResponse:
              error.response?.data || {
                message: error.message,
              },
          });

        return res.status(500).json({
          success: false,
          message:
            "Airtime purchase failed. Your wallet has been refunded.",
          reference: transaction.reference,
          status: "REFUNDED",
          walletBalance:
            refundedCustomer?.walletBalance || 0,
        });
      } catch (refundError) {
        console.error(
          "AIRTIME REFUND ERROR:",
          refundError
        );
      }
    }

    return res.status(500).json({
      success: false,
      message:
        "Airtime purchase could not be completed.",
      error: error.message,
    });
  }
};

exports.buyData = async (req, res) => {
  let transaction = null;
  let customer = null;
  let walletDebited = false;

  try {
    const credentials = getCredentials();

    if (!credentials.valid) {
      return res.status(503).json({
        success: false,
        message:
          "ClubKonnect credentials are not configured on the server.",
      });
    }

    const {
      network,
      phone,
      planCode,
      dataPlan,
      amount,
    } = req.body;

    const networkCode = normalizeNetwork(network);
    const mobileNumber = normalizePhone(phone);

    const selectedPlan = String(
      planCode || dataPlan || ""
    ).trim();

    const dataAmount = Number(amount);

    if (!networkCode) {
      return res.status(400).json({
        success: false,
        message:
          "Select MTN, GLO, Airtel or 9mobile.",
      });
    }

    if (
      mobileNumber.length !== 11 ||
      !mobileNumber.startsWith("0")
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Enter a valid Nigerian phone number.",
      });
    }

    if (!selectedPlan) {
      return res.status(400).json({
        success: false,
        message: "Select a valid data plan.",
      });
    }

    if (
      !Number.isFinite(dataAmount) ||
      dataAmount <= 0
    ) {
      return res.status(400).json({
        success: false,
        message:
          "A valid data plan amount is required.",
      });
    }

    customer = await User.findOneAndUpdate(
      {
        _id: req.user._id,
        status: "ACTIVE",
        walletBalance: {
          $gte: dataAmount,
        },
      },
      {
        $inc: {
          walletBalance: -dataAmount,
          totalTransactions: 1,
        },
      },
      {
        new: true,
      }
    );

    if (!customer) {
      const existingCustomer = await User.findById(
        req.user._id
      );

      if (!existingCustomer) {
        return res.status(404).json({
          success: false,
          message: "Customer account was not found.",
        });
      }

      if (existingCustomer.status !== "ACTIVE") {
        return res.status(403).json({
          success: false,
          message: "This account is not active.",
        });
      }

      return res.status(400).json({
        success: false,
        message: "Insufficient wallet balance.",
        walletBalance:
          existingCustomer.walletBalance || 0,
      });
    }

    walletDebited = true;

    transaction = await Transaction.create({
      reference: generateReference("DATA"),
      customerId: customer._id,
      agentId: customer.agentId,
      stateManagerId: customer.stateManagerId,
      zonalManagerId: customer.zonalManagerId,
      serviceType: "DATA",
      provider: "CLUBKONNECT",
      phone: mobileNumber,
      amount: dataAmount,
      status: "PENDING",
      providerResponse: {
        network: networkCode,
        planCode: selectedPlan,
      },
    });

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

    const providerResponse =
      parseProviderResponse(response.data);

    console.log("CLUBKONNECT DATA RESPONSE:", {
      httpStatus: response.status,
      transactionReference: transaction.reference,
      providerResponse,
    });

    if (
      response.status < 200 ||
      response.status >= 300 ||
      !isProviderSuccessful(providerResponse)
    ) {
      const refundedCustomer = await refundCustomer({
        customerId: customer._id,
        amount: dataAmount,
        transactionId: transaction._id,
        providerResponse,
      });

      walletDebited = false;

      return res.status(400).json({
        success: false,
        message: getProviderMessage(providerResponse),
        reference: transaction.reference,
        status: "REFUNDED",
        walletBalance:
          refundedCustomer?.walletBalance || 0,
        providerResponse,
      });
    }

    transaction.status = "SUCCESSFUL";
    transaction.providerResponse = {
      planCode: selectedPlan,
      response: providerResponse,
    };

    await transaction.save();

    return res.status(200).json({
      success: true,
      message: "Data purchase was successful.",
      reference: transaction.reference,
      status: transaction.status,
      walletBalance: customer.walletBalance,
      transaction: {
        serviceType: transaction.serviceType,
        network: networkCode,
        phone: mobileNumber,
        planCode: selectedPlan,
        amount: dataAmount,
      },
      providerResponse,
    });
  } catch (error) {
    console.error("DATA PURCHASE ERROR:", {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data,
    });

    if (
      walletDebited &&
      customer &&
      transaction
    ) {
      try {
        const refundedCustomer =
          await refundCustomer({
            customerId: customer._id,
            amount: transaction.amount,
            transactionId: transaction._id,
            providerResponse:
              error.response?.data || {
                message: error.message,
              },
          });

        return res.status(500).json({
          success: false,
          message:
            "Data purchase failed. Your wallet has been refunded.",
          reference: transaction.reference,
          status: "REFUNDED",
          walletBalance:
            refundedCustomer?.walletBalance || 0,
        });
      } catch (refundError) {
        console.error(
          "DATA REFUND ERROR:",
          refundError
        );
      }
    }

    return res.status(500).json({
      success: false,
      message:
        "Data purchase could not be completed.",
      error: error.message,
    });
  }
};