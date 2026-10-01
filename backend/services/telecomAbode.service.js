const axios = require("axios");
const Transaction = require("../models/transaction.model");

const DEFAULT_BASE_URL = "https://telecomabode.com.ng/api";
const DEFAULT_TIMEOUT_MS = 30000;

class TelecomAbodeError extends Error {
  constructor(message, { statusCode = 502, code = "TELECOM_ABODE_ERROR", providerEvidence } = {}) {
    super(message);
    this.name = "TelecomAbodeError";
    this.statusCode = statusCode;
    this.code = code;
    if (providerEvidence) this.providerEvidence = providerEvidence;
  }
}

const MAX_PROVIDER_EVIDENCE_LENGTH = 1200;
const MAX_PROVIDER_MESSAGE_LENGTH = 320;
const STATUS_WORDS = new Set([
  "success", "successful", "pending", "processing", "fail", "failed", "failure", "error",
]);

const sanitizeProviderText = (value, configuredKey) => {
  let text = String(value);
  // Redact the configured credential before any truncation, including when
  // the provider echoes it without a header/key label.
  if (configuredKey) {
    text = text.split(configuredKey).join("[REDACTED_PROVIDER_KEY]");
    const encodedKey = encodeURIComponent(configuredKey);
    if (encodedKey !== configuredKey) {
      text = text.split(encodedKey).join("[REDACTED_PROVIDER_KEY]");
    }
  }
  return text
    .slice(0, 1000)
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\bToken\s+\S+/gi, "Token [REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(/\b[A-Za-z0-9_-]*secret[A-Za-z0-9_-]*\b/gi, "[REDACTED]")
    .replace(/(?<!\d)(?:\+?234|0)(?:[ -]?\d){9,10}(?!\d)/g, "[REDACTED_PHONE]")
    .replace(/\b(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|token|password|secret|authorization)\b(\s*[:=]\s*)["']?[^,\s}"']+/gi, "$1$2[REDACTED]")
    .replace(/\b(?:[A-F0-9]{32,}|[A-Za-z0-9_-]{80,})\b/gi, "[REDACTED_VALUE]")
    .slice(0, MAX_PROVIDER_MESSAGE_LENGTH);
};

const safeHttpEvidence = (body, requestId, configuredKey) => {
  let parsed = body;
  let bodyType = "json";
  if (typeof body === "string") {
    const text = body.slice(0, 4096);
    if (!text.trim()) {
      parsed = null;
      bodyType = "empty";
    } else {
      try {
        parsed = JSON.parse(text);
      } catch (_) {
        parsed = null;
        bodyType = "text";
      }
    }
  } else if (body === undefined || body === null || body === "") {
    parsed = null;
    bodyType = "empty";
  } else if (typeof body !== "object" || Array.isArray(body)) {
    bodyType = "other";
    parsed = null;
  }

  const evidence = { bodyType };
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const status = parsed.status ?? parsed.Status;
    if (typeof status === "string" && STATUS_WORDS.has(status.trim().toLowerCase())) {
      evidence.status = status.trim().slice(0, 24);
    }

    const code = parsed.code ?? parsed.errorCode ?? parsed.error_code;
    if (typeof code === "number" && Number.isSafeInteger(code)) {
      evidence.code = code;
    } else if (typeof code === "string") {
      const normalizedCode = sanitizeProviderText(code, configuredKey);
      if (normalizedCode && normalizedCode.length <= 64) evidence.code = normalizedCode;
    }

    const message = parsed.message ?? parsed.error_description ?? parsed.error;
    if (typeof message === "string") {
      evidence.message = sanitizeProviderText(message, configuredKey);
    }

    const echoedReference =
      parsed["request-id"] ?? parsed.request_id ?? parsed.requestId ??
      parsed.providerReference ?? parsed.reference;
    if (typeof echoedReference === "string") {
      evidence.reference = sanitizeProviderText(echoedReference, configuredKey).slice(0, 128);
      evidence.requestIdMatches = echoedReference.trim() === String(requestId || "").trim();
    }
  } else if (typeof body === "string" && body.trim()) {
    evidence.message = sanitizeProviderText(body, configuredKey);
  }

  if (JSON.stringify(evidence).length > MAX_PROVIDER_EVIDENCE_LENGTH) {
    evidence.message = (evidence.message || "").slice(0, 120);
  }
  return evidence;
};

const fail = (message, statusCode = 400, code = "INVALID_ARGUMENT") => {
  throw new TelecomAbodeError(message, { statusCode, code });
};

const requiredText = (value, field) => {
  if (typeof value !== "string" || !value.trim()) {
    fail(`${field} is required.`);
  }
  return value.trim();
};

const requiredId = (value, field) => {
  const normalized = typeof value === "string" && /^\d+$/.test(value.trim())
    ? Number(value.trim())
    : value;
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    fail(`${field} must be a positive integer.`);
  }
  return normalized;
};

