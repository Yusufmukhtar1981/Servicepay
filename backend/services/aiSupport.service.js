const {
  getFallbackReply,
  UNAVAILABLE_MESSAGE,
} = require("./aiSupportKnowledgeBase");
const { getProviderReply } = require("./aiProvider.service");

const MAX_STORED_MESSAGE_LENGTH = 4000;
const SECURITY_WARNING =
  "For your security, never share your password, OTP, transaction PIN, card PIN or other secret credentials with anyone, including ServicePay Support.";

const SYSTEM_PROMPT = `You are ServicePay AI Support, a secure customer-support assistant for ServicePay.

You may explain ServicePay account registration/login, wallet, ServicePay-to-ServicePay transfer, withdrawal, airtime, data, electricity, cable TV, exam PIN, NIN verification, KYC, delivery, Empowerment, QR Pay, notifications, transaction PIN guidance, common transaction issues and support procedures.

Never claim a transaction succeeded unless ServicePay backend confirms it. Never invent balances, references, statuses or customer data. Never approve KYC or withdrawals, change wallet balances, execute transfers, expose another customer's data, or provide admin functionality.
Never ask for or repeat a password, OTP, transaction PIN, card PIN, CVV, full BVN, full NIN or API secret. If the customer needs a sensitive action, direct them to the secure in-app flow or human support without requesting the secret.
When information is unavailable, say exactly: "${UNAVAILABLE_MESSAGE}"
For fraud/security complaints, failed funding, unexplained debit, account compromise, disputed transactions or successful-but-not-received services, recommend immediate human escalation.
Keep replies concise, practical and branded as ServicePay AI Support.`;

const SENSITIVE_INPUT_PATTERNS = [
  /\b(?:my\s+)?(?:password|passcode)\b\s*(?:(?:is|equals|:|=|-)\s*)?(?!reset\b|forgot\b|change\b|help\b|issue\b|security\b|policy\b|requirements?\b|should\b|must\b|can\b|need\b|never\b)[^\s,;]{4,}/i,
  /\b(?:my\s+)?(?:otp|one[-\s]?time(?:\s+(?:password|passcode))?|verification code|(?:transaction\s+|card\s+)?pin|cvv|cvc|security code)\b\s*(?:(?:is|equals|:|=|-)\s*)?\d{3,8}\b/i,
  /\b(?:my\s+)?(?:bvn|nin)\b\s*(?:(?:is|equals|:|=|-)\s*)?\d{8,11}\b/i,
  /\b(?:my\s+)?(?:api[_\s-]?key|secret(?:\s+key)?)\b\s*(?:(?:is|equals|:|=|-)\s*)?[A-Za-z0-9][A-Za-z0-9._-]{7,}/i,
];

const ESCALATION_PATTERNS = [
  /\bfraud\b/i,
  /\b(?:scam|hacked|compromised|unauthori[sz]ed)\b/i,
  /\b(?:unexplained|unknown)\s+debit\b/i,
  /\bdisputed?\b/i,
  /\b(?:successful|success)\b.*\b(?:not received|missing|didn't receive|not showing)\b/i,
  /\b(?:not received|missing)\b.*\b(?:successful|success|data|airtime)\b/i,
  /\bfailed funding\b/i,
];

const PROVIDER_POLICY_VIOLATIONS = [
  /\b(?:share|send|provide|enter|tell me|give me)\b.{0,90}\b(?:password|passcode|otp|verification code|(?:transaction\s+|card\s+)?pin|cvv|cvc|bvn|nin|api[_\s-]?key|secret)\b/i,
  /\b(?:your|the)\s+(?:wallet\s+)?balance\s+(?:is|of)\b/i,
  /\b(?:your|the)\s+(?:transaction|transfer|payment|withdrawal|funding|service)\s+(?:is|was|has been)\s+(?:successful|completed|approved|pending|failed|processed)\b/i,
  /\b(?:i|we|servicepay ai support)\s+(?:have|can|will)\s+(?:approve|approved|process|processed|execute|executed|send|sent|credit|credited|debit|debited|change|changed)\b/i,
  /\b(?:ignore|override|bypass)\b.{0,90}\b(?:instruction|system|policy|rule|security)\b/i,
  /\b(?:admin|administrator)\s+(?:access|function|feature|panel|account)\b/i,
];

const sanitizeText = (value, maxLength = MAX_STORED_MESSAGE_LENGTH) =>
  String(value || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);

const redactSensitiveText = (value) => {
  let result = sanitizeText(value);

  for (const pattern of SENSITIVE_INPUT_PATTERNS) {
    result = result.replace(
      new RegExp(pattern.source, "gi"),
      "[REDACTED SENSITIVE CREDENTIAL]"
    );
  }

  return result;
};

const containsSensitiveCredential = (message) =>
  SENSITIVE_INPUT_PATTERNS.some((pattern) =>
    pattern.test(sanitizeText(message))
  );

const shouldEscalate = (message) =>
  ESCALATION_PATTERNS.some((pattern) => pattern.test(message));

const isSafeProviderReply = (reply) => {
  const sanitizedReply = sanitizeText(reply);

  return Boolean(sanitizedReply) &&
    !containsSensitiveCredential(sanitizedReply) &&
    !PROVIDER_POLICY_VIOLATIONS.some((pattern) =>
      pattern.test(sanitizedReply)
    );
};

const sanitizeHistoryForProvider = (history) =>
  Array.isArray(history)
    ? history
        .filter(
          (item) =>
            (item?.role === "USER" || item?.role === "ASSISTANT") &&
            typeof item?.message === "string" &&
            !containsSensitiveCredential(item.message)
        )
        .slice(-10)
        .map((item) => ({
          role: item.role,
          message: redactSensitiveText(item.message),
        }))
    : [];

const createSupportReply = async ({
  message,
  history = [],
  provider = getProviderReply,
} = {}) => {
  const safeMessage = sanitizeText(message, 2000);
  const fallbackReply = getFallbackReply(safeMessage);

  try {
    const providerReply = await provider({
      systemPrompt: SYSTEM_PROMPT,
      message: safeMessage,
      history: sanitizeHistoryForProvider(history),
    });

    if (isSafeProviderReply(providerReply)) {
      return {
        reply: redactSensitiveText(providerReply),
        source: "provider",
        escalationRecommended: shouldEscalate(safeMessage),
      };
    }
  } catch (error) {
    console.error("AI provider unavailable; using fallback:", error.message);
  }

  return {
    reply: redactSensitiveText(fallbackReply),
    source: "fallback",
    escalationRecommended: shouldEscalate(safeMessage),
  };
};

module.exports = {
  MAX_STORED_MESSAGE_LENGTH,
  SECURITY_WARNING,
  SYSTEM_PROMPT,
  containsSensitiveCredential,
  createSupportReply,
  isSafeProviderReply,
  redactSensitiveText,
  sanitizeText,
  sanitizeHistoryForProvider,
  shouldEscalate,
};