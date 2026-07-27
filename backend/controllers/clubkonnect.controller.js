const axios = require("axios");
const crypto = require("crypto");

const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");

const AIRTIME_URL =
  "https://www.nellobytesystems.com/APIAirtimeV1.asp";

const DATA_URL =
  "https://www.nellobytesystems.com/APIDatabundleV1.asp";

const DATA_PLANS_URL =
  "https://www.nellobytesystems.com/APIDatabundlePlansV2.asp";

const NETWORK_CODES = {
  MTN: "01",
  "01": "01",

  GLO: "02",
  "02": "02",

  "9MOBILE": "03",
  ETISALAT: "03",
  T2MOBILE: "03",
  "03": "03",

  AIRTEL: "04",
  "04": "04",
};

const NETWORK_NAMES = {
  "01": "MTN",
  "02": "Glo",
  "03": "9mobile",
  "04": "Airtel",
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

  if (
    value.startsWith("234") &&
    value.length === 13
  ) {
    value = `0${value.substring(3)}`;
  }

  return value;
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
      parsed.response ||
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
      parsed.response ||
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
    failureWords.some((word) =>
      status.includes(word)
    )
  ) {
    return false;
  }

  const successWords = [
    "SUCCESS",
    "SUCCESSFUL",
    "COMPLETED",
    "ORDER_RECEIVED",
    "ORDER RECEIVED",
    "ORDER_COMPLETED",
    "ORDER COMPLETED",
    "PROCESSING",
    "PENDING",
  ];

  return successWords.some((word) =>
    status.includes(word)
  );
};