const requiredAmount = (value) => {
  const normalized = typeof value === "number" ? String(value) : value;
  if (typeof normalized !== "string" || !/^[1-9]\d*$/.test(normalized.trim())) {
    fail("Amount must be a positive whole number.");
  }
  return normalized.trim();
};

const getStatusValue = (data) => {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const statuses = [data.status, data.Status].filter((value) => value !== undefined);
  if (!statuses.length) return null;
  const normalized = statuses.map((value) => {
    const text = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (text === "success" || text === "successful") return "SUCCESSFUL";
    if (text === "pending" || text === "processing") return "PENDING";
    if (text === "fail" || text === "failed" || text === "failure") return "FAILED";
    if (text === "error") return "ERROR";
    return text;
  });
  if (normalized.some((value) => !value) || new Set(normalized).size !== 1) {
    return "AMBIGUOUS";
  }
  return normalized[0];
};

const normalizePurchaseStatus = (data) => {
  const status = getStatusValue(data);
  if (status === "SUCCESSFUL") return "SUCCESS";
  if (status === "PENDING") return "PENDING";
  if (status === "FAILED") return "FAILED";
  return null;
};

const documentedDataOutcome = (data) => {
  if (!data || typeof data !== "object" || Array.isArray(data)) return "PENDING";
  const statusFields = ["status", "Status"].filter((field) =>
    Object.prototype.hasOwnProperty.call(data, field),
  );
  if (!statusFields.length) return "PENDING";

  const outcomes = [];
  for (const field of statusFields) {
    if (typeof data[field] !== "string") return "PENDING";
    const status = data[field].trim().toLowerCase();
    if (status === "success" || status === "successful") {
      outcomes.push("SUCCESS");
    } else if (status === "fail" || status === "failed") {
      outcomes.push("FAILED");
    } else {
      return "PENDING";
    }
  }
  return new Set(outcomes).size === 1 ? outcomes[0] : "PENDING";
};

const getCollection = (data, collectionName) => {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return null;
  if (Array.isArray(data[collectionName])) return data[collectionName];
  if (Array.isArray(data.data)) return data.data;
  return null;
};

const DATA_NETWORK_NAMES = Object.freeze(["MTN", "Airtel", "Glo", "9mobile"]);
const DATA_NETWORK_ALIASES = Object.freeze({
  ETISALAT: "9MOBILE",
  T2MOBILE: "9MOBILE",
  T2: "9MOBILE",
});
const normalizeNetworkName = (value) =>
  typeof value === "string" ? value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") : "";

const normalizeDataNetworks = (data) => {
  if (!Array.isArray(data) || data.length !== DATA_NETWORK_NAMES.length) {
    throw new TelecomAbodeError("Telecom Abode returned an incomplete or invalid data network list.", {
      code: "INVALID_PROVIDER_RESPONSE",
    });
  }

  const expectedNames = new Map(DATA_NETWORK_NAMES.map((name) => [normalizeNetworkName(name), name]));
  const ids = new Set();
  const names = new Set();
  const networks = data.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new TelecomAbodeError("Telecom Abode returned an invalid data network entry.", {
        code: "INVALID_PROVIDER_RESPONSE",
      });
    }
    const id = item.id;
    const key = normalizeNetworkName(item.network);
    const name = expectedNames.get(key);
    if (!Number.isSafeInteger(id) || id <= 0 || !name || ids.has(id) || names.has(key)) {
      throw new TelecomAbodeError("Telecom Abode returned ambiguous data network mappings.", {
        code: "INVALID_PROVIDER_RESPONSE",
      });
    }
    ids.add(id);
    names.add(key);
    return { id, network: name };
  });

  if (names.size !== expectedNames.size || [...expectedNames.keys()].some((name) => !names.has(name))) {
    throw new TelecomAbodeError("Telecom Abode returned an incomplete data network mapping.", {
      code: "INVALID_PROVIDER_RESPONSE",
    });
  }
  return networks;
};

