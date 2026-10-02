const axios = require("axios");

const AIRTIME_URL =
  "https://www.nellobytesystems.com/APIAirtimeV1.asp";
const QUERY_URL =
  "https://www.nellobytesystems.com/APIQueryV1.asp";
const REQUEST_TIMEOUT_MS = 45_000;

const TERMINAL_FAILURE_CODES = new Set(["500", "501"]);

const text = (value) =>
  value === undefined || value === null
    ? ""
    : String(value).trim();

const normalizedKey = (value) =>
  String(value || "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();

const getField = (record, names) => {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return undefined;
  }

  const values = new Map(
    Object.entries(record).map(([key, value]) => [
      normalizedKey(key),
      value,
    ]),
  );

  for (const name of names) {
    const value = values.get(normalizedKey(name));
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
};

const parseResponse = (data) => {
  if (typeof data === "string") {
    try {
      return JSON.parse(data);
    } catch (_error) {
      return null;
    }
  }
  return data && typeof data === "object" && !Array.isArray(data)
    ? data
    : null;
};

const normalizeOrderId = (value) => {
  const result = text(value);
  return /^[A-Za-z0-9._-]{1,128}$/.test(result) ? result : "";
};

const normalizeRequestId = (value) => {
  const result = text(value);
  return /^[A-Za-z0-9._-]{1,128}$/.test(result) ? result : "";
};

const normalizeMoney = (value) => {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    !/^\d+(?:\.\d{1,2})?$/.test(String(value).trim())
  ) {
    return null;
  }

  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
};

const parseEvidence = (data) => {
  const record = parseResponse(data);
  if (!record) return null;

  const statusCodeValue = getField(record, ["statuscode", "statusCode"]);
  const statusCode = /^\d{3}$/.test(text(statusCodeValue))
    ? text(statusCodeValue)
    : "";
  const orderStatus = text(
    getField(record, ["orderstatus", "status"]),
  ).toUpperCase();

  return {
    statusCode,
    orderStatus,
    orderId: normalizeOrderId(getField(record, ["orderid", "orderId"])),
    requestId: normalizeRequestId(
      getField(record, ["requestid", "requestId"]),
    ),
    amountCharged: normalizeMoney(
      getField(record, ["amountcharged", "amountCharged"]),
    ),
  };
};

const classifyEvidence = ({
  evidence,
  submittedRequestId,
  persistedOrderId = "",
  lookup = false,
}) => {
  const requestId = normalizeRequestId(submittedRequestId);
  const expectedOrderId = normalizeOrderId(persistedOrderId);
  const requestMatches =
    Boolean(requestId) &&
    Boolean(evidence?.requestId) &&
    evidence.requestId === requestId;
  const orderMatches =
    Boolean(expectedOrderId) &&
    Boolean(evidence?.orderId) &&
    evidence.orderId === expectedOrderId;

  const correlated = lookup
    ? expectedOrderId
      ? orderMatches
      : requestMatches
    : requestMatches || Boolean(evidence?.orderId);

  if (!correlated) {
    return { outcome: "UNKNOWN", reasonCode: "PROVIDER_CORRELATION_MISMATCH" };
  }

  if (
    evidence.statusCode === "200" &&
    evidence.orderStatus === "ORDER_COMPLETED"
  ) {
    return {
      outcome: "SUCCESS",
      reasonCode: "ORDER_COMPLETED",
      authoritative: true,
    };
  }

  if (
    TERMINAL_FAILURE_CODES.has(evidence.statusCode) &&
    evidence.orderStatus === "ORDER_CANCELLED"
  ) {
    return {
      outcome: "FAILED",
      reasonCode: "ORDER_CANCELLED",
      authoritative: true,
    };
  }

  if (
    evidence.statusCode === "100" &&
    evidence.orderStatus === "ORDER_RECEIVED"
  ) {
    return {
      outcome: "PENDING",
      reasonCode: "ORDER_RECEIVED",
      authoritative: true,
    };
  }

  if (
    evidence.statusCode === "201" &&
    evidence.orderStatus === "ORDER_COMPLETED"
  ) {
    return {
      outcome: "UNKNOWN",
      reasonCode: "NETWORK_UNRESPONSIVE",
      authoritative: false,
    };
  }

  return {
    outcome: "UNKNOWN",
    reasonCode: "UNRECOGNIZED_PROVIDER_STATUS",
    authoritative: false,
  };
};

