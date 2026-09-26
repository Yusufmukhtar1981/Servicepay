const axios = require("axios");

const DEFAULT_BASE_URL = "https://telecomabode.com.ng/api";
const DEFAULT_TIMEOUT_MS = 30000;

class TelecomAbodeError extends Error {
  constructor(message, { statusCode = 502, code = "TELECOM_ABODE_ERROR" } = {}) {
    super(message);
    this.name = "TelecomAbodeError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

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
    if (text === "failed" || text === "failure") return "FAILED";
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
  if (status === "SUCCESSFUL") return "SUCCESSFUL";
  if (status === "PENDING") return "PENDING";
  if (status === "FAILED") return "FAILED";
  return null;
};

const getCollection = (data, collectionName) => {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return null;
  if (Array.isArray(data[collectionName])) return data[collectionName];
  if (Array.isArray(data.data)) return data.data;
  return null;
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

const normalizePurchase = (data, { service, meterType }) => {
  const status = normalizePurchaseStatus(data);
  if (!status || !data || typeof data !== "object" || Array.isArray(data)) {
    throw new TelecomAbodeError("Telecom Abode purchase response had no unambiguous status.", {
      code: "INVALID_PROVIDER_RESPONSE",
    });
  }
  const providerRequestId = typeof data["request-id"] === "string"
    ? data["request-id"].trim()
    : "";
  if (status === "SUCCESSFUL" && !providerRequestId) {
    return {
      status: "PENDING",
      service,
      reason: "MISSING_PROVIDER_CORRELATION",
    };
  }
  const result = { status, service };
  if (typeof data.message === "string" && data.message.trim()) {
    result.message = data.message.trim();
  }
  if (providerRequestId) result.requestId = providerRequestId;
  if (typeof data.amount === "string" || typeof data.amount === "number") {
    result.amount = String(data.amount);
  }
  if (service === "electricity" && meterType === "prepaid" &&
      typeof data.token === "string" && data.token.trim()) {
    result.token = data.token.trim();
    result.transactionData = { token: result.token };
  }
  return result;
};

const normalizeTransaction = (data) => {
  const status = normalizePurchaseStatus(data);
  if (!status) {
    throw new TelecomAbodeError("Telecom Abode transaction response had no recognized status.", {
      code: "INVALID_PROVIDER_RESPONSE",
    });
  }
  const result = { status };
  for (const field of ["request-id", "amount", "new_balance", "token", "service"]) {
    const value = data[field];
    if (typeof value === "string" || typeof value === "number") {
      result[field === "request-id" ? "requestId" : field === "new_balance" ? "newBalance" : field] =
        String(value);
    }
  }
  if (typeof data.message === "string" && data.message.trim()) {
    result.message = data.message.trim();
  }
  return result;
};

const createTelecomAbodeService = ({
  apiKey,
  transport = axios,
  baseUrl = DEFAULT_BASE_URL,
  timeout = DEFAULT_TIMEOUT_MS,
  enablePurchases = false,
} = {}) => {
  const verifiedCustomers = new Set();
  const submittedRequestIds = new Set();

  const request = async ({ method, endpoint, data }) => {
    const key = String(apiKey === undefined ? process.env.TELECOM_ABODE_API_KEY || "" : apiKey).trim();
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
      throw new TelecomAbodeError(`Telecom Abode request failed with HTTP ${response.status}.`, {
        statusCode: response.status,
        code: "PROVIDER_HTTP_ERROR",
      });
    }
    return response.data;
  };

  const ensurePurchasesEnabled = () => {
    if (!enablePurchases) {
      throw new TelecomAbodeError(
        "Telecom Abode purchases are disabled until duplicate-request and provider requery safety are verified.",
        { statusCode: 503, code: "PURCHASES_DISABLED" }
      );
    }
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
    ensurePurchasesEnabled();
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
    return normalizePurchase(response, { service: "electricity", meterType });
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
    ensurePurchasesEnabled();
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
    return normalizePurchase(response, { service: "cable" });
  };

  const getTransactionByRequestId = async (requestId) => {
    const targetRequestId = requiredText(requestId, "request-id");
    const data = await request({ method: "GET", endpoint: "/transactions" });
    const transactions = getCollection(data, "transactions");
    if (!transactions) {
      throw new TelecomAbodeError(
        "Telecom Abode did not return an explicit transaction collection; a transaction query parameter is undocumented.",
        { statusCode: 501, code: "TRANSACTION_QUERY_UNDOCUMENTED" }
      );
    }
    const matches = transactions.filter((item) =>
      item && typeof item === "object" && item["request-id"] === targetRequestId
    );
    if (matches.length !== 1) {
      throw new TelecomAbodeError(
        matches.length ? "Telecom Abode returned ambiguous matching transactions." : "No exact request-id match was returned.",
        { statusCode: matches.length ? 502 : 404, code: matches.length ? "AMBIGUOUS_TRANSACTION" : "TRANSACTION_NOT_FOUND" }
      );
    }
    return normalizeTransaction(matches[0]);
  };

  return {
    getElectricityProviders,
    getCableProviders,
    validateMeter,
    purchaseElectricity,
    validateCable,
    purchaseCable,
    getTransactionByRequestId,
  };
};

const defaultService = createTelecomAbodeService();

module.exports = {
  TelecomAbodeError,
  createTelecomAbodeService,
  ...defaultService,
};