const normalizeDataPlans = (data, dataNetworks) => {
  if (!Array.isArray(dataNetworks) || dataNetworks.length !== DATA_NETWORK_NAMES.length) {
    throw new TelecomAbodeError("Validated Telecom Abode data network metadata is required.", {
      code: "INVALID_PROVIDER_RESPONSE",
    });
  }
  const networkByName = new Map(dataNetworks.map((network) => [
    normalizeNetworkName(network.network),
    network,
  ]));
  for (const [alias, canonical] of Object.entries(DATA_NETWORK_ALIASES)) {
    const network = networkByName.get(canonical);
    if (network) networkByName.set(alias, network);
  }
  const status = getStatusValue(data);
  if (status !== null && status !== "SUCCESSFUL") {
    throw new TelecomAbodeError("Telecom Abode did not return data plans.", {
      code: "PROVIDER_REJECTED",
    });
  }
  const collection = Array.isArray(data?.data_plans)
    ? data.data_plans
    : Array.isArray(data?.dataPlans)
      ? data.dataPlans
      : getCollection(data, "plans");
  if (!collection || collection.length === 0) {
    throw new TelecomAbodeError("Telecom Abode returned no unambiguous data plans.", {
      code: "INVALID_PROVIDER_RESPONSE",
    });
  }

  const ids = new Set();
  return collection.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new TelecomAbodeError("Telecom Abode returned an invalid data plan entry.", {
        code: "INVALID_PROVIDER_RESPONSE",
      });
    }

    const rawId = item.plan_id;
    const id = typeof rawId === "string" && /^\d+$/.test(rawId.trim())
      ? Number(rawId.trim())
      : rawId;
    const networkValue = normalizeNetworkName(item.network);
    const network = networkByName.get(networkValue);
    const datasize = typeof item.datasize === "string" ? item.datasize.trim() : "";
    const day = typeof item.day === "string" || typeof item.day === "number"
      ? String(item.day).trim()
      : "";
    const type = typeof item.type === "string" ? item.type.trim() : "";
    const rawPrice = item.price;
    const priceText = typeof rawPrice === "number"
      ? String(rawPrice)
      : typeof rawPrice === "string"
        ? rawPrice.trim()
        : "";
    const price = /^[0-9]+(?:\.[0-9]+)?$/.test(priceText) ? Number(priceText) : NaN;

    if (
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      ids.has(id) ||
      !network ||
      !datasize ||
      !day ||
      !type ||
      !Number.isFinite(price) ||
      price <= 0
    ) {
      throw new TelecomAbodeError("Telecom Abode returned an ambiguous data plan entry.", {
        code: "INVALID_PROVIDER_RESPONSE",
      });
    }
    ids.add(id);
    return {
      id: String(id),
      code: String(id),
      name: `${datasize} ${type} - ${day}`,
      price,
      providerPrice: price,
      networkId: network.id,
      network: network.network,
      type,
      datasize,
      day,
    };
  });
};

const normalizeNamedItems = (data, itemLabel) => {
  const status = getStatusValue(data);
  if (status !== null && status !== "SUCCESSFUL") {
    throw new TelecomAbodeError(`Telecom Abode did not return ${itemLabel}.`, {
      code: "PROVIDER_REJECTED",
    });
  }
  const collection = getCollection(data, itemLabel === "providers" ? "providers" : "plans");
  if (!collection || collection.length === 0) {
    throw new TelecomAbodeError(`Telecom Abode returned no unambiguous ${itemLabel}.`, {
      code: "INVALID_PROVIDER_RESPONSE",
    });
  }

  const ids = new Set();
  return collection.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new TelecomAbodeError(`Telecom Abode returned an invalid ${itemLabel} entry.`, {
        code: "INVALID_PROVIDER_RESPONSE",
      });
    }
    const idValue = item.id;
    const id = typeof idValue === "string" && /^\d+$/.test(idValue.trim())
      ? Number(idValue.trim())
      : idValue;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!Number.isSafeInteger(id) || id <= 0 || !name || ids.has(id)) {
      throw new TelecomAbodeError(`Telecom Abode returned an ambiguous ${itemLabel} entry.`, {
        code: "INVALID_PROVIDER_RESPONSE",
      });
    }
    ids.add(id);
    return { id, name };
  });
};

const normalizeValidation = (data) => {
  const status = getStatusValue(data);
  if (status === "SUCCESSFUL") {
    if (typeof data.name !== "string" || !data.name.trim()) {
      throw new TelecomAbodeError("Telecom Abode validation response omitted the customer name.", {
        code: "INVALID_PROVIDER_RESPONSE",
      });
    }
    const result = {
      status: "SUCCESSFUL",
      name: data.name.trim(),
    };
    if (typeof data.customer_address === "string" && data.customer_address.trim()) {
      result.customerAddress = data.customer_address.trim();
    }
    if (typeof data.message === "string" && data.message.trim()) {
      result.message = data.message.trim();
    }
    return result;
  }
  if (status === "FAILED" || status === "ERROR") {
    return {
      status: "FAILED",
      ...(typeof data.message === "string" && data.message.trim()
        ? { message: data.message.trim() }
        : {}),
    };
  }
  throw new TelecomAbodeError("Telecom Abode validation response had no recognized status.", {
    code: "INVALID_PROVIDER_RESPONSE",
  });
};

