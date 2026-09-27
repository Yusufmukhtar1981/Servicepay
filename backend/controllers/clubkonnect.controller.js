const axios = require("axios");
const mongoose = require("mongoose");

const {
  postDebit,
  postCredit,
} = require("../services/ledger.service");

const crypto = require("crypto");

const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const DataPriceOverride = require("../models/dataPriceOverride.model");
const { distributeCommission } = require("../services/commission.service");
const {
  reconcileReferralReward,
  enqueueReferralRewardEvent,
} = require("../services/referralReward.service");
const {
  refundFailedDataPurchase,
} = require("../services/clubkonnectDataFailure.service");
const {
  getServiceConfig,
  isAvailable,
  getProviderCapabilities,
} = require("../services/providerManagement.service");
const telecomAbode = require("../services/telecomAbode.service");
const {
  issueDataPlanQuote,
  verifyDataPlanQuote,
} = require("../services/dataPlanQuote.service");

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
}) => {
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
  if (String(refundTransaction.serviceType || "").toUpperCase() !== "AIRTIME") {
    throw new Error("This refund path is restricted to Airtime transactions.");
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

  const sourceSession = await mongoose.startSession();
  try {
    await sourceSession.withTransaction(async () => {
      await Transaction.findByIdAndUpdate(
        transactionId,
        {
          status: "REFUNDED",
          providerResponse,
        },
        { session: sourceSession }
      );
    });
  } finally {
    await sourceSession.endSession();
  }

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
        service: "AIRTIME",
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
        service: "AIRTIME_REVERSAL",
        reference:
          refundTransaction.reference,
        idempotencyKey:
          `AIRTIME:${refundTransaction.reference}:REVERSAL:CREDIT`,
        transactionId:
          refundTransaction._id,
        narration:
          "AIRTIME purchase refund",
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

    const providerConfig = await getServiceConfig("DATA");
    const requestedProvider = String(req.query.provider || "").trim().toUpperCase();
    if (requestedProvider && !["CLUBKONNECT", "TELECOM_ABODE"].includes(requestedProvider)) {
      return res.status(400).json({
        success: false,
        message: "Unsupported DATA catalog provider.",
      });
    }
    const provider = requestedProvider || String(providerConfig.primaryProvider || "").toUpperCase();
    const providerState = providerConfig.providerStates.find(
      (item) => item.provider === provider,
    );
    const telecomAbodeCatalogReadOnly =
      provider === "TELECOM_ABODE" &&
      getProviderCapabilities("DATA", provider).credentialsConfigured;
    if (
      !telecomAbodeCatalogReadOnly &&
      (!providerState?.enabled || !isAvailable("DATA", provider))
    ) {
      return res.status(503).json({
        success: false,
        message: "Data plans are unavailable because no enabled, available primary provider is configured.",
      });
    }

    let plans;
    if (provider === "TELECOM_ABODE") {
      const catalog = await telecomAbode.getDataPlans();
      plans = catalog
        .filter((plan) => normalizeNetwork(plan.network) === networkCode)
        .map((plan) => ({
          ...plan,
          provider,
          planProvider: provider,
          sellingPrice: Number(plan.price),
        }));
    } else {
      const credentials = getCredentials();
      if (!credentials.valid) {
        return res.status(503).json({
          success: false,
          message: "ClubKonnect credentials are not configured on the server.",
        });
      }
      const providerPlans = await fetchNormalizedDataPlans(networkCode, credentials);
      const overrides = await DataPriceOverride.find({
        networkCode,
        active: true,
      }).lean();
      const overrideMap = new Map(overrides.map((item) => [String(item.planCode), item]));
      plans = providerPlans.map((plan) => {
        const override = overrideMap.get(String(plan.code));
        const sellingPrice =
          override && Number(override.sellingPrice) > 0
            ? Number(override.sellingPrice)
            : Number(plan.price);
        return {
          ...plan,
          provider,
          planProvider: provider,
          price: sellingPrice,
          sellingPrice,
        };
      });
    }

    if (req.user?._id) {
      plans = plans.map((plan) => ({
        ...plan,
        productQuote: issueDataPlanQuote({
          customerId: req.user._id,
          provider,
          network: networkCode,
          plan,
          price: Number(plan.sellingPrice),
        }),
      }));
    }

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

    return res.status(error.statusCode || 500).json({
      success: false,
      message:
        "Unable to retrieve data plans.",
      error: error.statusCode ? error.message : "Data plan catalog retrieval failed.",
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

const getDataProviderSignals = (data) => {
  const parsed = parseProviderResponse(data);
  const values = [
    "status",
    "orderStatus",
    "responseStatus",
    "responseDescription",
    "responseCode",
    "code",
    "message",
  ].map((key) =>
    String(readObjectField(parsed, [key]) || "")
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, "_"),
  );
  const succeeded = values.some((value) =>
    /^(SUCCESS|SUCCESSFUL|COMPLETED|ORDER_COMPLETED)$/.test(value),
  );
  const failed = values.some((value) =>
    /(^|_)(INVALID|FAILED|FAILURE|ERROR|MISSING|INSUFFICIENT|DECLINED|REJECTED|UNAUTHORIZED|NOT_FOUND|CANCELLED|CANCELED)(_|$)/.test(value),
  );
  const successFlag = readObjectField(parsed, ["success"]);
  const booleanSuccess =
    successFlag === true || String(successFlag || "").toLowerCase() === "true";
  const booleanFailure =
    successFlag === false || String(successFlag || "").toLowerCase() === "false";
  const contradictory =
    (succeeded && failed) ||
    (succeeded && booleanFailure) ||
    (failed && booleanSuccess);
  return { succeeded, failed, contradictory };
};

const hasCustomerDataIdempotencyIndex = async () => {
  try {
    const indexes = await Transaction.collection.indexes();
    return indexes.some((index) =>
      index.name === "uniq_customer_service_idempotency_key" &&
      index.unique === true &&
      index.key?.customerId === 1 &&
      index.key?.serviceType === 1 &&
      index.key?.idempotencyKey === 1 &&
      index.partialFilterExpression?.idempotencyKey?.$type === "string"
    );
  } catch (_) {
    return false;
  }
};

const runDataSuccessEffects = async ({
  transaction,
  customer,
  networkCode,
  mobileNumber,
  selectedPlan,
}) => {
  try {
    const sourceSession = await mongoose.startSession();
    try {
      await sourceSession.withTransaction(async () => {
        await enqueueReferralRewardEvent({
          referredCustomerId: customer._id,
          sourceType: "DATA",
          sourceId: transaction._id,
          session: sourceSession,
        });
      });
    } finally {
      await sourceSession.endSession();
    }
    await reconcileReferralReward({
      referredCustomerId: customer._id,
      sourceType: "DATA",
      sourceId: transaction._id,
    });
  } catch (rewardError) {
    console.error("DATA REFERRAL RECONCILIATION ERROR:", rewardError);
  }

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
        amount: transaction.amount,
        reference: transaction.reference,
      },
    });
    console.log("DATA COMMISSION RESULT:", commissionResult);
  } catch (commissionError) {
    console.error("DATA COMMISSION ERROR:", commissionError);
  }
};

