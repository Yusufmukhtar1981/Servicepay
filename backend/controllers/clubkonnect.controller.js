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
const {
  getCatalog,
  getPricedCatalog,
} = require("../services/telecomAbodeDataCatalog.service");
const { distributeCommission } = require("../services/commission.service");
const {
  reconcileReferralReward,
  enqueueReferralRewardEvent,
} = require("../services/referralReward.service");
const {
  getServiceConfig,
  isAvailable,
} = require("../services/providerManagement.service");
const telecomAbode = require("../services/telecomAbode.service");
const {
  settleTelecomAbodeDataOutcome,
} = require("../services/telecomAbodeDataSettlement.service");
const {
  issueDataPlanQuote,
  verifyDataPlanQuote,
} = require("../services/dataPlanQuote.service");
const {
  processTelecomAbodeDataCommissionEffect,
  safeErrorCode: safeTelecomAbodeEffectErrorCode,
} = require("../services/telecomAbodeDataCommissionRecovery.service");

const AIRTIME_URL = "https://www.nellobytesystems.com/APIAirtimeV1.asp";

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

const safeDataErrorCode = (error, fallback = "DATA_ERROR") =>
  typeof error?.code === "string"
    ? error.code.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || fallback
    : fallback;

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

    const plans = await getPricedCatalog(networkCode);

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
      plans: plans.map((plan) => ({
        id: plan.code,
        code: plan.code,
        name: plan.name,
        price: plan.sellingPrice,
        sellingPrice: plan.sellingPrice,
        planProvider: "TELECOM_ABODE",
        ...(process.env.JWT_SECRET
          ? {
              productQuote: issueDataPlanQuote({
                customerId: req.user._id,
                provider: "TELECOM_ABODE",
                network: networkCode,
                plan: {
                  code: plan.code,
                  name: plan.name,
                  networkId: plan.providerNetworkId,
                  providerPlanId: plan.providerPlanId,
                },
                price: plan.sellingPrice,
              }),
            }
          : {}),
      })),
    });
  } catch (error) {
    console.error("GET DATA PLANS ERROR:", {
      code: safeDataErrorCode(error, "DATA_CATALOG_ERROR"),
    });

    return res.status(503).json({
      success: false,
      message: "Data plans are currently unavailable.",
    });
  }
};


exports.buyAirtime = require("./clubkonnectAirtime.controller").buyAirtime;

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
    "providerMessage",
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

const runDataReferralSuccessEffect = async ({ transaction, customer }) => {
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
    console.error("DATA REFERRAL RECONCILIATION ERROR:", {
      code: safeDataErrorCode(rewardError, "REFERRAL_RECONCILIATION_ERROR"),
    });
  }
};

const runDataSuccessEffects = async ({
  transaction,
  customer,
  networkCode,
  mobileNumber,
  selectedPlan,
}) => {
  await runDataReferralSuccessEffect({ transaction, customer });
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
    console.log("DATA COMMISSION RECONCILED:", { succeeded: Boolean(commissionResult) });
  } catch (commissionError) {
    console.error("DATA COMMISSION ERROR:", {
      code: safeDataErrorCode(commissionError, "DATA_COMMISSION_ERROR"),
    });
  }
};