const normalizePurchase = (data, { service, meterType, servicepayReference }) => {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new TelecomAbodeError("Telecom Abode purchase response had no unambiguous status.", {
      code: "INVALID_PROVIDER_RESPONSE",
    });
  }
  const providerStatus = getStatusValue(data);
  if (providerStatus === "AMBIGUOUS") {
    throw new TelecomAbodeError("Telecom Abode purchase response had conflicting statuses.", {
      code: "INVALID_PROVIDER_RESPONSE",
    });
  }
  const status = normalizePurchaseStatus(data) || "UNKNOWN";
  const providerRequestId = typeof data["request-id"] === "string"
    ? data["request-id"].trim()
    : "";
  if (status === "SUCCESS" && !providerRequestId) {
    return {
      status: "PENDING",
      provider: "TELECOM_ABODE",
      service,
      servicepayReference,
      reason: "MISSING_PROVIDER_CORRELATION",
    };
  }
  const result = {
    provider: "TELECOM_ABODE",
    service,
    servicepayReference,
    status,
    ...((data.status ?? data.Status) === undefined
      ? {}
      : { rawProviderStatus: data.status ?? data.Status }),
  };
  if (typeof data.message === "string" && data.message.trim()) {
    result.message = data.message.trim();
    result.providerMessage = data.message.trim();
  }
  if (providerRequestId) {
    result.requestId = providerRequestId;
    result.providerReference = providerRequestId;
  }
  if (typeof data.amount === "string" || typeof data.amount === "number") {
    result.amount = String(data.amount);
  }
  if (status === "SUCCESS" && service === "electricity" && meterType === "prepaid" &&
      typeof data.token === "string" && data.token.trim()) {
    result.token = data.token.trim();
    result.transactionData = { token: result.token };
  }
  return result;
};

const buildDataPurchasePayload = ({
  network,
  phone,
  plan,
  request_id,
  planMetadata,
} = {}) => {
  if (!Number.isSafeInteger(network) || network <= 0) {
    fail("network must be a positive provider network integer.");
  }
  const recipientPhone = requiredText(phone, "phone");
  if (!Number.isSafeInteger(plan) || plan <= 0) {
    fail("plan must be a positive integer.");
  }
  const requestId = requiredText(request_id, "request-id");
  if (!planMetadata || typeof planMetadata !== "object" || Array.isArray(planMetadata)) {
    fail("Provider plan metadata is required to verify network and plan identifiers.");
  }

  const metadataPlanId = typeof planMetadata.plan_id === "string" && /^\d+$/.test(planMetadata.plan_id.trim())
    ? Number(planMetadata.plan_id.trim())
    : planMetadata.plan_id;
  if (
    !Number.isSafeInteger(metadataPlanId) ||
    metadataPlanId !== plan ||
    Object.prototype.hasOwnProperty.call(planMetadata, "networkCode") ||
    !Number.isSafeInteger(planMetadata.network) ||
    planMetadata.network <= 0 ||
    planMetadata.network !== network
  ) {
    fail("network and plan must match the provider's documented plan metadata.");
  }

  return {
    network,
    phone: recipientPhone,
    plan,
    "request-id": requestId,
    // The live DATA endpoint requires bypass or ported_number. Normal
    // purchases must not bypass carrier validation or send string booleans.
    bypass: false,
  };
};