exports.buyData = async (req, res) => {
  let transaction = null;
  let customer = null;
  let dispatchClaimed = false;

  const pendingResponse = (tx, walletBalance) =>
    res.status(202).json({
      success: false,
      message: "Data purchase requires reconciliation. Do not retry with a new request key.",
      reference: tx?.reference,
      status: "PENDING",
      walletBalance,
      dispatchStatus: tx?.dispatchStatus || "UNKNOWN",
      dispatchClaimedAt: tx?.dispatchClaimedAt || null,
    });

  const returnExisting = async (
    existing,
    networkCode,
    mobileNumber,
    selectedPlan,
    requestedPlanProvider,
    requestedQuote,
  ) => {
    const original = existing.providerResponse || {};
    const frozenProvider = String(existing.provider || original.provider || "CLUBKONNECT").toUpperCase();
    if (
      existing.phone !== mobileNumber ||
      String(original.network || "") !== String(networkCode) ||
      String(original.planCode || "") !== String(selectedPlan) ||
      (requestedPlanProvider && requestedPlanProvider !== frozenProvider) ||
      (requestedQuote !== null && requestedQuote !== undefined &&
        Number(original.quotedPrice) !== requestedQuote)
    ) {
      return res.status(409).json({
        success: false,
        message: "The idempotency key was already used for a different data purchase.",
      });
    }
    if (existing.status === "SUCCESSFUL") {
      const providerResponse = original.response || {};
      const currentCustomer = await User.findById(existing.customerId)
        .select("walletBalance")
        .lean();
      return res.status(200).json({
        success: true,
        message: "Data purchase was successful.",
        reference: existing.reference,
        status: existing.status,
        walletBalance: currentCustomer?.walletBalance || 0,
        transaction: {
          serviceType: "DATA",
          provider: frozenProvider,
          network: networkCode,
          phone: mobileNumber,
          planCode: selectedPlan,
          amount: existing.amount,
        },
        providerResponse,
      });
    }
    if (
      existing.status === "REFUNDED" ||
      (existing.status === "FAILED" && existing.dispatchStatus === "REFUNDED")
    ) {
      const currentCustomer = await User.findById(existing.customerId)
        .select("walletBalance")
        .lean();
      return res.status(400).json({
        success: false,
        message: getProviderMessage(original.response || original),
        reference: existing.reference,
        status: "REFUNDED",
        walletBalance: currentCustomer?.walletBalance || 0,
        providerResponse: original.response || original,
      });
    }
    return pendingResponse(existing);
  };

  try {
    const { network, phone, planCode, dataPlan } = req.body;
    const networkCode = normalizeNetwork(network);
    const mobileNumber = normalizePhone(phone);
    const selectedPlan = String(planCode || dataPlan || "").trim();
    const requestedPlanProvider = String(req.body.planProvider || "").trim().toUpperCase();
    const productQuote = req.body.productQuote;
    const requestedQuoteValue = req.body.quotedPrice;
    const requestedQuote =
      requestedQuoteValue === undefined || requestedQuoteValue === null || requestedQuoteValue === ""
        ? null
        : typeof requestedQuoteValue === "number" ||
            (typeof requestedQuoteValue === "string" && /^[0-9]+(?:\.[0-9]+)?$/.test(requestedQuoteValue.trim()))
          ? Number(requestedQuoteValue)
          : NaN;
    const keyCandidates = [
      req.headers?.["x-idempotency-key"],
      req.get?.("X-Idempotency-Key"),
      req.get?.("Idempotency-Key"),
      req.body.idempotencyKey,
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    const uniqueKeys = [...new Set(keyCandidates)];
    if (uniqueKeys.length > 1) {
      return res.status(400).json({
        success: false,
        message: "Conflicting idempotency keys were supplied.",
      });
    }
    const idempotencyKey = uniqueKeys[0] || "";

    if (!idempotencyKey || idempotencyKey.length > 128) {
      return res.status(400).json({
        success: false,
        message: "A valid idempotencyKey is required for data purchases.",
      });
    }
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

    const existing = await Transaction.findOne({
      customerId: req.user._id,
      serviceType: "DATA",
      idempotencyKey,
    });
    if (existing) {
      return returnExisting(
        existing,
        networkCode,
        mobileNumber,
        selectedPlan,
        requestedPlanProvider,
        requestedQuote,
      );
    }

    if (!(await hasCustomerDataIdempotencyIndex())) {
      return res.status(503).json({
        success: false,
        message: "Data purchases are temporarily unavailable because the retry-key uniqueness index is not ready.",
      });
    }

    const providerConfig = await getServiceConfig("DATA");
    const selectedProvider = String(providerConfig.primaryProvider || "").toUpperCase();
    const selectedProviderState = providerConfig.providerStates.find(
      (item) => item.provider === selectedProvider,
    );
    if (!selectedProviderState?.enabled || !isAvailable("DATA", selectedProvider)) {
      return res.status(503).json({
        success: false,
        message: "Data purchases are unavailable because the configured primary provider is disabled or unavailable.",
      });
    }
    if (
      requestedPlanProvider &&
      requestedPlanProvider !== selectedProvider
    ) {
      return res.status(409).json({
        success: false,
        message: "The selected plan belongs to a different provider. Refresh the data plans.",
      });
    }
    if (selectedProvider === "TELECOM_ABODE" && !productQuote) {
      return res.status(409).json({
        success: false,
        message: "Refresh the Data plans and select a current product quote.",
      });
    }

    let providerPlan;
    let credentials = null;
    if (selectedProvider === "TELECOM_ABODE") {
      const providerPlans = await telecomAbode.getDataPlans();
      providerPlan = providerPlans.find(
        (plan) =>
          String(plan.code) === selectedPlan &&
          normalizeNetwork(plan.network) === networkCode,
      );
    } else {
      credentials = getCredentials();
      if (!credentials.valid) {
        return res.status(503).json({
          success: false,
          message: "ClubKonnect credentials are not configured on the server.",
        });
      }
      const providerPlans = await fetchNormalizedDataPlans(networkCode, credentials);
      providerPlan = providerPlans.find((plan) => String(plan.code) === selectedPlan);
    }
    if (!providerPlan) {
      return res.status(400).json({
        success: false,
        message: "The selected data plan is no longer available. Please refresh and try again.",
      });
    }

    const providerPrice = Number(providerPlan.price);
    let dataAmount = providerPrice;
    if (selectedProvider === "CLUBKONNECT") {
      const override = await DataPriceOverride.findOne({
        networkCode,
        planCode: selectedPlan,
        active: true,
      }).lean();
      dataAmount =
        override && Number(override.sellingPrice) > 0
          ? Number(override.sellingPrice)
          : providerPrice;
    }
    if (!Number.isFinite(dataAmount) || dataAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "A valid data plan amount is required.",
      });
    }
    if (productQuote && !verifyDataPlanQuote(productQuote, {
      customerId: req.user._id,
      provider: selectedProvider,
      network: networkCode,
      plan: providerPlan,
      price: dataAmount,
    })) {
      return res.status(409).json({
        success: false,
        message: "The selected Data plan changed or its quote expired. Refresh the plans before purchasing.",
      });
    }
    if (selectedProvider === "TELECOM_ABODE") {
      if (requestedQuote !== null && (!Number.isFinite(requestedQuote) || requestedQuote !== dataAmount)) {
        return res.status(409).json({
          success: false,
          message: "The quoted Telecom Abode plan price is missing or no longer matches the current provider catalog.",
        });
      }
    } else if (
      requestedQuote !== null &&
      (!Number.isFinite(requestedQuote) || requestedQuote !== dataAmount)
    ) {
      return res.status(409).json({
        success: false,
        message: "The quoted data plan price no longer matches the current server price.",
      });
    }

    const admissionProviderConfig = await getServiceConfig("DATA");
    const admissionProviderState = admissionProviderConfig.providerStates.find(
      (item) => item.provider === selectedProvider,
    );
    if (
      admissionProviderConfig.primaryProvider !== selectedProvider ||
      !admissionProviderState?.enabled ||
      !isAvailable("DATA", selectedProvider)
    ) {
      return res.status(409).json({
        success: false,
        message: "The primary DATA provider changed or became unavailable. Refresh the data plans before purchasing.",
      });
    }

    const reference = generateReference("DATA");
    const session = await mongoose.startSession();
    let admissionFailure = null;
    let admissionRejected = false;
    try {
      await session.withTransaction(async () => {
        customer = await User.findOneAndUpdate(
          {
            _id: req.user._id,
            status: "ACTIVE",
            walletBalance: { $gte: dataAmount },
          },
          {
            $inc: {
              walletBalance: -dataAmount,
              totalTransactions: 1,
            },
          },
          { new: true, session },
        );

        if (!customer) {
          admissionRejected = true;
          admissionFailure = await User.findById(req.user._id).session(session);
          return;
        }

        const [created] = await Transaction.create(
          [{
            reference,
            customerId: customer._id,
            agentId: customer.agentId,
            stateManagerId: customer.stateManagerId,
            zonalManagerId: customer.zonalManagerId,
            serviceType: "DATA",
            provider: selectedProvider,
            providerRequestId: reference,
            phone: mobileNumber,
            amount: dataAmount,
            status: "PENDING",
            idempotencyKey,
            dispatchStatus: "READY",
            dispatchClaimedAt: null,
            providerStatus: "UNKNOWN",
            providerResponse: {
              provider: selectedProvider,
              network: networkCode,
              planCode: selectedPlan,
              ...(selectedProvider === "TELECOM_ABODE"
                ? { providerNetworkId: providerPlan.networkId, providerPlanId: Number(providerPlan.id) }
                : {}),
              planName: providerPlan.name,
              providerPrice,
              quotedPrice: dataAmount,
            },
          }],
          { session },
        );
        transaction = created;

        const debit = await postDebit({
          userId: customer._id,
          amount: dataAmount,
          openingBalance: Number(customer.walletBalance || 0) + dataAmount,
          closingBalance: Number(customer.walletBalance || 0),
          service: "DATA",
          reference,
          idempotencyKey: `DATA:${reference}:DEBIT`,
          transactionId: transaction._id,
          narration: `Data purchase to ${mobileNumber}`,
          metadata: {
            network: networkCode,
            phone: mobileNumber,
            planCode: selectedPlan,
            provider: selectedProvider,
          },
          session,
        });
        if (debit.duplicate) {
          throw new Error("Duplicate DATA debit ledger detected.");
        }
        transaction.debitLedgerEntryId = debit.entry._id;
        await transaction.save({ session });
      });
    } catch (admissionError) {
      if (admissionError.code === 11000) {
        const duplicate = await Transaction.findOne({
          customerId: req.user._id,
          serviceType: "DATA",
          idempotencyKey,
        });
        if (duplicate) {
          return returnExisting(
            duplicate,
            networkCode,
            mobileNumber,
            selectedPlan,
            requestedPlanProvider,
            requestedQuote,
          );
        }
      }
      throw admissionError;
    } finally {
      await session.endSession();
    }

    if (admissionRejected) {
      if (!admissionFailure?._id) {
        return res.status(404).json({
          success: false,
          message: "Customer account was not found.",
        });
      }
      if (admissionFailure.status !== "ACTIVE") {
        return res.status(403).json({
          success: false,
          message: "This account is not active.",
        });
      }
      return res.status(400).json({
        success: false,
        message: "Insufficient wallet balance.",
        walletBalance: admissionFailure.walletBalance || 0,
      });
    }

    const claimed = await Transaction.findOneAndUpdate(
      {
        _id: transaction._id,
        status: "PENDING",
        dispatchStatus: "READY",
        dispatchClaimedAt: null,
      },
      {
        $set: {
          dispatchStatus: "CLAIMED",
          dispatchClaimedAt: new Date(),
        },
      },
      { new: true },
    );
    if (!claimed) {
      const current = await Transaction.findById(transaction._id);
      return pendingResponse(current, customer.walletBalance);
    }
    transaction = claimed;
    dispatchClaimed = true;
    const activeDispatchStatus = selectedProvider === "TELECOM_ABODE" ? "SENDING" : "CLAIMED";

    let providerResult;
    try {
      if (selectedProvider === "TELECOM_ABODE") {
        providerResult = {
          status: 200,
          data: await telecomAbode.purchaseData({
            network: providerPlan.networkId,
            phone: mobileNumber,
            plan: Number(providerPlan.id),
            request_id: transaction.providerRequestId,
            transactionId: transaction._id,
          }),
        };
      } else {
        providerResult = await axios.get(DATA_URL, {
          params: {
            UserID: credentials.userId,
            APIKey: credentials.apiKey,
            MobileNetwork: networkCode,
            DataPlan: selectedPlan,
            MobileNumber: mobileNumber,
            RequestID: transaction.providerRequestId,
          },
          timeout: 45000,
          validateStatus: () => true,
        });
      }
    } catch (providerError) {
      const httpError = providerError.code === "PROVIDER_HTTP_ERROR" &&
        Number.isInteger(providerError.statusCode);
      await Transaction.updateOne(
        {
          _id: transaction._id,
          status: "PENDING",
          dispatchStatus: { $in: ["CLAIMED", activeDispatchStatus] },
        },
        {
          $set: {
            dispatchStatus: "UNKNOWN",
            providerStatus: "UNKNOWN",
            providerResponse: {
              ...transaction.providerResponse,
              network: networkCode,
              planCode: selectedPlan,
              outcome: "UNKNOWN",
              message: providerError.message,
              ...(httpError ? {
                httpStatus: providerError.statusCode,
                ...(providerError.providerEvidence
                  ? { responseEvidence: providerError.providerEvidence }
                  : {}),
              } : {}),
            },
          },
        },
      );
      const pending = await Transaction.findById(transaction._id);
      if (pending && pending.status !== "PENDING") {
        return returnExisting(pending, networkCode, mobileNumber, selectedPlan);
      }
      return pendingResponse(pending || transaction, customer.walletBalance);
    }

    const providerResponse = parseProviderResponse(providerResult.data);
    console.log("DATA PROVIDER RESPONSE:", {
      httpStatus: providerResult.status,
      provider: selectedProvider,
      reference: transaction.reference,
      providerResponse,
    });

    const httpSuccess = providerResult.status >= 200 && providerResult.status < 300;
    const providerSignals = getDataProviderSignals(providerResponse);
    const outcome = httpSuccess
      ? providerSignals.contradictory
        ? "UNKNOWN"
        : providerSignals.succeeded
          ? "SUCCESS"
          : providerSignals.failed
            ? "FAILED"
            : "UNKNOWN"
      : "UNKNOWN";
    if (outcome !== "SUCCESS") {
      if (outcome === "FAILED") {
        const refundResult = await refundFailedDataPurchase({
          transactionId: transaction._id,
          providerResponse,
          httpStatus: providerResult.status,
        });
        if (refundResult.status === "REFUNDED") {
          return res.status(400).json({
            success: false,
            message: getProviderMessage(providerResponse),
            reference: transaction.reference,
            status: "REFUNDED",
            walletBalance: refundResult.walletBalance,
            providerResponse,
          });
        }
        if (refundResult.status === "NOT_CLAIMED") {
          const current = refundResult.transaction ||
            await Transaction.findById(transaction._id);
          if (current && current.status !== "PENDING") {
            return returnExisting(current, networkCode, mobileNumber, selectedPlan);
          }
          return pendingResponse(current || transaction, customer.walletBalance);
        }
        // An uncorrelated or contradictory failure signal is not refundable.
        // Leave dispatch in UNKNOWN so a later trusted reconciliation is needed.
        const pending = await Transaction.findById(transaction._id);
        if (!pending || pending.status !== "PENDING") {
          return pending
            ? returnExisting(pending, networkCode, mobileNumber, selectedPlan)
            : pendingResponse(transaction, customer.walletBalance);
        }
      }

      await Transaction.updateOne(
        {
          _id: transaction._id,
          status: "PENDING",
          dispatchStatus: activeDispatchStatus,
        },
        {
          $set: {
            dispatchStatus: "UNKNOWN",
            providerStatus: providerSignals.contradictory
              ? "CONTRADICTORY"
              : getProviderStatus(providerResponse) || "UNKNOWN",
            providerResponse: {
              ...transaction.providerResponse,
              network: networkCode,
              planCode: selectedPlan,
              response: providerResponse,
              httpStatus: providerResult.status,
              outcome: "UNKNOWN",
            },
          },
        },
      );
      const pending = await Transaction.findById(transaction._id);
      if (pending && pending.status !== "PENDING") {
        return returnExisting(pending, networkCode, mobileNumber, selectedPlan);
      }
      return pendingResponse(pending || transaction, customer.walletBalance);
    }

    const successfulTransaction = await Transaction.findOneAndUpdate(
      {
        _id: transaction._id,
        status: "PENDING",
        dispatchStatus: activeDispatchStatus,
      },
      {
        $set: {
          status: "SUCCESSFUL",
          dispatchStatus: "SUCCEEDED",
          providerStatus: getProviderStatus(providerResponse) || "SUCCESS",
          providerReference:
            String(providerResponse.providerReference || providerResponse.requestId || "").trim(),
          providerResponse: {
            ...transaction.providerResponse,
            network: networkCode,
            planCode: selectedPlan,
            response: providerResponse,
          },
        },
      },
      { new: true },
    );
    if (!successfulTransaction) {
      const current = await Transaction.findById(transaction._id);
      if (current?.status === "SUCCESSFUL") {
        return res.status(200).json({
          success: true,
          message: "Data purchase was successful.",
          reference: current.reference,
          status: current.status,
          walletBalance: customer.walletBalance,
          transaction: {
            serviceType: "DATA",
            provider: selectedProvider,
            network: networkCode,
            phone: mobileNumber,
            planCode: selectedPlan,
            amount: dataAmount,
          },
          providerResponse: current.providerResponse?.response || {},
        });
      }
      return pendingResponse(current || transaction, customer.walletBalance);
    }
    transaction = successfulTransaction;

    await runDataSuccessEffects({
      transaction,
      customer,
      networkCode,
      mobileNumber,
      selectedPlan,
    });

    return res.status(200).json({
      success: true,
      message: "Data purchase was successful.",
      reference: transaction.reference,
      status: transaction.status,
      walletBalance: customer.walletBalance,
      transaction: {
        serviceType: "DATA",
        provider: selectedProvider,
        network: networkCode,
        phone: mobileNumber,
        planCode: selectedPlan,
        amount: dataAmount,
      },
      providerResponse,
    });
  } catch (error) {
    console.error("DATA PURCHASE ERROR:", error);
    if (transaction && dispatchClaimed) {
      await Transaction.updateOne(
        {
          _id: transaction._id,
          status: "PENDING",
          dispatchStatus: { $in: ["CLAIMED", "SENDING"] },
        },
        {
          $set: {
            dispatchStatus: "UNKNOWN",
            providerStatus: "UNKNOWN",
            providerResponse: {
              ...transaction.providerResponse,
              network: transaction.providerResponse?.network,
              planCode: transaction.providerResponse?.planCode,
              outcome: "UNKNOWN",
              message: error.message,
            },
          },
        },
      ).catch((persistError) => {
        console.error("DATA PENDING STATE ERROR:", persistError);
      });
      const current = await Transaction.findById(transaction._id);
      if (current && current.status !== "PENDING") {
        return returnExisting(current, current.providerResponse?.network, current.phone, current.providerResponse?.planCode);
      }
      return pendingResponse(transaction, customer?.walletBalance);
    }
    return res.status(500).json({
      success: false,
      message: "Data purchase could not be completed.",
      error: error.message,
    });
  }
};