const extractArrayFromProvider = (data) => {
  if (Array.isArray(data)) {
    return data;
  }

  if (!data || typeof data !== "object") {
    return [];
  }

  const possibleArrays = [
    data.data,
    data.plans,
    data.Plans,
    data.products,
    data.Products,
    data.response,
    data.result,
    data.results,
  ];

  for (const item of possibleArrays) {
    if (Array.isArray(item)) {
      return item;
    }
  }

  for (const value of Object.values(data)) {
    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
};

const readPlanField = (plan, fields) => {
  for (const field of fields) {
    if (
      plan[field] !== undefined &&
      plan[field] !== null &&
      String(plan[field]).trim() !== ""
    ) {
      return plan[field];
    }
  }

  return null;
};

const normalizeDataPlan = (
  rawPlan,
  requestedNetwork
) => {
  if (
    rawPlan === null ||
    rawPlan === undefined
  ) {
    return null;
  }

  if (
    typeof rawPlan === "string" ||
    typeof rawPlan === "number"
  ) {
    const text = String(rawPlan).trim();

    return {
      id: text,
      code: text,
      name: text,
      price: 0,
      networkCode: requestedNetwork,
      network:
        NETWORK_NAMES[requestedNetwork] ||
        requestedNetwork,
    };
  }

  if (typeof rawPlan !== "object") {
    return null;
  }

  const id = readPlanField(rawPlan, [
    "id",
    "ID",
    "planId",
    "PlanID",
    "plan_id",
    "DataPlan",
    "dataPlan",
    "dataplan",
    "code",
    "Code",
  ]);

  const name = readPlanField(rawPlan, [
    "name",
    "Name",
    "planName",
    "PlanName",
    "plan_name",
    "description",
    "Description",
    "bundle",
    "Bundle",
  ]);

  const priceValue = readPlanField(rawPlan, [
    "price",
    "Price",
    "amount",
    "Amount",
    "sellingPrice",
    "SellingPrice",
    "selling_price",
    "cost",
    "Cost",
  ]);

  const providerNetwork = readPlanField(rawPlan, [
    "network",
    "Network",
    "networkCode",
    "NetworkCode",
    "MobileNetwork",
    "mobileNetwork",
  ]);

  const networkCode =
    normalizeNetwork(providerNetwork) ||
    requestedNetwork;

  const price = Number(
    String(priceValue ?? "0")
      .replace(/[₦,\s]/g, "")
      .trim()
  );

  if (id === null) {
    return null;
  }

  return {
    id: String(id).trim(),
    code: String(id).trim(),
    name:
      String(name || `Data Plan ${id}`).trim(),
    price:
      Number.isFinite(price) && price >= 0
        ? price
        : 0,
    networkCode,
    network:
      NETWORK_NAMES[networkCode] ||
      networkCode,
  };
};

const refundCustomer = async ({
  customerId,
  amount,
  transactionId,
  providerResponse,
}) => {
  const updatedCustomer =
    await User.findByIdAndUpdate(
      customerId,
      {
        $inc: {
          walletBalance: amount,
        },
      },
      {
        new: true,
      }
    );

  await Transaction.findByIdAndUpdate(
    transactionId,
    {
      status: "REFUNDED",
      providerResponse,
    }
  );

  return updatedCustomer;
};

exports.getDataPlans = async (req, res) => {
  try {
    const credentials = getCredentials();

    if (!credentials.valid) {
      return res.status(503).json({
        success: false,
        message:
          "ClubKonnect credentials are not configured on the server.",
      });
    }

    const networkCode = normalizeNetwork(
      req.params.network ||
        req.query.network
    );

    if (!networkCode) {
      return res.status(400).json({
        success: false,
        message:
          "Select MTN, Glo, Airtel or 9mobile.",
      });
    }

    const response = await axios.get(
      DATA_PLANS_URL,
      {
        params: {
          UserID: credentials.userId,
        },
        timeout: 45000,
        validateStatus: () => true,
      }
    );

    console.log(
      "CLUBKONNECT DATA PLANS RESPONSE:",
      {
        httpStatus: response.status,
        networkCode,
        data: response.data,
      }
    );

    if (
      response.status < 200 ||
      response.status >= 300
    ) {
      return res.status(502).json({
        success: false,
        message:
          "Unable to retrieve data plans from the provider.",
        providerResponse: response.data,
      });
    }

    const parsed =
      parseProviderResponse(response.data);

    let rawPlans =
      extractArrayFromProvider(parsed);

    /*
     * Wasu lokuta provider na iya mayar da object
     * wanda network codes suke matsayin keys.
     */
    if (
      rawPlans.length === 0 &&
      parsed &&
      typeof parsed === "object"
    ) {
      const networkKeys = [
        networkCode,
        NETWORK_NAMES[networkCode],
        NETWORK_NAMES[
          networkCode
        ]?.toUpperCase(),
        networkCode === "03"
          ? "9mobile"
          : null,
        networkCode === "03"
          ? "t2mobile"
          : null,
      ].filter(Boolean);

      for (const key of networkKeys) {
        if (Array.isArray(parsed[key])) {
          rawPlans = parsed[key];
          break;
        }
      }
    }

    const plans = rawPlans
      .map((plan) =>
        normalizeDataPlan(
          plan,
          networkCode
        )
      )
      .filter(Boolean)
      .filter(
        (plan) =>
          plan.networkCode === networkCode
      )
      .filter(
        (plan, index, array) =>
          array.findIndex(
            (item) =>
              item.id === plan.id &&
              item.networkCode ===
                plan.networkCode
          ) === index
      )
      .sort((a, b) => {
        if (
          a.price > 0 &&
          b.price > 0
        ) {
          return a.price - b.price;
        }

        return a.name.localeCompare(b.name);
      });

    if (plans.length === 0) {
      return res.status(502).json({
        success: false,
        message:
          "The provider returned no usable data plans for this network.",
        network: {
          code: networkCode,
          name:
            NETWORK_NAMES[networkCode],
        },
        providerResponse: parsed,
      });
    }

    return res.status(200).json({
      success: true,
      message:
        "Data plans retrieved successfully.",
      network: {
        code: networkCode,
        name: NETWORK_NAMES[networkCode],
      },
      count: plans.length,
      plans,
    });
  } catch (error) {
    console.error(
      "GET DATA PLANS ERROR:",
      {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
      }
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to retrieve data plans.",
      error:
        error.response?.data ||
        error.message,
    });
  }
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

    const { network, phone, amount } =
      req.body;

    const networkCode =
      normalizeNetwork(network);

    const mobileNumber =
      normalizePhone(phone);

    const airtimeAmount =
      Number(amount);

    if (!networkCode) {
      return res.status(400).json({
        success: false,
        message:
          "Select MTN, Glo, Airtel or 9mobile.",
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
      !Number.isFinite(
        airtimeAmount
      ) ||
      airtimeAmount < 50
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Airtime amount must be at least ₦50.",
      });
    }

    customer =
      await User.findOneAndUpdate(
        {
          _id: req.user._id,
          status: "ACTIVE",
          walletBalance: {
            $gte: airtimeAmount,
          },
        },
        {
          $inc: {
            walletBalance:
              -airtimeAmount,
            totalTransactions: 1,
          },
        },
        {
          new: true,
        }
      );

    if (!customer) {
      const existingCustomer =
        await User.findById(
          req.user._id
        );

      if (!existingCustomer) {
        return res.status(404).json({
          success: false,
          message:
            "Customer account was not found.",
        });
      }

      if (
        existingCustomer.status !==
        "ACTIVE"
      ) {
        return res.status(403).json({
          success: false,
          message:
            "This account is not active.",
        });
      }

      return res.status(400).json({
        success: false,
        message:
          "Insufficient wallet balance.",
        walletBalance:
          existingCustomer.walletBalance ||
          0,
      });
    }

    walletDebited = true;

    transaction =
      await Transaction.create({
        reference:
          generateReference("AIR"),
        customerId: customer._id,
        agentId: customer.agentId,
        stateManagerId:
          customer.stateManagerId,
        zonalManagerId:
          customer.zonalManagerId,
        serviceType: "AIRTIME",
        provider: "CLUBKONNECT",
        phone: mobileNumber,
        amount: airtimeAmount,
        status: "PENDING",
      });

    const response = await axios.get(
      AIRTIME_URL,
      {
        params: {
          UserID: credentials.userId,
          APIKey: credentials.apiKey,
          MobileNetwork:
            networkCode,
          Amount: airtimeAmount,
          MobileNumber:
            mobileNumber,
        },
        timeout: 45000,
        validateStatus: () => true,
      }
    );

    const providerResponse =
      parseProviderResponse(
        response.data
      );

    if (
      response.status < 200 ||
      response.status >= 300 ||
      !isProviderSuccessful(
        providerResponse
      )
    ) {
      const refundedCustomer =
        await refundCustomer({
          customerId: customer._id,
          amount: airtimeAmount,
          transactionId:
            transaction._id,
          providerResponse,
        });

      walletDebited = false;

      return res.status(400).json({
        success: false,
        message:
          getProviderMessage(
            providerResponse
          ),
        reference:
          transaction.reference,
        status: "REFUNDED",
        walletBalance:
          refundedCustomer
            ?.walletBalance || 0,
        providerResponse,
      });
    }

    transaction.status =
      "SUCCESSFUL";

    transaction.providerResponse =
      providerResponse;

    await transaction.save();

    return res.status(200).json({
      success: true,
      message:
        "Airtime purchase was successful.",
      reference:
        transaction.reference,
      status: transaction.status,
      walletBalance:
        customer.walletBalance,
      transaction: {
        serviceType: "AIRTIME",
        network: networkCode,
        phone: mobileNumber,
        amount: airtimeAmount,
      },
      providerResponse,
    });
  } catch (error) {
    console.error(
      "AIRTIME PURCHASE ERROR:",
      error
    );

    if (
      walletDebited &&
      customer &&
      transaction
    ) {
      try {
        const refundedCustomer =
          await refundCustomer({
            customerId:
              customer._id,
            amount:
              transaction.amount,
            transactionId:
              transaction._id,
            providerResponse:
              error.response?.data || {
                message: error.message,
              },
          });

        return res.status(500).json({
          success: false,
          message:
            "Airtime purchase failed. Your wallet has been refunded.",
          reference:
            transaction.reference,
          status: "REFUNDED",
          walletBalance:
            refundedCustomer
              ?.walletBalance || 0,
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

    const networkCode =
      normalizeNetwork(network);

    const mobileNumber =
      normalizePhone(phone);

    const selectedPlan = String(
      planCode || dataPlan || ""
    ).trim();

    const dataAmount =
      Number(amount);

    if (!networkCode) {
      return res.status(400).json({
        success: false,
        message:
          "Select MTN, Glo, Airtel or 9mobile.",
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
        message:
          "Select a valid data plan.",
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

    customer =
      await User.findOneAndUpdate(
        {
          _id: req.user._id,
          status: "ACTIVE",
          walletBalance: {
            $gte: dataAmount,
          },
        },
        {
          $inc: {
            walletBalance:
              -dataAmount,
            totalTransactions: 1,
          },
        },
        {
          new: true,
        }
      );

    if (!customer) {
      const existingCustomer =
        await User.findById(
          req.user._id
        );

      if (!existingCustomer) {
        return res.status(404).json({
          success: false,
          message:
            "Customer account was not found.",
        });
      }

      if (
        existingCustomer.status !==
        "ACTIVE"
      ) {
        return res.status(403).json({
          success: false,
          message:
            "This account is not active.",
        });
      }

      return res.status(400).json({
        success: false,
        message:
          "Insufficient wallet balance.",
        walletBalance:
          existingCustomer.walletBalance ||
          0,
      });
    }

    walletDebited = true;

    transaction =
      await Transaction.create({
        reference:
          generateReference("DATA"),
        customerId: customer._id,
        agentId: customer.agentId,
        stateManagerId:
          customer.stateManagerId,
        zonalManagerId:
          customer.zonalManagerId,
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

    const response = await axios.get(
      DATA_URL,
      {
        params: {
          UserID: credentials.userId,
          APIKey: credentials.apiKey,
          MobileNetwork:
            networkCode,
          DataPlan: selectedPlan,
          MobileNumber:
            mobileNumber,
          RequestID:
            transaction.reference,
        },
        timeout: 45000,
        validateStatus: () => true,
      }
    );

    const providerResponse =
      parseProviderResponse(
        response.data
      );

    console.log(
      "CLUBKONNECT DATA RESPONSE:",
      {
        httpStatus:
          response.status,
        reference:
          transaction.reference,
        providerResponse,
      }
    );

    if (
      response.status < 200 ||
      response.status >= 300 ||
      !isProviderSuccessful(
        providerResponse
      )
    ) {
      const refundedCustomer =
        await refundCustomer({
          customerId: customer._id,
          amount: dataAmount,
          transactionId:
            transaction._id,
          providerResponse,
        });

      walletDebited = false;

      return res.status(400).json({
        success: false,
        message:
          getProviderMessage(
            providerResponse
          ),
        reference:
          transaction.reference,
        status: "REFUNDED",
        walletBalance:
          refundedCustomer
            ?.walletBalance || 0,
        providerResponse,
      });
    }

    transaction.status =
      "SUCCESSFUL";

    transaction.providerResponse = {
      network: networkCode,
      planCode: selectedPlan,
      response: providerResponse,
    };

    await transaction.save();

    return res.status(200).json({
      success: true,
      message:
        "Data purchase was successful.",
      reference:
        transaction.reference,
      status: transaction.status,
      walletBalance:
        customer.walletBalance,
      transaction: {
        serviceType: "DATA",
        network: networkCode,
        phone: mobileNumber,
        planCode: selectedPlan,
        amount: dataAmount,
      },
      providerResponse,
    });
  } catch (error) {
    console.error(
      "DATA PURCHASE ERROR:",
      error
    );

    if (
      walletDebited &&
      customer &&
      transaction
    ) {
      try {
        const refundedCustomer =
          await refundCustomer({
            customerId:
              customer._id,
            amount:
              transaction.amount,
            transactionId:
              transaction._id,
            providerResponse:
              error.response?.data || {
                message:
                  error.message,
              },
          });

        return res.status(500).json({
          success: false,
          message:
            "Data purchase failed. Your wallet has been refunded.",
          reference:
            transaction.reference,
          status: "REFUNDED",
          walletBalance:
            refundedCustomer
              ?.walletBalance || 0,
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