const normalizeDataPurchaseResponse = (
  data,
  { requestId, servicepayReference = requestId, configuredKey = "" } = {},
) => {
  const expectedRequestId = requiredText(requestId, "request-id");
  if (data && typeof data.service === "string" &&
      data.service.trim().toLowerCase() !== "data") {
    return {
      provider: "TELECOM_ABODE",
      service: "data",
      servicepayReference,
      status: "PENDING",
      documentedDataStatus: false,
      reason: "PROVIDER_SERVICE_MISMATCH",
      requestId: expectedRequestId,
    };
  }
  const providerRequestId = data && typeof data === "object" && !Array.isArray(data) &&
    typeof data["request-id"] === "string"
    ? data["request-id"].trim()
    : "";
  if (providerRequestId && providerRequestId !== expectedRequestId) {
    return {
      provider: "TELECOM_ABODE",
      service: "data",
      servicepayReference,
      status: "PENDING",
      documentedDataStatus: false,
      reason: "PROVIDER_REFERENCE_MISMATCH",
      requestId: expectedRequestId,
      providerReference: providerRequestId,
    };
  }
  if (!providerRequestId && ["SUCCESS", "FAILED"].includes(normalizePurchaseStatus(data))) {
    return {
      provider: "TELECOM_ABODE",
      service: "data",
      servicepayReference,
      status: "PENDING",
      documentedDataStatus: false,
      reason: "MISSING_PROVIDER_CORRELATION",
      requestId: expectedRequestId,
    };
  }
  const documentedOutcome = documentedDataOutcome(data);
  const providerMessages = [
    ["message", data?.message],
    ["api_response", data?.api_response],
    ["response", data?.response],
    ["response_description", data?.response_description],
    ["responseDescription", data?.responseDescription],
    ["error_description", data?.error_description],
    ["error", data?.error],
  ]
    .filter(([, value]) => typeof value === "string" && value.trim())
    .map(([field, value]) => ({
      field,
      text: sanitizeProviderText(value, configuredKey),
    }));
  const messageSignalsFailure = providerMessages.some(({ text }) =>
    /\b(FAILED|FAILURE|ERROR|INVALID|REJECTED|DECLINED|CANCELLED|CANCELED)\b/i.test(text),
  );
  const messageSignalsSuccess = providerMessages.some(({ text }) =>
    /\b(SUCCESS|SUCCESSFUL|COMPLETED)\b/i.test(text),
  );
  const contradictory =
    (messageSignalsFailure && messageSignalsSuccess) ||
    (documentedOutcome === "SUCCESS" && messageSignalsFailure) ||
    (documentedOutcome === "FAILED" && messageSignalsSuccess);
  const suppliedAmount = Object.prototype.hasOwnProperty.call(data, "amount");
  const amountText = typeof data?.amount === "number"
    ? String(data.amount)
    : typeof data?.amount === "string"
      ? data.amount.trim()
      : "";
  const amountIsValid = !suppliedAmount ||
    (/^(?:0\.\d{1,2}|[1-9]\d*(?:\.\d{1,2})?)$/.test(amountText) &&
      Number.isFinite(Number(amountText)) &&
      Number(amountText) > 0);
  const terminalOutcome = contradictory || !amountIsValid
    ? "PENDING"
    : documentedOutcome;
  return {
    provider: "TELECOM_ABODE",
    service: "data",
    servicepayReference,
    status: providerRequestId ? terminalOutcome : "PENDING",
    documentedDataStatus: Boolean(providerRequestId && terminalOutcome !== "PENDING"),
    requestId: expectedRequestId,
    ...(providerRequestId ? { providerReference: providerRequestId } : {}),
    ...(suppliedAmount && amountIsValid ? { amount: amountText } : {}),
    ...(providerMessages.length
      ? {
          providerMessage: providerMessages
            .map(({ field, text }) => `${field}: ${text}`)
            .join(" | ")
            .slice(0, MAX_PROVIDER_MESSAGE_LENGTH),
          providerMessageSignals: {
            success: messageSignalsSuccess,
            failure: messageSignalsFailure,
          },
        }
      : {}),
    ...(contradictory ? { contradictory: true } : {}),
    ...(!amountIsValid ? { reason: "INVALID_PROVIDER_AMOUNT" } : {}),
  };
};

