const axios = require("axios");

const {
  postDebit,
  postCredit,
} = require("../services/ledger.service");

const crypto = require("crypto");

const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const DataPriceOverride = require("../models/dataPriceOverride.model");
const { distributeCommission } = require("../services/commission.service");

const AIRTIME_URL = "https://www.nellobytesystems.com/APIAirtimeV1.asp";

const DATA_URL = "https://www.nellobytesystems.com/APIDatabundleV1.asp";

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
  T2: "03",
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
    .replace(/[^A-Z0-9]/g, "");

  return NETWORK_CODES[value] || null;
};

const normalizePhone = (phone) => {
  let value = String(phone || "").replace(/\D/g, "");

  if (value.startsWith("234") && value.length === 13) {
    value = `0${value.substring(3)}`;
  }

  return value;
};

const getCredentials = () => {
  const userId = String(process.env.CLUBKONNECT_USER_ID || "").trim();

  const apiKey = String(process.env.CLUBKONNECT_API_KEY || "").trim();

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

const normalizeKey = (key) => {
  return String(key || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
};

const readObjectField = (object, possibleNames) => {
  if (!object || typeof object !== "object") {
    return null;
  }

  const normalizedObject = {};

  for (const [key, value] of Object.entries(object)) {
    normalizedObject[normalizeKey(key)] = value;
  }

  for (const name of possibleNames) {
    const value = normalizedObject[normalizeKey(name)];

    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }

  return null;
};

const parseMoney = (value) => {
  if (value === null || value === undefined) {
    return 0;
  }

  const cleaned = String(value)
    .replace(/NGN/gi, "")
    .replace(/[₦,\s]/g, "")
    .trim();

  const number = Number(cleaned);

  return Number.isFinite(number) ? number : 0;
};

const getProviderStatus = (data) => {
  const parsed = parseProviderResponse(data);

  return String(
    readObjectField(parsed, [
      "status",
      "response_description",
      "responseDescription",
      "message",
      "response",
    ]) || "",
  )
    .trim()
    .toUpperCase();
};

const getProviderMessage = (data) => {
  const parsed = parseProviderResponse(data);

  return String(
    readObjectField(parsed, [
      "message",
      "response_description",
      "responseDescription",
      "status",
      "response",
    ]) || "The provider rejected this request.",
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

  if (failureWords.some((word) => status.includes(word))) {
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

  return successWords.some((word) => status.includes(word));
};

const looksLikePlanObject = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const id = readObjectField(value, [
    "id",
    "planId",
    "plan_id",
    "productId",
    "product_id",
    "dataPlan",
    "dataplan",
    "code",
  ]);

  const name = readObjectField(value, [
    "name",
    "planName",
    "plan_name",
    "productName",
    "product_name",
    "description",
    "bundle",
  ]);

  const price = readObjectField(value, [
    "price",
    "amount",
    "productAmount",
    "product_amount",
    "sellingPrice",
    "selling_price",
    "cost",
  ]);

  return id !== null || (name !== null && price !== null);
};

const collectPlanObjects = (
  value,
  inheritedNetwork = null,
  inheritedId = null,
  output = [],
) => {
  if (value === null || value === undefined) {
    return output;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectPlanObjects(item, inheritedNetwork, inheritedId, output);
    }

    return output;
  }

  if (typeof value !== "object") {
    return output;
  }

  /*
   * ClubKonnect returns network containers like:
   *
   * {
   *   ID: "01",
   *   PRODUCT: [...]
   * }
   *
   * ID here is the network ID, not a data-plan ID.
   */
  const objectId = readObjectField(value, [
    "networkId",
    "network_id",
    "mobileNetwork",
    "mobile_network",
    "ID",
  ]);

  const objectNetwork = normalizeNetwork(objectId) || inheritedNetwork;

  const productList = readObjectField(value, [
    "PRODUCT",
    "PRODUCTS",
    "product",
    "products",
  ]);

  if (Array.isArray(productList)) {
    collectPlanObjects(productList, objectNetwork, null, output);

    return output;
  }

  if (looksLikePlanObject(value)) {
    output.push({
      ...value,
      __inheritedNetwork: objectNetwork,
      __inheritedId: inheritedId,
    });

    return output;
  }

  for (const [key, child] of Object.entries(value)) {
    const networkFromKey = normalizeNetwork(key) || objectNetwork;

    const idFromKey = /^\d+(\.\d+)?$/.test(String(key).trim())
      ? String(key).trim()
      : inheritedId;

    collectPlanObjects(child, networkFromKey, idFromKey, output);
  }

  return output;
};

const normalizeDataPlan = (rawPlan, requestedNetwork) => {
  if (!rawPlan || typeof rawPlan !== "object") {
    return null;
  }

  const id =
    readObjectField(rawPlan, [
      "id",
      "planId",
      "plan_id",
      "productId",
      "product_id",
      "dataPlan",
      "dataplan",
      "dataPlanId",
      "data_plan_id",
      "code",
    ]) || rawPlan.__inheritedId;

  const name = readObjectField(rawPlan, [
    "name",
    "planName",
    "plan_name",
    "productName",
    "product_name",
    "description",
    "bundle",
    "package",
    "title",
  ]);

  const priceValue = readObjectField(rawPlan, [
    "price",
    "amount",
    "productAmount",
    "product_amount",
    "sellingPrice",
    "selling_price",
    "cost",
    "rate",
  ]);

  const providerNetwork =
    readObjectField(rawPlan, [
      "network",
      "networkName",
      "network_name",
      "networkCode",
      "network_code",
      "mobileNetwork",
      "mobile_network",
    ]) || rawPlan.__inheritedNetwork;

  const networkCode = normalizeNetwork(providerNetwork) || requestedNetwork;

  const price = parseMoney(priceValue);

  if (id === null || id === undefined || String(id).trim() === "") {
    return null;
  }

  if (networkCode !== requestedNetwork) {
    return null;
  }

  return {
    id: String(id).trim(),
    code: String(id).trim(),
    name: String(name || `Data Plan ${id}`).trim(),
    price,
    networkCode,
    network: NETWORK_NAMES[networkCode] || networkCode,
  };
};


const fetchNormalizedDataPlans = async (
  networkCode,
  credentials
) => {
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

  if (
    response.status < 200 ||
    response.status >= 300
  ) {
    throw new Error(
      "Unable to retrieve data plans from the provider."
    );
  }

  const parsed =
    parseProviderResponse(
      response.data
    );

  const rawPlans =
    collectPlanObjects(parsed);

  return rawPlans
    .map(
      (plan) =>
        normalizeDataPlan(
          plan,
          networkCode
        )
    )
    .filter(
      (plan) =>
        plan !== null &&
        plan.price > 0
    )
    .filter(
      (plan, index, array) =>
        array.findIndex(
          (item) =>
            item.code === plan.code &&
            item.networkCode ===
              plan.networkCode
        ) === index
    )
    .sort(
      (a, b) =>
        a.price - b.price
    );
};

exports.fetchNormalizedDataPlans =
  fetchNormalizedDataPlans;


const refundCustomer = async ({
  customerId,
  amount,
  transactionId,
  providerResponse,
  serviceType = "AIRTIME",
}) => {
  const normalizedServiceType =
    String(serviceType || "AIRTIME")
      .trim()
      .toUpperCase() === "DATA"
      ? "DATA"
      : "AIRTIME";

  const reversalService =
    normalizedServiceType === "DATA"
      ? "DATA_REVERSAL"
      : "AIRTIME_REVERSAL";

  /*
   * =====================================================
   * SERVICEPAY_CORE_LEDGER_GENERIC_REVERSAL_V1
   * =====================================================
   */

  const refundTransaction =
    await Transaction.findById(
      transactionId
    );

  if (!refundTransaction) {
    throw new Error(
      "Transaction to refund was not found."
    );
  }

  /*
   * Application-level duplicate refund protection.
   */
  if (
    String(refundTransaction.status || "")
      .toUpperCase() === "REFUNDED"
  ) {
    return User.findById(customerId);
  }

  const customerBeforeRefund =
    await User.findById(customerId)
      .select("walletBalance");

  if (!customerBeforeRefund) {
    throw new Error(
      "Customer to refund was not found."
    );
  }

  const refundOpeningBalance =
    Number(
      customerBeforeRefund.walletBalance || 0
    );

  const refundAmount =
    Number(amount);

  const updatedCustomer =
    await User.findByIdAndUpdate(
      customerId,
      {
        $inc: {
          walletBalance:
            refundAmount,
        },
      },
      {
        new: true,
      }
    );

  const refundClosingBalance =
    Number(
      updatedCustomer?.walletBalance || 0
    );

  await Transaction.findByIdAndUpdate(
    transactionId,
    {
      status: "REFUNDED",
      providerResponse,
    }
  );

  /*
   * Only create reversal when the original service
   * is AIRTIME and an Airtime DEBIT ledger exists.
   */
  if (
    String(
      refundTransaction.serviceType || ""
    ).toUpperCase() === "AIRTIME"
  ) {
    const LedgerEntry = require(
      "../models/ledgerEntry.model"
    );

    const originalDebit =
      await LedgerEntry.findOne({
        user: customerId,
        reference:
          refundTransaction.reference,
        service: normalizedServiceType,
        direction: "DEBIT",
      });

    if (originalDebit) {
      await postCredit({
        userId: customerId,
        amount: refundAmount,
        openingBalance:
          refundOpeningBalance,
        closingBalance:
          refundClosingBalance,
        service:
      normalizedServiceType === "DATA"
        ? "DATA_REVERSAL"
        : "AIRTIME_REVERSAL",
        reference:
          refundTransaction.reference,
        idempotencyKey:
          `${normalizedServiceType}:${refundTransaction.reference}:REVERSAL:CREDIT`,
        transactionId:
          refundTransaction._id,
        narration:
          `${normalizedServiceType} purchase refund`,
        metadata: {
          originalLedgerEntry:
            String(originalDebit._id),
          provider:
            "CLUBKONNECT",
          reason:
            "Provider purchase failed after wallet debit",
        },
      });
    }
  }

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

    const networkCode =
      normalizeNetwork(
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

    const providerPlans =
      await fetchNormalizedDataPlans(
        networkCode,
        credentials
      );

    const overrides =
      await DataPriceOverride.find({
        networkCode,
        active: true,
      }).lean();

    const overrideMap =
      new Map(
        overrides.map(
          (item) => [
            String(item.planCode),
            item,
          ]
        )
      );

    const plans =
      providerPlans.map(
        (plan) => {
          const override =
            overrideMap.get(
              String(plan.code)
            );

          const sellingPrice =
            override &&
            Number(
              override.sellingPrice
            ) > 0
              ? Number(
                  override.sellingPrice
                )
              : Number(
                  plan.price
                );

          return {
            ...plan,
            price: sellingPrice,
            sellingPrice,
          };
        }
      );

    return res.status(200).json({
      success: true,
      message:
        "Data plans retrieved successfully.",
      network: {
        code: networkCode,
        name:
          NETWORK_NAMES[
            networkCode
          ],
      },
      count: plans.length,
      plans,
    });
  } catch (error) {
    console.error(
      "GET DATA PLANS ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to retrieve data plans.",
      error: error.message,
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
        message: "ClubKonnect credentials are not configured on the server.",
      });
    }

    const { network, phone, amount } = req.body;

    const networkCode = normalizeNetwork(network);

    const mobileNumber = normalizePhone(phone);

    const airtimeAmount = Number(amount);

    if (!networkCode) {
      return res.status(400).json({
        success: false,
        message: "Select MTN, Glo, Airtel or 9mobile.",
      });
    }

    if (mobileNumber.length !== 11 || !mobileNumber.startsWith("0")) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid Nigerian phone number.",
      });
    }

    if (!Number.isFinite(airtimeAmount) || airtimeAmount < 50) {
      return res.status(400).json({
        success: false,
        message: "Airtime amount must be at least ₦50.",
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
      },
    );

    if (!customer) {
      const existingCustomer = await User.findById(req.user._id);

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
        walletBalance: existingCustomer.walletBalance || 0,
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

    /*
     * =====================================================
     * SERVICEPAY_CORE_LEDGER_AIRTIME_DEBIT_V1
     * =====================================================
     * Wallet has already been debited at this point.
     * Record the financial movement before calling provider.
     */

    const airtimeClosingBalance =
      Number(customer.walletBalance || 0);

    const airtimeOpeningBalance =
      Number(
        (
          airtimeClosingBalance +
          airtimeAmount
        ).toFixed(2)
      );

    const airtimeDebitLedger =
      await postDebit({
        userId: customer._id,
        amount: airtimeAmount,
        openingBalance:
          airtimeOpeningBalance,
        closingBalance:
          airtimeClosingBalance,
        service: "AIRTIME",
        reference:
          transaction.reference,
        idempotencyKey:
          `AIRTIME:${transaction.reference}:DEBIT`,
        transactionId:
          transaction._id,
        narration:
          `Airtime purchase to ${mobileNumber}`,
        metadata: {
          network:
            networkCode,
          phone:
            mobileNumber,
          provider:
            "CLUBKONNECT",
        },
      });

    if (airtimeDebitLedger.duplicate) {
      throw new Error(
        "Duplicate Airtime debit ledger detected."
      );
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

    const providerResponse = parseProviderResponse(response.data);

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
        walletBalance: refundedCustomer?.walletBalance || 0,
        providerResponse,
      });
    }

    transaction.status = "SUCCESSFUL";

    transaction.providerResponse = providerResponse;

    await transaction.save();

    // AIRTIME_COMMISSION_DISTRIBUTION
    try {
      const commissionResult = await distributeCommission({
        transaction,
        customer,
        serviceType: "AIRTIME",
        productCode: "AIRTIME",
        description: "Airtime purchase commission",
        metadata: {
          network: networkCode,
          phone: mobileNumber,
          amount: airtimeAmount,
          reference: transaction.reference,
        },
      });

      console.log("AIRTIME COMMISSION RESULT:", commissionResult);
    } catch (commissionError) {
      /*
       * Commission failure must never stop a successful
       * airtime purchase from being returned to the customer.
       */
      console.error("AIRTIME COMMISSION ERROR:", commissionError);
    }

    return res.status(200).json({
      success: true,
      message: "Airtime purchase was successful.",
      reference: transaction.reference,
      status: transaction.status,
      walletBalance: customer.walletBalance,
      transaction: {
        serviceType: "AIRTIME",
        network: networkCode,
        phone: mobileNumber,
        amount: airtimeAmount,
      },
      providerResponse,
    });
  } catch (error) {
    console.error("AIRTIME PURCHASE ERROR:", error);

    if (walletDebited && customer && transaction) {
      try {
        const refundedCustomer = await refundCustomer({
          customerId: customer._id,
          amount: transaction.amount,
          transactionId: transaction._id,
          providerResponse: error.response?.data || {
            message: error.message,
          },
        });

        return res.status(500).json({
          success: false,
          message: "Airtime purchase failed. Your wallet has been refunded.",
          reference: transaction.reference,
          status: "REFUNDED",
          walletBalance: refundedCustomer?.walletBalance || 0,
        });
      } catch (refundError) {
        console.error("AIRTIME REFUND ERROR:", refundError);
      }
    }

    return res.status(500).json({
      success: false,
      message: "Airtime purchase could not be completed.",
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
        message: "ClubKonnect credentials are not configured on the server.",
      });
    }

    const { network, phone, planCode, dataPlan } = req.body;

    const networkCode = normalizeNetwork(network);

    const mobileNumber = normalizePhone(phone);

    const selectedPlan = String(planCode || dataPlan || "").trim();

    const providerPlans =
      await fetchNormalizedDataPlans(
        networkCode,
        credentials
      );

    const providerPlan =
      providerPlans.find(
        (plan) =>
          String(plan.code) ===
          selectedPlan
      );

    if (!providerPlan) {
      return res.status(400).json({
        success: false,
        message:
          "The selected data plan is no longer available. Please refresh and try again.",
      });
    }

    const override =
      await DataPriceOverride.findOne({
        networkCode,
        planCode: selectedPlan,
        active: true,
      }).lean();

    const providerPrice =
      Number(providerPlan.price);

    const dataAmount =
      override &&
      Number(
        override.sellingPrice
      ) > 0
        ? Number(
            override.sellingPrice
          )
        : providerPrice;

    if (!networkCode) {
      return res.status(400).json({
        success: false,
        message: "Select MTN, Glo, Airtel or 9mobile.",
      });
    }

    if (mobileNumber.length !== 11 || !mobileNumber.startsWith("0")) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid Nigerian phone number.",
      });
    }

    if (!selectedPlan) {
      return res.status(400).json({
        success: false,
        message: "Select a valid data plan.",
      });
    }

    if (!Number.isFinite(dataAmount) || dataAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "A valid data plan amount is required.",
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
      },
    );

    if (!customer) {
      const existingCustomer = await User.findById(req.user._id);

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
        walletBalance: existingCustomer.walletBalance || 0,
      });
    }

    walletDebited = true;

    
    /*
     * ============================================================
     * SERVICEPAY_CORE_LEDGER_DATA_DEBIT_V1
     * ============================================================
     */
    const dataOpeningBalance =
      Number(customer.walletBalance || 0) + Number(dataAmount);

    const dataClosingBalance =
      Number(customer.walletBalance || 0);

    const dataLedgerReference =
      generateReference("DATA_LEDGER");

    await postDebit({
      userId: customer._id,
      amount: dataAmount,
      openingBalance: dataOpeningBalance,
      closingBalance: dataClosingBalance,
      service: "DATA",
      reference: dataLedgerReference,
      idempotencyKey:
        `DATA:${dataLedgerReference}:DEBIT`,
      narration:
        `Data purchase to ${mobileNumber}`,
      metadata: {
        network: networkCode,
        phone: mobileNumber,
        planCode: selectedPlan,
        provider: "CLUBKONNECT",
      },
    });

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
        RequestID: transaction.reference,
      },
      timeout: 45000,
      validateStatus: () => true,
    });

    const providerResponse = parseProviderResponse(response.data);

    console.log("CLUBKONNECT DATA RESPONSE:", {
      httpStatus: response.status,
      reference: transaction.reference,
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
        serviceType: "DATA",
      });

      walletDebited = false;

      return res.status(400).json({
        success: false,
        message: getProviderMessage(providerResponse),
        reference: transaction.reference,
        status: "REFUNDED",
        walletBalance: refundedCustomer?.walletBalance || 0,
        providerResponse,
      });
    }

    transaction.status = "SUCCESSFUL";

    transaction.providerResponse = {
      network: networkCode,
      planCode: selectedPlan,
      response: providerResponse,
    };

    await transaction.save();

    // DATA_COMMISSION_DISTRIBUTION
    try {
      const commissionResult = await distributeCommission({
        transaction,
        customer,
        serviceType: "DATA",
        productCode: "DATA",
        description: "Data purchase commission",
        metadata: {
          network: networkCode,
          phone: mobileNumber,
          planCode: selectedPlan,
          amount: dataAmount,
          reference: transaction.reference,
        },
      });

      console.log("DATA COMMISSION RESULT:", commissionResult);
    } catch (commissionError) {
      /*
       * Commission failure must never stop a successful
       * data purchase from being returned to the customer.
       */
      console.error("DATA COMMISSION ERROR:", commissionError);
    }

    return res.status(200).json({
      success: true,
      message: "Data purchase was successful.",
      reference: transaction.reference,
      status: transaction.status,
      walletBalance: customer.walletBalance,
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
    console.error("DATA PURCHASE ERROR:", error);

    if (walletDebited && customer && transaction) {
      try {
        const refundedCustomer = await refundCustomer({
          customerId: customer._id,
          amount: transaction.amount,
          transactionId: transaction._id,
          providerResponse: error.response?.data || {
            message: error.message,
          },
        serviceType: "DATA",
      });

        return res.status(500).json({
          success: false,
          message: "Data purchase failed. Your wallet has been refunded.",
          reference: transaction.reference,
          status: "REFUNDED",
          walletBalance: refundedCustomer?.walletBalance || 0,
        });
      } catch (refundError) {
        console.error("DATA REFUND ERROR:", refundError);
      }
    }

    return res.status(500).json({
      success: false,
      message: "Data purchase could not be completed.",
      error: error.message,
    });
  }
};
