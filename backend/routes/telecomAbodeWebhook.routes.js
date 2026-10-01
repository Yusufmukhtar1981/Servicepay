const express = require("express");
const {
  settleTelecomAbodeDataOutcome,
} = require("../services/telecomAbodeDataSettlement.service");

const MAX_REQUEST_ID_LENGTH = 128;
const MAX_API_RESPONSE_LENGTH = 512;
const WEBHOOK_JSON_LIMIT = "16kb";

const getConfiguredTrustedProxyCidrs = () => {
  const configured = process.env.TELECOM_ABODE_TRUSTED_PROXY_CIDRS;
  if (typeof configured !== "string" || configured === "") return [];
  return configured.split(",").map((cidr) => cidr.trim());
};

const normalizeStatus = (value) => {
  if (typeof value !== "string") return null;
  const status = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (["SUCCESS", "SUCCESSFUL"].includes(status)) return "SUCCESS";
  if (["FAIL", "FAILED"].includes(status)) return "FAILED";
  if (["PENDING", "PROCESSING"].includes(status)) return "PENDING";
  return null;
};

const isNonNegativeAmount = (value, { positive = false } = {}) => {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && !/^\d+(?:\.\d{1,2})?$/.test(value.trim()))
  ) {
    return false;
  }
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && (!positive || number > 0);
};

const getRequestId = (payload) => {
  const hyphenated = payload["request-id"];
  const underscored = payload.request_id;
  if (
    (hyphenated !== undefined &&
      (typeof hyphenated !== "string" || !hyphenated.trim())) ||
    (underscored !== undefined &&
      (typeof underscored !== "string" || !underscored.trim()))
  ) {
    return null;
  }
  const first = typeof hyphenated === "string" ? hyphenated.trim() : "";
  const second = typeof underscored === "string" ? underscored.trim() : "";
  if (first && second && first !== second) return null;
  const requestId = first || second;
  return requestId && requestId.length <= MAX_REQUEST_ID_LENGTH ? requestId : null;
};

const hasCoherentBalances = (payload) => {
  if (
    payload.old_balance === undefined ||
    payload.new_balance === undefined ||
    !isNonNegativeAmount(payload.old_balance) ||
    !isNonNegativeAmount(payload.new_balance)
  ) {
    return false;
  }
  return true;
};

const normalizeNotification = (payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const statusFields = ["status", "Status"].filter((field) =>
    Object.prototype.hasOwnProperty.call(payload, field),
  );
  if (!statusFields.length) return null;
  const outcomes = statusFields.map((field) => normalizeStatus(payload[field]));
  if (outcomes.some((outcome) => !outcome) || new Set(outcomes).size !== 1) return null;

  const requestId = getRequestId(payload);
  if (!requestId) return null;
  if (
    typeof payload.api_response !== "string" ||
    !payload.api_response.trim() ||
    payload.api_response.length > MAX_API_RESPONSE_LENGTH ||
    !hasCoherentBalances(payload)
  ) {
    return null;
  }

  const outcome = outcomes[0];
  const responseText = payload.api_response.toUpperCase();
  const saysFailure = /\b(FAIL|FAILED|FAILURE|ERROR|REJECTED|DECLINED)\b/.test(responseText);
  const saysSuccess = /\b(SUCCESS|SUCCESSFUL|COMPLETED)\b/.test(responseText);
  if (
    (saysFailure && saysSuccess) ||
    (outcome === "SUCCESS" && saysFailure) ||
    (outcome === "FAILED" && saysSuccess)
  ) {
    return null;
  }

  let amount;
  if (Object.prototype.hasOwnProperty.call(payload, "amount")) {
    if (!isNonNegativeAmount(payload.amount, { positive: true })) return null;
    amount = Number(payload.amount);
  }

  return {
    requestId,
    outcome,
    amount,
    providerStatus: String(payload.status ?? payload.Status).trim().slice(0, 24),
    balanceEvidenceProvided:
      payload.old_balance !== undefined && payload.new_balance !== undefined,
  };
};

const defaultSourceVerifier = async (req, options) => {
  try {
    const { verifyTelecomAbodeSource } = require(
      "../services/telecomAbodeWebhookSource.service",
    );
    if (typeof verifyTelecomAbodeSource !== "function") return false;
    return await verifyTelecomAbodeSource(req, options) === true;
  } catch (_) {
    // Missing or unavailable source verification must fail closed.
    return false;
  }
};

const createTelecomAbodeWebhookRouter = ({
  verifySource = defaultSourceVerifier,
  settleOutcome = settleTelecomAbodeDataOutcome,
  trustedProxyCidrs = [],
} = {}) => {
  const router = express.Router();

  router.use(async (req, res, next) => {
    if (req.method !== "POST" || req.path !== "/") return next();
    try {
      req.telecomAbodeSourceVerified =
        await verifySource(req, { trustedProxyCidrs }) === true;
    } catch (_) {
      req.telecomAbodeSourceVerified = false;
    }
    if (!req.telecomAbodeSourceVerified) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }
    return next();
  });

  router.use(express.json({ limit: WEBHOOK_JSON_LIMIT, strict: true }));
  router.use((error, req, res, next) => {
    if (error?.type === "entity.too.large") {
      return res.status(413).json({ error: "WEBHOOK_PAYLOAD_TOO_LARGE" });
    }
    if (error?.type === "entity.parse.failed" || error?.status === 400) {
      return res.status(400).json({ error: "INVALID_WEBHOOK_PAYLOAD" });
    }
    return next(error);
  });

  router.post("/", async (req, res) => {
    const notification = normalizeNotification(req.body);
    if (!notification) {
      return res.status(400).json({ error: "INVALID_WEBHOOK_PAYLOAD" });
    }

    try {
      const settlement = await settleOutcome({
        requestId: notification.requestId,
        outcome: notification.outcome,
        source: "WEBHOOK",
        evidence: {
          requestId: notification.requestId,
          service: "data",
          verifiedSource: req.telecomAbodeSourceVerified === true,
          providerStatus: notification.providerStatus,
          ...(notification.amount === undefined
            ? {}
            : { amount: notification.amount }),
          balanceEvidenceProvided: notification.balanceEvidenceProvided,
        },
      });
      if (
        ![
          "NOT_FOUND",
          "ALREADY_TERMINAL",
          "PENDING",
          "SETTLED",
          "REFUNDED",
        ].includes(settlement?.status)
      ) {
        // Do not acknowledge a matched record unless this delivery is either
        // durably recorded or conclusively duplicate/terminal.
        return res.status(503).json({ error: "WEBHOOK_PROCESSING_UNAVAILABLE" });
      }
      return res.status(200).json({ received: true });
    } catch (_) {
      // Do not acknowledge a settlement whose database transaction failed.
      return res.status(503).json({ error: "WEBHOOK_PROCESSING_UNAVAILABLE" });
    }
  });

  return router;
};

const router = createTelecomAbodeWebhookRouter({
  trustedProxyCidrs: getConfiguredTrustedProxyCidrs(),
});
router.createTelecomAbodeWebhookRouter = createTelecomAbodeWebhookRouter;
router.normalizeNotification = normalizeNotification;

module.exports = router;