const normalizeTransaction = (data, configuredKey) => {
  const status = documentedDataOutcome(data);
  const rawProviderStatus = data.status ?? data.Status;
  const result = {
    provider: "TELECOM_ABODE",
    service: typeof data.service === "string" ? data.service.trim().toLowerCase() : null,
    status,
    documentedDataStatus: status !== "PENDING",
    ...(typeof rawProviderStatus === "string" && STATUS_WORDS.has(rawProviderStatus.toLowerCase())
      ? { rawProviderStatus: rawProviderStatus.slice(0, 24) }
      : {}),
  };
  const hasAmount = Object.prototype.hasOwnProperty.call(data, "amount");
  let invalidProviderAmount = false;
  for (const field of ["request-id", "amount", "service"]) {
    const value = data[field];
    if (typeof value === "string" || typeof value === "number") {
      if (field === "request-id") {
        result.requestId = sanitizeProviderText(value, configuredKey).slice(0, 128);
        result.providerReference = result.requestId;
      } else if (field === "amount") {
        if (/^(?:0\.\d{1,2}|[1-9]\d*(?:\.\d{1,2})?)$/.test(String(value)) &&
            Number.isFinite(Number(value)) &&
            Number(value) > 0) {
          result.amount = String(value).slice(0, 32);
        } else {
          invalidProviderAmount = true;
        }
      } else if (field === "service" && /^[a-zA-Z _-]{1,32}$/.test(String(value))) {
        result.service = String(value);
      }
    }
  }
  if (hasAmount && result.amount === undefined) invalidProviderAmount = true;
  if (invalidProviderAmount) {
    result.status = "PENDING";
    result.documentedDataStatus = false;
    result.invalidProviderAmount = true;
  }
  const providerMessages = [
    ["message", data.message],
    ["api_response", data.api_response],
    ["response", data.response],
    ["response_description", data.response_description],
    ["responseDescription", data.responseDescription],
    ["error_description", data.error_description],
    ["error", data.error],
  ]
    .filter(([, value]) => typeof value === "string" && value.trim())
    .map(([field, value]) => ({
      field,
      text: sanitizeProviderText(value, configuredKey),
    }));
  const messageSignalsFailure = providerMessages.some(({ text }) =>
    /\b(FAILED|FAILURE|ERROR|INVALID|REJECTED|DECLINED|CANCELLED|CANCELED)\b/i.test(text),
  );
  const messageSignalsSuccess = providerMessages.some(({ text }) =>
    /\b(SUCCESS|SUCCESSFUL|COMPLETED)\b/i.test(text),
  );
  const contradictory =
    (messageSignalsFailure && messageSignalsSuccess) ||
    (status === "SUCCESS" && messageSignalsFailure) ||
    (status === "FAILED" && messageSignalsSuccess);
  if (contradictory) {
    result.status = "PENDING";
    result.documentedDataStatus = false;
    result.contradictory = true;
  }
  if (providerMessages.length) {
    result.providerMessage = providerMessages[0].text;
  }
  return result;
};

