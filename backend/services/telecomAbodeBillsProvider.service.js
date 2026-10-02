const axios = require("axios");
const Transaction = require("../models/transaction.model");
const LedgerEntry = require("../models/ledgerEntry.model");
const { normalizeNigerianMsisdn } = require("./nigerianMsisdn.service");

const BASE_URL = "https://telecomabode.com.ng/api";
const SERVICES = new Set(["AIRTIME", "ELECTRICITY"]);
const error = (code, message, status = 503) => Object.assign(new Error(message), { code, status });
const text = value => typeof value === "string" ? value.trim() : "";
const requestKey = value => {
  const result = text(value);
  if (!/^[A-Za-z0-9_-]{8,36}$/.test(result))
    throw error("BILLS_INVALID_REFERENCE", "A persisted provider reference of 8–36 characters is required.", 400);
  return result;
};
const positiveMoney = value => {
  if (!["number", "string"].includes(typeof value) || !/^\d+(?:\.\d{1,2})?$/.test(String(value)))
    throw error("BILLS_INVALID_AMOUNT", "A positive amount with at most two decimal places is required.", 400);
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 10000000)
    throw error("BILLS_INVALID_AMOUNT", "The amount is outside supported bounds.", 400);
  return n;
};
const phoneNumber = value => {
  const result = normalizeNigerianMsisdn(value);
  if (!result)
    throw error("BILLS_INVALID_PHONE", "A valid Nigerian recipient phone number is required.", 400);
  return result;
};
const id = value => {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0)
    throw error("BILLS_INVALID_PROVIDER_ID", "A verified provider identifier is required.", 400);
  return n;
};
const meter = (number, type) => {
  const meterNumber = text(number);
  const meterType = text(type).toLowerCase();
  if (!/^\d{6,20}$/.test(meterNumber) || /^(\d)\1+$/.test(meterNumber) ||
      !["prepaid", "postpaid"].includes(meterType))
    throw error("BILLS_INVALID_METER", "A valid meter number and prepaid/postpaid meter type are required.", 400);
  return { meter_number: meterNumber, meter_type: meterType };
};
const buildAirtimePayload = ({ network, phone, amount, requestId }) => ({
  network: id(network), phone: phoneNumber(phone), amount: positiveMoney(amount),
  type: "VTU", bypass: false, "request-id": requestKey(requestId),
});
const buildElectricityPayload = ({ disco, meterNumber, meterType, phone, amount, requestId }) => ({
  disco: id(disco), ...meter(meterNumber, meterType), phone: phoneNumber(phone),
  amount: positiveMoney(amount), "request-id": requestKey(requestId),
});

// Invoice-cost and authoritative failure contracts are not established by
// catalogue authentication or by an ordinary HTTP error. Keep them explicit.
const commonReadinessReasons = [
  "Actual provider-cost semantics require authoritative confirmation for this service.",
  "Authoritative terminal-failure/reference reconciliation requires service-specific confirmation.",
];
const financialReadiness = Object.freeze({
  AIRTIME: Object.freeze({ ready: true, accountingPending: true,
    reasons: Object.freeze(["Delivery can settle on correlated authoritative success. Unconfirmed cost stays null; commission and profit remain pending."]) }),
  ELECTRICITY: Object.freeze({ ready: false, reasons: Object.freeze([...commonReadinessReasons,
    "Electricity validation returned the same verified identity for deliberately invalid test meters."]) }),
});