const getCredentials = () => {
  const userId = text(process.env.CLUBKONNECT_USER_ID);
  const apiKey = text(process.env.CLUBKONNECT_API_KEY);
  return { userId, apiKey, valid: Boolean(userId && apiKey) };
};

const createClubKonnectAirtimeProvider = ({
  httpClient = axios,
  credentials,
  getCredentials: getCredentialsOverride,
  axiosClient,
  airtimeUrl = AIRTIME_URL,
  queryUrl = QUERY_URL,
  timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) => {
  const verifiedResponses = new WeakSet();
  const sealResponse = (value) => {
    if (value?.body && typeof value.body === "object") {
      Object.freeze(value.body);
    }
    Object.freeze(value);
    verifiedResponses.add(value);
    return value;
  };
  const isVerifiedEvidence = (value) =>
    Boolean(value && typeof value === "object" && verifiedResponses.has(value));

  const getCredentialPair = () => {
    const credentialReader =
      getCredentialsOverride || credentials || getCredentials;
    const pair = credentialReader();
    const userId = text(pair?.userId);
    const apiKey = text(pair?.apiKey);
    if (!userId || !apiKey) {
      const error = new Error(
        "ClubKonnect credentials are not configured on the server.",
      );
      error.code = "AIRTIME_PROVIDER_NOT_CONFIGURED";
      error.status = 503;
      throw error;
    }
    return { userId, apiKey };
  };

  const client = axiosClient || httpClient;

  const sendGet = async (url, params) => {
    try {
      const response = await client.get(url, {
        params,
        timeout: timeoutMs,
        validateStatus: () => true,
        maxRedirects: 0,
      });

      if (!response || !Number.isInteger(response.status) || response.status !== 200) {
        return { transportFailure: true, status: response?.status || null };
      }
      return { response };
    } catch (_error) {
      // HTTP client errors can contain the credential-bearing query string.
      // Never propagate or persist them.
      return { transportFailure: true, status: null };
    }
  };

  const purchase = async ({
    network,
    phone,
    amount,
    requestId,
  }) => {
    const correlationId = normalizeRequestId(requestId);
    if (!correlationId) {
      throw new Error("A persisted Airtime request reference is required.");
    }

    const { userId, apiKey } = getCredentialPair();
    const responseResult = await sendGet(airtimeUrl, {
      UserID: userId,
      APIKey: apiKey,
      MobileNetwork: network,
      Amount: amount,
      MobileNumber: phone,
      RequestID: correlationId,
    });

    if (responseResult.transportFailure) {
      return sealResponse({
        source: "INITIAL_REQUEST",
        outcome: "UNKNOWN",
        authoritative: false,
        reasonCode: "PROVIDER_TRANSPORT_UNCERTAIN",
        httpStatus: responseResult.status,
        requestId: correlationId,
        providerOrderId: "",
        providerCost: null,
        body: null,
      });
    }

    const evidence = parseEvidence(responseResult.response.data);
    if (!evidence) {
      return sealResponse({
        source: "INITIAL_REQUEST",
        outcome: "UNKNOWN",
        authoritative: false,
        reasonCode: "UNPARSEABLE_PROVIDER_RESPONSE",
        httpStatus: responseResult.response.status,
        requestId: correlationId,
        providerOrderId: "",
        providerCost: null,
        body: null,
      });
    }

    const classification = classifyEvidence({
      evidence,
      submittedRequestId: correlationId,
    });

    const safelyCorrelated = Boolean(
      (!evidence.requestId || evidence.requestId === correlationId) &&
        (evidence.requestId === correlationId || evidence.orderId),
    );

    return sealResponse({
      source: "INITIAL_REQUEST",
      ...classification,
      authoritative: Boolean(classification.authoritative && safelyCorrelated),
      httpStatus: responseResult.response.status,
      requestId: evidence.requestId || correlationId,
      providerOrderId: evidence.orderId,
      // A purchase response may confirm delivery, but cost is accepted only
      // from a later, correlated terminal status query.
      providerCost: null,
      body: {
        statusCode: evidence.statusCode,
        orderStatus: evidence.orderStatus,
        orderId: evidence.orderId,
        requestId: evidence.requestId,
        amountCharged: null,
      },
    });
  };

  const query = async ({
    requestId,
    orderId = "",
  }) => {
    const correlationId = normalizeRequestId(requestId);
    const persistedOrderId = normalizeOrderId(orderId);
    if (!persistedOrderId && !correlationId) {
      throw new Error("A persisted Airtime lookup identifier is required.");
    }

    const { userId, apiKey } = getCredentialPair();
    const params = {
      UserID: userId,
      APIKey: apiKey,
    };
    if (persistedOrderId) params.OrderID = persistedOrderId;
    else params.RequestID = correlationId;

    const responseResult = await sendGet(queryUrl, params);
    if (responseResult.transportFailure) {
      return sealResponse({
        source: "STATUS_QUERY",
        outcome: "UNKNOWN",
        authoritative: false,
        reasonCode: "PROVIDER_QUERY_UNAVAILABLE",
        httpStatus: responseResult.status,
        requestId: correlationId,
        providerOrderId: persistedOrderId,
        providerCost: null,
        body: null,
      });
    }

    const evidence = parseEvidence(responseResult.response.data);
    if (!evidence) {
      return sealResponse({
        source: "STATUS_QUERY",
        outcome: "UNKNOWN",
        authoritative: false,
        reasonCode: "UNPARSEABLE_PROVIDER_RESPONSE",
        httpStatus: responseResult.response.status,
        requestId: correlationId,
        providerOrderId: persistedOrderId,
        providerCost: null,
        body: null,
      });
    }

    const classification = classifyEvidence({
      evidence,
      submittedRequestId: correlationId,
      persistedOrderId,
      lookup: true,
    });

    const safeEcho =
      persistedOrderId || evidence.requestId === correlationId;
    const authoritative = Boolean(classification.authoritative && safeEcho);
    const terminalSuccessfulQuery =
      authoritative &&
      classification.outcome === "SUCCESS" &&
      evidence.statusCode === "200" &&
      evidence.orderStatus === "ORDER_COMPLETED";

    return sealResponse({
      source: "STATUS_QUERY",
      ...classification,
      authoritative,
      httpStatus: responseResult.response.status,
      requestId: evidence.requestId || correlationId,
      providerOrderId: evidence.orderId,
      providerCost: terminalSuccessfulQuery ? evidence.amountCharged : null,
      body: {
        statusCode: evidence.statusCode,
        orderStatus: evidence.orderStatus,
        orderId: evidence.orderId,
        requestId: evidence.requestId,
        amountCharged: terminalSuccessfulQuery
          ? evidence.amountCharged
          : null,
      },
    });
  };

  return {
    purchase,
    query,
    submitAirtime: purchase,
    queryAirtime: query,
    isVerifiedEvidence,
  };
};

module.exports = {
  createClubkonnectAirtimeProviderService: createClubKonnectAirtimeProvider,
  createClubKonnectAirtimeProviderService: createClubKonnectAirtimeProvider,
  createClubKonnectAirtimeProvider,
  parseEvidence,
  classifyEvidence,
  normalizeMoney,
  TERMINAL_FAILURE_CODES,
};