const createTelecomAbodeService = ({
  apiKey,
  transport = axios,
  transactionModel = Transaction,
  baseUrl = DEFAULT_BASE_URL,
  timeout = DEFAULT_TIMEOUT_MS,
} = {}) => {
  const verifiedCustomers = new Set();
  const submittedRequestIds = new Set();
  const dataPlanMetadata = new Map();
  const configuredApiKey = () =>
    String(apiKey === undefined ? process.env.TELECOM_ABODE_API_KEY || "" : apiKey).trim();

  const request = async ({ method, endpoint, data, returnDataHttpResponse = false }) => {
    const key = configuredApiKey();
    if (!key) {
      throw new TelecomAbodeError("Telecom Abode API key is not configured.", {
        statusCode: 503,
        code: "MISSING_API_KEY",
      });
    }
    let response;
    try {
      response = await transport({
        method,
        url: `${baseUrl}${endpoint}`,
        headers: {
          Authorization: `Token ${key}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        ...(data === undefined ? {} : { data }),
        timeout,
        validateStatus: () => true,
      });
    } catch (error) {
      throw new TelecomAbodeError("Telecom Abode request failed or timed out; do not retry a purchase automatically.", {
        statusCode: 502,
        code: "PROVIDER_REQUEST_UNCERTAIN",
      });
    }
    if (!response || typeof response.status !== "number") {
      throw new TelecomAbodeError("Telecom Abode returned an invalid HTTP response.", {
        code: "INVALID_PROVIDER_RESPONSE",
      });
    }
    if (response.status < 200 || response.status >= 300) {
      // HTTP 422 is final only for a documented DATA failure with the exact
      // echoed request-id. Every other non-2xx response remains unknown.
      if (returnDataHttpResponse && endpoint === "/data" &&
          response.status === 422 &&
          documentedDataOutcome(response.data) === "FAILED" &&
          response.data?.["request-id"] === data?.["request-id"]) {
        return { body: response.data, httpStatus: response.status };
      }
      throw new TelecomAbodeError(`Telecom Abode request failed with HTTP ${response.status}.`, {
        statusCode: response.status,
        code: "PROVIDER_HTTP_ERROR",
        providerEvidence: safeHttpEvidence(response.data, data?.["request-id"], key),
      });
    }
    return returnDataHttpResponse
      ? { body: response.data, httpStatus: response.status }
      : response.data;
  };

  const ensurePurchasesEnabled = (service) => {
    throw new TelecomAbodeError(
      "Telecom Abode purchases are locked for this service.",
      { statusCode: 503, code: "PURCHASES_DISABLED" }
    );
  };

  const claimRequestId = (requestId) => {
    const normalized = requiredText(requestId, "request-id");
    if (submittedRequestIds.has(normalized)) {
      throw new TelecomAbodeError("This request-id has already been submitted; automatic resubmission is blocked.", {
        statusCode: 409,
        code: "DUPLICATE_REQUEST_ID",
      });
    }
    // Local process guard only; it is not a substitute for durable idempotency.
    submittedRequestIds.add(normalized);
    return normalized;
  };

  const verifyBeforePurchase = (key) => {
    if (!verifiedCustomers.has(key)) {
      fail("A successful matching customer validation is required before purchase.", 409, "VALIDATION_REQUIRED");
    }
    verifiedCustomers.delete(key);
  };

  const getElectricityProviders = async () => normalizeNamedItems(
    await request({ method: "GET", endpoint: "/get-bill" }),
    "providers"
  );

  const getCableProviders = async ({ cable } = {}) => {
    const provider = requiredText(cable, "cable");
    return normalizeNamedItems(
      await request({
        method: "GET",
        endpoint: `/get-cable-providers?cable=${encodeURIComponent(provider)}`,
      }),
      "plans"
    );
  };

  const getDataNetworks = async () => normalizeDataNetworks(
    await request({ method: "GET", endpoint: "/get-networks?service=data" })
  );

  const getDataPlans = async () => {
    dataPlanMetadata.clear();
    const networks = await getDataNetworks();
    const plans = normalizeDataPlans(
      await request({ method: "GET", endpoint: "/data_plans" }),
      networks
    );
    for (const plan of plans) {
      dataPlanMetadata.set(Number(plan.id), {
        plan_id: Number(plan.id),
        network: plan.networkId,
      });
    }
    return plans;
  };

  const validateMeter = async ({ disco, meter_number, meter_type } = {}) => {
    const providerId = requiredId(disco, "disco");
    const meterNumber = requiredText(meter_number, "meter_number");
    const meterType = typeof meter_type === "string" ? meter_type.trim().toLowerCase() : "";
    if (!["prepaid", "postpaid"].includes(meterType)) {
      fail('meter_type must be "prepaid" or "postpaid".');
    }
    const result = normalizeValidation(await request({
      method: "POST",
      endpoint: "/bill/bill-validation",
      data: { disco: providerId, meter_number: meterNumber, meter_type: meterType },
    }));
    if (result.status === "SUCCESSFUL") {
      verifiedCustomers.add(JSON.stringify(["electricity", providerId, meterNumber, meterType]));
    }
    return result;
  };

  const purchaseElectricity = async ({
    disco,
    meter_number,
    meter_type,
    amount,
    request_id,
  } = {}) => {
    ensurePurchasesEnabled("ELECTRICITY");
    const providerId = requiredId(disco, "disco");
    const meterNumber = requiredText(meter_number, "meter_number");
    const meterType = typeof meter_type === "string" ? meter_type.trim().toLowerCase() : "";
    if (!["prepaid", "postpaid"].includes(meterType)) {
      fail('meter_type must be "prepaid" or "postpaid".');
    }
    const normalizedAmount = requiredAmount(amount);
    const normalizedRequestId = claimRequestId(request_id);
    verifyBeforePurchase(JSON.stringify(["electricity", providerId, meterNumber, meterType]));
    const response = await request({
      method: "POST",
      endpoint: "/bill",
      data: {
        disco: providerId,
        meter_number: meterNumber,
        meter_type: meterType,
        amount: normalizedAmount,
        "request-id": normalizedRequestId,
      },
    });
    return normalizePurchase(response, {
      service: "electricity",
      meterType,
      servicepayReference: normalizedRequestId,
    });
  };

  const validateCable = async ({ cable, iuc } = {}) => {
    const providerId = requiredId(cable, "cable");
    const customerIuc = requiredText(iuc, "iuc");
    const result = normalizeValidation(await request({
      method: "POST",
      endpoint: "/cable/cable-validation",
      data: { cable: providerId, iuc: customerIuc },
    }));
    if (result.status === "SUCCESSFUL") {
      verifiedCustomers.add(JSON.stringify(["cable", providerId, customerIuc]));
    }
    return result;
  };

  const purchaseCable = async ({ cable, iuc, cable_plan, request_id } = {}) => {
    ensurePurchasesEnabled("CABLE");
    const providerId = requiredId(cable, "cable");
    const customerIuc = requiredText(iuc, "iuc");
    const plan = requiredText(cable_plan, "cable_plan");
    const normalizedRequestId = claimRequestId(request_id);
    verifyBeforePurchase(JSON.stringify(["cable", providerId, customerIuc]));
    const response = await request({
      method: "POST",
      endpoint: "/cable",
      data: {
        cable: providerId,
        iuc: customerIuc,
        cable_plan: plan,
        "request-id": normalizedRequestId,
      },
    });
    return normalizePurchase(response, {
      service: "cable",
      servicepayReference: normalizedRequestId,
    });
  };

  const purchaseData = async ({
    network,
    phone,
    plan,
    request_id,
    transactionId,
  } = {}) => {
    const planId = typeof plan === "string" && /^\d+$/.test(plan.trim()) ? Number(plan.trim()) : plan;
    const authoritativePlanMetadata = dataPlanMetadata.get(planId);
    const payload = buildDataPurchasePayload({
      network,
      phone,
      plan: planId,
      request_id,
      planMetadata: authoritativePlanMetadata,
    });
    // Consuming the durable claim is a single MongoDB CAS, not a read followed
    // by an HTTP call. Two workers must never send the same paid request.
    const durableClaim = await transactionModel.findOneAndUpdate({
      _id: transactionId,
      reference: payload["request-id"],
      providerRequestId: payload["request-id"],
      serviceType: "DATA",
      provider: "TELECOM_ABODE",
      phone: payload.phone,
      "providerResponse.providerNetworkId": payload.network,
      "providerResponse.providerPlanId": payload.plan,
      status: "PENDING",
      dispatchStatus: "CLAIMED",
      dispatchClaimedAt: { $ne: null },
    }, {
      $set: { dispatchStatus: "SENDING", dispatchStartedAt: new Date() },
    }, { new: true });
    if (!durableClaim) {
      throw new TelecomAbodeError(
        "Telecom Abode DATA dispatch requires a persisted one-shot dispatch claim.",
        { statusCode: 409, code: "DURABLE_DISPATCH_CLAIM_REQUIRED" }
      );
    }
    const normalizedRequestId = claimRequestId(request_id);
    const response = await request({
      method: "POST",
      endpoint: "/data",
      data: payload,
      returnDataHttpResponse: true,
    });
    const normalized = normalizeDataPurchaseResponse(response.body, {
      requestId: normalizedRequestId,
      servicepayReference: normalizedRequestId,
      configuredKey: configuredApiKey(),
    });
    return {
      ...normalized,
      ...(response.httpStatus === 202 ? {
        status: "PENDING",
        documentedDataStatus: false,
        reportedProviderStatus: normalized.status,
        reason: "PROVIDER_HTTP_ACCEPTED_NOT_TERMINAL",
      } : {}),
      httpStatus: response.httpStatus,
    };
  };

  const getTransactionByRequestId = async (requestId) => {
    const targetRequestId = requiredText(requestId, "request-id");
    let data;
    try {
      const response = await request({
        method: "GET",
        endpoint: `/transaction/${encodeURIComponent(targetRequestId)}`,
        returnDataHttpResponse: true,
      });
      if (response.httpStatus === 202) {
        throw new TelecomAbodeError(
          "Telecom Abode transaction lookup is pending; no terminal outcome is established.",
          {
            statusCode: 202,
            code: "TRANSACTION_HTTP_PENDING",
            providerEvidence: safeHttpEvidence(response.body, targetRequestId, configuredApiKey()),
          },
        );
      }
      data = response.body;
    } catch (error) {
      if (error.statusCode === 404 && error.code === "PROVIDER_HTTP_ERROR") {
        throw new TelecomAbodeError(
          "Telecom Abode did not find this transaction; its delivery outcome remains unknown.",
          { statusCode: 404, code: "TRANSACTION_NOT_FOUND", providerEvidence: error.providerEvidence },
        );
      }
      throw error;
    }
    const providerRequestId = data && typeof data === "object" && !Array.isArray(data) &&
      typeof data["request-id"] === "string"
      ? data["request-id"].trim()
      : "";
    if (!providerRequestId || providerRequestId !== targetRequestId) {
      throw new TelecomAbodeError(
        providerRequestId
          ? "Telecom Abode returned a different transaction reference."
          : "Telecom Abode transaction response omitted its request-id.",
        {
          statusCode: 502,
          code: providerRequestId
            ? "TRANSACTION_REFERENCE_MISMATCH"
            : "MISSING_TRANSACTION_REFERENCE",
          providerEvidence: safeHttpEvidence(data, targetRequestId, configuredApiKey()),
        },
      );
    }
    return normalizeTransaction(data, configuredApiKey());
  };

  return {
    getElectricityProviders,
    getCableProviders,
    getDataNetworks,
    getDataPlans,
    validateMeter,
    purchaseElectricity,
    validateCable,
    purchaseCable,
    purchaseData,
    getTransactionByRequestId,
  };
};

const defaultService = createTelecomAbodeService();

module.exports = {
  TelecomAbodeError,
  createTelecomAbodeService,
  normalizePurchase,
  buildDataPurchasePayload,
  normalizeDataPurchaseResponse,
  ...defaultService,
};