const classify = ({ httpStatus, data, service, reference, meterType, source = "STATUS_QUERY" }) => {
  const base = { httpStatus, outcome: "UNKNOWN", authoritative: false,
    reasonCode: "PROVIDER_RESULT_UNCONFIRMED", requestId: reference,
    providerOrderId: "", providerCost: null, receipt: null };
  if (httpStatus === 202) return { ...base, outcome: "PENDING", reasonCode: "PROVIDER_HTTP_ACCEPTED" };
  // First-party documentation defines 422 as a validation rejection. Only the
  // authenticated response to this exact initial POST may authorize reversal.
  // A lookup saying fail/failed, including the old Invalid MSISDN lookup, cannot.
  if (source === "INITIAL_REQUEST" && httpStatus === 422 &&
      data && typeof data === "object" && !Array.isArray(data) &&
      text(data.status).toLowerCase() === "fail" &&
      text(data.Status).toLowerCase() === "failed" &&
      text(data.message) && !data.token &&
      (data["request-id"] === undefined || text(data["request-id"]) === reference) &&
      (data.service === undefined || text(data.service).toUpperCase() === service)) {
    return { ...base, outcome: "FAILED", authoritative: true,
      reasonCode: "DOCUMENTED_INITIAL_VALIDATION_REJECTION" };
  }
  if (httpStatus !== 200 || !data || typeof data !== "object" || Array.isArray(data)) return base;
  const echoed = text(data["request-id"]);
  if (echoed !== reference) return { ...base, reasonCode: "PROVIDER_REFERENCE_MISMATCH" };
  const primary = text(data.status).toLowerCase();
  const secondary = text(data.Status).toLowerCase();
  const success = ["success", "successful"];
  if (!success.includes(primary) || !success.includes(secondary)) {
    // A bare fail/failed/error is not enough to establish non-delivery,
    // especially on a query. Never infer a refund from it.
    return { ...base, providerOrderId: echoed,
      outcome: ["pending", "processing"].includes(primary) &&
        ["pending", "processing"].includes(secondary) ? "PENDING" : "UNKNOWN" };
  }
  if (data.service !== undefined && text(data.service).toUpperCase() !== service)
    return { ...base, reasonCode: "PROVIDER_SERVICE_MISMATCH" };
  const token = text(data.token);
  const tokenDigits = token.replace(/[ -]/g, "");
  if (service === "ELECTRICITY" && meterType === "prepaid" &&
      (!/^[\d -]+$/.test(token) || !/^\d{20}$/.test(tokenDigits) || /^(\d)\1+$/.test(tokenDigits)))
    return { ...base, providerOrderId: echoed, reasonCode: "PREPAID_TOKEN_UNCONFIRMED" };
  return { ...base, outcome: "SUCCESS", authoritative: true, providerOrderId: echoed,
    reasonCode: "CORRELATED_PROVIDER_SUCCESS",
    // Do NOT call amount or advertised discounts an actual invoice cost.
     receipt: { reference: echoed, ...(token ? { token } : {}),
       ...(service === "ELECTRICITY" && ["string", "number"].includes(typeof data.units)
         ? { units: String(data.units).slice(0, 64) } : {}),
      ...(data.amount !== undefined ? { reportedAmount: String(data.amount).slice(0, 32) } : {}) },
  };
};

