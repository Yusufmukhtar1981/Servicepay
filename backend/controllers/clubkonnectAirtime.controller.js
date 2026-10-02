const Transaction = require("../models/transaction.model");
const User = require("../models/user.model");
const crypto = require("node:crypto");
const {
  getServiceConfig,
  isAvailable,
} = require("../services/providerManagement.service");
const {
  createClubkonnectAirtimeLifecycleService,
  validateRequestKeyPattern,
} = require("../services/clubkonnectAirtimeLifecycle.service");
const {
  createClubkonnectAirtimeProviderService,
} = require("../services/clubkonnectAirtimeProvider.service");

const lifecycle = createClubkonnectAirtimeLifecycleService();

const respondWithTransaction = async (res, transaction) => {
  if (!transaction) {
    return res.status(503).json({
      success: false,
      code: "AIRTIME_STATUS_UNAVAILABLE",
      message: "The Airtime result could not be confirmed. Keep the same request key.",
    });
  }
  if (transaction.status === "SUCCESSFUL" &&
      transaction.providerResponse?.airtimeCommissionRecovery?.status !== "COMPLETE" &&
      typeof transaction.providerResponse?.airtimeLifecycle?.amountCharged === "number") {
    // A verified invoice is available: attempt the recoverable, atomic effect
    // now rather than making the customer wait for the bounded worker.
    await lifecycle.processCommissionEffect(transaction._id);
    transaction = await Transaction.findById(transaction._id);
  }
  const customer = await User.findById(transaction.customerId).select("walletBalance").lean();
  const successful = transaction.status === "SUCCESSFUL";
  const failed = ["FAILED", "REFUNDED"].includes(transaction.status);
  const metadata = transaction.providerResponse?.airtimeLifecycle || {};
  const effect = transaction.providerResponse?.airtimeCommissionRecovery;
  // HTTP 200 confirms a processed request, not business success. A bound FAILED
  // result must be distinguishable from unbound/intermediary HTTP errors.
  return res.status(successful || failed ? 200 : 202).json({
    success: successful,
    pending: !successful && !failed,
    message: successful
      ? "Airtime purchase was successful."
      : failed
        ? "The provider confirmed failure. Your wallet was refunded once."
        : "The Airtime result is awaiting confirmation. Do not make another purchase for this request.",
    reference: transaction.reference,
    requestId: transaction.providerRequestId,
    status: transaction.status,
    dispatchStatus: transaction.dispatchStatus,
    walletBalance: customer?.walletBalance,
    accountingStatus: effect?.status || (successful ? "PENDING" : "NOT_DUE"),
    transaction: {
      serviceType: "AIRTIME",
      phone: transaction.phone,
      amount: transaction.amount,
      network: metadata.network,
    },
    // Never expose axios errors, authenticated query URLs, or provider credentials.
    providerResponse: {
      httpStatus: metadata.httpStatus,
      status: metadata.orderStatus,
      statusCode: metadata.statusCode,
      orderId: transaction.providerReference || metadata.orderId,
      amountCharged: metadata.amountCharged,
    },
  });
};

exports.buyAirtime = async (req, res) => {
  try {
    const config = await getServiceConfig("AIRTIME");
    const enabled = config.providerStates?.find(p => p.provider === "CLUBKONNECT")?.enabled;
    if (config.primaryProvider !== "CLUBKONNECT" || enabled !== true ||
        !isAvailable("AIRTIME", "CLUBKONNECT")) {
      return res.status(503).json({
        success: false,
        code: "AIRTIME_PROVIDER_UNAVAILABLE",
        message: "The configured Airtime provider is unavailable.",
      });
    }
    const result = await lifecycle.executePurchase({
      customerId: req.user._id,
      network: req.body.network,
      phone: req.body.phone,
      amount: req.body.amount,
      idempotencyKey: req.get?.("Idempotency-Key") || req.get?.("X-Idempotency-Key") ||
        req.headers?.["idempotency-key"] || req.headers?.["x-idempotency-key"] ||
        req.body.idempotencyKey,
    });
    return await respondWithTransaction(res, result.transaction);
  } catch (error) {
    const known = typeof error.code === "string" && error.code.startsWith("AIRTIME_");
    const status = known && Number.isInteger(error.status) ? error.status : 503;
    console.error("AIRTIME REQUEST DEFERRED:", { code: known ? error.code : "AIRTIME_RESULT_UNCERTAIN" });
    return res.status(status).json({
      success: false,
      code: known ? error.code : "AIRTIME_RESULT_UNCERTAIN",
      message: known && status < 500
        ? error.message
        : "The Airtime result could not be confirmed. Keep the same request key and do not submit a new purchase.",
    });
  }
};