exports.getDataReconciliationQueue = async (req, res) => {
  try {
    const requestedLimit = Number(req.query?.limit || 50);
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(100, Math.floor(requestedLimit)))
      : 50;
    const transactions = await Transaction.find({
      serviceType: "DATA",
      provider: { $in: ["CLUBKONNECT", "TELECOM_ABODE"] },
      status: "PENDING",
      dispatchStatus: { $in: ["READY", "CLAIMED", "SENDING", "UNKNOWN", "FAILED"] },
    })
      .sort({ createdAt: 1, _id: 1 })
      .limit(limit)
      .select("_id reference customerId phone amount provider providerRequestId providerResponse providerStatus dispatchStatus dispatchClaimedAt createdAt")
      .lean();

    return res.status(200).json({
      success: true,
      data: transactions.map((transaction) => ({
        id: transaction._id,
        reference: transaction.reference,
        provider: transaction.provider,
        providerRequestId: transaction.providerRequestId || "",
        customerId: transaction.customerId,
        phone: transaction.phone,
        amount: transaction.amount,
        network: transaction.providerResponse?.network || null,
        planCode: transaction.providerResponse?.planCode || null,
        providerStatus: transaction.providerStatus || "UNKNOWN",
        providerMessage: String(
          readObjectField(
            transaction.providerResponse?.response || transaction.providerResponse,
            ["message", "response_description", "responseDescription"],
          ) || transaction.providerResponse?.message || "",
        ).slice(0, 500),
        dispatchStatus: transaction.dispatchStatus,
        dispatchClaimedAt: transaction.dispatchClaimedAt || null,
        createdAt: transaction.createdAt,
        reconciliationRequired: true,
      })),
    });
  } catch (error) {
    console.error("DATA RECONCILIATION QUEUE ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load the data reconciliation queue.",
    });
  }
};
