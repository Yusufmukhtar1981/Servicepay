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

const providerSucceeded = (data) => {
  const status = String(field(data, ["status", "response_description", "response", "message"])).toUpperCase();
  return [
    "SUCCESS",
    "SUCCESSFUL",
    "TRANSACTION SUCCESSFUL",
    "APPROVED",
    "COMPLETED",
    "0",
  ].includes(status) || status.includes("SUCCESS");
};

const responseTransaction = (transaction) => ({
  reference: transaction.reference,
  requestReference: transaction.externalReference,
  service: transaction.service,
  amount: Number(transaction.amount || 0),
  status: transaction.status,
  providerReference: transaction.providerReference || "",
  createdAt: transaction.createdAt,
  completedAt: transaction.completedAt || null,
  walletBefore: Number(transaction.walletBefore || 0),
  walletAfter: Number(transaction.walletAfter || 0),
});

const dayKey = () => new Date().toISOString().slice(0, 10);

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
        walletBefore: before,
        walletAfter: partner.walletBalance,
        dailyLimitAtRequest: Number(partner.dailyLimit || 0),
        perTransactionLimitAtRequest: partner.perTransactionLimit ?? null,
      }], { session });
      reserved = { duplicate: false, partner, transaction: created[0] };
    });
    return reserved;
  } finally {
    await session.endSession();
  }
};

const refundRequest = async ({ transaction, reason, providerResponse }) => {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const current = await PartnerTransaction.findById(transaction._id).session(session);
      if (!current || current.status !== "PROCESSING") return;
      const partner = await Partner.findById(current.partner).session(session);
      if (!partner) return;
      partner.walletBalance = Number((Number(partner.walletBalance || 0) + Number(current.amount || 0)).toFixed(2));
      partner.dailySpent = Math.max(0, Number((Number(partner.dailySpent || 0) - Number(current.amount || 0)).toFixed(2)));
      partner.failedRequestCount = Number(partner.failedRequestCount || 0) + 1;
      await partner.save({ session });
      current.status = "REVERSED";
      current.errorMessage = String(reason || "Provider request failed.").slice(0, 250);
      current.providerResponse = providerResponse || null;
      current.walletAfter = partner.walletBalance;
      current.completedAt = new Date();
      await current.save({ session });
      await PartnerAuditLog.create([{
        partner: partner._id,
        action: "API_REQUEST_FAILED",
        metadata: { reference: current.reference, service: current.service, reason: current.errorMessage },
      }], { session });
    });
  } finally {
    await session.endSession();
  }
};

const markRequestForReconciliation = async (transaction) => {
  await PartnerTransaction.findByIdAndUpdate(transaction._id, {
    $set: {
      errorMessage: "Provider outcome pending reconciliation.",
    },
  });
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
      await markRequestForReconciliation(reservation.transaction);
      return res.status(202).json({
        success: false,
        message: "The provider outcome is pending reconciliation. Do not retry with a new idempotency key.",
        reference: reservation.transaction.reference,
        status: "PROCESSING",
      });
    }
    const parsed = parseProviderResponse(providerResponse.data);
    if (providerResponse.status < 200 || providerResponse.status >= 300 || !providerSucceeded(parsed)) {
      await refundRequest({ transaction: reservation.transaction, reason: providerMessage(parsed), providerResponse: parsed });
      return res.status(422).json({
        success: false,
        message: "The provider could not complete this request. Your partner wallet was restored.",
        reference: reservation.transaction.reference,
        status: "REVERSED",
      });
    }

    reservation.transaction.status = "SUCCESSFUL";
    reservation.transaction.providerResponse = parsed;
    reservation.transaction.providerReference = String(field(parsed, ["reference", "transaction_id", "request_id"]) || "");
    reservation.transaction.completedAt = new Date();
    await reservation.transaction.save();
    return res.status(201).json({
      success: true,
      message: `${service === "AIRTIME" ? "Airtime" : "Data"} purchase completed.`,
      data: responseTransaction(reservation.transaction),
    });
  } catch (error) {
    if (reservation?.transaction) {
      try {
        await markRequestForReconciliation(reservation.transaction);
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