exports.requeryAirtime = async (req, res) => {
  try {
    // Reconciliation is not gated by a purchase pause. It never resends a purchase.
    let identity;
    if (req.params.reference) {
      identity = { reference: req.params.reference };
    } else {
      const key = req.body?.idempotencyKey;
      if (!validateRequestKeyPattern(key)) {
        return res.status(400).json({ success: false, message: "A valid Airtime request key is required." });
      }
      identity = { idempotencyKey: crypto.createHash("sha256").update(key).digest("hex") };
    }
    const transaction = await Transaction.findOne({
      ...identity,
      customerId: req.user._id,
      serviceType: "AIRTIME",
      provider: "CLUBKONNECT",
      "providerResponse.airtimeLifecycle.version": 1,
    });
    if (!transaction) {
      return res.status(404).json({ success: false, message: "Airtime transaction was not found." });
    }
    const accountingComplete = transaction.providerResponse?.airtimeCommissionRecovery?.status === "COMPLETE";
    if (transaction.status !== "PENDING" &&
        (transaction.status !== "SUCCESSFUL" || accountingComplete)) {
      return respondWithTransaction(res, transaction);
    }
    const result = await lifecycle.reconcilePendingPurchase({ transactionId: transaction._id });
    return respondWithTransaction(res, result?.transaction || result ||
      await Transaction.findById(transaction._id));
  } catch (_error) {
    return res.status(503).json({
      success: false,
      code: "AIRTIME_RECONCILIATION_UNAVAILABLE",
      message: "The provider result is not confirmed. No purchase was resent and no refund was inferred.",
    });
  }
};

exports.lifecycle = lifecycle;

exports.readHistoricalProviderEvidence = async (req, res) => {
  try {
    // An operational audit read, not reconciliation. This deliberately never
    // calls lifecycle settlement or modifies legacy financial records.
    const transaction = await Transaction.findOne({
      _id: req.params.transactionId,
      serviceType: "AIRTIME",
      provider: "CLUBKONNECT",
      status: "SUCCESSFUL",
    }).lean();
    if (!transaction) return res.status(404).json({ success: false, message: "Airtime order was not found." });
    const storedOrder = transaction.providerReference || transaction.providerResponse?.orderid ||
      transaction.providerResponse?.OrderID || transaction.providerResponse?.orderId;
    const orderId = typeof storedOrder === "string" || typeof storedOrder === "number"
      ? String(storedOrder).trim() : "";
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(orderId)) {
      return res.status(409).json({ success: false, message: "No verified stored provider order ID is available." });
    }
    const provider = createClubkonnectAirtimeProviderService();
    const evidence = await provider.query({
      requestId: transaction.providerRequestId || transaction.reference,
      orderId,
    });
    return res.json({
      success: true,
      provider: "CLUBKONNECT",
      readOnly: true,
      providerHttpStatus: evidence.httpStatus,
      outcome: evidence.outcome,
      authoritative: evidence.authoritative === true,
      providerEvidence: evidence.body || evidence.evidence,
      providerCost: evidence.providerCost,
      customerCharge: transaction.amount,
      purchaseRequests: 0,
      financialMutations: 0,
    });
  } catch (_error) {
    return res.status(503).json({
      success: false,
      readOnly: true,
      message: "The authenticated provider status query could not be verified.",
      financialMutations: 0,
    });
  }
};