const createTelecomAbodeBillsProvider = ({
  transport = axios, transactionModel = Transaction, ledgerModel = LedgerEntry,
  credentials = () => process.env.TELECOM_ABODE_API_KEY,
} = {}) => {
  const verified = new WeakSet();
  const seal = result => {
    if (result.receipt) Object.freeze(result.receipt);
    Object.freeze(result);
    verified.add(result);
    return result;
  };
  const send = async (method, path, body) => {
    const key = text(credentials());
    if (!key) throw error("BILLS_PROVIDER_NOT_CONFIGURED", "Telecom Abode credentials are not configured.");
    try {
      const r = await transport({ method, url: BASE_URL + path,
        headers: { Authorization: "Token " + key, "Content-Type": "application/json", Accept: "application/json" },
        ...(body ? { data: body } : {}), timeout: 30000, maxRedirects: 0, validateStatus: () => true });
      return { httpStatus: r.status, data: r.data };
    } catch (_) {
      // Never propagate axios errors containing credentials or personal data.
      return { httpStatus: null, data: null };
    }
  };
  const catalog = async (path, nameField) => {
    const response = await send("GET", path);
    const rows = Array.isArray(response.data) ? response.data : response.data?.data;
    if (response.httpStatus !== 200 || !Array.isArray(rows) || !rows.length)
      throw error("BILLS_CATALOG_UNAVAILABLE", "The provider catalogue could not be verified.");
    const seen = new Set();
    return rows.map(row => {
      const providerId = id(row.id);
      const displayName = text(row[nameField] || row.name);
      if (seen.has(providerId) || !displayName)
        throw error("BILLS_INVALID_CATALOG", "The provider catalogue contains invalid identifiers.");
      seen.add(providerId);
      return { providerId, displayName, providerCode: text(row.code || row.abb),
        // Pricing evidence only; never used as settled provider cost.
        advertisedDiscount: row.apidiscount === undefined ? null : String(row.apidiscount) };
    });
  };
  const getAirtimeNetworks = () => catalog("/get-networks?service=airtime", "network");
  const getElectricityProviders = () => catalog("/get-bill", "name");
  const validateMeter = async ({ disco, meterNumber, meterType }) => {
    const providerId = id(disco);
    const meterData = meter(meterNumber, meterType);
    const providers = await getElectricityProviders();
    if (!providers.some(p => p.providerId === providerId))
      throw error("BILLS_INVALID_PROVIDER_ID", "Select a DISCO from the verified catalogue.", 400);
    const response = await send("POST", "/bill/bill-validation", { disco: providerId, ...meterData });
    const status = text(response.data?.status).toLowerCase();
    if (response.httpStatus === 200 && status === "success" && text(response.data?.name)) {
      // This live endpoint returned this identity for invalid controls. Names
      // and addresses alone therefore cannot authorize a debit or fulfillment.
      return { verified: false, reasonCode: "METER_IDENTITY_UNTRUSTED" };
    }
    if ([200, 400, 422].includes(response.httpStatus) && ["error", "fail", "failed"].includes(status))
      return { verified: false, reasonCode: "METER_NOT_VERIFIED" };
    throw error("BILLS_METER_VALIDATION_UNCONFIRMED", "Meter validation could not be confirmed. No purchase was made.");
  };
  const purchase = async (service, payload) => {
    const requestId = payload["request-id"];
    // The caller must have admitted/debited this exact intent. This second
    // atomic one-shot claim also protects against accidental direct reuse of
    // the provider adapter. No new collection or index is required.
    const claim = await transactionModel.findOneAndUpdate({
      provider: "TELECOM_ABODE", serviceType: service, providerRequestId: requestId,
      status: "PENDING", dispatchStatus: "SENDING", debitLedgerEntryId: { $ne: null },
      dispatchStartedAt: { $ne: null }, amount: { $gte: payload.amount },
      "providerResponse.telecomAbodePurchaseIntent": payload,
      "providerResponse.telecomAbodeBillsDispatchClaimed": { $ne: true },
      ...(service === "ELECTRICITY" ? {
        "providerResponse.electricityValidation.verified": true,
        "providerResponse.electricityValidation.disco": payload.disco,
        "providerResponse.electricityValidation.meter_number": payload.meter_number,
        "providerResponse.electricityValidation.meter_type": payload.meter_type,
      } : {}),
    }, { $set: { "providerResponse.telecomAbodeBillsDispatchClaimed": true } }, { new: true });
    if (!claim) throw error("BILLS_DISPATCH_CUSTODY_REQUIRED",
      "A persisted matching wallet debit and one-shot dispatch claim are required.", 409);
    const debit = await ledgerModel.findById(claim.debitLedgerEntryId);
    if (!debit || debit.direction !== "DEBIT" || debit.status !== "POSTED" ||
        String(debit.transactionId) !== String(claim._id) ||
        String(debit.user) !== String(claim.customerId) ||
        debit.service !== service || debit.reference !== claim.reference ||
        debit.idempotencyKey !== `${service}:${claim.reference}:DEBIT` ||
        Math.round(Number(debit.amount) * 100) !== Math.round(Number(claim.amount) * 100)) {
      throw error("BILLS_CANONICAL_DEBIT_REQUIRED",
        "The canonical posted wallet debit could not be verified. No provider purchase was sent.", 409);
    }
    const response = await send("POST", service === "AIRTIME" ? "/airtime" : "/bill", payload);
    return seal({ source: "INITIAL_REQUEST", ...classify({ ...response, source: "INITIAL_REQUEST", service, reference: requestId,
      meterType: payload.meter_type }) });
  };
  const purchaseAirtime = async input => {
    const payload = buildAirtimePayload(input);
    const networks = await getAirtimeNetworks();
    if (!networks.some(n => n.providerId === payload.network))
      throw error("BILLS_INVALID_PROVIDER_ID", "Select a network from the verified catalogue.", 400);
    return purchase("AIRTIME", payload);
  };
  const purchaseElectricity = async input => {
    const payload = buildElectricityPayload(input);
    const providers = await getElectricityProviders();
    if (!providers.some(p => p.providerId === payload.disco))
      throw error("BILLS_INVALID_PROVIDER_ID", "Select a DISCO from the verified catalogue.", 400);
    return purchase("ELECTRICITY", payload);
  };
  const query = async ({ service, requestId, meterType }) => {
    if (!SERVICES.has(service)) throw error("BILLS_INVALID_SERVICE", "An explicit service is required.", 400);
    const reference = requestKey(requestId);
    // Read-only: never resend, settle, debit, refund, or pay a commission here.
    const response = await send("GET", "/transaction/" + encodeURIComponent(reference));
    return seal({ source: "STATUS_QUERY", ...classify({ ...response, service, reference, meterType }) });
  };
  return { getAirtimeNetworks, getElectricityProviders, validateMeter,
    purchaseAirtime, purchaseElectricity, query,
    isVerifiedEvidence: value => verified.has(value), financialReadiness };
};

module.exports = { createTelecomAbodeBillsProvider, buildAirtimePayload, buildElectricityPayload,
  classify, financialReadiness };