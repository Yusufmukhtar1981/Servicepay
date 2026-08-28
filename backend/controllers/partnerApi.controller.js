const axios = require("axios");
const crypto = require("crypto");
const mongoose = require("mongoose");

const Partner = require("../models/partner.model");
const PartnerTransaction = require("../models/partnerTransaction.model");
const PartnerAuditLog = require("../models/partnerAuditLog.model");
const DataPriceOverride = require("../models/dataPriceOverride.model");
const { hasPartnerPermission } = require("../middleware/partnerAuth.middleware");

const AIRTIME_URL = "https://www.nellobytesystems.com/APIAirtimeV1.asp";
const DATA_URL = "https://www.nellobytesystems.com/APIDatabundleV1.asp";
const DATA_PLANS_URL = "https://www.nellobytesystems.com/APIDatabundlePlansV2.asp";
const STATUS_QUERY_URL = "https://www.nellobytesystems.com/APIQueryV1.asp";
const PROVIDER_NAME = "CLUBKONNECT";
const IN_FLIGHT_STATUSES = ["PENDING", "PROCESSING"];
const RECONCILIATION_STATUSES = ["REQUERY_REQUIRED"];
const PROVIDER_FAILURE_WORDS = [
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
// APIQueryV1 has a different vocabulary from the purchase endpoints.  Do not
// infer delivery from a message here: a debit is retained until an explicit
// ClubKonnect terminal result is returned.

const NETWORK_CODES = {
  MTN: "01",
  "01": "01",
  GLO: "02",
  "02": "02",
  "9MOBILE": "03",
  ETISALAT: "03",
  "03": "03",
  AIRTEL: "04",
  "04": "04",
};

const makeReference = (service) =>
  `SPP-${service}-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

const credentials = () => {
  const userId = String(process.env.CLUBKONNECT_USER_ID || "").trim();
  const apiKey = String(process.env.CLUBKONNECT_API_KEY || "").trim();
  return { userId, apiKey, valid: Boolean(userId && apiKey) };
};

const normalizeNetwork = (network) =>
  NETWORK_CODES[
    String(network || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
  ] || null;

const normalizePhone = (phone) => {
  let value = String(phone || "").replace(/\D/g, "");
  if (value.startsWith("234") && value.length === 13) value = `0${value.slice(3)}`;
  return value;
};

const parseProviderResponse = (data) => {
  if (data && typeof data === "object") return data;
  const text = String(data || "").trim();
  try {
    return JSON.parse(text);
  } catch (_) {
    return { message: text };
  }
};

const field = (data, names) => {
  const normalized = Object.fromEntries(
    Object.entries(data || {}).map(([key, value]) => [
      key.toLowerCase().replace(/[^a-z0-9]/g, ""),
      value,
    ])
  );
  for (const name of names) {
    const value = normalized[name.toLowerCase().replace(/[^a-z0-9]/g, "")];
    if (value !== undefined && value !== null && String(value).trim()) return value;
  }
  return "";
};

const providerMessage = (data) =>
  String(field(data, ["message", "response_description", "status", "response"]) || "The provider could not complete this request.")
    .trim()
    .slice(0, 250);

const providerStatus = (data) =>
  String(field(data, ["status", "response_description", "response", "message"]))
    .trim()
    .toUpperCase();

const providerSucceeded = (data) => {
  const status = providerStatus(data);
  return [
    "SUCCESS",
    "SUCCESSFUL",
    "TRANSACTION SUCCESSFUL",
    "APPROVED",
    "COMPLETED",
    "0",
  ].includes(status) || status.includes("SUCCESS");
};

const providerFailed = (data) => {
  const status = providerStatus(data);
  return Boolean(status) && PROVIDER_FAILURE_WORDS.some((word) => status.includes(word));
};

const providerOutcome = (data, httpStatus) => {
  if (httpStatus >= 200 && httpStatus < 300 && providerSucceeded(data)) return "SUCCESS";
  if (providerFailed(data) && httpStatus >= 200 && httpStatus < 500) return "FAILED";
  return "UNKNOWN";
};

const queryOutcome = (data, httpStatus) => {
  if (httpStatus < 200 || httpStatus >= 300 || !data || typeof data !== "object") return "UNKNOWN";
  const status = String(field(data, ["orderstatus", "order_status", "status"])).trim().toUpperCase().replace(/\s+/g, "_");
  const code = String(field(data, ["statuscode", "status_code", "response_code", "responsecode", "code"])).trim();
  // APIQueryV1 explicitly establishes completion only with this pair. HTTP
  // success, messages, and generic "success" fields are not delivery proof.
  if (code === "200" && status === "ORDER_COMPLETED") return "SUCCESS";
  // A 500-series cancellation is the only documented refund-safe outcome.
  if (/^5\d\d$/.test(code) && ["ORDER_CANCELLED", "ORDER_CANCELED"].includes(status)) return "FAILED";
  // ORDER_ONHOLD, pending, processing, retry and all unrecognised replies are
  // deliberately unresolved.
  return "UNKNOWN";
};

const providerOrderId = (data) =>
  String(field(data, ["orderid", "order_id", "order_id_no", "transaction_id", "transactionid"]) || "").trim().slice(0, 250);

const providerRequestId = (data) =>
  String(field(data, ["requestid", "request_id", "requestreference", "request_reference"]) || "").trim().slice(0, 250);

const sanitizeProviderPayload = (value, depth = 0) => {
  if (depth > 4 || value === null || value === undefined) return value ?? null;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeProviderPayload(item, depth + 1));
  if (typeof value !== "object") return String(value).slice(0, 1000);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !/(api.?key|secret|password|token|authorization|user.?id)/i.test(key))
      .slice(0, 100)
      .map(([key, item]) => [key, sanitizeProviderPayload(item, depth + 1)])
  );
};

const isInFlight = (transaction) =>
  IN_FLIGHT_STATUSES.includes(String(transaction?.status || "").toUpperCase());

const isReconciliationEligible = (transaction) =>
  RECONCILIATION_STATUSES.includes(String(transaction?.status || "").toUpperCase());

const responseTransaction = (transaction) => ({
  reference: transaction.reference,
  requestReference: transaction.externalReference,
  service: transaction.service,
  amount: Number(transaction.amount || 0),
  status: transaction.status,
  provider: transaction.provider || PROVIDER_NAME,
  providerReference: transaction.providerReference || "",
  createdAt: transaction.createdAt,
  completedAt: transaction.completedAt || null,
  walletBefore: Number(transaction.walletBefore || 0),
  walletAfter: Number(transaction.walletAfter || 0),
  walletDebitStatus: transaction.walletDebitStatus || "DEBITED",
  lastRequeryAt: transaction.lastRequeryAt || null,
  requeryCount: Number(transaction.requeryCount || 0),
  uncertaintyReason: transaction.uncertaintyReason || "",
  resolvedAt: transaction.resolvedAt || null,
  resolutionSource: transaction.resolutionSource || null,
});

const dayKey = () => new Date().toISOString().slice(0, 10);

const transactionDebitDay = (transaction) =>
  String(
    transaction.dailySpentDateAtRequest ||
    (transaction.createdAt ? new Date(transaction.createdAt).toISOString().slice(0, 10) : "")
  );

const idempotencyKey = (req) =>
  String(
    req.headers["idempotency-key"] ||
      req.headers["x-idempotency-key"] ||
      req.body?.idempotencyKey ||
      req.body?.reference ||
      ""
  ).trim();

const fetchDataPlans = async (networkCode, providerCredentials) => {
  const response = await axios.get(DATA_PLANS_URL, {
    params: {
      UserID: providerCredentials.userId,
      APIKey: providerCredentials.apiKey,
      MobileNetwork: networkCode,
    },
    timeout: 45000,
    validateStatus: () => true,
  });
  if (response.status < 200 || response.status >= 300) {
    const error = new Error("Data plans are currently unavailable.");
    error.statusCode = 503;
    throw error;
  }
  const payload = parseProviderResponse(response.data);
  const rawPlans = Array.isArray(payload)
    ? payload
    : payload.data || payload.plans || payload.Data || [];
  if (!Array.isArray(rawPlans)) {
    const error = new Error("Data plans are currently unavailable.");
    error.statusCode = 503;
    throw error;
  }
  return rawPlans.map((plan) => ({
    code: String(field(plan, ["code", "plan_code", "dataplan", "id"])),
    name: String(field(plan, ["name", "plan_name", "description"]) || "Data plan"),
    price: Number(String(field(plan, ["price", "amount", "selling_price"])).replace(/[^\d.]/g, "")),
  })).filter((plan) => plan.code && Number.isFinite(plan.price) && plan.price > 0);
};

const reserveRequest = async ({ partnerId, service, amount, requestKey, network, phone, planCode }) => {
  const session = await mongoose.startSession();
  try {
    let reserved;
    await session.withTransaction(async () => {
      const existing = await PartnerTransaction.findOne({
        partner: partnerId,
        idempotencyKey: requestKey,
      }).session(session);
      if (existing) {
        reserved = { duplicate: true, transaction: existing };
        return;
      }

      const partner = await Partner.findById(partnerId).session(session);
      if (!partner || partner.status !== "ACTIVE") {
        const error = new Error("Partner API access is not active.");
        error.statusCode = 403;
        throw error;
      }
      if (!hasPartnerPermission(partner, service)) {
        const error = new Error("This API service is not enabled for your account.");
        error.statusCode = 403;
        throw error;
      }

      const today = dayKey();
      if (partner.dailySpentDate !== today) {
        partner.dailySpentDate = today;
        partner.dailySpent = 0;
      }
      const perTransactionLimit = Number(partner.perTransactionLimit || 0);
      if (perTransactionLimit > 0 && amount > perTransactionLimit) {
        const error = new Error("This request exceeds your per-transaction limit.");
        error.statusCode = 422;
        throw error;
      }
      if (Number(partner.dailyLimit || 0) > 0 && Number(partner.dailySpent || 0) + amount > Number(partner.dailyLimit)) {
        const error = new Error("This request exceeds your remaining daily limit.");
        error.statusCode = 422;
        throw error;
      }
      if (Number(partner.walletBalance || 0) < amount) {
        const error = new Error("Insufficient partner wallet balance.");
        error.statusCode = 422;
        throw error;
      }

      const before = Number(partner.walletBalance || 0);
      partner.walletBalance = Number((before - amount).toFixed(2));
      partner.dailySpent = Number((Number(partner.dailySpent || 0) + amount).toFixed(2));
      partner.lastRequestAt = new Date();
      partner.lastUsedAt = new Date();
      await partner.save({ session });

      const created = await PartnerTransaction.create([{
        partner: partner._id,
        reference: makeReference(service),
        externalReference: requestKey,
        idempotencyKey: requestKey,
        service,
        network,
        phone,
        amount,
        planCode,
        status: "PROCESSING",
        provider: PROVIDER_NAME,
        walletDebitStatus: "DEBITED",
        requestPayload: { network, phone, amount, planCode },
        walletBefore: before,
        walletAfter: partner.walletBalance,
        dailyLimitAtRequest: Number(partner.dailyLimit || 0),
        dailySpentDateAtRequest: today,
        perTransactionLimitAtRequest: partner.perTransactionLimit ?? null,
      }], { session });
      reserved = { duplicate: false, partner, transaction: created[0] };
    });
    return reserved;
  } finally {
    await session.endSession();
  }
};

const refundRequest = async ({
  transaction,
  reason,
  providerResponse,
  actor = null,
  resolutionSource = "PROVIDER_RESPONSE",
  resolutionNote = "",
  providerReference = "",
  allowedStatuses = IN_FLIGHT_STATUSES,
}) => {
  const session = await mongoose.startSession();
  try {
    let result = { applied: false, transaction: null };
    await session.withTransaction(async () => {
      const current = await PartnerTransaction.findById(transaction._id).session(session);
      if (!current || !allowedStatuses.includes(current.status)) {
        result = { applied: false, transaction: current };
        return;
      }
      const partner = await Partner.findById(current.partner).session(session);
      if (!partner || current.walletDebitStatus === "REFUNDED") {
        result = { applied: false, transaction: current };
        return;
      }
      partner.walletBalance = Number((Number(partner.walletBalance || 0) + Number(current.amount || 0)).toFixed(2));
      if (partner.dailySpentDate === transactionDebitDay(current)) {
        partner.dailySpent = Math.max(0, Number((Number(partner.dailySpent || 0) - Number(current.amount || 0)).toFixed(2)));
      }
      partner.failedRequestCount = Number(partner.failedRequestCount || 0) + 1;
      await partner.save({ session });
      current.status = "REVERSED";
      current.errorMessage = String(reason || "Provider request failed.").slice(0, 250);
      current.providerResponse = sanitizeProviderPayload(providerResponse);
      current.responsePayload = sanitizeProviderPayload(providerResponse);
      current.providerReference = String(providerReference || current.providerReference || "").slice(0, 250);
      current.walletDebitStatus = "REFUNDED";
      current.walletAfter = partner.walletBalance;
      current.completedAt = new Date();
      current.resolvedAt = new Date();
      current.resolvedBy = actor;
      current.resolutionSource = resolutionSource;
      current.resolutionNote = String(resolutionNote || "").slice(0, 500);
      await current.save({ session });
      await PartnerAuditLog.create([{
        partner: partner._id,
        action: resolutionSource === "HEAD_OFFICE_MANUAL"
          ? "API_TRANSACTION_MANUALLY_RESOLVED"
          : "API_TRANSACTION_REVERSED",
        actor,
        metadata: {
          reference: current.reference,
          service: current.service,
          outcome: "FAILED",
          reason: current.errorMessage,
          walletReversal: "ONE_TIME",
          providerReference: current.providerReference || null,
        },
      }], { session });
      result = { applied: true, transaction: current };
    });
    return result;
  } finally {
    await session.endSession();
  }
};

const markRequestForReconciliation = async (transaction, {
  reason = "Provider outcome pending reconciliation.",
  providerResponse = null,
} = {}) => {
  const updated = await PartnerTransaction.findOneAndUpdate({
    _id: transaction._id,
    status: { $in: IN_FLIGHT_STATUSES },
  }, {
    $set: {
      status: "REQUERY_REQUIRED",
      provider: PROVIDER_NAME,
      walletDebitStatus: "DEBITED",
      errorMessage: String(reason).slice(0, 250),
      uncertaintyReason: String(reason).slice(0, 250),
      providerResponse: sanitizeProviderPayload(providerResponse),
      responsePayload: sanitizeProviderPayload(providerResponse),
    },
  }, { returnDocument: "after" });
  if (updated) {
    await PartnerAuditLog.create({
      partner: updated.partner,
      action: "API_REQUEST_PENDING_RECONCILIATION",
      metadata: {
        reference: updated.reference,
        service: updated.service,
        provider: PROVIDER_NAME,
        reason: updated.uncertaintyReason,
      },
    });
  }
  return updated;
};

const finalizeProviderSuccess = async ({ transaction, providerResponse }) => {
  const session = await mongoose.startSession();
  try {
    let completed = null;
    await session.withTransaction(async () => {
      completed = await PartnerTransaction.findOneAndUpdate({
        _id: transaction._id, status: { $in: IN_FLIGHT_STATUSES }, walletDebitStatus: "DEBITED",
      }, { $set: {
        status: "SUCCESSFUL", provider: PROVIDER_NAME,
        providerResponse: sanitizeProviderPayload(providerResponse),
        responsePayload: sanitizeProviderPayload(providerResponse),
        providerReference: providerOrderId(providerResponse) || String(field(providerResponse, ["reference", "request_id"]) || "").slice(0, 250),
        walletDebitStatus: "DEBITED", resolutionSource: "PROVIDER_RESPONSE",
        completedAt: new Date(), resolvedAt: new Date(), errorMessage: "",
      } }, { session, returnDocument: "after" });
      if (!completed) return;
      await PartnerAuditLog.create([{ partner: completed.partner, action: "API_TRANSACTION_CONFIRMED",
        metadata: { reference: completed.reference, service: completed.service, outcome: "SUCCESSFUL",
          providerReference: completed.providerReference || null, source: "PROVIDER_RESPONSE" } }], { session });
    });
    return completed;
  } finally {
    await session.endSession();
  }
};

const purchase = async (req, res, service) => {
  let reservation;
  try {
    const requestKey = idempotencyKey(req);
    if (!requestKey || requestKey.length > 120) {
      return res.status(400).json({ success: false, message: "A valid Idempotency-Key header is required." });
    }
    const providerCredentials = credentials();
    if (!providerCredentials.valid) {
      return res.status(503).json({ success: false, message: "This partner service is temporarily unavailable." });
    }
    const network = normalizeNetwork(req.body?.network);
    const phone = normalizePhone(req.body?.phone);
    if (!network || phone.length !== 11 || !phone.startsWith("0")) {
      return res.status(400).json({ success: false, message: "Enter a valid Nigerian network and phone number." });
    }

    let amount;
    let planCode = "";
    if (service === "AIRTIME") {
      amount = Number(req.body?.amount);
      if (!Number.isFinite(amount) || amount < 50) {
        return res.status(400).json({ success: false, message: "Airtime amount must be at least ₦50." });
      }
    } else {
      planCode = String(req.body?.planCode || req.body?.dataPlan || "").trim();
      if (!planCode) return res.status(400).json({ success: false, message: "A valid data plan code is required." });
      const plans = await fetchDataPlans(network, providerCredentials);
      const selected = plans.find((plan) => plan.code === planCode);
      if (!selected) return res.status(400).json({ success: false, message: "The selected data plan is unavailable. Refresh plans and try again." });
      const override = await DataPriceOverride.findOne({ networkCode: network, planCode, active: true }).lean();
      amount = Number(override?.sellingPrice || selected.price);
    }

    reservation = await reserveRequest({
      partnerId: req.partner._id,
      service,
      amount,
      requestKey,
      network,
      phone,
      planCode,
    });
    if (reservation.duplicate) {
      return res.status(200).json({
        success: reservation.transaction.status === "SUCCESSFUL",
        duplicate: true,
        message: "This request has already been processed.",
        data: responseTransaction(reservation.transaction),
      });
    }

    let providerResponse;
    try {
      providerResponse = await axios.get(
        service === "AIRTIME" ? AIRTIME_URL : DATA_URL,
        {
          params: service === "AIRTIME"
            ? {
                UserID: providerCredentials.userId,
                APIKey: providerCredentials.apiKey,
                MobileNetwork: network,
                Amount: amount,
                MobileNumber: phone,
                RequestID: reservation.transaction.reference,
              }
            : {
                UserID: providerCredentials.userId,
                APIKey: providerCredentials.apiKey,
                MobileNetwork: network,
                DataPlan: planCode,
                MobileNumber: phone,
                RequestID: reservation.transaction.reference,
              },
          timeout: 45000,
          validateStatus: () => true,
        }
      );
    } catch (_) {
      await markRequestForReconciliation(reservation.transaction, {
        reason: "Provider transport failed or timed out after the purchase request was sent.",
      });
      return res.status(202).json({
        success: false,
        message: "Transaction is being confirmed. Do not resubmit this purchase; query the same reference or reuse the same idempotency key.",
        reference: reservation.transaction.reference,
        status: "PROCESSING",
      });
    }
    const parsed = parseProviderResponse(providerResponse.data);
    const outcome = providerOutcome(parsed, providerResponse.status);
    if (outcome === "UNKNOWN") {
      await markRequestForReconciliation(reservation.transaction, {
        reason: providerResponse.status >= 500
          ? "The provider returned a server error and its purchase outcome is unknown."
          : "The provider response was delayed, malformed, or did not establish a final outcome.",
        providerResponse: parsed,
      });
      return res.status(202).json({
        success: false,
        message: "Transaction is being confirmed. Do not resubmit this purchase; query the same reference or reuse the same idempotency key.",
        reference: reservation.transaction.reference,
        status: "PROCESSING",
      });
    }
    if (outcome === "FAILED") {
      await refundRequest({ transaction: reservation.transaction, reason: providerMessage(parsed), providerResponse: parsed });
      return res.status(422).json({
        success: false,
        message: "The provider could not complete this request. Your partner wallet was restored.",
        reference: reservation.transaction.reference,
        status: "REVERSED",
      });
    }

    const completed = await finalizeProviderSuccess({
      transaction: reservation.transaction,
      providerResponse: parsed,
    });
    if (!completed) {
      const current = await PartnerTransaction.findById(reservation.transaction._id);
      return res.status(202).json({
        success: current?.status === "SUCCESSFUL",
        message: "Transaction finality changed while confirmation was being recorded. Query the same reference for its current status.",
        data: current ? responseTransaction(current) : null,
      });
    }
    return res.status(201).json({
      success: true,
      message: `${service === "AIRTIME" ? "Airtime" : "Data"} purchase completed.`,
      data: responseTransaction(completed),
    });
  } catch (error) {
    if (reservation?.transaction) {
      try {
        await markRequestForReconciliation(reservation.transaction, {
          reason: "The Partner API could not verify the provider outcome.",
        });
      } catch (_) {
        // The processing record remains available for controlled reconciliation.
      }
    }
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode ? error.message : "Unable to complete this Partner API request.",
    });
  }
};

exports.buyAirtime = (req, res) => purchase(req, res, "AIRTIME");
exports.buyData = (req, res) => purchase(req, res, "DATA");

exports.getDataPlans = async (req, res) => {
  try {
    const network = normalizeNetwork(req.params.network);
    if (!network) return res.status(400).json({ success: false, message: "Select MTN, Glo, Airtel or 9mobile." });
    const providerCredentials = credentials();
    if (!providerCredentials.valid) return res.status(503).json({ success: false, message: "This partner service is temporarily unavailable." });
    const plans = await fetchDataPlans(network, providerCredentials);
    return res.json({ success: true, data: plans });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: "Unable to retrieve data plans." });
  }
};

const findTransaction = async ({ reference, partnerId = null }) => {
  const filter = { reference: String(reference || "").trim() };
  if (partnerId) filter.partner = partnerId;
  return PartnerTransaction.findOne(filter);
};

exports.requeryPartnerTransaction = async (req, res) => {
  try {
    if (req.partner && req.partner.status !== "ACTIVE") {
      return res.status(403).json({ success: false, message: "Partner API access is not active." });
    }
    const transaction = await findTransaction({
      reference: req.params.reference,
      partnerId: req.partner?._id || null,
    });
    if (!transaction) return res.status(404).json({ success: false, message: "Transaction not found." });
    if (!isReconciliationEligible(transaction)) {
      if (isInFlight(transaction)) {
        return res.status(202).json({
          success: false,
          status: "PROCESSING",
          reference: transaction.reference,
          message: "The provider request is still in flight. Do not resubmit this purchase; query the same reference again shortly.",
          data: responseTransaction(transaction),
        });
      }
      return res.json({
        success: true,
        message: "Transaction already has a final outcome.",
        data: responseTransaction(transaction),
      });
    }

    const requeryed = await PartnerTransaction.findOneAndUpdate({
      _id: transaction._id,
      status: { $in: RECONCILIATION_STATUSES },
      walletDebitStatus: "DEBITED",
    }, {
      $set: {
        status: "REQUERY_REQUIRED",
        lastRequeryAt: new Date(),
        errorMessage: "Provider status confirmation is required.",
      },
      $inc: { requeryCount: 1 },
    }, { returnDocument: "after" });
    if (!requeryed) {
      const current = await findTransaction({
        reference: req.params.reference,
        partnerId: req.partner?._id || null,
      });
      if (!current) return res.status(404).json({ success: false, message: "Transaction not found." });
      return res.json({
        success: true,
        message: "Transaction already has a final outcome.",
        data: responseTransaction(current),
      });
    }
    const actor = req.user?._id || req.user?.id || null;
    const providerCredentials = credentials();
    const orderId = String(requeryed.providerReference || "").trim();
    const queryParams = {
      ...(orderId ? { OrderID: orderId } : { RequestID: requeryed.reference }),
    };
    await PartnerAuditLog.create({
      partner: requeryed.partner,
      action: "API_REQUERY_ATTEMPTED",
      actor,
      metadata: {
        reference: requeryed.reference,
        provider: requeryed.provider || PROVIDER_NAME,
        providerStatusEndpointAvailable: true,
        queryIdentifier: orderId ? "OrderID" : "RequestID",
        purchaseReplayed: false,
        requeryCount: requeryed.requeryCount,
      },
    });
    let response;
    let parsed = null;
    let outcome = "UNKNOWN";
    let transportError = "";
    if (!providerCredentials.valid) {
      transportError = "Provider status service is temporarily unavailable.";
    } else {
      // Build credentials only after the audit payload so no secret is ever
      // persisted or returned.
      queryParams.UserID = providerCredentials.userId;
      queryParams.APIKey = providerCredentials.apiKey;
      try {
        response = await axios.get(STATUS_QUERY_URL, {
          params: queryParams,
          timeout: 45000,
          validateStatus: () => true,
        });
        parsed = parseProviderResponse(response.data);
        outcome = queryOutcome(parsed, response.status);
      } catch (_) {
        transportError = "Provider status query timed out or could not be completed.";
      }
    }
    const evidence = sanitizeProviderPayload(parsed || { message: transportError || "Malformed provider status response." });
    const foundOrderId = providerOrderId(parsed);
    const foundRequestId = providerRequestId(parsed);
    // A terminal reply belongs to this debit only when it echoes the same
    // identifier that was submitted to APIQueryV1.  Never learn an OrderID
    // from an uncorrelated response.
    const identifierCorrelated = orderId
      ? foundOrderId === orderId
      : foundRequestId === requeryed.reference;
    const identifierMismatch = !identifierCorrelated;
    if (identifierMismatch) outcome = "UNKNOWN";
    await PartnerTransaction.findOneAndUpdate({
      _id: requeryed._id,
      status: "REQUERY_REQUIRED",
      walletDebitStatus: "DEBITED",
    }, {
      $set: {
        providerResponse: evidence,
        responsePayload: evidence,
        ...(identifierCorrelated && foundOrderId ? { providerReference: foundOrderId } : {}),
        errorMessage: outcome === "UNKNOWN"
          ? (transportError || "Provider status remains unresolved.")
          : "",
        uncertaintyReason: outcome === "UNKNOWN"
          ? (transportError || "Provider status remains unresolved.")
          : "",
      },
    });
    await PartnerAuditLog.create({
      partner: requeryed.partner,
      action: "API_REQUERY_RESULT",
      actor,
      metadata: {
        reference: requeryed.reference,
        provider: requeryed.provider || PROVIDER_NAME,
        outcome,
        httpStatus: response?.status || null,
        queryIdentifier: orderId ? "OrderID" : "RequestID",
        identifierCorrelated,
        identifierMismatch,
        providerResponse: evidence,
      },
    });
    if (outcome === "SUCCESS") {
      const final = await resolveProviderSuccessfulTransaction({
        transaction: requeryed, providerReference: foundOrderId || orderId, providerResponse: parsed, actor,
      });
      const current = final.transaction || await PartnerTransaction.findById(requeryed._id);
      return res.json({ success: current?.status === "SUCCESSFUL", message: final.applied
        ? "Transaction confirmed successful by ClubKonnect. The existing wallet debit was retained."
        : "Transaction already has a final outcome.", data: responseTransaction(current) });
    }
    if (outcome === "FAILED") {
      const refund = await refundRequest({
        transaction: requeryed, reason: providerMessage(parsed), providerResponse: parsed, actor,
        resolutionSource: "PROVIDER_RESPONSE", resolutionNote: "ClubKonnect APIQueryV1 terminal failure.",
        providerReference: foundOrderId || orderId, allowedStatuses: RECONCILIATION_STATUSES,
      });
      return res.json({ success: refund.applied, message: refund.applied
        ? "Transaction was cancelled by ClubKonnect and refunded exactly once."
        : "Transaction already has a final outcome.", data: responseTransaction(refund.transaction) });
    }
    const unresolved = await PartnerTransaction.findById(requeryed._id);
    return res.status(202).json({
      success: false, status: "PENDING", reference: requeryed.reference,
      message: "ClubKonnect has not returned a terminal outcome. The purchase was not replayed and the debit remains pending.",
      data: responseTransaction(unresolved),
    });
  } catch (error) {
    console.error("Partner transaction requery error:", error);
    return res.status(500).json({ success: false, message: "Unable to requery transaction." });
  }
};

exports.listUnresolvedTransactions = async (req, res) => {
  try {
    const filter = { status: { $in: RECONCILIATION_STATUSES } };
    if (req.query?.partnerId) filter.partner = req.query.partnerId;
    const limit = Math.min(Math.max(Number(req.query?.limit || 100), 1), 200);
    const transactions = await PartnerTransaction.find(filter)
      .select("-requestPayload -responsePayload")
      .sort({ lastRequeryAt: 1, createdAt: 1 })
      .limit(limit)
      .lean();
    return res.json({
      success: true,
      count: transactions.length,
      providerStatusEndpointAvailable: true,
      message: "ClubKonnect transactions can be verified automatically using the provider status endpoint.",
      transactions,
    });
  } catch (error) {
    console.error("Unresolved Partner API transaction list error:", error);
    return res.status(500).json({ success: false, message: "Unable to load unresolved transactions." });
  }
};

const resolveSuccessfulTransaction = async ({ transaction, providerReference, note, actor }) => {
  const session = await mongoose.startSession();
  try {
    let result = null;
    await session.withTransaction(async () => {
      const current = await PartnerTransaction.findOneAndUpdate({
        _id: transaction._id,
        status: { $in: RECONCILIATION_STATUSES },
        walletDebitStatus: "DEBITED",
      }, {
        $set: {
          status: "SUCCESSFUL",
          provider: transaction.provider || PROVIDER_NAME,
          providerReference: String(providerReference || transaction.providerReference || "").slice(0, 250),
          walletDebitStatus: "DEBITED",
          completedAt: new Date(),
          resolvedAt: new Date(),
          resolvedBy: actor,
          resolutionSource: "HEAD_OFFICE_MANUAL",
          resolutionNote: String(note || "").slice(0, 500),
          errorMessage: "",
        },
      }, {
        session,
        returnDocument: "after",
      });
      if (!current) {
        result = {
          alreadyFinal: true,
          transaction: await PartnerTransaction.findById(transaction._id).session(session),
        };
        return;
      }
      await PartnerAuditLog.create([{
        partner: current.partner,
        action: "API_TRANSACTION_CONFIRMED",
        actor,
        metadata: {
          reference: current.reference,
          service: current.service,
          outcome: "SUCCESSFUL",
          providerReference: current.providerReference,
          source: "HEAD_OFFICE_MANUAL",
        },
      }], { session });
      result = { alreadyFinal: false, transaction: current };
    });
    return result;
  } finally {
    await session.endSession();
  }
};

const resolveProviderSuccessfulTransaction = async ({ transaction, providerReference, providerResponse, actor }) => {
  const session = await mongoose.startSession();
  try {
    let result = { applied: false, transaction: null };
    await session.withTransaction(async () => {
      const current = await PartnerTransaction.findOneAndUpdate({
        _id: transaction._id, status: { $in: RECONCILIATION_STATUSES }, walletDebitStatus: "DEBITED",
      }, { $set: {
        status: "SUCCESSFUL", provider: PROVIDER_NAME,
        providerReference: String(providerReference || transaction.providerReference || "").slice(0, 250),
        providerResponse: sanitizeProviderPayload(providerResponse),
        responsePayload: sanitizeProviderPayload(providerResponse),
        completedAt: new Date(), resolvedAt: new Date(), resolvedBy: actor,
        resolutionSource: "PROVIDER_RESPONSE", resolutionNote: "ClubKonnect APIQueryV1 confirmed completion.",
        errorMessage: "", uncertaintyReason: "",
      } }, { session, returnDocument: "after" });
      if (!current) {
        result.transaction = await PartnerTransaction.findById(transaction._id).session(session);
        return;
      }
      await PartnerAuditLog.create([{ partner: current.partner, action: "API_TRANSACTION_CONFIRMED", actor,
        metadata: { reference: current.reference, service: current.service, outcome: "SUCCESSFUL",
          providerReference: current.providerReference, source: "PROVIDER_RESPONSE" } }], { session });
      result = { applied: true, transaction: current };
    });
    return result;
  } finally {
    await session.endSession();
  }
};

exports.resolvePartnerTransaction = async (req, res) => {
  try {
    const outcome = String(req.body?.outcome || req.body?.status || "").trim().toUpperCase();
    const note = String(req.body?.verificationNote || req.body?.note || "").trim();
    const providerReference = String(req.body?.providerReference || "").trim();
    if (!["SUCCESSFUL", "FAILED"].includes(outcome)) {
      return res.status(400).json({ success: false, message: "Outcome must be SUCCESSFUL or FAILED." });
    }
    if (note.length < 10) {
      return res.status(400).json({ success: false, message: "A verification note of at least 10 characters is required." });
    }

    const transaction = await findTransaction({ reference: req.params.reference });
    if (!transaction) return res.status(404).json({ success: false, message: "Transaction not found." });
    if (!isReconciliationEligible(transaction)) {
      return res.status(409).json({
        success: false,
        message: isInFlight(transaction)
          ? "This transaction is still being sent to the provider and cannot be manually resolved."
          : "This transaction already has a final outcome.",
        data: responseTransaction(transaction),
      });
    }
    const actor = req.user?._id || req.user?.id || null;

    if (outcome === "SUCCESSFUL") {
      if (!providerReference && !transaction.providerReference) {
        return res.status(400).json({ success: false, message: "A verified provider reference is required to confirm success." });
      }
      const result = await resolveSuccessfulTransaction({ transaction, providerReference, note, actor });
      if (result.alreadyFinal) {
        return res.status(409).json({
          success: false,
          message: "This transaction already has a final outcome.",
          data: responseTransaction(result.transaction),
        });
      }
      return res.json({
        success: true,
        message: "Partner API transaction confirmed successful. The existing wallet debit was retained.",
        data: responseTransaction(result.transaction),
      });
    }

    const refund = await refundRequest({
      transaction,
      reason: note,
      providerResponse: { resolution: "FAILED", verificationNote: note },
      actor,
      resolutionSource: "HEAD_OFFICE_MANUAL",
      resolutionNote: note,
      providerReference,
      allowedStatuses: RECONCILIATION_STATUSES,
    });
    if (!refund.applied) {
      return res.status(409).json({
        success: false,
        message: "This transaction already has a final outcome.",
        data: responseTransaction(refund.transaction),
      });
    }
    return res.json({
      success: true,
      message: "Partner API transaction marked failed and the partner wallet was reversed exactly once.",
      data: responseTransaction(refund.transaction),
    });
  } catch (error) {
    console.error("Partner transaction resolution error:", error);
    return res.status(500).json({ success: false, message: "Unable to resolve Partner API transaction." });
  }
};