const runTelecomAbodeSuccessEffectsOnce = async ({
  transaction,
  customer,
  networkCode,
  mobileNumber,
  selectedPlan,
}) => {
  try {
    const commissionEffect = await processTelecomAbodeDataCommissionEffect(
      transaction._id,
    );
    if (["RETRY_PENDING", "BLOCKED"].includes(commissionEffect?.status)) {
      console.error("TELECOM ABODE DATA COMMISSION EFFECT DEFERRED:", {
        code: commissionEffect.errorCode || "DATA_COMMISSION_EFFECT_DEFERRED",
      });
    }
  } catch (error) {
    console.error("TELECOM ABODE DATA COMMISSION EFFECT DEFERRED:", {
      code: safeTelecomAbodeEffectErrorCode(error),
    });
  }

  const claimed = await Transaction.findOneAndUpdate(
    {
      _id: transaction._id,
      provider: "TELECOM_ABODE",
      serviceType: "DATA",
      status: "SUCCESSFUL",
      "providerResponse.dataSuccessEffectsStarted": { $ne: true },
    },
    { $set: { "providerResponse.dataSuccessEffectsStarted": true } },
    { new: true },
  ).lean();
  if (!claimed) return false;
  await runDataReferralSuccessEffect({
    transaction: claimed,
    customer,
  });
  return true;
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
    requestedAmount,
  ) => {
    const original = existing.providerResponse || {};
    const frozenProvider = String(existing.provider || original.provider || "CLUBKONNECT").toUpperCase();
    if (
      existing.phone !== mobileNumber ||
      String(original.network || "") !== String(networkCode) ||
      String(original.planCode || "") !== String(selectedPlan) ||
      (requestedPlanProvider && requestedPlanProvider !== frozenProvider) ||
      (requestedQuote !== null && requestedQuote !== undefined &&
        Number(original.quotedPrice) !== requestedQuote) ||
      (requestedAmount !== null && requestedAmount !== undefined &&
        Number(existing.amount) !== requestedAmount)
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
    if (existing.status === "FAILED" && frozenProvider === "TELECOM_ABODE") {
      const currentCustomer = await User.findById(existing.customerId)
        .select("walletBalance")
        .lean();
      return res.status(422).json({
        success: false,
        message: "The provider reported failure. The wallet debit is held for manual review; do not retry.",
        reference: existing.reference,
        status: "FAILED",
        walletDebitHeld: true,
        walletBalance: currentCustomer?.walletBalance || 0,
      });
    }
    return pendingResponse(existing);
  };

  try {
    const { network, phone, planCode, dataPlan } = req.body;
    const rawPlanOverrideFields = [
      "providerPlanId",
      "provider_plan_id",
      "plan_id",
      "plan",
      "networkId",
      "network_id",
      "providerNetworkId",
      "provider_network_id",
      "data_plan",
      "dataPlanId",
      "data_plan_id",
      "providerPlan",
      "provider_plan",
      "providerNetwork",
      "provider_network",
    ];
    if (rawPlanOverrideFields.some((field) =>
      Object.prototype.hasOwnProperty.call(req.body, field))) {
      return res.status(400).json({
        success: false,
        message: "Provider-specific plan and network IDs are not accepted; use the ServicePay plan code.",
      });
    }
    const networkCode = normalizeNetwork(network);
    const mobileNumber = normalizePhone(phone);
    const selectedPlan = String(planCode || dataPlan || "").trim();
    const requestedPlanProvider = String(req.body.planProvider || "").trim().toUpperCase();
    const productQuote = req.body.productQuote;
    const hasProductQuote = Object.prototype.hasOwnProperty.call(req.body, "productQuote");
    const requestedQuoteValue = req.body.quotedPrice;
    const requestedAmountValue = req.body.amount;
    const requestedAmount =
      requestedAmountValue === undefined || requestedAmountValue === null || requestedAmountValue === ""
        ? null
        : typeof requestedAmountValue === "number" ||
            (typeof requestedAmountValue === "string" && /^[0-9]+(?:\.[0-9]+)?$/.test(requestedAmountValue.trim()))
          ? Number(requestedAmountValue)
          : NaN;
    const requestedQuote =
      requestedQuoteValue === undefined || requestedQuoteValue === null || requestedQuoteValue === ""
        ? null
        : typeof requestedQuoteValue === "number" ||
            (typeof requestedQuoteValue === "string" && /^[0-9]+(?:\.[0-9]+)?$/.test(requestedQuoteValue.trim()))
          ? Number(requestedQuoteValue)
          : NaN;
    const keyCandidates = [
      req.headers?.["x-idempotency-key"],
      req.headers?.["idempotency-key"],
      req.get?.("X-Idempotency-Key"),
      req.get?.("Idempotency-Key"),
      req.body.idempotencyKey,
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    const uniqueKeys = [...new Set(keyCandidates)];
    if (uniqueKeys.length > 1) {
      console.warn("[DATA_ADMISSION] IDEMPOTENCY_KEY_CONFLICT");
      return res.status(400).json({
        success: false,
        code: "IDEMPOTENCY_KEY_CONFLICT",
        message: "Unable to complete your data purchase. Please try again.",
      });
    }
    const idempotencyKey = uniqueKeys[0] || "";

    if (!idempotencyKey || idempotencyKey.length > 128) {
      const code = idempotencyKey ? "INVALID_IDEMPOTENCY_KEY" : "IDEMPOTENCY_KEY_REQUIRED";
      console.warn(`[DATA_ADMISSION] ${code}`);
      return res.status(400).json({
        success: false,
        code,
        message: "Unable to complete your data purchase. Please try again.",
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
        requestedAmount,
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
    if (selectedProvider !== "TELECOM_ABODE") {
      return res.status(503).json({
        success: false,
        message: "DATA purchases require the Telecom Abode provider.",
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
    if (
      !hasProductQuote ||
      typeof productQuote !== "string" ||
      !productQuote.trim() ||
      !process.env.JWT_SECRET
    ) {
      return res.status(409).json({
        success: false,
        message: "The selected Data plan requires a valid signed quote. Refresh the plans before purchasing.",
      });
    }
    const catalogPlan = (await getCatalog(networkCode)).find(
      (plan) => plan.code === selectedPlan,
    );
    if (!catalogPlan) {
      return res.status(400).json({
        success: false,
        message: "The selected data plan is no longer available. Please refresh and try again.",
      });
    }

    const providerPlan = {
      ...catalogPlan,
      id: catalogPlan.providerPlanId,
      networkId: catalogPlan.providerNetworkId,
    };
    const providerPrice = Number(catalogPlan.price);
    const override = await DataPriceOverride.findOne({
      networkCode,
      planCode: catalogPlan.pricingCode || selectedPlan,
      active: true,
    }).lean();
    const dataAmount = Number(override?.sellingPrice);
    if (!Number.isFinite(dataAmount) || dataAmount <= 0) {
      return res.status(409).json({
        success: false,
        message: "This Data plan has no active ServicePay selling price.",
      });
    }
    if (!verifyDataPlanQuote(productQuote, {
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
    if (
      requestedQuote !== null &&
      (!Number.isFinite(requestedQuote) || requestedQuote !== dataAmount)
    ) {
      return res.status(409).json({
        success: false,
        message: "The quoted data plan price no longer matches the current server price.",
      });
    }
    if (req.body.amount !== undefined && Number(req.body.amount) !== dataAmount) {
      return res.status(409).json({
        success: false,
        message: "The supplied Data amount does not match the current ServicePay selling price.",
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
    let admissionPriceChanged = false;
    try {
      await session.withTransaction(async () => {
        admissionPriceChanged = false;
        const currentPrice = await DataPriceOverride.findOneAndUpdate({
          networkCode,
          planCode: catalogPlan.pricingCode || selectedPlan,
          active: true,
          sellingPrice: dataAmount,
        }, {
          $inc: { pricingVersion: 1 },
        }, {
          new: true,
          session,
          timestamps: false,
        }).lean();
        if (!currentPrice) {
          admissionPriceChanged = true;
          return;
        }
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
              providerNetworkId: providerPlan.networkId,
              providerPlanId: Number(providerPlan.id),
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
            requestedAmount,
          );
        }
      }
      throw admissionError;
    } finally {
      await session.endSession();
    }

    if (admissionPriceChanged) {
      return res.status(409).json({
        success: false,
        message: "The ServicePay selling price changed. Refresh the Data plans.",
      });
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
    const activeDispatchStatus = "SENDING";

    let providerResult;
    try {
      providerResult = {
        data: await telecomAbode.purchaseData({
          network: providerPlan.networkId,
          phone: mobileNumber,
          plan: Number(providerPlan.id),
          request_id: transaction.providerRequestId,
          transactionId: transaction._id,
        }),
      };
      providerResult.status = providerResult.data.httpStatus || 200;
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
              message: selectedProvider === "TELECOM_ABODE"
                ? "Provider request outcome is unresolved."
                : String(providerError.message || "Provider request outcome is unresolved.").slice(0, 320),
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
        if (
          selectedProvider === "TELECOM_ABODE" &&
          pending.status === "SUCCESSFUL" &&
          pending.providerResponse?.telecomAbodeSettlement?.source === "TELECOM_ABODE_WEBHOOK"
        ) {
          await runTelecomAbodeSuccessEffectsOnce({
            transaction: pending,
            customer,
            networkCode,
            mobileNumber,
            selectedPlan,
          });
        }
        return returnExisting(pending, networkCode, mobileNumber, selectedPlan);
      }
      return pendingResponse(pending || transaction, customer.walletBalance);
    }

    const providerResponse = parseProviderResponse(providerResult.data);
    console.log("DATA PROVIDER RESPONSE:", {
      httpStatus: providerResult.status,
      provider: selectedProvider,
      providerStatus: typeof providerResponse.status === "string"
        ? providerResponse.status.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 24)
        : "UNKNOWN",
    });

    const httpSuccess = providerResult.status >= 200 && providerResult.status < 300 &&
      providerResult.status !== 202;
    const providerSignals = getDataProviderSignals(providerResponse);
    const outcome = selectedProvider === "TELECOM_ABODE"
      ? (httpSuccess ||
          (providerResult.status === 422 && providerResponse.status === "FAILED")) &&
        providerResponse.documentedDataStatus === true &&
        providerResponse.service === "data" &&
        providerResponse.requestId === transaction.providerRequestId &&
        providerResponse.contradictory !== true &&
        !providerSignals.contradictory &&
        ["SUCCESS", "FAILED"].includes(providerResponse.status)
        ? providerResponse.status
        : "UNKNOWN"
      : httpSuccess
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
        if (selectedProvider === "TELECOM_ABODE") {
          const settlement = await settleTelecomAbodeDataOutcome({
            requestId: providerResponse.requestId,
            outcome: "FAILED",
            source: "REQUEST",
            evidence: {
              requestId: providerResponse.requestId,
              service: providerResponse.service,
              documentedDataStatus: providerResponse.documentedDataStatus,
              providerStatus: providerResponse.rawProviderStatus || providerResponse.status,
              amount: providerResponse.amount,
              httpStatus: providerResult.status,
            },
          });
          if (settlement.status === "REFUNDED") {
            return res.status(422).json({
              success: false,
              message: "The provider reported failure and the wallet debit was refunded.",
              reference: settlement.transaction.reference,
              status: "FAILED",
              walletDebitHeld: false,
              walletBalance: settlement.walletBalance,
            });
          }
          const current = await Transaction.findById(transaction._id);
          if (current && current.status !== "PENDING") {
            if (
              current.status === "SUCCESSFUL" &&
              current.providerResponse?.telecomAbodeSettlement?.source === "TELECOM_ABODE_WEBHOOK"
            ) {
              await runTelecomAbodeSuccessEffectsOnce({
                transaction: current,
                customer,
                networkCode,
                mobileNumber,
                selectedPlan,
              });
            }
            return returnExisting(current, networkCode, mobileNumber, selectedPlan);
          }
          await Transaction.updateOne(
            {
              _id: transaction._id,
              status: "PENDING",
              dispatchStatus: "SENDING",
            },
            {
              $set: {
                dispatchStatus: "UNKNOWN",
                providerStatus: settlement.status === "AMOUNT_MISMATCH"
                  ? "AMOUNT_MISMATCH"
                  : "UNKNOWN",
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
          return pendingResponse(pending || transaction, customer.walletBalance);
        }
        const failed = await Transaction.findOneAndUpdate(
          {
            _id: transaction._id,
            status: "PENDING",
            dispatchStatus: activeDispatchStatus,
          },
          {
            $set: {
              status: "FAILED",
              dispatchStatus: "FAILED",
              providerStatus: "FAILED",
              providerReference: transaction.providerRequestId,
              providerResponse: {
                ...transaction.providerResponse,
                network: networkCode,
                planCode: selectedPlan,
                response: providerResponse,
                httpStatus: providerResult.status,
                outcome: "FAILED",
                refundStatus: "NOT_AUTOMATED",
              },
            },
          },
          { new: true },
        );
        if (!failed) {
          const current = await Transaction.findById(transaction._id);
          return current
            ? returnExisting(current, networkCode, mobileNumber, selectedPlan)
            : pendingResponse(transaction, customer.walletBalance);
        }
        return res.status(422).json({
          success: false,
          message: "The provider reported failure. The wallet debit is held for manual review; do not retry.",
          reference: failed.reference,
          status: "FAILED",
          walletDebitHeld: true,
          walletBalance: customer.walletBalance,
        });
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
        if (
          selectedProvider === "TELECOM_ABODE" &&
          pending.status === "SUCCESSFUL" &&
          pending.providerResponse?.telecomAbodeSettlement?.source === "TELECOM_ABODE_WEBHOOK"
        ) {
          await runTelecomAbodeSuccessEffectsOnce({
            transaction: pending,
            customer,
            networkCode,
            mobileNumber,
            selectedPlan,
          });
        }
        return returnExisting(pending, networkCode, mobileNumber, selectedPlan);
      }
      return pendingResponse(pending || transaction, customer.walletBalance);
    }

    let successfulTransaction;
    if (selectedProvider === "TELECOM_ABODE") {
      const settlement = await settleTelecomAbodeDataOutcome({
        requestId: providerResponse.requestId,
        outcome: "SUCCESS",
        source: "REQUEST",
        evidence: {
          requestId: providerResponse.requestId,
          service: providerResponse.service,
          documentedDataStatus: providerResponse.documentedDataStatus,
          providerStatus: providerResponse.rawProviderStatus || providerResponse.status,
          amount: providerResponse.amount,
          httpStatus: providerResult.status,
        },
      });
      if (settlement.status === "SETTLED") {
        successfulTransaction = settlement.transaction;
      } else if (settlement.status === "ALREADY_TERMINAL") {
        const current = settlement.transaction;
        if (current?.status === "SUCCESSFUL") {
          successfulTransaction = current;
          if (
            current.providerResponse?.telecomAbodeSettlement?.source === "TELECOM_ABODE_WEBHOOK"
          ) {
            await runTelecomAbodeSuccessEffectsOnce({
              transaction: current,
              customer,
              networkCode,
              mobileNumber,
              selectedPlan,
            });
          }
        } else if (current) {
          return returnExisting(current, networkCode, mobileNumber, selectedPlan);
        }
      }
      if (!successfulTransaction) {
        await Transaction.updateOne(
          {
            _id: transaction._id,
            status: "PENDING",
            dispatchStatus: "SENDING",
          },
          {
            $set: {
              dispatchStatus: "UNKNOWN",
              providerStatus: settlement.status === "AMOUNT_MISMATCH"
                ? "AMOUNT_MISMATCH"
                : "UNKNOWN",
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
        if (pending?.status && pending.status !== "PENDING") {
          return returnExisting(pending, networkCode, mobileNumber, selectedPlan);
        }
        return pendingResponse(pending || transaction, customer.walletBalance);
      }
    } else {
      successfulTransaction = await Transaction.findOneAndUpdate(
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
    }
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

    if (selectedProvider === "TELECOM_ABODE") {
      await runTelecomAbodeSuccessEffectsOnce({
        transaction,
        customer,
        networkCode,
        mobileNumber,
        selectedPlan,
      });
    } else {
      await runDataSuccessEffects({
        transaction,
        customer,
        networkCode,
        mobileNumber,
        selectedPlan,
      });
    }

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
    console.error("DATA PURCHASE ERROR:", {
      code: safeDataErrorCode(error, "DATA_PURCHASE_ERROR"),
      statusCode: Number.isInteger(error?.statusCode) ? error.statusCode : undefined,
    });
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
              message: "Provider request outcome is unresolved.",
            },
          },
        },
      ).catch((persistError) => {
        console.error("DATA PENDING STATE ERROR:", {
          code: safeDataErrorCode(persistError, "DATA_PENDING_STATE_ERROR"),
        });
      });
      const current = await Transaction.findById(transaction._id);
      if (current && current.status !== "PENDING") {
        if (
          current.provider === "TELECOM_ABODE" &&
          current.status === "SUCCESSFUL" &&
          current.providerResponse?.telecomAbodeSettlement?.source === "TELECOM_ABODE_WEBHOOK"
        ) {
          await runTelecomAbodeSuccessEffectsOnce({
            transaction: current,
            customer,
            networkCode: current.providerResponse?.network,
            mobileNumber: current.phone,
            selectedPlan: current.providerResponse?.planCode,
          });
        }
        return returnExisting(current, current.providerResponse?.network, current.phone, current.providerResponse?.planCode);
      }
      return pendingResponse(transaction, customer?.walletBalance);
    }
    return res.status(500).json({
      success: false,
      message: "Data purchase could not be completed.",
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
      $or: [
        {
          status: "PENDING",
          dispatchStatus: { $in: ["READY", "CLAIMED", "SENDING", "UNKNOWN", "FAILED"] },
        },
        {
          provider: "TELECOM_ABODE",
          status: "FAILED",
          dispatchStatus: "FAILED",
          debitLedgerEntryId: { $ne: null },
          reversalLedgerEntryId: null,
        },
      ],
    })
      .sort({ createdAt: 1, _id: 1 })
      .limit(limit)
      .select("_id reference customerId phone amount provider providerRequestId providerResponse providerStatus status dispatchStatus dispatchClaimedAt debitLedgerEntryId createdAt")
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
        status: transaction.status,
        walletDebitHeld: transaction.provider === "TELECOM_ABODE" &&
          transaction.status === "FAILED" && transaction.dispatchStatus === "FAILED" &&
          Boolean(transaction.debitLedgerEntryId),
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
    console.error("DATA RECONCILIATION QUEUE ERROR:", {
      code: safeDataErrorCode(error, "DATA_RECONCILIATION_QUEUE_ERROR"),
    });
    return res.status(500).json({
      success: false,
      message: "Unable to load the data reconciliation queue.",
    });
  }
};
